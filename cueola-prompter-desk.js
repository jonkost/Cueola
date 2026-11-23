/* Cueola prompter desk.
 *
 * How a prompter control gets from an operator to the talent screen.
 *
 * Before this file, controls travelled as a STREAM: every press was one
 * message in a line of 24, and the talent had to catch each one in order.
 * A press could be lost five ways (pushed out of the line, refused by a
 * session check, held in a waiting line, blocked for five seconds because the
 * other operator touched something, or skipped when the talent reloaded), and
 * a lost press left the operator's screen and the talent's screen disagreeing.
 *
 * Now the show keeps ONE small record per control ("family"): play, speed,
 * size, seek, slate, clock and so on. A press overwrites that family's record
 * with what the operator wants, and the talent screen applies any record it
 * has not applied yet. Nothing queues and nothing is refused. If the talent
 * misses three updates and sees only the fourth, the fourth is the truth. It
 * is the same idea as the live position: one shared record, last press wins.
 *
 * Two things need care, and both are handled here:
 *
 *   Scrolling. A scroll is "move by N lines", which is relative. The sender
 *   keeps a running TOTAL of every line it has asked for, and the record
 *   carries that total. The talent applies the difference from the total it
 *   last saw, so skipped updates still add up to the right place.
 *
 *   A talent that just linked. It replays the look of the show (slates,
 *   clock, question, row info, read line, width) so a reload comes back
 *   right, but never a play, a seek or a scroll: an old "play" from
 *   yesterday's rehearsal must not start the roll by itself.
 *
 * No DOM and no cloud in here, so Node can test it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaPrompterDesk = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SPEED_MIN = 5, SPEED_MAX = 200, SIZE_MIN = 24, SIZE_MAX = 120;
  // A talent that just linked replays a "look" record only if it is this
  // recent. Clocks on two machines can disagree by minutes, never by hours.
  var REPLAY_MAX_AGE_MS = 6 * 60 * 60 * 1000;

  // Which record a control belongs to. Controls in one family overwrite each
  // other (a pause replaces a play); controls in different families never do.
  function familyOf(action) {
    var a = String(action || '');
    if (!a) return '';
    if (a === 'pause' || a === 'resume') return 'play';
    if (a === 'speed_up' || a === 'speed_down' || a.indexOf('speed_set_') === 0) return 'speed';
    if (a === 'size_up' || a === 'size_down' || a.indexOf('size_set_') === 0) return 'size';
    if (a.indexOf('seek_line_') === 0) return 'nudge';
    if (a.indexOf('seek_') === 0 || a.indexOf('row_') === 0 || a === 'reset' || a === 'rewind') return 'seek';
    if (a.indexOf('hold_') === 0) return 'hold';        // Back and Ahead, while held
    if (a.indexOf('follow_') === 0) return 'follow';    // every TAKE cues the prompter
    if (a.indexOf('align_') === 0) return 'align';
    if (a.indexOf('theme_') === 0) return 'theme';
    if (a.indexOf('direction_') === 0) return 'direction';
    if (a.indexOf('brake_') === 0) return 'brake';
    if (a.indexOf('boost_') === 0) return 'boost';
    if (a.indexOf('slate_') === 0) return 'slate';
    if (a.indexOf('question_') === 0) return 'question';
    if (a === 'clock_size_up' || a === 'clock_size_down') return 'clocksize';
    if (a.indexOf('clock_') === 0) return 'clock';
    if (a.indexOf('wrapup_') === 0) return 'wrap';
    if (a === 'overlays_clear') return 'clear';
    if (a.indexOf('rowinfo_') === 0) return 'rowinfo';
    if (a.indexOf('readline_') === 0) return 'readline';
    if (a.indexOf('width_') === 0) return 'width';
    if (a === 'mirror') return 'mirror';
    if (a === 'hide_interface') return 'panel';
    if (a === 'fullscreen') return 'fullscreen';
    return 'other';
  }

  // The look of the show: safe to replay on a talent that just linked.
  var REPLAY_FAMILIES = { slate: 1, question: 1, clock: 1, wrap: 1, clear: 1, rowinfo: 1, readline: 1, width: 1, follow: 1 };

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  // "Faster" becomes "speed 70": a number the talent can land on even if it
  // missed the press before. known = { speed, size } as the operator sees them.
  function absoluteAction(action, known) {
    var a = String(action || '');
    known = known || {};
    var speed = Number(known.speed), size = Number(known.size);
    if (a === 'speed_up' && isFinite(speed)) return 'speed_set_' + clamp(Math.round(speed) + 10, SPEED_MIN, SPEED_MAX);
    if (a === 'speed_down' && isFinite(speed)) return 'speed_set_' + clamp(Math.round(speed) - 10, SPEED_MIN, SPEED_MAX);
    if (a === 'size_up' && isFinite(size)) return 'size_set_' + clamp(Math.round(size) + 4, SIZE_MIN, SIZE_MAX);
    if (a === 'size_down' && isFinite(size)) return 'size_set_' + clamp(Math.round(size) - 4, SIZE_MIN, SIZE_MAX);
    return a;
  }

  // One per operator window. writer is that window's own id.
  function createSender(options) {
    var writer = String((options && options.writer) || '');
    var nudgeTotal = 0;
    return {
      // Turns one press into the record to store. Returns
      // { family, action, record }; action is the absolute form.
      stamp: function (control, known) {
        control = control || {};
        var action = absoluteAction(control.action, known);
        var family = familyOf(action);
        if (!family) return null;
        var record = {
          id: String(control.id || ''),
          action: action,
          at: Number(control.at) || Date.now(),
          by: writer
        };
        if (control.payload && typeof control.payload === 'object') record.payload = control.payload;
        if (control.source) record.source = String(control.source);
        if (family === 'nudge') {
          var lines = parseFloat(action.slice('seek_line_'.length)) || 0;
          nudgeTotal = Math.round((nudgeTotal + lines) * 1000) / 1000;
          record.last = lines;
          record.total = nudgeTotal;
        }
        return { family: family, action: action, record: record };
      },
      nudgeTotal: function () { return nudgeTotal; }
    };
  }

  // One per talent screen.
  function createReceiver() {
    var seen = {};            // family -> id of the record already applied
    var booted = false;
    var nudgeWriter = null, nudgeSeenTotal = 0;

    // A scroll record, turned into the lines still owed.
    function nudgeOwed(record) {
      var total = Number(record.total), last = Number(record.last) || 0;
      var owed;
      if (!isFinite(total)) owed = last;
      else if (record.by === nudgeWriter) owed = total - nudgeSeenTotal;
      else owed = last;                    // a new hand on the wheel: its latest move only
      nudgeWriter = record.by;
      nudgeSeenTotal = isFinite(total) ? total : 0;
      owed = clamp(Math.round(owed * 1000) / 1000, -200, 200);
      return owed;
    }

    function toApply(family, record) {
      if (family !== 'nudge') return { family: family, id: record.id, action: record.action, payload: record.payload || null, at: record.at, by: record.by, source: record.source || '' };
      var owed = nudgeOwed(record);
      if (!owed) return null;
      return { family: family, id: record.id, action: 'seek_line_' + owed, payload: null, at: record.at, by: record.by, source: record.source || '' };
    }

    function valid(record) {
      return record && typeof record === 'object' && record.id && record.action;
    }

    return {
      // The whole desk from the show's shared document. Returns the controls
      // to apply now, oldest first. The first call is the link: it replays
      // only the look of the show and remembers everything else as seen.
      adopt: function (desk, now) {
        var out = [];
        var first = !booted;
        booted = true;
        if (!desk || typeof desk !== 'object') return out;
        now = Number(now) || Date.now();
        Object.keys(desk).forEach(function (family) {
          var record = desk[family];
          if (!valid(record) || seen[family] === record.id) return;
          seen[family] = record.id;
          if (first) {
            if (family === 'nudge') { nudgeWriter = record.by; nudgeSeenTotal = Number(record.total) || 0; return; }
            if (!REPLAY_FAMILIES[family]) return;
            if (Math.abs(now - (Number(record.at) || 0)) > REPLAY_MAX_AGE_MS) return;
          }
          var item = toApply(family, record);
          if (item) out.push(item);
        });
        out.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
        return out;
      },
      // One record that arrived directly from a window in this same browser.
      // Returns the control to apply, or null if it was already applied.
      offer: function (family, record) {
        if (!family || !valid(record) || seen[family] === record.id) return null;
        seen[family] = record.id;
        return toApply(family, record);
      },
      hasSeen: function (family, id) { return seen[family] === id; }
    };
  }

  return {
    SPEED_MIN: SPEED_MIN, SPEED_MAX: SPEED_MAX, SIZE_MIN: SIZE_MIN, SIZE_MAX: SIZE_MAX,
    REPLAY_MAX_AGE_MS: REPLAY_MAX_AGE_MS,
    familyOf: familyOf,
    absoluteAction: absoluteAction,
    createSender: createSender,
    createReceiver: createReceiver
  };
});
