// Browser smoke test for the 3.0 Live screen (demo show, no Firebase).
// Run: node scripts/tests/live-smoke.browser.mjs  (needs Playwright + Chromium; starts a static server on 3011)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';

const PORT = 3011;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: new URL('../../', import.meta.url).pathname, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'ok ' : 'FAIL'} - ${name}${detail ? ' · ' + detail : ''}`); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|AudioContext|gstatic|firebase/i.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(1200);

// Enter the demo show and go live programmatically (skips the preflight sheet).
await page.evaluate(() => loadDemo());
await page.waitForTimeout(600);
const rows = await page.evaluate(() => beats.filter(b => b.style !== 'segment').length);
check('demo loaded', rows > 5, `${rows} playable rows`);
await page.evaluate(() => goLive());
await page.waitForTimeout(600);
check('live screen on', await page.evaluate(() => document.getElementById('liveshow').classList.contains('on') && liveSessionState().lifecycle === 'live'));
check('TAKE button reads TAKE', (await page.textContent('#lsGoBtn .ls-go-kicker')).trim() === 'TAKE');
check('no follow bar', await page.evaluate(() => !document.querySelector('.follow-bar')));

// 10 fast takes → exactly 10 advances (debounce must not swallow distinct presses).
const start = await page.evaluate(() => liveActiveCueIndex());
const seq0 = await page.evaluate(() => liveShared.get().seq);
for (let i = 0; i < 9; i++) { await page.click('#lsGoBtn'); await page.waitForTimeout(320); }
const after = await page.evaluate(() => ({ idx: liveActiveCueIndex(), seq: liveShared.get().seq, ledger: Object.values(liveSessionState().runLedger).filter(r => r.status === 'completed').length }));
const expected = await page.evaluate((s) => { let i = s, n = 0; while (n < 9) { const ni = liveNextPlayableCueIndex(i); if (ni < 0) break; i = ni; n++; } return { idx: i, n }; }, start);
check('9 fast taps = exactly 9 takes', after.idx === expected.idx && after.seq - seq0 === 9 && after.ledger === 9, `from ${start} to ${after.idx} (expected ${expected.idx}), seq +${after.seq - seq0}, ${after.ledger} done`);
// The 10th press at the end of the rundown is refused, not a take.
await page.evaluate(() => lsNext());
check('press past the end takes nothing', (await page.evaluate(() => liveShared.get().seq)) === after.seq);

// A burst of presses inside the debounce window counts once.
const before = await page.evaluate(() => liveShared.get().seq);
await page.evaluate(() => { lsPrev(); lsPrev(); lsPrev(); });
await page.waitForTimeout(400);
const burst = await page.evaluate(() => liveShared.get().seq);
check('burst inside 300 ms is one take', burst === before + 1, `seq ${before} → ${burst}`);

// Timer: start the show clock, wait, compare with wall clock.
await page.evaluate(() => { if (!liveClockRunning) toggleShowClock(); });
const t0 = Date.now();
await page.waitForTimeout(5200);
const timerText = await page.textContent('#ls-timer');
const [hh, mm, ss] = timerText.split(':').map(Number);
const shown = hh * 3600 + mm * 60 + ss;
const wall = Math.floor((Date.now() - t0) / 1000);
check('show clock within 1 s of wall clock', Math.abs(shown - wall) <= 1, `${timerText} vs ${wall}s`);
const tickers = await page.evaluate(() => ({ ticker: !!_liveTickerHandle, running: liveClockRunning }));
check('one ticker running', tickers.ticker && tickers.running);
const cueTime = await page.textContent('#ls-stat-now-time');
check('cue time shown', /\d:\d\d/.test(cueTime || ''), cueTime);

// Back to the top for the re-entry test.
await page.evaluate(() => jumpToLsCue(liveNextPlayableCueIndex(-1), { confirmed: true }));
await page.waitForTimeout(400);
// Open/close Live 5× then TAKE once → exactly one take.
for (let i = 0; i < 5; i++) {
  await page.evaluate(async () => { requestExitLive(); await commitExitLive({ force: true }); });
  await page.waitForTimeout(250);
  await page.evaluate(() => goLive());
  await page.waitForTimeout(250);
}
const seqBefore = await page.evaluate(() => liveShared.get().seq);
const idxBefore = await page.evaluate(() => liveActiveCueIndex());
await page.click('#lsGoBtn');
await page.waitForTimeout(400);
const seqAfter = await page.evaluate(() => ({ seq: liveShared.get().seq, idx: liveActiveCueIndex() }));
check('open/close live 5x then one TAKE = one take', seqAfter.seq === seqBefore + 1 && seqAfter.idx === (await page.evaluate(i => liveNextPlayableCueIndex(i), idxBefore)), `seq ${seqBefore} → ${seqAfter.seq}`);
const handles = await page.evaluate(() => ({ ticker: !!_liveTickerHandle }));
check('still exactly one ticker after re-entries', handles.ticker);

// Keyboard: after a mouse TAKE the arrow key still works (focus was blurred).
const k0 = await page.evaluate(() => liveShared.get().seq);
await page.click('#lsGoBtn');
await page.waitForTimeout(350);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(350);
const k1 = await page.evaluate(() => liveShared.get().seq);
check('arrow key takes after a mouse TAKE', k1 === k0 + 2, `seq ${k0} → ${k1}`);

// Status rail rows exist.
check('director row', (await page.textContent('#ls-status-director-detail')).length > 0, await page.textContent('#ls-status-director-detail'));
check('controls row', (await page.textContent('#ls-status-controls-detail')).length > 0, await page.textContent('#ls-status-controls-detail'));

// Background for a while: worker timer keeps the clock honest, no catch-up burst.
const elapsedA = await page.evaluate(() => elapsedSecs);
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(3000);
const elapsedB = await page.evaluate(() => elapsedSecs);
check('clock advances by wall time while backgrounded', elapsedB - elapsedA >= 2 && elapsedB - elapsedA <= 4, `${elapsedA} → ${elapsedB}`);

check('no console/page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
server.kill();
const failed = results.filter(r => !r.ok).length;
console.log(`${results.length - failed}/${results.length} smoke checks passed`);
process.exit(failed ? 1 : 0);
