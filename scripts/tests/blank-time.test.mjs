// An empty time or date box must never look filled in.
// Safari paints "12:30 PM" (or today's date) into an empty box by itself;
// cueola-blank-time.js marks empty boxes and shows dashes instead.
//
// This file checks the marking and the wiring on any machine. It cannot see
// what Safari paints: scripts/tests/blank-time-safari.browser.mjs does that,
// on a Mac, in Safari's own engine.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const source = read('cueola-blank-time.js');
const guard = require('../../cueola-blank-time.js');
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---- A tiny stand-in for the page -----------------------------------------
const SAFARI = { vendor: 'Apple Computer, Inc.', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15' };
const IPAD = { vendor: 'Apple Computer, Inc.', maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15' };
const CHROME = { vendor: 'Google Inc.', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' };

function makePage({ navigator = SAFARI, drawsParts = true, before = [] } = {}) {
  const inputs = [];
  const styles = [];
  const listeners = {};
  const windowListeners = {};
  let observer = null;
  class HTMLInputElement {
    constructor(type, value = '') {
      this.tagName = 'INPUT';
      this.nodeType = 1;
      this.kind = type;
      this.stored = '';
      this.attrs = {};
      this.writes = 0;
      this.validity = { badInput: false };
      this.store(value); // not through the setter: a box in the markup tells nobody it exists
      inputs.push(this);
    }
    get type() { return this.kind; }
    // Like a real browser: a time box only keeps HH:MM, a date box YYYY-MM-DD.
    get value() { return this.stored; }
    set value(next) { this.store(next); }
    store(next) {
      const text = String(next ?? '');
      if (this.kind === 'time') this.stored = /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : '';
      else if (this.kind === 'date') this.stored = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
      else this.stored = text;
      // Like Safari: a real value replaces half-typed digits; writing '' over '' does not.
      if (this.stored !== '') this.validity.badInput = false;
    }
    // Like a real browser: no event and no setter call.
    stepUp() { this.stored = this.kind === 'date' ? '1970-01-02' : '00:01'; }
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
    setAttribute(name, value) { this.attrs[name] = String(value); this.writes += 1; }
    removeAttribute(name) { delete this.attrs[name]; this.writes += 1; }
    hasAttribute(name) { return name in this.attrs; }
  }
  const document = {
    head: { appendChild(node) { styles.push(node); } },
    createElement: tag => ({ tagName: tag.toUpperCase(), id: '', textContent: '' }),
    addEventListener(type, fn) { listeners[type] = fn; },
    // Like the real thing: only boxes the selector names come back.
    querySelectorAll: selector => inputs.filter(el => selector.includes(`input[type="${el.kind}"]`) || (selector.includes('input[data-blank]') && 'data-blank' in el.attrs)),
    getElementById: id => styles.find(node => node.id === id) || null,
    activeElement: null,
  };
  const sandbox = {
    document,
    navigator,
    HTMLInputElement,
    CSS: { supports: () => drawsParts },
    MutationObserver: class { constructor(fn) { observer = { fn, options: null }; } observe(target, options) { observer.options = options; } },
    addEventListener(type, fn) { windowListeners[type] = fn; },
    setTimeout: fn => fn(),
  };
  sandbox.window = sandbox;
  const originalSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const made = before.map(([type, value]) => new HTMLInputElement(type, value)); // on the page before the script runs
  vm.runInNewContext(source, sandbox);
  return {
    made,
    api: sandbox.CueolaBlankTime, HTMLInputElement, document, inputs, styles, listeners, windowListeners,
    observer: () => observer,
    setterWrapped: () => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set !== originalSetter,
    mark: el => el.getAttribute('data-blank'),
  };
}

// ---- Marking ---------------------------------------------------------------
test('an empty time or date box is "empty", a half-typed one is "part", a filled one is left alone', () => {
  const box = (type, value, badInput = false) => ({ tagName: 'INPUT', type, value, validity: { badInput } });
  assert.equal(guard.blankState(box('time', '')), 'empty');
  assert.equal(guard.blankState(box('date', '')), 'empty');
  assert.equal(guard.blankState(box('time', '', true)), 'part');
  assert.equal(guard.blankState(box('time', '12:30')), null);
  assert.equal(guard.blankState(box('date', '2026-10-02')), null);
  assert.equal(guard.blankState(box('text', '')), null);
  assert.equal(guard.blankState({ tagName: 'DIV', type: 'time', value: '' }), null);
  assert.equal(guard.blankState(null), null);
});

test('it runs in Safari\'s engine only (Chrome and Firefox already paint dashes)', () => {
  assert.equal(guard.isAppleEngine(SAFARI), true);
  assert.equal(guard.isAppleEngine({ vendor: 'Apple Computer, Inc.', userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }), true);
  // Chrome on an iPad is Safari's engine underneath.
  assert.equal(guard.isAppleEngine({ vendor: '', userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1' }), true);
  assert.equal(guard.isAppleEngine(CHROME), false);
  assert.equal(guard.isAppleEngine({ vendor: 'Google Inc.', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0' }), false);
  assert.equal(guard.isAppleEngine({ vendor: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0' }), false);
  assert.equal(guard.isAppleEngine(null), false);

  const chrome = makePage({ navigator: CHROME });
  new chrome.HTMLInputElement('time');
  assert.equal(chrome.styles.length, 0, 'no CSS is added in Chrome');
  assert.equal(chrome.setterWrapped(), false, 'the value setter is left alone in Chrome');
  assert.equal(chrome.observer(), null, 'nothing is watched in Chrome');
});

test('in Safari the boxes on the page are marked the moment the script loads', () => {
  const page = makePage({ before: [['time'], ['time', '09:00'], ['date']] });
  assert.equal(page.styles.length, 1);
  assert.equal(page.styles[0].id, 'cueola-blank-time-style');
  assert.equal(page.styles[0].textContent, page.api.css(), 'the CSS is really put on the page');
  const [empty, filled, day] = page.made; // nobody calls syncAll(): loading the script must be enough
  assert.equal(page.mark(empty), 'empty');
  assert.equal(page.mark(filled), null);
  assert.equal(page.mark(day), 'empty');
  // A box that slipped in unseen is caught when the page comes back.
  const late = new page.HTMLInputElement('date');
  assert.equal(page.mark(late), null);
  page.windowListeners.pageshow();
  assert.equal(page.mark(late), 'empty');
});

test('a time the app writes clears the mark; a time the app clears brings it back', () => {
  const page = makePage();
  const box = new page.HTMLInputElement('time');
  page.api.syncAll();
  box.value = '09:00'; // no event fires for this: the wrapped setter must see it
  assert.equal(page.mark(box), null);
  box.value = '';
  assert.equal(page.mark(box), 'empty');
  // The browser refuses this one, so the box is still empty. Read it back, do not trust it.
  box.value = '25:00';
  assert.equal(box.value, '');
  assert.equal(page.mark(box), 'empty');
  box.value = '12:30 PM';
  assert.equal(page.mark(box), 'empty');
});

test('other boxes are never marked, and a mark is only written when it changes', () => {
  const page = makePage();
  const text = new page.HTMLInputElement('text');
  const slider = new page.HTMLInputElement('range', '5');
  const time = new page.HTMLInputElement('time');
  page.api.syncAll();
  text.value = '';
  slider.value = '7';
  assert.equal(page.mark(text), null);
  assert.equal(page.mark(slider), null);
  assert.equal(text.writes + slider.writes, 0);
  const before = time.writes;
  time.value = '';
  time.value = '';
  page.api.sync(time);
  assert.equal(time.writes, before, 'an unchanged box is not written to again');
});

test('boxes built later (crew rows, the Count to box) are marked when they appear', () => {
  const page = makePage();
  const { fn, options } = page.observer();
  assert.equal(options.subtree, true);
  assert.equal(options.childList, true);
  assert.deepEqual([...options.attributeFilter].sort(), ['type', 'value']);
  assert.ok(!options.attributeFilter.includes('data-blank'), 'never watch its own mark (that would loop)');
  const inRow = new page.HTMLInputElement('time');
  const row = { nodeType: 1, tagName: 'DIV', firstElementChild: inRow, querySelectorAll: () => [inRow] };
  const loose = new page.HTMLInputElement('date');
  fn([{ type: 'childList', addedNodes: [{ nodeType: 3 }, row, loose] }]);
  assert.equal(page.mark(inRow), 'empty');
  assert.equal(page.mark(loose), 'empty');
  // A box that stops being a time box loses its mark.
  inRow.kind = 'text';
  fn([{ type: 'attributes', target: inRow, addedNodes: [] }]);
  assert.equal(page.mark(inRow), null);
});

test('typing is followed: half a time is "part", a finished time has no mark', () => {
  const page = makePage();
  const box = new page.HTMLInputElement('time');
  page.api.syncAll();
  for (const type of ['input', 'change', 'keyup', 'focusin', 'focusout']) assert.equal(typeof page.listeners[type], 'function', `${type} is listened for`);
  box.validity.badInput = true; // Safari: hour typed, AM/PM not yet
  page.listeners.keyup({ target: box });
  assert.equal(page.mark(box), 'part');
  box.validity.badInput = false;
  box.stored = '09:15';
  page.listeners.input({ target: box });
  assert.equal(page.mark(box), null);
  for (const type of ['pageshow', 'load', 'DOMContentLoaded', 'visibilitychange']) assert.equal(typeof page.windowListeners[type], 'function', `${type} re-checks every box`);
});

test('when the app empties a half-typed box, the typed digits go too (N/A, a new call sheet)', () => {
  const page = makePage();
  const box = new page.HTMLInputElement('time');
  box.validity.badInput = true; // Safari: "07" typed, nothing saved
  page.api.sync(box);
  assert.equal(page.mark(box), 'part');
  box.value = ''; // the N/A button does exactly this
  assert.equal(box.validity.badInput, false, 'the half-typed digits are flushed');
  assert.equal(box.value, '');
  assert.equal(page.mark(box), 'empty');
  // A box someone is typing in right now is left alone.
  const busy = new page.HTMLInputElement('date');
  busy.validity.badInput = true;
  page.document.activeElement = busy;
  busy.value = '';
  assert.equal(busy.validity.badInput, true);
  assert.equal(page.mark(busy), 'part');
  // Unless the app also locked it (N/A locks the box first, then empties it).
  busy.disabled = true;
  busy.value = '';
  assert.equal(page.mark(busy), 'empty');
});

test('stepUp() and stepDown() cannot leave a real time behind dashes', () => {
  const page = makePage();
  const box = new page.HTMLInputElement('time');
  page.api.syncAll();
  assert.equal(page.mark(box), 'empty');
  box.stepUp();
  assert.equal(box.value, '00:01');
  assert.equal(page.mark(box), null);
});

test('on an iPad the dashes sit in the middle and there is no typing look (it has a wheel)', () => {
  const page = makePage({ navigator: IPAD });
  const look = page.styles[0].textContent;
  assert.equal(look, page.api.css(true));
  assert.match(look, /input\[type="time"\]\{[^}]*background-position:calc\(50% \+ /, 'centred, where an iPad puts a time');
  assert.doesNotMatch(look, /datetime-edit|[{;]color:transparent/, 'nothing that could hide a time while the wheel is open');
  assert.doesNotMatch(page.api.css(false), /calc\(50% \+ -?[\d.]+em\) 50%/, 'a Mac keeps the dashes at the left');
  const box = new page.HTMLInputElement('time');
  box.validity.badInput = true;
  page.api.syncAll();
  assert.equal(page.mark(box), 'empty', 'no half-typed look on an iPad');
});

test('an old Safari that cannot draw part dashes shows a half-typed box as empty', () => {
  const page = makePage({ drawsParts: false });
  const box = new page.HTMLInputElement('time');
  box.validity.badInput = true;
  page.api.syncAll();
  assert.equal(page.mark(box), 'empty');
});

// ---- The look --------------------------------------------------------------
test('the CSS hides Safari\'s text and draws dashes, and cannot be outvoted', () => {
  const css = guard.css();
  const rule = start => css.split('\n').find(line => line.startsWith(start)) || '';
  for (const type of ['time', 'date']) {
    const look = rule(`input[type="${type}"][data-blank="empty"]:not(:focus){`);
    assert.match(look, /-webkit-text-fill-color:transparent !important/, `${type}: Safari's text is hidden`);
    assert.match(look, /background-image:[^;]+!important/, `${type}: dashes are drawn`);
    const layout = rule(`input[type="${type}"]{`);
    for (const prop of ['background-size', 'background-position', 'background-repeat', 'background-origin']) {
      assert.match(layout, new RegExp(`${prop}:[^;]+!important`), `${type}: ${prop} is !important (.field-in and .pb-field-busy set the whole background)`);
    }
  }
  assert.match(css, /:is\(input\[data-blank\]:focus,input\[data-blank="part"\]\)\{color:transparent !important\}/, 'while typing, the parts not typed yet are hidden');
  assert.match(css, /::-webkit-datetime-edit-hour-field/);
  assert.match(css, /-field:not\(:focus\)\{color:var\(--blank-time-ink/, 'what you typed keeps a solid colour');
  assert.match(css, /input\[data-blank\]\{-webkit-text-stroke-width:0 !important\}/, 'a text outline cannot trace the hidden letters');
  assert.match(css, /::-webkit-datetime-edit-meridiem-field/);
  assert.doesNotMatch(css, /:where\(/, ':where() would drop the rules below .pb-field-busy');
});

test('no repeating timer: the app keeps a budget of those', () => {
  assert.doesNotMatch(source, /setInterval|requestAnimationFrame/);
});

// ---- The wiring ------------------------------------------------------------
// Every page in the repo root and in outrangutan/, read from disk, so a new page cannot be missed.
const PAGES = ['', 'outrangutan/'].flatMap(dir => fs.readdirSync(new URL(`../../${dir}`, import.meta.url)).filter(name => name.endsWith('.html')).map(name => dir + name));
// Markup (type="time"), a built box (box.type = 'time') and setAttribute('type', 'time') all count.
const TIME_OR_DATE = /type\s*=\s*\\?["'](?:time|date)\\?["']|["']type["']\s*,\s*["'](?:time|date)["']/;
const pageAndScripts = page => {
  const html = read(page).replace(/<!--[\s\S]*?-->/g, ''); // a script tag inside a comment does not count
  const base = page.includes('/') ? page.slice(0, page.lastIndexOf('/') + 1) : '';
  const scripts = localScripts(html).map(src => base + src).filter(src => fs.existsSync(new URL(`../../${src}`, import.meta.url)));
  return { html, scripts };
};
const localScripts = html => [...html.matchAll(/<script[^>]*\ssrc="([^"?]+)(?:\?[^"]*)?"/g)].map(m => m[1]).filter(src => !/^https?:/.test(src));

test('every page that can show a time or date box loads the script', () => {
  const needing = [];
  for (const page of PAGES) {
    const { html, scripts } = pageAndScripts(page);
    const has = TIME_OR_DATE.test(html) || scripts.some(src => TIME_OR_DATE.test(read(src)));
    if (!has) continue;
    needing.push(page);
    assert.match(html, /<script src="cueola-blank-time\.js\?v=[\w.-]+"/, `${page} has a time or date box and must load cueola-blank-time.js`);
  }
  assert.deepEqual(needing.sort(), ['dashboard.html', 'index.html', 'script-operator.html']);
});

test('no date-and-time box: Safari paints 12:30 PM into those too, and the script does not cover them yet', () => {
  for (const page of PAGES) {
    const { html, scripts } = pageAndScripts(page);
    assert.doesNotMatch(html, /datetime-local/, `${page}: use a date box and a time box side by side instead`);
    for (const src of scripts) assert.doesNotMatch(read(src), /datetime-local/, `${src}: use a date box and a time box side by side instead`);
  }
});

test('it loads before the app, so it is watching before the app writes a time', () => {
  const index = read('index.html');
  assert.ok(index.indexOf('cueola-blank-time.js?v=') < index.indexOf('cueola-app.js?v='), 'index.html: before cueola-app.js');
  const dashboard = read('dashboard.html');
  assert.ok(dashboard.indexOf('cueola-blank-time.js?v=') < dashboard.indexOf('cueola-assignment-model.js?v='), 'dashboard.html: first script');
  const operator = read('script-operator.html');
  assert.match(operator, /<script src="cueola-blank-time\.js\?v=[\w.-]+" defer><\/script>/);
  assert.ok(operator.indexOf('cueola-blank-time.js?v=') < operator.indexOf('script-operator.js?v='), 'script-operator.html: before script-operator.js');
});

test('the offline cache, the cache bump and the contract check all know the file', () => {
  assert.match(read('sw.js'), /'cueola-blank-time\.js\?v=[\w.-]+'/);
  // Same recipe as scripts/bump-cache.mjs. An old number means installed Macs and iPads keep the old copy.
  const version = createHash('sha256').update(source).digest('hex').slice(0, 10);
  for (const file of ['index.html', 'dashboard.html', 'script-operator.html', 'sw.js']) {
    assert.ok(read(file).includes(`cueola-blank-time.js?v=${version}`), `${file} points at an old copy of cueola-blank-time.js: run node scripts/bump-cache.mjs`);
  }
  assert.match(read('scripts/bump-cache.mjs'), /'cueola-blank-time\.js'/);
  const contracts = read('scripts/check-contracts.mjs');
  for (const page of ['index', 'script-operator', 'dashboard']) {
    assert.match(contracts, new RegExp(`name: '${page}'[^\\n]*'cueola-blank-time\\.js'`), `check-contracts lists it for ${page}`);
  }
});

test('no time or date box ships with a value, and the prompter box names its colours', () => {
  for (const page of ['index.html', 'dashboard.html', 'script-operator.html']) {
    const tags = read(page).match(/<input[^>]*type="(?:time|date)"[^>]*>/g) || [];
    for (const tag of tags) assert.doesNotMatch(tag, /\svalue="[^"]+"/, `${page}: ${tag}`);
  }
  assert.match(read('index.html'), /\.flow-clock-fields input\{--blank-time-ink:var\(--pt-text/);
});

let failed = 0;
for (const { name, fn: run } of tests) {
  try { run(); console.log(`ok - ${name}`); }
  catch (error) { failed += 1; console.error(`not ok - ${name}\n${error.stack || error}`); }
}
console.log(`${tests.length - failed}/${tests.length} blank-time tests passed`);
if (failed) process.exit(1);
