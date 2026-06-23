/* ============================================================================
 * Outangutan 🦧 — web playback & cue system for Cueola.  PHASE 1: MVP playback.
 *
 * A lightweight, web-native show-playback system ("QLab/Mitti, but simpler").
 * Phase 1 delivers: an ordered cue list (Video + Audio cues), media upload to a
 * local IndexedDB store (no server exists — local-first survives a bad network),
 * transport (GO / Stop / Pause-Resume) with pre-wait + continue modes, a big
 * count-out clock, one chrome-free output window, keyboard-first control, the
 * non-negotiable safety controls (All-Stop / Panic, Fade & Stop All), and
 * autosave + crash recovery.
 *
 * Same stack as the rest of Cueola: vanilla JS global script, theme tokens, the
 * `enterX()` screen pattern. Self-contained in /outangutan to keep the 12k-line
 * cueola-app.js untouched (Phase 1 changes it zero times).
 *
 * Build for Chromium (Chrome/Edge) first; degrade gracefully elsewhere.
 * ==========================================================================*/
(function () {
  'use strict';

  // ── constants ──────────────────────────────────────────────────────────
  const DB_NAME = 'outangutan', DB_VER = 1;
  const MEDIA_STORE = 'media', SHOW_STORE = 'show', SHOW_KEY = 'current';
  const OUTPUT_CHANNEL = 'outangutan-output';
  const SCHEMA = 1;

  const DEFAULT_SHORTCUTS = { go: ' ', stop: 's', pause: 'p', panic: 'Escape', fadeStop: 'f' };

  // ── state ──────────────────────────────────────────────────────────────
  let built = false;
  let mode = 'standalone';
  let sessionCode = null;        // bound when joining in session mode; scopes the saved show
  let cues = [];                 // [{ id, num, name, type, mediaId, color, preWait, continueMode, duration, thumb, trimIn, trimOut, volume, loop, armed, notes }]
  let selectedId = null;         // doubles as the standby cue (next to GO)
  let settings = { clockMode: 'remaining', multiTrigger: true, showLock: false, shortcuts: Object.assign({}, DEFAULT_SHORTCUTS) };

  let active = null;             // { cue, kind:'video'|'audio', el, url } — the running program cue
  let preTimer = null;           // pre-wait timeout
  let preInfo = null;            // { cue, until } during pre-wait countdown
  let rafId = null;
  let saveTimer = null;
  let bc = null;
  let outputWin = null;
  let outputAlive = false;
  let identifyOn = false;

  // ── tiny helpers ───────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const rid = (p) => p + Math.random().toString(36).slice(2, 9);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function toast(msg) { try { if (typeof window.toast === 'function') return window.toast(msg); } catch (e) {} console.log('[outangutan]', msg); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function fmtClock(sec) {
    sec = Math.max(0, sec || 0);
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  function keyLabel(k) { return k === ' ' ? 'Space' : (k === 'Escape' ? 'Esc' : k.toUpperCase()); }
  // SF Symbol markup — reuse Cueola's icon library (assets/sf-symbols.css) so every
  // affordance matches the rest of the app. Falls back to a bare span if sfIcon is absent.
  function sym(name, cls) { try { if (typeof window.sfIcon === 'function') return window.sfIcon(name, cls || ''); } catch (e) {} return '<span class="sf-symbol ' + (cls || '') + '" data-symbol="' + name + '" aria-hidden="true"></span>'; }

  // ── IndexedDB ──────────────────────────────────────────────────────────
  function openDB() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
        if (!db.objectStoreNames.contains(SHOW_STORE)) db.createObjectStore(SHOW_STORE);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbPut(store, key, val) {
    const db = await openDB();
    return new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }
  async function idbGet(store, key) {
    const db = await openDB();
    return new Promise((res) => { const t = db.transaction(store, 'readonly').objectStore(store).get(key); t.onsuccess = () => res(t.result); t.onerror = () => res(null); });
  }
  async function idbDel(store, key) {
    const db = await openDB();
    return new Promise((res) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete = res; tx.onerror = res; });
  }

  // ── media import ───────────────────────────────────────────────────────
  function probeMedia(blob, kind) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
      el.preload = 'metadata'; el.muted = true; el.src = url;
      const done = (duration, thumb) => { URL.revokeObjectURL(url); resolve({ duration: duration || 0, thumb: thumb || null }); };
      el.onloadedmetadata = () => {
        const duration = isFinite(el.duration) ? el.duration : 0;
        if (kind !== 'video') return done(duration, null);
        // grab a thumbnail frame ~10% in
        const t = Math.min(Math.max(0.1, duration * 0.1), Math.max(0.1, duration - 0.05));
        el.onseeked = () => {
          try {
            const c = document.createElement('canvas');
            const w = 160, h = Math.max(1, Math.round(w * (el.videoHeight || 9) / (el.videoWidth || 16)));
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(el, 0, 0, w, h);
            done(duration, c.toDataURL('image/jpeg', 0.6));
          } catch (e) { done(duration, null); }
        };
        try { el.currentTime = t; } catch (e) { done(duration, null); }
      };
      el.onerror = () => done(0, null);
    });
  }

  async function importFiles(fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    let added = 0;
    for (const file of files) {
      const kind = file.type.startsWith('video') ? 'video' : (file.type.startsWith('audio') ? 'audio' : null);
      if (!kind) { toast('Skipped "' + file.name + '" — not a video or audio file.'); continue; }
      const mediaId = rid('m_');
      const blob = file.slice(0, file.size, file.type);
      try {
        const probe = await probeMedia(blob, kind);
        await idbPut(MEDIA_STORE, mediaId, { blob, name: file.name, mime: file.type, kind, duration: probe.duration, thumb: probe.thumb });
        cues.push(makeCue({ name: file.name.replace(/\.[^.]+$/, ''), type: kind, mediaId, duration: probe.duration, thumb: probe.thumb }));
        added++;
      } catch (e) { toast('Could not import "' + file.name + '".'); }
    }
    if (added) { if (!selectedId) selectedId = cues[0].id; renumber(); renderAll(); scheduleSave(); toast(added + ' cue' + (added > 1 ? 's' : '') + ' added.'); }
  }

  function makeCue(o) {
    return {
      id: rid('c_'), num: 0, name: o.name || 'Untitled', type: o.type || 'video',
      mediaId: o.mediaId || null, color: o.type === 'audio' ? 'var(--green)' : 'var(--video)',
      preWait: 0, continueMode: 'manual', duration: o.duration || 0, thumb: o.thumb || null,
      trimIn: 0, trimOut: null, volume: 1, loop: false, armed: true, notes: '',
    };
  }
  function renumber() { cues.forEach((c, i) => { c.num = i + 1; }); }
  function cueById(id) { return cues.find(c => c.id === id) || null; }
  function cueIndex(id) { return cues.findIndex(c => c.id === id); }
  function nextArmedAfter(id) {
    let i = cueIndex(id);
    for (let j = i + 1; j < cues.length; j++) if (cues[j].armed !== false) return cues[j].id;
    return null;
  }

  // ── output window ──────────────────────────────────────────────────────
  function ensureChannel() {
    if (bc || !('BroadcastChannel' in window)) return;
    bc = new BroadcastChannel(OUTPUT_CHANNEL);
    bc.onmessage = (e) => {
      const m = e.data; if (!m || m._from !== 'output') return;
      if (m.t === 'ready' || m.t === 'pong') { outputAlive = true; updateOutputBtn(); if (active && active.kind === 'video') resendActiveToOutput(); }
      if (m.t === 'closed') { outputAlive = false; updateOutputBtn(); }
    };
  }
  function sendOut(msg) { ensureChannel(); if (bc) bc.postMessage(Object.assign({ _from: 'control' }, msg)); }
  function openOutput() {
    ensureChannel();
    outputWin = window.open('outangutan/output.html', 'outangutanOutput', 'width=1280,height=720');
    if (!outputWin) { toast('Output window blocked — allow pop-ups for Outangutan.'); return; }
    toast('Output window opened. Drag it to your second display, then fullscreen it.');
    setTimeout(() => sendOut({ t: 'ping' }), 600);
  }
  function resendActiveToOutput() {
    if (!active || active.kind !== 'video') return;
    sendOut({ t: 'play', mediaId: active.cue.mediaId, at: active.el.currentTime, loop: active.cue.loop, volume: active.cue.volume });
  }
  function toggleIdentify() {
    if (!outputWin || outputWin.closed) { openOutput(); setTimeout(toggleIdentify, 700); return; }
    identifyOn = !identifyOn; sendOut({ t: 'identify', on: identifyOn, label: 'Output 1' }); updateOutputBtn();
  }
  function updateOutputBtn() {
    const b = $('og-output-btn'); if (b) b.classList.toggle('on', !!(outputWin && !outputWin.closed));
    const i = $('og-identify-btn'); if (i) i.classList.toggle('on', identifyOn);
  }

  // ── transport ──────────────────────────────────────────────────────────
  function getEl(kind) {
    if (kind === 'audio') return $('og-audio');
    return $('og-program');
  }
  function clearPre() { if (preTimer) { clearTimeout(preTimer); preTimer = null; } preInfo = null; }

  function stopActiveMedia() {
    if (active && active.el) {
      try { active.el.pause(); } catch (e) {}
      active.el.onended = null; active.el.ontimeupdate = null; active.el.onplay = null;
      if (active.url) { try { URL.revokeObjectURL(active.url); } catch (e) {} }
    }
    active = null;
  }

  function go() {
    let cue = cueById(selectedId);
    if (!cue) { cue = cues.find(c => c.armed !== false); if (cue) selectedId = cue.id; }
    if (!cue) { toast('No cue to fire. Add media first.'); return; }
    const next = nextArmedAfter(cue.id);
    fireCue(cue);
    selectedId = next || selectedId;   // advance standby
    renderCueList(); renderInspector();
  }

  function fireCue(cue) {
    clearPre();
    stopActiveMedia();
    if (cue.preWait > 0) {
      setStatus('pre');
      preInfo = { cue, until: performance.now() + cue.preWait * 1000 };
      preTimer = setTimeout(() => { preInfo = null; beginMedia(cue); }, cue.preWait * 1000);
      startTicker();
      renderCueList();
      return;
    }
    beginMedia(cue);
  }

  async function beginMedia(cue) {
    const media = await idbGet(MEDIA_STORE, cue.mediaId);
    if (!media || !media.blob) { toast('Media missing for "' + cue.name + '".'); setStatus('idle'); return; }
    const kind = cue.type === 'audio' ? 'audio' : 'video';
    const el = getEl(kind);
    const url = URL.createObjectURL(media.blob);
    el.src = url; el.loop = !!cue.loop; el.volume = clamp(cue.volume, 0, 1);
    active = { cue, kind, el, url };
    el.onplay = () => { if (cue.continueMode === 'auto_continue') setTimeout(() => autoFrom(cue), 60); };
    el.ontimeupdate = () => { if (cue.trimOut != null && el.currentTime >= cue.trimOut) handleEnded(cue); };
    el.onended = () => { if (!el.loop) handleEnded(cue); };
    try { el.currentTime = cue.trimIn || 0; } catch (e) {}
    try { await el.play(); } catch (e) { toast('Playback blocked — click GO again.'); }
    setStatus('play'); startTicker(); renderCueList();
    if (kind === 'video') sendOut({ t: 'play', mediaId: cue.mediaId, at: cue.trimIn || 0, loop: cue.loop, volume: cue.volume });
  }

  function autoFrom(cue) {        // fire the next armed cue (auto-continue / auto-follow shared)
    const nextId = nextArmedAfter(cue.id);
    const next = cueById(nextId);
    if (!next) return;
    selectedId = nextArmedAfter(next.id) || nextId;
    fireCue(next);
    renderCueList(); renderInspector();
  }
  function handleEnded(cue) {
    const mode2 = cue.continueMode;
    stopActiveMedia();
    if (mode2 === 'auto_follow') { autoFrom(cue); return; }
    setStatus('idle'); sendOut({ t: 'stop' }); renderCueList();
  }

  function stopAll(opts) {        // Stop (S): graceful all-stop
    clearPre(); stopActiveMedia();
    setStatus('idle'); sendOut({ t: 'stop' });
    renderCueList();
    if (!opts || !opts.silent) toast('Stopped.');
  }
  function panic() {              // Esc: hard all-stop, no fades, instant
    clearPre();
    ['og-program', 'og-audio'].forEach(idv => { const el = $(idv); if (el) { try { el.pause(); } catch (e) {} el.removeAttribute('src'); try { el.load(); } catch (e) {} } });
    stopActiveMedia();
    setStatus('idle'); sendOut({ t: 'stop' });
    renderCueList(); toast('PANIC — all stopped.');
  }
  function pauseResume() {
    if (!active || !active.el) { if (preInfo) { stopAll(); } return; }
    if (active.el.paused) { active.el.play(); setStatus('play'); sendOut({ t: 'resume' }); }
    else { active.el.pause(); setStatus('pause'); sendOut({ t: 'pause' }); }
    renderCueList();
  }
  function fadeStopAll() {        // F: fade out then stop
    const ms = 800;
    sendOut({ t: 'fade', to: 0, ms });
    if (active && active.el) {
      const el = active.el, from = el.volume, t0 = performance.now();
      (function step(t) {
        const k = Math.min(1, (t - t0) / ms); el.volume = Math.max(0, from * (1 - k));
        if (k < 1) requestAnimationFrame(step); else stopAll({ silent: true });
      })(t0);
      toast('Fading out…');
    } else { stopAll(); }
  }

  function setStatus(s) {
    const tag = $('og-program-status');
    if (tag) {
      tag.className = 'og-program-status og-status-' + (s === 'play' ? 'play' : s === 'pre' ? 'pre' : s === 'pause' ? 'pause' : 'idle');
      tag.textContent = s === 'play' ? 'ON AIR' : s === 'pre' ? 'PRE-WAIT' : s === 'pause' ? 'PAUSED' : 'IDLE';
    }
  }

  // ── count-out clock + ticker ─────────────────────────────────────────────
  function startTicker() { if (rafId) return; const loop = () => { renderClock(); rafId = requestAnimationFrame(loop); }; rafId = requestAnimationFrame(loop); }
  function stopTicker() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }

  function renderClock() {
    const timeEl = $('og-clock-time'), labelEl = $('og-clock-label'), cueEl = $('og-clock-cue'), wrap = $('og-clock');
    if (!timeEl) return;
    if (preInfo) {
      const remain = Math.max(0, (preInfo.until - performance.now()) / 1000);
      timeEl.textContent = fmtClock(remain); labelEl.textContent = 'PRE-WAIT · ' + esc(preInfo.cue.name);
      cueEl.textContent = ''; wrap.className = 'og-clock warn'; return;
    }
    if (active && active.el && !active.el.paused) {
      const el = active.el, end = (active.cue.trimOut != null ? active.cue.trimOut : (isFinite(el.duration) ? el.duration : active.cue.duration));
      const elapsed = el.currentTime - (active.cue.trimIn || 0);
      const remain = Math.max(0, end - el.currentTime);
      const show = settings.clockMode === 'elapsed' ? Math.max(0, elapsed) : remain;
      timeEl.textContent = fmtClock(show);
      labelEl.textContent = settings.clockMode === 'elapsed' ? 'ELAPSED' : 'REMAINING';
      cueEl.textContent = active.cue.name;
      wrap.className = 'og-clock ' + (remain <= 10 ? 'warn' : 'run');
      return;
    }
    // idle / paused → preview selected cue duration; stop the rAF loop when fully idle
    const sel = cueById(selectedId);
    if (active && active.el && active.el.paused) {
      const remain = Math.max(0, ((active.cue.trimOut != null ? active.cue.trimOut : active.el.duration) || 0) - active.el.currentTime);
      timeEl.textContent = fmtClock(remain); labelEl.textContent = 'PAUSED'; cueEl.textContent = active.cue.name; wrap.className = 'og-clock warn';
      return;
    }
    timeEl.textContent = fmtClock(sel ? sel.duration : 0);
    labelEl.textContent = sel ? 'DURATION' : 'STANDBY';
    cueEl.textContent = sel ? sel.name : '—';
    wrap.className = 'og-clock';
    if (!active && !preInfo) stopTicker();
  }

  // ── rendering ────────────────────────────────────────────────────────────
  function renderAll() { renderCueList(); renderInspector(); renderClock(); }

  function renderCueList() {
    const wrap = $('og-cuelist'); if (!wrap) return;
    if (!cues.length) { wrap.innerHTML = '<div class="og-cue-empty">No cues yet.<br>Drop a video or audio file below, or click “Add media”.</div>'; return; }
    const playingId = active ? active.cue.id : (preInfo ? preInfo.cue.id : null);
    wrap.innerHTML = cues.map(c => {
      const cls = ['og-cue']; if (c.id === selectedId) cls.push('selected'); if (c.id === playingId) cls.push('playing'); if (c.armed === false) cls.push('armed-off');
      const cont = c.continueMode === 'auto_follow' ? 'FOLLOW' : c.continueMode === 'auto_continue' ? 'CONT' : '';
      return '<div class="' + cls.join(' ') + '" data-id="' + c.id + '">'
        + '<span class="og-cue-color-dot" style="background:' + c.color + '"></span>'
        + '<span class="og-cue-num">' + c.num + '</span>'
        + '<span class="og-cue-typeicon og-type-' + c.type + '">' + sym(c.type === 'audio' ? 'department.audio' : 'department.video') + '</span>'
        + '<span class="og-cue-name">' + esc(c.name) + '</span>'
        + '<span class="og-cue-meta">' + (cont ? '<span class="og-cue-cont">' + cont + '</span>' : '') + (c.preWait > 0 ? '<span class="og-cue-cont">' + sym('state.timed') + c.preWait + 's</span>' : '') + '<span>' + fmtClock(c.duration) + '</span></span>'
        + '</div>';
    }).join('');
    Array.prototype.forEach.call(wrap.querySelectorAll('.og-cue'), el => {
      el.onclick = () => { selectedId = el.getAttribute('data-id'); renderCueList(); renderInspector(); if (!active && !preInfo) renderClock(); };
      el.ondblclick = () => { selectedId = el.getAttribute('data-id'); go(); };
    });
  }

  function renderInspector() {
    const ins = $('og-inspector'); if (!ins) return;
    const c = cueById(selectedId);
    if (!c) { ins.innerHTML = '<div class="og-insp-empty">Select a cue to edit its properties.</div>'; return; }
    ins.innerHTML =
      field('Name', '<input id="og-i-name" type="text" value="' + esc(c.name) + '">') +
      '<div class="og-field-row">' +
        field('Pre-wait (s)', '<input id="og-i-prewait" type="number" min="0" step="0.5" value="' + c.preWait + '">') +
        field('Volume', '<input id="og-i-volume" type="range" min="0" max="1" step="0.01" value="' + c.volume + '">') +
      '</div>' +
      field('Continue mode', '<select id="og-i-continue">' +
        opt('manual', 'Manual (operator fires next)', c.continueMode) +
        opt('auto_continue', 'Auto-continue (on start)', c.continueMode) +
        opt('auto_follow', 'Auto-follow (on end)', c.continueMode) + '</select>') +
      '<div class="og-field-row">' +
        field('Trim in (s)', '<input id="og-i-trimin" type="number" min="0" step="0.1" value="' + (c.trimIn || 0) + '">') +
        field('Trim out (s)', '<input id="og-i-trimout" type="number" min="0" step="0.1" value="' + (c.trimOut == null ? '' : c.trimOut) + '" placeholder="end">') +
      '</div>' +
      '<div class="og-field-row">' +
        field('Loop', '<select id="og-i-loop">' + opt('0', 'No', c.loop ? '1' : '0') + opt('1', 'Yes', c.loop ? '1' : '0') + '</select>') +
        field('Armed', '<select id="og-i-armed">' + opt('1', 'Armed', c.armed === false ? '0' : '1') + opt('0', 'Disarmed', c.armed === false ? '0' : '1') + '</select>') +
      '</div>' +
      field('Color', '<div class="og-swatches">' + ['var(--video)', 'var(--green)', 'var(--red)', 'var(--yellow)', 'var(--purple)', 'var(--cyan)'].map(col =>
        '<button class="og-swatch' + (c.color === col ? ' sel' : '') + '" data-col="' + col + '" style="background:' + col + '" aria-label="Set cue color"></button>').join('') + '</div>') +
      field('Notes', '<input id="og-i-notes" type="text" value="' + esc(c.notes || '') + '">') +
      '<button class="og-cue-del" id="og-i-del">' + sym('action.delete') + ' Delete cue</button>';

    const bind = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
    bind('og-i-name', 'oninput', e => { c.name = e.target.value; renderCueList(); scheduleSave(); });
    bind('og-i-prewait', 'onchange', e => { c.preWait = Math.max(0, parseFloat(e.target.value) || 0); renderCueList(); scheduleSave(); });
    bind('og-i-volume', 'oninput', e => { c.volume = clamp(parseFloat(e.target.value), 0, 1); if (active && active.cue.id === c.id) { active.el.volume = c.volume; sendOut({ t: 'volume', v: c.volume }); } scheduleSave(); });
    bind('og-i-continue', 'onchange', e => { c.continueMode = e.target.value; renderCueList(); scheduleSave(); });
    bind('og-i-trimin', 'onchange', e => { c.trimIn = Math.max(0, parseFloat(e.target.value) || 0); scheduleSave(); });
    bind('og-i-trimout', 'onchange', e => { const v = parseFloat(e.target.value); c.trimOut = isNaN(v) ? null : v; scheduleSave(); });
    bind('og-i-loop', 'onchange', e => { c.loop = e.target.value === '1'; if (active && active.cue.id === c.id) active.el.loop = c.loop; scheduleSave(); });
    bind('og-i-armed', 'onchange', e => { c.armed = e.target.value === '1'; renderCueList(); scheduleSave(); });
    bind('og-i-notes', 'oninput', e => { c.notes = e.target.value; scheduleSave(); });
    bind('og-i-del', 'onclick', () => { deleteCue(c.id); });
    Array.prototype.forEach.call(ins.querySelectorAll('.og-swatch'), sw => { sw.onclick = () => { c.color = sw.getAttribute('data-col'); renderCueList(); renderInspector(); scheduleSave(); }; });
  }
  function field(label, inner) { return '<div class="og-field"><label>' + label + '</label>' + inner + '</div>'; }
  function opt(val, label, cur) { return '<option value="' + val + '"' + (String(cur) === String(val) ? ' selected' : '') + '>' + label + '</option>'; }

  async function deleteCue(id) {
    const c = cueById(id); if (!c) return;
    if (active && active.cue.id === id) stopAll({ silent: true });
    if (c.mediaId && !cues.some(x => x !== c && x.mediaId === c.mediaId)) await idbDel(MEDIA_STORE, c.mediaId);
    cues = cues.filter(x => x.id !== id);
    if (selectedId === id) selectedId = cues.length ? cues[0].id : null;
    renumber(); renderAll(); scheduleSave();
  }

  // ── autosave + recovery ──────────────────────────────────────────────────
  function showKey() { return SHOW_KEY + (sessionCode ? '_' + sessionCode : ''); } // per-session scope; standalone = 'current'
  function scheduleSave() { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(saveShow, 500); }
  async function saveShow() {
    saveTimer = null;
    try { await idbPut(SHOW_STORE, showKey(), { schema: SCHEMA, savedAt: Date.now(), activeCueId: active ? active.cue.id : null, cues, selectedId, settings }); } catch (e) {}
  }
  async function loadShow() {
    const s = await idbGet(SHOW_STORE, showKey());
    if (!s || !Array.isArray(s.cues)) return null;
    cues = s.cues; selectedId = s.selectedId || (cues[0] && cues[0].id) || null;
    settings = Object.assign({ clockMode: 'remaining', multiTrigger: true, showLock: false, shortcuts: Object.assign({}, DEFAULT_SHORTCUTS) }, s.settings || {});
    settings.shortcuts = Object.assign({}, DEFAULT_SHORTCUTS, settings.shortcuts || {});
    renumber();
    return s;
  }
  function showRecovery(s) {
    const bar = $('og-recovery'); if (!bar) return;
    const wasPlaying = s && s.activeCueId && cueById(s.activeCueId);
    if (!s || !cues.length) { bar.classList.remove('on'); return; }
    const cw = cues.length + ' cue' + (cues.length === 1 ? '' : 's');
    $('og-recovery-text').textContent = wasPlaying
      ? 'Recovered ' + cw + '. The show was mid-playback (“' + wasPlaying.name + '”) when it stopped.'
      : 'Recovered your previous show — ' + cw + '.';
    const standbyBtn = $('og-recovery-standby');
    standbyBtn.style.display = wasPlaying ? '' : 'none';
    standbyBtn.onclick = () => { selectedId = s.activeCueId; renderAll(); bar.classList.remove('on'); };
    bar.classList.add('on');
  }

  // ── keyboard ─────────────────────────────────────────────────────────────
  function typingTarget(e) { const t = e.target; return t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable); }
  function onKey(e) {
    if (!isOpen()) return;
    if ($('og-help').classList.contains('on')) { if (e.key === 'Escape') closeHelp(); return; }
    if ($('og-join') && $('og-join').classList.contains('on')) return; // join sheet owns its keys
    if (typingTarget(e)) return;
    const sc = settings.shortcuts;
    const k = e.key;
    const match = (bound) => bound && (bound.length === 1 ? k.toLowerCase() === bound.toLowerCase() : k === bound);
    if (match(sc.go)) { e.preventDefault(); if (!e.repeat) go(); return; }
    if (k === sc.panic) { e.preventDefault(); panic(); return; }   // panic default Escape
    if (e.repeat) return;
    if (match(sc.stop)) { e.preventDefault(); stopAll(); return; }
    if (match(sc.pause)) { e.preventDefault(); pauseResume(); return; }
    if (match(sc.fadeStop)) { e.preventDefault(); fadeStopAll(); return; }
    if (k === 'ArrowDown') { e.preventDefault(); moveSelection(1); return; }
    if (k === 'ArrowUp') { e.preventDefault(); moveSelection(-1); return; }
  }
  function moveSelection(d) {
    if (!cues.length) return;
    let i = cueIndex(selectedId); i = clamp((i < 0 ? 0 : i) + d, 0, cues.length - 1);
    selectedId = cues[i].id; renderCueList(); renderInspector(); if (!active && !preInfo) renderClock();
  }

  // ── help / shortcut editor ───────────────────────────────────────────────
  function openHelp() {
    const body = $('og-help-rows');
    const rows = [['go', 'GO (fire standby)'], ['stop', 'Stop'], ['pause', 'Pause / Resume'], ['panic', 'PANIC / All-Stop'], ['fadeStop', 'Fade & Stop All']];
    body.innerHTML = rows.map(([key, label]) =>
      '<div class="og-help-row"><span>' + label + '</span><input data-sc="' + key + '" value="' + esc(keyLabel(settings.shortcuts[key])) + '" readonly></div>'
    ).join('') + '<div class="og-help-row" style="border:none;color:var(--text2)"><span>Select prev / next</span><span>↑ / ↓ (fixed)</span></div>';
    Array.prototype.forEach.call(body.querySelectorAll('input[data-sc]'), inp => {
      inp.onkeydown = (ev) => {
        ev.preventDefault();
        const key = inp.getAttribute('data-sc');
        const v = ev.key === ' ' ? ' ' : ev.key;
        settings.shortcuts[key] = v; inp.value = keyLabel(v); renderFoot(); scheduleSave();
      };
      inp.onfocus = () => { inp.value = 'press a key…'; };
      inp.onblur = () => { inp.value = keyLabel(settings.shortcuts[inp.getAttribute('data-sc')]); };
    });
    $('og-help').classList.add('on');
  }
  function closeHelp() { $('og-help').classList.remove('on'); }

  // ── lock / settings toggles ──────────────────────────────────────────────
  function toggleLock() { settings.showLock = !settings.showLock; $('outangutan').classList.toggle('locked', settings.showLock); $('og-lock-btn').classList.toggle('on', settings.showLock); toast(settings.showLock ? 'Show mode locked — edits disabled.' : 'Show mode unlocked.'); scheduleSave(); }

  function renderFoot() {
    const f = $('og-foot-keys'); if (!f) return;
    const sc = settings.shortcuts;
    f.innerHTML = '<span class="og-kbd">' + keyLabel(sc.go) + '</span> GO · '
      + '<span class="og-kbd">' + keyLabel(sc.stop) + '</span> Stop · '
      + '<span class="og-kbd">' + keyLabel(sc.pause) + '</span> Pause · '
      + '<span class="og-kbd">' + keyLabel(sc.fadeStop) + '</span> Fade·Stop · '
      + '<span class="og-kbd">' + keyLabel(sc.panic) + '</span> PANIC';
  }

  // ── DOM build ────────────────────────────────────────────────────────────
  function build() {
    const root = $('outangutan'); if (!root || built) return;
    root.innerHTML =
      '<div class="og-bar">'
        + '<button class="og-back" id="og-back">' + sym('action.back') + '<span>Cueola</span></button>'
        + '<div class="og-title"><span class="og-glyph">🦧</span>Out<span class="og-wm-hi">angutan</span></div>'
        + '<span class="og-mode-badge" id="og-mode-badge">Standalone</span>'
        + '<div class="og-bar-spacer"></div>'
        + '<button class="og-bar-btn" id="og-output-btn" title="Open / focus the output window">' + sym('content.display') + 'Output Window</button>'
        + '<button class="og-bar-btn" id="og-identify-btn" title="Show identify pattern on output">' + sym('action.grid') + 'Identify</button>'
        + '<button class="og-bar-btn" id="og-lock-btn" title="Lock edits during the show">Show Lock</button>'
        + '<button class="og-bar-btn" id="og-help-btn" title="Keyboard shortcuts">' + sym('action.guide') + 'Shortcuts</button>'
      + '</div>'
      + '<div class="og-recovery" id="og-recovery"><span id="og-recovery-text"></span><div class="og-bar-spacer"></div>'
        + '<button id="og-recovery-standby">Standby that cue</button>'
        + '<button id="og-recovery-dismiss">Dismiss</button></div>'
      + '<div class="og-main">'
        + '<div class="og-pane og-cuelist-pane">'
          + '<div class="og-pane-head">Cue List<div class="og-pane-actions"><button class="og-bar-btn" id="og-add-btn">Add media</button></div></div>'
          + '<div class="og-cuelist" id="og-cuelist"></div>'
          + '<button class="og-cue-add" id="og-cue-add">Drop video / audio here, or click to add</button>'
          + '<input type="file" id="og-file-input" accept="video/*,audio/*" multiple hidden>'
        + '</div>'
        + '<div class="og-pane og-program-pane">'
          + '<div class="og-pane-head">Program<div class="og-pane-actions"><span class="og-wallclock" id="og-wallclock" title="Time of day">' + sym('state.timed') + '<span id="og-wallclock-t">--:--:--</span></span></div></div>'
          + '<div class="og-program-wrap"><span class="og-program-tag">PROGRAM</span><span class="og-program-status og-status-idle" id="og-program-status">IDLE</span><video id="og-program" playsinline></video></div>'
          + '<div class="og-clock" id="og-clock"><div class="og-clock-time" id="og-clock-time">0:00</div><div class="og-clock-label" id="og-clock-label">STANDBY</div><div class="og-clock-cue" id="og-clock-cue">—</div></div>'
          + '<div class="og-transport">'
            + '<button class="og-tbtn" id="og-stop">' + sym('media.stop') + 'Stop<span class="og-tbtn-key" id="og-k-stop"></span></button>'
            + '<button class="og-tbtn og-tbtn-go" id="og-go">' + sym('media.play') + 'GO<span class="og-tbtn-key" id="og-k-go"></span></button>'
            + '<button class="og-tbtn" id="og-pause">' + sym('media.pause') + 'Pause<span class="og-tbtn-key" id="og-k-pause"></span></button>'
            + '<button class="og-tbtn" id="og-fade">' + sym('action.down') + 'Fade·Stop<span class="og-tbtn-key" id="og-k-fade"></span></button>'
            + '<button class="og-tbtn og-tbtn-panic" id="og-panic">' + sym('action.power') + 'PANIC<span class="og-tbtn-key" id="og-k-panic"></span></button>'
          + '</div>'
        + '</div>'
        + '<div class="og-pane og-inspector-pane">'
          + '<div class="og-pane-head">Inspector</div>'
          + '<div class="og-inspector" id="og-inspector"></div>'
        + '</div>'
      + '</div>'
      + '<div class="og-foot"><span id="og-foot-keys"></span><div class="og-foot-spacer"></div><span id="og-foot-mode">Local-first · IndexedDB</span></div>'
      + '<audio id="og-audio"></audio>'
      + '<div class="og-help" id="og-help"><div class="og-help-card"><h3>Keyboard shortcuts</h3><div id="og-help-rows"></div>'
        + '<p style="color:var(--text2);font-size:12px;margin:12px 0 0">Click a field and press a key to rebind. GO and PANIC are always reachable by keyboard.</p>'
        + '<button class="og-help-close" id="og-help-close">Done</button></div></div>'
      + '<div class="og-join" id="og-join"><div class="og-join-card">'
        + '<div class="og-join-glyph">🦧</div>'
        + '<h3>Join a session</h3>'
        + '<p>Enter your show’s session code to tie Outangutan to it — the same code Cueola, Planda Bear, and Flowmingo use. Live cross-device cue sync arrives in Phase 4; for now your cue list is saved under this code on this device.</p>'
        + '<input id="og-join-code" placeholder="SESSION CODE" autocomplete="off" autocapitalize="characters" spellcheck="false">'
        + '<div class="og-join-err" id="og-join-err"></div>'
        + '<button class="og-join-go" id="og-join-go">Join Session</button>'
        + '<button class="og-join-skip" id="og-join-skip">Continue without a session</button>'
      + '</div></div>';

    // wire static controls
    $('og-back').onclick = exitOutangutan;
    $('og-output-btn').onclick = () => { if (outputWin && !outputWin.closed) outputWin.focus(); else openOutput(); };
    $('og-identify-btn').onclick = toggleIdentify;
    $('og-lock-btn').onclick = toggleLock;
    $('og-help-btn').onclick = openHelp;
    $('og-help-close').onclick = closeHelp;
    $('og-join-go').onclick = joinSession;
    $('og-join-skip').onclick = joinStandaloneInstead;
    $('og-join-code').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); joinSession(); }
      else if (e.key === 'Escape') { e.preventDefault(); joinStandaloneInstead(); }
    });
    $('og-go').onclick = go;
    $('og-stop').onclick = () => stopAll();
    $('og-pause').onclick = pauseResume;
    $('og-fade').onclick = fadeStopAll;
    $('og-panic').onclick = panic;
    $('og-clock').onclick = () => { settings.clockMode = settings.clockMode === 'remaining' ? 'elapsed' : 'remaining'; renderClock(); scheduleSave(); };
    $('og-recovery-dismiss').onclick = () => $('og-recovery').classList.remove('on');

    const fileInput = $('og-file-input');
    $('og-add-btn').onclick = () => fileInput.click();
    $('og-cue-add').onclick = () => fileInput.click();
    fileInput.onchange = () => { importFiles(fileInput.files); fileInput.value = ''; };

    // drag & drop onto the cue pane
    const dropZone = $('og-cue-add'), listPane = root.querySelector('.og-cuelist-pane');
    ['dragenter', 'dragover'].forEach(ev => listPane.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => listPane.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === listPane) dropZone.classList.remove('drag'); }));
    listPane.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });

    // program element drives clock + continue when it's the active video
    const prog = $('og-program');
    prog.addEventListener('ended', () => { if (active && active.kind === 'video' && !prog.loop) handleEnded(active.cue); });

    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', () => { if (cues.length) saveShow(); });

    built = true;
    renderTransportKeys();

    // wall clock — ticks once a second, only paints while the screen is open
    const pad2 = n => String(n).padStart(2, '0');
    setInterval(() => {
      const t = $('og-wallclock-t'); if (!t || !isOpen()) return;
      const d = new Date(); t.textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    }, 1000);
  }

  function renderTransportKeys() {
    const sc = settings.shortcuts;
    const set = (id, k) => { const el = $(id); if (el) el.textContent = keyLabel(k); };
    set('og-k-go', sc.go); set('og-k-stop', sc.stop); set('og-k-pause', sc.pause); set('og-k-fade', sc.fadeStop); set('og-k-panic', sc.panic);
    renderFoot();
  }

  // ── screen nav ───────────────────────────────────────────────────────────
  function isOpen() { const el = $('outangutan'); return el && el.classList.contains('on'); }
  function setModeBadge() { const b = $('og-mode-badge'); if (b) b.textContent = (mode === 'session' && sessionCode) ? ('Session · ' + sessionCode) : 'Standalone'; }

  function showScreen() {
    ['entry', 'rundown', 'liveshow', 'promptypus', 'flowOp'].forEach(s => { const el = $(s); if (el) el.classList.remove('on'); });
    $('outangutan').classList.add('on');
    try { if (typeof window.pushSessionHistoryState === 'function') window.pushSessionHistoryState('outangutan'); } catch (e) {}
    $('outangutan').classList.toggle('locked', settings.showLock);
    $('og-lock-btn').classList.toggle('on', settings.showLock);
  }
  async function applyShow() {
    const s = await loadShow();
    renderTransportKeys();
    renderAll();
    if (s) showRecovery(s); else $('og-recovery').classList.remove('on');
    setModeBadge();
  }

  async function enterOutangutan(m) {
    build();
    ensureChannel();
    showScreen();
    if (m === 'session') {
      openSessionJoin();              // ask for a code; applyShow() runs after Join / Skip
    } else {
      mode = 'standalone'; sessionCode = null;
      closeSessionJoin();
      await applyShow();
    }
  }

  function openSessionJoin() {
    mode = 'session';
    const sheet = $('og-join'); if (!sheet) { applyShow(); return; }
    const input = $('og-join-code');
    let pre = sessionCode || '';
    try { pre = pre || localStorage.getItem('cueola_outangutan_code') || (window.session && window.session.code) || localStorage.getItem('cueola_last_code') || ''; } catch (e) {}
    if (input) input.value = pre;
    const err = $('og-join-err'); if (err) err.textContent = '';
    renderTransportKeys(); renderAll();    // paint the workspace behind the scrim
    sheet.classList.add('on');
    setTimeout(() => { if (input) { input.focus(); input.select(); } }, 40);
  }
  function closeSessionJoin() { const s = $('og-join'); if (s) s.classList.remove('on'); }

  async function joinSession() {
    const input = $('og-join-code'), err = $('og-join-err');
    const code = (input ? input.value : '').trim().toUpperCase();
    if (!code) { if (err) err.textContent = 'Enter a session code, or continue without one.'; if (input) input.focus(); return; }
    sessionCode = code; mode = 'session';
    try { localStorage.setItem('cueola_outangutan_code', code); } catch (e) {}
    closeSessionJoin();
    await applyShow();
    toast('Joined session ' + code + '. Live cross-device cue sync arrives in Phase 4 — your cue list is saved under this code on this device.');
  }
  async function joinStandaloneInstead() {
    mode = 'standalone'; sessionCode = null;
    closeSessionJoin();
    await applyShow();
  }

  function exitOutangutan() {
    stopAll({ silent: true });
    closeSessionJoin();
    if (identifyOn) { identifyOn = false; sendOut({ t: 'identify', on: false }); }
    $('outangutan').classList.remove('on');
    const entry = $('entry'); if (entry) entry.classList.add('on');
    try { if (typeof window.pushSessionHistoryState === 'function') window.pushSessionHistoryState('entry'); } catch (e) {}
  }

  // ── exports ──────────────────────────────────────────────────────────────
  window.enterOutangutan = enterOutangutan;
  window.exitOutangutan = exitOutangutan;
  window.Outangutan = { enter: enterOutangutan, exit: exitOutangutan, _state: () => ({ cues, selectedId, settings, active: active && active.cue.id, mode }) };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { if ($('outangutan')) build(); }, { once: true });
  else if ($('outangutan')) build();
})();
