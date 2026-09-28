// Browser smoke test for joining a show as a signed-in profile (Firestore stubbed).
// Run: node scripts/tests/join-smoke.browser.mjs  (needs Playwright + Chromium; starts a static server on 3015)
//
// Why this exists: 3.0.0 shipped with a helper the signed-in join path called
// but no longer defined. Every real join failed with "Could not load session"
// while the demo, the smokes and the contract tests all passed, because none
// of them joined a show the way a person does: signed in, by code.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';

const PORT = 3015;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: new URL('../../', import.meta.url).pathname, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'ok ' : 'FAIL'} - ${name}${detail ? ' · ' + detail : ''}`); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|AudioContext|gstatic|firebase/i.test(m.text())) errors.push('console: ' + m.text()); });

// A signed-in, unlocked student profile on this device.
await page.addInitScript(() => {
  localStorage.setItem('cueola_identity', JSON.stringify({ username: 'jonkost', fullName: 'Jon Kost', role: 'admin', at: Date.now() }));
  localStorage.setItem('cueola_pin_ok', JSON.stringify({ username: 'jonkost', at: Date.now() }));
});
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  // Stub Firestore: a profile doc, an access code, and a full session doc
  // shaped by the Break Room seeder (the same shape the admin seeder writes).
  const profileDoc = { fullName: 'Jon Kost', role: 'admin', profileId: 'p_jon', sessions: ['AVTLAB'], codeUsed: 'AVT2026', theme: 'cool' };
  const sessionDoc = window.CueolaBreakRoomKit.buildSessionDocSeed({ code: 'AVTLAB', name: 'AVT Lab', createdBy: 'jonkost' });
  // Rows a client may have left odd: a null cue map and a null cell.
  sessionDoc.beats.push({ id: 'odd1', style: 'flex', info: 'Odd row', min: 0, sec: 10, cues: null });
  sessionDoc.beats.push({ id: 'odd2', style: 'flex', info: 'Odd row 2', min: 0, sec: 10, cues: { video: null } });
  const docs = { 'profiles/jonkost': profileDoc, 'sessions/AVTLAB': sessionDoc, 'accessCodes/AVT2026': { active: true } };
  window._db = {}; window._doc = (db, col, id) => ({ path: col + '/' + id });
  const snapFor = ref => ({ exists: () => !!docs[ref.path], data: () => docs[ref.path], metadata: { fromCache: false, hasPendingWrites: false } });
  window._getDoc = async ref => snapFor(ref); window._getDocFromCache = async ref => snapFor(ref); window._getDocFromServer = async ref => snapFor(ref);
  window._onSnapshot = (ref, opts, cb) => { const fn = typeof opts === 'function' ? opts : cb; setTimeout(() => { try { fn(snapFor(ref)); } catch (e) { window.__snapErr = String(e && e.stack || e); } }, 50); return () => {}; };
  window._setDoc = async () => {}; window._updateDoc = async () => {}; window._runTransaction = async (db, fn) => fn({ get: async ref => snapFor(ref), set() {}, update() {} });
  window._deleteField = () => null; window._serverTimestamp = () => Date.now(); window._increment = n => n; window._arrayUnion = v => v; window._arrayRemove = v => v;
  window._firebaseReady = true;

  const signedIn = !!CueolaIdentity.identity();
  openJoinSession();
  await new Promise(r => setTimeout(r, 300));
  const modalOn = document.getElementById('modal-stud').classList.contains('on');
  document.getElementById('stud-code').value = 'AVTLAB';
  await joinSession();
  await new Promise(r => setTimeout(r, 600));
  const join = {
    err: document.getElementById('stud-err').classList.contains('on') ? document.getElementById('stud-err').textContent : '',
    snapErr: window.__snapErr || '',
    rundownOn: document.getElementById('rundown').classList.contains('on'),
    rows: document.querySelectorAll('#rundown tbody tr').length,
    code: session?.code, user: session?.userName, username: session?.username,
  };
  window.__snapErr = '';
  openPreProJoinModal('hub');
  await new Promise(r => setTimeout(r, 300));
  document.getElementById('pp-join-code').value = 'AVTLAB';
  await joinPreProSession();
  await new Promise(r => setTimeout(r, 600));
  const paper = {
    err: document.getElementById('pp-join-err').classList.contains('on') ? document.getElementById('pp-join-err').textContent : '',
    snapErr: window.__snapErr || '',
    hubOn: document.getElementById('paperworkHubModal')?.classList.contains('on') || false,
  };
  return { signedIn, modalOn, join, paper };
});

check('profile is signed in on this device', out.signedIn);
check('Join a Session modal opens', out.modalOn);
check('join by code succeeds (no error shown)', !out.join.err, out.join.err);
check('rundown screen is on with rows', out.join.rundownOn && out.join.rows > 5, `${out.join.rows} rows`);
check('session carries the profile identity', out.join.code === 'AVTLAB' && out.join.user === 'Jon Kost' && out.join.username === 'jonkost', JSON.stringify({ code: out.join.code, user: out.join.user, username: out.join.username }));
check('session listener applies the first snapshot without throwing', !out.join.snapErr, out.join.snapErr);
check('Planda Bear join succeeds (no error shown)', !out.paper.err, out.paper.err);
check('Planda Bear hub opens', out.paper.hubOn);
check('Planda Bear listener applies the first snapshot without throwing', !out.paper.snapErr, out.paper.snapErr);
check('no console/page errors', errors.length === 0, errors.slice(0, 5).join(' | '));

await browser.close();
server.kill();
const failed = results.filter(r => !r.ok).length;
console.log(`${results.length - failed}/${results.length} join smoke checks passed`);
process.exit(failed ? 1 : 0);
