/* Cueola grading model.
 *
 * Pure, dependency-free helpers behind the one-student grading view: the
 * per-student activity record (minutes active per day, kept as minute ticks),
 * the words that describe a paperwork field or a rundown change, and the
 * merged timeline of everything one person entered in a show. Firestore, DOM
 * and UI stay in cueola-app.js. Node contract tests load this file directly
 * (same pattern as cueola-export-model.js).
 *
 * The record one student's device writes (sessions/{code}/grading/{id}):
 *   {
 *     schema: 1, profileId, name, role, username, startedAt, updatedAt,
 *     days: { d20261017: { ticks: [540, 541, 547], where: { call_sheet: 2, rundown: 1 } } },
 *     entries: [ { at, kind, section, page, fields: [], text, n } ]
 *   }
 * A tick is one minute of the local day (0 to 1439) in which the person was
 * looking at the app and had typed, clicked or scrolled in the last two
 * minutes. Two windows of the same person in the same minute count once.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaGradingModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SCHEMA = 1;
  var ENTRY_CAP = 500;        // entries kept per student record
  var ENTRY_KEEP = 450;       // what a trim leaves
  var FIELDS_PER_ENTRY = 40;  // labels kept on one entry
  var LOG_FIELDS_CAP = 12;    // labels on a "Who worked on what" entry
  var SITTING_GAP_MIN = 10;   // a quiet gap longer than this starts a new sitting
  var MERGE_WINDOW_MS = 120000;

  var KIND_LABELS = {
    paperwork: 'Paperwork',
    rundown: 'Rundown',
    live: 'Live',
    note: 'Note posted',
    reply: 'Reply',
    'note-edit': 'Note edited',
    'note-removed': 'Note removed',
    todo: 'To-do posted',
    'todo-done': 'To-do done',
    checklist: 'Checklist item done',
    assignment: 'Positions'
  };

  var WHERE_LABELS = {
    home: 'Home screen',
    rundown: 'Rundown',
    live: 'Live',
    pb_hub: 'Planda Bear hub',
    pb_call_sheet: 'Call Sheet',
    pb_production_scheduler: 'Production Schedule',
    pb_safety_plan: 'Safety Plan',
    pb_video_patch: 'Video Patch',
    pb_audio_comms_patch: 'Audio / Comms Patch',
    pb_stage_plot: 'Stage Plot',
    pb_production_notes: 'Production Notes',
    pb_assignments: 'Position Assignments',
    prompter: 'Prompter',
    playback: 'Playback',
    deck: 'Stream Deck'
  };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function nameKey(name) {
    return String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  // Firestore field paths want identifier-safe segments: letters, digits and
  // underscores. Day keys and "where" keys are built to pass that test.
  function safeKey(value) {
    var s = String(value == null ? '' : value).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 48);
    if (!s) s = 'x';
    if (!/^[A-Za-z_]/.test(s)) s = 'k_' + s;
    return s;
  }

  function dayKey(ts) {
    var d = new Date(typeof ts === 'number' ? ts : Date.now());
    return 'd' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
  }

  function dayKeyToDate(key) {
    var m = /^d(\d{4})(\d{2})(\d{2})$/.exec(String(key || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  }

  function minuteOfDay(ts) {
    var d = new Date(typeof ts === 'number' ? ts : Date.now());
    return d.getHours() * 60 + d.getMinutes();
  }

  // The wall-clock time of one tick: that day at that minute, local time.
  function tickTime(key, minute) {
    var base = dayKeyToDate(key);
    if (!base) return 0;
    return base.getTime() + Math.max(0, Math.min(1439, Number(minute) || 0)) * 60000;
  }

  // The record's document id: the profile id when the person has one, else a
  // slug of the name. Both pass the rules' ^[A-Za-z0-9_.-]{1,160}$ test.
  function docId(person) {
    person = person || {};
    var pid = String(person.profileId || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 160);
    if (pid) return pid;
    var slug = nameKey(person.name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
    return 'n_' + (slug || 'someone');
  }

  function emptyRecord(person) {
    person = person || {};
    return {
      schema: SCHEMA,
      profileId: String(person.profileId || ''),
      name: String(person.name || ''),
      role: person.role === 'instructor' ? 'instructor' : 'student',
      username: String(person.username || ''),
      startedAt: 0,
      updatedAt: 0,
      days: {},
      entries: []
    };
  }

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function uniqueMinutes(list) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (m) {
      var n = Number(m);
      if (!isFinite(n) || n < 0 || n > 1439) return;
      n = Math.floor(n);
      if (seen[n]) return;
      seen[n] = true;
      out.push(n);
    });
    return out.sort(function (a, b) { return a - b; });
  }

  function normalizeEntry(e) {
    if (!isObj(e)) return null;
    var at = Number(e.at) || 0;
    if (!at) return null;
    var fields = Array.isArray(e.fields) ? e.fields.map(function (f) { return String(f == null ? '' : f).slice(0, 120); }).filter(Boolean) : [];
    return {
      at: at,
      kind: String(e.kind || 'paperwork').slice(0, 24),
      section: String(e.section || '').slice(0, 80),
      page: String(e.page || '').slice(0, 40),
      fields: fields.slice(0, FIELDS_PER_ENTRY),
      text: String(e.text || '').slice(0, 200),
      n: Math.max(1, Number(e.n) || 1),
      source: e.source === 'log' ? 'log' : (e.source === 'notes' ? 'notes' : 'record')
    };
  }

  function normalizeRecord(raw) {
    var rec = emptyRecord(raw || {});
    if (!isObj(raw)) return rec;
    rec.schema = Number(raw.schema) || SCHEMA;
    rec.startedAt = Number(raw.startedAt) || 0;
    rec.updatedAt = Number(raw.updatedAt) || 0;
    rec.days = {};
    if (isObj(raw.days)) {
      Object.keys(raw.days).forEach(function (key) {
        if (!dayKeyToDate(key) || !isObj(raw.days[key])) return;
        var day = raw.days[key];
        var where = {};
        if (isObj(day.where)) {
          Object.keys(day.where).forEach(function (w) {
            var n = Number(day.where[w]);
            if (isFinite(n) && n > 0) where[safeKey(w)] = Math.floor(n);
          });
        }
        rec.days[key] = { ticks: uniqueMinutes(day.ticks), where: where };
      });
    }
    rec.entries = (Array.isArray(raw.entries) ? raw.entries : []).map(normalizeEntry).filter(Boolean);
    return rec;
  }

  // ── Minutes active ────────────────────────────────────────────────────
  // Ticks sorted; consecutive minutes (gaps up to SITTING_GAP_MIN) form one
  // sitting. "to" is the minute after the last tick, so a single tick is a
  // one-minute sitting from 9:05 to 9:06.
  function sittings(ticks, gapMin) {
    var gap = typeof gapMin === 'number' ? gapMin : SITTING_GAP_MIN;
    var list = uniqueMinutes(ticks);
    var out = [];
    var cur = null;
    list.forEach(function (m) {
      if (cur && m - cur.lastTick <= gap) {
        cur.lastTick = m;
        cur.minutes += 1;
        cur.to = m + 1;
        return;
      }
      cur = { from: m, to: m + 1, minutes: 1, lastTick: m };
      out.push(cur);
    });
    return out.map(function (s) { return { from: s.from, to: s.to, minutes: s.minutes }; });
  }

  function whereLabel(key) {
    if (WHERE_LABELS[key]) return WHERE_LABELS[key];
    var s = String(key || '').replace(/^pb_/, '').replace(/_/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'App';
  }

  // One row per day the person was active, oldest first.
  function summarizeDays(days) {
    if (!isObj(days)) return [];
    return Object.keys(days).filter(dayKeyToDate).sort().map(function (key) {
      var day = days[key] || {};
      var ticks = uniqueMinutes(day.ticks);
      var sits = sittings(ticks);
      var where = isObj(day.where) ? Object.keys(day.where).map(function (w) {
        return { key: w, label: whereLabel(w), minutes: Math.floor(Number(day.where[w]) || 0) };
      }).filter(function (w) { return w.minutes > 0; }).sort(function (a, b) { return b.minutes - a.minutes; }) : [];
      return {
        key: key,
        date: dayKeyToDate(key),
        minutes: ticks.length,
        first: ticks.length ? tickTime(key, ticks[0]) : 0,
        last: ticks.length ? tickTime(key, ticks[ticks.length - 1] + 1) : 0,
        sittings: sits.map(function (s) {
          return { from: tickTime(key, s.from), to: tickTime(key, s.to), minutes: s.minutes };
        }),
        where: where
      };
    });
  }

  // ── Field words ───────────────────────────────────────────────────────
  // The app reads these off the input the student typed in and hands them
  // over as plain values; this turns them into the words the grading view
  // prints ("Crew row 3: Name").
  function describeField(info) {
    info = info || {};
    var row = (typeof info.rowIndex === 'number' && info.rowIndex >= 0) ? info.rowIndex + 1 : 0;
    var cap = function (s) { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; };
    if (info.id === 'pp-plot-canvas' || info.plot) return 'Stage plot drawing';
    if (info.callField) return (row ? 'Crew row ' + row + ': ' : 'Crew: ') + cap(info.callField === 'call' ? 'Call time' : info.callField);
    if (info.patchField) {
      if (info.patchField === 'id') return '';
      var kindWord = info.patchKind === 'comms' ? 'Comms row ' : (info.patchKind ? cap(info.patchKind) + ' row ' : 'Row ');
      return (row ? kindWord + row + ': ' : '') + cap(info.patchField);
    }
    if (info.psField) {
      if (['id', 'area', 'hint', 'doneBy', 'doneAt'].indexOf(info.psField) !== -1) return '';
      var base = row ? 'Ready list row ' + row : 'Ready list';
      return info.psField === 'done' ? base + ': Ready check' : base;
    }
    if (typeof info.spPpe === 'number' || (typeof info.spPpe === 'string' && info.spPpe !== '')) {
      return 'PPE item ' + (Number(info.spPpe) + 1);
    }
    var label = String(info.label || '').trim();
    if (label) return label.slice(0, 80);
    var aria = String(info.ariaLabel || '').trim();
    if (aria) return aria.slice(0, 80);
    var ph = String(info.placeholder || '').trim();
    if (ph && !/^e\.g\./i.test(ph)) return ph.slice(0, 80);
    var id = String(info.id || '').trim();
    if (id) {
      // "pp-show-start" reads as "Show start".
      var words = id.replace(/^(pp|ps|sp|vp|ap|cp|plot)-/, '').replace(/[-_]+/g, ' ').trim();
      if (words) return cap(words);
    }
    return '';
  }

  // ── Rundown words ─────────────────────────────────────────────────────
  var BEAT_FIELD_WORDS = {
    style: 'Row type', info: 'Row name', notes: 'Notes', min: 'Timing', sec: 'Timing',
    done: 'Done check', color: 'Row color', helperFor: 'Helper row', helperRole: 'Helper row'
  };
  var CUE_WORDS = {
    video: 'Video cue', audio: 'Audio cue', playback: 'Playback cue', gfx: 'GFX cue',
    lighting: 'Lighting cue', script: 'Script cue'
  };

  function rowWord(beats, id, fallbackBeat) {
    var list = Array.isArray(beats) ? beats : [];
    var idx = -1;
    for (var i = 0; i < list.length; i++) { if (String(list[i] && list[i].id) === String(id)) { idx = i; break; } }
    var beat = idx >= 0 ? list[idx] : fallbackBeat;
    var name = String(beat && beat.info || '').trim();
    var head = idx >= 0 ? 'Row ' + (idx + 1) : 'Row';
    return name ? head + ' "' + name.slice(0, 40) + '"' : head;
  }

  // Words for one saved rundown batch: what rows were added, removed or
  // changed and which cells. `after` is the rundown after the save, `before`
  // the one before it (for the names of removed rows).
  function rundownChangeLabels(batch, after, before) {
    var out = [];
    if (!isObj(batch)) return out;
    (batch.additions || []).forEach(function (beat) {
      out.push('Added ' + rowWord(after, beat && beat.id, beat));
    });
    (batch.patches || []).forEach(function (item) {
      if (!item || !isObj(item.patch)) return;
      var parts = [];
      Object.keys(item.patch).forEach(function (key) {
        if (key === 'cues') {
          Object.keys(item.patch.cues || {}).forEach(function (type) {
            var w = CUE_WORDS[type] || (type.charAt(0).toUpperCase() + type.slice(1) + ' cue');
            if (parts.indexOf(w) === -1) parts.push(w);
          });
          return;
        }
        if (key.charAt(0) === '_') return;
        var word = BEAT_FIELD_WORDS[key];
        if (word && parts.indexOf(word) === -1) parts.push(word);
      });
      if (parts.length) out.push(rowWord(after, item.id) + ': ' + parts.join(', '));
    });
    (batch.removals || []).forEach(function (id) {
      out.push('Removed ' + rowWord(before, id));
    });
    if (batch.order) out.push('Moved rows');
    var showPatch = isObj(batch.showPatch) ? batch.showPatch : {};
    if (Object.prototype.hasOwnProperty.call(showPatch, 'showName')) out.push('Show name');
    if (Object.prototype.hasOwnProperty.call(showPatch, 'startTime')) out.push('Show start time');
    if (Object.prototype.hasOwnProperty.call(showPatch, 'freeMode')) out.push('Free text mode');
    return out;
  }

  // ── Buffered entries ──────────────────────────────────────────────────
  // Typing across a page makes one save per field; the record keeps one entry
  // per page per short while, with every field touched on it. This merges a
  // new touch into a pending entry (same kind + section + ref).
  function mergePending(pending, touch) {
    var fields = Array.isArray(touch.fields) ? touch.fields : [];
    if (!pending) {
      return {
        kind: touch.kind, section: touch.section || '', page: touch.page || '', ref: touch.ref || '',
        fields: uniqueStrings(fields).slice(0, FIELDS_PER_ENTRY), text: touch.text || '',
        at: touch.at, firstAt: touch.at, n: 1
      };
    }
    pending.fields = uniqueStrings(pending.fields.concat(fields)).slice(0, FIELDS_PER_ENTRY);
    pending.at = Math.max(pending.at, touch.at);
    pending.n += 1;
    if (!pending.text && touch.text) pending.text = touch.text;
    return pending;
  }

  function uniqueStrings(list) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (s) {
      var v = String(s == null ? '' : s).trim();
      if (!v || seen[v]) return;
      seen[v] = true;
      out.push(v);
    });
    return out;
  }

  function entryFromPending(p) {
    return normalizeEntry({ at: p.at, kind: p.kind, section: p.section, page: p.page, fields: p.fields, text: p.text, n: p.n });
  }

  function trimEntries(entries, cap, keep) {
    cap = typeof cap === 'number' ? cap : ENTRY_CAP;
    keep = typeof keep === 'number' ? keep : ENTRY_KEEP;
    var list = (Array.isArray(entries) ? entries : []).map(normalizeEntry).filter(Boolean)
      .sort(function (a, b) { return a.at - b.at; });
    if (list.length <= cap) return { entries: list, trimmed: 0 };
    return { entries: list.slice(list.length - keep), trimmed: list.length - keep };
  }

  // ── Other sources ─────────────────────────────────────────────────────
  // The show's "Who worked on what" log: one entry per page visit, section
  // level, with field words when the newer client wrote them.
  function entriesFromActivityLog(log, name) {
    var key = nameKey(name);
    if (!key) return [];
    var noteSections = /^(Production Note|To-Do|Checklist|Note Pinned|Note Unpinned)/i;
    return (Array.isArray(log) ? log : []).filter(function (e) {
      return e && nameKey(e.by) === key && Number(e.at) && e.section && !noteSections.test(String(e.section));
    }).map(function (e) {
      return normalizeEntry({ at: e.at, kind: e.section === 'Role Assignments' || e.section === 'Positions' ? 'assignment' : 'paperwork',
        section: e.section, fields: e.fields, source: 'log' });
    }).filter(Boolean);
  }

  // Production notes: what this person posted, replied, finished.
  function entriesFromNotes(notes, name) {
    var key = nameKey(name);
    if (!key) return [];
    var out = [];
    var list = Array.isArray(notes) ? notes : [];
    var byId = {};
    list.forEach(function (n) { if (n && n.id) byId[n.id] = n; });
    var snippet = function (t) { return String(t || '').replace(/\s+/g, ' ').trim().slice(0, 140); };
    list.forEach(function (n) {
      if (!n) return;
      var mine = nameKey(n.by) === key;
      if (mine && Number(n.at)) {
        var kind = n.replyTo ? 'reply' : (n.tag === 'todo' ? 'todo' : 'note');
        var parent = n.replyTo ? byId[n.replyTo] : null;
        out.push(normalizeEntry({ at: n.at, kind: kind, section: 'Production Notes', text: snippet(n.text),
          fields: parent ? ['Reply to ' + (parent.by || 'a note')] : [], source: 'notes' }));
        if (Number(n.editedAt) && n.editedAt > n.at + 60000) {
          out.push(normalizeEntry({ at: n.editedAt, kind: 'note-edit', section: 'Production Notes', text: snippet(n.text), source: 'notes' }));
        }
      }
      if (n.tag === 'todo' && n.done && nameKey(n.doneBy) === key && Number(n.doneAt)) {
        out.push(normalizeEntry({ at: n.doneAt, kind: 'todo-done', section: 'Production Notes', text: snippet(n.text), source: 'notes' }));
      }
      (Array.isArray(n.checklist) ? n.checklist : []).forEach(function (it) {
        if (it && it.done && nameKey(it.doneBy) === key && Number(it.doneAt)) {
          out.push(normalizeEntry({ at: it.doneAt, kind: 'checklist', section: 'Production Notes', text: snippet(it.text),
            fields: n.text ? ['On: ' + snippet(n.text).slice(0, 60)] : [], source: 'notes' }));
        }
      });
    });
    return out.filter(Boolean);
  }

  // One list, newest first. A log entry that the richer record already
  // covers (same section, within two minutes) is dropped; a note entry that
  // the record already holds (same kind, same minute) is dropped too.
  function mergeTimeline(recordEntries, logEntries, noteEntries) {
    var rec = (Array.isArray(recordEntries) ? recordEntries : []).map(normalizeEntry).filter(Boolean);
    var log = (Array.isArray(logEntries) ? logEntries : []).map(normalizeEntry).filter(Boolean);
    var notes = (Array.isArray(noteEntries) ? noteEntries : []).map(normalizeEntry).filter(Boolean);
    var keepLog = log.filter(function (e) {
      return !rec.some(function (r) {
        return (r.kind === 'paperwork' || r.kind === 'assignment') && r.section === e.section && Math.abs(r.at - e.at) <= MERGE_WINDOW_MS;
      });
    });
    var noteKinds = { note: 1, reply: 1, todo: 1, 'todo-done': 1, checklist: 1, 'note-edit': 1, 'note-removed': 1 };
    var keepRec = rec.filter(function (r) {
      if (!noteKinds[r.kind]) return true;
      return !notes.some(function (n) { return n.kind === r.kind && Math.abs(n.at - r.at) <= MERGE_WINDOW_MS; });
    });
    return keepRec.concat(keepLog, notes).sort(function (a, b) { return b.at - a.at; });
  }

  function groupByDay(entries) {
    var groups = {};
    var order = [];
    (Array.isArray(entries) ? entries : []).forEach(function (e) {
      var key = dayKey(e.at);
      if (!groups[key]) { groups[key] = { key: key, date: dayKeyToDate(key), entries: [] }; order.push(key); }
      groups[key].entries.push(e);
    });
    return order.sort().reverse().map(function (k) { return groups[k]; });
  }

  function summary(timeline, days) {
    var dayRows = summarizeDays(days);
    var minutes = 0;
    dayRows.forEach(function (d) { minutes += d.minutes; });
    var fields = {};
    var counts = { notes: 0, replies: 0, todosPosted: 0, todosDone: 0, checklistDone: 0, takes: 0, rundownChanges: 0, paperworkEntries: 0 };
    (Array.isArray(timeline) ? timeline : []).forEach(function (e) {
      if (e.kind === 'paperwork' || e.kind === 'assignment') {
        counts.paperworkEntries += 1;
        e.fields.forEach(function (f) { fields[e.section + '|' + f] = true; });
      } else if (e.kind === 'rundown') {
        counts.rundownChanges += e.fields.length || 1;
      } else if (e.kind === 'live') {
        counts.takes += e.fields.length || 1;
      } else if (e.kind === 'note') counts.notes += 1;
      else if (e.kind === 'reply') counts.replies += 1;
      else if (e.kind === 'todo') counts.todosPosted += 1;
      else if (e.kind === 'todo-done') counts.todosDone += 1;
      else if (e.kind === 'checklist') counts.checklistDone += 1;
    });
    return {
      minutes: minutes,
      daysActive: dayRows.filter(function (d) { return d.minutes > 0; }).length,
      firstSeen: dayRows.length ? dayRows[0].first : 0,
      lastSeen: dayRows.length ? dayRows[dayRows.length - 1].last : 0,
      fieldsTouched: Object.keys(fields).length,
      notes: counts.notes,
      replies: counts.replies,
      todosPosted: counts.todosPosted,
      todosDone: counts.todosDone,
      checklistDone: counts.checklistDone,
      takes: counts.takes,
      rundownChanges: counts.rundownChanges,
      paperworkEntries: counts.paperworkEntries,
      days: dayRows
    };
  }

  function kindLabel(kind) {
    return KIND_LABELS[kind] || String(kind || '').replace(/-/g, ' ');
  }

  function formatMinutes(min) {
    min = Math.max(0, Math.floor(Number(min) || 0));
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return h + ' h' + (m ? ' ' + m + ' min' : '');
  }

  return Object.freeze({
    SCHEMA: SCHEMA,
    ENTRY_CAP: ENTRY_CAP,
    ENTRY_KEEP: ENTRY_KEEP,
    FIELDS_PER_ENTRY: FIELDS_PER_ENTRY,
    LOG_FIELDS_CAP: LOG_FIELDS_CAP,
    SITTING_GAP_MIN: SITTING_GAP_MIN,
    KIND_LABELS: KIND_LABELS,
    WHERE_LABELS: WHERE_LABELS,
    nameKey: nameKey,
    safeKey: safeKey,
    dayKey: dayKey,
    dayKeyToDate: dayKeyToDate,
    minuteOfDay: minuteOfDay,
    tickTime: tickTime,
    docId: docId,
    emptyRecord: emptyRecord,
    normalizeRecord: normalizeRecord,
    normalizeEntry: normalizeEntry,
    sittings: sittings,
    summarizeDays: summarizeDays,
    whereLabel: whereLabel,
    describeField: describeField,
    rundownChangeLabels: rundownChangeLabels,
    mergePending: mergePending,
    entryFromPending: entryFromPending,
    uniqueStrings: uniqueStrings,
    trimEntries: trimEntries,
    entriesFromActivityLog: entriesFromActivityLog,
    entriesFromNotes: entriesFromNotes,
    mergeTimeline: mergeTimeline,
    groupByDay: groupByDay,
    summary: summary,
    kindLabel: kindLabel,
    formatMinutes: formatMinutes
  });
});
