// Browser smoke test for the 3.0 rundown (demo show, no Firebase): one type
// per cue, in-place editor, add-cue sheet, ⓘ on touch, no horizontal scroll.
// Run: node scripts/tests/rundown-smoke.browser.mjs  (serves the repo on 3012)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 3012;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'ok ' : 'FAIL'} - ${name}${detail ? ' · ' + detail : ''}`); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
// iPad portrait, touch.
const context = await browser.newContext({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: false });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|AudioContext|gstatic|firebase/i.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(1200);

await page.evaluate(() => loadDemo());
await page.waitForTimeout(500);

// Migration: every demo row has one type and a call line; no READY/TAKE pairs.
const migrated = await page.evaluate(() => beats.map(b => ({ type: b.type, line: CueolaCueModel.summary(b).line, off: Object.values(b.cues).some(c => c.off !== undefined), done: 'done' in b })));
check('every demo cue has one type', migrated.every(m => CueolaCueModel_types().includes(m.type)), JSON.stringify(migrated.map(m => m.type)));
function CueolaCueModel_types() { return ['camera', 'audio', 'graphic', 'playback', 'lighting', 'script']; }
check('every demo cue has a call line', migrated.every(m => m.line), migrated.map(m => m.line).join(' | '));
check('no cell keeps an off line, no beat keeps done', migrated.every(m => !m.off && !m.done));
check('PKG row became a playback cue', migrated[4].type === 'playback' && /^Roll SC_042/.test(migrated[4].line), migrated[4].line);

// The list renders one row per cue with number, type badge, name, line, duration.
const rows = await page.$$eval('#rdBody .cue-row:not(.segment-row)', els => els.map(el => ({
  num: el.querySelector('.cue-num')?.textContent.trim(),
  badge: el.querySelector('.cue-type-badge')?.textContent.trim(),
  name: el.querySelector('.cue-name')?.textContent.trim(),
  line: el.querySelector('.cue-line')?.textContent.trim(),
  dur: el.querySelector('.cue-dur')?.textContent.trim(),
  h: el.getBoundingClientRect().height,
})));
check('10 collapsed rows, one line each', rows.length === 10 && rows.every(r => r.num && r.badge && r.name && r.line && r.dur), `${rows.length} rows; first: ${JSON.stringify(rows[0])}`);
check('rows are compact and tappable (44–80px)', rows.every(r => r.h >= 44 && r.h <= 80), rows.map(r => Math.round(r.h)).join(','));
check('no table, no department columns', await page.evaluate(() => !document.querySelector('#rdBody table') && !document.querySelector('.rd-head')));
const scroll = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth <= window.innerWidth, list: (() => { const s = document.querySelector('.rd-scroll'); return s.scrollWidth <= s.clientWidth + 1; })() }));
check('no horizontal scroll at iPad width', scroll.doc && scroll.list, JSON.stringify(scroll));

// Tap a row: the editor opens in place with the type's fields.
await page.tap('#rdBody .cue-row:not(.segment-row) .cue-row-main');
await page.waitForTimeout(200);
const editor = await page.evaluate(() => {
  const ed = document.querySelector('#rdBody .cue-row.is-open .cue-editor');
  return ed ? { fields: [...ed.querySelectorAll('.cue-ed-fields .field-lbl')].map(l => l.textContent.trim()), type: document.querySelector('.cue-type-pick.sel')?.textContent.trim(), info: ed.querySelectorAll('.info-btn').length } : null;
});
check('tap opens the editor in place', !!editor, JSON.stringify(editor));
check('graphic cue shows graphic fields only', editor && editor.type === 'Graphic' && editor.fields.join(',') === 'Graphic,On-screen text', editor?.fields.join(','));
check('every field has a ⓘ button', editor && editor.info >= 5, String(editor?.info));

// ⓘ works on touch.
await page.tap('#rdBody .cue-row.is-open .cue-ed-fields .info-btn');
await page.waitForTimeout(150);
const pop = await page.evaluate(() => { const el = document.getElementById('infoPop'); return { open: !el.hidden, text: el.textContent.trim().slice(0, 40) }; });
check('ⓘ opens teaching text on tap', pop.open && pop.text.length > 10, pop.text);
await page.evaluate(() => closeInfoPop());

// Typing updates the collapsed line and the data, and saves on a debounce.
const openId = await page.evaluate(() => expandedCueId);
await page.fill(`#cf-${openId}-gfx-text`, 'Campus News');
await page.waitForTimeout(100);
const typed = await page.evaluate(id => ({ line: document.querySelector(`#rdBody .cue-row[data-id="${id}"] .cue-line`).textContent.trim(), on: beats.find(b => b.id === id).cues.gfx.on, text: beats.find(b => b.id === id).cues.gfx.text }), openId);
check('typing rewrites the call line live', typed.text === 'Campus News' && typed.on === 'Countdown: Campus News' && typed.line.startsWith('Countdown: Campus News'), JSON.stringify(typed));
// A remote render while typing does not wipe the field.
await page.focus(`#cf-${openId}-gfx-text`);
await page.evaluate(() => renderRundown());
const kept = await page.evaluate(id => document.activeElement?.id === `cf-${id}-gfx-text` && document.activeElement.value, openId);
check('a render while typing keeps the field and focus', kept === 'Campus News', String(kept));

// Duration change moves the next row's start time.
await page.fill(`#rdBody .cue-row[data-id="${openId}"] .cue-dur-in input[aria-label="Minutes"]`, '1');
await page.waitForTimeout(100);
const starts = await page.$$eval('#rdBody .cue-row:not(.segment-row) .cue-start', els => els.slice(0, 2).map(e => e.textContent.trim()));
check('duration edits move the next start time', starts[1] && starts[1] !== starts[0], starts.join(' → '));

// Add cue: type → name → duration → Add.
await page.evaluate(() => toggleCueOpen(expandedCueId));
await page.tap('#rdBody .add-row-btn-el');
await page.waitForTimeout(250);
check('add sheet opens with the type grid first', await page.evaluate(() => document.getElementById('addRowOv').classList.contains('on') && document.querySelectorAll('#addCueTypes .opt-card').length === 7 && document.getElementById('ac-add').disabled));
await page.tap('#actype-camera');
await page.fill('#ac-name', 'Anchor two-shot');
await page.fill('#ac-sec', '45');
await page.tap('#ac-add');
await page.waitForTimeout(300);
const added = await page.evaluate(() => { const b = beats[beats.length - 1]; return { type: b.type, info: b.info, sec: b.sec, style: b.style, cells: Object.keys(b.cues), open: expandedCueId === b.id, sheet: document.getElementById('addRowOv').classList.contains('on') }; });
check('three taps and two inputs add a camera cue', added.type === 'camera' && added.info === 'Anchor two-shot' && added.sec === 45 && added.style === 'timed' && added.cells.join() === 'video' && !added.sheet, JSON.stringify(added));
check('the new cue opens for its call', added.open);
const newId = await page.evaluate(() => beats[beats.length - 1].id);
await page.fill(`#cf-${newId}-video-camera`, 'CAM 3');
await page.tap(`#rdBody .cue-row[data-id="${newId}"] .cue-choice .chip:nth-child(2)`);
await page.waitForTimeout(100);
check('camera + shot chips make the call line', (await page.evaluate(id => beats.find(b => b.id === id).cues.video.on, newId)) === 'CAM 3 · Medium');

// Change type keeps the old call as an extra; segment add works.
await page.tap(`#rdBody .cue-row[data-id="${newId}"] .cue-type-pick:nth-child(2)`);
await page.waitForTimeout(150);
const retyped = await page.evaluate(id => { const b = beats.find(b => b.id === id); return { type: b.type, cells: Object.keys(b.cues).sort().join(), extras: CueolaCueModel.summary(b).extras.join() }; }, newId);
check('changing type keeps the camera call as an extra', retyped.type === 'audio' && retyped.cells === 'audio,video' && retyped.extras === 'camera', JSON.stringify(retyped));

// 40 cues stay scannable: render a long rundown and measure.
await page.evaluate(() => { for (let i = 0; i < 30; i++) beats.push(CueolaCueModel.newBeat({ id: nextBeatId(), type: ['camera', 'audio', 'graphic', 'playback', 'lighting', 'script'][i % 6], name: `Cue ${i}`, sec: 20 })); expandedCueId = null; renderRundown({ force: true }); });
const long = await page.evaluate(() => ({ rows: document.querySelectorAll('#rdBody .cue-row:not(.segment-row)').length, wide: (() => { const s = document.querySelector('.rd-scroll'); return s.scrollWidth <= s.clientWidth + 1; })(), perScreen: Math.floor(document.querySelector('.rd-scroll').clientHeight / document.querySelector('#rdBody .cue-row:not(.segment-row)').getBoundingClientRect().height) }));
check('41 cues, no horizontal scroll, 12+ cues per screen', long.rows === 41 && long.wide && long.perScreen >= 12, JSON.stringify(long));

// Live shows the same call lines (grid + focus) with no READY/TAKE pairs.
await page.evaluate(() => goLive());
await page.waitForTimeout(500);
const live = await page.evaluate(() => ({ head: [...document.querySelectorAll('.live-grid th')].map(t => t.textContent.trim()).join('|'), firstCall: document.querySelector('.live-grid .live-cue-cell')?.textContent.trim(), ready: /READY|TAKE/.test(document.querySelector('.live-grid tbody')?.textContent || ''), wide: (() => { const s = document.getElementById('lsBody'); return s.scrollWidth <= s.clientWidth + 1; })() }));
check('live grid = # · State · Cue · Call · Time', live.head === '#|State|Cue|Call|Time', live.head);
check('live rows carry the call line, no READY/TAKE pairs', live.firstCall && !live.ready, live.firstCall);
check('live grid has no horizontal scroll at iPad width', live.wide);
await page.evaluate(() => { liveFocusMode = true; renderLive(); });
const focus = await page.evaluate(() => document.querySelector('.lf-cues')?.textContent.trim().slice(0, 60));
check('focus view shows the call lines', !!focus, focus);

check('no console/page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
server.kill();
const failed = results.filter(r => !r.ok).length;
console.log(`${results.length - failed}/${results.length} rundown smoke checks passed`);
process.exit(failed ? 1 : 0);
