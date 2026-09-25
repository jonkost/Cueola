// Cueola 3.0 cue model: one type per cue, a minimal field set per type, one
// derived "call line", and the migration that turns every pre-3.0 cell into it.
// Pure: no DOM, no globals. Loaded as a browser global (window.CueolaCueModel)
// and as a CommonJS module for the node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaCueModel = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const SCHEMA = 3;   // cell._v after migration

  // Storage key per type. Data stays under beat.cues.{cell} so exports, the
  // prompter, playback links and older readers keep working.
  const TYPES = [
    { id: 'camera',   cell: 'video',    label: 'Camera',   short: 'CAM',   color: 'var(--cue-video)',    symbol: 'department.video',    blurb: 'A camera shot' },
    { id: 'audio',    cell: 'audio',    label: 'Audio',    short: 'AUDIO', color: 'var(--cue-audio)',    symbol: 'department.audio',    blurb: 'A mic or music change' },
    { id: 'graphic',  cell: 'gfx',      label: 'Graphic',  short: 'GFX',   color: 'var(--cue-gfx)',      symbol: 'department.graphics', blurb: 'Something on screen' },
    { id: 'playback', cell: 'playback', label: 'Playback', short: 'PLAY',  color: 'var(--cue-playback)', symbol: 'department.playback', blurb: 'A clip that rolls' },
    { id: 'lighting', cell: 'lighting', label: 'Lighting', short: 'LX',    color: 'var(--cue-lighting)', symbol: 'department.lighting', blurb: 'A lighting look' },
    { id: 'script',   cell: 'script',   label: 'Script',   short: 'SCRIPT', color: 'var(--cue-script)',  symbol: 'department.script',   blurb: 'What the talent says' },
  ];
  const TYPE_BY_ID = Object.fromEntries(TYPES.map(t => [t.id, t]));
  const TYPE_BY_CELL = Object.fromEntries(TYPES.map(t => [t.cell, t]));
  const SEGMENT = { id: 'segment', cell: '', label: 'Segment', short: 'SEG', color: 'var(--yellow)', symbol: 'content.segment', blurb: 'A section title. Cannot be taken.' };

  const SHOTS = ['Wide', 'Medium', 'CU', 'ECU', '2-shot', 'OTS', 'POV'];
  const AUDIO_ACTIONS = [
    { v: 'on',    label: 'On' },
    { v: 'off',   label: 'Off' },
    { v: 'under', label: 'Under' },
    { v: 'up',    label: 'Up' },
  ];
  const GRAPHIC_NAMES = ['Lower third', 'Full screen', 'Bug', 'Credits'];

  // Per-type fields. `primary` fields sit at the top of the expanded cue;
  // the rest are behind "More". `help` is the ⓘ text (one or two breaths).
  const FIELDS = {
    camera: [
      { key: 'camera', label: 'Camera', kind: 'text', primary: true, placeholder: 'CAM 1', suggest: ['CAM 1', 'CAM 2', 'CAM 3', 'CAM 4'], help: 'Which camera goes on air when this cue is taken.' },
      { key: 'shot',   label: 'Shot',   kind: 'choice', primary: true, options: SHOTS, help: 'How the camera is framed. Wide shows the whole space; CU (close-up) is one face.' },
    ],
    audio: [
      { key: 'source', label: 'Source', kind: 'text', primary: true, placeholder: 'Host mic', suggest: ['Host mic', 'Guest mic', 'Music', 'Playback audio'], help: 'The mic or music this cue changes.' },
      { key: 'action', label: 'Action', kind: 'choice', primary: true, options: AUDIO_ACTIONS, help: 'On opens it. Off closes it. Under keeps it quiet beneath voices. Up brings it to full.' },
      { key: 'level',  label: 'Level',  kind: 'text', placeholder: 'e.g. -10 dB or 60%', help: 'Only when the level matters. Leave blank for the usual level.' },
    ],
    graphic: [
      { key: 'name', label: 'Graphic', kind: 'text', primary: true, placeholder: 'Lower third', suggest: GRAPHIC_NAMES, help: 'The kind of graphic: a lower third, a full screen, a bug in the corner.' },
      { key: 'text', label: 'On-screen text', kind: 'text', primary: true, placeholder: 'Jane Doe · Student Council', help: 'The words the audience reads on the graphic.' },
      { key: 'hold', label: 'Seconds on screen', kind: 'number', min: 0, max: 600, help: 'How long the graphic stays up. Blank means until the next cue takes it off.' },
    ],
    playback: [
      { key: 'clip', label: 'Clip', kind: 'text', primary: true, placeholder: 'OPEN.mp4', help: 'The clip that rolls. Link a playback cue below and it rolls by itself on TAKE.' },
      { key: 'in',   label: 'In',  kind: 'text', placeholder: '0:00', help: 'Where in the clip to start. Blank starts at the top.' },
      { key: 'out',  label: 'Out', kind: 'text', placeholder: '1:30', help: 'Where in the clip to stop. Blank plays to the end.' },
      { key: 'preRoll', label: 'Pre-roll (seconds)', kind: 'number', min: 0, max: 60, help: 'A countdown before the clip is on air. Everyone sees the count. 0 rolls at once.' },
      { key: 'audioFromClip', label: 'Audio from the clip', kind: 'toggle', help: 'The clip’s own sound goes to air. Off means the mix stays on the mics or music.' },
      { key: 'autoAdvance', label: 'Next cue when the clip ends', kind: 'toggle', help: 'When the clip finishes, the next cue is taken by itself.' },
    ],
    lighting: [
      { key: 'look', label: 'Look', kind: 'text', primary: true, placeholder: 'Warm wash', suggest: ['Warm wash', 'Desk key', 'House up', 'Blackout'], help: 'The lighting look or board cue this cue goes to.' },
    ],
    script: [
      { key: 'text', label: 'Script', kind: 'textarea', primary: true, placeholder: 'What the talent reads.', help: 'The words the talent reads. This is what shows big on the prompter.' },
      { key: 'speaker', label: 'Speaker', kind: 'text', placeholder: 'Host', help: 'Who reads it.' },
    ],
  };

  const str = v => (v == null ? '' : String(v)).trim();
  const clean = v => str(v).replace(/\s+/g, ' ');

  function typeDef(id) { return id === 'segment' ? SEGMENT : (TYPE_BY_ID[id] || null); }
  function cellKey(typeId) { return TYPE_BY_ID[typeId]?.cell || ''; }
  function typeForCell(cell) { return TYPE_BY_CELL[cell]?.id || ''; }
  function fields(typeId) { return FIELDS[typeId] || []; }

  function fmtClock(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return `${h ? h + ':' : ''}${mm}:${String(r).padStart(2, '0')}`;
  }
  function durationSeconds(beat) { return (Number(beat?.min) || 0) * 60 + (Number(beat?.sec) || 0); }
  function formatDuration(beat) { const s = durationSeconds(beat); return s ? fmtClock(s) : ''; }

  function firstLine(text, max = 70) {
    const line = str(text).split('\n').map(l => l.trim()).find(Boolean) || '';
    const plain = line.replace(/\*\*|__|\[[^\]]*\]/g, '').trim();
    return plain.length > max ? plain.slice(0, max - 1).trimEnd() + '…' : plain;
  }

  // The one line the rundown, Live and the export show for a cell.
  function callLine(typeId, cell) {
    const d = cell || {};
    let line = '';
    switch (typeId) {
      case 'camera':   line = [clean(d.camera), clean(d.shot)].filter(Boolean).join(' · '); break;
      case 'audio': {
        const act = AUDIO_ACTIONS.find(a => a.v === d.action);
        line = [clean(d.source), act ? act.label.toLowerCase() : '', clean(d.level)].filter(Boolean).join(' ');
        break;
      }
      case 'graphic':  line = clean(d.name) + (clean(d.text) ? `${clean(d.name) ? ': ' : ''}${clean(d.text)}` : ''); break;
      case 'playback': {
        const clip = clean(d.clip) || clean(d.outCueName);
        const range = [clean(d.in), clean(d.out)].filter(Boolean).join('–');
        line = clip ? `Roll ${clip}${range ? ` · ${range}` : ''}` : '';
        break;
      }
      case 'lighting': line = clean(d.look); break;
      case 'script':   line = firstLine(d.text) || (clean(d.speaker) ? `Cue ${clean(d.speaker)}` : ''); break;
      default: line = '';
    }
    // Free-text cells (Blank Slate) carry their line in `on` with no fields.
    return line || (d._v === SCHEMA ? str(d.on) : '');
  }

  function isCellEmpty(typeId, cell) {
    if (!cell) return true;
    if (callLine(typeId, cell)) return false;
    if (typeId === 'playback' && (cell.outCueId || cell.outCueName || cell.outPadId)) return false;
    if (typeId === 'audio' && (cell.outPadId || cell.outPadName)) return false;
    return !str(cell.notes);
  }

  // Which type a pre-3.0 beat is, by what it holds (playback first: a row that
  // rolls a clip is a playback cue however many other calls ride along).
  const INFER_ORDER = ['playback', 'video', 'gfx', 'audio', 'lighting', 'script'];
  function hasContent(cellKeyName, cell) {
    if (!cell || typeof cell !== 'object') return false;
    return Boolean(str(cell.on) || str(cell.off) || str(cell.ready) || str(cell.take) || str(cell.text) || str(cell.dialogueNote)
      || str(cell.clip) || cell.outCueId || cell.outCueName || cell.outPadId || str(cell.gfxContent) || str(cell.look) || str(cell.camera)
      || str(cell.source) || str(cell.name) || (cellKeyName === 'script' && str(cell.speaker)));
  }
  function inferType(beat) {
    if (beat?.style === 'segment') return 'segment';
    if (TYPE_BY_ID[beat?.type]) return beat.type;
    const cues = beat?.cues || {};
    for (const key of INFER_ORDER) if (hasContent(key, cues[key])) return typeForCell(key);
    return str(beat?.notes) && !Object.keys(cues).length ? 'script' : 'camera';
  }
  function beatType(beat) { return inferType(beat); }

  // ── Migration ──────────────────────────────────────────────────────────────
  const LINK_KEYS = ['outCueId', 'outAuto', 'outCueName', 'outPadId', 'outPadAuto', 'outPadName'];

  function parseCamera(on) {
    const m = str(on).match(/^(?:Ready|Standby|Set with Media Wipe|Set)\s+(.+?)(?:\s+·\s+(.+))?$/i);
    if (m) return { camera: m[1].trim(), shot: (m[2] || '').trim() };
    const plain = str(on).match(/^(.+?)\s+·\s+(.+)$/);
    if (plain && SHOTS.some(s => s.toLowerCase() === plain[2].trim().toLowerCase())) return { camera: plain[1].trim(), shot: plain[2].trim() };
    return { camera: str(on), shot: '' };
  }
  function parseAudio(on) {
    const text = str(on);
    let m;
    if ((m = text.match(/^Open Mics?\s*(?:·\s*)?(.*)$/i))) return { source: m[1].trim() || 'Mics', action: 'on' };
    if ((m = text.match(/^(?:Close Mics?|Mics? Out)\s*(?:·\s*)?(.*)$/i))) return { source: m[1].trim() || 'Mics', action: 'off' };
    if ((m = text.match(/^Track\s+(.+)$/i))) return { source: m[1].trim(), action: 'under' };
    if ((m = text.match(/^(?:Fade In|Play|Fire)\s*(?:·\s*)?(.*)$/i))) return { source: m[1].trim() || 'Music', action: 'up' };
    if ((m = text.match(/^(?:Ready|Standby)\s+(.+)$/i))) return { source: m[1].trim(), action: '' };
    if ((m = text.match(/^(.+?)\s+(Up|Under|On|Off)$/i))) return { source: m[1].trim(), action: m[2].toLowerCase() };
    return { source: text, action: '' };
  }
  function parseGraphic(d) {
    const on = str(d.on);
    let name = str(d.customType), text = str(d.gfxContent);
    const m = on.match(/^(?:Ready|Standby|Set|Take|Dissolve)\s+(.+?)(?:\s*\((.+)\))?$/i);
    if (!name) name = m ? m[1].trim() : on;
    if (!text && m && m[2]) text = m[2].trim();
    // "Lower 3rd · Jane" style: the part after the dot is the on-screen text.
    const dot = name.match(/^(.+?)\s+·\s+(.+)$/);
    if (dot && !text) { name = dot[1].trim(); text = dot[2].trim(); }
    return { name, text };
  }
  function parsePlayback(d) {
    const on = str(d.on);
    let clip = str(d.clip) || str(d.outCueName);
    if (!clip) {
      const m = on.match(/^(?:Ready|Roll|Standby|Take)\s+(.+?)(?:\s+·\s+\d+:\d\d\s*TRT)?(?:\s*\[.*\])?$/i);
      clip = m ? m[1].trim() : on;
    }
    const trt = (parseInt(d.trtMin, 10) || 0) * 60 + (parseInt(d.trtSec, 10) || 0);
    return { clip, trt };
  }
  function parseLighting(d) {
    const on = str(d.on);
    if (str(d.lightingGoCue)) return `Cue ${str(d.lightingGoCue)}`;
    if (str(d.lightingGoFeature)) return str(d.lightingGoFeature);
    const m = on.match(/^(?:Ready|Standby|Go(?: to)?|At)\s+(.+)$/i);
    return m ? m[1].trim() : on;
  }
  function parseScriptSpeaker(d) {
    const on = str(d.on);
    if (str(d.speaker)) return str(d.speaker);
    if (str(d.customSrc)) return str(d.customSrc);
    if (str(d.who)) return str(d.who);
    const m = on.match(/^(?:Standby|Cue|Ready)\s+(.+?)(?:\s+·\s+.+)?$/i) || on.match(/^(.+?)\s+·\s+(?:Begin|Cue|Go)$/i);
    return m ? m[1].trim() : '';
  }

  // Migrate one department cell. Returns the new cell; anything the parser
  // cannot place lands in the cell's notes with its old label.
  function migrateCell(cellKeyName, raw) {
    if (!raw || typeof raw !== 'object') return raw;
    if (raw._v === SCHEMA) return raw;
    const typeId = typeForCell(cellKeyName);
    if (!typeId) return raw;
    const d = raw;
    const on = str(d.on !== undefined ? d.on : d.take);
    const off = str(d.off !== undefined ? d.off : d.ready);
    const notes = [];
    const out = { _v: SCHEMA };
    switch (typeId) {
      case 'camera': {
        const p = parseCamera(on);
        out.camera = p.camera; out.shot = p.shot;
        if (off && !/^Take\s+/i.test(off)) notes.push(`Then: ${off}`);
        break;
      }
      case 'audio': {
        const p = parseAudio(on);
        out.source = p.source; out.action = p.action; out.level = '';
        if (off) notes.push(`Then: ${off}`);
        break;
      }
      case 'graphic': {
        const p = parseGraphic(d);
        out.name = p.name; out.text = p.text; out.hold = '';
        if (d.isAnimated) notes.push('Animated');
        if (off) notes.push(`Then: ${off}`);
        break;
      }
      case 'playback': {
        const p = parsePlayback(d);
        out.clip = p.clip; out.in = ''; out.out = '';
        out.preRoll = Number.isFinite(Number(d.preRoll)) ? Math.max(0, Math.round(Number(d.preRoll))) : (d.outAuto ? 3 : 0);
        out.audioFromClip = d.audioFromClip === undefined ? true : Boolean(d.audioFromClip);
        out.autoAdvance = Boolean(d.autoAdvance);
        if (p.trt) out._trt = p.trt;   // consumed by migrateBeat (cue duration), then dropped
        if (str(d.smpte)) notes.push(`Timecode: ${str(d.smpte)}`);
        if (off) notes.push(`Then: ${off}`);
        break;
      }
      case 'lighting': {
        out.look = parseLighting(d);
        [['intensity', 'Intensity'], ['color', 'Color'], ['gobo', 'Gobo'], ['lightingDetail', 'Detail'], ['lightingOffGoFeature', 'Then'], ['lightingOffGoCue', 'Then cue']]
          .forEach(([k, label]) => { if (str(d[k])) notes.push(`${label}: ${str(d[k])}`); });
        if (off) notes.push(`Then: ${off}`);
        break;
      }
      case 'script': {
        const dialogue = d.scriptType === 'Dialogue';
        out.text = dialogue ? (str(d.dialogueNote) ? `(unscripted) ${str(d.dialogueNote)}` : str(d.text)) : str(d.text || d.dialogueNote);
        out.speaker = parseScriptSpeaker(d);
        if (Array.isArray(d.scriptTags) && d.scriptTags.length) notes.push(`Tags: ${d.scriptTags.join(', ')}`);
        if (on && !out.speaker) notes.push(`Ready: ${on}`);
        break;
      }
    }
    LINK_KEYS.forEach(k => { if (d[k] !== undefined) out[k] = d[k]; });
    if (str(d.notes)) notes.unshift(str(d.notes));
    out.notes = notes.join('\n');
    out.on = callLine(typeId, out);
    // A hand-typed line the parser could not read survives as the call line.
    if (!out.on && on) { out.on = on; }
    return out;
  }

  // Migrate a whole beat: every department cell, plus `type`. Idempotent.
  function migrateBeat(beat) {
    if (!beat || typeof beat !== 'object') return beat;
    const next = { ...beat };
    const cues = {};
    Object.keys(beat.cues || {}).forEach(key => {
      const cell = migrateCell(key, beat.cues[key]);
      if (cell && cell._trt !== undefined) {
        if (!durationSeconds(next)) { next.min = Math.floor(cell._trt / 60); next.sec = cell._trt % 60; }
        const { _trt, ...rest } = cell;
        cues[key] = rest;
      } else cues[key] = cell;
    });
    next.cues = cues;
    if (next.style !== 'segment' && !TYPE_BY_ID[next.type]) next.type = inferType(next);
    // "Timed" vs "flex" never meant anything at run time; in 3.0 the style
    // simply follows the duration (blank = no fixed time).
    if (next.style === 'segment') delete next.type;
    else next.style = durationSeconds(next) ? 'timed' : 'flex';
    delete next.done;
    return next;
  }

  // Write a structured field on a cell and keep its call line current.
  function setField(typeId, cell, key, value) {
    const out = { ...(cell || {}), _v: SCHEMA };
    out[key] = value;
    out.on = callLine(typeId, out);
    return out;
  }

  function newCell(typeId) {
    const out = { _v: SCHEMA, notes: '' };
    fields(typeId).forEach(f => { out[f.key] = f.kind === 'toggle' ? (f.key === 'audioFromClip') : ''; });
    if (typeId === 'playback') out.preRoll = 0;
    out.on = '';
    return out;
  }

  function newBeat({ id, type, name, min = 0, sec = 0, notes = '', createdAt, createdBy } = {}) {
    if (type === 'segment') {
      return { id, style: 'segment', info: str(name), notes: str(notes), min: 0, sec: 0, cues: {}, _createdAt: createdAt, _createdBy: createdBy };
    }
    const t = TYPE_BY_ID[type] ? type : 'camera';
    const cues = {};
    cues[cellKey(t)] = newCell(t);
    const m = Math.max(0, parseInt(min, 10) || 0), s = Math.max(0, Math.min(59, parseInt(sec, 10) || 0));
    return { id, type: t, style: (m || s) ? 'timed' : 'flex', info: str(name), notes: str(notes), min: m, sec: s, cues, _createdAt: createdAt, _createdBy: createdBy };
  }

  // Every department with content on a beat, primary type first.
  function callsForBeat(beat) {
    const primary = beatType(beat);
    const out = [];
    const seen = new Set();
    const push = typeId => {
      const cell = beat?.cues?.[cellKey(typeId)];
      if (seen.has(typeId) || isCellEmpty(typeId, cell)) return;
      seen.add(typeId);
      out.push({ type: typeId, cell, line: callLine(typeId, cell) });
    };
    if (primary !== 'segment') push(primary);
    TYPES.forEach(t => push(t.id));
    return out;
  }

  function summary(beat) {
    const type = beatType(beat);
    const cell = type === 'segment' ? null : beat?.cues?.[cellKey(type)];
    return { type, name: str(beat?.info), duration: formatDuration(beat), line: type === 'segment' ? '' : callLine(type, cell), extras: callsForBeat(beat).filter(c => c.type !== type).map(c => c.type) };
  }

  return Object.freeze({
    SCHEMA, TYPES, SEGMENT, FIELDS, SHOTS, AUDIO_ACTIONS, GRAPHIC_NAMES,
    typeDef, cellKey, typeForCell, fields,
    callLine, isCellEmpty, inferType, beatType, callsForBeat, summary,
    migrateCell, migrateBeat, setField, newCell, newBeat,
    durationSeconds, formatDuration, fmtClock, firstLine,
  });
});
