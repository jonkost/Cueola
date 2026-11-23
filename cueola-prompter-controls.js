/* Cueola prompter controls.
 *
 * THE control set. Fifteen controls, defined once, used by every surface:
 * the talent screen, the operator panel in Live, the operator in its own
 * window, the keyboard and the Stream Deck. Same name, same picture, same
 * order, same key everywhere. Three groups of five, which are also the
 * three rows of a 15-key Stream Deck.
 *
 * Before this file each surface drew its own buttons, so "Play" on one
 * screen was "SCROLL" on the deck, speed was a slider here and two keys
 * there, and Brake / Boost / Reverse were hidden under More. Now a surface
 * asks this file three things and nothing else:
 *
 *   face(id, state)        what the control looks like right now
 *   press(id, state, how)  what to send when it is pressed (or let go)
 *   keyControl(event)      which control a keyboard key belongs to
 *
 * "state" is what the TALENT screen last reported, never what the operator
 * hopes is true. A control lights only when the talent screen says so.
 *
 * No DOM lookups and no cloud in here, so Node can test it. stripHTML()
 * only builds a string.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaPrompterControls = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SPEED_MIN = 5, SPEED_MAX = 200, SPEED_STEP = 5;
  var WRAP_DEFAULT_SEC = 120;
  // A held Back or Ahead is re-sent this often while the finger is down. The
  // talent lets go by itself if it hears nothing for HOLD_EXPIRE_MS, so a
  // lost "let go" can never leave the copy running away.
  var HOLD_REPEAT_MS = 1000, HOLD_EXPIRE_MS = 3000;

  var GROUPS = ['Roll', 'Place and speed', 'On screen'];

  // key: what the keyboard list shows. codes: the event.key values that fire it.
  var CONTROLS = [
    { id: 'prev',    group: 'Roll', label: 'Prev row', symbol: 'pt.prev',  key: '↑', codes: ['ArrowUp'],    does: 'Jump to the start of the row before.' },
    { id: 'back',    group: 'Roll', label: 'Back',     symbol: 'pt.back',  key: '←', codes: ['ArrowLeft'],  hold: true, does: 'Hold to roll backward. Let go and it stops.' },
    { id: 'play',    group: 'Roll', label: 'Play',     symbol: 'pt.play',  key: 'Space', codes: [' ', 'Spacebar'], does: 'Start the roll. While rolling it reads Pause.' },
    { id: 'ahead',   group: 'Roll', label: 'Ahead',    symbol: 'pt.ahead', key: '→', codes: ['ArrowRight'], hold: true, does: 'Hold to roll forward fast. Let go and it stops.' },
    { id: 'next',    group: 'Roll', label: 'Next row', symbol: 'pt.next',  key: '↓', codes: ['ArrowDown'],  does: 'Jump to the start of the next row.' },

    { id: 'top',     group: 'Place and speed', label: 'Top',    symbol: 'pt.top',    key: 'T', codes: ['t', 'T'], does: 'Stop and go to the top of the script.' },
    { id: 'follow',  group: 'Place and speed', label: 'Follow', symbol: 'pt.follow', key: 'F', codes: ['f', 'F'], does: 'On: every TAKE cues the prompter to that row. Off: you place it by hand.' },
    { id: 'slower',  group: 'Place and speed', label: 'Slower', glyph: '−',          key: '[', codes: ['['],      does: 'Speed down by 5.' },
    { id: 'speed',   group: 'Place and speed', label: 'Speed',  readout: true,       key: '',  codes: [],         does: 'Shows the speed the talent screen is really running at.' },
    { id: 'faster',  group: 'Place and speed', label: 'Faster', glyph: '+',          key: ']', codes: [']'],      does: 'Speed up by 5.' },

    { id: 'clock',   group: 'On screen', label: 'Clock',   symbol: 'time.clock',      key: 'C', codes: ['c', 'C'], does: 'Show or hide the clock for the talent.' },
    { id: 'slate',   group: 'On screen', label: 'Slate',   symbol: 'content.display', key: 'S', codes: ['s', 'S'], does: 'Cover the script with Standby.' },
    { id: 'message', group: 'On screen', label: 'Message', symbol: 'pt.message',      key: 'M', codes: ['m', 'M'], does: 'Send the talent a short message or a question.' },
    { id: 'wrap',    group: 'On screen', label: 'Wrap',    symbol: 'pt.wrap',         key: 'W', codes: ['w', 'W'], does: 'Show a wrap up countdown for the talent.' },
    { id: 'clear',   group: 'On screen', label: 'Clear',   symbol: 'action.close',    key: 'Esc', codes: ['Escape', 'Esc'], does: 'Take everything off the screen but the script.' }
  ];

  var BY_ID = {};
  CONTROLS.forEach(function (c) { BY_ID[c.id] = c; });
  var IDS = CONTROLS.map(function (c) { return c.id; });

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function get(id) { return BY_ID[id] || null; }

  // What the talent screen reported, tidied. Anything missing reads as off.
  //   linked   a talent screen is answering
  //   playing  the copy is rolling
  //   speed    the speed it is really running at
  //   follow   every TAKE cues the prompter to that row
  //   hold     'back' | 'ahead' | '' while one is held
  //   clock, slate, message, wrap   that thing is on the talent's screen
  function tidy(state) {
    state = state || {};
    var speed = Number(state.speed);
    return {
      linked: state.linked !== false,
      playing: !!state.playing,
      speed: isFinite(speed) && speed > 0 ? clamp(Math.round(speed), SPEED_MIN, SPEED_MAX) : 60,
      follow: state.follow !== false,
      hold: state.hold === 'back' || state.hold === 'ahead' ? state.hold : '',
      clock: !!state.clock,
      slate: !!state.slate,
      message: !!state.message,
      wrap: !!state.wrap
    };
  }

  // The talent screen's own report (ptStateSnapshot) turned into the state
  // above. One place, so every surface reads the report the same way.
  function stateFromTalent(report, linked) {
    report = report || {};
    var clock = report.clockState || {};
    var mode = String(clock.mode || 'off');
    return tidy({
      linked: linked !== false,
      playing: !!report.playing,
      speed: report.speed,
      follow: report.follow !== false,
      hold: report.hold || '',
      clock: mode !== 'off' && mode !== 'wrap',
      wrap: mode === 'wrap',
      slate: !!(report.standbyOn || report.techSlateOn || report.colorBarsOn),
      message: !!report.questionOn
    });
  }

  // How one control looks right now.
  //   lit: '' | 'on' (cyan, a mode that is on) | 'air' (yellow, the talent sees it)
  function face(id, state) {
    var c = get(id);
    if (!c) return null;
    var s = tidy(state);
    var f = { id: c.id, group: c.group, label: c.label, symbol: c.symbol || '', glyph: c.glyph || '', value: '', lit: '', rolling: false, readout: !!c.readout, hold: !!c.hold, held: false, dim: !s.linked, key: c.key, does: c.does };
    if (id === 'play' && s.playing) { f.label = 'Pause'; f.symbol = 'pt.pause'; f.rolling = true; }
    if (id === 'follow' && s.follow) f.lit = 'on';
    if ((id === 'clock' && s.clock) || (id === 'slate' && s.slate) || (id === 'message' && s.message) || (id === 'wrap' && s.wrap)) f.lit = 'air';
    if (id === 'speed') f.value = String(s.speed);
    if (c.hold && s.hold === id) f.held = true;
    return f;
  }

  // What to send for a press. how: 'down' (default) or 'up' (a hold let go).
  // Returns a list of { action, payload } for the prompter desk, or a
  // { ui } entry when the surface must ask something first (the message).
  // An empty list means the press does nothing (the Speed readout).
  function press(id, state, how) {
    var c = get(id);
    if (!c) return [];
    var s = tidy(state);
    var up = how === 'up';
    if (c.hold) return [{ action: up ? 'hold_off' : 'hold_' + id }];
    if (up) return [];
    switch (id) {
      case 'prev':   return [{ action: 'row_prev' }];
      case 'next':   return [{ action: 'row_next' }];
      case 'play':   return [{ action: s.playing ? 'pause' : 'resume' }];
      case 'top':    return [{ action: 'reset' }];
      case 'follow': return [{ action: s.follow ? 'follow_off' : 'follow_on' }];
      case 'slower': return [{ action: 'speed_set_' + clamp(s.speed - SPEED_STEP, SPEED_MIN, SPEED_MAX) }];
      case 'faster': return [{ action: 'speed_set_' + clamp(s.speed + SPEED_STEP, SPEED_MIN, SPEED_MAX) }];
      case 'clock':  return [{ action: s.clock ? 'clock_off' : 'clock_timeofday' }];
      case 'slate':  return [{ action: s.slate ? 'slate_standby_off' : 'slate_standby_on' }];
      case 'message': return s.message ? [{ action: 'question_off' }] : [{ ui: 'message' }];
      case 'wrap':   return [{ action: s.wrap ? 'clock_off' : 'wrapup_' + WRAP_DEFAULT_SEC }];
      case 'clear':  return [{ action: 'overlays_clear' }];
    }
    return [];
  }

  // Which control a keyboard event belongs to, or '' for none. Keys with
  // Command, Control or Alt held belong to the browser, never to the prompter.
  function keyControl(event) {
    if (!event || event.metaKey || event.ctrlKey || event.altKey) return '';
    var k = String(event.key == null ? '' : event.key);
    for (var i = 0; i < CONTROLS.length; i++) {
      if (CONTROLS[i].codes.indexOf(k) >= 0) return CONTROLS[i].id;
    }
    return '';
  }

  // Which controls go on a deck with this many keys, in order. Smaller decks
  // get the keys that run a show, in the same order as the full set.
  function deckLayout(keyCount) {
    var n = Number(keyCount) || 15;
    if (n >= 15) return IDS.slice();
    if (n >= 8) return ['prev', 'back', 'ahead', 'next', 'play', 'follow', 'slate', 'clear'];
    return ['prev', 'play', 'next', 'back', 'follow', 'ahead'];
  }

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function buttonHTML(f) {
    var cls = 'ptc-key';
    if (f.id === 'play') cls += ' ptc-play' + (f.rolling ? ' is-rolling' : '');
    if (f.lit) cls += ' is-lit is-' + f.lit;
    if (f.held) cls += ' is-held';
    if (f.readout) cls += ' ptc-readout';
    var inner;
    if (f.readout) inner = '<span class="ptc-val" data-ptc-value>' + esc(f.value) + '</span>';
    else if (f.glyph) inner = '<span class="ptc-glyph" aria-hidden="true">' + esc(f.glyph) + '</span>';
    else inner = '<span class="sf-symbol" data-symbol="' + esc(f.symbol) + '" aria-hidden="true"></span>';
    var title = f.does + (f.key ? ' Key: ' + f.key : '');
    if (f.readout) {
      return '<div class="' + cls + '" data-ptc="' + f.id + '" role="status" aria-label="Speed ' + esc(f.value) + '" title="' + esc(title) + '">' + inner + '<span class="ptc-label">' + esc(f.label) + '</span></div>';
    }
    var pressed = (f.id === 'play') ? f.rolling : (f.lit ? true : (f.id === 'follow' || f.id === 'clock' || f.id === 'slate' || f.id === 'message' || f.id === 'wrap') ? false : null);
    return '<button type="button" class="' + cls + '" data-ptc="' + f.id + '"' + (f.hold ? ' data-ptc-hold="1"' : '') +
      (pressed === null ? '' : ' aria-pressed="' + (pressed ? 'true' : 'false') + '"') +
      ' title="' + esc(title) + '">' + inner + '<span class="ptc-label">' + esc(f.label) + '</span></button>';
  }

  // The strip of fifteen. opts: { size: 'touch' | 'compact' | '', captions: false }
  function stripHTML(state, opts) {
    opts = opts || {};
    var s = tidy(state);
    var cls = 'ptc-strip' + (opts.size ? ' ptc-' + opts.size : '') + (s.linked ? '' : ' is-off');
    return '<div class="' + cls + '" role="group" aria-label="Prompter controls">' + GROUPS.map(function (g) {
      return '<div class="ptc-group">' + (opts.captions === false ? '' : '<div class="ptc-cap">' + esc(g) + '</div>') +
        '<div class="ptc-keys">' + CONTROLS.filter(function (c) { return c.group === g; }).map(function (c) { return buttonHTML(face(c.id, s)); }).join('') + '</div></div>';
    }).join('') + '</div>';
  }

  // Puts the strip in a page element and makes it work. Every surface uses
  // this, so a press behaves the same everywhere.
  //   opts.size, opts.captions   as stripHTML
  //   opts.getState()            the talent's last report (tidy() form or raw)
  //   opts.send(out, id, how)    called once per entry press() returns
  // Returns { sync(state), press(id, how), destroy() }. sync() repaints the
  // faces in place, so a finger holding Back is never knocked off its button.
  function mount(host, opts) {
    opts = opts || {};
    if (!host) return null;
    var last = tidy(opts.getState ? opts.getState() : null);
    host.innerHTML = stripHTML(last, opts);
    var held = '', repeat = null;

    function fire(id, how) {
      var st = tidy(opts.getState ? opts.getState() : last);
      var outs = press(id, st, how);
      for (var i = 0; i < outs.length; i++) { try { opts.send && opts.send(outs[i], id, how || 'down'); } catch (e) {} }
      return outs.length > 0;
    }
    function letGo() {
      if (!held) return;
      var id = held;
      held = '';
      if (repeat) { clearInterval(repeat); repeat = null; }
      var el = host.querySelector('[data-ptc="' + id + '"]');
      if (el) el.classList.remove('is-held');
      fire(id, 'up');
    }
    function grab(id) {
      if (held === id) return;
      letGo();
      held = id;
      var el = host.querySelector('[data-ptc="' + id + '"]');
      if (el) el.classList.add('is-held');
      fire(id, 'down');
      // Say it again while the finger is down, so the talent knows it is
      // still held even if one message was lost.
      repeat = setInterval(function () { if (held === id) fire(id, 'down'); }, HOLD_REPEAT_MS);
    }
    function keyOf(ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-ptc]') : null;
      return t && host.contains(t) ? t : null;
    }
    function onDown(ev) {
      var el = keyOf(ev);
      if (!el || !el.hasAttribute('data-ptc-hold')) return;
      if (ev.button != null && ev.button > 0) return;
      ev.preventDefault();
      try { el.setPointerCapture && ev.pointerId != null && el.setPointerCapture(ev.pointerId); } catch (e) {}
      grab(el.getAttribute('data-ptc'));
    }
    function onUp() { letGo(); }
    function onClick(ev) {
      var el = keyOf(ev);
      if (!el || el.tagName !== 'BUTTON') return;
      if (el.hasAttribute('data-ptc-hold')) {
        // A keyboard press on a focused hold button (Enter or Space) has no
        // pointer: give it one short push.
        if (ev.detail === 0 && !held) { grab(el.getAttribute('data-ptc')); setTimeout(letGo, 350); }
        return;
      }
      fire(el.getAttribute('data-ptc'), 'down');
      // Let go of focus, or Space would press this button again instead of Play.
      try { el.blur(); } catch (e) {}
    }
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onUp);
    host.addEventListener('lostpointercapture', onUp);
    host.addEventListener('click', onClick);
    host.addEventListener('contextmenu', function (ev) { if (keyOf(ev)) ev.preventDefault(); });

    function sync(state) {
      var s = tidy(state == null && opts.getState ? opts.getState() : state);
      last = s;
      var strip = host.firstElementChild;
      if (!strip) return;
      strip.classList.toggle('is-off', !s.linked);
      CONTROLS.forEach(function (c) {
        var el = host.querySelector('[data-ptc="' + c.id + '"]');
        if (!el) return;
        var f = face(c.id, s);
        var label = el.querySelector('.ptc-label');
        if (label && label.textContent !== f.label) label.textContent = f.label;
        var sym = el.querySelector('.sf-symbol');
        if (sym && f.symbol && sym.getAttribute('data-symbol') !== f.symbol) sym.setAttribute('data-symbol', f.symbol);
        var val = el.querySelector('[data-ptc-value]');
        if (val && val.textContent !== f.value) { val.textContent = f.value; el.setAttribute('aria-label', 'Speed ' + f.value); }
        el.classList.toggle('is-rolling', !!f.rolling);
        el.classList.toggle('is-lit', !!f.lit);
        el.classList.toggle('is-on', f.lit === 'on');
        el.classList.toggle('is-air', f.lit === 'air');
        if (c.hold) el.classList.toggle('is-held', held === c.id || f.held);
        if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', (c.id === 'play' ? f.rolling : !!f.lit) ? 'true' : 'false');
      });
    }

    return {
      sync: sync,
      // The keyboard and the Stream Deck come in here, so a key is the same
      // press as a click. how: 'down' | 'up'.
      press: function (id, how) {
        var c = get(id);
        if (!c) return false;
        if (c.hold) { if (how === 'up') letGo(); else grab(id); return true; }
        if (how === 'up') return false;
        return fire(id, 'down');
      },
      held: function () { return held; },
      release: letGo,
      destroy: function () {
        letGo();
        host.removeEventListener('pointerdown', onDown);
        host.removeEventListener('pointerup', onUp);
        host.removeEventListener('pointercancel', onUp);
        host.removeEventListener('lostpointercapture', onUp);
        host.removeEventListener('click', onClick);
        host.innerHTML = '';
      }
    };
  }

  return {
    mount: mount,
    SPEED_MIN: SPEED_MIN, SPEED_MAX: SPEED_MAX, SPEED_STEP: SPEED_STEP,
    WRAP_DEFAULT_SEC: WRAP_DEFAULT_SEC,
    HOLD_REPEAT_MS: HOLD_REPEAT_MS, HOLD_EXPIRE_MS: HOLD_EXPIRE_MS,
    GROUPS: GROUPS,
    CONTROLS: CONTROLS,
    IDS: IDS,
    get: get,
    tidy: tidy,
    stateFromTalent: stateFromTalent,
    face: face,
    press: press,
    keyControl: keyControl,
    deckLayout: deckLayout,
    buttonHTML: buttonHTML,
    stripHTML: stripHTML
  };
});
