// A time or date box that nobody has filled in must look empty.
//
// Safari paints "12:30 PM" into every empty time box and today's date into
// every empty date box. Nothing is saved, but it reads like a real call time.
// It does the same to the part of a time you have not typed yet: type 9, then
// 15, and Safari shows "09:15 PM" although the PM is made up and the time is
// not saved until you pick AM or PM yourself.
//
// Chrome and Firefox paint dashes in an empty box, which is the truth. That is
// why this bug kept "coming back": it was only ever checked in Chrome.
//
// This file fixes it in one place, for every page that loads it:
//   1. It marks each empty time or date box with data-blank:
//        data-blank="empty"  nothing typed
//        data-blank="part"   some of it typed, not all of it
//   2. A marked box hides what Safari paints and shows dashes instead:
//        --:--        an empty time
//        --/--/----   an empty date
//        09:15 --     a time still waiting for AM or PM
// A box with a real value is never marked and never touched.
//
// Only Safari's engine (WebKit) needs this, so the file does nothing anywhere
// else. Safari on a Mac paints the 12:30 PM. On an iPad or iPhone (every
// browser there is Safari underneath) an empty box is simply blank; there this
// file only draws the dashes, in the middle of the box, where an iPad puts a
// time. Tapping an empty box on an iPad opens the wheel and fills in the time
// right now. That is the iPad itself; this file does not change it.
//
// Check it with:
//   node scripts/tests/blank-time.test.mjs             the marking, any machine
//   node scripts/tests/blank-time-safari.browser.mjs   Safari's real engine, Mac only
(function (root) {
  'use strict';

  const ATTR = 'data-blank';
  const SELECTOR = 'input[type="time"],input[type="date"]';
  const STYLE_ID = 'cueola-blank-time-style';

  // Set by install(). False on an old Safari that cannot draw dashes inside a
  // half-typed box; there a half-typed box is shown as an empty one.
  let showParts = true;

  function isTimeOrDate(el) {
    return Boolean(el) && el.tagName === 'INPUT' && (el.type === 'time' || el.type === 'date');
  }

  // null: the box has a real value (or is not a time/date box). Leave it alone.
  // 'empty': nothing typed. 'part': some of it typed, so the value is still ''.
  function blankState(el) {
    if (!isTimeOrDate(el) || el.value !== '') return null;
    return showParts && el.validity && el.validity.badInput ? 'part' : 'empty';
  }

  function sync(el) {
    if (!el || typeof el.getAttribute !== 'function') return;
    const next = blankState(el);
    if (next === el.getAttribute(ATTR)) return;
    if (next) el.setAttribute(ATTR, next);
    else el.removeAttribute(ATTR);
  }

  function syncAll(scope) {
    const within = scope && typeof scope.querySelectorAll === 'function' ? scope : root.document;
    if (!within) return;
    const list = within.querySelectorAll(SELECTOR + ',input[' + ATTR + ']');
    for (let i = 0; i < list.length; i++) sync(list[i]);
  }

  // ---- What a marked box looks like ----------------------------------------
  // The dashes are drawn, not typed: a time box cannot hold the text "--:--".
  // Sizes are in em so they follow the font size of the box they sit in.
  // A box whose text is not var(--text) sets --blank-time-ink (the colour of
  // what you typed) and --blank-time-hint (the dash colour, a solid colour)
  // in its own CSS rule. The prompter's "Count to" box does (index.html).
  const HINT = 'var(--blank-time-hint,var(--text3,#8a8a8a))';
  const INK = 'var(--blank-time-ink,var(--text,CanvasText))';
  const DIGIT = 0.6; // how wide one digit is, in em
  const DASH = 'linear-gradient(' + HINT + ',' + HINT + ')';
  const DOT = 'radial-gradient(circle closest-side,' + HINT + ' 78%,transparent)';
  const SLASH = 'linear-gradient(to bottom right,transparent calc(50% - .045em),' + HINT + ' calc(50% - .045em),' + HINT + ' calc(50% + .045em),transparent calc(50% + .045em))';
  const SHAPES = {
    dash: { image: DASH, wide: 0.43, size: '.43em max(1.5px,.09em)', y: '50%' },
    dotTop: { image: DOT, wide: 0.15, size: '.15em .15em', y: 'calc(50% - .19em)' },
    dotLow: { image: DOT, wide: 0.15, size: '.15em .15em', y: 'calc(50% + .19em)' },
    slash: { image: SLASH, wide: 0.3, size: '.3em 1em', y: '50%' },
  };
  // Each piece: [shape, how far from the left edge of the text, in em].
  const TIME_PIECES = [
    ['dash', 0], ['dash', DIGIT],
    ['dotTop', 1.27], ['dotLow', 1.27],
    ['dash', 1.5], ['dash', 1.5 + DIGIT],
  ];
  const DATE_PIECES = [
    ['dash', 0], ['dash', DIGIT],
    ['slash', 1.2],
    ['dash', 1.5], ['dash', 1.5 + DIGIT],
    ['slash', 2.7],
    ['dash', 3], ['dash', 3 + DIGIT], ['dash', 3 + 2 * DIGIT], ['dash', 3 + 3 * DIGIT],
  ];

  // Where the pieces go. This sits on every time and date box all the time
  // (it draws nothing by itself), so the dashes never slide into place when a
  // box that fades its background (.field-in) switches look.
  // On a Mac the text of a time box starts at the left. On an iPad or iPhone
  // Safari puts it in the middle, so there the dashes go in the middle too.
  function layout(pieces, centred) {
    const last = pieces[pieces.length - 1];
    const whole = last[1] + SHAPES[last[0]].wide; // how wide the whole drawing is, in em
    const place = p => (centred
      ? 'calc(50% + ' + (p[1] + SHAPES[p[0]].wide / 2 - whole / 2).toFixed(3) + 'em) ' + SHAPES[p[0]].y
      : 'left ' + p[1] + 'em top ' + SHAPES[p[0]].y);
    return [
      'background-size:' + pieces.map(p => SHAPES[p[0]].size).join(',') + ' !important',
      'background-position:' + pieces.map(place).join(',') + ' !important',
      'background-repeat:no-repeat !important',
      'background-origin:content-box !important',
    ].join(';');
  }

  // An empty box you are not typing in: hide Safari's text, draw the dashes.
  // Every line is !important because .field-in and .pb-field-busy set the
  // whole background in one go, which would wipe the dashes.
  function emptyLook(pieces) {
    return [
      '-webkit-text-fill-color:transparent !important',
      'background-image:' + pieces.map(p => SHAPES[p[0]].image).join(',') + ' !important',
    ].join(';');
  }

  // The parts of a time or date box (hour, minute, AM/PM, month, day, year).
  const PARTS = ['hour', 'minute', 'second', 'millisecond', 'meridiem', 'ampm', 'month', 'day', 'year']
    .map(name => '::-webkit-datetime-edit-' + name + '-field');
  // Safari colours a part you have not typed from the box's own text colour.
  // With the box's colour set to transparent, an untyped part is transparent
  // and a typed part (given INK below) is solid. This colour turns that into
  // a dash: solid where the part is untyped, clear where it is typed.
  const PART_DASH_ALPHA = 'calc((0.52 - alpha) * 50)';
  const PART_DASH = 'rgb(from color-mix(in srgb,currentColor,rgb(from var(--blank-time-part-hint,' + HINT + ') r g b / 1)) r g b / ' + PART_DASH_ALPHA + ')';

  // A box you are typing in, or one left half-typed: show only what was really
  // typed, and a dash for every digit that is still missing.
  function typingLook() {
    const box = ':is(input[' + ATTR + ']:focus,input[' + ATTR + '="part"])';
    const everyPart = suffix => PARTS.map(part => box + part + suffix).join(',');
    const dash = 'linear-gradient(to right,' + PART_DASH + ' 72%,transparent 72%)';
    const amPm = ['meridiem', 'ampm'].map(name => box + '::-webkit-datetime-edit-' + name + '-field').join(',');
    return [
      box + '{color:transparent !important}',
      // What you typed gets its colour back. The part the cursor is in keeps
      // Safari's own highlight colours, and white dashes that show on it.
      everyPart(':not(:focus)') + '{color:' + INK + '}',
      everyPart(':focus') + '{--blank-time-part-hint:#fff}',
      // One dash per digit: "space" fits as many whole dashes as the part is wide.
      everyPart('') + '{background-image:' + dash + ';background-size:' + DIGIT + 'em max(1.5px,.09em);background-position:left center;background-repeat:space no-repeat}',
      // AM/PM is wider than two digits, so its two dashes are placed by hand.
      amPm + '{background-image:' + dash + ',' + dash + ';background-position:left center,left ' + DIGIT + 'em center;background-repeat:no-repeat}',
      box + '::-webkit-datetime-edit-text{color:' + INK + '}',
      'input[' + ATTR + '="empty"]:focus::-webkit-datetime-edit-text{color:' + HINT + '}',
    ];
  }

  // touch: an iPad or iPhone. There a time box opens a picker wheel instead of
  // being typed part by part, so only the empty look is needed.
  function css(touch) {
    return [
      'input[type="time"]{' + layout(TIME_PIECES, touch) + '}',
      'input[type="date"]{' + layout(DATE_PIECES, touch) + '}',
      'input[type="time"][' + ATTR + '="empty"]:not(:focus){' + emptyLook(TIME_PIECES) + '}',
      'input[type="date"][' + ATTR + '="empty"]:not(:focus){' + emptyLook(DATE_PIECES) + '}',
      // A text outline set somewhere above would trace the hidden letters.
      'input[' + ATTR + ']{-webkit-text-stroke-width:0 !important}',
    ].concat(touch ? [] : typingLook()).join('\n');
  }

  // ---- Which browsers need it ----------------------------------------------
  function isAppleEngine(nav) {
    if (!nav) return false;
    if (/Apple/.test(nav.vendor || '')) return true;
    const ua = nav.userAgent || '';
    return /AppleWebKit/.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua);
  }

  // ---- Keeping the marks true ----------------------------------------------
  // A mark that is wrong the other way (a real time shown as dashes) would be
  // worse than the bug, so every way a value can change is watched:
  //   typing and picking          the input, change, keyup and focus events
  //   the app writing a value     the wrapped value setter below
  //   the app nudging a value     the wrapped stepUp and stepDown
  //   boxes built or rebuilt      the MutationObserver
  //   a form being reset          the reset event
  //   the page coming back        pageshow and visibilitychange
  let installed = false;
  function install(force) {
    const doc = root.document;
    if (installed || !doc) return false;
    if (!force && !isAppleEngine(root.navigator)) return false;
    installed = true;

    const touch = Boolean(root.navigator && root.navigator.maxTouchPoints > 0);
    const drawsPartDashes = Boolean(root.CSS && root.CSS.supports && root.CSS.supports('color', 'rgb(from color-mix(in srgb,currentColor,#888) r g b / ' + PART_DASH_ALPHA + ')'));
    showParts = drawsPartDashes && !touch;

    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css(touch);
    (doc.head || doc.documentElement).appendChild(style);

    // el.value = '09:00' fires no event, so the setter itself reports in.
    // No repeating timer is used anywhere here (the app keeps a budget of those).
    const proto = root.HTMLInputElement && root.HTMLInputElement.prototype;
    const plainValue = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    ['value', 'valueAsNumber', 'valueAsDate'].forEach(name => {
      const original = proto && Object.getOwnPropertyDescriptor(proto, name);
      if (!original || !original.set || !original.configurable) return;
      Object.defineProperty(proto, name, {
        configurable: true,
        enumerable: original.enumerable,
        get: original.get,
        set(next) {
          original.set.call(this, next);
          // Sliders and text boxes are set many times a second; only time and
          // date boxes report in. Read the box back: Safari may refuse a value.
          const type = this.type;
          if (type !== 'time' && type !== 'date') return;
          // When the app empties a box (N/A, a new call sheet), Safari keeps
          // any half-typed digits on screen; Chrome drops them. A real value
          // and then '' again makes Safari let go. No event fires. A box
          // someone is typing in right now is left alone.
          if (this.value === '' && this.validity && this.validity.badInput && (this.disabled || doc.activeElement !== this)) {
            plainValue.set.call(this, type === 'date' ? '2000-01-01' : '00:00');
            plainValue.set.call(this, '');
          }
          sync(this);
        },
      });
    });
    // stepUp() and stepDown() change the value with no event and no setter.
    ['stepUp', 'stepDown'].forEach(name => {
      const original = proto && proto[name];
      if (typeof original !== 'function') return;
      proto[name] = function () {
        const result = original.apply(this, arguments);
        const type = this.type;
        if (type === 'time' || type === 'date') sync(this);
        return result;
      };
    });

    ['input', 'change', 'keyup', 'focusin', 'focusout'].forEach(type => doc.addEventListener(type, event => sync(event.target), true));
    // A form puts its old values back just after this event, so look one tick later.
    doc.addEventListener('reset', () => root.setTimeout(() => syncAll(), 0), true);
    ['DOMContentLoaded', 'load', 'pageshow', 'visibilitychange'].forEach(type => root.addEventListener(type, () => syncAll(), true));

    if (root.MutationObserver) {
      new root.MutationObserver(records => {
        for (const record of records) {
          if (record.type === 'attributes') { sync(record.target); continue; }
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'INPUT') sync(node);
            else if (node.firstElementChild) syncAll(node);
          }
        }
      }).observe(doc, { subtree: true, childList: true, attributes: true, attributeFilter: ['type', 'value'] });
    }

    syncAll();
    return true;
  }

  const api = { isAppleEngine, blankState, sync, syncAll, css, install };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document) {
    root.CueolaBlankTime = api;
    install();
  }
})(typeof window !== 'undefined' ? window : globalThis);
