/* Cueola prompter engine.
 *
 * The talent screen's motion and row model, with no DOM in it so it can be
 * tested in Node. Two parts:
 *
 *   1. createMotion(): ONE scroll position with ONE velocity. The free run
 *      (the crawl), a row cue (glide to a spot) and the dial (jog by a few
 *      lines) all move the same number through the same step(). Before this
 *      the talent screen had three movers that cancelled each other, and the
 *      hand-offs between them were the jumps the talent saw on every TAKE.
 *      A cue or a jog sets a target; a critically damped spring carries the
 *      position there with the velocity continuous the whole way, and while
 *      the crawl is on the target itself drifts at the crawl speed, so the
 *      copy keeps rolling right through a cue and out the other side.
 *
 *   2. parseRows() / diffRows(): the script as rundown rows ([N] headers),
 *      so a push only touches the rows whose words changed. The old screen
 *      rebuilt every line on every TAKE and then tried to put the read line
 *      back where it was.
 *
 * Speed is in pixels per second. The old app's speed number (5 to 200) is
 * also pixels per second: at 60 it moved one pixel per 60 Hz frame.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaPrompterEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SPEED_MIN = 5;
  var SPEED_MAX = 200;
  var BRAKE_FACTOR = 0.25;    // held brake: a quarter speed, never below 2 px/s
  var BOOST_FACTOR = 2.5;     // held boost: two and a half times, capped at 300
  var BOOST_CAP = 300;
  var HOLD_FACTOR = 2.5;      // held Back or Ahead: two and a half times the speed,
  var HOLD_MIN = 120;         // never slower than this, so a slow roll still shuttles
  var HOLD_CAP = 300;
  var EASE_MS = 270;          // the crawl's ramp to a new speed (and from 0 at play)
  var JOG_OMEGA = 30;         // dial stiffness: settles in about a fifth of a second
  var LAND_PX = 0.5;
  var LAND_VEL = 2;
  var STEP_CAP_MS = 100;      // a frame after a stall never applies more than this

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function finite(n, fallback) { var v = Number(n); return Number.isFinite(v) ? v : fallback; }

  // How long a cue takes, from how far it travels: short hops stay quick and
  // long jumps stay readable (550 ms to 2 s, the timing the talent is used to).
  function cueDurationMs(distancePx) {
    return clamp(450 + Math.abs(distancePx) * 0.8, 550, 2000);
  }

  function createMotion(options) {
    options = options || {};
    var s = {
      pos: Math.max(0, finite(options.pos, 0)),
      vel: 0,
      max: Math.max(0, finite(options.max, 0)),
      speed: clamp(finite(options.speed, 60), SPEED_MIN, SPEED_MAX),
      rolling: false,
      brake: false,
      boost: false,
      reverse: false,
      dir: '',       // 'back' | 'ahead' while that control is held
      target: null   // { to, omega, kind } while travelling
    };

    // The speed the crawl wants right now, with the held modifiers applied.
    function cruise() {
      // Back and Ahead move the copy while held, rolling or paused. Let go
      // and the screen is back to whatever it was doing: rolling or still.
      if (s.dir) {
        var h = clamp(s.speed * HOLD_FACTOR, HOLD_MIN, HOLD_CAP);
        return s.dir === 'back' ? -h : h;
      }
      if (!s.rolling) return 0;
      var v = s.speed;
      if (s.brake) v = Math.max(v * BRAKE_FACTOR, 2);
      else if (s.boost) v = Math.min(v * BOOST_FACTOR, BOOST_CAP);
      return s.reverse ? -v : v;
    }

    function clampPos(p) { return clamp(p, 0, s.max); }

    function setMax(max) {
      s.max = Math.max(0, finite(max, 0));
      s.pos = clampPos(s.pos);
      if (s.target) s.target.to = clampPos(s.target.to);
      return s.max;
    }

    function setSpeed(speed) {
      s.speed = clamp(finite(speed, s.speed), SPEED_MIN, SPEED_MAX);
      // Paused: the next play starts at the set speed; rolling: step() eases.
      return s.speed;
    }

    function roll(on) {
      s.rolling = on !== false;
      return s.rolling;
    }

    function hold(name, on) {
      if (name === 'brake') s.brake = !!on;
      else if (name === 'boost') s.boost = !!on;
      else if (name === 'reverse') s.reverse = !!on;
      else if (name === 'back' || name === 'ahead') {
        if (on) s.dir = name;
        else if (s.dir === name) s.dir = '';
      } else if (name === 'off') s.dir = '';
    }

    // A cue: travel to a spot over a set time with an ease in and out, the
    // way a camera move reads: a gentle start, a readable middle, a soft
    // landing. The curve is planned from the position AND the velocity the
    // screen has right now, so a second cue landing mid-travel bends the path
    // instead of restarting it, and it ends at the crawl speed, so the roll
    // carries straight on. (A spring would kick on the first frame; the
    // dial below keeps the spring because the dial wants to feel immediate.)
    function moveTo(to, opts) {
      opts = opts || {};
      var dest = clampPos(finite(to, s.pos));
      if (opts.kind === 'jog') return moveByJog(dest - (s.target ? s.target.to : s.pos));
      var dist = dest - s.pos;
      var dur = cueDurationMs(dist) / 1000;
      s.target = { kind: 'cue', to: dest, from: s.pos, v0: s.vel, dur: dur, t: 0 };
      return dest;
    }

    // The dial: a critically damped spring toward a target that each turn
    // moves a little further, from where the screen is HEADED, so a held
    // turn reads as one continuous scroll instead of a run of small snaps.
    function moveByJog(delta) {
      var base = s.target ? s.target.to : s.pos;
      var dest = clampPos(base + finite(delta, 0));
      if (s.target && s.target.kind === 'jog') s.target.to = dest;
      else s.target = { kind: 'jog', to: dest, omega: JOG_OMEGA };
      return dest;
    }
    function moveBy(delta) { return moveByJog(delta); }

    // A hard set (the position slider, a seed from the operator): no travel.
    function jumpTo(pos) {
      s.target = null;
      s.pos = clampPos(finite(pos, s.pos));
      s.vel = cruise();
      return s.pos;
    }

    // The copy itself moved (a text size change, a push, a window resize):
    // carry the position and any travel with it so the line under the read
    // line stays put.
    function shift(delta) {
      var d = finite(delta, 0);
      s.pos = clampPos(s.pos + d);
      if (s.target) s.target.to = clampPos(s.target.to + d);
      return s.pos;
    }

    // Where the talent is provably headed: mid-travel that is the target.
    function reportedPos() { return s.target ? s.target.to : s.pos; }

    function travelling() { return !!s.target; }

    // One frame. dtMs is real elapsed time; a stall (hidden window) is capped
    // so the first frame back never applies the whole gap as one leap. A
    // worker-timed step for a hidden window may pass a larger cap.
    function step(dtMs, capMs) {
      var dt = clamp(finite(dtMs, 16.7), 0, Math.max(0, finite(capMs, STEP_CAP_MS))) / 1000;
      var want = cruise();
      var landed = false;
      var ended = false;
      if (s.target && s.target.kind === 'cue') {
        var c = s.target;
        // The destination rides the crawl, so landing hands straight back to
        // the roll with no seam.
        c.to = clampPos(c.to + want * dt);
        c.t += dt;
        var u = clamp(c.t / c.dur, 0, 1);
        var u2 = u * u, u3 = u2 * u;
        var h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
        var p = h00 * c.from + h10 * c.dur * c.v0 + h01 * c.to + h11 * c.dur * want;
        s.vel = dt > 0 ? (p - s.pos) / dt : s.vel;
        s.pos = p;
        if (u >= 1) {
          s.pos = c.to;
          s.vel = want;
          s.target = null;
          landed = true;
        }
      } else if (s.target) {
        // A critically damped spring, solved exactly for this step. The old
        // code added the spring's push one frame at a time, which is only
        // steady while frames come faster than about 30 a second. On a slow
        // or stalled frame (a busy laptop, a 30 Hz projector, a window in the
        // background) the push overshot, each frame worse than the last, and
        // a nudge of one line threw the copy to the end of the script and
        // stopped the roll. The exact answer cannot overshoot at any frame
        // length: a long frame simply lands closer to the target.
        var j = s.target;
        var w = j.omega;
        var x0 = s.pos - j.to;             // how far from the target, before it drifts
        var v0 = s.vel - want;             // speed measured against the crawl
        j.to = clampPos(j.to + want * dt);
        var decay = Math.exp(-w * dt);
        var pull = v0 + w * x0;
        s.pos = j.to + (x0 + pull * dt) * decay;
        s.vel = want + (v0 - pull * w * dt) * decay;
        if (Math.abs(j.to - s.pos) <= LAND_PX && Math.abs(s.vel - want) <= LAND_VEL) {
          s.pos = j.to;
          s.vel = want;
          s.target = null;
          landed = true;
        }
      } else {
        // First-order ease to the crawl speed: a play, a speed change, a
        // brake or boost all ramp instead of stepping.
        var k = 1 - Math.exp(-(dt * 1000) / EASE_MS);
        s.vel += (want - s.vel) * k;
        if (Math.abs(s.vel - want) < 0.5) s.vel = want;
        s.pos += s.vel * dt;
      }
      if (s.pos >= s.max && want > 0) {
        // The end of the script: stop rolling there (the caller may say so).
        s.pos = s.max;
        s.vel = 0;
        s.target = null;
        s.rolling = false;
        s.dir = '';
        ended = true;
      } else if (s.pos <= 0 && want < 0) {
        s.pos = 0;
        s.vel = 0;
        s.target = null;
      } else {
        s.pos = clampPos(s.pos);
      }
      return { pos: s.pos, vel: s.vel, landed: landed, ended: ended, moving: !!s.target || Math.abs(s.vel) > 0.01 };
    }

    function get() {
      return { pos: s.pos, vel: s.vel, max: s.max, speed: s.speed, rolling: s.rolling, brake: s.brake, boost: s.boost, reverse: s.reverse, dir: s.dir, target: s.target ? { to: s.target.to, kind: s.target.kind } : null };
    }

    return {
      get: get,
      cruise: cruise,
      setMax: setMax,
      setSpeed: setSpeed,
      roll: roll,
      hold: hold,
      moveTo: moveTo,
      moveBy: moveBy,
      jumpTo: jumpTo,
      shift: shift,
      reportedPos: reportedPos,
      travelling: travelling,
      step: step
    };
  }

  // ── Rows ─────────────────────────────────────────────────────────────────
  var HEADER_RE = /^\[(\d+)\]\s*(.*)$/;

  // The script as rundown rows. Text before the first [N] header is one row
  // with no number (a hand-pasted script is one such row).
  function parseRows(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var rows = [];
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m = HEADER_RE.exec(line.trim());
      if (m) {
        cur = { num: parseInt(m[1], 10), name: m[2].trim(), lines: [] };
        rows.push(cur);
        continue;
      }
      if (!cur) {
        cur = { num: null, name: '', lines: [] };
        rows.push(cur);
      }
      cur.lines.push(line);
    }
    rows.forEach(function (r, idx) {
      // Trim the blank lines around each row; the gap between rows is the
      // row box's own spacing, not blank copy.
      while (r.lines.length && !r.lines[0].trim()) r.lines.shift();
      while (r.lines.length && !r.lines[r.lines.length - 1].trim()) r.lines.pop();
      r.key = r.num != null ? 'r' + r.num : 'pre' + idx;
      r.text = r.lines.join('\n');
      r.words = wordCount(r.text);
    });
    // An empty preamble (the script started with a header) is nothing.
    return rows.filter(function (r) { return r.num != null || r.lines.length; });
  }

  // Which rows a push really changed. keep = same words and name, reuse the
  // box; replace = same row, new words; insert = new row; remove = gone.
  function diffRows(prev, next) {
    var before = Object.create(null);
    (prev || []).forEach(function (r) { before[r.key] = r; });
    var seen = Object.create(null);
    var ops = (next || []).map(function (r) {
      seen[r.key] = true;
      var old = before[r.key];
      if (!old) return { type: 'insert', key: r.key, row: r };
      if (old.text === r.text && old.name === r.name) return { type: 'keep', key: r.key, row: r };
      return { type: 'replace', key: r.key, row: r };
    });
    var removed = (prev || []).filter(function (r) { return !seen[r.key]; }).map(function (r) { return r.key; });
    var changed = ops.filter(function (op) { return op.type !== 'keep'; }).length + removed.length;
    return { ops: ops, removed: removed, changed: changed };
  }

  function wordCount(text) {
    var t = String(text || '').replace(/\[[^\]]*\]/g, ' ');   // directions are not read
    var m = t.match(/[A-Za-z0-9À-ɏ'’]+/g);
    return m ? m.length : 0;
  }

  // ── The script by row: holding a change to the row on air ────────────────
  // Rows back to script text, the same shape parseRows reads.
  function rowsText(rows) {
    return (rows || []).map(function (r) {
      if (r.num == null) return r.text || '';
      var head = '[' + r.num + ']' + (r.name ? ' ' + r.name : '');
      return r.text ? head + '\n' + r.text : head;
    }).join('\n\n');
  }
  // One row's words, or null if the script has no such row.
  function rowText(text, num) {
    var rows = parseRows(text);
    for (var i = 0; i < rows.length; i++) if (rows[i].num === Number(num)) return rows[i].text;
    return null;
  }
  // Did this row's words change between what the talent has and the rundown now?
  function rowChanged(sentText, nextText, num) {
    var a = rowText(sentText, num), b = rowText(nextText, num);
    return a != null && b != null && a !== b;
  }
  // The new script, but with one row's words kept as the talent has them.
  // The talent is reading that row right now, so its change waits for the
  // operator's Send change. Every other row goes through at once.
  function holdRow(nextText, sentText, num) {
    var old = rowText(sentText, num);
    if (old == null) return String(nextText || '');
    var rows = parseRows(nextText);
    rows.forEach(function (r) { if (r.num === Number(num)) { r.text = old; r.lines = old ? old.split('\n') : []; } });
    return rowsText(rows);
  }
  // ── Formatting: the five kinds ───────────────────────────────────────────
  // A prompter script needs five things and no more:
  //   Speaker          a name on its own line ending in a colon  (HOST:)
  //   Punch            words to hit                              (**three big stories**)
  //   Note to talent   something to do, not say                  ([TURN TO CAMERA 2])
  //   Stop here        the roll stops and waits for Play         ([STOP HERE])
  //   Row name         comes from the rundown, never typed
  // The script is still stored as plain words with those marks, so old shows
  // open fine. This is the ONE place the marks are read: the talent screen,
  // the operator's preview and the editor's preview all draw from it.
  var SPEAKER_RE = /^([A-Za-z0-9][A-Za-z0-9 .'&\/-]{0,30}):$/;
  var STOP_MARK_RE = /\[\s*(BREAK|AUTO PAUSE|PAUSE|STOP HERE|STOP|HOLD|TECHNICAL DIFFICULTIES)\b([^\]]*)\]/i;
  // Marks older versions typed that mean nothing to the talent. They are
  // dropped, never drawn.
  var DEAD_MARK_RE = /\[\s*(?:UPDATE|EDIT|DIALOGUE)\s*\]\s*/gi;

  function escText(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function isSpeakerLine(line) {
    var t = String(line || '').trim();
    var m = SPEAKER_RE.exec(t);
    if (!m) return false;
    return /[A-Za-z]/.test(m[1]) && m[1].trim().split(/\s+/).length <= 3;
  }
  // The words of a line with punch and notes drawn.
  function inlineHTML(text) {
    var html = escText(text);
    html = html.replace(/\[([^\]]*)\]/g, function (_, inner) {
      var t = inner.trim();
      return t ? '<span class="scr-note">' + t.toUpperCase() + '</span>' : '';
    });
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<span class="scr-punch">$1</span>');
    html = html.replace(/(^|[^*\w])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?=[^*\w]|$)/g, '$1<span class="scr-punch">$2</span>');
    return html;
  }
  // One line of script as HTML. '' for a line with nothing to show.
  function scriptLineHTML(line) {
    var raw = String(line == null ? '' : line);
    var trimmed = raw.trim();
    if (!trimmed) return '';
    if (/^\[\d+\]/.test(trimmed)) return '<span class="scr-header">' + escText(raw) + '</span>';
    if (isSpeakerLine(trimmed)) return '<span class="scr-speaker">' + escText(trimmed.slice(0, -1).trim().toUpperCase()) + '</span>';
    var text = raw.replace(DEAD_MARK_RE, '');
    if (!text.trim()) return '';
    var stop = STOP_MARK_RE.exec(text);
    if (stop) {
      var kind = stop[1].toUpperCase();
      var label = kind === 'TECHNICAL DIFFICULTIES' ? 'STOP · TECHNICAL DIFFICULTIES' : 'STOP';
      var before = text.slice(0, stop.index).trim();
      var after = text.slice(stop.index + stop[0].length).trim();
      return (before ? inlineHTML(before) : '') +
        '<span class="scr-stop" data-stop="1">' + label + '</span>' +
        (after ? inlineHTML(after) : '');
    }
    return inlineHTML(text);
  }
  // A whole row's words as paragraphs. Lines that show nothing leave no gap.
  function scriptHTML(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [], blank = false;
    for (var i = 0; i < lines.length; i++) {
      var html = scriptLineHTML(lines[i]);
      if (!html) { if (lines[i].trim() === '' && out.length) blank = true; continue; }
      out.push('<p' + (blank ? ' class="scr-gap"' : '') + '>' + html + '</p>');
      blank = false;
    }
    return out.join('');
  }
  // The plain words with every mark taken off (Clear formatting).
  function stripMarks(text) {
    return String(text || '')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/(^|[^*\w])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?=[^*\w]|$)/g, '$1$2')
      .replace(/\[[^\]]*\]\s?/g, '');
  }

  // How long the words take to read aloud, in seconds. 150 words a minute is
  // an easy news read. Zero for no words.
  var READ_WPM = 150;
  function readSeconds(text, wpm) {
    // A speaker's name is not read aloud.
    var spoken = String(text || '').split('\n').filter(function (l) { return !isSpeakerLine(l); }).join('\n');
    var words = wordCount(stripMarks(spoken));
    if (!words) return 0;
    return Math.max(1, Math.round(words / (Number(wpm) > 0 ? Number(wpm) : READ_WPM) * 60));
  }

  // Seconds to travel a distance at a speed; null when nothing is moving.
  function secondsForPixels(px, velPxPerSec) {
    var v = Math.abs(finite(velPxPerSec, 0));
    if (!(v > 0.5)) return null;
    return Math.max(0, finite(px, 0)) / v;
  }

  // m:ss for a readout; blank for nothing.
  function formatSeconds(sec) {
    if (sec == null || !Number.isFinite(sec)) return '';
    var s = Math.max(0, Math.round(sec));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  return {
    SPEED_MIN: SPEED_MIN,
    SPEED_MAX: SPEED_MAX,
    createMotion: createMotion,
    cueDurationMs: cueDurationMs,
    parseRows: parseRows,
    diffRows: diffRows,
    wordCount: wordCount,
    rowsText: rowsText,
    rowText: rowText,
    rowChanged: rowChanged,
    holdRow: holdRow,
    readSeconds: readSeconds,
    isSpeakerLine: isSpeakerLine,
    scriptLineHTML: scriptLineHTML,
    scriptHTML: scriptHTML,
    stripMarks: stripMarks,
    READ_WPM: READ_WPM,
    secondsForPixels: secondsForPixels,
    formatSeconds: formatSeconds
  };
});
