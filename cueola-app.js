'use strict';

// ─────────────────────────────────────────────────────────────
// CUE TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────────
const CT = {
  video:    { label:'VIDEO',    color:'#5b8df8', bg:'rgba(91,141,248,.12)', icon:'📺' },
  audio:    { label:'AUDIO',    color:'#22d3a0', bg:'rgba(34,211,160,.12)', icon:'🎙' },
  lighting: { label:'LIGHTING', color:'#b06ef8', bg:'rgba(176,110,248,.12)', icon:'💡' },
  playback: { label:'PLAYBACK', color:'#f05252', bg:'rgba(240,82,82,.12)', icon:'▶'  },
  gfx:      { label:'GFX',      color:'#f5b731', bg:'rgba(245,183,49,.12)', icon:'🖼'  },
  script:   { label:'SCRIPT',   color:'#22d3d3', bg:'rgba(34,211,211,.12)', icon:'📄' },
};

// Column ordering — persisted per user in localStorage
const COL_META = {
  video:    { label:'📺 Video',    color:'#5b8df8' },
  audio:    { label:'🎙 Audio',    color:'#22d3a0' },
  playback: { label:'▶ Playback', color:'#f05252' },
  gfx:      { label:'🖼 GFX',     color:'#f5b731' },
  lighting: { label:'💡 Lighting', color:'#b06ef8' },
  script:   { label:'📄 Script',  color:'#22d3d3' },
};
const COL_DEFAULTS = ['video','audio','playback','gfx','lighting','script'];
let colOrder = (() => {
  try {
    const s = JSON.parse(localStorage.getItem('cueola_col_order')||'null');
    if (Array.isArray(s) && s.length === 6 && s.every(c=>COL_DEFAULTS.includes(c))) return s;
  } catch {}
  return [...COL_DEFAULTS];
})();
let colDragSrc = null;

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

// Edit mode (gates row/column drag)
let editMode = false;

// Cue config modal state
let cueConfigBeatId = null;
let cueConfigType   = null;

// Presence cache for follow chips
let currentPresence = {};

// Live script edit
let liveScriptEditIdx = null;

// Edit style (for edit overlay)
let editStyle = null;

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

  if (session.code) {
    const presenceNames = Object.values(currentPresence||{}).map(p=>p.name).filter(Boolean);
    const nameOpts = presenceNames.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
    html += `<div class="admin-section" style="margin-top:16px">
      <div class="admin-section-label">Live Control</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select id="adminFollowSelect" class="field-in" style="flex:1;min-width:120px;font-size:12px;padding:6px 10px">
          ${presenceNames.length ? nameOpts : '<option>No users online</option>'}
        </select>
        <button class="admin-act-btn" style="background:rgba(240,82,82,.15);border-color:rgba(240,82,82,.4);color:var(--red)" onclick="adminForceLive(document.getElementById('adminFollowSelect').value)">🔴 Force Everyone Live + Follow</button>
      </div>
    </div>`;
  }
  html += `<button class="admin-logout-btn" onclick="logoutAdmin();closeAdminPanel()">Logout Admin</button>`;
  body.innerHTML = html;
  window._newAdminLevel = 'standard';
}

function renderSourcesRow(key, label) {
  const SRC_DEFAULTS = {
    video: ['CAM 1','CAM 2','CAM 3','CAM 4','CPU','PLBK','GFX','ME 1'],
    audio: ['Host','Guest 1','Guest 2','CPU','PLBK','VOU','SFX','Music','Mains'],
    gfx:   ['GFX','Media 1','Media 2','Media 3','Media 4','ME 1'],
    scriptWho: ['Host','Guest 1','Guest 2','VOU'],
  };
  const defaults = SRC_DEFAULTS[key] || [];
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

function migrateOldCue(type, d) {
  if (!d) return d;
  if (d.ready !== undefined || d.take !== undefined) return d; // already new format
  switch(type) {
    case 'video':
      return { ready:[d.state,d.source].filter(Boolean).join(' '), take:d.source?`Take ${d.source}`:'' };
    case 'audio':
      return { ready:[d.action,d.source].filter(Boolean).join(' '), take:d.action||'' };
    case 'playback':
      return { ready:[d.state,d.clipName].filter(Boolean).join(' '), take:d.clipName?`Roll ${d.clipName}`:'Roll' };
    case 'gfx':
      return { ready:[d.gfxType,d.transition].filter(Boolean).join(' / '), take:'Take GFX' };
    case 'lighting':
      return { ready:[d.action,d.fixture].filter(Boolean).join(' '), take:d.action==='At'?`Go ${d.intensity||0}%`:'Go' };
    case 'script':
      return { ready:d.who||'', take:'Begin', text:d.text||'' };
    default: return d;
  }
}

function migrateBeat(b) {
  if (b.cues === undefined) {
    // Very old format: { type, cueData }
    const cues = {};
    if (b.type && b.cueData && Object.keys(b.cueData).length) {
      cues[b.type] = migrateOldCue(b.type, b.cueData);
    }
    return { id:b.id, style:b.style||'flex', info:b.info||'', notes:b.notes||'', min:b.min||0, sec:b.sec||0, done:b.done||false, cues };
  }
  // Has cues — migrate each cue's fields to ready/take format
  const newCues = {};
  Object.keys(b.cues).forEach(type => {
    newCues[type] = CT[type] ? migrateOldCue(type, b.cues[type]) : b.cues[type];
  });
  return { ...b, cues: newCues };
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
  const errEl = document.getElementById('stud-err');
  if (!code || !name) { errEl.textContent='Code and name required.'; errEl.classList.add('on'); return; }
  errEl.classList.remove('on');
  const btn = document.getElementById('stud-join-btn');
  if (btn) { btn.disabled=true; btn.textContent='Checking...'; }
  const verify = () => {
    window._getDoc(window._doc(window._db,'sessions',code)).then(snap => {
      if (btn) { btn.disabled=false; btn.textContent='Join Session →'; }
      if (!snap.exists()) {
        errEl.textContent = 'Session not found. Check the code and try again.';
        errEl.classList.add('on');
        return;
      }
      session = { code, role:'student', userName:name, isDemo:false, isExpert:false };
      hideModal('modal-stud');
      enterRundown();
    }).catch(() => {
      if (btn) { btn.disabled=false; btn.textContent='Join Session →'; }
      errEl.textContent = 'Could not connect. Check your internet connection.';
      errEl.classList.add('on');
    });
  };
  if (window._firebaseReady) verify();
  else window.addEventListener('firebaseReady', ()=>{ verify(); }, {once:true});
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
  beats = DEMO_BEATS.map((b,i)=>({...b, id:i+1})).map(migrateBeat);
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
  // Restore last screen
  if (sessionStorage.getItem('cueola_screen') === 'live') setTimeout(goLive, 300);
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
      if (d.beats && Array.isArray(d.beats)) beats = d.beats.map(migrateBeat);
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
        // Forward live to any connected PUTJ on this device, scroll-preserving
        if (prompterChannel) sendToPrompter(false);
      }
      // Handle force commands
      if (d.forceCmd && d.forceCmd.ts) {
        const cmd = d.forceCmd;
        const age = Date.now() - (cmd.ts||0);
        if (age < 30000) { // only act on commands < 30 seconds old
          if (cmd.type === 'followMe' && cmd.name !== session.userName) {
            // Force follow this person
            const liveOn = document.getElementById('liveshow').classList.contains('on');
            if (liveOn) {
              document.querySelectorAll('.follow-chip').forEach(c=>c.classList.remove('active'));
              const target = [...document.querySelectorAll('.follow-chip')].find(c=>c.textContent.trim().startsWith(cmd.name));
              if (target) target.classList.add('active');
              else toast(`Now following: ${cmd.name}`);
            }
          }
          if (cmd.type === 'forceLive') {
            const liveOn = document.getElementById('liveshow').classList.contains('on');
            if (!liveOn) { goLive(); setTimeout(()=>{ /* apply follow after live loads */ }, 400); }
            setTimeout(() => {
              if (cmd.name === session.userName) {
                followSelf();
              } else {
                document.querySelectorAll('.follow-chip').forEach(c=>c.classList.remove('active'));
                const target = [...document.querySelectorAll('.follow-chip')].find(c=>c.textContent.trim().startsWith(cmd.name));
                if (target) target.classList.add('active');
                else toast(`Forced live: following ${cmd.name}`);
              }
            }, 500);
          }
        }
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
      [`presence.${presenceId}`]:{name,role:session.role,lastSeen:Date.now(),following:session.userName}
    });
    clearInterval(presenceInterval);
    presenceInterval = setInterval(async()=>{
      try { await window._updateDoc(window._doc(window._db,'sessions',session.code),{[`presence.${presenceId}.lastSeen`]:Date.now()}); } catch {}
    },30000);
  } catch {}

  // Persist this participant to the dashboard-visible participants list.
  // Uses arrayUnion so each unique name+role pair is recorded once.
  try {
    const snap = await window._getDoc(window._doc(window._db,'sessions',session.code));
    if (snap.exists()) {
      const existing = snap.data().participants || [];
      const alreadyIn = existing.some(p => p.name === name);
      if (!alreadyIn) {
        await window._updateDoc(window._doc(window._db,'sessions',session.code), {
          participants: [...existing, { name, role:session.role, joinedAt: Date.now() }]
        });
      }
    }
  } catch {}
}

async function leavePresence() {
  if (!session.code||!window._firebaseReady) return;
  clearInterval(presenceInterval);
  try { await window._updateDoc(window._doc(window._db,'sessions',session.code),{[`presence.${presenceId}`]:window._deleteField()}); } catch {}
}

function renderPresence(map) {
  currentPresence = map || {};
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
function toggleEditMode() {
  editMode = !editMode;
  const btn = document.getElementById('editModeBtn');
  if (btn) {
    btn.textContent = editMode ? '✓ Done Editing' : '✎ Edit';
    btn.style.background = editMode ? 'rgba(91,141,248,.15)' : '';
    btn.style.borderColor = editMode ? 'var(--accent)' : '';
    btn.style.color = editMode ? 'var(--accent)' : '';
  }
  renderRundown();
}

function renderTableHeaders() {
  const thead = document.querySelector('.rd-head');
  if (!thead) return;
  const dynCols = colOrder.map(type => {
    const m = COL_META[type];
    if (editMode) {
      return `<th class="col-cue${type==='script'?' col-script-c':''}"
                style="color:${m.color};cursor:grab;user-select:none"
                draggable="true"
                ondragstart="colDragStart(event,'${type}')"
                ondragover="colDragOver(event,this)"
                ondrop="colDrop(event,'${type}')"
                ondragend="colDragEnd(event)"
                data-col="${type}"
                title="Drag to reorder">${m.label} <span style="font-size:7px;opacity:.35">⠿</span></th>`;
    }
    return `<th class="col-cue${type==='script'?' col-script-c':''}" style="color:${m.color}" data-col="${type}">${m.label}</th>`;
  }).join('');
  const dragCol = editMode ? '<th class="col-drag" title="Drag rows to reorder">⠿</th>' : '<th class="col-drag"></th>';
  thead.innerHTML = `${dragCol}<th class="col-num">#</th><th class="col-info">Name</th><th class="col-time">Start / Dur</th>${dynCols}<th class="col-acts"></th>`;
}

function colDragStart(e, type) {
  colDragSrc = type;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '.5';
}
function colDragOver(e, el) {
  e.preventDefault();
  document.querySelectorAll('.col-drag-over').forEach(c=>c.classList.remove('col-drag-over'));
  if (el && el.dataset.col !== colDragSrc) el.classList.add('col-drag-over');
}
function colDrop(e, targetType) {
  e.preventDefault();
  document.querySelectorAll('.col-drag-over').forEach(c=>c.classList.remove('col-drag-over'));
  if (!editMode || !colDragSrc || colDragSrc === targetType) { colDragSrc=null; return; }
  const fi = colOrder.indexOf(colDragSrc), ti = colOrder.indexOf(targetType);
  if (fi < 0 || ti < 0) { colDragSrc=null; return; }
  colOrder.splice(fi, 1); colOrder.splice(ti, 0, colDragSrc);
  localStorage.setItem('cueola_col_order', JSON.stringify(colOrder));
  colDragSrc = null;
  renderRundown();
}
function colDragEnd(e) {
  e.currentTarget.style.opacity = '';
  document.querySelectorAll('.col-drag-over').forEach(c=>c.classList.remove('col-drag-over'));
  colDragSrc = null;
}

function renderRundown() {
  renderTableHeaders();
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
  beats.forEach((b, i) => {
    const dur = fmtDur(b);
    const startStr = show.start ? clock(show.start, offsetSecs) : '—';
    offsetSecs += (b.min||0)*60+(b.sec||0);

    const editActions = editMode ? `
      <div class="row-edit-actions">
        <button class="row-ea-btn row-ea-add-before" onclick="addRowAt(${i},'before')" title="Add row before">+ Before</button>
        <button class="row-ea-btn row-ea-del" onclick="removeRow(${b.id})" title="Remove row">✕ Remove</button>
        <button class="row-ea-btn row-ea-add-after" onclick="addRowAt(${i},'after')" title="Add row after">+ After</button>
      </div>` : '';
    html += `<tr class="cue-row${editMode?' edit-mode-row':''}" ${editMode?'draggable="true"':''} data-id="${b.id}">
      <td class="cd cd-drag" style="opacity:${editMode?'1':'.15'};cursor:${editMode?'grab':'default'}" title="${editMode?'Drag to reorder':'Enable edit mode to reorder'}">⠿</td>
      <td class="cd cd-num">${i+1}</td>
      <td class="cd" style="padding:8px 6px">
        <div class="cd-name">${esc(b.info||'—')}</div>
        ${b.notes?`<div class="cd-subnote">${esc(b.notes)}</div>`:''}
        <span class="style-pill style-${b.style||'flex'}" style="margin-top:3px;display:inline-block">${b.style==='timed'?'⏱':'⇔'} ${(b.style||'flex').toUpperCase()}</span>
        ${editActions}
      </td>
      <td class="cd" style="padding:8px 6px">
        ${startStr!=='—'?`<div class="cd-time-start">${startStr}</div>`:''}
        <div class="cd-time-dur">${dur}</div>
      </td>
      ${colOrder.map(type=>`<td class="cd-cue-cell">${getCueCell(b,type)}</td>`).join('')}
      <td class="cd" style="padding:4px;vertical-align:middle;text-align:center"><button class="row-act-btn" onclick="openEdit(${b.id})" title="Edit row">✎</button></td>
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

function getCueCell(b, type) {
  const tc = CT[type];
  const d = b.cues?.[type];
  const isEmpty = !d || (!d.ready && !d.take && (type !== 'script' || !d.text));
  if (isEmpty) {
    return `<button class="cue-add-btn" onclick="event.stopPropagation();openCueConfig(${b.id},'${type}')" title="Add ${tc.label}">+</button>`;
  }
  const lines = [
    d.ready ? `<div class="cue-ready-line">✓ ${esc(d.ready)}</div>` : '',
    d.take  ? `<div class="cue-take-line">→ ${esc(d.take)}</div>`  : '',
  ].filter(Boolean).join('');
  return `<div class="cue-cell-filled" onclick="event.stopPropagation();openCueConfig(${b.id},'${type}')">
    <div class="cue-cell-icon" style="color:${tc.color}">${tc.icon}</div>
    <div class="cue-cell-info">${lines}</div>
  </div>`;
}

function getCueSummary(b) {
  const pType = COL_DEFAULTS.find(t => b.cues?.[t] && (b.cues[t].ready || b.cues[t].take));
  if (!pType) return { stateStr:'', srcStr:'', detStr:'' };
  const d = b.cues[pType];
  return { stateStr:d.ready||'', srcStr:d.take||'', detStr:'' };
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
  document.getElementById('nn-now').textContent = 'NOW → '+(now?now.info:'—');
  document.getElementById('nn-nxt').textContent = 'NEXT → '+(next?next.info:'—');
}

// ─────────────────────────────────────────────────────────────
// DRAG & DROP
// ─────────────────────────────────────────────────────────────
function initDrag() {
  const tbody = document.getElementById('rdBody');
  if (!tbody || !editMode) return;
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

function removeRow(id) {
  if (!confirm('Remove this row?')) return;
  beats = beats.filter(b => b.id !== id);
  renderRundown(); syncToFirestore(); toast('Row removed.');
}

// insertIdx = index to insert at; position = 'before'|'after'
let _insertIdx = null;
function addRowAt(idx, position) {
  _insertIdx = position === 'after' ? idx + 1 : idx;
  openAddRow();
}

// ─────────────────────────────────────────────────────────────
// ADD ROW WIZARD
// ─────────────────────────────────────────────────────────────
function openAddRow() {
  arStyle = null;
  const nameIn = document.getElementById('ar-name-input');
  if (nameIn) nameIn.value = '';
  const notesIn = document.getElementById('ar-notes-input');
  if (notesIn) notesIn.value = '';
  const minIn = document.getElementById('ar-min');
  if (minIn) minIn.value = '';
  const secIn = document.getElementById('ar-sec');
  if (secIn) secIn.value = '';
  document.getElementById('ar-next-1').disabled = true;
  document.querySelectorAll('#ar-step-1 .opt-card').forEach(c=>c.classList.remove('sel'));
  const durWrap = document.getElementById('ar-dur-wrap');
  if (durWrap) durWrap.style.display = 'none';
  buildArContext();
  showOverlay('addRowOv');
}

function closeAddRowOv(e) {
  if (e && !e.target.closest('.ar-wrap')) { _insertIdx = null; hideOverlay('addRowOv'); }
  else if (!e) { _insertIdx = null; hideOverlay('addRowOv'); }
}

function buildArContext() {
  const ctx = document.getElementById('arContext');
  const last4 = beats.slice(-4);
  if (!last4.length) { ctx.innerHTML=''; return; }
  ctx.innerHTML = `<div class="ar-ctx-label">Last ${last4.length} row${last4.length>1?'s':''}</div>`+
    last4.map(b => {
      const types = Object.keys(b.cues||{}).filter(t=>CT[t]);
      const badges = types.map(t=>`<span class="type-badge tb-${t}" style="font-size:7px;color:${CT[t].color};background:${CT[t].bg}">${CT[t].icon}</span>`).join('');
      return `<div class="ar-ctx-row">
        <span class="ar-ctx-num">${beats.indexOf(b)+1}</span>
        <span style="display:flex;gap:2px;align-items:center">${badges||'<span style="color:var(--text3);font-size:10px">—</span>'}</span>
        <span class="ar-ctx-name">${esc(b.info||'—')}</span>
        <span class="ar-ctx-dur">${fmtDur(b)}</span>
      </div>`;
    }).join('');
}

function arSelectStyle(s) {
  arStyle = s;
  document.querySelectorAll('#ar-step-1 .opt-card').forEach(c=>c.classList.remove('sel'));
  document.getElementById(`opt-${s}`).classList.add('sel');
  const durWrap = document.getElementById('ar-dur-wrap');
  if (durWrap) durWrap.style.display = s==='timed' ? '' : 'none';
  updateArNextEnabled();
}

function updateArNextEnabled() {
  document.getElementById('ar-next-1').disabled = !arStyle;
}

function arPickName(name) {
  const el = document.getElementById('ar-name-input');
  if (el) el.value = name;
  updateArNextEnabled();
}

// buildArFields removed — wizard now single-step; cue types configured via table cells

// ─────────────────────────────────────────────────────────────
// CUE CONFIG MODAL (per-cell)
// ─────────────────────────────────────────────────────────────
function openCueConfig(beatId, type) {
  cueConfigBeatId = beatId;
  cueConfigType   = type;
  const b = beats.find(x=>x.id===beatId); if (!b) return;
  const existing = b.cues?.[type] || null;
  const tc = CT[type];
  document.getElementById('cueConfigTitle').textContent = `${tc.icon} ${tc.label}`;
  document.getElementById('cueConfigFields').innerHTML = buildCueConfigFields(type, existing);
  document.getElementById('cueConfigRemoveBtn').style.display = existing ? '' : 'none';
  showModal('cueConfigModal');
}

function buildCueConfigFields(type, d) {
  d = d || {};
  const hints = {
    video:    { ready:'e.g. CAM 1',          take:'e.g. Take CAM 1'   },
    audio:    { ready:'e.g. Open Mic Host',  take:'e.g. Play Music'   },
    playback: { ready:'e.g. Standby SC_042', take:'e.g. Roll'         },
    gfx:      { ready:'e.g. Set Lower 3rd',  take:'e.g. Take GFX'    },
    lighting: { ready:'e.g. CH 1–4 Preset',  take:'e.g. Go'          },
    script:   { ready:'e.g. Host',           take:'e.g. Begin'        },
  };
  const h = hints[type] || { ready:'', take:'' };
  let out = `
    <div class="field">
      <label class="field-lbl" style="color:var(--green);letter-spacing:.04em">✓ CUE READY</label>
      <input class="field-in" id="cc-ready" value="${esc(d.ready||'')}" placeholder="${h.ready}" maxlength="80" autocomplete="off">
    </div>
    <div class="field">
      <label class="field-lbl" style="color:var(--accent);letter-spacing:.04em">→ CUE EXECUTE / TAKE</label>
      <input class="field-in" id="cc-take" value="${esc(d.take||'')}" placeholder="${h.take}" maxlength="80" autocomplete="off">
    </div>`;
  if (type === 'script') {
    out += `
    <div class="field">
      <label class="field-lbl">Script Text</label>
      <textarea class="field-in" id="cc-s-text" rows="6" style="resize:vertical;line-height:1.6;white-space:pre-wrap">${esc(d.text||'')}</textarea>
    </div>
    <div class="field">
      <label class="field-lbl">Upload (.txt, .pdf)</label>
      <input type="file" id="cc-s-file" accept=".txt,.md,.pdf" style="color:var(--text2);font-size:12px" onchange="loadScriptFile(this,'cc-s-text')">
    </div>`;
  }
  return out;
}

function saveCueConfig() {
  const b = beats.find(x=>x.id===cueConfigBeatId); if (!b) return;
  if (!b.cues) b.cues = {};
  const d = { ready:v('cc-ready'), take:v('cc-take') };
  if (cueConfigType === 'script') d.text = document.getElementById('cc-s-text')?.value||'';
  b.cues[cueConfigType] = d;
  hideModal('cueConfigModal');
  renderRundown(); syncToFirestore(); toast('Cue saved.');
}

function removeCueCfg() {
  if (!confirm('Remove this cue type from the row?')) return;
  const b = beats.find(x=>x.id===cueConfigBeatId); if (!b||!b.cues) return;
  delete b.cues[cueConfigType];
  hideModal('cueConfigModal');
  renderRundown(); syncToFirestore(); toast('Cue removed.');
}


// Script file upload (txt + pdf)
async function loadScriptFile(input, targetId) {
  const file = input.files[0]; if (!file) return;
  const target = document.getElementById(targetId||'cc-s-text');
  if (file.name.toLowerCase().endsWith('.pdf') && window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
    try {
      const ab = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({data:ab}).promise;
      let text = '';
      for (let i=1;i<=pdf.numPages;i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        let lastY = null;
        content.items.forEach(item => {
          if (lastY!==null && Math.abs(item.transform[5]-lastY)>5) text+='\n';
          text += item.str+' ';
          lastY = item.transform[5];
        });
        if (i<pdf.numPages) text+='\n\n';
      }
      if (target) target.value = text.trim();
    } catch { toast('PDF read failed — try a .txt file'); }
    return;
  }
  const reader = new FileReader();
  reader.onload = e => { if (target) target.value = e.target.result; };
  reader.readAsText(file);
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
  if (id==='cc-l-action') {
    const wrap = document.getElementById('cc-l-int-wrap');
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

// loadScriptFile defined above (async, supports PDF)

function arCommit() {
  if (!arStyle) return;
  const info  = document.getElementById('ar-name-input')?.value?.trim()||'';
  const notes = document.getElementById('ar-notes-input')?.value?.trim()||'';
  const min   = arStyle==='timed' ? (parseInt(document.getElementById('ar-min')?.value)||0) : 0;
  const sec   = arStyle==='timed' ? (parseInt(document.getElementById('ar-sec')?.value)||0) : 0;
  const newId = beats.length ? Math.max(...beats.map(b=>b.id))+1 : 1;
  const newBeat = { id:newId, style:arStyle, info, notes, min, sec, done:false, cues:{} };
  if (_insertIdx !== null && _insertIdx >= 0 && _insertIdx <= beats.length) {
    beats.splice(_insertIdx, 0, newBeat);
  } else {
    beats.push(newBeat);
  }
  _insertIdx = null;
  hideOverlay('addRowOv');
  renderRundown(); syncToFirestore();
  toast('Row added — click cue cells to configure.');
}

// ─────────────────────────────────────────────────────────────
// EDIT
// ─────────────────────────────────────────────────────────────
function openEdit(id) {
  const b = beats.find(x=>x.id===id); if (!b) return;
  editId = id;
  editStyle = b.style||'flex';
  document.getElementById('editTitle').textContent = 'Edit Row';
  let h = `
    <div class="field"><label class="field-lbl">Name</label><input class="field-in" id="ed-info" value="${esc(b.info||'')}" maxlength="80"></div>
    <div class="field"><label class="field-lbl">Notes</label><input class="field-in" id="ed-notes" value="${esc(b.notes||'')}" maxlength="120"></div>
    <div class="field"><label class="field-lbl">Duration</label>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center">
        <input class="field-in" id="ed-min" type="number" min="0" max="180" value="${b.min||0}" style="text-align:center;font-family:var(--mono)">
        <div style="font-family:var(--mono);color:var(--text3);text-align:center">:</div>
        <input class="field-in" id="ed-sec" type="number" min="0" max="59" value="${b.sec||0}" style="text-align:center;font-family:var(--mono)">
      </div></div>
    <div class="field"><label class="field-lbl">Style</label>
      <div class="chip-grid">
        <button class="chip ${editStyle==='timed'?'sel':''}" id="ed-s-timed" onclick="edSetStyle('timed',this)">⏱ Timed</button>
        <button class="chip ${editStyle==='flex'?'sel':''}" id="ed-s-flex" onclick="edSetStyle('flex',this)">⇔ Flex</button>
      </div></div>`;
  document.getElementById('editFields').innerHTML = h;
  document.getElementById('editOv').classList.add('on');
}

function edSetStyle(s, el) {
  editStyle = s;
  document.querySelectorAll('#editFields .chip').forEach(c=>c.classList.remove('sel'));
  el.classList.add('sel');
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
  if (editStyle) b.style = editStyle;
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

function _removedLoadEditScriptFile(input) {
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
  sessionStorage.setItem('cueola_screen','live');
  buildPromptFromRundown();
  initPrompter();
  renderLive();
  startTimer();
}

function showRundown() {
  document.getElementById('liveshow').classList.remove('on');
  document.getElementById('rundown').classList.add('on');
  document.getElementById('tabBuild').classList.add('on');
  document.getElementById('tabLive').classList.remove('on');
  sessionStorage.setItem('cueola_screen','build');
  stopTimer();
}

function isFollowingSelf() {
  return document.querySelector('.follow-self')?.classList.contains('active') ?? true;
}

// Admin Show Caller = following self AND has any admin session
function isAdminShowCaller() {
  return isFollowingSelf() && adminSession != null;
}

// Standard Show Caller = following self, instructor, NO admin session
function isStandardShowCaller() {
  return isFollowingSelf() && session.role === 'instructor' && !adminSession;
}

function requestExitLive() {
  const isSuper = adminSession?.level === 'super';
  if (!isSuper && isFollowingSelf()) {
    const followersOfMe = Object.values(currentPresence||{})
      .filter(p => p.name !== session.userName && p.following === session.userName);
    if (followersOfMe.length > 0) {
      toast(`${followersOfMe.length} user(s) are following you. Remove yourself as Show Caller first.`);
      return;
    }
  }
  showOverlay('exitLiveOv');
}

function confirmExitLive() {
  hideOverlay('exitLiveOv');
  showRundown();
}

function renderLiveCurrent(b, i) {
  const types = Object.keys(b.cues||{}).filter(t=>CT[t]&&t!=='script');
  const sd = b.cues?.script;
  const adminCaller = isAdminShowCaller();
  const cueBlocks = types.map(t => {
    const d = b.cues[t], tc = CT[t];
    return `<div class="lv-cue-block" style="border-left-color:${tc.color}">
      <div class="lv-cue-label" style="color:${tc.color}">${tc.icon} ${tc.label}</div>
      ${d.ready?`<div class="lv-cue-ready">✓ ${esc(d.ready)}</div>`:''}
      ${d.take?`<div class="lv-cue-take">→ ${esc(d.take)}</div>`:''}
    </div>`;
  }).join('');
  return `<div class="lv-cur-card">
    <div class="lv-cur-badge">● NOW — Row ${i+1}</div>
    <div class="lv-cur-name">${esc(b.info||'—')}</div>
    ${b.notes?`<div class="lv-cur-note">${esc(b.notes)}</div>`:''}
    ${fmtDur(b)!=='—'?`<div class="lv-cur-dur">${fmtDur(b)}</div>`:''}
    ${cueBlocks?`<div class="lv-cue-blocks">${cueBlocks}</div>`:''}
    ${sd?.text?`<div class="lv-cur-script">${esc(sd.text)}</div>`:''}
    ${sd&&adminCaller?`<button class="ltr-edit-btn" style="margin-top:8px" onclick="openLiveScript(${i})">✎ Edit &amp; Push</button>`:''}
  </div>`;
}

function renderLiveNext(b, i, isRunner) {
  const types = Object.keys(b.cues||{}).filter(t=>CT[t]&&t!=='script');
  const cueSmall = types.map(t => {
    const d = b.cues[t], tc = CT[t];
    return `<span class="lv-next-cue" style="border-left-color:${tc.color}">
      <span style="color:${tc.color}">${tc.icon}</span>
      ${d.ready?`<span>✓ ${esc(d.ready)}</span>`:''}
      ${d.take?`<span style="opacity:.6">→ ${esc(d.take)}</span>`:''}
    </span>`;
  }).join('');
  const handler = isRunner ? `jumpToLsCue(${i})` : `liveRowPreview(${i})`;
  return `<div class="lv-next-card" onclick="${handler}">
    <div class="lv-next-badge">NEXT → Row ${i+1}</div>
    <div class="lv-next-name">${esc(b.info||'—')}</div>
    ${b.notes?`<div class="lv-next-note">${esc(b.notes)}</div>`:''}
    ${cueSmall?`<div class="lv-next-cues">${cueSmall}</div>`:''}
    ${fmtDur(b)!=='—'?`<div class="lv-next-dur">${fmtDur(b)}</div>`:''}
  </div>`;
}

function liveRowPreview(idx) {
  const b = beats[idx]; if (!b) return;
  const titleEl = document.getElementById('lrpTitle');
  const bodyEl  = document.getElementById('lrpBody');
  if (!titleEl||!bodyEl) return;
  titleEl.textContent = `${idx+1}. ${b.info||'—'}`;
  const types = Object.keys(b.cues||{}).filter(t=>CT[t]);
  let html = '';
  if (b.notes) html += `<div style="color:var(--text2);font-size:13px;margin-bottom:12px;line-height:1.5">${esc(b.notes)}</div>`;
  if (fmtDur(b)!=='—') html += `<div style="font-family:var(--mono);font-size:12px;color:var(--text3);margin-bottom:10px">Duration: ${fmtDur(b)}</div>`;
  types.forEach(t => {
    const d = b.cues[t], tc = CT[t];
    html += `<div style="border-left:3px solid ${tc.color};padding:8px 12px;margin-bottom:8px;border-radius:0 8px 8px 0;background:var(--s2)">
      <div style="font-size:10px;font-family:var(--mono);color:${tc.color};letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">${tc.icon} ${tc.label}</div>
      ${d.ready?`<div style="font-size:14px;font-weight:600;margin-bottom:2px">✓ ${esc(d.ready)}</div>`:''}
      ${d.take?`<div style="font-size:13px;color:var(--text2)">→ ${esc(d.take)}</div>`:''}
      ${t==='script'&&d.text?`<div style="font-size:13px;line-height:1.7;color:var(--text);margin-top:8px;white-space:pre-wrap;border-top:1px solid var(--border);padding-top:8px">${esc(d.text)}</div>`:''}
    </div>`;
  });
  if (!types.length) html = '<div style="color:var(--text3);text-align:center;padding:20px">No cues configured.</div>';
  bodyEl.innerHTML = html;
  showOverlay('lsRowPreviewOv');
}

function renderLive() {
  const body = document.getElementById('lsBody');
  if (!beats.length) { body.innerHTML='<div style="text-align:center;padding:40px;color:var(--text3)">No cues in rundown.</div>'; return; }

  // canJump = can click arbitrary rows to jump position (admin show callers only)
  const runner  = isFollowingSelf();
  const canJump = runner && isAdminShowCaller();
  let html = '';

  beats.forEach((b, i) => {
    const isCur  = i === lsIdx;
    const isNext = i === lsIdx + 1;
    const isDone = i < lsIdx;
    const ahead  = i - lsIdx;

    if (isCur) {
      html += renderLiveCurrent(b, i);
    } else if (isNext) {
      html += renderLiveNext(b, i, runner);
    } else if (isDone) {
      const handler = canJump ? `jumpToLsCue(${i})` : `liveRowPreview(${i})`;
      html += `<div class="lv-done-row" onclick="${handler}">
        <span class="lv-done-num">${i+1}</span>
        <span class="lv-done-name">${esc(b.info||'—')}</span>
      </div>`;
    } else {
      const op = Math.max(0.25, 0.85 - (ahead - 2) * 0.18).toFixed(2);
      const fs = Math.max(10, 13 - (ahead - 2));
      const handler = canJump ? `jumpToLsCue(${i})` : `liveRowPreview(${i})`;
      html += `<div class="lv-fut-row" style="opacity:${op}" onclick="${handler}">
        <span class="lv-fut-num">${i+1}</span>
        <span class="lv-fut-name" style="font-size:${fs}px">${esc(b.info||'—')}</span>
        ${fmtDur(b)!=='—'?`<span class="lv-fut-dur">${fmtDur(b)}</span>`:''}
        <span style="display:flex;gap:3px">${Object.keys(b.cues||{}).filter(t=>CT[t]).map(t=>`<span style="color:${CT[t].color};font-size:10px">${CT[t].icon}</span>`).join('')}</span>
      </div>`;
    }
  });

  body.innerHTML = html;
  const cur = body.querySelector('.lv-cur-card');
  if (cur) cur.scrollIntoView({behavior:'smooth', block:'center'});
  renderFollowChips();
  updateLsPrompter();
}

function liveQuick(b, type) {
  const d = b.cues?.[type];
  if (!d) return '<span style="color:var(--text3);font-size:10px">—</span>';
  const tc = CT[type];
  let s = '';
  switch(type) {
    case 'video':    s=d.state||d.source||''; break;
    case 'audio':    s=d.action||d.source||''; break;
    case 'playback': s=d.state||d.clipName||''; break;
    case 'gfx':      s=d.gfxType||d.source||''; break;
    case 'lighting': s=d.action||d.fixture||''; break;
  }
  return `<div class="ltr-cue-quick" style="border-left-color:${tc.color};color:${tc.color}">${esc(s)}</div>`;
}

function openLiveScript(beatIdx) {
  const b = beats[beatIdx]; if (!b) return;
  liveScriptEditIdx = beatIdx;
  const d = b.cues?.script||{};
  document.getElementById('lsScriptEditTitle').textContent = b.info||`Row ${beatIdx+1}`;
  document.getElementById('lsScriptEditText').value = d.text||'';
  showOverlay('lsScriptEditOv');
}

function saveLiveScript() {
  const b = beats[liveScriptEditIdx]; if (!b) return;
  if (!b.cues) b.cues={};
  if (!b.cues.script) b.cues.script={ready:'',take:''};
  b.cues.script.text = document.getElementById('lsScriptEditText').value;
  const d = b.cues.script;
  prompterText = (d.ready?`${d.ready.toUpperCase()}:\n`:'') + (d.text||'');
  sendToPrompter();
  hideOverlay('lsScriptEditOv');
  renderLive(); syncToFirestore(); toast('Script saved & pushed.');
}

function jumpToLsCue(i) {
  if (session.role==='student') return;
  if (isStandardShowCaller()) return; // standard show callers may only advance sequentially
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
  const chips = document.getElementById('followChips');
  if (!chips) return;
  const now = Date.now();
  const others = Object.values(currentPresence||{})
    .filter(p=>p.name!==session.userName&&(now-(p.lastSeen||0))<90000);
  let html = `<div class="follow-chip follow-self active" onclick="followSelf()">Myself</div>`;
  others.forEach(p=>{
    html+=`<div class="follow-chip" onclick="followPerson(this,'${esc(p.name)}')">${esc(p.name)}<span class="p-tip-label" style="margin-left:5px">${p.role==='instructor'?'INST':'STU'}</span></div>`;
  });
  chips.innerHTML = html;
  const forceBtn = document.getElementById('forceFollowBtn');
  if (forceBtn) {
    forceBtn.style.display = (session.role === 'instructor' && isFollowingSelf()) ? '' : 'none';
  }
}

function followSelf() {
  document.querySelectorAll('.follow-chip').forEach(c=>c.classList.remove('active'));
  document.querySelector('.follow-self')?.classList.add('active');
  updateFollowInPresence(session.userName);
}

function followPerson(el, name) {
  document.querySelectorAll('.follow-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  toast(`Following ${name}`);
  updateFollowInPresence(name);
}

function updateFollowInPresence(name) {
  if (!session.code || session.isDemo || !window._firebaseReady) return;
  window._updateDoc(window._doc(window._db,'sessions',session.code), {
    [`presence.${presenceId}.following`]: name
  }).catch(()=>{});
}

// Show Caller: force all users to follow them
function forceMeAsShowCaller() {
  if (!session.code || session.isDemo) return;
  window._updateDoc(window._doc(window._db,'sessions',session.code), {
    forceCmd: { type:'followMe', name:session.userName, role:session.role, ts:Date.now() }
  }).catch(()=>{});
  toast('Forcing all users to follow you.');
}

// Admin: force everyone live and following a specific person
function adminForceLive(followName) {
  if (!adminSession || !session.code) return;
  window._updateDoc(window._doc(window._db,'sessions',session.code), {
    forceCmd: { type:'forceLive', name:followName, ts:Date.now() }
  }).catch(()=>{});
  toast(`Forcing everyone live, following ${followName}.`);
  closeAdminPanel();
}

// ─────────────────────────────────────────────────────────────
// PROMPTER
// ─────────────────────────────────────────────────────────────
function buildPromptFromRundown() {
  const scripts = beats.filter(b=>b.cues?.script?.text);
  if (!scripts.length) return;
  prompterText = scripts.map(b=>{
    const d = b.cues.script;
    const hdr = b.info ? `\n── ${b.info} ──\n` : '\n──────────────\n';
    return hdr + (d.ready ? `${d.ready.toUpperCase()}:\n` : '') + (d.text||'');
  }).join('\n\n');
  const el = document.getElementById('lsPrompterText');
  if (el) el.textContent = prompterText;
}

function initPrompter() {
  // Don't tear down an existing live channel — just re-send current text as an update.
  // Only create the channel once; PUTJ connection survives repeated goLive() calls.
  if (prompterChannel) {
    sendToPrompter(false); // non-interrupting refresh, scroll preserved
    return;
  }
  try {
    prompterChannel = new BroadcastChannel('prompt_up_the_jam');
    prompterChannel.onmessage = (e) => {
      if (e.data?.type === 'ping') {
        document.getElementById('prompterDot').className='ls-prompter-dot';
        document.getElementById('prompterStatusTxt').textContent='Connected';
        // PUTJ connected/reconnected — send full text with scroll reset
        sendToPrompter(true);
      }
    };
    prompterChannel.postMessage({ type:'cueola_hello', sessionCode:session.code });
    document.getElementById('prompterDot').className='ls-prompter-dot';
    document.getElementById('prompterStatusTxt').textContent='Ready';
  } catch {
    document.getElementById('prompterDot').className='ls-prompter-dot off';
    document.getElementById('prompterStatusTxt').textContent='Not available';
  }
}

function updatePrompterOnAdvance(prevBeat, newBeat) {
  if (prevBeat?.cues?.script?.text) {
    prompterText += '\n\n⬛ ─── [Production advancing] ───\n\n';
  }
  if (newBeat?.cues?.script?.text) {
    const d = newBeat.cues.script;
    prompterText += (d.ready ? `${d.ready.toUpperCase()}:\n` : '') + d.text + '\n';
  }
  sendToPrompter();
}

function sendToPrompter(isInit=false) {
  const el = document.getElementById('lsPrompterText');
  if (el) el.textContent = prompterText;
  if (prompterChannel) {
    prompterChannel.postMessage({
      type: isInit ? 'script_init' : 'script_update',
      text: prompterText,
      sessionCode: session.code,
      ts: Date.now()
    });
  }
  if (window._firebaseReady && session.code && !session.isDemo) {
    window._updateDoc(window._doc(window._db,'sessions',session.code),{
      'prompter.text':prompterText, 'prompter.updatedAt':Date.now()
    }).catch(()=>{});
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
  sendToPrompter(true); // reset scroll on clear
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
  applyTheme(t); // live preview — reverted on Cancel, saved on Save
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

let _settingsOpenTheme = null; // theme at the time settings opened, for Cancel revert

function cancelSettings() {
  // Revert live preview to whatever was saved before opening
  if (_settingsOpenTheme !== null) {
    currentTheme = _settingsOpenTheme;
    applyTheme(currentTheme);
    _settingsOpenTheme = null;
  }
  hideModal('modal-settings');
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
    _settingsOpenTheme = saved; // remember so Cancel can revert
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

  // PDF always uses canonical column order, not per-user preference
  const pdfCols = COL_DEFAULTS;
  const cueHeaders = pdfCols.map(type => `<th>${COL_META[type].label}</th>`).join('');

  const rows = beats.map((b, i) => {
    const startStr = show.start ? clock(show.start, offsetSecs) : '—';
    offsetSecs += (b.min||0)*60+(b.sec||0);

    // Per-type cells: show Ready / Take on separate lines
    const cueCells = pdfCols.map(type => {
      const d = b.cues?.[type];
      if (!d || (!d.ready && !d.take)) return '<td style="color:#888">—</td>';
      let cell = '';
      if (d.ready) cell += `<div style="color:#1a7a4a;font-size:9pt">✓ ${esc(d.ready)}</div>`;
      if (d.take)  cell += `<div style="color:#555;font-size:9pt">→ ${esc(d.take)}</div>`;
      if (type === 'script' && d.text) cell += `<div style="font-size:8pt;color:#333;margin-top:3px;border-top:1px solid #ddd;padding-top:2px">${esc(d.text)}</div>`;
      return `<td>${cell}</td>`;
    }).join('');

    return `<tr>
      <td>${i+1}</td>
      <td><strong>${esc(b.info||'—')}</strong>${b.notes?`<br><span style="font-size:8pt;color:#666">${esc(b.notes)}</span>`:''}</td>
      <td>${b.style==='timed'?'⏱ Timed':'⇔ Flex'}</td>
      <td>${startStr}</td>
      <td>${fmtDur(b)}</td>
      ${cueCells}
    </tr>`;
  }).join('');

  area.innerHTML = `
    <div class="print-title">${esc(show.name||'Rundown')}</div>
    <div class="print-meta">Exported ${new Date().toLocaleString()}${session.code?' · Session '+session.code:''}</div>
    <table class="print-table">
      <thead><tr><th>#</th><th>Name / Notes</th><th>Style</th><th>Start</th><th>Dur</th>${cueHeaders}</tr></thead>
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
// INIT — auto-join from dashboard or ?code= URL param
// ─────────────────────────────────────────────────────────────
restoreAdminSession();
applyTheme(currentTheme);

(function autoJoinFromDashboard() {
  // Check URL param first (?code=XXXX)
  const urlCode = new URLSearchParams(window.location.search).get('code');
  // Then check localStorage set by dashboard launchRundown()
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem('cueola_session') || 'null'); } catch {}
  // Clear it immediately so a refresh doesn't re-trigger
  localStorage.removeItem('cueola_session');

  const code = urlCode || stored?.code;
  if (!code) return;

  const name = stored?.userName || adminSession?.name || '';
  const role = stored?.role || 'instructor';

  const doJoin = () => {
    if (name) {
      session = { code, role, userName:name, isDemo:false, isExpert:false };
      enterRundown();
    } else {
      // No name stored — show the join modal pre-filled with the code
      const inp = document.getElementById('stud-code');
      if (inp) inp.value = code;
      showModal('modal-stud');
    }
  };

  if (window._firebaseReady) doJoin();
  else window.addEventListener('firebaseReady', doJoin, { once: true });
})();
