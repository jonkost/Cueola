// Safari check: an empty time or date box never shows a time or a date.
//
// Safari paints "12:30 PM" into an empty time box and today's date into an
// empty date box. Chrome paints dashes. Every earlier fix for "the time fields
// default to 12:30" was checked in Chrome, passed, and changed nothing in
// Safari. So this check runs the real app in WebKit, Safari's own engine, and
// looks at the pixels: with cueola-blank-time.js loaded, Safari's own text must
// add nothing to an empty box, and a real time must still show.
//
// Run: node scripts/tests/blank-time-safari.browser.mjs
// On a Mac (needs swiftc, part of the Xcode command line tools) it runs the
// full check in WebKit. Anywhere else there is no Safari engine, so it runs a
// smaller check in Chrome with the script switched on by hand: the marks and
// the CSS, not the pixels. The full check still has to pass on a Mac before a
// change to time or date boxes goes live. Starts a static server on 3017.
// This is the Mac engine. It does not prove the look on an iPad.
// Set BLANK_TIME_SHOTS=/some/folder to keep pictures of what Safari showed.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '../..');
const PORT = 3017;
// BLANK_TIME_ENGINE=chrome runs the smaller Chrome check on a Mac too.
const hasWebKit = process.platform === 'darwin' && spawnSync('xcrun', ['--find', 'swiftc']).status === 0;
const useWebKit = hasWebKit && process.env.BLANK_TIME_ENGINE !== 'chrome';

// The port is fixed. If something else already holds it, the pages would come
// from that other server (maybe another folder) and the result would be a lie.
function startServer() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: repo, stdio: 'ignore' });
  return new Promise(resolve => setTimeout(() => {
    if (server.exitCode !== null) {
      console.error(`FAIL - could not start the test server on port ${PORT}. Something else is using it (an old run?).`);
      console.error(`        Fix: run  lsof -ti tcp:${PORT} | xargs kill  in Terminal, then run this check again.`);
      process.exit(1);
    }
    resolve(server);
  }, 800));
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'ok ' : 'FAIL'} - ${name}${detail ? ' · ' + detail : ''}`); };
const note = text => console.log(`note - ${text}`);
function finish(label, crashed = false) {
  const bad = results.filter(r => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} ${label} passed`);
  if (!useWebKit) console.log('NOT CHECKED IN SAFARI. A change to a time or date box is not done until this check passes on a Mac.');
  process.exit(bad || crashed ? 1 : 0);
}

// ---- The smaller check, in Chrome -------------------------------------------
// Chrome paints dashes by itself, so the script stays off there. Here it is
// switched on by hand to prove the marks and the CSS work in the real app.
if (!useWebKit) {
  // A Mac always has Safari's engine. If the Swift compiler is missing (it goes
  // missing after some macOS updates), say so in red: a skip here would look green.
  if (process.platform === 'darwin' && process.env.BLANK_TIME_ENGINE !== 'chrome') {
    console.error('FAIL - this is a Mac, but the Swift compiler is missing, so Safari\'s engine was not checked.');
    console.error('        Fix: run  xcode-select --install  in Terminal, then run this check again.');
    process.exit(1);
  }
  let chromium;
  try {
    ({ chromium } = await import(process.env.CUEOLA_PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs'));
  } catch {
    console.log('skip - no Safari engine and no Playwright on this machine');
    console.log('        the full check still has to pass on a Mac before a change to time or date boxes goes live');
    process.exit(0);
  }
  note('no Safari engine here: checking the marks and the CSS in Chrome. The pixel check must still pass on a Mac.');
  const server = await startServer();
  const linuxChrome = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  let browser;
  let crashed = false;
  try {
    browser = await chromium.launch(fs.existsSync(linuxChrome) ? { executablePath: linuxChrome, args: ['--no-sandbox'] } : { channel: 'chrome' });
    const page = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const look = sel => page.evaluate(s => { const el = document.querySelector(s); const cs = getComputedStyle(el); return { value: el.value, blank: el.getAttribute('data-blank'), fill: cs.webkitTextFillColor, color: cs.color, dashes: cs.backgroundImage.includes('gradient') }; }, sel);
    const CLEAR = 'rgba(0, 0, 0, 0)';

    check('Chrome leaves the script off by itself', await page.evaluate(() => Boolean(window.CueolaBlankTime) && !document.getElementById('cueola-blank-time-style')));
    await page.evaluate(() => { loadDemo(); openPaperworkHub(); openPaperworkItem('call-sheet'); CueolaBlankTime.install(true); });
    await page.waitForTimeout(600);
    const boxes = await page.evaluate(() => [...document.querySelectorAll('input[type="time"],input[type="date"]')].map(el => ({ id: el.id || el.dataset.callField, value: el.value, blank: el.getAttribute('data-blank') })));
    check('every time and date box is found', boxes.length >= 13, `${boxes.length} boxes`);
    check('every empty box is marked empty', boxes.every(b => b.value !== '' || b.blank === 'empty'), boxes.filter(b => b.value === '' && b.blank !== 'empty').map(b => b.id).join(', '));

    for (const sel of ['#pp-call', '#pp-date']) {
      const empty = await look(sel);
      check(`${sel} empty: the browser's text is hidden and dashes are drawn`, empty.blank === 'empty' && empty.fill === CLEAR && empty.dashes, JSON.stringify(empty));
    }
    // .pb-field-busy (a teammate is in the box) sets the whole background with !important.
    await page.evaluate(() => document.querySelector('#pp-call').classList.add('pb-field-busy'));
    check('the dashes survive the "teammate is editing" highlight', (await look('#pp-call')).dashes);
    await page.evaluate(() => document.querySelector('#pp-call').classList.remove('pb-field-busy'));

    await page.focus('#pp-wrap');
    const focused = await look('#pp-wrap');
    check('in an empty box: host text is clear, the drawn dashes step aside', focused.color === CLEAR && !focused.dashes, JSON.stringify(focused));

    await page.fill('#pp-call', '09:15');
    await page.focus('#pp-location');
    const typed = await look('#pp-call');
    check('a typed time is kept, not marked, and visible', typed.value === '09:15' && typed.blank === null && typed.fill !== CLEAR && typed.color !== CLEAR && !typed.dashes, JSON.stringify(typed));

    await page.evaluate(() => estimateWrapFromRundown());
    const written = await look('#pp-wrap');
    check('a time the app writes is not marked and visible', /^\d\d:\d\d$/.test(written.value) && written.blank === null && written.fill !== CLEAR && !written.dashes, JSON.stringify(written));
    await page.evaluate(() => toggleWrapNotApplicable());
    const na = await look('#pp-wrap');
    check('an N/A box goes back to dashes', na.blank === 'empty' && na.fill === CLEAR && na.dashes, JSON.stringify(na));

    await page.evaluate(() => addCallSheetPerson());
    await page.waitForTimeout(300);
    const crew = await page.evaluate(() => [...document.querySelectorAll('#pp-crew-grid input[type=time]')].map(el => el.getAttribute('data-blank')));
    check('rebuilt crew rows are marked empty', crew.length >= 2 && crew.every(mark => mark === 'empty'), JSON.stringify(crew));
  } catch (error) {
    crashed = true;
    console.error(`FAIL - ${error.message}`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  finish('blank-time checks (Chrome, script forced on)', crashed);
}

// ---- The full check, in WebKit ----------------------------------------------
// Build the WebKit runner once; rebuild only when its source changes.
const runnerSource = path.join(here, 'webkit-runner.swift');
const runnerHash = createHash('sha256').update(fs.readFileSync(runnerSource)).digest('hex').slice(0, 12);
const runner = path.join(os.tmpdir(), `cueola-webkit-runner-${runnerHash}`);
if (!fs.existsSync(runner)) {
  console.log('building the WebKit runner (first run only)...');
  const built = spawnSync('xcrun', ['swiftc', '-O', runnerSource, '-o', runner], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (built.status !== 0) { console.error(built.stderr); console.error('FAIL - could not build scripts/tests/webkit-runner.swift'); process.exit(1); }
}

const server = await startServer();

// Runs a list of steps in WebKit and hands back the named results.
function runPage(page, steps) {
  const file = path.join(os.tmpdir(), `cueola-webkit-steps-${process.pid}-${page.replace(/\W/g, '_')}.json`);
  fs.writeFileSync(file, JSON.stringify(steps));
  const run = spawnSync(runner, [`http://127.0.0.1:${PORT}/${page}`, file, '1014', '885'], { encoding: 'utf8', timeout: 120000 });
  fs.rmSync(file, { force: true });
  const named = {};
  for (const line of (run.stdout || '').split('\n')) {
    if (!line.startsWith('{')) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (parsed.fatal) throw new Error(`${page}: ${parsed.fatal}`);
    if (parsed.error) throw new Error(`${page} step ${parsed.step}${parsed.name ? ' (' + parsed.name + ')' : ''}: ${parsed.error}`);
    if (parsed.name) named[parsed.name] = parsed.kind === 'diff' ? parsed.different : parsed.value;
  }
  if (run.status !== 0) throw new Error(`${page}: the WebKit runner stopped early (${run.signal || run.status})`);
  return named;
}

// ---- Small helpers that run inside the page ---------------------------------
// tools.rule(css): one extra CSS rule the check switches on and off.
// tools.guard(on): turn the blank-time look off to see what Safari paints alone.
const TOOLS = `
  const still = document.createElement('style');
  still.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}';
  document.head.appendChild(still);
  const extra = document.createElement('style');
  document.head.appendChild(extra);
  window.tools = {
    rule(css) { extra.textContent = css || ''; },
    guard(on) { const look = document.getElementById('cueola-blank-time-style'); if (look) look.disabled = !on; },
    state(sel) { const el = document.querySelector(sel); return el ? { value: el.value, blank: el.getAttribute('data-blank'), disabled: el.disabled } : null; },
    typeIn(sel, value) { const el = document.querySelector(sel); el.focus(); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); },
  };`;
const js = (name, code, wait = 250) => ({ name, js: code, wait });
const PARTS = ['hour', 'minute', 'meridiem', 'month', 'day', 'year'];
// Hides everything Safari itself draws inside the box.
const hideSafariText = sel => `${sel}::-webkit-datetime-edit{visibility:hidden !important}`;
// Hides only the digits of the named parts (leaves dashes and the colon alone).
const hideDigits = (sel, parts = PARTS) => parts.map(p => `${sel}::-webkit-datetime-edit-${p}-field`).join(',') + '{-webkit-text-fill-color:transparent !important}';
const hideDashes = sel => `input${sel}[data-blank]:not(:focus){background-image:none !important}`;
// Photograph a box, switch one CSS rule on, photograph it again, count the pixels that changed.
const compare = (name, sel, css) => [
  { shot: `${name}-before`, selector: sel },
  js(null, `tools.rule(${JSON.stringify(css)}); return 1`),
  { shot: `${name}-after`, selector: sel },
  { name, diff: [`${name}-before`, `${name}-after`] },
  js(null, 'tools.rule(""); return 1'),
];
const shotsDir = process.env.BLANK_TIME_SHOTS;
const picture = file => (shotsDir ? [{ png: path.join(shotsDir, file), wait: 100 }] : []);
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

let failed = false;
try {
  // ---- The call sheet in index.html ----------------------------------------
  const sheet = runPage('index.html', [
    js('ready', `${TOOLS}
      try { localStorage.removeItem('cueola_prepro_DEMO1'); } catch (e) {}
      loadDemo(); setPlandaBearTheme('honey'); openPaperworkHub(); openPaperworkItem('call-sheet');
      return { guard: Boolean(window.CueolaBlankTime), style: Boolean(document.getElementById('cueola-blank-time-style')), vendor: navigator.vendor };`, 1500),
    js('boxes', `document.querySelector('#pp-call').scrollIntoView({ block: 'center' });
      return [...document.querySelectorAll('input[type="time"],input[type="date"]')].map(el => { const cs = getComputedStyle(el); return { id: el.id || el.dataset.callField, type: el.type, value: el.value, blank: el.getAttribute('data-blank'), hidden: cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)', dashes: cs.backgroundImage.includes('gradient') }; });`, 400),
    ...picture('1-empty-call-sheet.png'),

    // An empty time box and an empty date box, left alone.
    ...compare('time: Safari text adds nothing', '#pp-call', hideSafariText('#pp-call')),
    ...compare('time: dashes are drawn', '#pp-call', hideDashes('#pp-call')),
    ...compare('date: Safari text adds nothing', '#pp-date', hideSafariText('#pp-date')),
    ...compare('date: dashes are drawn', '#pp-date', hideDashes('#pp-date')),
    // The same boxes with the look switched off: this is the bug itself.
    js(null, 'tools.guard(false); return 1'),
    ...compare('control: bare Safari paints a time', '#pp-call', hideSafariText('#pp-call')),
    ...compare('control: bare Safari paints a date', '#pp-date', hideSafariText('#pp-date')),
    js(null, 'tools.guard(true); return 1'),

    // In an empty box, about to type: no made-up digits.
    js('has the keyboard', 'const box = document.querySelector("#pp-wrap"); box.focus(); return box.matches(":focus") && document.hasFocus()', 400),
    ...compare('typing: empty box shows no digits', '#pp-wrap', hideDigits('#pp-wrap')),
    js(null, 'tools.guard(false); return 1'),
    ...compare('control: bare Safari shows digits while typing', '#pp-wrap', hideDigits('#pp-wrap')),
    js(null, 'tools.guard(true); return 1'),
    ...picture('2-in-an-empty-box.png'),

    // Type only the hour. The hour shows; the minutes and AM/PM stay dashes.
    { keys: '9', wait: 400 },
    js('after the hour', 'return tools.state("#pp-wrap")'),
    ...compare('typing: the typed hour shows', '#pp-wrap', hideDigits('#pp-wrap', ['hour'])),
    ...compare('typing: untyped parts show no digits', '#pp-wrap', hideDigits('#pp-wrap', ['minute', 'meridiem'])),
    // Click away with the time half typed.
    js('left half typed', 'document.querySelector("#pp-location").focus(); return tools.state("#pp-wrap")', 400),
    ...compare('half typed: the typed hour still shows', '#pp-wrap', hideDigits('#pp-wrap', ['hour'])),
    ...compare('half typed: untyped parts show no digits', '#pp-wrap', hideDigits('#pp-wrap', ['minute', 'meridiem'])),
    ...picture('3-half-typed.png'),

    // A real time, typed the way a person would. It must show.
    js('typed a time', 'tools.typeIn("#pp-call", "09:15"); return tools.state("#pp-call")', 500),
    ...compare('a real time shows', '#pp-call', hideSafariText('#pp-call')),
    // The app writes a time itself (the Rundown button; a teammate's edit arrives the same way).
    js('app wrote a time', 'estimateWrapFromRundown(); return tools.state("#pp-wrap")', 500),
    ...compare('a time the app wrote shows', '#pp-wrap', hideSafariText('#pp-wrap')),
    // N/A clears the box and locks it.
    js('not applicable', 'toggleWrapNotApplicable(); return tools.state("#pp-wrap")', 400),
    ...compare('N/A box: Safari text adds nothing', '#pp-wrap', hideSafariText('#pp-wrap')),
    // Crew rows are rebuilt from scratch each time one is added.
    js('crew rows', 'addCallSheetPerson(); return new Promise(done => setTimeout(() => done([...document.querySelectorAll("#pp-crew-grid input[type=time]")].map(el => el.getAttribute("data-blank"))), 300))', 300),
    ...picture('4-filled-in.png'),

    // Half type a time, then let the app empty the box. Safari would keep the
    // typed digits on screen; the box must go back to dashes.
    js(null, 'const doors = document.querySelector("#pp-doors"); doors.scrollIntoView({ block: "center" }); doors.focus(); return 1', 400),
    { keys: '7', wait: 400 },
    js('half typed, then N/A', 'const before = tools.state("#pp-doors"); document.querySelector("#pp-location").focus(); toggleDoorsNotApplicable(); return { before, after: tools.state("#pp-doors") }', 400),
    ...compare('N/A after half typing: no digits left', '#pp-doors', hideDigits('#pp-doors')),
    js(null, 'document.querySelector("#pp-meal-time").scrollIntoView({ block: "center" }); document.querySelector("#pp-meal-time").focus(); return 1', 400),
    { keys: '9', wait: 400 },
    js('half typed, then a new sheet', 'const before = tools.state("#pp-meal-time"); document.querySelector("#pp-location").focus(); addAnotherCallSheet(); return new Promise(done => setTimeout(() => done({ before, after: tools.state("#pp-meal-time") }), 600))', 400),
    ...compare('new sheet after half typing: no digits left', '#pp-meal-time', hideDigits('#pp-meal-time')),

    // Type only the month into the date box. The month shows; day and year stay dashes.
    js(null, 'const day = document.querySelector("#pp-date"); day.scrollIntoView({ block: "center" }); day.focus(); return 1', 400),
    { keys: '1', wait: 400 },
    js('after the month', 'return tools.state("#pp-date")'),
    ...compare('date: the typed month shows', '#pp-date', hideDigits('#pp-date', ['month'])),
    ...compare('date: untyped parts show no digits', '#pp-date', hideDigits('#pp-date', ['day', 'year'])),
  ]);

  check('the blank-time script is running in Safari\'s engine', sheet.ready?.guard && sheet.ready?.style, sheet.ready?.vendor);
  const boxes = sheet.boxes || [];
  check('every time and date box is found', boxes.length >= 13, `${boxes.length} boxes`);
  check('every empty box is marked empty', boxes.length > 0 && boxes.every(b => b.value !== '' || b.blank === 'empty'), boxes.filter(b => b.value === '' && b.blank !== 'empty').map(b => b.id).join(', '));
  check('no box with a value is marked', boxes.every(b => b.value === '' || b.blank === null));
  check('every empty box hides Safari\'s text and draws dashes', boxes.length > 0 && boxes.every(b => b.value !== '' || (b.hidden && b.dashes)), boxes.filter(b => b.value === '' && !(b.hidden && b.dashes)).map(b => b.id).join(', '));

  check('empty time box: Safari paints nothing of its own', sheet['time: Safari text adds nothing'] === 0, `${sheet['time: Safari text adds nothing']} pixels`);
  check('empty time box: the --:-- dashes are drawn', sheet['time: dashes are drawn'] > 0, `${sheet['time: dashes are drawn']} pixels`);
  check('empty date box: Safari paints nothing of its own', sheet['date: Safari text adds nothing'] === 0, `${sheet['date: Safari text adds nothing']} pixels`);
  check('empty date box: the --/--/---- dashes are drawn', sheet['date: dashes are drawn'] > 0, `${sheet['date: dashes are drawn']} pixels`);
  if (sheet['control: bare Safari paints a time'] > 0 && sheet['control: bare Safari paints a date'] > 0) note('control: without the script this Safari does paint a time and a date into empty boxes');
  else note('control: this Safari paints nothing into an empty box even without the script (the engine changed; the script is now a safety net)');

  check('the box being typed in really has the keyboard', sheet['has the keyboard'] === true, 'without it the typing checks below prove nothing');
  check('in an empty box, before typing: no made-up digits', sheet['typing: empty box shows no digits'] === 0, `${sheet['typing: empty box shows no digits']} pixels`);
  if (!(sheet['control: bare Safari shows digits while typing'] > 0)) note('control: bare Safari shows no digits in a focused empty box either');

  check('half a time typed: nothing is saved yet', sheet['after the hour']?.value === '', JSON.stringify(sheet['after the hour']));
  check('half a time typed: the hour you typed shows', sheet['typing: the typed hour shows'] > 0);
  check('half a time typed: minutes and AM/PM show no digits', sheet['typing: untyped parts show no digits'] === 0, `${sheet['typing: untyped parts show no digits']} pixels`);
  check('left half typed: the box is marked part', sheet['left half typed']?.blank === 'part', JSON.stringify(sheet['left half typed']));
  check('left half typed: the hour you typed still shows', sheet['half typed: the typed hour still shows'] > 0);
  check('left half typed: no made-up minutes or PM', sheet['half typed: untyped parts show no digits'] === 0, `${sheet['half typed: untyped parts show no digits']} pixels`);

  check('a typed time is kept and not marked', sheet['typed a time']?.value === '09:15' && sheet['typed a time']?.blank === null, JSON.stringify(sheet['typed a time']));
  check('a typed time is visible', sheet['a real time shows'] > 0);
  check('a time the app writes is not marked', /^\d\d:\d\d$/.test(sheet['app wrote a time']?.value || '') && sheet['app wrote a time']?.blank === null, JSON.stringify(sheet['app wrote a time']));
  check('a time the app writes is visible', sheet['a time the app wrote shows'] > 0);
  check('an N/A box is empty, with nothing painted by Safari', sheet['not applicable']?.disabled === true && sheet['not applicable']?.blank === 'empty' && sheet['N/A box: Safari text adds nothing'] === 0, JSON.stringify(sheet['not applicable']));
  const crew = sheet['crew rows'] || [];
  check('rebuilt crew rows are marked empty', crew.length >= 2 && crew.every(mark => mark === 'empty'), JSON.stringify(crew));

  const na = sheet['half typed, then N/A'];
  check('half typed, then N/A: the box goes back to dashes', na?.before?.blank === 'part' && na?.after?.blank === 'empty' && na?.after?.disabled === true && sheet['N/A after half typing: no digits left'] === 0, JSON.stringify(na));
  const fresh = sheet['half typed, then a new sheet'];
  check('half typed, then a new call sheet: the new sheet starts with dashes', fresh?.before?.blank === 'part' && fresh?.after?.blank === 'empty' && sheet['new sheet after half typing: no digits left'] === 0, JSON.stringify(fresh));

  check('half a date typed: nothing is saved yet', sheet['after the month']?.value === '', JSON.stringify(sheet['after the month']));
  check('half a date typed: the month you typed shows', sheet['date: the typed month shows'] > 0);
  check('half a date typed: day and year show no digits', sheet['date: untyped parts show no digits'] === 0, `${sheet['date: untyped parts show no digits']} pixels`);

  // ---- The other two pages with a time box ---------------------------------
  const state = ids => `return { guard: Boolean(window.CueolaBlankTime && document.getElementById('cueola-blank-time-style')), boxes: ${JSON.stringify(ids)}.map(id => { const el = document.getElementById(id); if (!el) return 'missing'; const cs = getComputedStyle(el); const drawn = cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)' && cs.backgroundImage.includes('gradient'); return el.getAttribute('data-blank') + (drawn ? '' : ', but the made-up time is not hidden behind dashes'); }) };`;
  const dash = runPage('dashboard.html', [js('state', state(['new-start', 'detail-start-input']), 300)]).state;
  check('dashboard: both start-time boxes are marked empty', dash?.guard && dash.boxes.every(mark => mark === 'empty'), JSON.stringify(dash));
  const op = runPage('script-operator.html', [js('state', state(['countToTime']), 300)]).state;
  check('Script Operator: the Count to box is marked empty', op?.guard && op.boxes.every(mark => mark === 'empty'), JSON.stringify(op));
} catch (error) {
  failed = true;
  console.error(`FAIL - ${error.message}`);
} finally {
  server.kill();
}

finish('Safari blank-time checks', failed);
