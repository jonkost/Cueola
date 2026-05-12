'use strict';

// ─────────────────────────────────────────────────────────────
// CUE TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────────
const CT = {
  video:    { label:'VIDEO',    color:'var(--video)', bg:'var(--video-bg)', icon:'📺' },
  audio:    { label:'AUDIO',    color:'#22d3a0', bg:'rgba(34,211,160,.12)', icon:'🎙' },
  lighting: { label:'LIGHTING', color:'#b06ef8', bg:'rgba(176,110,248,.12)', icon:'💡' },
  playback: { label:'PLAYBACK', color:'#f05252', bg:'rgba(240,82,82,.12)', icon:'▶'  },
  gfx:      { label:'GFX',      color:'#f5b731', bg:'rgba(245,183,49,.12)', icon:'🖼'  },
  script:   { label:'SCRIPT',   color:'#22d3d3', bg:'rgba(34,211,211,.12)', icon:'📄' },
};

// Column ordering — persisted per user in localStorage
const COL_META = {
  video:    { label:'📺 Video',    color:'var(--video)' },
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
let liveTimerStartMs = null;
let prompterText = '';
let prompterChannel = null;
let prompterLegacyChannel = null;
const CLIENT_ID = (() => {
  try {
    const key = 'cueola_client_id';
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = 'cl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem(key, id);
    return id;
  } catch {
    return 'cl_' + Math.random().toString(36).slice(2, 10);
  }
})();
const CUEOLA_THEMES = ['warm','cool','white','green','black'];
function normalizeCueolaTheme(t) { return CUEOLA_THEMES.includes(t) ? t : 'cool'; }
function normalizeFrameRate(v) { return [24,30,60].includes(Number(v)) ? Number(v) : 30; }
let currentTheme = normalizeCueolaTheme(localStorage.getItem('cueola_theme'));
let frameRate = normalizeFrameRate(localStorage.getItem('cueola_frame_rate'));
let adminSession = null; // { id, name, level }
let sessionCustomSources = {}; // { video:[], audio:[], gfx:[], scriptWho:[] }

const LOCAL_DRAFT_PREFIX = 'cueola_local_draft_';

function localDraftKey() {
  if (session.isDemo) return '';
  if (session.code) return `${LOCAL_DRAFT_PREFIX}${session.code}`;
  return `${LOCAL_DRAFT_PREFIX}expert`;
}

function saveLocalDraft() {
  const key = localDraftKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      show,
      beats,
      customSources: sessionCustomSources,
      updatedAt: Date.now(),
    }));
  } catch {}
}

function restoreLocalDraft() {
  const key = localDraftKey();
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    if (!draft || !Array.isArray(draft.beats)) return false;
    show = {
      name: draft.show?.name || 'Untitled Show',
      start: draft.show?.start || '',
    };
    beats = draft.beats.map(migrateBeat);
    sessionCustomSources = draft.customSources || {};
    return true;
  } catch {
    return false;
  }
}

// Add-row wizard state
let arStyle = null;
let arCueType = null; // single selected type in step 2

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

// Prompt Op Mode — teleprompter-operator focused live view
let promptOpMode = false;
let browserBackGuardReady = false;
let _lastHandledForceCmdTs = 0;
let livePrompterOpen = false;
let liveSidebarWidth = 360;
let previewRowIdx = 0;
let callSheetPeople = [];

function pushSessionHistoryState(screen) {
  if (!history.pushState) return;
  try {
    history.pushState({ cueolaSession:true, screen }, '', location.href);
    browserBackGuardReady = true;
  } catch {}
}

function leaveSessionForFrontPage() {
  stopTimer();
  if (firestoreUnsub) { try { firestoreUnsub(); } catch {} firestoreUnsub = null; }
  document.getElementById('rundown')?.classList.remove('on');
  document.getElementById('liveshow')?.classList.remove('on');
  document.getElementById('liveshow')?.classList.remove('prompt-op-active');
  document.getElementById('promptypus')?.classList.remove('on');
  document.getElementById('entry')?.classList.add('on');
  sessionStorage.removeItem('cueola_screen');
}

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

function fmtProductionClock(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const f = Math.min(frameRate - 1, Math.floor((safeMs % 1000) / 1000 * frameRate));
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

function fmtProductionSecs(t) {
  return fmtProductionClock((t || 0) * 1000);
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

function showModal(id)  { const el=document.getElementById(id); if(!el)return; el.style.display=''; el.classList.add('on'); }
function hideModal(id)  { const el=document.getElementById(id); if(!el)return; el.style.display=''; el.classList.remove('on'); }
function hideOverlay(id){ const el=document.getElementById(id); if(!el)return; el.style.display=''; el.classList.remove('on'); }

function showOverlay(id){ const el=document.getElementById(id); if(!el)return; el.style.display=''; el.classList.add('on'); }

// ─────────────────────────────────────────────────────────────
// ADMIN SYSTEM (Firestore-backed, localStorage fallback cache)
// ─────────────────────────────────────────────────────────────
const ADMIN_KEY = 'cueola_admins_v2';         // localStorage mirror key
const ADMIN_SESSION_KEY = 'cueola_admin_sess'; // localStorage session key
const ADMINS_DOC = 'admins/global';            // Firestore document path
const OWNER_BOOTSTRAP_HASH = '045515f2';
const OWNER_ADMIN_ID = 'adm_owner_jonkost';

let _adminsCache = [];      // in-memory list, always current
let _adminsCacheReady = false; // true once Firestore (or fallback) has loaded
let _adminsUnsub = null;    // Firestore onSnapshot unsubscribe

const SESSION_SOURCE_DEFAULTS = {
  video: ['CAM 1','CAM 2','CAM 3','CAM 4','CPU','PLBK','GFX','ME 1'],
  audio: ['Host','Guest 1','Guest 2','CPU','PLBK','VOU','SFX','Music','Mains'],
  gfx:   ['GFX','Media 1','Media 2','Media 3','Media 4','ME 1'],
  scriptWho: ['Host','Guest 1','Guest 2','VOU'],
};

function hashStr(s) {
  let h = 0;
  for (let i=0;i<s.length;i++) { h = Math.imul(31,h)+s.charCodeAt(i)|0; }
  return (h>>>0).toString(16).padStart(8,'0');
}

function isOwnerBootstrapCode(code) {
  return hashStr(code || '') === OWNER_BOOTSTRAP_HASH;
}

// ── Read helpers (always sync against in-memory cache) ──────
function getAdmins()      { return _adminsCache; }
function hasSuperAdmin()  { return _adminsCache.some(a=>a.level==='super'); }
function countFullAccess(){ return _adminsCache.filter(a=>a.level==='super'||a.level==='full').length; }

// ── Write: update cache + localStorage mirror + Firestore ───
function saveAdmins(list) {
  _adminsCache = list;
  try { localStorage.setItem(ADMIN_KEY, JSON.stringify(list)); } catch {}
  if (window._firebaseReady) {
    window._setDoc(window._doc(window._db, 'admins', 'global'), { list })
      .catch(() => {});
  }
}

// ── Load from Firestore; migrate localStorage admins if first run ──
function initAdminsFromFirestore() {
  if (!window._firebaseReady) return;
  const ref = window._doc(window._db, 'admins', 'global');

  // Set up real-time listener — changes on any device propagate here instantly
  if (_adminsUnsub) _adminsUnsub();
  _adminsUnsub = window._onSnapshot(ref, snap => {
    if (snap.exists()) {
      _adminsCache = snap.data().list || [];
    } else {
      // First run: migrate any existing localStorage admins to Firestore
      const local = (() => { try { return JSON.parse(localStorage.getItem(ADMIN_KEY))||[]; } catch { return []; } })();
      _adminsCache = local;
      if (local.length) {
        window._setDoc(ref, { list: local }).catch(() => {});
      }
    }
    _adminsCacheReady = true;
    // Re-run session restore now that we have real data
    restoreAdminSession();
    updateAdminUI();
  }, () => {
    // Firestore read failed — fall back to localStorage
    _adminsCache = (() => { try { return JSON.parse(localStorage.getItem(ADMIN_KEY))||[]; } catch { return []; } })();
    _adminsCacheReady = true;
    restoreAdminSession();
    updateAdminUI();
  });
}

// ── Session: device-local, verified against cache ───────────
function loginAdmin(code) {
  if (!_adminsCacheReady) {
    const owner = ensureOwnerSuperAdmin(code);
    if (owner) {
      adminSession = { id:owner.id, name:owner.name, level:owner.level };
      try { localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(adminSession)); } catch {}
      return adminSession;
    }
    toast('Admin data loading — try again in a moment.');
    return null;
  }
  const h = hashStr(code);
  const a = _adminsCache.find(x=>x.codeHash===h);
  const resolved = a || ensureOwnerSuperAdmin(code);
  if (!resolved) return null;
  adminSession = { id:resolved.id, name:resolved.name, level:resolved.level };
  try { localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(adminSession)); } catch {}
  return adminSession;
}

function logoutAdmin() {
  adminSession = null;
  try { localStorage.removeItem(ADMIN_SESSION_KEY); } catch {}
  updateAdminUI();
}

function restoreAdminSession() {
  try {
    const s = JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY));
    if (s) {
      const a = _adminsCache.find(x=>x.id===s.id);
      if (a) adminSession = { id:a.id, name:a.name, level:a.level };
      else   adminSession = null; // admin was removed — invalidate session
    }
  } catch {}
}

// ── CRUD helpers ─────────────────────────────────────────────
function createAdmin(name, code, level, createdBy=null) {
  const list = [..._adminsCache];
  const id = 'adm_'+Date.now().toString(36);
  list.push({ id, name, codeHash:hashStr(code), level, createdBy });
  saveAdmins(list);
  return id;
}

function ensureOwnerSuperAdmin(code) {
  if (!isOwnerBootstrapCode(code)) return null;
  const existingOwner = _adminsCache.find(a=>a.id===OWNER_ADMIN_ID);
  const owner = {
    id: OWNER_ADMIN_ID,
    name: existingOwner?.name || 'Jon Kost',
    codeHash: existingOwner?.codeHash || OWNER_BOOTSTRAP_HASH,
    level: 'super',
    createdBy: 'owner-bootstrap'
  };
  const list = _adminsCache.filter(a=>a.id!==OWNER_ADMIN_ID);
  list.unshift(owner);
  saveAdmins(list);
  return owner;
}

function removeAdmin(id) {
  saveAdmins(_adminsCache.filter(a=>a.id!==id));
}

function updateAdminCode(id, newCode) {
  const idx = _adminsCache.findIndex(a=>a.id===id);
  if (idx < 0) return false;
  const list = _adminsCache.map(a=>a.id===id ? {...a, codeHash:hashStr(newCode)} : a);
  saveAdmins(list);
  return true;
}

function updateAdminUI() {
  const btn = document.getElementById('adminBtn');
  if (!btn) return;
  if (adminSession) {
    btn.textContent = `🔑 ${adminSession.name.split(' ')[0]}`;
    btn.className = 'tbtn tbtn-admin';
  } else {
    btn.textContent = '🔑 Admin';
    btn.className = 'tbtn tbtn-ghost';
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
  document.getElementById('setupOwnerCode').value = '';
  showModal('adminSetupModal');
}

function submitAdminSetup() {
  const name  = document.getElementById('setupAdminName').value.trim();
  const owner = document.getElementById('setupOwnerCode').value;
  const code  = document.getElementById('setupAdminCode').value;
  const code2 = document.getElementById('setupAdminCode2').value;
  const err   = document.getElementById('setupAdminErr');
  err.classList.remove('on');
  if (!name || !owner || !code) { err.textContent='Name, owner bootstrap code, and admin code are required.'; err.classList.add('on'); return; }
  if (!isOwnerBootstrapCode(owner)) { err.textContent='Owner bootstrap code is required to create a super admin.'; err.classList.add('on'); return; }
  if (code !== code2) { err.textContent='Codes do not match.'; err.classList.add('on'); return; }
  if (hasSuperAdmin() && !_adminsCache.some(a=>a.id===OWNER_ADMIN_ID)) { err.textContent='Super admin already exists.'; err.classList.add('on'); return; }
  ensureOwnerSuperAdmin(owner);
  updateAdminCode(OWNER_ADMIN_ID, code);
  const admins = getAdmins().map(a=>a.id===OWNER_ADMIN_ID ? {...a, name:name||'Jon Kost'} : a);
  saveAdmins(admins);
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
  if (isSuper) {
    html += `<div class="admin-section">
      <div class="admin-section-label">Admin Management</div>
      ${session.code ? `<div class="admin-session-actions">
        <button class="admin-act-btn" onclick="copySessionCode()">Copy Session Code</button>
        <button class="admin-act-btn" onclick="copySessionLink()">Copy Session Link</button>
        <button class="admin-act-btn" onclick="shareSessionInvite()">Share Session</button>
        <button class="admin-act-btn" onclick="openPaperworkHub()">Open Pre-Pro Paperwork</button>
      </div>` : ''}
      <div class="admin-list">`;
    admins.forEach(a => {
      const isMe = a.id===adminSession.id;
      const canEdit = isSuper && !isMe; // super can edit others; full cannot see codes
      const canRemove = (isSuper && !isMe) || (isFull && a.level==='standard' && !isMe);
      const levelClass = `alc-${a.level}`;
      const canEditCode = isSuper; // super can edit any code including own
      html += `<div class="admin-item">
        <div>
          <div class="admin-item-name">${esc(a.name)}</div>
          <span class="admin-level-chip ${levelClass}" style="margin-top:4px;display:inline-block">${a.level.toUpperCase()}</span>
        </div>
        <div style="flex:1"></div>
        ${isMe ? '<span class="admin-item-you">YOU</span>' : ''}
        <div class="admin-item-acts">
          ${session.code ? `<button class="admin-act-btn" onclick="shareSessionInvite(${JSON.stringify(a.name).replace(/"/g,'&quot;')})">Send Session</button>` : ''}
          ${canEditCode ? `<button class="admin-act-btn" onclick="promptEditCode('${a.id}',${JSON.stringify(a.name).replace(/"/g,'&quot;')})">Edit Code</button>` : ''}
          ${isSuper && !isMe && a.level==='standard' ? `<button class="admin-act-btn" onclick="promoteToFull('${a.id}')">→ Full</button>` : ''}
          ${isSuper && !isMe && a.level==='full' ? `<button class="admin-act-btn" onclick="promoteToSuper('${a.id}')">→ Super</button><button class="admin-act-btn" onclick="demoteToStandard('${a.id}')">→ Standard</button>` : ''}
          ${isSuper && !isMe && a.level==='super' ? `<button class="admin-act-btn" onclick="demoteToFull('${a.id}')">→ Full</button>` : ''}
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
    const presenceNames = getActivePresencePeople().map(p=>p.name);
    const nameOpts = presenceNames.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
    html += `<div class="admin-section" style="margin-top:16px">
      <div class="admin-section-label">Live Control</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select id="adminFollowSelect" class="field-in" style="flex:1;min-width:120px;font-size:12px;padding:6px 10px">
          ${presenceNames.length ? nameOpts : '<option>No users online</option>'}
        </select>
        <button class="admin-act-btn" ${presenceNames.length?'':'disabled'} style="background:rgba(240,82,82,.15);border-color:rgba(240,82,82,.4);color:var(--red);${presenceNames.length?'':'opacity:.45;cursor:not-allowed'}" onclick="adminForceLive(document.getElementById('adminFollowSelect').value)">🔴 Force Everyone Live + Follow</button>
      </div>
    </div>`;
  }
  html += `<button class="admin-logout-btn" onclick="logoutAdmin();closeAdminPanel()">Logout Admin</button>`;
  body.innerHTML = html;
  window._newAdminLevel = 'standard';
}

function renderSourcesRow(key, label) {
  const defaults = SESSION_SOURCE_DEFAULTS[key] || [];
  const removed = sessionCustomSources.__removed?.[key] || [];
  const custom = (sessionCustomSources[key]||[]);
  const all = [...defaults.filter(s=>!removed.includes(s)), ...custom];
  const chips = all.map(s => {
    return `<span class="admin-src-chip">${esc(s)}<button class="rm" onclick="removeSessionSource('${key}',${JSON.stringify(s).replace(/"/g,'&quot;')})" title="Remove ${esc(s)}">x</button></span>`;
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

function sessionInviteLink() {
  const url = new URL(location.href);
  url.searchParams.set('code', session.code || '');
  url.hash = '';
  return url.toString();
}

function writeClipboard(text, doneMsg) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(()=>toast(doneMsg)).catch(()=>prompt('Copy this:', text));
  } else {
    prompt('Copy this:', text);
  }
}

function copySessionCode() {
  if (!session.code) return;
  writeClipboard(session.code, 'Session code copied.');
}

function copySessionLink() {
  if (!session.code) return;
  writeClipboard(sessionInviteLink(), 'Session link copied.');
}

function shareSessionInvite(name='') {
  if (!session.code) return;
  const text = `${name ? `${name}, join` : 'Join'} ${show.name || 'Cueola'}\nCode: ${session.code}\n${sessionInviteLink()}`;
  if (navigator.share) {
    navigator.share({ title:'Cueola Session', text }).catch(()=>{});
  } else {
    writeClipboard(text, 'Session invite copied.');
  }
}

function promoteToFull(id) {
  if (countFullAccess()>=3) { toast('Max 3 full-access admins reached.'); return; }
  const admins = getAdmins();
  const a = admins.find(x=>x.id===id);
  if (a) { a.level='full'; saveAdmins(admins); renderAdminBody(); toast(`${a.name} promoted to Full Access.`); }
}

function promoteToSuper(id) {
  const admins = getAdmins();
  const a = admins.find(x=>x.id===id);
  if (a) { a.level='super'; saveAdmins(admins); renderAdminBody(); toast(`${a.name} promoted to Super Admin.`); }
}

function demoteToFull(id) {
  const admins = getAdmins();
  const a = admins.find(x=>x.id===id);
  if (a) { a.level='full'; saveAdmins(admins); renderAdminBody(); toast(`${a.name} set to Full Access.`); }
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
  const clean = val.trim();
  const defaults = SESSION_SOURCE_DEFAULTS[key] || [];
  if (!sessionCustomSources.__removed) sessionCustomSources.__removed = {};
  if (!sessionCustomSources.__removed[key]) sessionCustomSources.__removed[key] = [];
  if (defaults.includes(clean)) {
    sessionCustomSources.__removed[key] = sessionCustomSources.__removed[key].filter(s=>s!==clean);
    syncSessionSources();
    renderAdminBody();
    return;
  }
  if (!sessionCustomSources[key]) sessionCustomSources[key]=[];
  if (sessionCustomSources[key].includes(clean)) return;
  sessionCustomSources[key].push(clean);
  syncSessionSources();
  renderAdminBody();
}

function removeCustomSource(key, idx) {
  if (!sessionCustomSources[key]) return;
  sessionCustomSources[key].splice(idx,1);
  syncSessionSources();
  renderAdminBody();
}

function removeSessionSource(key, value) {
  const defaults = SESSION_SOURCE_DEFAULTS[key] || [];
  if (!sessionCustomSources.__removed) sessionCustomSources.__removed = {};
  if (!sessionCustomSources.__removed[key]) sessionCustomSources.__removed[key] = [];
  if (defaults.includes(value)) {
    if (!sessionCustomSources.__removed[key].includes(value)) sessionCustomSources.__removed[key].push(value);
  } else if (sessionCustomSources[key]) {
    sessionCustomSources[key] = sessionCustomSources[key].filter(s=>s!==value);
  }
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
  const defaults = SESSION_SOURCE_DEFAULTS[key] || [];
  const removed = sessionCustomSources.__removed?.[key] || [];
  return [...defaults.filter(s=>!removed.includes(s)), ...(sessionCustomSources[key]||[])];
}

function migrateOldCue(type, d) {
  if (!d) return d;
  if (
    d.on !== undefined ||
    d.off !== undefined ||
    d.ready !== undefined ||
    d.take !== undefined
  ) return d; // already migrated
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

function joinPreProSession() {
  const code = document.getElementById('pp-join-code').value.trim().toUpperCase();
  const name = document.getElementById('pp-join-name').value.trim();
  const errEl = document.getElementById('pp-join-err');
  if (!code || !name) { errEl.textContent='Code and name required.'; errEl.classList.add('on'); return; }
  errEl.classList.remove('on');
  const openLocal = snap => {
    const d = snap.data() || {};
    session = { code, role:'student', userName:name, isDemo:false, isExpert:false };
    show = { name:d.showName || 'Untitled Show', start:d.startTime || '' };
    if (Array.isArray(d.beats)) beats = d.beats.map(migrateBeat);
    hideModal('modal-prepro-join');
    openPaperworkHub();
    joinPresence();
  };
  const verify = () => {
    window._getDoc(window._doc(window._db,'sessions',code)).then(snap => {
      if (!snap.exists()) {
        errEl.textContent = 'Session not found. Check the code and try again.';
        errEl.classList.add('on');
        return;
      }
      openLocal(snap);
    }).catch(() => {
      errEl.textContent = 'Could not connect. Check your internet connection.';
      errEl.classList.add('on');
    });
  };
  if (window._firebaseReady) verify();
  else window.addEventListener('firebaseReady', verify, {once:true});
}

function loadExpert() {
  session = { code:'', role:'instructor', userName:'You', isDemo:false, isExpert:true };
  show = { name:'Untitled Show', start:'' };
  beats = [];
  restoreLocalDraft();
  enterRundown();
}

function loadDemo() {
  session = { code:'DEMO1', role:'student', userName:'Demo', isDemo:true, isExpert:false };
  show = { name:'Campus News — Demo Show', start:'19:00' };
  beats = DEMO_BEATS.map((b,i)=>({...b, id:i+1})).map(migrateBeat);
  enterRundown();
}

function goHome() {
  if (!confirm('Go back to the home screen? You can rejoin or reload your session.')) return;
  leaveSessionForFrontPage();
}

function enterRundown() {
  applyTheme(currentTheme);
  document.getElementById('entry').classList.remove('on');
  document.getElementById('rundown').classList.add('on');
  document.getElementById('liveshow').classList.remove('on');
  pushSessionHistoryState('build');

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
      if (d.prePro) {
        try { localStorage.setItem(preProKey(), JSON.stringify(d.prePro)); } catch {}
      }
      if (d.activeIdx !== undefined && session.role==='student') {
        lsIdx = d.activeIdx;
        if (document.getElementById('liveshow').classList.contains('on')) renderLive();
      }
      if (d.prompter && d.prompter.text !== undefined && session.role==='student') {
        prompterText = d.prompter.text || '';
        const el = document.getElementById('lsPrompterText');
        if (el) el.textContent = prompterText;
        // Forward live to any connected Promptypus on this device, scroll-preserving.
        _postPrompterMessage(getPrompterPayload(false));
        ptUpdateFromCueola(prompterText);
      }
      if (d.prompter?.control?.ts && d.prompter.control.ts > _lastPrompterControlTs) {
        const control = d.prompter.control;
        _lastPrompterControlTs = control.ts;
        if (control.sender !== CLIENT_ID && Date.now() - control.ts < 30000) {
          ptHandleRemoteControl(control.action);
        }
      }
      // Handle force commands
      if (d.forceCmd && d.forceCmd.ts) {
        const cmd = d.forceCmd;
        const age = Date.now() - (cmd.ts||0);
        if (age < 30000 && cmd.ts > _lastHandledForceCmdTs) { // only act on new commands < 30 seconds old
          _lastHandledForceCmdTs = cmd.ts;
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
  saveLocalDraft();
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

function getActivePresencePeople() {
  const now = Date.now();
  const seen = new Set();
  return Object.values(currentPresence||{})
    .filter(p => p?.name && (now - (p.lastSeen||0)) < 90000)
    .sort((a,b)=>a.role==='instructor'?-1:b.role==='instructor'?1:0)
    .filter(p => {
      const key = p.name.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function renderPresence(map) {
  currentPresence = map || {};
  const active = getActivePresencePeople();
  const wrap = document.getElementById('presenceWrap');
  if (!active.length||!session.code||session.isDemo||session.isExpert){
    wrap.style.display='none';
    if (document.getElementById('adminPanel')?.classList.contains('on')) renderAdminBody();
    return;
  }
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
  if (document.getElementById('adminPanel')?.classList.contains('on')) renderAdminBody();
}

window.addEventListener('beforeunload', leavePresence);

// Arrow key navigation in live screen
document.addEventListener('keydown', e => {
  const liveOn = document.getElementById('liveshow')?.classList.contains('on');
  if (!liveOn) return;
  // Don't intercept when typing in an input/textarea
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); lsNext(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); lsPrev(); }
});

// ─────────────────────────────────────────────────────────────
// RUNDOWN RENDERING
// ─────────────────────────────────────────────────────────────
function toggleEditMode() {
  editMode = !editMode;
  const btn = document.getElementById('editModeBtn');
  if (btn) {
    btn.textContent = editMode ? '✓ Done Editing' : '✎ Edit';
    btn.style.background = editMode ? 'color-mix(in srgb,var(--accent) 16%,transparent)' : '';
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
  thead.innerHTML = `${dragCol}<th class="col-num">#</th><th class="col-info">Name</th><th class="col-time">Start / Dur</th>${dynCols}`;
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
    tbody.innerHTML = `<tr><td colspan="10">
      <div class="empty-rundown">
        <div class="empty-rundown-title">Start with your first row</div>
        <div class="empty-rundown-sub">Build the rundown one production beat at a time. Each row can hold video, audio, playback, graphics, lighting, and script cues.</div>
        <button class="empty-rundown-btn" onclick="openAddRow()">Add First Row</button>
      </div>
    </td></tr>`;
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
        <button class="row-ea-btn" onclick="moveRowUp(${b.id})"${i===0?' disabled style="opacity:.3;cursor:not-allowed"':''} title="Move up">▲ Up</button>
        <button class="row-ea-btn" onclick="moveRowDown(${b.id})"${i===beats.length-1?' disabled style="opacity:.3;cursor:not-allowed"':''} title="Move down">▼ Down</button>
        <button class="row-ea-btn row-ea-add-before" onclick="addRowAt(${i},'before')" title="Add row before">+ Before</button>
        <button class="row-ea-btn row-ea-del" onclick="removeRow(${b.id})" title="Remove row">✕ Remove</button>
        <button class="row-ea-btn row-ea-add-after" onclick="addRowAt(${i},'after')" title="Add row after">+ After</button>
      </div>` : '';
    html += `<tr class="cue-row${editMode?' edit-mode-row':''}" ${editMode?'draggable="true"':''} onclick="${editMode?'':'openEdit('+b.id+')'}" data-id="${b.id}">
      <td class="cd cd-drag" style="opacity:${editMode?'1':'.15'};cursor:${editMode?'grab':'default'}" title="${editMode?'Drag to reorder':'Enable edit mode to reorder'}">⠿</td>
      <td class="cd cd-num">${i+1}</td>
      <td class="cd" style="padding:8px 6px">
        <div class="cd-name">${esc(b.info||'—')}</div>
        ${b.notes?`<div class="cd-subnote">${esc(b.notes)}</div>`:''}
        <span class="style-pill style-${b.style||'flex'}" style="margin-top:3px;display:inline-block">${b.style==='timed'?'⏱':'⇔'} ${(b.style||'flex').toUpperCase()}</span>
        ${editMode ? '' : '<div class="row-open-hint">Click row to edit</div>'}
        ${editActions}
      </td>
      <td class="cd" style="padding:8px 6px">
        ${startStr!=='—'?`<div class="cd-time-start">${startStr}</div>`:''}
        <div class="cd-time-dur">${dur}</div>
      </td>
      ${colOrder.map(type=>`<td class="cd-cue-cell">${getCueCell(b,type)}</td>`).join('')}
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
  tr.innerHTML = `<td colspan="10"><button class="add-row-btn-el" onclick="openAddRow()">+ Add Row</button></td>`;
  tbody.appendChild(tr);
}

function getCueOn(d)  { return d?.on  || d?.take  || ''; }   // new format, fallback legacy
function getCueOff(d) { return d?.off || d?.ready || ''; }   // new format, fallback legacy

function getCueCell(b, type) {
  const tc = CT[type];
  const d = b.cues?.[type];
  const on  = getCueOn(d);
  const off = getCueOff(d);
  const isEmpty = !on && !off && (type !== 'script' || !d?.text);
  if (isEmpty) {
    return `<button class="cue-add-btn" onclick="event.stopPropagation();openCueConfig(${b.id},'${type}')" title="Add ${tc.label} cue"><span>+</span><span>${tc.label}</span></button>`;
  }
  const lines = [
    on  ? `<div class="cue-on-line"><span class="cue-on-dot">▶</span>${esc(on)}</div>`  : '',
    off ? `<div class="cue-off-line"><span class="cue-off-dot">■</span>${esc(off)}</div>` : '',
  ].filter(Boolean).join('');
  const scriptMeta = type === 'script' && d?.text
    ? `<div class="script-present-line">Script · ${scriptLineCount(d.text)} lines</div>`
    : '';
  return `<div class="cue-cell-filled" onclick="event.stopPropagation();openCueConfig(${b.id},'${type}')">
    <div class="cue-cell-icon" style="color:${tc.color}">${tc.icon}</div>
    <div class="cue-cell-info">${lines}${scriptMeta}</div>
  </div>`;
}

function getCueSummary(b) {
  const pType = COL_DEFAULTS.find(t => b.cues?.[t] && (getCueOn(b.cues[t]) || getCueOff(b.cues[t])));
  if (!pType) return { stateStr:'', srcStr:'', detStr:'' };
  const d = b.cues[pType];
  return { stateStr: getCueOff(d)||'', srcStr: getCueOn(d)||'', detStr:'' };
}

function scriptLineCount(text) {
  const clean = String(text || '').trim();
  if (!clean) return 0;
  return clean.split(/\n+/).filter(line => line.trim()).length;
}

function updateBotBar() {
  const total = totalSecs();
  const elapsed = Math.min(elapsedSecs, total);
  const remain  = Math.max(total-elapsed, 0);
  document.getElementById('bb-el').textContent = fmtProductionSecs(elapsed);
  document.getElementById('bb-rm').textContent = remain>0 ? fmtProductionSecs(remain) : '—';
}

function updateNowNext() {
  const idx = beats.length ? Math.max(lsIdx, 0) : -1;
  const now  = beats[idx];
  const next = beats[idx+1];
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

function moveRowUp(id) {
  const i = beats.findIndex(b => b.id === id);
  if (i <= 0) return;
  [beats[i-1], beats[i]] = [beats[i], beats[i-1]];
  renderRundown(); syncToFirestore();
}

function moveRowDown(id) {
  const i = beats.findIndex(b => b.id === id);
  if (i < 0 || i >= beats.length - 1) return;
  [beats[i], beats[i+1]] = [beats[i+1], beats[i]];
  renderRundown(); syncToFirestore();
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
const AR_TYPE_DESC = {
  video:    'Camera, source switch',
  audio:    'Mics, music, sound',
  lighting: 'Fixtures, scenes, looks',
  playback: 'Clip rolls, VT, media',
  gfx:      'Graphics, lower thirds',
  script:   'Copy, dialogue, prompter',
};

function openAddRow() {
  arStyle = 'timed';
  arCueType = null;
  const nameIn = document.getElementById('ar-name-input');
  if (nameIn) nameIn.value = '';
  const notesIn = document.getElementById('ar-notes-input');
  if (notesIn) notesIn.value = '';
  const minIn = document.getElementById('ar-min');
  if (minIn) minIn.value = '0';
  const secIn = document.getElementById('ar-sec');
  if (secIn) secIn.value = '30';
  document.getElementById('ar-next-1').disabled = false;
  document.querySelectorAll('#ar-step-1 .opt-card').forEach(c=>c.classList.remove('sel'));
  document.getElementById('opt-timed')?.classList.add('sel');
  const durWrap = document.getElementById('ar-dur-wrap');
  if (durWrap) durWrap.style.display = '';
  document.getElementById('ar-step-1').classList.add('on');
  document.getElementById('ar-step-2').classList.remove('on');
  document.getElementById('ar-step-3')?.classList.remove('on');
  buildArContext();
  showOverlay('addRowOv');
  setTimeout(()=>nameIn?.focus(), 80);
}

function arGoStep2() {
  if (!arStyle) return;
  arCueType = null;
  const grid = document.getElementById('arTypeGrid');
  grid.innerHTML = Object.keys(CT).map(type => {
    const tc = CT[type];
    return `<div class="opt-card" id="artype-${type}"
        style="--oc:${tc.color};--ob:${tc.bg}"
        onclick="arSelectCueType('${type}')">
      <div class="opt-icon" style="font-size:24px">${tc.icon}</div>
      <div class="opt-name" style="color:${tc.color}">${tc.label}</div>
      <div class="opt-desc">${AR_TYPE_DESC[type]||''}</div>
    </div>`;
  }).join('');
  document.getElementById('ar-next-2').disabled = true;
  document.getElementById('ar-step-1').classList.remove('on');
  document.getElementById('ar-step-3')?.classList.remove('on');
  document.getElementById('ar-step-2').classList.add('on');
}

function arSelectCueType(type) {
  arCueType = type;
  document.querySelectorAll('#arTypeGrid .opt-card').forEach(c=>c.classList.remove('sel'));
  document.getElementById(`artype-${type}`)?.classList.add('sel');
  document.getElementById('ar-next-2').disabled = false;
}

function buildAddRowBeat() {
  const info  = document.getElementById('ar-name-input')?.value?.trim()||'';
  const notes = document.getElementById('ar-notes-input')?.value?.trim()||'';
  const min   = arStyle==='timed' ? (parseInt(document.getElementById('ar-min')?.value)||0) : 0;
  const sec   = arStyle==='timed' ? (parseInt(document.getElementById('ar-sec')?.value)||0) : 0;
  const newId = beats.length ? Math.max(...beats.map(b=>b.id))+1 : 1;
  return { id:newId, style:arStyle, info, notes, min, sec, done:false, cues:{} };
}

function insertAddRowBeat() {
  const newBeat = buildAddRowBeat();
  if (_insertIdx !== null && _insertIdx >= 0 && _insertIdx <= beats.length) {
    beats.splice(_insertIdx, 0, newBeat);
  } else {
    beats.push(newBeat);
  }
  _insertIdx = null;
  return newBeat;
}

function arCreateRowAndOpenCueBuilder() {
  if (!arStyle || !arCueType) return;
  const newBeat = insertAddRowBeat();
  hideOverlay('addRowOv');
  renderRundown();
  syncToFirestore();
  toast('Row added. Configure the cue.');
  setTimeout(() => openCueConfig(newBeat.id, arCueType), 80);
}

function arGoStep3() {
  arCreateRowAndOpenCueBuilder();
}

function arGoStep1() {
  document.getElementById('ar-step-2').classList.remove('on');
  document.getElementById('ar-step-3')?.classList.remove('on');
  document.getElementById('ar-step-1').classList.add('on');
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
  // Reset all state
  _vOnSrc='';_vOnAct='';_vOnShot='';_vOffTrans='';_vOffDest='';
  _aOnSrc='';_aOnCueType='';_aOffSrc='';_aOffCall='';
  _pOnAction='';_pOffHow='';_pOffRet='';
  _gOnType='';_gOnSrc='';_gOnTrans='';_gOffType='';_gOffHow='';
  _lOnAction='';_lOnFix='';_lOnSpecial='';_lOffFix='';_lOffHow='';_lOffSpecial='';
  _sOnType='Script';_sOnSrc='';_sOffSrc='';_sOffHow='';
  _sOnTags = [...(beats.find(x=>x.id===beatId)?.cues?.script?.scriptTags||[])];
  const b = beats.find(x=>x.id===beatId); if (!b) return;
  const existing = b.cues?.[type] || null;
  const tc = CT[type];
  document.getElementById('cueConfigTitle').textContent = `${tc.icon} ${tc.label}`;
  document.getElementById('cueConfigFields').innerHTML = buildCueConfigFields(type, existing);
  document.getElementById('cueConfigRemoveBtn').style.display = existing ? '' : 'none';
  showModal('cueConfigModal');
}

function ccChips(chips, fn) {
  return chips.map(c => {
    const val = (c.v !== undefined ? c.v : c).toString().replace(/'/g, "\\'");
    const lbl = c.label || c;
    return `<button type="button" class="cc-chip" onclick="${fn}('${val}')">${lbl}</button>`;
  }).join('');
}
function ccTabHint(icon, text) {
  return `<div class="cc-hint"><span class="cc-hint-icon">${icon}</span><span>${text}</span></div>`;
}
function ccCustomSrcField(id, val) {
  return `<input class="field-in cc-custom-in" id="${id}" value="${esc(val||'')}" placeholder="Type custom source name…" style="display:none;margin-top:8px" oninput="ccCustomSrcInput('${id}')">`;
}

// ── Cue config tab switcher ─────────────────────────
function ccTab(tab) {
  document.querySelectorAll('.cc-tab-btn').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.cc-panel').forEach(p => p.style.display = p.dataset.tab === tab ? '' : 'none');
}

// ── Chip helpers ────────────────────────────────────
function ccSelChip(groupId, val) {
  document.querySelectorAll(`#${groupId} .cc-chip`).forEach(c =>
    c.classList.toggle('sel', c.textContent.trim() === val || (c.getAttribute('data-val')||'') === val));
}
function ccShowCustom(fieldId, targetBuildFn) {
  document.getElementById(fieldId).style.display = '';
  document.getElementById(fieldId).focus();
  if (targetBuildFn) window[targetBuildFn]?.();
}
function ccCustomSrcInput(fieldId) {
  // triggers rebuild on whichever type is open
  const fns = { 'cc-v-custom':'_ccVOnBuild','cc-a-custom':'_ccAOnBuild','cc-s-custom':'_ccSOnBuild' };
  if (fns[fieldId]) window[fns[fieldId]]?.();
}

function buildCueConfigFields(type, d) {
  d = d || {};
  const onVal  = d.on  !== undefined ? d.on  : (d.take  || '');
  const offVal = d.off !== undefined ? d.off : (d.ready || '');
  const notes  = d.notes || '';
  let onPanel = '', offPanel = '';

  // Step header helper
  const step = (n, lbl) =>
    `<div class="cc-step-lbl"><span class="cc-step-num">${n}</span>${lbl}</div>`;

  // ══ VIDEO ══════════════════════════════════════════
  if (type === 'video') {
    onPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Source</div>
        <div class="cc-chip-grid" id="vOn-src">
          ${ccChips(getSources('video'), 'ccVOnSrc')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-v-custom','_ccVOnBuild')">+ Custom</button>
        </div>
        ${ccCustomSrcField('cc-v-custom', d.customSrc)}
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Action</div>
        <div class="cc-chip-grid" id="vOn-act">
          ${ccChips(['Ready','Standby','Set','Set with Media Wipe'], 'ccVOnAct')}
        </div>
      </div>
      <div class="cc-section" id="vOn-shot-row" style="display:none">
        <div class="cc-section-lbl">Shot type</div>
        <div class="cc-chip-grid" id="vOn-shot">
          ${ccChips(['Wide','Medium','CU','ECU','2-shot','OTS','POV','—'], 'ccVOnShot')}
        </div>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">▶ ON CUE</label>
        <input class="field-in cc-result-in" id="cc-on-text" value="${esc(onVal)}" placeholder="e.g. Set CAM 1 — Wide" maxlength="120" autocomplete="off">
      </div>`;

    offPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Destination</div>
        <div class="cc-chip-grid" id="vOff-dest">
          ${ccChips(['Black', ...getSources('video')], 'ccVOffDest')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-v-off-dest-custom','_ccVOffBuild')">+ Custom</button>
        </div>
        <input class="field-in cc-custom-in" id="cc-v-off-dest-custom" value="" placeholder="Type custom destination…" style="display:none;margin-top:8px" oninput="_ccVOffBuild()">
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Transition</div>
        <div class="cc-chip-grid" id="vOff-trans">
          ${ccChips(['Take','Dissolve','Media Wipe','Fade to Black'], 'ccVOffTrans')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-v-off-trans-custom','_ccVOffBuild')">+ Custom</button>
        </div>
        <input class="field-in cc-custom-in" id="cc-v-off-trans-custom" value="" placeholder="Type custom transition…" style="display:none;margin-top:8px" oninput="_ccVOffBuild()">
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">■ OFF CUE</label>
        <input class="field-in cc-result-in" id="cc-off-text" value="${esc(offVal)}" placeholder="e.g. Dissolve to Black" maxlength="120" autocomplete="off">
      </div>`;

  // ══ AUDIO ══════════════════════════════════════════
  } else if (type === 'audio') {
    onPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Source</div>
        <div class="cc-chip-grid" id="aOn-src">
          ${ccChips(getSources('audio'), 'ccAOnSrc')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-a-custom','_ccAOnBuild')">+ Custom</button>
        </div>
        ${ccCustomSrcField('cc-a-custom', d.customSrc)}
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Cue type</div>
        <div class="cc-chip-grid" id="aOn-cue">
          ${ccChips(['Open Mic','Track PLBK','Fade In','Play'], 'ccAOnCueType')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-a-cue-custom','_ccAOnBuild')">+ Custom</button>
        </div>
        <input class="field-in cc-custom-in" id="cc-a-cue-custom" value="" placeholder="Type custom cue type…" style="display:none;margin-top:8px" oninput="_ccAOnBuild()">
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">▶ ON CUE</label>
        <input class="field-in cc-result-in" id="cc-on-text" value="${esc(onVal)}" placeholder="e.g. Open Mic — Host" maxlength="120" autocomplete="off">
      </div>`;

    offPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Source</div>
        <div class="cc-chip-grid" id="aOff-src">
          ${ccChips([...getSources('audio'), 'All'], 'ccAOffSrc')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-a-off-custom','_ccAOffBuild')">+ Custom</button>
        </div>
        <input class="field-in cc-custom-in" id="cc-a-off-custom" value="" placeholder="Type custom source…" style="display:none;margin-top:8px" oninput="_ccAOffBuild()">
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Cue</div>
        <div class="cc-chip-grid" id="aOff-call">
          ${ccChips(['Close Mic','Mics Out','Fade Out','Track Out','Music Out','SFX Out','All Out','Silence'], 'ccAOffCall')}
        </div>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">■ OFF CUE</label>
        <input class="field-in cc-result-in" id="cc-off-text" value="${esc(offVal)}" placeholder="e.g. Close Mic — Host" maxlength="120" autocomplete="off">
      </div>`;

  // ══ PLAYBACK ════════════════════════════════════════
  } else if (type === 'playback') {
    onPanel = `
      ${step(1,'What is it?')}
      <div class="field">
        <label class="field-lbl">Clip name</label>
        <input class="field-in" id="cc-play-clip" value="${esc(d.clip||'')}" placeholder="e.g. SC_042 or HOFL_122_Open" maxlength="60" autocomplete="off" oninput="ccPOnBuild()">
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Action</div>
        <div class="cc-chip-grid" id="pOn-act">
          ${ccChips(['Ready','Roll'], 'ccPOnAct')}
        </div>
      </div>
      <div class="cc-section" id="pOn-dur-row" style="display:none">
        <div class="cc-section-lbl">Duration (TRT)</div>
        <div style="display:flex;gap:10px;align-items:flex-start">
          <div class="field" style="flex:1;text-align:center">
            <label class="field-lbl">Min</label>
            <input class="field-in" id="cc-play-min" type="number" min="0" max="99" value="${d.trtMin||''}" placeholder="0" style="text-align:center;font-family:var(--mono);font-size:20px" oninput="ccPOnBuild()">
          </div>
          <div style="padding-top:34px;color:var(--text3);font-size:22px;font-family:var(--mono)">:</div>
          <div class="field" style="flex:1;text-align:center">
            <label class="field-lbl">Sec</label>
            <input class="field-in" id="cc-play-sec" type="number" min="0" max="59" value="${d.trtSec||''}" placeholder="00" style="text-align:center;font-family:var(--mono);font-size:20px" oninput="ccPOnBuild()">
          </div>
        </div>
        <div class="field" style="margin-top:10px">
          <label class="field-lbl">SMPTE Timecode <span style="color:var(--text3);font-weight:400">— HH:MM:SS:FF</span></label>
          <input class="field-in" id="cc-play-smpte" value="${esc(d.smpte||'')}" placeholder="e.g. 00:02:15:00" maxlength="30" autocomplete="off" style="font-family:var(--mono)" oninput="ccPOnBuild()">
        </div>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">▶ ON CUE</label>
        <input class="field-in cc-result-in" id="cc-on-text" value="${esc(onVal)}" placeholder="e.g. Roll SC_042 — 0:45 TRT" maxlength="120" autocomplete="off">
      </div>`;

    offPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Return to</div>
        <div class="cc-chip-grid" id="pOff-ret">
          ${ccChips(['CAM 1','CAM 2','CAM 3','CAM 4','PLBK','Host','Anchor','Studio','Live'], 'ccPOffReturn')}
        </div>
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">How it ends</div>
        <div class="cc-chip-grid" id="pOff-how">
          ${ccChips(['Cut PLBK','Fade PLBK','Stop','Roll Next','Take Live'], 'ccPOffHow')}
        </div>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">■ OFF CUE</label>
        <input class="field-in cc-result-in" id="cc-off-text" value="${esc(offVal)}" placeholder="e.g. Cut PLBK — Take CAM 1" maxlength="120" autocomplete="off">
      </div>`;

  // ══ GFX ═════════════════════════════════════════════
  } else if (type === 'gfx') {
    onPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Graphic type</div>
        <div class="cc-chip-grid" id="gOn-type">
          ${ccChips(['Lower 3rd','Full Screen','Bug'], 'ccGOnType')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-g-custom','ccGOnBuild')">+ Custom</button>
        </div>
        <input class="field-in cc-custom-in" id="cc-g-custom" value="${esc(d.customType||'')}" placeholder="Type custom graphic type…" style="display:none;margin-top:8px" oninput="ccGOnBuild()">
      </div>
      <div class="cc-section">
        <div class="cc-section-lbl">Source</div>
        <div class="cc-chip-grid" id="gOn-src">
          ${ccChips(getSources('gfx'), 'ccGOnSrc')}
        </div>
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Transition</div>
        <div class="cc-chip-grid" id="gOn-trans">
          ${ccChips(['Cut','Auto On'], 'ccGOnTrans')}
        </div>
      </div>
      <div class="cc-section">
        <div class="cc-section-lbl">Motion type</div>
        <div class="cc-checks">
          <label class="cc-check"><input type="checkbox" id="cc-g-fixed" ${d.isFixed?'checked':''}> Fixed</label>
          <label class="cc-check"><input type="checkbox" id="cc-g-animated" ${d.isAnimated?'checked':''}> Animated</label>
        </div>
      </div>
      <div class="field">
        <label class="field-lbl">Content <span style="color:var(--text3);font-weight:400">— what it reads / shows</span></label>
        <input class="field-in" id="cc-gfx-content" value="${esc(d.gfxContent||'')}" placeholder="e.g. Host lower third, sponsor bug, intro card" maxlength="120" autocomplete="off" oninput="ccGOnBuild()">
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">▶ ON CUE</label>
        <input class="field-in cc-result-in" id="cc-on-text" value="${esc(onVal)}" placeholder="e.g. Auto On — Lower 3rd GFX" maxlength="120" autocomplete="off">
      </div>`;

    offPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Graphic type</div>
        <div class="cc-chip-grid" id="gOff-type">
          ${ccChips(['Lower 3rd','Full Screen','Bug','This GFX'], 'ccGOffType')}
        </div>
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Take it out</div>
        <div class="cc-chip-grid" id="gOff-how">
          ${ccChips(['Lost It','Auto Off','Clear All'], 'ccGOffHow')}
        </div>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">■ OFF CUE</label>
        <input class="field-in cc-result-in" id="cc-off-text" value="${esc(offVal)}" placeholder="e.g. Lost It — Lower 3rd" maxlength="120" autocomplete="off">
      </div>`;

  // ══ LIGHTING ════════════════════════════════════════
  } else if (type === 'lighting') {
    onPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Fixture / Area</div>
        <div class="cc-chip-grid" id="lOn-fix">
          ${ccChips(['Key','Fill','Back','All','House','Studio Wash'], 'ccLOnFix')}
          <button type="button" class="cc-chip ${d.lightingGoFeature?'sel':''}" onclick="ccLOnSpecial('GoFeature')">Go to Feature</button>
          <button type="button" class="cc-chip ${d.lightingGoCue?'sel':''}" onclick="ccLOnSpecial('GoCue')">Go to Cue</button>
        </div>
      </div>
      <div class="cc-section" id="lOn-gofeature-row" style="display:${d.lightingGoFeature?'':'none'}">
        <div class="cc-section-lbl">Feature name / details</div>
        <input class="field-in" id="cc-l-gofeature" value="${esc(d.lightingGoFeature||'')}" placeholder="e.g. Front wash warm, interview key" maxlength="80" oninput="_ccLOnBuild()">
      </div>
      <div class="cc-section" id="lOn-gocue-row" style="display:${d.lightingGoCue?'':'none'}">
        <div class="cc-section-lbl">Board cue number / label</div>
        <input class="field-in" id="cc-l-gocue" value="${esc(d.lightingGoCue||'')}" placeholder="e.g. Cue 14.5" maxlength="60" oninput="_ccLOnBuild()">
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Action</div>
        <div class="cc-chip-grid" id="lOn-act">
          ${ccChips(['Cue On','At','Color','Gobo'], 'ccLOnAct')}
        </div>
      </div>
      <div class="cc-section" id="lOn-intensity-row" style="display:none">
        <div class="cc-section-lbl">Intensity</div>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="field-in" id="cc-l-intensity" value="${esc(d.intensity||'')}" placeholder="e.g. 75%" maxlength="20" style="max-width:120px" oninput="_ccLOnBuild()">
          <div class="cc-chip-grid">${ccChips(['25%','50%','75%','100%','Full'], 'ccLOnIntensity')}</div>
        </div>
      </div>
      <div class="cc-section" id="lOn-color-row" style="display:none">
        <div class="cc-section-lbl">Color</div>
        <div class="cc-chip-grid" id="lOn-color">
          ${ccChips(['Warm White','Cool White','Red','Blue','Green','Amber','Magenta','UV'], 'ccLOnColor')}
        </div>
        <input class="field-in cc-custom-in" id="cc-l-color" value="${esc(d.color||'')}" placeholder="e.g. Lee 201 Full CT Blue" maxlength="60" style="margin-top:6px" oninput="_ccLOnBuild()">
      </div>
      <div class="cc-section" id="lOn-gobo-row" style="display:none">
        <div class="cc-section-lbl">Gobo</div>
        <input class="field-in" id="cc-l-gobo" value="${esc(d.gobo||'')}" placeholder="e.g. Gobo 3 — Breakup pattern" maxlength="60" oninput="_ccLOnBuild()">
      </div>
      <div class="field">
        <label class="field-lbl">Lighting notes <span style="color:var(--text3);font-weight:400">— cue numbers, focus, wash details</span></label>
        <textarea class="field-in" id="cc-l-notes-detail" rows="2" style="font-size:12px;line-height:1.5" placeholder="e.g. Cue 14.5 — Key light focus on anchor, remove fill">${esc(d.lightingDetail||'')}</textarea>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">▶ ON CUE</label>
        <input class="field-in cc-result-in" id="cc-on-text" value="${esc(onVal)}" placeholder="e.g. Key — Cue On" maxlength="120" autocomplete="off">
      </div>`;

    offPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Fixture / Area</div>
        <div class="cc-chip-grid" id="lOff-fix">
          ${ccChips(['Key','Fill','Back','All','House','Studio Wash'], 'ccLOffFix')}
          <button type="button" class="cc-chip ${d.lightingOffGoFeature?'sel':''}" onclick="ccLOffSpecial('GoFeature')">Go to Feature</button>
          <button type="button" class="cc-chip ${d.lightingOffGoCue?'sel':''}" onclick="ccLOffSpecial('GoCue')">Go to Cue</button>
        </div>
      </div>
      <div class="cc-section" id="lOff-gofeature-row" style="display:${d.lightingOffGoFeature?'':'none'}">
        <div class="cc-section-lbl">Feature name / details</div>
        <input class="field-in" id="cc-l-off-gofeature" value="${esc(d.lightingOffGoFeature||'')}" placeholder="e.g. House lights up full" maxlength="80" oninput="_ccLOffBuild()">
      </div>
      <div class="cc-section" id="lOff-gocue-row" style="display:${d.lightingOffGoCue?'':'none'}">
        <div class="cc-section-lbl">Board cue number / label</div>
        <input class="field-in" id="cc-l-off-gocue" value="${esc(d.lightingOffGoCue||'')}" placeholder="e.g. Cue 20" maxlength="60" oninput="_ccLOffBuild()">
      </div>
      ${step(2,'What will you do with it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Lighting out</div>
        <div class="cc-chip-grid" id="lOff-how">
          ${ccChips(['Black Out','Fade Out','Dim to 50%','Dim to 20%','House Up','Cross Fade','Hold'], 'ccLOffHow')}
        </div>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">■ OFF CUE</label>
        <input class="field-in cc-result-in" id="cc-off-text" value="${esc(offVal)}" placeholder="e.g. Key — Fade Out" maxlength="120" autocomplete="off">
      </div>`;

  // ══ SCRIPT ══════════════════════════════════════════
  } else if (type === 'script') {
    const isDialogue = d.scriptType === 'Dialogue';
    onPanel = `
      ${step(1,'What is it?')}
      <div class="cc-section">
        <div class="cc-section-lbl">Script type</div>
        <div class="cc-chip-grid" id="sOn-type">
          <button type="button" class="cc-chip ${isDialogue?'':'sel'}" onclick="ccSOnType('Script')">Script</button>
          <button type="button" class="cc-chip ${isDialogue?'sel':''}" onclick="ccSOnType('Dialogue')">Dialogue</button>
        </div>
      </div>
      <div class="cc-section">
        <div class="cc-section-lbl">Tags</div>
        <div class="cc-chip-grid" id="sOn-tags">
          ${(()=>{const tags=['Cold Open','Show Open','PKG Intro','Live Shot','VO','Toss','Guest Intro','Open Conversation','Tease','Throw to Break','Signoff'];const cur=d.scriptTags||[];return tags.map(t=>`<button type="button" class="cc-chip ${cur.includes(t)?'sel':''}" onclick="ccSOnTag('${t}')">${t}</button>`).join('');})()}
        </div>
      </div>
      <div class="cc-section">
        <div class="cc-section-lbl">Source / Speaker</div>
        <div class="cc-chip-grid" id="sOn-src">
          ${ccChips([...getSources('scriptWho'), 'Narrator','Anchor'], 'ccSOnSrc')}
          <button type="button" class="cc-chip cc-chip-add" onclick="ccShowCustom('cc-s-custom','_ccSOnBuild')">+ Custom</button>
        </div>
        ${ccCustomSrcField('cc-s-custom', d.customSrc)}
      </div>
      ${step(2,'What will you do with it?')}
      <div id="sOn-script-panel" style="${isDialogue?'display:none':''}">
        <div class="field">
          <label class="field-lbl">Script copy <span style="color:var(--text3);font-weight:400">— feeds prompter</span></label>
          <textarea class="field-in" id="cc-s-text" rows="5" style="resize:vertical;line-height:1.7;font-size:14px" placeholder="Write the copy here, word for word.">${esc(d.text||'')}</textarea>
        </div>
        <div class="field">
          <label class="field-lbl">Upload script <span style="color:var(--text3);font-weight:400">(.txt or .pdf)</span></label>
          <input type="file" id="cc-s-file" accept=".txt,.md,.pdf" style="color:var(--text2);font-size:12px" onchange="loadScriptFile(this,'cc-s-text')">
        </div>
      </div>
      <div id="sOn-dialogue-panel" style="${isDialogue?'':'display:none'}">
        <div class="field">
          <label class="field-lbl">Dialogue note <span style="color:var(--text3);font-weight:400">— brief description only</span></label>
          <input class="field-in" id="cc-s-dialogue" value="${esc(d.dialogueNote||'')}" placeholder="e.g. Host and guest discuss the segment topic — unscripted" maxlength="160" autocomplete="off">
        </div>
      </div>
      <div class="cc-divider"></div>
      <div class="field">
        <label class="field-lbl cc-result-lbl">▶ SCRIPT CUE</label>
        <input class="field-in cc-result-in" id="cc-on-text" value="${esc(onVal)}" placeholder="e.g. Host — Begin" maxlength="120" autocomplete="off">
      </div>`;

    offPanel = '';
  }

  // Script: single tab; all others: On/Off tabs
  const isScript = type === 'script';
  const tabHtml = isScript ? '' : `
    <div class="cc-tabs">
      <button class="cc-tab-btn active" data-tab="on" onclick="ccTab('on')">▶&nbsp; On Cue</button>
      <button class="cc-tab-btn" data-tab="off" onclick="ccTab('off')">■&nbsp; Off Cue</button>
    </div>`;
  return `
    ${tabHtml}
    <div class="cc-panel" data-tab="on">${onPanel}</div>
    ${isScript ? '' : `<div class="cc-panel" data-tab="off" style="display:none">${offPanel}</div>`}
    <div class="cc-divider"></div>
    <div class="field">
      <label class="field-lbl">Notes <span style="color:var(--text3);font-weight:400">— for your crew</span></label>
      <textarea class="field-in" id="cc-notes" rows="2" placeholder="Add context, reminders, or crew instructions…" style="font-size:13px;line-height:1.6">${esc(notes)}</textarea>
    </div>`;
}

// ══ VIDEO On helpers ════════════════════════════════
let _vOnSrc='',_vOnAct='',_vOnShot='';
function ccVOnSrc(src) {
  _vOnSrc=src; _vOnAct=''; _vOnShot='';
  ccSelChip('vOn-src',src);
  document.querySelectorAll('#vOn-act .cc-chip,#vOn-shot .cc-chip').forEach(c=>c.classList.remove('sel'));
  document.getElementById('vOn-shot-row').style.display = 'none';
  _ccVOnBuild();
}
function ccVOnAct(act) {
  _vOnAct=act; ccSelChip('vOn-act',act);
  const isLive = /^(CAM|CPU|ME)/.test(_vOnSrc);
  document.getElementById('vOn-shot-row').style.display = isLive ? '' : 'none';
  _ccVOnBuild();
}
function ccVOnShot(shot) {
  _vOnShot=shot==='—'?'':shot; ccSelChip('vOn-shot',shot); _ccVOnBuild();
}
function _ccVOnBuild() {
  if (!_vOnSrc) return;
  const src  = document.getElementById('cc-v-custom')?.style.display!=='none'
    ? (document.getElementById('cc-v-custom')?.value||_vOnSrc) : _vOnSrc;
  const act  = _vOnAct || 'Set';
  const shot = _vOnShot ? ` — ${_vOnShot}` : '';
  const el   = document.getElementById('cc-on-text');
  if (el) el.value = `${act} ${src}${shot}`;
}

// ══ VIDEO Off helpers ═══════════════════════════════
let _vOffTrans='',_vOffDest='';
function ccVOffTrans(t){ _vOffTrans=t; ccSelChip('vOff-trans',t); _ccVOffBuild(); }
function ccVOffDest(d) { _vOffDest=d;  ccSelChip('vOff-dest',d);  _ccVOffBuild(); }
function _ccVOffBuild() {
  const el=document.getElementById('cc-off-text'); if(!el) return;
  const destCustomEl = document.getElementById('cc-v-off-dest-custom');
  const transCustomEl = document.getElementById('cc-v-off-trans-custom');
  const d = (destCustomEl?.style.display!=='none' && destCustomEl?.value) ? destCustomEl.value : (_vOffDest||'Black');
  const t = (transCustomEl?.style.display!=='none' && transCustomEl?.value) ? transCustomEl.value : (_vOffTrans||'Take');
  el.value = d==='Black' ? `${t} to Black` : `${t} to ${d}`;
}

// ══ AUDIO On helpers ════════════════════════════════
let _aOnSrc='',_aOnCueType='';
function ccAOnSrc(src) {
  _aOnSrc=src; ccSelChip('aOn-src',src);
  _ccAOnBuild();
}
function ccAOnCueType(t) { _aOnCueType=t; ccSelChip('aOn-cue',t); _ccAOnBuild(); }
function _ccAOnBuild() {
  const src = document.getElementById('cc-a-custom')?.style.display!=='none'
    ? (document.getElementById('cc-a-custom')?.value||_aOnSrc) : _aOnSrc;
  const cueCustomEl = document.getElementById('cc-a-cue-custom');
  const cue = (cueCustomEl?.style.display!=='none' && cueCustomEl?.value) ? cueCustomEl.value : _aOnCueType;
  const el  = document.getElementById('cc-on-text'); if(!el) return;
  const parts=[cue,src].filter(Boolean);
  el.value = parts.join(' — ');
}

// ══ AUDIO Off helpers ═══════════════════════════════
let _aOffSrc='',_aOffCall='';
function ccAOffSrc(src) {
  _aOffSrc=src; ccSelChip('aOff-src',src);
  _ccAOffBuild();
}
function ccAOffCall(val) { _aOffCall=val; ccSelChip('aOff-call',val); _ccAOffBuild(); }
function _ccAOffBuild() {
  const src = document.getElementById('cc-a-off-custom')?.style.display!=='none'
    ? (document.getElementById('cc-a-off-custom')?.value||_aOffSrc) : _aOffSrc;
  const el=document.getElementById('cc-off-text'); if(!el) return;
  const parts=[_aOffCall,src].filter(Boolean);
  el.value = parts.join(' — ');
}

// ══ PLAYBACK On helpers ═════════════════════════════
let _pOnAction='';
function ccPOnAct(act){
  _pOnAction=act; ccSelChip('pOn-act',act);
  document.getElementById('pOn-dur-row').style.display = act==='Roll' ? '' : 'none';
  ccPOnBuild();
}
function ccPOnBuild(){
  const clip=document.getElementById('cc-play-clip')?.value?.trim()||'';
  const min=parseInt(document.getElementById('cc-play-min')?.value)||0;
  const sec=parseInt(document.getElementById('cc-play-sec')?.value)||0;
  const smpte=document.getElementById('cc-play-smpte')?.value?.trim()||'';
  const trt=(min||sec)?` — ${min}:${sec.toString().padStart(2,'0')} TRT`:'';
  const smpteStr=smpte?` [${smpte}]`:'';
  const act=_pOnAction||'Roll';
  const el=document.getElementById('cc-on-text'); if(!el) return;
  el.value=clip?`${act} ${clip}${trt}${smpteStr}`:act;
}

// ══ PLAYBACK Off helpers ════════════════════════════
let _pOffHow='',_pOffRet='';
function ccPOffHow(v)    { _pOffHow=v; ccSelChip('pOff-how',v);  _ccPOffBuild(); }
function ccPOffReturn(v) { _pOffRet=v; ccSelChip('pOff-ret',v); _ccPOffBuild(); }
function _ccPOffBuild(){
  const el=document.getElementById('cc-off-text'); if(!el) return;
  const parts=[_pOffHow,_pOffRet?`Take ${_pOffRet}`:''].filter(Boolean);
  el.value=parts.join(' — ')||_pOffHow;
}

// ══ GFX On helpers ══════════════════════════════════
let _gOnType='',_gOnSrc='',_gOnTrans='';
function ccGOnType(t){ _gOnType=t; ccSelChip('gOn-type',t); ccGOnBuild(); }
function ccGOnSrc(s) { _gOnSrc=s;  ccSelChip('gOn-src',s);  ccGOnBuild(); }
function ccGOnTrans(t){ _gOnTrans=t; ccSelChip('gOn-trans',t); ccGOnBuild(); }
function ccGOnBuild(){
  const type = document.getElementById('cc-g-custom')?.style.display!=='none'
    ? (document.getElementById('cc-g-custom')?.value?.trim()||_gOnType) : _gOnType;
  const content=document.getElementById('cc-gfx-content')?.value?.trim()||'';
  const trans=_gOnTrans||'Cut';
  const el=document.getElementById('cc-on-text'); if(!el) return;
  const parts=[trans,type||(content?'GFX':''),content?`(${content})`:''].filter(Boolean);
  el.value=parts.join(' — ');
}

// ══ GFX Off helpers ═════════════════════════════════
let _gOffType='',_gOffHow='';
function ccGOffType(t){
  _gOffType=t; ccSelChip('gOff-type',t);
  _ccGOffBuild();
}
function ccGOffHow(val){ _gOffHow=val; ccSelChip('gOff-how',val); _ccGOffBuild(); }
function _ccGOffBuild(){
  const el=document.getElementById('cc-off-text'); if(!el) return;
  const label=(_gOffType&&_gOffType!=='This GFX')?_gOffType:'';
  const parts=[_gOffHow,label].filter(Boolean);
  el.value=parts.join(' — ')||_gOffHow;
}

// ══ LIGHTING On helpers ═════════════════════════════
let _lOnAction='',_lOnFix='',_lOnSpecial=''; // special: 'GoFeature'|'GoCue'|''
function ccLOnFix(v){
  _lOnFix=v; _lOnSpecial='';
  // deselect Go to Feature / Go to Cue visually
  document.querySelectorAll('#lOn-fix .cc-chip').forEach(c=>{if(c.textContent==='Go to Feature'||c.textContent==='Go to Cue')c.classList.remove('sel');});
  ccSelChip('lOn-fix',v);
  document.getElementById('lOn-gofeature-row').style.display='none';
  document.getElementById('lOn-gocue-row').style.display='none';
  _ccLOnBuild();
}
function ccLOnSpecial(which){
  _lOnSpecial=which; _lOnFix='';
  document.querySelectorAll('#lOn-fix .cc-chip').forEach(c=>c.classList.remove('sel'));
  // highlight the clicked special button
  const label = which==='GoFeature'?'Go to Feature':'Go to Cue';
  document.querySelectorAll('#lOn-fix .cc-chip').forEach(c=>{if(c.textContent===label)c.classList.add('sel');});
  document.getElementById('lOn-gofeature-row').style.display = which==='GoFeature' ? '' : 'none';
  document.getElementById('lOn-gocue-row').style.display     = which==='GoCue'     ? '' : 'none';
  _ccLOnBuild();
}
function ccLOnAct(v){
  _lOnAction=v; ccSelChip('lOn-act',v);
  document.getElementById('lOn-intensity-row').style.display = v==='At'    ? '' : 'none';
  document.getElementById('lOn-color-row').style.display     = v==='Color' ? '' : 'none';
  document.getElementById('lOn-gobo-row').style.display      = v==='Gobo'  ? '' : 'none';
  _ccLOnBuild();
}
function ccLOnIntensity(v){
  const el=document.getElementById('cc-l-intensity'); if(el) el.value=v; _ccLOnBuild();
}
function ccLOnColor(v){
  const el=document.getElementById('cc-l-color'); if(el) el.value=v; _ccLOnBuild();
}
function _ccLOnBuild(){
  const el=document.getElementById('cc-on-text'); if(!el) return;
  // Determine fixture string
  let fix=_lOnFix;
  if(_lOnSpecial==='GoFeature'){
    const val=document.getElementById('cc-l-gofeature')?.value?.trim()||'';
    fix=val?`Go to Feature: ${val}`:'Go to Feature';
    el.value=fix; return;
  }
  if(_lOnSpecial==='GoCue'){
    const val=document.getElementById('cc-l-gocue')?.value?.trim()||'';
    fix=val?`Go to Cue ${val}`:'Go to Cue';
    el.value=fix; return;
  }
  const act=_lOnAction||'Cue On';
  let detail='';
  if(_lOnAction==='At'){
    const int=document.getElementById('cc-l-intensity')?.value||'';
    detail=int?`At ${int}`:'At';
  } else if(_lOnAction==='Color'){
    const col=document.getElementById('cc-l-color')?.value||'';
    detail=col?`Color: ${col}`:'Color';
  } else if(_lOnAction==='Gobo'){
    const gob=document.getElementById('cc-l-gobo')?.value||'';
    detail=gob?`Gobo: ${gob}`:'Gobo';
  }
  const parts=[fix,detail||act].filter(Boolean);
  el.value=parts.join(' — ');
}

// ══ LIGHTING Off helpers ════════════════════════════
let _lOffFix='',_lOffHow='',_lOffSpecial='';
function ccLOffFix(v){
  _lOffFix=v; _lOffSpecial='';
  document.querySelectorAll('#lOff-fix .cc-chip').forEach(c=>{if(c.textContent==='Go to Feature'||c.textContent==='Go to Cue')c.classList.remove('sel');});
  ccSelChip('lOff-fix',v);
  document.getElementById('lOff-gofeature-row').style.display='none';
  document.getElementById('lOff-gocue-row').style.display='none';
  _ccLOffBuild();
}
function ccLOffSpecial(which){
  _lOffSpecial=which; _lOffFix='';
  document.querySelectorAll('#lOff-fix .cc-chip').forEach(c=>c.classList.remove('sel'));
  const label=which==='GoFeature'?'Go to Feature':'Go to Cue';
  document.querySelectorAll('#lOff-fix .cc-chip').forEach(c=>{if(c.textContent===label)c.classList.add('sel');});
  document.getElementById('lOff-gofeature-row').style.display = which==='GoFeature' ? '' : 'none';
  document.getElementById('lOff-gocue-row').style.display     = which==='GoCue'     ? '' : 'none';
  _ccLOffBuild();
}
function ccLOffHow(val){ _lOffHow=val; ccSelChip('lOff-how',val); _ccLOffBuild(); }
function _ccLOffBuild(){
  const el=document.getElementById('cc-off-text'); if(!el) return;
  if(_lOffSpecial==='GoFeature'){
    const val=document.getElementById('cc-l-off-gofeature')?.value?.trim()||'';
    el.value=val?`Go to Feature: ${val}`:'Go to Feature'; return;
  }
  if(_lOffSpecial==='GoCue'){
    const val=document.getElementById('cc-l-off-gocue')?.value?.trim()||'';
    el.value=val?`Go to Cue ${val}`:'Go to Cue'; return;
  }
  const parts=[_lOffFix,_lOffHow].filter(Boolean);
  el.value=parts.join(' — ')||_lOffHow;
}

// ══ SCRIPT tag helpers ══════════════════════════════
let _sOnTags = [];
function ccSOnTag(tag) {
  const idx = _sOnTags.indexOf(tag);
  if (idx>=0) _sOnTags.splice(idx,1); else _sOnTags.push(tag);
  document.querySelectorAll('#sOn-tags .cc-chip').forEach(c=>{
    c.classList.toggle('sel', _sOnTags.includes(c.textContent));
  });
  _ccSOnBuild();
}

// ══ SCRIPT On helpers ═══════════════════════════════
let _sOnType='Script',_sOnSrc='';
function ccSOnType(t){
  _sOnType=t;
  document.querySelectorAll('#sOn-type .cc-chip').forEach(c=>c.classList.toggle('sel',c.textContent===t));
  document.getElementById('sOn-script-panel').style.display   = t==='Dialogue'?'none':'';
  document.getElementById('sOn-dialogue-panel').style.display = t==='Dialogue'?'':'none';
  _ccSOnBuild();
}
function ccSOnSrc(v){ _sOnSrc=v; ccSelChip('sOn-src',v); _ccSOnBuild(); }
function _ccSOnBuild(){
  const src=document.getElementById('cc-s-custom')?.style.display!=='none'
    ? (document.getElementById('cc-s-custom')?.value||_sOnSrc) : _sOnSrc;
  const el=document.getElementById('cc-on-text'); if(!el) return;
  el.value=src?`${src} — Begin`:'Begin';
}

// ══ SCRIPT Off helpers ══════════════════════════════
let _sOffSrc='',_sOffHow='';
function ccSOffSrc(v){
  _sOffSrc=v; ccSelChip('sOff-src',v);
  _ccSOffBuild();
}
function ccSOffHow(v){ _sOffHow=v; ccSelChip('sOff-how',v); _ccSOffBuild(); }
function _ccSOffBuild(){
  const src=document.getElementById('cc-s-off-custom')?.style.display!=='none'
    ? (document.getElementById('cc-s-off-custom')?.value||_sOffSrc) : _sOffSrc;
  const el=document.getElementById('cc-off-text'); if(!el) return;
  const parts=[src,_sOffHow].filter(Boolean);
  el.value=parts.join(' — ')||_sOffHow;
}

function saveCueConfig() {
  const b = beats.find(x=>x.id===cueConfigBeatId); if (!b) return;
  if (!b.cues) b.cues = {};
  const d = {
    on:    (document.getElementById('cc-on-text')?.value ||'').trim(),
    off:   (document.getElementById('cc-off-text')?.value||'').trim(),
    notes: (document.getElementById('cc-notes')?.value   ||'').trim(),
  };
  // Type-specific extras
  switch(cueConfigType) {
    case 'video':
      d.customSrc = document.getElementById('cc-v-custom')?.value?.trim()||'';
      break;
    case 'audio':
      d.customSrc  = document.getElementById('cc-a-custom')?.value?.trim()||'';
      break;
    case 'playback':
      d.clip    = document.getElementById('cc-play-clip')?.value?.trim()||'';
      d.trtMin  = document.getElementById('cc-play-min')?.value||'';
      d.trtSec  = document.getElementById('cc-play-sec')?.value||'';
      d.smpte   = document.getElementById('cc-play-smpte')?.value?.trim()||'';
      break;
    case 'gfx':
      d.customType  = document.getElementById('cc-g-custom')?.value?.trim()||'';
      d.gfxContent  = document.getElementById('cc-gfx-content')?.value?.trim()||'';
      d.isFixed     = document.getElementById('cc-g-fixed')?.checked||false;
      d.isAnimated  = document.getElementById('cc-g-animated')?.checked||false;
      break;
    case 'lighting':
      d.lightingDetail      = document.getElementById('cc-l-notes-detail')?.value?.trim()||'';
      d.intensity           = document.getElementById('cc-l-intensity')?.value?.trim()||'';
      d.color               = document.getElementById('cc-l-color')?.value?.trim()||'';
      d.gobo                = document.getElementById('cc-l-gobo')?.value?.trim()||'';
      d.lightingGoFeature   = document.getElementById('cc-l-gofeature')?.value?.trim()||'';
      d.lightingGoCue       = document.getElementById('cc-l-gocue')?.value?.trim()||'';
      d.lightingOffGoFeature= document.getElementById('cc-l-off-gofeature')?.value?.trim()||'';
      d.lightingOffGoCue    = document.getElementById('cc-l-off-gocue')?.value?.trim()||'';
      break;
    case 'script':
      d.scriptType  = _sOnType;
      d.customSrc   = document.getElementById('cc-s-custom')?.value?.trim()||'';
      d.text        = document.getElementById('cc-s-text')?.value||'';
      d.dialogueNote= document.getElementById('cc-s-dialogue')?.value?.trim()||'';
      d.scriptTags  = [..._sOnTags];
      break;
  }
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
  const newBeat = insertAddRowBeat();
  if (arCueType) {
    const d = {
      ready: document.getElementById('ar-cue-ready')?.value?.trim()||'',
      take:  document.getElementById('ar-cue-take')?.value?.trim()||'',
    };
    if (arCueType === 'script') d.text = document.getElementById('ar-cue-text')?.value?.trim()||'';
    newBeat.cues[arCueType] = d;
  }
  hideOverlay('addRowOv');
  renderRundown(); syncToFirestore();
  toast('Row added.');
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
  document.getElementById('liveshow').classList.toggle('prompt-op-active', promptOpMode);
  document.getElementById('tabLive').classList.add('on');
  document.getElementById('tabBuild').classList.remove('on');
  sessionStorage.setItem('cueola_screen','live');
  pushSessionHistoryState('live');
  buildPromptFromRundown();
  initPrompter();
  renderLive();
  syncLiveIdx();
  startTimer();
}

function showRundown() {
  document.getElementById('liveshow').classList.remove('on');
  document.getElementById('liveshow').classList.remove('prompt-op-active');
  document.getElementById('rundown').classList.add('on');
  document.getElementById('tabBuild').classList.add('on');
  document.getElementById('tabLive').classList.remove('on');
  sessionStorage.setItem('cueola_screen','build');
  pushSessionHistoryState('build');
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
  showOverlay('exitLiveOv');
}

function confirmExitLive() {
  hideOverlay('exitLiveOv');
  followSelf();
  showRundown();
}

function offsetBeforeIndex(idx) {
  return beats.slice(0, Math.max(0, idx)).reduce((acc,b)=>acc+(b.min||0)*60+(b.sec||0),0);
}

function liveRemainingSecs() {
  return Math.max(totalSecs() - elapsedSecs, 0);
}

function liveRemainingMs() {
  const elapsedMs = liveTimerStartMs ? Date.now() - liveTimerStartMs : elapsedSecs * 1000;
  return Math.max(totalSecs() * 1000 - elapsedMs, 0);
}

function getPrompterPayload(isInit=false) {
  const cur = beats[lsIdx] || null;
  const next = beats[lsIdx+1] || null;
  return {
    type: isInit ? 'script_init' : 'script_update',
    text: prompterText,
    sessionCode: session.code,
    showName: show.name || 'Untitled Show',
    activeIdx: lsIdx,
    currentRow: cur ? { index:lsIdx, name:cur.info||'', notes:cur.notes||'', duration:fmtDur(cur) } : null,
    nextRow: next ? { index:lsIdx+1, name:next.info||'', duration:fmtDur(next) } : null,
    ts: Date.now()
  };
}

function cleanPrompterText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function updateLiveOverview() {
  const cur = beats[lsIdx] || null;
  const next = beats[lsIdx+1] || null;
  const total = totalSecs();
  const remain = liveRemainingSecs();
  const progress = total ? Math.min(100, Math.max(0, elapsedSecs / total * 100)) : (beats.length ? (lsIdx+1)/beats.length*100 : 0);
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('ls-show-title', show.name || 'Untitled Show');
  setText('ls-show-sub', `${beats.length ? `Row ${Math.min(lsIdx+1, beats.length)} of ${beats.length}` : 'No rows'}${session.code&&!session.isExpert ? ` · ${session.code}` : ''}`);
  setText('ls-stat-now', cur ? cur.info || `Row ${lsIdx+1}` : '—');
  setText('ls-stat-next', next ? next.info || `Row ${lsIdx+2}` : 'End');
  setText('ls-stat-remain', remain ? fmtProductionClock(liveRemainingMs()) : '—');
  const fill = document.getElementById('ls-progress-fill');
  if (fill) fill.style.width = `${progress}%`;
}

function applyLivePrompterPanelState() {
  const sidebar = document.getElementById('lsSidebar');
  const resizer = document.getElementById('lsResizer');
  const btn = document.getElementById('prompterPanelBtn');
  if (sidebar) {
    sidebar.classList.toggle('open', livePrompterOpen);
    sidebar.style.width = `${liveSidebarWidth}px`;
  }
  if (resizer) resizer.classList.toggle('on', livePrompterOpen);
  if (btn) {
    btn.textContent = livePrompterOpen ? '📄 Hide Script' : '📄 Script Panel';
    btn.style.color = livePrompterOpen ? 'var(--cyan)' : '';
    btn.style.borderColor = livePrompterOpen ? 'rgba(34,211,211,.35)' : '';
  }
}

function toggleLivePrompterPanel() {
  livePrompterOpen = !livePrompterOpen;
  applyLivePrompterPanelState();
}

function startLivePanelResize(e) {
  e.preventDefault();
  const startX = e.clientX;
  const startW = liveSidebarWidth;
  const move = ev => {
    liveSidebarWidth = Math.min(620, Math.max(260, startW + (startX - ev.clientX)));
    applyLivePrompterPanelState();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, {once:true});
}

function renderLiveCurrent(b, i) {
  const types = Object.keys(b.cues||{}).filter(t=>CT[t]&&t!=='script');
  const sd = b.cues?.script;
  const adminCaller = isAdminShowCaller();
  const rowStart = show.start ? clock(show.start, offsetBeforeIndex(i)) : '—';
  const elapsedRows = `${i+1} / ${beats.length}`;
  const cueBlocks = types.map(t => {
    const d = b.cues[t], tc = CT[t];
    const on  = getCueOn(d);
    const off = getCueOff(d);
    return `<div class="lv-cue-block" style="border-left-color:${tc.color}">
      <div class="lv-cue-label" style="color:${tc.color}">${tc.icon} ${tc.label}</div>
      ${on  ? `<div class="lv-cue-ready">▶ ${esc(on)}</div>`  : ''}
      ${off ? `<div class="lv-cue-take">■ ${esc(off)}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="lv-cur-card">
    <div class="lv-cur-badge">● NOW — Row ${i+1}</div>
    <div class="lv-cur-name">${esc(b.info||'—')}</div>
    ${b.notes?`<div class="lv-cur-note">${esc(b.notes)}</div>`:''}
    ${fmtDur(b)!=='—'?`<div class="lv-cur-dur">${fmtDur(b)}</div>`:''}
    <div class="lv-cur-meta">
      <div class="lv-cur-mi"><div class="lv-cur-ml">Scheduled</div><div class="lv-cur-mv">${rowStart}</div></div>
      <div class="lv-cur-mi"><div class="lv-cur-ml">Position</div><div class="lv-cur-mv">${elapsedRows}</div></div>
      <div class="lv-cur-mi"><div class="lv-cur-ml">Show Left</div><div class="lv-cur-mv">${liveRemainingSecs()?fmtProductionSecs(liveRemainingSecs()):'—'}</div></div>
    </div>
    ${cueBlocks?`<div class="lv-cue-blocks">${cueBlocks}</div>`:''}
    ${sd?.text?`<div class="lv-cur-script">${esc(sd.text)}</div>`:''}
    ${sd&&adminCaller?`<button class="ltr-edit-btn" style="margin-top:8px" onclick="openLiveScript(${i})">✎ Edit &amp; Push</button>`:''}
  </div>`;
}

function renderLiveNext(b, i, isRunner) {
  const types = Object.keys(b.cues||{}).filter(t=>CT[t]&&t!=='script');
  const cueSmall = types.map(t => {
    const d = b.cues[t], tc = CT[t];
    const on  = getCueOn(d);
    const off = getCueOff(d);
    return `<span class="lv-next-cue" style="border-left-color:${tc.color}">
      <span style="color:${tc.color}">${tc.icon}</span>
      ${on  ? `<span>▶ ${esc(on)}</span>`  : ''}
      ${off ? `<span style="opacity:.7">■ ${esc(off)}</span>` : ''}
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
  previewRowIdx = idx;
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
    const on  = getCueOn(d);
    const off = getCueOff(d);
    html += `<div style="border-left:3px solid ${tc.color};padding:8px 12px;margin-bottom:8px;border-radius:0 8px 8px 0;background:var(--s2)">
      <div style="font-size:10px;font-family:var(--mono);color:${tc.color};letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">${tc.icon} ${tc.label}</div>
      ${on  ? `<div style="font-size:14px;font-weight:600;margin-bottom:2px">▶ ${esc(on)}</div>`  : ''}
      ${off ? `<div style="font-size:13px;color:var(--text2)">■ ${esc(off)}</div>` : ''}
      ${t==='script'&&d.text?`<div style="font-size:13px;line-height:1.7;color:var(--text);margin-top:8px;white-space:pre-wrap;border-top:1px solid var(--border);padding-top:8px">${esc(d.text)}</div>`:''}
    </div>`;
  });
  if (!types.length) html = '<div style="color:var(--text3);text-align:center;padding:20px">No cues configured.</div>';
  bodyEl.innerHTML = html;
  const prevBtn = document.getElementById('lrpPrevBtn');
  const nextBtn = document.getElementById('lrpNextBtn');
  if (prevBtn) prevBtn.disabled = idx <= 0;
  if (nextBtn) nextBtn.disabled = idx >= beats.length - 1;
  showOverlay('lsRowPreviewOv');
}

function previewRelativeRow(delta) {
  const next = previewRowIdx + delta;
  if (next < 0 || next >= beats.length) return;
  liveRowPreview(next);
}

function liveCellForBeat(b, type, beatIdx) {
  const tc = CT[type];
  const d = b.cues?.[type];
  if (!d && type === 'script') {
    return `<div class="live-cue-empty live-script-open" onclick="event.stopPropagation();openLiveScript(${beatIdx})">Open script</div>`;
  }
  if (!d) return `<div class="live-cue-empty">—</div>`;
  const on = getCueOn(d);
  const off = getCueOff(d);
  const isScript = type === 'script';
  const script = '';
  const scriptMeta = isScript && d.text ? `<div class="live-script-action">Script · ${scriptLineCount(d.text)} lines</div>` : '';
  if (!on && !off && !script && !scriptMeta) return `<div class="live-cue-empty">—</div>`;
  return `<div class="live-cue-cell${isScript?' live-script-cell':''}" style="border-left-color:${tc.color}" ${isScript?`onclick="event.stopPropagation();openLiveScript(${beatIdx})" title="Open full script"`:''}>
    <div class="live-cue-label" style="color:${tc.color}">${tc.icon} ${tc.label}</div>
    ${on ? `<div class="live-cue-on">▶ ${esc(on)}</div>` : ''}
    ${off ? `<div class="live-cue-off">■ ${esc(off)}</div>` : ''}
    ${script}
    ${isScript ? (scriptMeta || '<div class="live-script-action">View / edit / push</div>') : ''}
  </div>`;
}

function renderLive() {
  if (promptOpMode) { renderLivePromptOp(); return; }
  const body = document.getElementById('lsBody');
  if (!beats.length) { body.innerHTML='<div style="text-align:center;padding:40px;color:var(--text3)">No cues in rundown.</div>'; return; }

  // canJump = can click arbitrary rows to jump position (admin show callers only)
  const runner  = isFollowingSelf();
  const canJump = runner && isAdminShowCaller();
  let offsetSecs = 0;
  let html = `<div class="live-grid-wrap"><table class="live-grid">
    <thead><tr>
      <th class="live-col-num">#</th>
      <th class="live-col-status">State</th>
      <th class="live-col-name">Row</th>
      <th class="live-col-time">Time</th>
      ${colOrder.map(type=>`<th class="${type==='script'?'live-col-script':'live-col-cue'}" style="color:${CT[type].color}">${COL_META[type].label}</th>`).join('')}
    </tr></thead><tbody>`;

  beats.forEach((b, i) => {
    const isCur  = i === lsIdx;
    const isNext = i === lsIdx + 1;
    const isDone = i < lsIdx;
    const handler = canJump ? `jumpToLsCue(${i})` : `liveRowPreview(${i})`;
    const startStr = show.start ? clock(show.start, offsetSecs) : '—';
    const durSecs = (b.min||0)*60+(b.sec||0);
    offsetSecs += durSecs;
    const statusClass = isCur ? 'now' : isNext ? 'next' : isDone ? 'done' : 'later';
    const statusText = isCur ? 'Now' : isNext ? 'Next' : isDone ? 'Done' : 'Later';
    const rowClass = isCur ? 'live-row-current' : isNext ? 'live-row-next' : isDone ? 'live-row-done' : '';
    html += `<tr class="${rowClass}" onclick="${handler}">
      <td><div class="live-num">${i+1}</div></td>
      <td><span class="live-status ${statusClass}">${statusText}</span></td>
      <td>
        <div class="live-name">${esc(b.info||'—')}</div>
        ${b.notes?`<div class="live-note">${esc(b.notes)}</div>`:''}
      </td>
      <td><div class="live-time"><strong>${fmtDur(b)}</strong>${startStr}</div></td>
      ${colOrder.map(type=>`<td>${liveCellForBeat(b,type,i)}</td>`).join('')}
    </tr>`;
  });
  html += `</tbody></table></div>`;

  body.innerHTML = html;
  const cur = body.querySelector('.live-row-current');
  if (cur) cur.scrollIntoView({behavior:'smooth', block:'center'});
  applyLivePrompterPanelState();
  renderFollowChips();
  updateLiveOverview();
  updateLsPrompter();
  renderLivePrompterControls();
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
  document.getElementById('lsScriptEditTitle').textContent = `Script • ${b.info||`Row ${beatIdx+1}`}`;
  document.getElementById('lsScriptEditText').value = d.text||'';
  showOverlay('lsScriptEditOv');
  setTimeout(()=>document.getElementById('lsScriptEditText')?.focus(),80);
}

function insertScriptMarker(text) {
  const ta = document.getElementById('lsScriptEditText');
  if (!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  ta.value = before + text + after;
  const pos = start + text.length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
}

function saveLiveScript() {
  const b = beats[liveScriptEditIdx]; if (!b) return;
  if (!b.cues) b.cues={};
  if (!b.cues.script) b.cues.script={ready:'',take:''};
  b.cues.script.text = document.getElementById('lsScriptEditText').value;
  const d = b.cues.script;
  const speaker = getCueOff(d);
  prompterText = (speaker?`${speaker.toUpperCase()}:\n`:'') + (d.text||'');
  sendToPrompter();
  hideOverlay('lsScriptEditOv');
  renderLive(); syncToFirestore(); toast('Script saved & pushed.');
}

function jumpToLsCue(i) {
  if (session.role==='student') return;
  if (isStandardShowCaller()) return; // standard show callers may only advance sequentially
  lsIdx = i;
  renderLive();
  sendToPrompter(false);
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
  if (lsIdx > 0) { lsIdx--; renderLive(); sendToPrompter(false); syncLiveIdx(); }
}

function renderFollowChips() {
  const chips = document.getElementById('followChips');
  if (!chips) return;
  const now = Date.now();
  const me = Object.values(currentPresence||{}).find(p => p.name === session.userName);
  const following = me?.following || session.userName;
  const others = Object.values(currentPresence||{})
    .filter(p=>p.name!==session.userName&&(now-(p.lastSeen||0))<90000);
  let html = `<div class="follow-chip follow-self ${following===session.userName?'active':''}" onclick="followSelf()">Myself</div>`;
  others.forEach(p=>{
    const isActive = following === p.name;
    html+=`<div class="follow-chip ${isActive?'active':''}" onclick="followPerson(this,'${esc(p.name)}')">${esc(p.name)}<span class="p-tip-label" style="margin-left:5px">${p.role==='instructor'?'INST':'STU'}</span></div>`;
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
  if (!followName || followName === 'No users online') { toast('No live users to follow.'); return; }
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
  if (!scripts.length) {
    prompterText = '';
    const emptyEl = document.getElementById('lsPrompterText');
    if (emptyEl) emptyEl.textContent = '';
    return;
  }
  prompterText = scripts.map(b=>{
    const d = b.cues.script;
    const hdr = b.info ? `\n── ${b.info} ──\n` : '\n──────────────\n';
    return hdr + (d.ready ? `${d.ready.toUpperCase()}:\n` : '') + (d.text||'');
  }).join('\n\n');
  prompterText = cleanPrompterText(prompterText);
  const el = document.getElementById('lsPrompterText');
  if (el) el.textContent = prompterText;
}

let _prompterPingInterval = null;
let _prompterStorageHandler = null;
let _lastPrompterControlTs = 0;
const PROMPTYPUS_CHANNEL = 'promptypus';
const PROMPTYPUS_STORAGE_MSG = 'promptypus_msg';
const PROMPTYPUS_STORAGE_PING = 'promptypus_ping';
const PROMPTYPUS_LEGACY_CHANNEL = 'prompt_up_the_jam';
const PROMPTYPUS_LEGACY_STORAGE_MSG = 'prompt_up_the_jam_msg';
const PROMPTYPUS_LEGACY_STORAGE_PING = 'prompt_up_the_jam_ping';

function _postPrompterMessage(payload) {
  payload = { sender:CLIENT_ID, ...payload };
  [prompterChannel, prompterLegacyChannel].forEach(ch => {
    if (ch) {
      try { ch.postMessage(payload); } catch {}
    }
  });
  try {
    const msg = JSON.stringify({...payload, storageNonce:Date.now()+Math.random()});
    localStorage.setItem(PROMPTYPUS_STORAGE_MSG, msg);
    localStorage.setItem(PROMPTYPUS_LEGACY_STORAGE_MSG, msg);
  } catch {}
}

function _postPrompterHello() {
  const hello = { type:'cueola_hello', sender:CLIENT_ID, sessionCode:session.code, showName:show.name||'Untitled Show', ts:Date.now() };
  [prompterChannel, prompterLegacyChannel].forEach(ch => {
    if (ch) {
      try { ch.postMessage(hello); } catch {}
    }
  });
  try {
    const msg = JSON.stringify({...hello, storageNonce:Date.now()+Math.random()});
    localStorage.setItem(PROMPTYPUS_STORAGE_MSG, msg);
    localStorage.setItem(PROMPTYPUS_LEGACY_STORAGE_MSG, msg);
  } catch {}
}

function initPrompter() {
  // Don't tear down an existing live channel — just re-send current text.
  if (prompterChannel) {
    sendToPrompter(false);
    return;
  }
  const handlePrompterMessage = (e) => {
    if (e.data?.type === 'ping') {
      _setPrompterStatus(true);
      sendToPrompter(true); // reconnected — full send with scroll reset
    }
  };
  const handleStoragePing = (e) => {
    if (![PROMPTYPUS_STORAGE_PING, PROMPTYPUS_LEGACY_STORAGE_PING].includes(e.key) || !e.newValue) return;
    try {
      const msg = JSON.parse(e.newValue);
      if (msg?.type === 'ping') {
        _setPrompterStatus(true);
        sendToPrompter(true);
      }
    } catch {}
  };
  try {
    prompterChannel = new BroadcastChannel(PROMPTYPUS_CHANNEL);
    prompterChannel.onmessage = handlePrompterMessage;
    prompterLegacyChannel = new BroadcastChannel(PROMPTYPUS_LEGACY_CHANNEL);
    prompterLegacyChannel.onmessage = handlePrompterMessage;
    if (_prompterStorageHandler) window.removeEventListener('storage', _prompterStorageHandler);
    _prompterStorageHandler = handleStoragePing;
    window.addEventListener('storage', _prompterStorageHandler);
    // Periodic hello so Promptypus reconnects automatically if it was closed and reopened.
    clearInterval(_prompterPingInterval);
    _prompterPingInterval = setInterval(_postPrompterHello, 5000);
    _postPrompterHello();
    _setPrompterStatus(false); // unknown until ping reply
  } catch {
    if (_prompterStorageHandler) window.removeEventListener('storage', _prompterStorageHandler);
    _prompterStorageHandler = handleStoragePing;
    window.addEventListener('storage', _prompterStorageHandler);
    clearInterval(_prompterPingInterval);
    _prompterPingInterval = setInterval(_postPrompterHello, 5000);
    _postPrompterHello();
    _setPrompterStatus(false);
  }
}

function _setPrompterStatus(connected, unavailable=false) {
  const dot = document.getElementById('prompterDot');
  const txt = document.getElementById('prompterStatusTxt');
  const stat = document.getElementById('ls-stat-prompter');
  if (unavailable) {
    if (dot) dot.className='ls-prompter-dot off';
    if (txt) txt.textContent='Not available';
    if (stat) { stat.textContent='PROMPTER OFF'; stat.title='Promptypus offline'; stat.classList.remove('connected'); }
    return;
  }
  if (connected) {
    if (dot) dot.className='ls-prompter-dot';
    if (txt) txt.textContent='Connected';
    if (stat) { stat.textContent='PROMPTER ON'; stat.title='Promptypus connected and functioning'; stat.classList.add('connected'); }
  } else {
    if (dot) dot.className='ls-prompter-dot off';
    if (txt) txt.textContent='Waiting for Promptypus…';
    if (stat) { stat.textContent='PROMPTER WAIT'; stat.title='Promptypus waiting'; stat.classList.remove('connected'); }
  }
}

function updatePrompterOnAdvance(prevBeat, newBeat) {
  prompterText = '';
  if (newBeat?.cues?.script?.text) {
    const d = newBeat.cues.script;
    prompterText = (d.ready ? `${d.ready.toUpperCase()}:\n` : '') + d.text;
  }
  prompterText = cleanPrompterText(prompterText);
  sendToPrompter();
}

function sendToPrompter(isInit=false) {
  prompterText = cleanPrompterText(prompterText);
  const el = document.getElementById('lsPrompterText');
  if (el) el.textContent = prompterText;
  _postPrompterMessage(getPrompterPayload(isInit));
  // Also update the native built-in Promptypus screen
  if (isInit) {
    ptInitScriptFromCueola(prompterText);
  } else {
    ptUpdateFromCueola(prompterText);
  }
  if (window._firebaseReady && session.code && !session.isDemo) {
    const cur = beats[lsIdx] || null;
    const next = beats[lsIdx+1] || null;
    window._updateDoc(window._doc(window._db,'sessions',session.code),{
      'prompter.text':prompterText,
      'prompter.updatedAt':Date.now(),
      'prompter.showName':show.name||'Untitled Show',
      'prompter.activeIdx':lsIdx,
      'prompter.currentRow':cur ? { index:lsIdx, name:cur.info||'', duration:fmtDur(cur) } : null,
      'prompter.nextRow':next ? { index:lsIdx+1, name:next.info||'', duration:fmtDur(next) } : null
    }).catch(()=>{});
  }
  renderLivePrompterControls();
}

function updateLsPrompter() {
  const el = document.getElementById('lsPrompterText');
  if (el) el.textContent = prompterText;
}

function renderLivePrompterControls() {
  const el = document.getElementById('lsPrompterRemote');
  if (el) el.innerHTML = promptOpControlsHTML();
}

function pushToPrompter() {
  const el = document.getElementById('lsPrompterText');
  if (el) prompterText = cleanPrompterText(el.innerText || el.textContent || '');
  sendToPrompter();
  if (promptOpMode) renderLivePromptOp();
  toast('Pushed to prompter');
}

function clearPrompter() {
  if (!confirm('Clear prompter text?')) return;
  prompterText = '';
  sendToPrompter(true); // reset scroll on clear
}

function openPrompterApp() {
  sessionStorage.setItem('cueola_screen', 'entry');
  enterPrompter();
}

function sendPrompterControl(action) {
  _postPrompterMessage({ type:'prompter_control', action, ts:Date.now() });
  ptHandleRemoteControl(action);
  if (promptOpMode && !action.endsWith('_stop') && !action.includes('_set_')) renderLivePromptOp();
  if (!promptOpMode && !action.endsWith('_stop') && !action.includes('_set_')) renderLivePrompterControls();
  if (window._firebaseReady && session.code && !session.isDemo) {
    window._updateDoc(window._doc(window._db,'sessions',session.code),{
      'prompter.control': { action, ts:Date.now(), sender:CLIENT_ID }
    }).catch(()=>{});
  }
  const labels = {
    pause:'Paused', resume:'Resumed', speed_up:'Faster', speed_down:'Slower',
    size_up:'Bigger text', size_down:'Smaller text', rewind:'Rewound', reset:'Reset',
    align_left:'Left aligned', align_center:'Centered', align_right:'Right aligned',
    mirror:'Mirror toggled', fullscreen:'Fullscreen requested',
    theme_warm:'Warm theme', theme_cool:'Cool theme', theme_white:'White theme',
    theme_green:'Green theme', theme_black:'Black theme',
    brake_start:'Braking', boost_start:'Boosting'
  };
  if (!action.endsWith('_stop') && !action.includes('_set_')) toast(`Promptypus: ${labels[action] || action}`);
}

// ─────────────────────────────────────────────────────────────
// PROMPTYPUS — native teleprompter screen
// ─────────────────────────────────────────────────────────────

// State
let ptPlaying = false;
let ptOffset = 0;
let ptLastTime = null;
let ptAnimFrame = null;
let ptTargetSpeed = 60;
let ptLiveSpeed = 60;
let ptBraking = false;
let ptBoosting = false;
let ptReversing = false;
let ptMirrored = false;
let ptPanelVisible = true;
let ptFontSize = 52;
let ptAlign = 'center';
let ptThemeName = normalizeCueolaTheme(localStorage.getItem('promptypus_theme') || 'cool');
let ptIdleTimer = null;
let ptKeydownHandler = null;
let ptKeyupHandler = null;
let ptReceiverChannels = [];
let ptReceiverStorageHandler = null;
let ptLastRemoteMsgTs = 0;

const PT_THEMES = {
  warm:  { bg:'#130803', text:'#f5ead8', accent:'#c8843f', uiBg:'rgba(24,11,4,.92)',     uiBorder:'rgba(200,132,63,.25)' },
  cool:  { bg:'#08090f', text:'#d6e8f0', accent:'#7eb8c8', uiBg:'rgba(15,15,25,.92)',    uiBorder:'rgba(126,184,200,.25)' },
  white: { bg:'#f5f5f0', text:'#1a1a1a', accent:'#666',    uiBg:'rgba(225,225,220,.95)', uiBorder:'rgba(100,100,100,.25)' },
  green: { bg:'#041006', text:'#ddf0d2', accent:'#78ad4f', uiBg:'rgba(7,22,8,.92)',      uiBorder:'rgba(120,173,79,.25)' },
  black: { bg:'#000000', text:'#ffffff', accent:'#ffffff', uiBg:'rgba(18,18,18,.95)',    uiBorder:'rgba(255,255,255,.2)' },
};

const PT_SVG_PLAY  = `<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="M0 0 L10 6 L0 12Z"/></svg>`;
const PT_SVG_PAUSE = `<svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><rect x="0" y="0" width="3.5" height="12" rx="1"/><rect x="6.5" y="0" width="3.5" height="12" rx="1"/></svg>`;

function ptEl(id) { return document.getElementById(id); }

function ptPostPing() {
  const ping = { type:'ping', ts:Date.now(), sender:CLIENT_ID };
  ptReceiverChannels.forEach(ch => {
    try { ch.postMessage(ping); } catch {}
  });
  try {
    const msg = JSON.stringify({...ping, storageNonce:Date.now()+Math.random()});
    localStorage.setItem(PROMPTYPUS_STORAGE_PING, msg);
    localStorage.setItem(PROMPTYPUS_LEGACY_STORAGE_PING, msg);
  } catch {}
}

function ptHandleCueolaMessage(msg) {
  if (!msg || msg.sender === CLIENT_ID) return;
  const msgTs = msg.ts || 0;
  if (msgTs && msgTs < ptLastRemoteMsgTs) return;
  if (msgTs) ptLastRemoteMsgTs = msgTs;
  if (msg.type === 'cueola_hello') {
    ptPostPing();
    ptUpdateSyncLabel();
  }
  if (msg.type === 'script_init' && msg.text != null) {
    prompterText = msg.text || '';
    ptInitScriptFromCueola(prompterText);
    ptPostPing();
  }
  if (msg.type === 'script_update' && msg.text != null) {
    prompterText = msg.text || '';
    ptUpdateFromCueola(prompterText);
  }
  if (msg.type === 'prompter_control' && msg.action) {
    ptHandleRemoteControl(msg.action);
  }
}

function ptLoadSavedOrDefault() {
  const textEl = ptEl('pt-text');
  if (!textEl || textEl.textContent.trim()) return;
  const saved = (() => { try { return localStorage.getItem('promptypus_script_html'); } catch { return null; } })();
  if (saved) {
    ptSetScriptHTML(saved);
    return;
  }
  ptSetScriptText(
    'Welcome to Promptypus\n\n' +
    'Upload a PDF, DOCX, Pages, TXT, or Markdown file, or paste your script directly.\n\n' +
    'Cueola can feed this prompter when you have a session code, but it is optional.\n\n' +
    'Press PLAY, or tap the stage, to begin scrolling.\n\n' +
    'Use the controls to adjust speed, text size, alignment, theme, mirror, and fullscreen.'
  );
}

function ptInitReceiver() {
  if (ptReceiverChannels.length || ptReceiverStorageHandler) {
    ptPostPing();
    return;
  }
  try {
    [PROMPTYPUS_CHANNEL, PROMPTYPUS_LEGACY_CHANNEL].forEach(name => {
      const ch = new BroadcastChannel(name);
      ch.onmessage = e => ptHandleCueolaMessage(e.data);
      ptReceiverChannels.push(ch);
    });
  } catch {}
  ptReceiverStorageHandler = (e) => {
    if (![PROMPTYPUS_STORAGE_MSG, PROMPTYPUS_LEGACY_STORAGE_MSG].includes(e.key) || !e.newValue) return;
    try { ptHandleCueolaMessage(JSON.parse(e.newValue)); } catch {}
  };
  window.addEventListener('storage', ptReceiverStorageHandler);
  ptPostPing();
}

function ptGetMaxScroll() {
  const track = ptEl('pt-track');
  return track ? track.scrollHeight - (window.innerHeight - 48) : 0;
}

function ptUpdateProgress() {
  const max = ptGetMaxScroll();
  const pct = max > 0 ? Math.min(100, (ptOffset / max) * 100) : 0;
  const prog = ptEl('pt-progress');
  if (prog) prog.style.width = pct + '%';
}

function ptScrollLoop(ts) {
  if (!ptPlaying) return;
  if (ptLastTime === null) ptLastTime = ts;
  const delta = ts - ptLastTime;
  ptLastTime = ts;

  if (ptBraking) {
    ptLiveSpeed = Math.max(ptTargetSpeed * 0.25, 2);
  } else if (ptBoosting) {
    ptLiveSpeed = Math.min(ptTargetSpeed * 2.5, 300);
  } else {
    ptLiveSpeed += (ptTargetSpeed - ptLiveSpeed) * 0.06;
    if (Math.abs(ptLiveSpeed - ptTargetSpeed) < 0.5) ptLiveSpeed = ptTargetSpeed;
  }

  const step = (ptLiveSpeed / 60) * (delta / 16.67);
  ptOffset += ptReversing ? -step : step;
  const max = ptGetMaxScroll();
  if (ptOffset >= max) {
    ptOffset = max;
    ptStopPlay();
  } else {
    if (ptOffset < 0) ptOffset = 0;
    const track = ptEl('pt-track');
    if (track) track.style.transform = `translateY(-${ptOffset}px)`;
    ptUpdateProgress();
    ptAnimFrame = requestAnimationFrame(ptScrollLoop);
  }
}

function ptSyncPlayIcons(isPlaying) {
  const btn = ptEl('pt-play-btn');
  const icon = ptEl('pt-play-icon');
  if (btn) {
    btn.innerHTML = `${isPlaying ? PT_SVG_PAUSE : PT_SVG_PLAY} ${isPlaying ? 'PAUSE' : 'PLAY'}`;
    btn.classList.toggle('active', isPlaying);
  }
}

function promptOpControlsHTML() {
  const playAction = ptPlaying ? 'pause' : 'resume';
  const playLabel = ptPlaying ? 'PAUSE' : 'PLAY';
  const playIcon = ptPlaying ? PT_SVG_PAUSE : PT_SVG_PLAY;
  return `<div class="prompt-op-panel">
    <div class="pt-ctrl-group">
      <button class="pt-btn${ptPlaying?' active':''}" id="po-play-btn" onclick="sendPrompterControl('${playAction}')">${playIcon} ${playLabel}</button>
    </div>
    <div class="pt-ctrl-group">
      <span class="pt-ctrl-label">Speed</span>
      <button class="pt-btn" onclick="sendPrompterControl('speed_down')">−</button>
      <input type="range" class="pt-range" min="5" max="200" value="${ptTargetSpeed}" oninput="ptSetSpeed(this.value);sendPrompterControl('speed_set_'+this.value)">
      <button class="pt-btn" onclick="sendPrompterControl('speed_up')">+</button>
    </div>
    <div class="pt-ctrl-group">
      <span class="pt-ctrl-label">Size</span>
      <button class="pt-btn" onclick="sendPrompterControl('size_down')">−</button>
      <input type="range" class="pt-range" min="24" max="120" value="${ptFontSize}" oninput="ptSetSize(this.value);sendPrompterControl('size_set_'+this.value)">
      <button class="pt-btn" onclick="sendPrompterControl('size_up')">+</button>
    </div>
    <div class="pt-ctrl-group">
      <span class="pt-ctrl-label">Align</span>
      <button class="pt-btn${ptAlign==='left'?' active':''}" onclick="sendPrompterControl('align_left')"><svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="0" y="5" width="9" height="2" rx="1"/><rect x="0" y="10" width="12" height="2" rx="1"/></svg></button>
      <button class="pt-btn${ptAlign==='center'?' active':''}" onclick="sendPrompterControl('align_center')"><svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="2.5" y="5" width="9" height="2" rx="1"/><rect x="1" y="10" width="12" height="2" rx="1"/></svg></button>
      <button class="pt-btn${ptAlign==='right'?' active':''}" onclick="sendPrompterControl('align_right')"><svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="5" y="5" width="9" height="2" rx="1"/><rect x="2" y="10" width="12" height="2" rx="1"/></svg></button>
    </div>
    <div class="pt-ctrl-group">
      <span class="pt-ctrl-label">Theme</span>
      ${CUEOLA_THEMES.map(name => `<div class="pt-theme-dot${ptThemeName===name?' active':''}" style="background:${PT_THEMES[name].accent}${name==='black'?';border-color:#555':''}" onclick="sendPrompterControl('theme_${name}')" title="${name}"></div>`).join('')}
    </div>
    <div class="pt-ctrl-group">
      <button class="pt-btn" onpointerdown="sendPrompterControl('brake_start')" onpointerup="sendPrompterControl('brake_stop')" onpointerleave="sendPrompterControl('brake_stop')">Brake</button>
      <button class="pt-btn" onpointerdown="sendPrompterControl('boost_start')" onpointerup="sendPrompterControl('boost_stop')" onpointerleave="sendPrompterControl('boost_stop')">Boost</button>
    </div>
    <div class="pt-ctrl-group">
      <button class="pt-btn" onclick="openLiveScript(${Math.max(lsIdx,0)})">Script</button>
      <button class="pt-btn" onclick="sendPrompterControl('reset')">Reset</button>
      <button class="pt-btn" onclick="sendPrompterControl('mirror')">Mirror</button>
      <button class="pt-btn" onclick="sendPrompterControl('fullscreen')">Full</button>
    </div>
  </div>`;
}

function ptStartPlay() {
  ptPlaying = true;
  ptLastTime = null;
  ptSyncPlayIcons(true);
  ptAnimFrame = requestAnimationFrame(ptScrollLoop);
}

function ptStopPlay() {
  ptPlaying = false;
  if (ptAnimFrame) cancelAnimationFrame(ptAnimFrame);
  ptAnimFrame = null;
  ptSyncPlayIcons(false);
}

function ptTogglePlay() {
  ptPlaying ? ptStopPlay() : ptStartPlay();
}

function ptSetSpeed(val) {
  ptTargetSpeed = parseFloat(val);
  ptLiveSpeed = ptTargetSpeed;
  const sl = ptEl('pt-speed-slider');
  if (sl) sl.value = val;
}

function ptAdjustSpeed(delta) {
  ptSetSpeed(Math.max(5, Math.min(200, ptTargetSpeed + delta)));
}

function ptSetSize(val) {
  ptFontSize = parseInt(val);
  const screen = ptEl('promptypus');
  if (screen) screen.style.setProperty('--pt-size', val + 'px');
  document.documentElement.style.setProperty('--pt-size', val + 'px');
  const sl = ptEl('pt-size-slider');
  if (sl) sl.value = val;
}

function ptAdjustSize(delta) {
  ptSetSize(Math.max(24, Math.min(120, ptFontSize + delta)));
}

function ptSetAlign(a) {
  ptAlign = a;
  const screen = ptEl('promptypus');
  if (screen) screen.style.setProperty('--pt-align', a);
  document.documentElement.style.setProperty('--pt-align', a);
  ['l','c','r'].forEach(x => {
    const btn = ptEl('pt-align-' + x);
    if (btn) btn.classList.toggle('active', x === a[0]);
  });
}

function ptResetScroll() {
  ptStopPlay();
  ptOffset = 0;
  const track = ptEl('pt-track');
  if (track) track.style.transform = 'translateY(0)';
  ptUpdateProgress();
}

function ptToggleMirror() {
  ptMirrored = !ptMirrored;
  const stage = ptEl('pt-stage');
  if (stage) stage.classList.toggle('mirrored', ptMirrored);
  const btn = ptEl('pt-mirror-btn');
  if (btn) btn.classList.toggle('active', ptMirrored);
}

function ptToggleFullscreen() {
  const el = ptEl('promptypus');
  if (!el) return;
  const isFull = document.fullscreenElement === el || document.webkitFullscreenElement === el;
  if (!isFull) {
    (el.requestFullscreen || el.webkitRequestFullscreen || function(){}).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen || function(){}).call(document);
  }
}

function ptTogglePanel() {
  ptPanelVisible = !ptPanelVisible;
  const panel = ptEl('pt-panel');
  const hint = ptEl('pt-hint');
  if (panel) panel.classList.toggle('hidden', !ptPanelVisible);
  if (hint) hint.classList.toggle('hidden', !ptPanelVisible);
  // Update Controls button label
  const btn = document.querySelector('.pt-bar-controls-btn');
  if (btn) btn.textContent = ptPanelVisible ? 'Controls' : 'Show Controls';
}

function ptSetTheme(name) {
  const t = PT_THEMES[name];
  if (!t) return;
  ptThemeName = name;
  const screen = ptEl('promptypus');
  if (!screen) return;
  screen.style.setProperty('--pt-bg', t.bg);
  screen.style.setProperty('--pt-text', t.text);
  screen.style.setProperty('--pt-accent', t.accent);
  screen.style.setProperty('--pt-ui-bg', t.uiBg);
  screen.style.setProperty('--pt-ui-border', t.uiBorder);
  screen.style.background = t.bg;
  document.documentElement.style.setProperty('--pt-bg', t.bg);
  document.documentElement.style.setProperty('--pt-text', t.text);
  document.documentElement.style.setProperty('--pt-accent', t.accent);
  document.documentElement.style.setProperty('--pt-ui-bg', t.uiBg);
  document.documentElement.style.setProperty('--pt-ui-border', t.uiBorder);
  try { localStorage.setItem('promptypus_theme', name); } catch {}
  document.querySelectorAll('.pt-theme-dot').forEach(d => d.classList.remove('active'));
  const dot = ptEl('pt-t-' + name);
  if (dot) dot.classList.add('active');
}

function ptPlainTextToHTML(text) {
  return (text || '').split('\n').map(line => `<p>${line || ' '}</p>`).join('');
}

function ptSanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(el => el.remove());
  doc.body.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      if (/^on/i.test(attr.name) || attr.name === 'style') el.removeAttribute(attr.name);
    });
  });
  return doc.body.innerHTML;
}

function ptSetScriptHTML(html) {
  const el = ptEl('pt-text');
  if (!el) return;
  el.innerHTML = ptSanitizeHTML(html);
  prompterText = el.innerText || '';
  try { localStorage.setItem('promptypus_script_html', el.innerHTML); } catch {}
  ptResetScroll();
  ptUpdateSyncLabel();
}

function ptSetScriptText(text) {
  ptSetScriptHTML(ptPlainTextToHTML(text));
}

function ptLoadLibrary(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load import support.'));
    document.head.appendChild(s);
  });
}

async function ptExtractFromPDF(arrayBuffer) {
  await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lines = [];
    let lastY = null;
    let lineAccum = '';
    for (const item of content.items) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        if (lineAccum.trim()) lines.push(lineAccum.trimEnd());
        lineAccum = '';
      }
      lineAccum += item.str;
      lastY = y;
    }
    if (lineAccum.trim()) lines.push(lineAccum.trimEnd());
    if (lines.length) pages.push(lines.join('\n'));
  }
  return pages.join('\n\n');
}

async function ptExtractFromDOCX(arrayBuffer) {
  await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return result.value.replace(/<p>\s*<\/p>/g, '<p> </p>');
}

async function ptExtractFromPages(arrayBuffer) {
  await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  const zip = await JSZip.loadAsync(arrayBuffer);
  const pdfEntry = zip.file('QuickLook/Preview.pdf');
  if (pdfEntry) {
    const pdfBuf = await pdfEntry.async('arraybuffer');
    return { text: await ptExtractFromPDF(pdfBuf) };
  }
  const xmlEntry = zip.file('index.apxl');
  if (xmlEntry) {
    const xmlStr = await xmlEntry.async('string');
    const xmlDoc = new DOMParser().parseFromString(xmlStr, 'text/xml');
    const paras = Array.from(xmlDoc.querySelectorAll('p')).map(n => n.textContent).filter(Boolean);
    return { text: paras.join('\n\n') };
  }
  throw new Error('Cannot read this Pages file. Export it as PDF or DOCX and try again.');
}

function ptChooseScriptFile() {
  const input = ptEl('pt-file-input');
  if (input) input.click();
}

function ptSetUploadStatus(text, isError=false) {
  const status = ptEl('pt-upload-status');
  if (!status) return;
  status.textContent = text;
  status.style.color = isError ? '#f05252' : '';
  status.classList.add('on');
}

async function ptHandleScriptFile(file) {
  const uploadBtn = ptEl('pt-upload-file-btn');
  if (uploadBtn) uploadBtn.disabled = true;
  ptSetUploadStatus('Reading...');
  try {
    const buf = await file.arrayBuffer();
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) {
      ptSetScriptText(await ptExtractFromPDF(buf));
    } else if (name.endsWith('.docx')) {
      ptSetScriptHTML(await ptExtractFromDOCX(buf));
    } else if (name.endsWith('.pages')) {
      const result = await ptExtractFromPages(buf);
      if (result.html) ptSetScriptHTML(result.html);
      else ptSetScriptText(result.text || '');
    } else if (name.endsWith('.txt') || name.endsWith('.md')) {
      ptSetScriptText(await file.text());
    } else {
      throw new Error('Unsupported file type. Use PDF, DOCX, Pages, TXT, or MD.');
    }
    const ta = ptEl('pt-script-input');
    const textEl = ptEl('pt-text');
    if (ta && textEl) ta.value = textEl.innerText.trim();
    ptSetUploadStatus('Loaded');
    setTimeout(() => ptEl('pt-upload-status')?.classList.remove('on'), 2500);
  } catch (err) {
    ptSetUploadStatus(err.message || 'Import failed', true);
    console.warn('Promptypus import error:', err);
  } finally {
    if (uploadBtn) uploadBtn.disabled = false;
  }
}

function ptDownloadText() {
  const ta = ptEl('pt-script-input');
  const textEl = ptEl('pt-text');
  return (ta?.value.trim()) || (textEl?.innerText.trim()) || '';
}

function ptDownloadAsTxt() {
  const txt = ptDownloadText();
  if (!txt) return;
  const blob = new Blob([txt], { type:'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'promptypus-script.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function ptDownloadAsPDF() {
  const txt = ptDownloadText();
  if (!txt) return;
  await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const margin = 20;
  const pageW = doc.internal.pageSize.width - margin * 2;
  const pageH = doc.internal.pageSize.height - margin * 2;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  const lines = doc.splitTextToSize(txt, pageW);
  let y = margin;
  for (const line of lines) {
    if (y + 7 > margin + pageH) { doc.addPage(); y = margin; }
    doc.text(line, margin, y);
    y += 7;
  }
  doc.save('promptypus-script.pdf');
}

// Called by Cueola when script changes — scroll reset (new cue/session)
function ptInitScriptFromCueola(text) {
  ptSetScriptText(text || '');
  ptUpdateSyncLabel();
}

// Called by Cueola on live advance — update text without interrupting scroll
function ptUpdateFromCueola(text) {
  const el = ptEl('pt-text');
  if (!el) return;
  const track = ptEl('pt-track');
  const prevHeight = track ? track.scrollHeight : 0;
  el.innerHTML = ptPlainTextToHTML(text || '');
  ptUpdateSyncLabel();
  requestAnimationFrame(() => {
    if (!track) return;
    const newHeight = track.scrollHeight;
    if (prevHeight > 0 && newHeight > 0 && newHeight !== prevHeight) {
      ptOffset = (ptOffset / prevHeight) * newHeight;
    }
    if (!ptPlaying) track.style.transform = `translateY(-${ptOffset}px)`;
    ptUpdateProgress();
  });
}

function ptUpdateSyncLabel() {
  const lbl = ptEl('pt-sync-label');
  if (!lbl) return;
  if (session && session.code && !session.isDemo) {
    lbl.textContent = `● Live · ${session.code}`;
  } else {
    const hasText = (prompterText && prompterText.trim()) ||
                    (ptEl('pt-text') && ptEl('pt-text').textContent.trim());
    lbl.textContent = hasText ? '● Script loaded' : 'No script — use Script button';
  }
}

// Called by sendPrompterControl to mirror controls into the native prompter
function ptHandleRemoteControl(action) {
  if (action?.startsWith('speed_set_')) { ptSetSpeed(action.replace('speed_set_', '')); return; }
  if (action?.startsWith('size_set_')) { ptSetSize(action.replace('size_set_', '')); return; }
  switch (action) {
    case 'pause':      ptStopPlay(); break;
    case 'resume':     ptStartPlay(); break;
    case 'speed_up':   ptAdjustSpeed(10); break;
    case 'speed_down': ptAdjustSpeed(-10); break;
    case 'size_up':    ptAdjustSize(4); break;
    case 'size_down':  ptAdjustSize(-4); break;
    case 'align_left':   ptSetAlign('left'); break;
    case 'align_center': ptSetAlign('center'); break;
    case 'align_right':  ptSetAlign('right'); break;
    case 'theme_warm':  ptSetTheme('warm'); break;
    case 'theme_cool':  ptSetTheme('cool'); break;
    case 'theme_white': ptSetTheme('white'); break;
    case 'theme_green': ptSetTheme('green'); break;
    case 'theme_black': ptSetTheme('black'); break;
    case 'mirror':     ptToggleMirror(); break;
    case 'fullscreen': ptToggleFullscreen(); break;
    case 'brake_start': ptBraking = true; break;
    case 'brake_stop':  ptBraking = false; break;
    case 'boost_start': ptBoosting = true; ptLiveSpeed = Math.min(ptTargetSpeed * 2.5, 300); break;
    case 'boost_stop':  ptBoosting = false; break;
    case 'reset':
    case 'rewind':     ptResetScroll(); break;
  }
}

function ptOpenEdit() {
  ptStopPlay();
  const ta = ptEl('pt-script-input');
  const textEl = ptEl('pt-text');
  if (ta && textEl) ta.value = textEl.innerText.trim();
  const codeIn = ptEl('pt-cueola-code-input');
  if (codeIn && session?.code) codeIn.value = session.code;
  const ov = ptEl('pt-edit-overlay');
  if (ov) ov.classList.add('open');
  setTimeout(() => { if (ta) ta.focus(); }, 50);
}

function ptCloseEdit() {
  const ov = ptEl('pt-edit-overlay');
  if (ov) ov.classList.remove('open');
}

function ptSaveScript() {
  const ta = ptEl('pt-script-input');
  if (ta && ta.value.trim()) ptSetScriptText(ta.value.trim());
  ptCloseEdit();
}

function ptLoadFromCueola() {
  if (prompterText && prompterText.trim()) {
    ptInitScriptFromCueola(prompterText);
    ptCloseEdit();
    toast('Loaded script from Cueola');
  } else {
    toast('No script in Cueola yet — add script cues and push to prompter from the live view.');
  }
}

let ptCueolaSub = null;

function ptSetCueolaStatus(text, isError=false) {
  const status = ptEl('pt-cueola-status');
  if (!status) return;
  status.textContent = text;
  status.style.color = isError ? '#f05252' : '';
  status.classList.add('on');
}

function ptAssembleCueolaScript(data) {
  if (data?.prompter?.text && data.prompter.text.trim()) return data.prompter.text;
  const lines = [];
  (data?.beats || []).forEach(beat => {
    const text = beat?.cues?.script?.text || beat?.cueData?.text || beat?.script || '';
    if (text) lines.push(text);
  });
  return lines.join('\n\n');
}

function ptLoadFromCueolaCode() {
  const code = ptEl('pt-cueola-code-input')?.value.trim().toUpperCase();
  const btn = ptEl('pt-cueola-load-btn');
  if (!code) return;
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  ptSetCueolaStatus('Loading...');
  const load = () => {
    try {
      if (ptCueolaSub) { ptCueolaSub(); ptCueolaSub = null; }
      ptCueolaSub = window._onSnapshot(window._doc(window._db, 'sessions', code), snap => {
        if (!snap.exists()) {
          ptSetCueolaStatus('Not found', true);
          if (btn) { btn.disabled = false; btn.textContent = 'Load →'; }
          return;
        }
        const text = ptAssembleCueolaScript(snap.data());
        if (text.trim()) {
          prompterText = text;
          ptSetScriptText(text);
          const ta = ptEl('pt-script-input');
          if (ta) ta.value = text.trim();
          ptSetCueolaStatus(`Live · ${code}`);
          ptUpdateSyncLabel();
        } else {
          ptSetCueolaStatus('No script yet', true);
        }
        if (btn) { btn.disabled = false; btn.textContent = 'Load →'; }
      }, () => {
        ptSetCueolaStatus('Error', true);
        if (btn) { btn.disabled = false; btn.textContent = 'Load →'; }
      });
    } catch (err) {
      ptSetCueolaStatus('Error', true);
      if (btn) { btn.disabled = false; btn.textContent = 'Load →'; }
    }
  };
  if (window._firebaseReady) load();
  else window.addEventListener('firebaseReady', load, { once:true });
}

function ptResetIdle() {
  const screen = ptEl('promptypus');
  if (!screen) return;
  screen.classList.add('show-cursor');
  if (ptPlaying && ptPanelVisible) {
    clearTimeout(ptIdleTimer);
    ptIdleTimer = setTimeout(() => {
      if (ptPlaying) screen.classList.remove('show-cursor');
    }, 3000);
  }
}

function enterPrompter() {
  // Show the promptypus screen
  document.getElementById('entry').classList.remove('on');
  document.getElementById('rundown').classList.remove('on');
  document.getElementById('liveshow').classList.remove('on');
  document.getElementById('promptypus').classList.add('on');
  pushSessionHistoryState('promptypus');
  ptInitReceiver();

  // Sync live script from Cueola if available (always takes priority over previous content)
  const textEl = ptEl('pt-text');
  if (prompterText && prompterText.trim()) {
    // Always load the latest live script from Cueola when entering
    ptSetScriptText(prompterText);
  } else if (!textEl || !textEl.textContent.trim()) {
    ptLoadSavedOrDefault();
  }
  // (If textEl has content from a previous manual load and no live script, keep it)
  // Initialize theme
  ptSetTheme(ptThemeName);
  ptSetAlign(ptAlign);
  ptSetSize(ptFontSize);
  ptUpdateSyncLabel();

  // Keyboard handler (scoped to when this screen is active)
  if (ptKeydownHandler) document.removeEventListener('keydown', ptKeydownHandler);
  if (ptKeyupHandler) document.removeEventListener('keyup', ptKeyupHandler);

  ptKeydownHandler = (e) => {
    if (!document.getElementById('promptypus').classList.contains('on')) return;
    const editOpen = ptEl('pt-edit-overlay')?.classList.contains('open');
    if (editOpen) {
      if (e.key === 'Escape') ptCloseEdit();
      return;
    }
    if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); ptReversing = true; return; }
    if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); ptReversing = false; return; }
    if (e.repeat) return;
    switch (e.key) {
      case ' ':          e.preventDefault(); ptTogglePlay(); break;
      case 'ArrowUp':    e.preventDefault(); ptBoosting = true; ptLiveSpeed = Math.min(ptTargetSpeed * 2.5, 300); break;
      case 'ArrowDown':  e.preventDefault(); ptBraking = true; break;
      case 'ArrowLeft':  e.preventDefault(); ptAdjustSize(-4); break;
      case 'ArrowRight': e.preventDefault(); ptAdjustSize(4); break;
      case 'f': case 'F': ptToggleFullscreen(); break;
      case 'e': case 'E': ptOpenEdit(); break;
      case 'r': case 'R': ptResetScroll(); break;
      case 'h': case 'H': ptTogglePanel(); break;
      case 'm': case 'M': ptToggleMirror(); break;
      case 'Escape':
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else if (ptPlaying) {
          ptStopPlay();
        } else {
          exitPrompter();
        }
        break;
    }
  };
  ptKeyupHandler = (e) => {
    if (!document.getElementById('promptypus').classList.contains('on')) return;
    if (e.key === 'ArrowUp')   { ptBoosting = false; }
    if (e.key === 'ArrowDown') { ptBraking = false; }
  };
  document.addEventListener('keydown', ptKeydownHandler);
  document.addEventListener('keyup', ptKeyupHandler);

  // Idle cursor tracking
  ptEl('promptypus').addEventListener('mousemove', ptResetIdle);

  // Touch: tap to play/pause
  const stage = ptEl('pt-stage');
  if (stage && !stage._ptTouch) {
    stage._ptTouch = true;
    let _tY = 0, _tT = 0, _tDrag = false;
    stage.addEventListener('touchstart', e => {
      _tY = e.touches[0].clientY; _tT = Date.now(); _tDrag = false;
    }, { passive: true });
    stage.addEventListener('touchmove', e => {
      const dy = e.touches[0].clientY - _tY;
      if (dy > 20) { ptBraking = true; ptBoosting = false; _tDrag = true; }
      else if (dy < -20) { ptBoosting = true; ptBraking = false; ptLiveSpeed = Math.min(ptTargetSpeed * 2.5, 300); _tDrag = true; }
      else { ptBraking = false; ptBoosting = false; }
    }, { passive: true });
    stage.addEventListener('touchend', e => {
      ptBraking = false; ptBoosting = false;
      const dy = e.changedTouches[0].clientY - _tY;
      if (!_tDrag && Date.now() - _tT < 300 && Math.abs(dy) < 18) ptTogglePlay();
      _tDrag = false;
    }, { passive: true });
  }
  const fileInput = ptEl('pt-file-input');
  if (fileInput && !fileInput._ptBound) {
    fileInput._ptBound = true;
    fileInput.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) ptHandleScriptFile(file);
      e.target.value = '';
    });
  }
}

function exitPrompter() {
  ptStopPlay();
  document.getElementById('promptypus').classList.remove('on');
  // Go back to whichever screen was active before
  const prevScreen = sessionStorage.getItem('cueola_screen');
  if (prevScreen === 'live') {
    document.getElementById('liveshow').classList.add('on');
  } else if (session && session.code) {
    document.getElementById('rundown').classList.add('on');
  } else {
    document.getElementById('entry').classList.add('on');
  }
}

function togglePromptOpMode() {
  promptOpMode = !promptOpMode;
  document.getElementById('liveshow')?.classList.toggle('prompt-op-active', promptOpMode);
  const btn = document.getElementById('promptOpBtn');
  if (btn) {
    if (promptOpMode) {
      btn.style.color = 'var(--cyan)';
      btn.style.borderColor = 'var(--cyan)';
      btn.style.background = 'color-mix(in srgb,var(--cyan) 12%,transparent)';
      btn.textContent = '▦ Rundown View';
    } else {
      btn.style.color = '';
      btn.style.borderColor = '';
      btn.style.background = '';
      btn.textContent = '📜 Prompt Op';
    }
  }
  renderLive();
}

function renderLivePromptOp() {
  const body = document.getElementById('lsBody');
  ptSetTheme(ptThemeName);
  if (!beats.length) {
    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">No cues in rundown.</div>';
    return;
  }
  const cur  = beats[lsIdx] || null;
  const next = beats[lsIdx + 1] || null;
  const sd   = cur?.cues?.script;
  const script = cleanPrompterText((prompterText && prompterText.trim()) || sd?.text || '');
  body.innerHTML = `<div class="prompt-op-stage">
    <div class="prompt-op-info">Now · ${esc(cur?.info || '—')} · Row ${lsIdx + 1} of ${beats.length}${next ? ` · Next: ${esc(next.info || '—')}` : ''}</div>
    <div class="prompt-op-read-line"></div>
    <div class="prompt-op-track">
      <div class="prompt-op-text">${script ? esc(script) : 'No script loaded.\n\nUse Script, add script in Build, or push from the live prompter text.'}</div>
    </div>
    ${promptOpControlsHTML()}
  </div>`;
}

// ─────────────────────────────────────────────────────────────
// TIMER
// ─────────────────────────────────────────────────────────────
function startTimer() {
  stopTimer();
  const start = Date.now() - elapsedSecs * 1000;
  liveTimerStartMs = start;
  timerInterval = setInterval(()=>{
    const elapsedMs = Date.now() - start;
    elapsedSecs = Math.floor(elapsedMs / 1000);
    const el = document.getElementById('ls-timer');
    if (el) {
      el.textContent = fmtProductionClock(elapsedMs);
      const total = totalSecs();
      el.classList.toggle('warn', total>0 && elapsedSecs>total*0.9);
    }
    updateBotBar();
    updateLiveOverview();
    const clockEl = document.getElementById('ls-clock');
    if (clockEl) {
      const now = new Date();
      const h=now.getHours(), m=now.getMinutes(), s=now.getSeconds();
      const ap=h>=12?'PM':'AM', h12=h%12||12;
      clockEl.textContent=`${h12}:${pad(m)}:${pad(s)} ${ap}`;
    }
  },1000 / Math.min(frameRate, 30));
}

function stopTimer() {
  clearInterval(timerInterval); timerInterval=null;
  liveTimerStartMs = null;
  clearInterval(_prompterPingInterval); _prompterPingInterval=null;
  if (_prompterStorageHandler) {
    window.removeEventListener('storage', _prompterStorageHandler);
    _prompterStorageHandler = null;
  }
}

// ─────────────────────────────────────────────────────────────
// SETTINGS & THEME
// ─────────────────────────────────────────────────────────────
function applyTheme(t) { document.documentElement.setAttribute('data-theme', normalizeCueolaTheme(t)); }

function selectTheme(t) {
  currentTheme = normalizeCueolaTheme(t);
  document.querySelectorAll('.theme-swatch').forEach(s=>s.classList.toggle('active', s.dataset.theme===t));
  applyTheme(currentTheme); // live preview — reverted on Cancel, saved on Save
}

function saveSettings() {
  const nameIn = document.getElementById('set-showname');
  if (!nameIn.disabled) show.name = nameIn.value.trim()||show.name;
  show.start = document.getElementById('set-starttime').value||'';
  frameRate = normalizeFrameRate(document.getElementById('set-framerate')?.value);
  applyTheme(currentTheme);
  localStorage.setItem('cueola_theme', currentTheme);
  localStorage.setItem('cueola_frame_rate', String(frameRate));
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
    const fps = document.getElementById('set-framerate');
    if (fps) fps.value = String(frameRate);
    const saved = normalizeCueolaTheme(localStorage.getItem('cueola_theme'));
    _settingsOpenTheme = saved; // remember so Cancel can revert
    currentTheme = saved;
    document.querySelectorAll('.theme-swatch').forEach(s=>s.classList.toggle('active', s.dataset.theme===saved));
  }
  document.getElementById(id).classList.add('on');
};

// ─────────────────────────────────────────────────────────────
// CALL SHEET
// ─────────────────────────────────────────────────────────────
const PAPERWORK_ITEMS = [
  { order:1, id:'call-sheet', title:'Call Sheet', sub:'Production details, crew, talent, location, and schedule.' },
  { order:2, id:'safety-plan', title:'Safety Plan', sub:'Emergency contacts, safety locations, weather, and equipment.' },
  { order:3, id:'rundown', title:'Full Rendered Rundown', sub:'The complete show rundown with every cue rendered out.' },
  { order:4, id:'video-patch', title:'Video Patch Sheet', sub:'Editable row grid for label, destination, source, cabling, and notes.' },
  { order:5, id:'audio-comms-patch', title:'Audio and Comms Patch Sheets', sub:'Editable audio routing and comms assignment grids.' },
];
let activePatchKind = '';

function preProKey() {
  return `cueola_prepro_${session.code || session.userName || 'local'}`;
}

function loadPreProData() {
  try { return JSON.parse(localStorage.getItem(preProKey()) || '{}') || {}; } catch { return {}; }
}

function persistPreProData(patch) {
  const next = { ...loadPreProData(), ...patch, updatedAt: Date.now() };
  try { localStorage.setItem(preProKey(), JSON.stringify(next)); } catch {}
  syncPreProToFirestore(next);
  return next;
}

function syncPreProToFirestore(data=loadPreProData()) {
  if (!window._firebaseReady || !session.code || session.isDemo || session.isExpert) return;
  window._updateDoc(window._doc(window._db,'sessions',session.code), { prePro:data }).catch(()=>{});
}

function openPaperworkHub() {
  if (!session.code && !session.isDemo && !session.isExpert) {
    showModal('modal-prepro-join');
    return;
  }
  const grid = document.getElementById('paperworkGrid');
  if (grid) {
    grid.innerHTML = PAPERWORK_ITEMS.map(item => `<button class="paperwork-card" onclick="openPaperworkItem('${item.id}')">
      <div class="paperwork-card-num">Item ${item.order}</div>
      <div class="paperwork-card-title">${esc(item.title)}</div>
      <div class="paperwork-card-sub">${esc(item.sub)}</div>
    </button>`).join('');
  }
  showModal('paperworkHubModal');
}

function openPaperworkItem(id) {
  if (id === 'call-sheet') return openPrePro();
  if (id === 'safety-plan') return openSafetyPlan();
  if (id === 'rundown') return showRundownPaperPreview();
  if (id === 'video-patch') return showPatchSheetPreview('video');
  if (id === 'audio-comms-patch') return showPatchSheetPreview('audio-comms');
}

function showPaperPreview(title, html, primaryLabel='Done', primaryAction="hideModal('paperPreviewModal')") {
  document.getElementById('paperPreviewTitle').textContent = title;
  document.getElementById('paperPreviewBody').innerHTML = html;
  const primary = document.getElementById('paperPreviewPrimary');
  primary.textContent = primaryLabel;
  primary.setAttribute('onclick', primaryAction);
  hideModal('paperworkHubModal');
  hideModal('preProModal');
  hideModal('safetyPlanModal');
  hideModal('patchSheetModal');
  showModal('paperPreviewModal');
}

function showRundownPaperPreview() {
  let offsetSecs = 0;
  showPaperPreview('Rundown Paperwork Preview', `
    <h1>${esc(show.name || 'Cueola Rundown')}</h1>
    <div>Item 3 · Full rendered rundown</div>
    <h2>Rundown</h2>
    ${rundownPreviewTableHTML()}
  `, 'Download Rundown PDF', 'exportPDF()');
}

function rundownPreviewTableHTML() {
  let offsetSecs = 0;
  const cellFor = (b, type) => {
    const d = b.cues?.[type];
    const on = getCueOn(d), off = getCueOff(d);
    const script = type === 'script' && d?.text ? `Script ${scriptLineCount(d.text)} lines` : '';
    const parts = [on && `<span class="cue-type">ON</span> ${esc(on)}`, off && `<span class="cue-type">OFF</span> ${esc(off)}`, script && `<span class="cue-muted">${esc(script)}</span>`].filter(Boolean);
    return parts.length ? parts.join('<br>') : '<span class="cue-muted">-</span>';
  };
  const rows = beats.map((b,i) => {
    const start = show.start ? clock(show.start, offsetSecs) : '-';
    offsetSecs += (b.min||0)*60+(b.sec||0);
    return `<tr>
      <td>${i+1}</td>
      <td><strong>${esc(b.info||'-')}</strong>${b.notes?`<br><span class="cue-muted">${esc(b.notes)}</span>`:''}</td>
      <td>${start}</td>
      <td>${fmtDur(b)}</td>
      <td>${cellFor(b,'video')}</td>
      <td>${cellFor(b,'audio')}</td>
      <td>${cellFor(b,'playback')}</td>
      <td>${cellFor(b,'gfx')}</td>
      <td>${cellFor(b,'lighting')}</td>
      <td>${cellFor(b,'script')}</td>
    </tr>`;
  }).join('');
  return `<div class="paper-landscape"><table class="paper-rundown-grid"><thead><tr><th>#</th><th>Row</th><th>Start</th><th>Dur</th><th>Video</th><th>Audio</th><th>Playback</th><th>GFX</th><th>Lighting</th><th>Script</th></tr></thead><tbody>${rows || '<tr><td colspan="10">No rows yet.</td></tr>'}</tbody></table></div>`;
}

function showCallSheetPreview() {
  const data = getPreProData();
  const people = (data.people || []).filter(p => p.name || p.role || p.call);
  const peopleRows = people.map(p => `<tr><td>${esc(p.name || '')}</td><td>${esc(p.role || '')}</td><td>${esc(p.call || '')}</td></tr>`).join('');
  showPaperPreview('Call Sheet Preview', `
    <h1>Call Sheet</h1>
    <div>Item 1</div>
    <table><tbody>
      <tr><th>Production</th><td>${esc(data.production || '')}</td></tr>
      <tr><th>Shoot Date</th><td>${esc(data.date || '')}</td></tr>
      <tr><th>Call Time</th><td>${esc(data.call || '')}</td></tr>
      <tr><th>Location</th><td>${esc(data.location || '')}</td></tr>
    </tbody></table>
    <h2>Crew / Talent</h2>
    <table><thead><tr><th>Name</th><th>Role</th><th>Call</th></tr></thead><tbody>${peopleRows || '<tr><td colspan="3">No crew or talent entered yet.</td></tr>'}</tbody></table>
    <h2>Schedule / Notes</h2>
    <table><tbody><tr><td>${esc(data.notes || '')}</td></tr></tbody></table>
  `, 'Back to Editor', "hideModal('paperPreviewModal');openPrePro()");
}

function showPatchSheetPreview(kind) {
  openPatchSheetEditor(kind);
}

function callSheetPreviewHTML(data) {
  const people = (data.people || []).filter(p => p.name || p.role || p.call);
  const peopleRows = people.map(p => `<tr><td>${esc(p.name || '')}</td><td>${esc(p.role || '')}</td><td>${esc(p.call || '')}</td></tr>`).join('');
  return `
    <h1>1. Call Sheet</h1>
    <table><tbody>
      <tr><th>Production</th><td>${esc(data.production || show.name || '')}</td></tr>
      <tr><th>Shoot Date</th><td>${esc(data.date || '')}</td></tr>
      <tr><th>Call Time</th><td>${esc(data.call || show.start || '')}</td></tr>
      <tr><th>Location</th><td>${esc(data.location || '')}</td></tr>
    </tbody></table>
    <h2>Crew / Talent</h2>
    <table><thead><tr><th>Name</th><th>Role</th><th>Call</th></tr></thead><tbody>${peopleRows || '<tr><td colspan="3">No crew or talent entered yet.</td></tr>'}</tbody></table>
    <h2>Schedule / Notes</h2>
    <table><tbody><tr><td>${esc(data.notes || '')}</td></tr></tbody></table>`;
}

function showCuePartPreview(type) {
  const titleMap = { video:'Camera Cue Part', audio:'Rundown Audio Cues Part', lighting:'Rundown Lighting Cues Part' };
  const rows = beats.map((b,i) => {
    const d = b.cues?.[type];
    if (!d) return '';
    const on = getCueOn(d), off = getCueOff(d);
    return `<tr><td>${i+1}</td><td>${esc(b.info||'-')}</td><td>${esc(on||'-')}</td><td>${esc(off||'-')}</td><td>${esc(d.notes||'')}</td></tr>`;
  }).filter(Boolean).join('');
  showPaperPreview(titleMap[type], `
    <h1>${titleMap[type]}</h1>
    <div>Rendered from the rundown editor.</div>
    <table><thead><tr><th>#</th><th>Row</th><th>On Cue</th><th>Off Cue</th><th>Notes</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No cues for this part yet.</td></tr>'}</tbody></table>
  `);
}

function openSafetyPlan() {
  hideModal('paperworkHubModal');
  const data = loadPreProData();
  const safety = data.safety || {};
  document.getElementById('sp-hospital').value = safety.hospital || data.hospital || '';
  document.getElementById('sp-weather').value = safety.weather || data.weather || '';
  document.getElementById('sp-first-aid').value = safety.firstAid || '';
  document.getElementById('sp-fire').value = safety.fire || '';
  document.getElementById('sp-emergency').value = safety.emergency || '';
  document.getElementById('sp-nonemergency').value = safety.nonemergency || '';
  document.getElementById('sp-security').value = safety.security || '8822';
  document.getElementById('sp-late').value = safety.late || data.late || '';
  document.getElementById('sp-equipment').value = safety.equipment || data.equipment || '';
  document.getElementById('sp-notes').value = safety.notes || '';
  showModal('safetyPlanModal');
}

function getSafetyPlanData() {
  const existing = loadPreProData().safety || {};
  return {
    hospital: document.getElementById('sp-hospital')?.value?.trim() ?? existing.hospital ?? '',
    weather: document.getElementById('sp-weather')?.value?.trim() ?? existing.weather ?? '',
    firstAid: document.getElementById('sp-first-aid')?.value?.trim() ?? existing.firstAid ?? '',
    fire: document.getElementById('sp-fire')?.value?.trim() ?? existing.fire ?? '',
    emergency: document.getElementById('sp-emergency')?.value?.trim() ?? existing.emergency ?? '',
    nonemergency: document.getElementById('sp-nonemergency')?.value?.trim() ?? existing.nonemergency ?? '',
    security: document.getElementById('sp-security')?.value?.trim() || existing.security || '8822',
    late: document.getElementById('sp-late')?.value?.trim() ?? existing.late ?? '',
    equipment: document.getElementById('sp-equipment')?.value?.trim() ?? existing.equipment ?? '',
    notes: document.getElementById('sp-notes')?.value ?? existing.notes ?? '',
  };
}

function saveSafetyPlan() {
  persistPreProData({ safety: getSafetyPlanData() });
  toast('Safety plan saved.');
}

function safetyPlanHTML(safety) {
  return `
    <h1>2. Safety Plan</h1>
    <div>Item 2</div>
    <table><tbody>
      <tr><th>Local Hospital</th><td>${esc(safety.hospital || '')}</td></tr>
      <tr><th>Weather</th><td>${esc(safety.weather || '')}</td></tr>
      <tr><th>First Aid Kit Location</th><td>${esc(safety.firstAid || '')}</td></tr>
      <tr><th>Fire Extinguisher Location</th><td>${esc(safety.fire || '')}</td></tr>
      <tr><th>Emergency Numbers</th><td>${esc(safety.emergency || '')}</td></tr>
      <tr><th>Non-Emergency Numbers</th><td>${esc(safety.nonemergency || '')}</td></tr>
      <tr><th>Security</th><td>${esc(safety.security || '8822')}</td></tr>
      <tr><th>Late / Lost Contact</th><td>${esc(safety.late || '')}</td></tr>
      <tr><th>Equipment Needed</th><td>${esc(safety.equipment || '')}</td></tr>
      <tr><th>Safety Notes</th><td>${esc(safety.notes || '')}</td></tr>
    </tbody></table>
  `;
}

function showSafetyPlanPreview() {
  const safety = getSafetyPlanData();
  showPaperPreview('Safety Plan Preview', safetyPlanHTML(safety), 'Back to Editor', "hideModal('paperPreviewModal');openSafetyPlan()");
}

function defaultPatchRows(kind) {
  if (kind === 'comms') return [{ position:'', out:'', gear:'', notes:'' }];
  return [{ label:'', destination:'', source:'', cabling:'', notes:'' }];
}

function getPatchRows(kind) {
  const data = loadPreProData();
  const key = `${kind}PatchRows`;
  return Array.isArray(data[key]) && data[key].length ? data[key] : defaultPatchRows(kind);
}

function patchInput(value, kind, row, field) {
  return `<input class="field-in" data-patch-kind="${kind}" data-patch-row="${row}" data-patch-field="${field}" value="${esc(value || '')}" placeholder="${field === 'label' ? 'Label' : field}">`;
}

function renderPatchTable(kind, title) {
  const rows = getPatchRows(kind);
  const isComms = kind === 'comms';
  const heads = isComms ? ['Position','Out','Gear','Notes'] : ['Label','Destination','Source','Cabling','Notes'];
  return `
    <div class="field">
      <label class="field-lbl">${title}</label>
      <div class="patch-table ${isComms ? 'comms' : kind}" id="${kind}-patch-table">
        ${heads.map(h => `<div class="patch-head">${h}</div>`).join('')}<div></div>
        ${rows.map((row,i) => isComms ? `
          ${patchInput(row.position, kind, i, 'position')}
          ${patchInput(row.out, kind, i, 'out')}
          ${patchInput(row.gear, kind, i, 'gear')}
          ${patchInput(row.notes, kind, i, 'notes')}
          <button class="patch-remove" onclick="removePatchRow('${kind}',${i})">x</button>
        ` : `
          ${patchInput(row.label, kind, i, 'label')}
          ${patchInput(row.destination, kind, i, 'destination')}
          ${patchInput(row.source, kind, i, 'source')}
          ${patchInput(row.cabling, kind, i, 'cabling')}
          ${patchInput(row.notes, kind, i, 'notes')}
          <button class="patch-remove" onclick="removePatchRow('${kind}',${i})">x</button>
        `).join('')}
      </div>
      <button class="call-add-btn" onclick="addPatchRow('${kind}')">+ Add row</button>
      <input class="field-in" type="file" accept=".csv,.tsv,.txt" onchange="importPatchRows('${kind}',this)" style="margin-top:8px">
    </div>`;
}

function collectPatchRows(kind, keepBlank=false) {
  const rows = [];
  document.querySelectorAll(`[data-patch-kind="${kind}"]`).forEach(input => {
    const idx = Number(input.dataset.patchRow);
    const field = input.dataset.patchField;
    if (!rows[idx]) rows[idx] = {};
    rows[idx][field] = input.value.trim();
  });
  return keepBlank ? rows.filter(Boolean) : rows.filter(row => Object.values(row).some(Boolean));
}

function savePatchRows(kind, rows) {
  persistPreProData({ [`${kind}PatchRows`]: rows.length ? rows : defaultPatchRows(kind) });
}

function openPatchSheetEditor(kind) {
  activePatchKind = kind;
  hideModal('paperworkHubModal');
  const isVideo = kind === 'video';
  document.getElementById('patchSheetTitle').textContent = isVideo ? 'Video Patch Sheet' : 'Audio and Comms Patch Sheets';
  document.getElementById('patchSheetSub').textContent = 'Add rows manually or upload a CSV/TSV. Imported columns fill left to right.';
  document.getElementById('patchSheetSaveBtn').textContent = isVideo ? 'Save Video Patch Sheet' : 'Save Audio and Comms Patch Sheets';
  document.getElementById('patchSheetBody').innerHTML = isVideo
    ? renderPatchTable('video', 'Video Patch Sheet')
    : renderPatchTable('audio', 'Audio Patch Sheet') + renderPatchTable('comms', 'Comms Patch Sheet');
  showModal('patchSheetModal');
}

function addPatchRow(kind) {
  savePatchRows(kind, collectPatchRows(kind, true).concat(defaultPatchRows(kind)));
  openPatchSheetEditor(activePatchKind || kind);
}

function removePatchRow(kind, idx) {
  const rows = collectPatchRows(kind, true);
  rows.splice(idx, 1);
  savePatchRows(kind, rows);
  openPatchSheetEditor(activePatchKind || kind);
}

function savePatchSheet() {
  if (activePatchKind === 'video') {
    savePatchRows('video', collectPatchRows('video'));
    toast('Video patch sheet saved.');
  } else {
    savePatchRows('audio', collectPatchRows('audio'));
    savePatchRows('comms', collectPatchRows('comms'));
    toast('Audio and comms patch sheets saved.');
  }
}

function importPatchRows(kind, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const lines = String(reader.result || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const rows = lines.map(line => {
      const cols = line.includes('\t') ? line.split('\t') : line.split(',');
      if (kind === 'comms') return { position:cols[0]||'', out:cols[1]||'', gear:cols[2]||'', notes:cols.slice(3).join(', ')||'' };
      return { label:cols[0]||'', destination:cols[1]||'', source:cols[2]||'', cabling:cols[3]||'', notes:cols.slice(4).join(', ')||'' };
    });
    savePatchRows(kind, rows);
    openPatchSheetEditor(activePatchKind || kind);
    toast('Patch rows imported.');
  };
  reader.readAsText(file);
}

function patchTableHTML(kind, title) {
  const rows = getPatchRows(kind).filter(row => Object.values(row).some(Boolean));
  const isComms = kind === 'comms';
  const body = rows.map(row => isComms
    ? `<tr><td>${esc(row.position || '')}</td><td>${esc(row.out || '')}</td><td>${esc(row.gear || '')}</td><td>${esc(row.notes || '')}</td></tr>`
    : `<tr><td>${esc(row.label || '')}</td><td>${esc(row.destination || '')}</td><td>${esc(row.source || '')}</td><td>${esc(row.cabling || '')}</td><td>${esc(row.notes || '')}</td></tr>`
  ).join('');
  return `<h2>${title}</h2><table><thead><tr>${isComms ? '<th>Position</th><th>Out</th><th>Gear</th><th>Notes</th>' : '<th>Label</th><th>Destination</th><th>Source</th><th>Cabling</th><th>Notes</th>'}</tr></thead><tbody>${body || `<tr><td colspan="${isComms ? 4 : 5}">No rows saved yet.</td></tr>`}</tbody></table>`;
}

function showPreProPackagePreview() {
  const data = loadPreProData();
  const safety = data.safety || {};
  const html = `
    ${callSheetPreviewHTML(data)}
    <div class="paper-page-break"></div>
    ${safetyPlanHTML(safety)}
    <div class="paper-page-break"></div>
    <h1>3. Full Rendered Rundown</h1>
    <div>${esc(show.name || 'Cueola Rundown')}</div>
    ${rundownPreviewTableHTML()}
    <div class="paper-page-break"></div>
    <h1>4. Video Patch Sheet</h1>
    ${patchTableHTML('video', 'Video Patch Sheet')}
    <div class="paper-page-break"></div>
    <h1>5. Audio and Comms Patch Sheets</h1>
    ${patchTableHTML('audio', 'Audio Patch Sheet')}
    ${patchTableHTML('comms', 'Comms Patch Sheet')}
  `;
  showPaperPreview('PDF Package Preview', html, 'Export One PDF Package', 'exportPreProPackagePDF()');
}

function openPrePro() {
  hideModal('paperworkHubModal');
  let data = loadPreProData();
  document.getElementById('pp-production').value = data.production || show.name || '';
  document.getElementById('pp-date').value = data.date || '';
  document.getElementById('pp-call').value = data.call || show.start || '';
  document.getElementById('pp-location').value = data.location || '';
  document.getElementById('pp-notes').value = data.notes || '';
  callSheetPeople = Array.isArray(data.people) && data.people.length ? data.people : [{ name:'', role:'', call:'' }];
  renderCallSheetPeople();
  showModal('preProModal');
}

function getPreProData() {
  syncCallSheetPeopleFromDOM();
  return {
    production: document.getElementById('pp-production')?.value?.trim() || show.name || '',
    date: document.getElementById('pp-date')?.value || '',
    call: document.getElementById('pp-call')?.value || '',
    location: document.getElementById('pp-location')?.value?.trim() || '',
    people: callSheetPeople,
    notes: document.getElementById('pp-notes')?.value || '',
    updatedAt: Date.now(),
  };
}

function saveCallSheet() {
  persistPreProData(getPreProData());
  toast('Call sheet saved.');
}

function savePrePro() {
  saveCallSheet();
}

function syncCallSheetPeopleFromDOM() {
  callSheetPeople = Array.from(document.querySelectorAll('.call-person-row')).map(row => ({
    name: row.querySelector('[data-call-field="name"]')?.value?.trim() || '',
    role: row.querySelector('[data-call-field="role"]')?.value?.trim() || '',
    call: row.querySelector('[data-call-field="call"]')?.value || '',
  })).filter(p => p.name || p.role || p.call);
  if (!callSheetPeople.length) callSheetPeople = [{ name:'', role:'', call:'' }];
}

function renderCallSheetPeople() {
  const grid = document.getElementById('pp-crew-grid');
  if (!grid) return;
  const rows = callSheetPeople.length ? callSheetPeople : [{ name:'', role:'', call:'' }];
  grid.innerHTML = `
    <div class="call-grid-head">Name</div>
    <div class="call-grid-head">Role</div>
    <div class="call-grid-head">Call</div>
    <div></div>
    ${rows.map((p,i)=>`
      <div class="call-person-row" style="display:contents">
        <input class="field-in" data-call-field="name" value="${esc(p.name||'')}" placeholder="Name" oninput="syncCallSheetPeopleFromDOM()">
        <input class="field-in" data-call-field="role" value="${esc(p.role||'')}" placeholder="Role" oninput="syncCallSheetPeopleFromDOM()">
        <input class="field-in" data-call-field="call" type="time" value="${esc(p.call||'')}" oninput="syncCallSheetPeopleFromDOM()">
        <button class="call-row-remove" onclick="removeCallSheetPerson(${i})" title="Remove person">x</button>
      </div>`).join('')}`;
}

function addCallSheetPerson() {
  syncCallSheetPeopleFromDOM();
  callSheetPeople.push({ name:'', role:'', call:'' });
  renderCallSheetPeople();
}

function removeCallSheetPerson(idx) {
  syncCallSheetPeopleFromDOM();
  callSheetPeople.splice(idx, 1);
  if (!callSheetPeople.length) callSheetPeople.push({ name:'', role:'', call:'' });
  renderCallSheetPeople();
}

async function downloadCallSheetPDF() {
  const data = getPreProData();
  saveCallSheet();
  try {
    await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'pt', format:'letter' });
    const margin = 42;
    const pageW = doc.internal.pageSize.getWidth();
    let y = margin;
    const add = (label, value, size=10) => {
      doc.setFont('helvetica', label ? 'bold' : 'normal');
      doc.setFontSize(size);
      const prefix = label ? `${label}: ` : '';
      const lines = doc.splitTextToSize(prefix + (value || '-'), pageW - margin * 2);
      lines.forEach(line => { doc.text(line, margin, y); y += size + 6; });
      y += label ? 2 : 8;
    };
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('CALL SHEET', margin, y);
    y += 28;
    add('Production', data.production, 12);
    add('Date', data.date, 10);
    add('Call Time', data.call, 10);
    add('Location', data.location, 10);
    y += 8;
    const people = (data.people || []).filter(p => p.name || p.role || p.call);
    add('Crew / Talent', people.map(p => [p.name, p.role, p.call].filter(Boolean).join(' - ')).join('\n'), 10);
    add('Schedule / Notes', data.notes, 10);
    const fileName = `${(data.production || 'cueola-call-sheet').replace(/[^\w\-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').toLowerCase() || 'cueola-call-sheet'}-call-sheet.pdf`;
    doc.save(fileName);
    toast('Call sheet PDF downloaded.');
  } catch {
    toast('Could not download the call sheet PDF.');
  }
}

async function exportPreProPackagePDF() {
  try {
    if (document.getElementById('preProModal')?.classList.contains('on')) persistPreProData(getPreProData());
    if (document.getElementById('safetyPlanModal')?.classList.contains('on')) persistPreProData({ safety: getSafetyPlanData() });
    if (document.getElementById('patchSheetModal')?.classList.contains('on')) savePatchSheet();
    await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'pt', format:'letter' });
    const margin = 36;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    let y = margin;
    const data = loadPreProData();
    const safety = data.safety || {};
    const cleanFileName = (data.production || show.name || 'cueola-pre-pro-package').replace(/[^\w\-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').toLowerCase() || 'cueola-pre-pro-package';
    const newPage = () => { doc.addPage(); y = margin; };
    const line = (txt, size=9, bold=false, color=[25,25,25]) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...color);
      const chunks = doc.splitTextToSize(String(txt || '-'), pageW - margin * 2);
      chunks.forEach(chunk => {
        if (y > pageH - margin) newPage();
        doc.text(chunk, margin, y);
        y += size + 5;
      });
    };
    const section = title => {
      if (y > margin + 6) newPage();
      line(title, 18, true);
      line(`Session ${session.code || 'local'} | Exported ${new Date().toLocaleString()}`, 8, false, [95,95,95]);
      y += 8;
    };
    const field = (label, value) => line(`${label}: ${value || '-'}`, 10, Boolean(label));
    const tableRows = (headers, rows) => {
      line(headers.join(' | '), 8, true, [50,70,100]);
      rows.forEach(row => line(row.map(v => v || '-').join(' | '), 8));
      y += 8;
    };

    section('1. Call Sheet');
    field('Production', data.production || show.name || '');
    field('Shoot Date', data.date || '');
    field('Call Time', data.call || '');
    field('Location', data.location || '');
    const people = (data.people || []).filter(p => p.name || p.role || p.call);
    tableRows(['Name','Role','Call'], people.length ? people.map(p => [p.name, p.role, p.call]) : [['No crew or talent entered yet','','']]);
    field('Schedule / Notes', data.notes || '');

    section('2. Safety Plan');
    ['hospital','weather','firstAid','fire','emergency','nonemergency','security','late','equipment','notes'].forEach(key => {
      const labels = { hospital:'Local Hospital', weather:'Weather', firstAid:'First Aid Kit Location', fire:'Fire Extinguisher Location', emergency:'Emergency Numbers', nonemergency:'Non-Emergency Numbers', security:'Security', late:'Late / Lost Contact', equipment:'Equipment Needed', notes:'Safety Notes' };
      field(labels[key], safety[key] || (key === 'security' ? '8822' : ''));
    });

    section('3. Full Rendered Rundown');
    let offsetSecs = 0;
    beats.forEach((b, i) => {
      const startStr = show.start ? clock(show.start, offsetSecs) : '-';
      offsetSecs += (b.min||0)*60+(b.sec||0);
      line(`${i+1}. ${b.info || '-'}`, 11, true);
      line(`${b.style === 'timed' ? 'Timed' : 'Flex'} | Start ${startStr} | Dur ${fmtDur(b)}`, 8, false, [90,90,90]);
      if (b.notes) line(`Notes: ${b.notes}`, 8);
      COL_DEFAULTS.forEach(type => {
        const d = b.cues?.[type];
        const on = getCueOn(d), off = getCueOff(d);
        const script = type === 'script' && d?.text ? cleanPrompterText(d.text) : '';
        if (!on && !off && !script) return;
        line(`${CT[type].label}: ${[on ? `ON ${on}` : '', off ? `OFF ${off}` : ''].filter(Boolean).join(' | ')}`, 8, true, [45,75,110]);
        if (script) line(script, 8);
      });
      y += 6;
    });

    section('4. Video Patch Sheet');
    tableRows(['Label','Destination','Source','Cabling','Notes'], getPatchRows('video').filter(r => Object.values(r).some(Boolean)).map(r => [r.label, r.destination, r.source, r.cabling, r.notes]));

    section('5. Audio and Comms Patch Sheets');
    line('Audio Patch Sheet', 12, true);
    tableRows(['Label','Destination','Source','Cabling','Notes'], getPatchRows('audio').filter(r => Object.values(r).some(Boolean)).map(r => [r.label, r.destination, r.source, r.cabling, r.notes]));
    line('Comms Patch Sheet', 12, true);
    tableRows(['Position','Out','Gear','Notes'], getPatchRows('comms').filter(r => Object.values(r).some(Boolean)).map(r => [r.position, r.out, r.gear, r.notes]));

    doc.save(`${cleanFileName}-pre-pro-package.pdf`);
    toast('Pre-production package PDF downloaded.');
  } catch {
    toast('Could not export the pre-production package.');
  }
}

// ─────────────────────────────────────────────────────────────
// PDF EXPORT
// ─────────────────────────────────────────────────────────────
async function exportPDF() {
  try {
    await ptLoadLibrary('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'pt', format:'letter' });
    const margin = 36;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    let y = margin;
    let offsetSecs = 0;
    const line = (txt, size=9, bold=false, color=[30,30,30]) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...color);
      const chunks = doc.splitTextToSize(String(txt || ''), pageW - margin * 2);
      chunks.forEach(chunk => {
        if (y > pageH - margin) { doc.addPage(); y = margin; }
        doc.text(chunk, margin, y);
        y += size + 4;
      });
    };
    line(show.name || 'Cueola Rundown', 18, true);
    line(`Exported ${new Date().toLocaleString()}${session.code ? ` | Session ${session.code}` : ''}`, 8, false, [90,90,90]);
    y += 8;
    beats.forEach((b, i) => {
      const startStr = show.start ? clock(show.start, offsetSecs) : '-';
      offsetSecs += (b.min||0)*60+(b.sec||0);
      line(`${i+1}. ${b.info || '-'}`, 12, true);
      line(`${b.style === 'timed' ? 'Timed' : 'Flex'} | Start ${startStr} | Dur ${fmtDur(b)}`, 8, false, [90,90,90]);
      if (b.notes) line(`Notes: ${b.notes}`, 8);
      COL_DEFAULTS.forEach(type => {
        const d = b.cues?.[type];
        const on = getCueOn(d);
        const off = getCueOff(d);
        const script = type === 'script' && d?.text ? cleanPrompterText(d.text) : '';
        if (!on && !off && !script) return;
        line(`${CT[type].label}: ${[on ? `ON ${on}` : '', off ? `OFF ${off}` : ''].filter(Boolean).join(' | ')}`, 8, true, [45,75,110]);
        if (script) line(script, 8);
      });
      y += 8;
    });
    const fileName = `${(show.name || 'cueola-rundown').replace(/[^\w\-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').toLowerCase() || 'cueola-rundown'}.pdf`;
    doc.save(fileName);
    toast('PDF downloaded.');
  } catch {
    toast('PDF library unavailable. Opening print dialog instead.');
    window.print();
  }
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
// Seed cache from localStorage immediately (best-effort, before Firebase loads)
// so the login UI is usable even on a slow connection.
_adminsCache = (() => { try { return JSON.parse(localStorage.getItem(ADMIN_KEY))||[]; } catch { return []; } })();
restoreAdminSession();
updateAdminUI();
applyTheme(currentTheme);

window.addEventListener('popstate', () => {
  const inSession =
    document.getElementById('rundown')?.classList.contains('on') ||
    document.getElementById('liveshow')?.classList.contains('on') ||
    document.getElementById('promptypus')?.classList.contains('on');
  if (!browserBackGuardReady || !inSession) return;
  if (confirm('Leave this session and return to the front page?')) {
    leaveSessionForFrontPage();
  } else {
    pushSessionHistoryState(sessionStorage.getItem('cueola_screen') || 'build');
  }
});

// Then load from Firestore (source of truth) — updates cache + restores session again
if (window._firebaseReady) initAdminsFromFirestore();
else window.addEventListener('firebaseReady', initAdminsFromFirestore, { once: true });

(function autoJoinFromDashboard() {
  const params = new URLSearchParams(window.location.search);
  if (location.hash === '#promptypus' || params.has('prompter') || params.has('promptypus')) {
    sessionStorage.setItem('cueola_screen', 'entry');
    setTimeout(enterPrompter, 0);
    return;
  }
  // Check URL param first (?code=XXXX)
  const urlCode = params.get('code');
  // Then check localStorage set by dashboard launchRundown()
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem('cueola_session') || 'null'); } catch {}
  // Clear it immediately so a refresh doesn't re-trigger
  localStorage.removeItem('cueola_session');

  const code = urlCode || stored?.code;
  if (!code) return;
  const shouldOpenPrePro = localStorage.getItem('cueola_open_prepro') === '1';
  localStorage.removeItem('cueola_open_prepro');

  const name = stored?.userName || adminSession?.name || '';
  const role = stored?.role || 'instructor';

  const doJoin = () => {
    if (name) {
      session = { code, role, userName:name, isDemo:false, isExpert:false };
      enterRundown();
      if (shouldOpenPrePro) setTimeout(openPaperworkHub, 700);
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
