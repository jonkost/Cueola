// Browser smoke test for the 3.0 cue cell editor and add-row sheet (demo
// show, no Firebase). The rundown table itself is 2.2.1's and stays.
// Run: node scripts/tests/cue-editor-smoke.browser.mjs  (serves the repo on 3016)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 3016;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'ok ' : 'FAIL'} - ${name}${detail ? ' · ' + detail : ''}`); };
const shots = process.env.SHOTS || '';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|AudioContext|gstatic|firebase/i.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.evaluate(() => loadDemo());
await page.waitForTimeout(500);

// The table is untouched: department columns, cells with READY and TAKE lines.
const table = await page.evaluate(() => ({ cols: [...document.querySelectorAll('.rd-head th')].map(t => t.textContent.trim()).filter(Boolean).join('|'), rows: document.querySelectorAll('#rdBody tr.cue-row').length, cell: (() => { const c = document.querySelector('.cue-cell-filled .cue-cell-info'); return c ? [c.querySelector('.cue-on-line')?.textContent.trim(), c.querySelector('.cue-off-line')?.textContent.trim()].join(' / ') : ''; })() }));
check('rundown table is 2.2.1: # Name Start/Dur + 6 departments', table.cols === '#|Name|Start / Dur|Video|Audio|Playback|GFX|Lighting|Script' && table.rows === 10, table.cols);
check('cells still show READY and TAKE lines', /^Ready .+ \/ .+/.test(table.cell || ''), table.cell);

// Open an empty video cell: READY/TAKE on top, camera pickers below, no tabs.
await page.evaluate(() => openCueConfig(beats[3].id, 'video'));
await page.waitForTimeout(250);
const ed = await page.evaluate(() => ({
  open: document.getElementById('cueConfigModal').classList.contains('on'),
  tabs: !!document.querySelector('.cc-tab-btn'),
  sections: [...document.querySelectorAll('#cueConfigFields .cc-section-lbl')].map(l => l.textContent.trim().replace(/\s+/g, ' ')),
  controls: document.querySelectorAll('#cueConfigFields button, #cueConfigFields input, #cueConfigFields textarea, #cueConfigFields select').length,
  info: document.querySelectorAll('#cueConfigModal .info-btn').length,
  title: document.getElementById('cueConfigTitle').textContent.trim(),
}));
if (shots) await page.screenshot({ path: join(shots, 'shot-editor-video.png') });
check('video editor: READY/TAKE plus three pickers, no tabs', ed.open && !ed.tabs && ed.sections.join(',') === 'Camera,Shot (optional),Transition (optional)', ed.sections.join(','));
check('video editor has under 30 controls (was 47)', ed.controls < 30, String(ed.controls));
check('editor title and lines carry ⓘ buttons', ed.info >= 2 && /Camera cue/.test(ed.title), ed.title);

// One tap on a camera and a shot writes both lines.
await page.tap('#ccp-src-chips .cc-chip:nth-child(2)');
await page.tap('#ccp-shot-chips .cc-chip:nth-child(2)');
await page.waitForTimeout(100);
let lines = await page.evaluate(() => [document.getElementById('cc-on-text').value, document.getElementById('cc-off-text').value]);
check('camera + shot tap → READY and TAKE lines', lines[0] === 'Ready CAM 2 · Medium' && lines[1] === 'Take CAM 2', lines.join(' / '));
await page.tap('#ccp-trans-chips .cc-chip:nth-child(2)');
lines = await page.evaluate(() => [document.getElementById('cc-on-text').value, document.getElementById('cc-off-text').value]);
check('transition tap changes the TAKE verb', lines[1] === 'Dissolve CAM 2', lines[1]);
// A hand-typed line wins over the pickers.
await page.fill('#cc-off-text', 'Dissolve to CAM 2, slow');
await page.tap('#ccp-src-chips .cc-chip:nth-child(3)');
lines = await page.evaluate(() => [document.getElementById('cc-on-text').value, document.getElementById('cc-off-text').value]);
check('a typed line is never overwritten by a picker', lines[1] === 'Dissolve to CAM 2, slow' && lines[0] === 'Ready CAM 2 · Medium', lines.join(' / '));
// ⓘ on touch.
await page.tap('#cueConfigFields .info-btn');
await page.waitForTimeout(150);
check('ⓘ opens teaching text on tap', await page.evaluate(() => !document.getElementById('infoPop').hidden && /READY/.test(document.getElementById('infoPop').textContent)));
await page.evaluate(() => closeInfoPop());
await page.tap('#cueConfigModal .btn-primary');
await page.waitForTimeout(200);
const saved = await page.evaluate(() => beats[3].cues.video);
check('save writes on/off and keeps the cell shape', saved.on === 'Ready CAM 2 · Medium' && saved.off === 'Dissolve to CAM 2, slow' && saved.notes === '', JSON.stringify(saved));

// Reopen a saved script cell: words + speaker, pickers seeded, links untouched.
await page.evaluate(() => openCueConfig(beats[2].id, 'script'));
await page.waitForTimeout(200);
const sc = await page.evaluate(() => ({ text: document.getElementById('cc-s-text').value.slice(0, 20), sections: [...document.querySelectorAll('#cueConfigFields .cc-section-lbl')].map(l => l.textContent.trim()), on: document.getElementById('cc-on-text').value }));
if (shots) await page.screenshot({ path: join(shots, 'shot-editor-script.png') });
check('script editor: who reads + the words, existing lines kept', sc.sections.join() === 'Speaker' && sc.text.startsWith('Good evening') && sc.on === 'Standby Host', JSON.stringify(sc));
await page.evaluate(() => hideModal('cueConfigModal'));

// Playback cell keeps its link block (Roll this clip on TAKE + pre-roll) and
// a saved cell keeps every field it had.
await page.evaluate(() => { beats[4].cues.playback.outCueId = 'cue_x'; beats[4].cues.playback.outAuto = true; beats[4].cues.playback.preRoll = 3; openCueConfig(beats[4].id, 'playback'); });
await page.waitForTimeout(200);
const pb = await page.evaluate(() => ({ auto: document.getElementById('cc-out-auto')?.checked, pre: document.getElementById('cc-out-preroll')?.value, clip: document.getElementById('ccp-clip')?.value, guided: !!document.getElementById('cc-guided-prep'), folded: document.querySelector('.cc-outrangutan')?.open === true, fire: !!document.getElementById('cc-out-fire') }));
check('playback editor: clip field; link block folded open only because it is linked; no fire buttons, no guided rows', pb.auto === true && pb.pre === '3' && !pb.guided && pb.folded && !pb.fire, JSON.stringify(pb));
await page.fill('#ccp-clip', 'SC_042_v2');
await page.tap('#cueConfigModal .btn-primary');
await page.waitForTimeout(200);
const pbs = await page.evaluate(() => beats[4].cues.playback);
check('playback save keeps the link and pre-roll, updates clip and the ROLL line; the OUT line stays as typed', pbs.outCueId === 'cue_x' && pbs.outAuto === true && pbs.preRoll === 3 && pbs.clip === 'SC_042_v2' && pbs.on === 'Roll SC_042_v2' && pbs.off === 'Roll SC_042', JSON.stringify(pbs));
check('no helper rows were generated', await page.evaluate(() => !beats.some(b => b.helperFor)));

// Add a row: one screen, name + kind + duration + first cue, one button.
await page.evaluate(() => openAddRow());
await page.waitForTimeout(250);
const ar = await page.evaluate(() => ({ steps: document.querySelectorAll('.ar-step').length, btn: document.getElementById('ar-next-1').textContent.trim(), cues: document.querySelectorAll('#arFirstCue .chip').length, min: document.getElementById('ar-min').value }));
if (shots) await page.screenshot({ path: join(shots, 'shot-addrow.png') });
check('add row is one screen with one button and a blank duration', ar.steps === 1 && ar.btn === 'Add row' && ar.cues === 6 && ar.min === '', JSON.stringify(ar));
await page.fill('#ar-name-input', 'Weather toss');
await page.fill('#ar-sec', '20');
await page.tap('#arcue-audio');
await page.tap('#ar-next-1');
await page.waitForTimeout(400);
const added = await page.evaluate(() => { const b = beats[beats.length - 1]; return { info: b.info, sec: b.sec, style: b.style, editorOpen: document.getElementById('cueConfigModal').classList.contains('on'), editorType: cueConfigType }; });
check('row added and the first cue opens at once', added.info === 'Weather toss' && added.sec === 20 && added.style === 'timed' && added.editorOpen && added.editorType === 'audio', JSON.stringify(added));
await page.tap('#ccp-src-chips .cc-chip:first-child');
await page.tap('#ccp-action-chips .cc-chip:first-child');
await page.tap('#cueConfigModal .btn-primary');
await page.waitForTimeout(200);
const au = await page.evaluate(() => beats[beats.length - 1].cues.audio);
check('audio cue from the add flow: 4 taps to a finished cell', au.on === 'Standby Host' && au.off === 'Open Host', JSON.stringify(au));

// Segment kind hides duration and first cue.
await page.evaluate(() => { openAddRow(); arSelectStyle('segment'); });
check('segment hides duration and first cue', await page.evaluate(() => document.getElementById('ar-dur-wrap').hidden && document.getElementById('ar-first-cue').hidden && document.getElementById('ar-next-1').textContent.trim() === 'Add segment'));
await page.evaluate(() => closeAddRowOv());

check('no console/page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
server.kill();
const failed = results.filter(r => !r.ok).length;
console.log(`${results.length - failed}/${results.length} cue editor smoke checks passed`);
process.exit(failed ? 1 : 0);
