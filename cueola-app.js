'use strict';

// ─────────────────────────────────────────────────────────────
// CUE TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────────
const CT = {
  video: {
    label:'VIDEO', color:'#5b8df8', bg:'rgba(91,141,248,.12)', icon:'📺',
    states:['Ready','Set','Set + Media Wipe'],
    defSources:['CAM 1','CAM 2','CAM 3','CAM 4','CPU','PLBK','GFX','ME 1']
  },
  audio: {
    label:'AUDIO', color:'#22d3a0', bg:'rgba(34,211,160,.12)', icon:'🎙',
    actions:['Open Mic','Close Mic','Track PLBK','Fade In','Fade Out','Play'],
    defSources:['Host','Guest 1','Guest 2','CPU','PLBK','VOU','SFX','Music','Mains']
  },
  lighting: {
    label:'LIGHTING', color:'#b06ef8', bg:'rgba(176,110,248,.12)', icon:'💡',
    actions:['On','Off','At','Color','Gobo']
  },
  playback: {
    label:'PLAYBACK', color:'#f05252', bg:'rgba(240,82,82,.12)', icon:'▶',
    states:['Ready','Play']
  },
  gfx: {
    label:'GFX', color:'#f5b731', bg:'rgba(245,183,49,.12)', icon:'🖼',
    types:['Lower 3rd','Full Screen','Bug'],
    transitions:['Cut','Auto On','Lost it','Auto Off'],
    defSources:['GFX','Media 1','Media 2','Media 3','Media 4','ME 1']
  },
  script: {
    label:'SCRIPT', color:'#22d3d3', bg:'rgba(34,211,211,.12)', icon:'📄',
    types:['Script','Dialogue'],
    defWho:['Host','Guest 1','Guest 2','VOU']
  }
};

// ─────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────
let beats = [];
let show  = { name:'Untitled Show', start:'' };
let session = { code:'', role:'', userName:'', isDemo:false, isExpert:false };
let lsIdx = -1;
let editId = null;
let timerInterval = null;
let elapsedSecs = 0;
let prompterText = '';
let prompterChannel = null;
let currentTheme = localStorage.getItem('cueola_theme') || 'default';
let adminSession = null; // { id, name, level }
let sessionCustomSources = {}; // { video:[], audio:[], gfx:[], scriptWho:[] }

// Add-row wizard state
let arStyle = null;
let arType  = null;

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2,'0');

function fmtDur(b) {
  if (!b) return '—';
  const m = b.min||0, s = b.sec||0;
  return (m||s) ? `${pad(m)}:${pad(s)}` : '—';
}

function totalSecs() {
  return beats.reduce((acc,b) => acc + (b.min||0)*60 + (b.sec||0), 0);
}

function fmtSecs(t) {
  const h = Math.floor(t/3600), m = Math.floor((t%3600)/60), s = t%60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function clock(time24, offsetSecs) {
  if (!time24) return '—';
  const [hh,mm] = time24.split(':').map(Number);
  const total = hh*60 + mm + Math.floor(offsetSecs/60);
  const rh = Math.floor(total/60)%24, rm = total%60;
  const ap = rh>=12?'PM':'AM', h12 = rh%12||12;
  return `${h12}:${pad(rm)} ${ap}`;
}

function toast(msg, dur=2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.display='none', dur);
}

function showModal(id)  { document.getElementById(id).classList.add('on'); }
function hideModal(id)  { document.getElementById(id).classList.remove('on'); }
function hideOverlay(id){ document.getElementById(id).classList.remove('on'); }

function showOverlay(id){ document.getElementById(id).classList.add('on'); }

// ─────────────────────────────────────────────────────────────
// ADMIN SYSTEM (localStorage)
// ─────────────────────────────────────────────────────────────
const ADMIN_KEY = 'cueola_admins_v2';
const ADMIN_SESSION_KEY = 'cueola_admin_sess';

function hashStr(s) {
  let h = 0;
  for (let i=0;i<s.length;i++) { h = Math.imul(31,h)+s.charCodeAt(i)|0; }
  return (h>>>0).toString(16).padStart(8,'0');
}

function getAdmins() {
  try { return JSON.parse(localStorage.getItem(ADMIN_KEY))||[]; } catch { return []; }
}
function saveAdmins(a) { localStorage.setItem(ADMIN_KEY, JSON.stringify(a)); }
function hasSuperAdmin() { return getAdmins().some(a=>a.level==='super'); }

function loginAdmin(code) {
  const h = hashStr(code);
  const a = getAdmins().find(x=>x.codeHash===h);
  if (!a) return null;
  adminSession = { id:a.id, name:a.name, level:a.level };
  localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(adminSession));
  return adminSession;
}

function logoutAdmin() {
  adminSession = null;
  localStorage.removeItem(ADMIN_SESSION_KEY);
  updateAdminUI();
}

function restoreAdminSession() {
  try {
    const s = JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY));
    if (s) {
      const a = getAdmins().find(x=>x.id===s.id);
      if (a) adminSession = { id:a.id, name:a.name, level:a.level };
    }
  } catch {}
}

function createAdmin(name, code, level, createdBy=null) {
  const admins = getAdmins();
  const id = 'adm_'+Date.now().toString(36);
  admins.push({ id, name, codeHash:hashStr(code), level, createdBy });
  saveAdmins(admins);
  return id;
}

function removeAdmin(id) {
  saveAdmins(getAdmins().filter(a=>a.id!==id));
}

function updateAdminCode(id, newCode) {
  const admins = getAdmins();
  const a = admins.find(x=>x.id===id);
  if (a) { a.codeHash = hashStr(newCode); saveAdmins(admins); return true; }
  return false;
}

function countFullAccess() {
  return getAdmins().filter(a=>a.level==='super'||a.level==='full').length;
}

function updateAdminUI() {
  const btn = document.getElementById('adminBtn');
  if (adminSession) {
    btn.style.display = '';
    btn.textContent = `🔑 ${adminSession.name.split(' ')[0]}`;
  } else {
    btn.style.display = 'none';
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN LOGIN OVERLAY
// ─────────────────────────────────────────────────────────────
function openAdminLogin() {
  hideModal('adminSetupModal');
  document.getElementById('adminCodeIn').value = '';
  document.getElementById('adminLoginErr').classList.remove('on');
  const hint = document.getElementById('adminSetupHint');
  hint.style.display = hasSuperAdmin() ? 'none' : 'block';
  showModal('adminLoginModal');
  setTimeout(()=>document.getElementById('adminCodeIn').focus(),100);
}

function submitAdminLogin() {
  const code = document.getElementById('adminCodeIn').value.trim();
  if (!code) return;
  const result = loginAdmin(code);
  if (result) {
    hideModal('adminLoginModal');
    updateAdminUI();
    toast(`Welcome, ${result.name}`);
    if (document.getElementById('rundown').classList.contains('on')) openAdminPanel();
  } else {
    document.getElementById('adminLoginErr').classList.add('on');
    document.getElementById('adminCodeIn').value='';
    document.getElementById('adminCodeIn').focus();
  }
}

function openAdminSetup() {
  hideModal('adminLoginModal');
  showModal('adminSetupModal');
}

function submitAdminSetup() {
  const name  = document.getElementById('setupAdminName').value.trim();
  const code  = document.getElementById('setupAdminCode').value;
  const code2 = document.getElementById('setupAdminCode2').value;
  const err   = document.getElementById('setupAdminErr');
  err.classList.remove('on');
  if (!name || !code) { err.textContent='Name and code are required.'; err.classList.add('on'); return; }
  if (code !== code2) { err.textContent='Codes do not match.'; err.classList.add('on'); return; }
  if (hasSuperAdmin()) { err.textContent='Super admin already exists.'; err.classList.add('on'); return; }
  createAdmin(name, code, 'super');
  loginAdmin(code);
  hideModal('adminSetupModal');
  updateAdminUI();
  toast(`Super admin created. Welcome, ${name}!`);
}

// ─────────────────────────────────────────────────────────────
// ADMIN PANEL
// ─────────────────────────────────────────────────────────────
function openAdminPanel() {
  if (!adminSession) { openAdminLogin(); return; }
  document.getElementById('adminWhoName').textContent = adminSession.name;
  const chip = document.getElementById('adminWhoChip');
  chip.textContent = adminSession.level.toUpperCase();
  chip.className = `admin-level-chip alc-${adminSession.level}`;
  renderAdminBody();
  showOverlay('adminPanel');
}

function closeAdminPanel(e) {
  if (e && e.target !== document.getElementById('adminPanel')) return;
  hideOverlay('adminPanel');
}

function renderAdminBody() {
  const body = document.getElementById('adminBody');
  const admins = getAdmins();
  const isSuper = adminSession.level==='super';
  const isFull  = adminSession.level==='full'||isSuper;

  let html = '';

  // ── Admin management ──
  if (isFull) {
    html += `<div class="admin-section">
      <div class="admin-section-label">Admin Management</div>
      <div class="admin-list">`;
    admins.forEach(a => {
      const isMe = a.id===adminSession.id;
      const canEdit = isSuper && !isMe; // super can edit others; full cannot see codes
      const canRemove = (isSuper && !isMe) || (isFull && a.level==='standard' && !isMe);
      const levelClass = `alc-${a.level}`;
      html += `<div class="admin-item">
        <div>
          <div class="admin-item-name">${esc(a.name)}</div>
          <span class="admin-level-chip ${levelClass}" style="margin-top:4px;display:inline-block">${a.level.toUpperCase()}</span>
        </div>
        <div style="flex:1"></div>
        ${isMe ? '<span class="admin-item-you">YOU</span>' : ''}
        <div class="admin-item-acts">
          ${canEdit ? `<button class="admin-act-btn" onclick="promptEditCode('${a.id}','${esc(a.name)}')">Edit Code</button>` : ''}
          ${isSuper && !isMe && a.level==='standard' ? `<button class="admin-act-btn" onclick="promoteToFull('${a.id}')">→ Full</button>` : ''}
          ${isSuper && !isMe && a.level==='full' ? `<button class="admin-act-btn" onclick="demoteToStandard('${a.id}')">→ Standard</button>` : ''}
          ${canRemove ? `<button class="admin-act-btn danger" onclick="confirmRemoveAdmin('${a.id}','${esc(a.name)}')">Remove</button>` : ''}
        </div>
      </div>`;
    });
    html += `</div>`;

    // Add admin form
    html += `<div class="admin-add-form" id="addAdminForm">
      <div class="admin-add-label">Add Admin</div>
      <input class="admin-in" id="newAdminName" type="text" placeholder="Name" autocomplete="off">
      <input class="admin-in" id="newAdminCode" type="password" placeholder="Admin code" autocomplete="new-password">
      <div class="admin-level-row">
        <button class="admin-level-btn sel" id="newLvlStandard" onclick="selectNewLevel('standard')">Standard</button>
        ${isSuper && countFullAccess()<3 ? `<button class="admin-level-btn" id="newLvlFull" onclick="selectNewLevel('full')">Full Access</button>` : ''}
      </div>
      <div id="newAdminErr" style="font-size:12px;color:var(--red);display:none"></div>
      <button class="admin-add-btn" onclick="submitAddAdmin()">Add Admin</button>
    </div>`;

    html += `</div>`;
  }

  // ── Session sources ──
  if (session.code || session.isExpert) {
    html += `<div class="admin-section">
      <div class="admin-section-label">Session Sources <span style="color:var(--text3);font-size:9px">(this session only)</span></div>
      <div class="admin-sources-grid">
        ${renderSourcesRow('video','Video')}
        ${renderSourcesRow('audio','Audio')}
        ${renderSourcesRow('gfx','GFX')}
        ${renderSourcesRow('scriptWho','Script / Who')}
      </div>
    </div>`;
  }

  html += `<button class="admin-logout-btn" onclick="logoutAdmin();closeAdminPanel()">Logout Admin</button>`;
  body.innerHTML = html;
  window._newAdminLevel = 'standard';
}

function renderSourcesRow(key, label) {
  const defaults = key==='video' ? CT.video.defSources
    : key==='audio' ? CT.audio.defSources
    : key==='gfx' ? CT.gfx.defSources
    : CT.script.defWho;
  const custom = (sessionCustomSources[key]||[]);
  const all = [...defaults, ...custom];
  const chips = all.map((s,i) => {
    const isCustom = i>=defaults.length;
    return `<span class="admin-src-chip">${esc(s)}${isCustom?`<span class="rm" onclick="removeCustomSource('${key}',${i-defaults.length})">✕</span>`:''}</span>`;
  }).join('');
  return `<div class="admin-src-row">
    <span class="admin-src-label">${label}</span>
    <div class="admin-src-chips">${chips}
      <button class="admin-src-add" onclick="addCustomSource('${key}')">+ Add</button>
    </div>
  </div>`;
}

let _newAdminLevel = 'standard';
function selectNewLevel(lvl) {
  _newAdminLevel = lvl;
  document.querySelectorAll('.admin-level-btn').forEach(b => b.classList.remove('sel'));
  const btn = document.getElementById(`newLvl${lvl.charAt(0).toUpperCase()+lvl.slice(1)}`);
  if (btn) btn.classList.add('sel');
}

function submitAddAdmin() {
  const name = document.getElementById('newAdminName').value.trim();
  const code = document.getElementById('newAdminCode').value;
  const err  = document.getElementById('newAdminErr');
  err.style.display='none';
  if (!name||!code) { err.textContent='Name and code required.'; err.style.display='block'; return; }
  if (_newAdminLevel==='full' && countFullAccess()>=3) { err.textContent='Max 3 full-access admins.'; err.style.display='block'; return; }
  createAdmin(name, code, _newAdminLevel, adminSession.id);
  renderAdminBody();
  toast(`Admin "${name}" added.`);
}

function promptEditCode(id, name) {
  const code = prompt(`New code for ${name}:`);
  if (!code) return;
  if (updateAdminCode(id, code)) toast('Code updated.');
}

function promoteToFull(id) {
  if (countFullAccess()>=3) { toast('Max 3 full-access admins reached.'); return; }
  const admins = getAdmins();
  const a = admins.find(x=>x.id===id);
  if (a) { a.level='full'; saveAdmins(admins); renderAdminBody(); toast(`${a.name} promoted to Full Access.`); }
}

function demoteToStandard(id) {
  const admins = getAdmins();
  const a = admins.find(x=>x.id===id);
  if (a) { a.level='standard'; saveAdmins(admins); renderAdminBody(); toast(`${a.name} set to Standard.`); }
}

function confirmRemoveAdmin(id, name) {
  if (!confirm(`Remove admin "${name}"?`)) return;
  removeAdmin(id);
  renderAdminBody();
  toast(`${name} removed.`);
}

function addCustomSource(key) {
  const val = prompt(`Add custom source for ${key}:`);
  if (!val||!val.trim()) return;
  if (!sessionCustomSources[key]) sessionCustomSources[key]=[];
  sessionCustomSources[key].push(val.trim());
  syncSessionSources();
  renderAdminBody();
}

function removeCustomSource(key, idx) {
  if (!sessionCustomSources[key]) return;
  sessionCustomSources[key].splice(idx,1);
  syncSessionSources();
  renderAdminBody();
}

function syncSessionSources() {
  if (window._firebaseReady && session.code && !session.isDemo) {
    window._updateDoc(window._doc(window._db,'sessions',session.code),{ customSources: sessionCustomSources }).catch(()=>{});
  }
  localStorage.setItem('cueola_customSources_'+session.code, JSON.stringify(sessionCustomSources));
}

function getSources(key) {
  const defaults = key==='video' ? CT.video.defSources
    : key==='audio' ? CT.audio.defSources
    : key==='gfx' ? CT.gfx.defSources
    : CT.script.defWho;
  return [...defaults, ...(sessionCustomSources[key]||[])];
}

// ─────────────────────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────────────────────
const presenceId = Math.random().toString(36).slice(2,10);
let presenceInterval = null;
let firestoreUnsub = null;

function genCode() {
  const d = new Date();
  const yy=String(d.getFullYear()).slice(-2), mm=pad(d.getMonth()+1);
  const letters='ABCDEFGHJKLMNPQRSTUVWXYZ';
  const l = letters[Math.floor(Math.random()*letters.length)];
  return `${yy}${mm}${l}`;
}

function createSession() {
  const name = document.getElementById('inst-name').value.trim();
  const showName = document.getElementById('inst-show').value.trim();
  if (!name) { document.getElementById('inst-err').classList.add('on'); return; }
  document.getElementById('inst-err').classList.remove('on');
  session = { code:genCode(), role:'instructor', userName:name, isDemo:false, isExpert:false };
  show.name = showName||'Untitled Show';
  document.getElementById('code-display-val').textContent = session.code;
  hideModal('modal-inst');
  showModal('modal-code');
}

function enterAsInstructor() {
  hideModal('modal-code');
  enterRundown();
}

function joinSession() {
  const code = document.getElementById('stud-code').value.trim().toUpperCase();
  const name = document.getElementById('stud-name').value.trim();
  if (!code||!name) { document.getElementById('stud-err').classList.add('on'); return; }
  document.getElementById('stud-err').classList.remove('on');
  session = { code, role:'student', userName:name, isDemo:false, isExpert:false };
  hideModal('modal-stud');
  enterRundown();
}

function loadExpert() {
  session = { code:'', role:'instructor', userName:'You', isDemo:false, isExpert:true };
  show = { name:'Untitled Show', start:'' };
  beats = [];
  enterRundown();
}

function loadDemo() {
  session = { code:'DEMO1', role:'student', userName:'Demo', isDemo:true, isExpert:false };
  show = { name:'Campus News — Demo Show', start:'19:00' };
  beats = DEMO_BEATS.map((b,i)=>({...b, id:i+1}));
  enterRundown();
}

function enterRundown() {
  applyTheme(currentTheme);
  document.getElementById('entry').classList.remove('on');
  document.getElementById('rundown').classList.add('on');
  document.getElementById('liveshow').classList.remove('on');

  updateAdminUI();

  if (session.isDemo) {
    document.getElementById('demoBanner').style.display='block';
  } else {
    document.getElementById('demoBanner').style.display='none';
    if (session.code) setupFirestore();
  }

  // Load custom sources
  try {
    const stored = localStorage.getItem('cueola_customSources_'+session.code);
    if (stored) sessionCustomSources = JSON.parse(stored)||{};
  } catch {}

  const badge = document.getElementById('topSessionBadge');
  if (session.code && !session.isExpert) {
    badge.style.display='flex';
    document.getElementById('topCode').textContent = session.code;
    document.getElementById('roleTag').textContent = session.role==='instructor'?'INST':'STU';
    document.getElementById('roleTag').className = `role-badge ${session.role==='instructor'?'role-inst':'role-stud'}`;
  } else {
    badge.style.display='none';
  }

  renderRundown();
  joinPresence();
}

// ─────────────────────────────────────────────────────────────
// FIREBASE
// ─────────────────────────────────────────────────────────────
function setupFirestore() {
  const init = () => {
    if (firestoreUnsub) firestoreUnsub();
    const ref = window._doc(window._db,'sessions',session.code);

    if (session.role==='instructor') {
      window._setDoc(ref,{
        code:session.code, createdBy:session.userName,
        showName:show.name, startTime:show.start,
        beats:[], presence:{}, customSources:{},
        createdAt:window._serverTimestamp()
      },{merge:true}).catch(()=>{});
    }

    firestoreUnsub = window._onSnapshot(ref, snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.beats && Array.isArray(d.beats)) beats = d.beats;
      if (d.showName) show.name = d.showName;
      if (d.startTime !== undefined) show.start = d.startTime;
      if (d.customSources) sessionCustomSources = d.customSources;
      if (d.activeIdx !== undefined && session.role==='student') {
        lsIdx = d.activeIdx;
        if (document.getElementById('liveshow').classList.contains('on')) renderLive();
      }
      if (d.prompter && d.prompter.text && session.role==='student') {
        prompterText = d.prompter.text;
        const el = document.getElementById('lsPrompterText');
        if (el) el.textContent = prompterText;
      }
      renderPresence(d.presence||{});
      renderRundown();
    }, ()=>{});
  };

  if (window._firebaseReady) init();
  else window.addEventListener('firebaseReady', init, {once:true});
}

function syncToFirestore() {
  if (!window._firebaseReady||!session.code||session.isDemo||session.isExpert) return;
  window._updateDoc(window._doc(window._db,'sessions',session.code),{
    beats, showName:show.name, startTime:show.start||''
  }).catch(()=>{});
}

function syncLiveIdx() {
  if (!window._firebaseReady||!session.code||session.isDemo||session.isExpert) return;
  window._updateDoc(window._doc(window._db,'sessions',session.code),{ activeIdx:lsIdx }).catch(()=>{});
}

// ─────────────────────────────────────────────────────────────
// PRESENCE
// ─────────────────────────────────────────────────────────────
async function joinPresence() {
  if (!session.code||session.isDemo||session.isExpert||!window._firebaseReady) return;
  const name = session.role==='instructor' ? session.userName : (session.userName||'?');
  try {
    await window._updateDoc(window._doc(window._db,'sessions',session.code),{
      [`presence.${presenceId}`]:{name,role:session.role,lastSeen:Date.now()}
    });
    clearInterval(presenceInterval);
    presenceInterval = setInterval(async()=>{
      try { await window._updateDoc(window._doc(window._db,'sessions',session.code),{[`presence.${presenceId}.lastSeen`]:Date.now()}); } catch {}
    },30000);
  } catch {}
}

async function leavePresence() {
  if (!session.code||!window._firebaseReady) return;
  clearInterval(presenceInterval);
  try { await window._updateDoc(window._doc(window._db,'sessions',session.code),{[`presence.${presenceId}`]:window._deleteField()}); } catch {}
}

function renderPresence(map) {
  const now = Date.now();
  const active = Object.values(map||{}).filter(p=>(now-(p.lastSeen||0))<90000)
    .sort((a,b)=>a.role==='instructor'?-1:b.role==='instructor'?1:0);
  const wrap = document.getElementById('presenceWrap');
  if (!active.length||!session.code||session.isDemo||session.isExpert){wrap.style.display='none';return;}
  wrap.style.display='flex';
  const shown = active.slice(0,4), extra = active.length-4;
  document.getElementById('presenceAvatars').innerHTML =
    shown.map(p=>`<div class="p-avatar ${p.role==='instructor'?'inst':'stud'}" title="${esc(p.name)}">${(p.name||'?')[0].toUpperCase()}</div>`).join('')+
    (extra>0?`<div class="p-avatar extra">+${extra}</div>`:'');
  document.getElementById('presenceTooltip').innerHTML =
    `<div style="font-size:10px;font-family:var(--mono);color:var(--text3);letter-spacing:.08em;margin-bottom:2px">IN SESSION</div>`+
    active.map(p=>{
      const col=p.role==='instructor'?'var(--accent)':'var(--green)';
      return `<div class="p-tip-row"><div class="p-tip-dot" style="background:${col}"></div>${esc(p.name)}<span class="p-tip-label">${p.role==='instructor'?'INST':'STU'}</span></div>`;
    }).join('');
}

window.addEventListener('beforeunload', leavePresence);

// ─────────────────────────────────────────────────────────────
// RUNDOWN RENDERING
// ─────────────────────────────────────────────────────────────
function renderRundown() {
  const name = show.name||'Untitled Show';
  document.getElementById('rd-name').textContent = name+' ✏';
  document.getElementById('rd-start').textContent = show.start ? clock(show.start,0) : '—';

  const total = totalSecs();
  document.getElementById('rd-dur').textContent = fmtSecs(total);
  document.getElementById('rd-count').textContent = beats.length;
  document.getElementById('rd-end').textContent = show.start ? clock(show.start, total) : '—';
  document.getElementById('progFill').style.width = '0%';

  const tbody = document.getElementById('rdBody');
  if (!beats.length) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:40px;color:var(--text3);font-family:var(--mono);font-size:12px">No rows yet — click Add Row below to build your rundown.</td></tr>`;
    renderAddRowBtn(tbody);
    updateBotBar();
    return;
  }

  let offsetSecs = 0;
  let html = '';
  beats.forEach((b,i) => {
    const t = CT[b.type]||{label:'?',color:'#555',icon:'?'};
    const dur = fmtDur(b);
    const startStr = show.start ? clock(show.start, offsetSecs) : '—';
    offsetSecs += (b.min||0)*60+(b.sec||0);

    const {stateStr, srcStr, detStr} = getCueSummary(b);
    const scriptPreview = (b.type==='script'&&b.cueData?.text) ? b.cueData.text.slice(0,120)+(b.cueData.text.length>120?'…':'') : '';

    html += `<tr class="cue-row type-${b.type}" draggable="true" data-id="${b.id}" ondblclick="openEdit(${b.id})">
      <td class="cd cd-drag" title="Drag to reorder">⠿</td>
      <td class="cd cd-num">${i+1}</td>
      <td class="cd">
        <span class="type-badge tb-${b.type}" style="color:${t.color};background:${t.bg}">${t.icon} ${t.label}</span>
      </td>
      <td class="cd">
        <div class="cd-info">${esc(b.info||'—')}</div>
        ${scriptPreview ? `<div class="cd-subnote">${esc(scriptPreview)}</div>` : ''}
      </td>
      <td class="cd"><span class="style-pill style-${b.style||'flex'}">${b.style==='timed'?'⏱ TIMED':'⇔ FLEX'}</span></td>
      <td class="cd cd-start">${startStr}</td>
      <td class="cd cd-dur">${dur}</td>
      <td class="cd cd-state ${stateStr?'filled':''}">${stateStr ? esc(stateStr) : '<span class="cd-empty">—</span>'}</td>
      <td class="cd cd-src ${srcStr?'filled':''}">${srcStr ? esc(srcStr) : '<span class="cd-empty">—</span>'}</td>
      <td class="cd cd-det col-det ${detStr?'filled':''}">${detStr ? esc(detStr) : '<span class="cd-empty">—</span>'}</td>
      <td class="cd cd-notes">${b.notes ? esc(b.notes) : '<span class="cd-empty">—</span>'}</td>
      <td class="cd"><button class="row-act-btn" onclick="openEdit(${b.id})" title="Edit">✎</button></td>
    </tr>`;
  });

  tbody.innerHTML = html;
  renderAddRowBtn(tbody);
  initDrag();
  updateBotBar();
  updateNowNext();
}

function renderAddRowBtn(tbody) {
  const tr = document.createElement('tr');
  tr.className = 'add-row-tr';
  tr.innerHTML = `<td colspan="12"><button class="add-row-btn-el" onclick="openAddRow()">+ Add Row</button></td>`;
  tbody.appendChild(tr);
}

function getCueSummary(b) {
  const d = b.cueData||{};
  let stateStr='', srcStr='', detStr='';
  switch(b.type) {
    case 'video':
      stateStr = d.state||'';
      srcStr   = d.source||'';
      break;
    case 'audio':
      stateStr = d.action||'';
      srcStr   = d.source||'';
      break;
    case 'lighting':
      stateStr = d.action||'';
      srcStr   = d.fixture||'';
      detStr   = d.intensity ? `@${d.intensity}` : '';
      break;
    case 'playback':
      stateStr = d.state||'';
      srcStr   = d.clipName||'';
      if (d.clipMin||d.clipSec) detStr = `${pad(d.clipMin||0)}:${pad(d.clipSec||0)}`;
      break;
    case 'gfx':
      stateStr = d.gfxType||'';
      srcStr   = d.source||'';
      const flags = [d.transition, d.isFixed?'Fixed':null, d.isAnimated?'Animated':null].filter(Boolean);
      detStr = flags.join(' · ');
      if (d.contentNotes) detStr += (detStr?' — ':'')+d.contentNotes;
      break;
    case 'script':
      stateStr = d.scriptType||'';
      srcStr   = d.who||'';
      break;
  }
  return {stateStr, srcStr, detStr};
}

function updateBotBar() {
  const total = totalSecs();
  const elapsed = Math.min(elapsedSecs, total);
  const remain  = Math.max(total-elapsed, 0);
  document.getElementById('bb-el').textContent = fmtSecs(elapsed);
  document.getElementById('bb-rm').textContent = remain>0 ? fmtSecs(remain) : '—';
}

function updateNowNext() {
  const now  = beats[lsIdx];
  const next = beats[lsIdx+1];
  document.getElementById('nn-now').textContent  = '● NOW → '+(now?esc(now.info):'—');
  document.getElementById('nn-nxt').textContent  = 'NEXT → '+(next?esc(next.info):'—');
}

// ─────────────────────────────────────────────────────────────
// DRAG & DROP
// ─────────────────────────────────────────────────────────────
function initDrag() {
  const tbody = document.getElementById('rdBody');
  if (!tbody) return;
  let dragSrc = null;
  tbody.querySelectorAll('tr.cue-row').forEach(tr=>{
    tr.addEventListener('dragstart', e => { dragSrc=tr; tr.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
    tr.addEventListener('dragend', ()=>{ tr.classList.remove('dragging'); tbody.querySelectorAll('tr').forEach(r=>r.classList.remove('drag-over')); });
    tr.addEventListener('dragover', e=>{ e.preventDefault(); tbody.querySelectorAll('tr').forEach(r=>r.classList.remove('drag-over')); if(tr!==dragSrc)tr.classList.add('drag-over'); });
    tr.addEventListener('drop', e=>{
      e.preventDefault();
      if (!dragSrc||dragSrc===tr) return;
      const si=beats.findIndex(b=>b.id===parseInt(dragSrc.dataset.id));
      const ti=beats.findIndex(b=>b.id===parseInt(tr.dataset.id));
      if (si<0||ti<0) return;
      const [moved]=beats.splice(si,1); beats.splice(ti,0,moved);
      renderRundown(); syncToFirestore();
    });
  });
}

// ─────────────────────────────────────────────────────────────
// ADD ROW WIZARD
// ─────────────────────────────────────────────────────────────
function openAddRow() {
  arStyle = null; arType = null;
  document.getElementById('ar-next-1').disabled = true;
  document.getElementById('ar-next-2').disabled = true;
  document.querySelectorAll('#ar-step-1 .opt-card').forEach(c=>c.classList.remove('sel'));
  arShowStep(1);
  buildArContext();
  showOverlay('addRowOv');
}

function closeAddRowOv(e) {
  if (e && !e.target.closest('.ar-wrap')) hideOverlay('addRowOv');
  else if (!e) hideOverlay('addRowOv');
}

function buildArContext() {
  const ctx = document.getElementById('arContext');
  const last4 = beats.slice(-4);
  if (!last4.length) { ctx.innerHTML=''; return; }
  ctx.innerHTML = `<div class="ar-ctx-label">Last ${last4.length} row${last4.length>1?'s':''}</div>`+
    last4.map((b,i)=>{
      const t = CT[b.type]||{label:'?',icon:'?',color:'#555'};
      return `<div class="ar-ctx-row">
        <span class="ar-ctx-num">${beats.indexOf(b)+1}</span>
        <span class="type-badge tb-${b.type}" style="font-size:8px;color:${t.color};background:${t.bg}">${t.icon} ${t.label}</span>
        <span class="ar-ctx-name">${esc(b.info||'—')}</span>
        <span class="ar-ctx-dur">${fmtDur(b)}</span>
      </div>`;
    }).join('');
}

function arShowStep(n) {
  [1,2,3].forEach(i=>{
    document.getElementById(`ar-step-${i}`).classList.toggle('on', i===n);
  });
}

function arSelectStyle(s) {
  arStyle = s;
  document.querySelectorAll('#ar-step-1 .opt-card').forEach(c=>c.classList.remove('sel'));
  document.getElementById(`opt-${s}`).classList.add('sel');
  document.getElementById('ar-next-1').disabled = false;
}

function arStep2() {
  if (!arStyle) return;
  arType = null;
  document.getElementById('ar-next-2').disabled = true;
  document.querySelectorAll('#ar-step-2 .opt-card').forEach(c=>c.classList.remove('sel'));
  arShowStep(2);
}

function arSelectType(t) {
  arType = t;
  document.querySelectorAll('#ar-step-2 .opt-card').forEach(c=>c.classList.remove('sel'));
  event.currentTarget.classList.add('sel');
  document.getElementById('ar-next-2').disabled = false;
}

function arStep3() {
  if (!arType) return;
  const tc = CT[arType];
  document.getElementById('ar-step3-label').textContent = `Step 3 of 3 · ${tc.label} Details`;
  document.getElementById('ar-step3-heading').textContent = `Configure this ${tc.label.toLowerCase()} cue`;
  document.getElementById('ar-fields').innerHTML = buildArFields(arType);
  arShowStep(3);
}

function arStep1() { arShowStep(1); }

function buildArFields(type) {
  const sources = getSources;
  let h = `
    <div class="field" style="margin-bottom:10px">
      <label class="field-lbl">Cue Name / Label</label>
      <input class="field-in" id="ar-info" type="text" placeholder='e.g. "Show Open"' maxlength="80" autocomplete="off">
    </div>`;

  if (arStyle==='timed') {
    h += `<div class="field" style="margin-bottom:10px">
      <label class="field-lbl">Duration</label>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center">
        <input class="field-in" id="ar-min" type="number" min="0" max="180" placeholder="0" style="text-align:center;font-family:var(--mono);font-size:18px">
        <div style="font-family:var(--mono);font-size:18px;color:var(--text3);text-align:center">:</div>
        <input class="field-in" id="ar-sec" type="number" min="0" max="59" placeholder="00" style="text-align:center;font-family:var(--mono);font-size:18px">
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;font-family:var(--mono);color:var(--text3);margin-top:2px"><span>MIN</span><span>SEC</span></div>
    </div>`;
  }

  switch(type) {
    case 'video':
      h += chipField('ar-video-state','State',CT.video.states);
      h += chipField('ar-video-src','Source',getSources('video'),true);
      break;
    case 'audio':
      h += chipField('ar-audio-action','Action',CT.audio.actions);
      h += chipField('ar-audio-src','Source',getSources('audio'),true);
      break;
    case 'lighting':
      h += chipField('ar-light-action','Action',CT.lighting.actions);
      h += `<div class="field" style="margin-bottom:10px"><label class="field-lbl">Fixture / Cue</label><input class="field-in" id="ar-light-fix" type="text" placeholder="e.g. CH1-4, Cue 12, Wash Blue" maxlength="80" autocomplete="off"></div>`;
      h += `<div class="field" id="ar-light-int-wrap" style="margin-bottom:10px;display:none"><label class="field-lbl">Intensity %</label><input class="field-in" id="ar-light-int" type="number" min="0" max="100" placeholder="e.g. 80"></div>`;
      break;
    case 'playback':
      h += chipField('ar-play-state','State',CT.playback.states);
      h += `<div class="field" style="margin-bottom:10px"><label class="field-lbl">Clip Name</label><input class="field-in" id="ar-play-clip" type="text" placeholder='e.g. "Show Open V2"' maxlength="80" autocomplete="off"></div>`;
      h += `<div class="field" style="margin-bottom:10px"><label class="field-lbl">Clip Duration <span style="color:var(--text3)">(optional)</span></label>
        <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center">
          <input class="field-in" id="ar-play-min" type="number" min="0" max="180" placeholder="0" style="text-align:center;font-family:var(--mono)">
          <div style="font-family:var(--mono);color:var(--text3);text-align:center">:</div>
          <input class="field-in" id="ar-play-sec" type="number" min="0" max="59" placeholder="00" style="text-align:center;font-family:var(--mono)">
        </div></div>`;
      break;
    case 'gfx':
      h += chipField('ar-gfx-type','GFX Type',[...CT.gfx.types,'Custom'],true);
      h += chipField('ar-gfx-trans','Transition',CT.gfx.transitions);
      h += chipField('ar-gfx-src','Source',getSources('gfx'));
      h += `<div style="display:flex;gap:12px;margin-bottom:10px">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="ar-gfx-fixed"> Fixed</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="ar-gfx-anim"> Animated</label>
      </div>`;
      h += `<div class="field" style="margin-bottom:10px"><label class="field-lbl">Content Notes</label><input class="field-in" id="ar-gfx-content" type="text" placeholder='e.g. "Host lower third — name/title"' maxlength="100" autocomplete="off"></div>`;
      break;
    case 'script':
      h += chipField('ar-script-type','Script Type',CT.script.types);
      h += chipField('ar-script-who','Source',getSources('scriptWho'),true);
      h += `<div class="field" style="margin-bottom:10px"><label class="field-lbl">Script / Dialogue Notes</label>
        <textarea class="field-in" id="ar-script-text" rows="5" placeholder="Type or paste script here..." style="resize:vertical;line-height:1.6"></textarea></div>`;
      h += `<div class="field" style="margin-bottom:10px"><label class="field-lbl">Or Upload Script File</label>
        <input type="file" id="ar-script-file" accept=".txt,.md" style="color:var(--text2);font-size:12px" onchange="loadScriptFile(this)"></div>`;
      break;
  }

  h += `<div class="field"><label class="field-lbl">Notes <span style="color:var(--text3)">(optional)</span></label><input class="field-in" id="ar-notes" type="text" placeholder="Additional info for crew..." maxlength="120" autocomplete="off"></div>`;
  return h;
}

function chipField(id, label, options, allowCustom=false) {
  const opts = options.map(o=>`<button class="chip" onclick="chipSel('${id}',this,'${esc(o)}')">${esc(o)}</button>`).join('');
  const custom = allowCustom ? `<button class="chip" onclick="chipCustom('${id}',this)">+ Custom</button>` : '';
  return `<div class="field" style="margin-bottom:10px">
    <label class="field-lbl">${label}</label>
    <input type="hidden" id="${id}-val">
    <div class="chip-grid">${opts}${custom}</div>
  </div>`;
}

function chipSel(id, el, val) {
  el.closest('.chip-grid').querySelectorAll('.chip').forEach(c=>c.classList.remove('sel'));
  el.classList.add('sel');
  document.getElementById(`${id}-val`).value = val;
  // Show intensity field for lighting
  if (id==='ar-light-action') {
    const wrap = document.getElementById('ar-light-int-wrap');
    if (wrap) wrap.style.display = val==='At' ? '' : 'none';
  }
}

function chipCustom(id, el) {
  const val = prompt('Enter custom value:');
  if (!val||!val.trim()) return;
  el.closest('.chip-grid').querySelectorAll('.chip').forEach(c=>c.classList.remove('sel'));
  // Create temp chip
  const tmp = document.createElement('button');
  tmp.className='chip sel';
  tmp.textContent=val.trim();
  tmp.onclick=()=>chipSel(id,tmp,val.trim());
  el.closest('.chip-grid').insertBefore(tmp, el);
  document.getElementById(`${id}-val`).value = val.trim();
}

function loadScriptFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const ta = document.getElementById('ar-script-text');
    if (ta) ta.value = e.target.result;
  };
  reader.readAsText(file);
}

function arCommit() {
  const info = (document.getElementById('ar-info')||{}).value?.trim()||'';
  const notes = (document.getElementById('ar-notes')||{}).value?.trim()||'';
  const min = parseInt(document.getElementById('ar-min')?.value)||0;
  const sec = parseInt(document.getElementById('ar-sec')?.value)||0;

  const cueData = {};
  switch(arType) {
    case 'video':
      cueData.state  = document.getElementById('ar-video-state-val')?.value||'';
      cueData.source = document.getElementById('ar-video-src-val')?.value||'';
      break;
    case 'audio':
      cueData.action = document.getElementById('ar-audio-action-val')?.value||'';
      cueData.source = document.getElementById('ar-audio-src-val')?.value||'';
      break;
    case 'lighting':
      cueData.action    = document.getElementById('ar-light-action-val')?.value||'';
      cueData.fixture   = document.getElementById('ar-light-fix')?.value.trim()||'';
      cueData.intensity = document.getElementById('ar-light-int')?.value||'';
      break;
    case 'playback':
      cueData.state    = document.getElementById('ar-play-state-val')?.value||'';
      cueData.clipName = document.getElementById('ar-play-clip')?.value.trim()||'';
      cueData.clipMin  = parseInt(document.getElementById('ar-play-min')?.value)||0;
      cueData.clipSec  = parseInt(document.getElementById('ar-play-sec')?.value)||0;
      break;
    case 'gfx':
      cueData.gfxType      = document.getElementById('ar-gfx-type-val')?.value||'';
      cueData.transition   = document.getElementById('ar-gfx-trans-val')?.value||'';
      cueData.source       = document.getElementById('ar-gfx-src-val')?.value||'';
      cueData.isFixed      = document.getElementById('ar-gfx-fixed')?.checked||false;
      cueData.isAnimated   = document.getElementById('ar-gfx-anim')?.checked||false;
      cueData.contentNotes = document.getElementById('ar-gfx-content')?.value.trim()||'';
      break;
    case 'script':
      cueData.scriptType = document.getElementById('ar-script-type-val')?.value||'Script';
      cueData.who        = document.getElementById('ar-script-who-val')?.value||'';
      cueData.text       = document.getElementById('ar-script-text')?.value.trim()||'';
      break;
  }

  const newId = beats.length ? Math.max(...beats.map(b=>b.id))+1 : 1;
  beats.push({ id:newId, style:arStyle, type:arType, info, notes, min, sec, cueData, done:false });
  hideOverlay('addRowOv');
  renderRundown();
  syncToFirestore();
  toast('Row added.');
}

// ─────────────────────────────────────────────────────────────
// EDIT
// ─────────────────────────────────────────────────────────────
function openEdit(id) {
  const b = beats.find(x=>x.id===id);
  if (!b) return;
  editId = id;
  const t = CT[b.type]||{};
  document.getElementById('editTitle').textContent = `Edit ${t.label||'Cue'}`;
  const d = b.cueData||{};
  let h = `
    <div class="field"><label class="field-lbl">Name</label><input class="field-in" id="ed-info" value="${esc(b.info||'')}" maxlength="80"></div>
    <div class="field"><label class="field-lbl">Notes</label><input class="field-in" id="ed-notes" value="${esc(b.notes||'')}" maxlength="120"></div>
    <div class="field"><label class="field-lbl">Duration</label>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center">
        <input class="field-in" id="ed-min" type="number" min="0" max="180" value="${b.min||0}" style="text-align:center;font-family:var(--mono)">
        <div style="font-family:var(--mono);color:var(--text3);text-align:center">:</div>
        <input class="field-in" id="ed-sec" type="number" min="0" max="59" value="${b.sec||0}" style="text-align:center;font-family:var(--mono)">
      </div></div>`;

  switch(b.type) {
    case 'video':
      h += edChipField('ed-v-state','State',CT.video.states,d.state);
      h += edChipField('ed-v-src','Source',getSources('video'),d.source,true);
      break;
    case 'audio':
      h += edChipField('ed-a-action','Action',CT.audio.actions,d.action);
      h += edChipField('ed-a-src','Source',getSources('audio'),d.source,true);
      break;
    case 'lighting':
      h += edChipField('ed-l-action','Action',CT.lighting.actions,d.action);
      h += `<div class="field"><label class="field-lbl">Fixture / Cue</label><input class="field-in" id="ed-l-fix" value="${esc(d.fixture||'')}" maxlength="80"></div>`;
      h += `<div class="field" id="ed-l-int-wrap" style="${d.action==='At'?'':'display:none'}"><label class="field-lbl">Intensity %</label><input class="field-in" id="ed-l-int" type="number" min="0" max="100" value="${d.intensity||''}"></div>`;
      break;
    case 'playback':
      h += edChipField('ed-p-state','State',CT.playback.states,d.state);
      h += `<div class="field"><label class="field-lbl">Clip Name</label><input class="field-in" id="ed-p-clip" value="${esc(d.clipName||'')}" maxlength="80"></div>`;
      h += `<div class="field"><label class="field-lbl">Clip Duration</label><div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center"><input class="field-in" id="ed-p-min" type="number" min="0" max="180" value="${d.clipMin||0}" style="text-align:center;font-family:var(--mono)"><div style="font-family:var(--mono);color:var(--text3);text-align:center">:</div><input class="field-in" id="ed-p-sec" type="number" min="0" max="59" value="${d.clipSec||0}" style="text-align:center;font-family:var(--mono)"></div></div>`;
      break;
    case 'gfx':
      h += edChipField('ed-g-type','GFX Type',[...CT.gfx.types,'Custom'],d.gfxType,true);
      h += edChipField('ed-g-trans','Transition',CT.gfx.transitions,d.transition);
      h += edChipField('ed-g-src','Source',getSources('gfx'),d.source);
      h += `<div style="display:flex;gap:12px;margin-bottom:10px"><label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="ed-g-fixed" ${d.isFixed?'checked':''}> Fixed</label><label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="ed-g-anim" ${d.isAnimated?'checked':''}> Animated</label></div>`;
      h += `<div class="field"><label class="field-lbl">Content Notes</label><input class="field-in" id="ed-g-content" value="${esc(d.contentNotes||'')}" maxlength="100"></div>`;
      break;
    case 'script':
      h += edChipField('ed-s-type','Script Type',CT.script.types,d.scriptType);
      h += edChipField('ed-s-who','Source / Who',getSources('scriptWho'),d.who,true);
      h += `<div class="field"><label class="field-lbl">Script Text</label><textarea class="field-in" id="ed-s-text" rows="6" style="resize:vertical;line-height:1.6">${esc(d.text||'')}</textarea></div>`;
      h += `<div class="field"><label class="field-lbl">Upload Script File</label><input type="file" id="ed-s-file" accept=".txt,.md" style="color:var(--text2);font-size:12px" onchange="loadEditScriptFile(this)"></div>`;
      break;
  }

  document.getElementById('editFields').innerHTML = h;
  document.getElementById('editOv').classList.add('on');
}

function edChipField(id, label, options, current, allowCustom=false) {
  const opts = options.map(o=>`<button class="chip ${o===current?'sel':''}" onclick="chipSel('${id}',this,'${esc(o)}')">${esc(o)}</button>`).join('');
  const custom = allowCustom ? `<button class="chip ${!options.includes(current)&&current?'sel':''}" onclick="chipCustom('${id}',this)">${!options.includes(current)&&current ? esc(current) : '+ Custom'}</button>` : '';
  return `<div class="field" style="margin-bottom:10px"><label class="field-lbl">${label}</label><input type="hidden" id="${id}-val" value="${esc(current||'')}"><div class="chip-grid">${opts}${custom}</div></div>`;
}

function closeEdit(e) {
  if (e && e.target!==document.getElementById('editOv')) return;
  document.getElementById('editOv').classList.remove('on');
}

function saveEdit() {
  const b = beats.find(x=>x.id===editId); if (!b) return;
  b.info  = document.getElementById('ed-info').value.trim()||b.info;
  b.notes = document.getElementById('ed-notes').value.trim();
  b.min   = parseInt(document.getElementById('ed-min').value)||0;
  b.sec   = parseInt(document.getElementById('ed-sec').value)||0;
  const d = b.cueData = b.cueData||{};

  switch(b.type) {
    case 'video':   d.state=v('ed-v-state-val'); d.source=v('ed-v-src-val'); break;
    case 'audio':   d.action=v('ed-a-action-val'); d.source=v('ed-a-src-val'); break;
    case 'lighting':d.action=v('ed-l-action-val'); d.fixture=v('ed-l-fix'); d.intensity=v('ed-l-int'); break;
    case 'playback':d.state=v('ed-p-state-val'); d.clipName=v('ed-p-clip'); d.clipMin=parseInt(v('ed-p-min'))||0; d.clipSec=parseInt(v('ed-p-sec'))||0; break;
    case 'gfx':     d.gfxType=v('ed-g-type-val'); d.transition=v('ed-g-trans-val'); d.source=v('ed-g-src-val'); d.isFixed=!!document.getElementById('ed-g-fixed')?.checked; d.isAnimated=!!document.getElementById('ed-g-anim')?.checked; d.contentNotes=v('ed-g-content'); break;
    case 'script':  d.scriptType=v('ed-s-type-val'); d.who=v('ed-s-who-val'); d.text=document.getElementById('ed-s-text')?.value.trim()||''; break;
  }

  document.getElementById('editOv').classList.remove('on');
  renderRundown(); syncToFirestore(); toast('Saved.');
}

function v(id) { return document.getElementById(id)?.value?.trim()||''; }

function deleteCue() {
  if (!confirm('Remove this row?')) return;
  beats = beats.filter(b=>b.id!==editId);
  document.getElementById('editOv').classList.remove('on');
  renderRundown(); syncToFirestore(); toast('Row removed.');
}

function loadEditScriptFile(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => { const ta=document.getElementById('ed-s-text'); if(ta) ta.value=e.target.result; };
  reader.readAsText(file);
}

// ─────────────────────────────────────────────────────────────
// LIVE SHOW
// ─────────────────────────────────────────────────────────────
function goLive() {
  if (lsIdx<0) lsIdx=0;
  document.getElementById('rundown').classList.remove('on');
  document.getElementById('liveshow').classList.add('on');
  document.getElementById('tabLive').classList.add('on');
  document.getElementById('tabBuild').classList.remove('on');
  initPrompter();
  renderLive();
  startTimer();
}

function showRundown() {
  document.getElementById('liveshow').classList.remove('on');
  document.getElementById('rundown').classList.add('on');
  document.getElementById('tabBuild').classList.add('on');
  document.getElementById('tabLive').classList.remove('on');
  stopTimer();
}

function requestExitLive() {
  showOverlay('exitLiveOv');
}

function confirmExitLive() {
  hideOverlay('exitLiveOv');
  showRundown();
}

function renderLive() {
  const body = document.getElementById('lsBody');
  if (!beats.length) { body.innerHTML='<div style="text-align:center;padding:40px;color:var(--text3)">No cues in rundown.</div>'; return; }

  const cur = beats[lsIdx];
  let html = '';

  // NOW card
  if (cur) {
    const t = CT[cur.type]||{};
    const d = cur.cueData||{};
    const {stateStr,srcStr,detStr} = getCueSummary(cur);

    html += `<div class="ls-now">
      <div class="ls-now-lbl">
        <span class="type-badge tb-${cur.type}" style="color:${t.color};background:${t.bg}">${t.icon} ${t.label}</span>
        NOW — Cue ${lsIdx+1} of ${beats.length}
      </div>
      <div class="ls-cue-name">${esc(cur.info||'—')}</div>
      ${cur.notes ? `<div class="ls-cue-note">${esc(cur.notes)}</div>` : ''}
      <div class="ls-meta">
        ${stateStr ? `<div class="ls-mi"><div class="ls-ml">State / Action</div><div class="ls-mv">${esc(stateStr)}</div></div>` : ''}
        ${srcStr ? `<div class="ls-mi"><div class="ls-ml">Source</div><div class="ls-mv">${esc(srcStr)}</div></div>` : ''}
        ${detStr ? `<div class="ls-mi"><div class="ls-ml">Details</div><div class="ls-mv">${esc(detStr)}</div></div>` : ''}
        ${fmtDur(cur)!=='—' ? `<div class="ls-mi"><div class="ls-ml">Duration</div><div class="ls-mv">${fmtDur(cur)}</div></div>` : ''}
      </div>
      ${cur.type==='script' && d.text ? `<div class="ls-cue-script" id="liveScriptEdit" contenteditable="true" spellcheck="true">${esc(d.text)}</div>` : ''}
    </div>`;
  }

  // NEXT card
  const nxt = beats[lsIdx+1];
  if (nxt) {
    const nt = CT[nxt.type]||{};
    html += `<div class="ls-next">
      <div class="ls-next-info">
        <div class="ls-next-lbl">NEXT UP</div>
        <div class="ls-next-name"><span class="type-badge tb-${nxt.type}" style="color:${nt.color};background:${nt.bg};font-size:8px">${nt.icon} ${nt.label}</span> ${esc(nxt.info||'—')}</div>
        ${nxt.notes ? `<div style="font-size:11px;color:var(--text3);margin-top:3px">${esc(nxt.notes)}</div>` : ''}
      </div>
      <div style="font-family:var(--mono);font-size:12px;color:var(--text3)">${fmtDur(nxt)}</div>
    </div>`;
  }

  // All cues list
  html += `<div class="ls-all-title">ALL CUES</div>`;
  beats.forEach((b,i) => {
    const bt = CT[b.type]||{};
    const cls = i===lsIdx ? 'ls-active' : i<lsIdx ? 'ls-done' : '';
    html += `<div class="ls-cue-item type-${b.type} ${cls}" onclick="jumpToLsCue(${i})" style="border-left-color:${bt.color}">
      <span class="ls-ci-num">${i+1}</span>
      <span class="ls-ci-badge"><span class="type-badge tb-${b.type}" style="color:${bt.color};background:${bt.bg};font-size:8px">${bt.icon}</span></span>
      <span class="ls-ci-name">${esc(b.info||'—')}</span>
      <span class="ls-ci-dur">${fmtDur(b)}</span>
    </div>`;
  });

  body.innerHTML = html;

  // Scroll active into view
  const active = body.querySelector('.ls-active');
  if (active) active.scrollIntoView({behavior:'smooth',block:'nearest'});

  // Update follow chips
  renderFollowChips();
  updateLsPrompter();
}

function jumpToLsCue(i) {
  if (session.role==='student') return; // students follow, don't jump
  lsIdx = i;
  renderLive();
  syncLiveIdx();
}

function lsNext() {
  const prev = beats[lsIdx];
  if (lsIdx < beats.length-1) {
    lsIdx++;
    updatePrompterOnAdvance(prev, beats[lsIdx]);
    renderLive();
    syncLiveIdx();
  }
}

function lsPrev() {
  if (lsIdx > 0) { lsIdx--; renderLive(); syncLiveIdx(); }
}

function renderFollowChips() {
  // Placeholder — in full implementation, populate from presence
  const chips = document.getElementById('followChips');
  if (!chips) return;
}

function followSelf() {
  document.querySelectorAll('.follow-chip').forEach(c=>c.classList.remove('active'));
  document.querySelector('.follow-self')?.classList.add('active');
}

// ─────────────────────────────────────────────────────────────
// PROMPTER
// ─────────────────────────────────────────────────────────────
function initPrompter() {
  try {
    if (prompterChannel) prompterChannel.close();
    prompterChannel = new BroadcastChannel('prompt_up_the_jam');
    prompterChannel.onmessage = (e) => {
      if (e.data?.type === 'ping') {
        document.getElementById('prompterDot').className='ls-prompter-dot';
        document.getElementById('prompterStatusTxt').textContent='Connected';
      }
    };
    // Announce presence
    prompterChannel.postMessage({ type:'cueola_hello', sessionCode:session.code });
    document.getElementById('prompterDot').className='ls-prompter-dot';
    document.getElementById('prompterStatusTxt').textContent='Ready';
  } catch {
    document.getElementById('prompterDot').className='ls-prompter-dot off';
    document.getElementById('prompterStatusTxt').textContent='Not available';
  }
}

function updatePrompterOnAdvance(prevBeat, newBeat) {
  // If leaving a script cue, add break if it seems unfinished
  if (prevBeat?.type==='script' && prevBeat.cueData?.text) {
    const editEl = document.getElementById('liveScriptEdit');
    const liveText = editEl ? editEl.textContent.trim() : prevBeat.cueData.text;
    // Always append a break when advancing away from a script cue
    prompterText += '\n\n⬛ ─── [NOTE: Production advancing — wrap current copy, continue with next segment] ───\n\n';
  }

  // If new cue is a script cue, append its text
  if (newBeat?.type==='script') {
    const d = newBeat.cueData||{};
    if (d.scriptType==='Script' && d.text) {
      prompterText += (d.who ? `${d.who.toUpperCase()}:\n` : '') + d.text + '\n';
    } else if (d.scriptType==='Dialogue') {
      prompterText += `\n[${d.who||'TALENT'}: ${d.text||'(ad-lib / dialogue)'}]\n`;
    }
  }

  sendToPrompter();
}

function sendToPrompter() {
  const el = document.getElementById('lsPrompterText');
  if (el) el.textContent = prompterText;
  if (prompterChannel) {
    prompterChannel.postMessage({ type:'script_update', text:prompterText, sessionCode:session.code, ts:Date.now() });
  }
  // Sync to Firestore
  if (window._firebaseReady && session.code && !session.isDemo) {
    window._updateDoc(window._doc(window._db,'sessions',session.code),{ 'prompter.text':prompterText, 'prompter.updatedAt':Date.now() }).catch(()=>{});
  }
}

function updateLsPrompter() {
  const el = document.getElementById('lsPrompterText');
  if (el) el.textContent = prompterText;
}

function pushToPrompter() {
  const el = document.getElementById('lsPrompterText');
  if (el) prompterText = el.textContent;
  sendToPrompter();
  toast('Pushed to prompter');
}

function clearPrompter() {
  if (!confirm('Clear prompter text?')) return;
  prompterText = '';
  sendToPrompter();
}

// ─────────────────────────────────────────────────────────────
// TIMER
// ─────────────────────────────────────────────────────────────
function startTimer() {
  stopTimer();
  const start = Date.now() - elapsedSecs*1000;
  timerInterval = setInterval(()=>{
    elapsedSecs = Math.floor((Date.now()-start)/1000);
    const el = document.getElementById('ls-timer');
    if (el) {
      el.textContent = fmtSecs(elapsedSecs);
      const total = totalSecs();
      el.classList.toggle('warn', total>0 && elapsedSecs>total*0.9);
    }
    updateBotBar();
    const clockEl = document.getElementById('ls-clock');
    if (clockEl) {
      const now = new Date();
      const h=now.getHours(), m=now.getMinutes(), s=now.getSeconds();
      const ap=h>=12?'PM':'AM', h12=h%12||12;
      clockEl.textContent=`${h12}:${pad(m)}:${pad(s)} ${ap}`;
    }
  },1000);
}

function stopTimer() { clearInterval(timerInterval); timerInterval=null; }

// ─────────────────────────────────────────────────────────────
// SETTINGS & THEME
// ─────────────────────────────────────────────────────────────
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t==='default'?'':t); }

function selectTheme(t) {
  currentTheme = t;
  document.querySelectorAll('.theme-swatch').forEach(s=>s.classList.toggle('active', s.dataset.theme===t));
}

function saveSettings() {
  const nameIn = document.getElementById('set-showname');
  if (!nameIn.disabled) show.name = nameIn.value.trim()||show.name;
  show.start = document.getElementById('set-starttime').value||'';
  applyTheme(currentTheme);
  localStorage.setItem('cueola_theme', currentTheme);
  hideModal('modal-settings');
  renderRundown(); syncToFirestore();
}

// Pre-fill settings on open
const _origShowModal = window.showModal;
window.showModal = function(id) {
  if (id==='modal-settings') {
    const locked = !adminSession;
    const nameIn = document.getElementById('set-showname');
    nameIn.value = show.name||'';
    nameIn.disabled = locked;
    nameIn.style.opacity = locked?'0.5':'1';
    document.getElementById('showname-locked-hint').style.display = locked?'block':'none';
    document.getElementById('set-starttime').value = show.start||'';
    const saved = localStorage.getItem('cueola_theme')||'default';
    currentTheme = saved;
    document.querySelectorAll('.theme-swatch').forEach(s=>s.classList.toggle('active', s.dataset.theme===saved));
  }
  document.getElementById(id).classList.add('on');
};

// ─────────────────────────────────────────────────────────────
// PDF EXPORT
// ─────────────────────────────────────────────────────────────
function exportPDF() {
  const area = document.getElementById('printArea');
  let offsetSecs = 0;
  const rows = beats.map((b,i) => {
    const t = CT[b.type]||{label:'?'};
    const {stateStr,srcStr,detStr} = getCueSummary(b);
    const startStr = show.start ? clock(show.start, offsetSecs) : '—';
    offsetSecs += (b.min||0)*60+(b.sec||0);
    return `<tr>
      <td>${i+1}</td>
      <td><span class="pt-badge" style="background:${t.bg||'#eee'};color:${t.color||'#000'}">${t.label}</span></td>
      <td>${esc(b.info||'—')}</td>
      <td>${b.style||'flex'}</td>
      <td>${startStr}</td>
      <td>${fmtDur(b)}</td>
      <td>${esc(stateStr)}</td>
      <td>${esc(srcStr)}</td>
      <td>${esc(detStr)}</td>
      <td>${esc(b.notes||'')}</td>
    </tr>`;
  }).join('');

  area.innerHTML = `
    <div class="print-title">${esc(show.name||'Rundown')}</div>
    <div class="print-meta">Exported ${new Date().toLocaleString()}${session.code?' · Session '+session.code:''}</div>
    <table class="print-table">
      <thead><tr><th>#</th><th>Type</th><th>Name</th><th>Style</th><th>Start</th><th>Dur</th><th>State/Action</th><th>Source</th><th>Details</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  window.print();
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─────────────────────────────────────────────────────────────
// DEMO DATA
// ─────────────────────────────────────────────────────────────
const DEMO_BEATS = [
  { id:1, style:'timed', type:'video', info:'Countdown Slate', notes:'', min:0, sec:30, done:false, cueData:{ state:'Ready', source:'GFX' } },
  { id:2, style:'timed', type:'audio', info:'Show Open BGM', notes:'Theme up full, under at open', min:0, sec:15, done:false, cueData:{ action:'Play', source:'Music' } },
  { id:3, style:'timed', type:'gfx',   info:'Show Open Title Card', notes:'', min:0, sec:8, done:false, cueData:{ gfxType:'Full Screen', transition:'Auto On', source:'GFX', isFixed:false, isAnimated:true, contentNotes:'Show open animation' } },
  { id:4, style:'timed', type:'video', info:'Anchor Wide — Show Open', notes:'', min:0, sec:10, done:false, cueData:{ state:'Set', source:'CAM 1' } },
  { id:5, style:'timed', type:'audio', info:'Anchor Mics Hot', notes:'CH1+CH2 open', min:0, sec:5, done:false, cueData:{ action:'Open Mic', source:'Host' } },
  { id:6, style:'timed', type:'script', info:'Anchor Cold Open', notes:'Read to camera', min:1, sec:0, done:false, cueData:{ scriptType:'Script', who:'Host', text:"Good evening and welcome to Campus News. I'm your anchor. Tonight we're covering three big stories..." } },
  { id:7, style:'timed', type:'gfx',   info:'Anchor Lower Third', notes:'', min:0, sec:5, done:false, cueData:{ gfxType:'Lower 3rd', transition:'Cut', source:'GFX', isFixed:true, isAnimated:false, contentNotes:'Anchor Name / Title' } },
  { id:8, style:'timed', type:'playback', info:'PKG — Student Council', notes:'Natural roll', min:2, sec:15, done:false, cueData:{ state:'Play', clipName:'SC_042', clipMin:2, clipSec:15 } },
  { id:9, style:'flex',  type:'script', info:'Guest Conversation Block', notes:'"What surprised you most?"', min:5, sec:0, done:false, cueData:{ scriptType:'Dialogue', who:'Host', text:'Guest conversation — ad-lib topic: student budget vote' } },
  { id:10, style:'timed', type:'video', info:'Outro & Signoff', notes:'', min:1, sec:30, done:false, cueData:{ state:'Set', source:'CAM 1' } },
];

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────
restoreAdminSession();
applyTheme(currentTheme);
