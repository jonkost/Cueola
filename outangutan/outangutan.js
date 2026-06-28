/* ============================================================================
 * Outangutan 🦧 — web playback & cue system for Cueola.
 *
 * PHASE 1 (MVP playback): ordered cue list (Video + Audio), media → IndexedDB
 * (local-first, no server), transport (GO/Stop/Pause) with pre-wait + continue
 * modes, big count-out clock, one chrome-free output window, keyboard-first,
 * All-Stop/Panic + Fade&Stop, autosave + crash recovery.
 *
 * PHASE 2 (sound-effects board + audio engine):
 *   • Web Audio engine — cue-list cues route through a MediaElementSource → a per
 *     channel chain (gain / 3-band EQ / compressor / analyser); SFX pads use
 *     pre-decoded AudioBuffers for the mandatory instant low-latency trigger.
 *   • SFX pad board — a grid of trigger pads (drag a file on, name/color/hotkey),
 *     firing independently of and simultaneously with the program cue.
 *   • A/V fades with curves (linear / S / log): fade-in, fade-out, fade-to-black,
 *     and crossfade between video cues (A/B program decks).
 *   • Audio meters — master + active cue + per-pad (AnalyserNode).
 *   • Small edits — trim in/out, per-cue level, loop, hold-last-frame / fade-to-
 *     black on end, fit (contain/cover/fill) + scale + position.
 *   • Playback / SFX tabs.
 *
 * Same stack as the rest of Cueola: vanilla JS global script, theme tokens, the
 * `enterX()` screen pattern. Self-contained in /outangutan.
 * Build for Chromium (Chrome/Edge) first; degrade gracefully elsewhere.
 * ==========================================================================*/
(function () {
  'use strict';

  // ── constants ──────────────────────────────────────────────────────────
  const DB_NAME = 'outangutan', DB_VER = 1;
  const MEDIA_STORE = 'media', SHOW_STORE = 'show', SHOW_KEY = 'current';
  const OUTPUT_CHANNEL = 'outangutan-output';
  const SCHEMA = 3;
  const PAD_COUNT = 12;          // SFX board slots (3 × 4)
  const PAD_KEYS = ['1','2','3','4','5','6','7','8','9','0','q','w'];
  const ELGATO_VID = 0x0fd9;     // Stream Deck vendor id (WebHID)
  // Stream Deck models we know how to talk to (key count + JPEG image protocol)
  const SD_MODELS = {
    0x0060: { name: 'Stream Deck',        keys: 15, cols: 5, img: 72,  fmt: 'bmp', flip: true,  reset: [0x0b, 0x63], bright: [0x05, 0x55, 0xaa, 0xd1, 0x01] },
    0x006d: { name: 'Stream Deck (v2)',   keys: 15, cols: 5, img: 72,  fmt: 'jpeg', flip: false, reset: [0x03, 0x02], bright: [0x03, 0x08] },
    0x0080: { name: 'Stream Deck MK.2',   keys: 15, cols: 5, img: 72,  fmt: 'jpeg', flip: false, reset: [0x03, 0x02], bright: [0x03, 0x08] },
    0x0063: { name: 'Stream Deck Mini',   keys: 6,  cols: 3, img: 80,  fmt: 'bmp', flip: true,  reset: [0x0b, 0x63], bright: [0x05, 0x55, 0xaa, 0xd1, 0x01] },
    0x006c: { name: 'Stream Deck XL',     keys: 32, cols: 8, img: 96,  fmt: 'jpeg', flip: false, reset: [0x03, 0x02], bright: [0x03, 0x08] },
  };
  // actions a Stream Deck key / control surface can fire
  const SD_ACTIONS = { go: 'GO', stop: 'Stop', pause: 'Pause', fadeStop: 'Fade·Stop', panic: 'PANIC', cue: 'Cue…', pad: 'SFX Pad…' };

  const DEFAULT_SHORTCUTS = { go: ' ', stop: 's', pause: 'p', panic: 'Escape', fadeStop: 'f' };
  const DEFAULT_SETTINGS = () => ({
    clockMode: 'remaining', multiTrigger: true, showLock: false, tab: 'play',
    fadeCurve: 'linear', masterGain: 1, masterSinkId: null, sdMap: {}, shortcuts: Object.assign({}, DEFAULT_SHORTCUTS),
  });
  const defaultOutputs = () => ([{ id: 1, label: 'Output 1', screenId: null, sinkId: null, audioOn: false }]);

  // ── state ──────────────────────────────────────────────────────────────
  let built = false;
  let mode = 'standalone';
  let sessionCode = null;
  let cues = [];
  let pads = [];                 // SFX pads: [{ id, slot, name, mediaId, color, key, gain, loop, fadeIn, fadeOut, eq:{low,mid,high}, comp, trimIn, trimOut, retrigger }]
  let selectedId = null;         // standby cue
  let selectedPadId = null;      // pad in the SFX inspector
  let settings = DEFAULT_SETTINGS();

  let active = null;             // { cue, kind, deck:'a'|'b'|'audio', el, ch } — running program cue
  let preTimer = null, preInfo = null;
  let rafId = null, saveTimer = null;

  // ── multi-output (Phase 3) ───────────────────────────────────────────────
  let bc = null;
  let outputs = defaultOutputs();// persisted: [{ id, label, screenId, sinkId, audioOn }]
  const outputWins = new Map();  // id -> { win, alive, identify }
  let screensCache = null;       // ScreenDetails.screens (Window Management API)
  let audioDevs = [];            // enumerated audiooutput devices (setSinkId)

  // ── Stream Deck (Phase 3, WebHID) ────────────────────────────────────────
  let sd = null;                 // { device, model } when connected
  let sdMap = {};                // keyIndex -> { action, ref } (persisted in settings)
  let sdLearn = null;            // keyIndex currently being mapped (learn mode)

  // ── Web Audio engine ─────────────────────────────────────────────────────
  let audioOK = true;            // flips false if Web Audio is unavailable → element fallback
  let ac = null, master = null;  // AudioContext + master { gain, analyser, buf }
  let decks = null;              // { a, b, audio } program decks (built in build())
  const bufferCache = new Map(); // mediaId -> AudioBuffer (pads)
  const decodeJobs = new Map();  // mediaId -> Promise<AudioBuffer|null>
  const padRT = new Map();       // padId -> { ch, voices:[], buffer }
  const fades = new Map();       // fade token -> rAF id
  let meterRAF = null;

  // ── tiny helpers ───────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const rid = (p) => p + Math.random().toString(36).slice(2, 9);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function toast(msg) { try { if (typeof window.toast === 'function') return window.toast(msg); } catch (e) {} console.log('[outangutan]', msg); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function fmtClock(sec) { sec = Math.max(0, sec || 0); const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return m + ':' + String(s).padStart(2, '0'); }
  function keyLabel(k) { return !k ? '—' : (k === ' ' ? 'Space' : (k === 'Escape' ? 'Esc' : k.toUpperCase())); }
  function sym(name, cls) { try { if (typeof window.sfIcon === 'function') return window.sfIcon(name, cls || ''); } catch (e) {} return '<span class="sf-symbol ' + (cls || '') + '" data-symbol="' + name + '" aria-hidden="true"></span>'; }

  // curve shaping shared by audio + opacity fades
  function curveK(k, curve) { k = clamp(k, 0, 1); if (curve === 's') return k * k * (3 - 2 * k); if (curve === 'log') return Math.pow(k, 2.2); return k; }
  function runFade(token, apply, from, to, ms, curve, done) {
    cancelFade(token);
    if (!(ms > 0)) { apply(to); if (done) done(); return; }
    const t0 = performance.now();
    const tick = (t) => {
      const k = (t - t0) / ms;
      if (k >= 1) { apply(to); fades.delete(token); if (done) done(); return; }
      apply(from + (to - from) * curveK(k, curve));
      fades.set(token, requestAnimationFrame(tick));
    };
    fades.set(token, requestAnimationFrame(tick));
  }
  function cancelFade(token) { const r = fades.get(token); if (r) { cancelAnimationFrame(r); fades.delete(token); } }

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
  async function idbPut(store, key, val) { const db = await openDB(); return new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
  async function idbGet(store, key) { const db = await openDB(); return new Promise((res) => { const t = db.transaction(store, 'readonly').objectStore(store).get(key); t.onsuccess = () => res(t.result); t.onerror = () => res(null); }); }
  async function idbDel(store, key) { const db = await openDB(); return new Promise((res) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete = res; tx.onerror = res; }); }

  // ── audio context + channels ─────────────────────────────────────────────
  function ensureAudio() {
    if (!audioOK) return false;
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { audioOK = false; return false; }
        ac = new AC();
        const g = ac.createGain(); g.gain.value = settings.masterGain == null ? 1 : settings.masterGain;
        const an = ac.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0.6;
        g.connect(an); an.connect(ac.destination);
        master = { gain: g, analyser: an, buf: new Uint8Array(an.fftSize) };
        ['a', 'b', 'audio'].forEach(k => {
          const d = decks[k]; d.ch = makeChannel();
          try { d.src = ac.createMediaElementSource(d.el); d.src.connect(d.ch.input); } catch (e) { /* already wired or unsupported */ }
        });
        startMeterLoop();
        applyMasterSink();          // apply a persisted master audio device, if set + supported
      }
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return true;
    } catch (e) { audioOK = false; return false; }
  }
  function makeChannel() {
    const input = ac.createGain();
    const low = ac.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 180;
    const mid = ac.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1100; mid.Q.value = 0.9;
    const high = ac.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 4500;
    const comp = ac.createDynamicsCompressor(); setComp(comp, false);
    const gain = ac.createGain(); gain.gain.value = 1;
    const an = ac.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0.55;
    input.connect(low); low.connect(mid); mid.connect(high); high.connect(comp); comp.connect(gain); gain.connect(an); an.connect(master.gain);
    return { input, low, mid, high, comp, gain, analyser: an, buf: new Uint8Array(an.fftSize) };
  }
  function setComp(comp, on) {
    if (on) { comp.threshold.value = -22; comp.knee.value = 28; comp.ratio.value = 8; comp.attack.value = 0.004; comp.release.value = 0.22; }
    else { comp.threshold.value = 0; comp.knee.value = 0; comp.ratio.value = 1; comp.attack.value = 0.003; comp.release.value = 0.25; }
  }
  function applyChannel(ch, o) {
    if (!ch) return;
    const eq = o.eq || {};
    ch.low.gain.value = eq.low || 0; ch.mid.gain.value = eq.mid || 0; ch.high.gain.value = eq.high || 0;
    setComp(ch.comp, !!o.comp);
    if (o.gain != null) ch.gain.gain.value = o.gain;
  }
  function setMasterGain(v) { settings.masterGain = clamp(v, 0, 1.2); if (master) master.gain.gain.value = settings.masterGain; }

  async function decodeBuffer(mediaId) {
    if (bufferCache.has(mediaId)) return bufferCache.get(mediaId);
    if (decodeJobs.has(mediaId)) return decodeJobs.get(mediaId);
    const job = (async () => {
      try {
        if (!ensureAudio()) return null;
        const media = await idbGet(MEDIA_STORE, mediaId);
        if (!media || !media.blob) return null;
        const arr = await media.blob.arrayBuffer();
        const buf = await ac.decodeAudioData(arr);
        bufferCache.set(mediaId, buf);
        return buf;
      } catch (e) { return null; }
      finally { decodeJobs.delete(mediaId); }
    })();
    decodeJobs.set(mediaId, job);
    return job;
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
  async function storeFile(file) {       // import one file → MEDIA_STORE, return { mediaId, kind, duration, thumb, name }
    const kind = file.type.startsWith('video') ? 'video' : (file.type.startsWith('audio') ? 'audio' : null);
    if (!kind) { toast('Skipped "' + file.name + '" — not a video or audio file.'); return null; }
    const mediaId = rid('m_');
    const blob = file.slice(0, file.size, file.type);
    const probe = await probeMedia(blob, kind);
    await idbPut(MEDIA_STORE, mediaId, { blob, name: file.name, mime: file.type, kind, duration: probe.duration, thumb: probe.thumb });
    return { mediaId, kind, duration: probe.duration, thumb: probe.thumb, name: file.name };
  }
  async function importFiles(fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    let added = 0;
    for (const file of files) {
      try {
        const m = await storeFile(file); if (!m) continue;
        cues.push(makeCue({ name: m.name.replace(/\.[^.]+$/, ''), type: m.kind, mediaId: m.mediaId, duration: m.duration, thumb: m.thumb }));
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
      // Phase 2 audio + fades + edits
      eq: { low: 0, mid: 0, high: 0 }, comp: false,
      fadeIn: 0, fadeOut: 0, fadeCurve: '', xfade: 0,
      endAction: 'stop',        // 'stop' | 'hold' | 'black'
      fit: 'contain', scale: 1, posX: 0, posY: 0,
      output: 1,                // target output window id (Phase 3 multi-output)
    };
  }
  function renumber() { cues.forEach((c, i) => { c.num = i + 1; }); }
  function cueById(id) { return cues.find(c => c.id === id) || null; }
  function cueIndex(id) { return cues.findIndex(c => c.id === id); }
  function nextArmedAfter(id) { let i = cueIndex(id); for (let j = i + 1; j < cues.length; j++) if (cues[j].armed !== false) return cues[j].id; return null; }
  function fadeCurveOf(cue) { return cue && cue.fadeCurve ? cue.fadeCurve : settings.fadeCurve; }

  // ── SFX pads ─────────────────────────────────────────────────────────────
  function padBySlot(slot) { return pads.find(p => p.slot === slot) || null; }
  function padById(id) { return pads.find(p => p.id === id) || null; }
  function nextFreePadKey() { const used = new Set(pads.map(p => p.key).filter(Boolean)); const tk = new Set(Object.values(settings.shortcuts)); for (const k of PAD_KEYS) if (!used.has(k) && !tk.has(k)) return k; return ''; }
  function makePad(slot, o) {
    return {
      id: rid('p_'), slot, name: o.name || 'Pad', mediaId: o.mediaId, color: o.color || 'var(--purple)',
      key: nextFreePadKey(), gain: 1, loop: false, fadeIn: 0, fadeOut: 0,
      eq: { low: 0, mid: 0, high: 0 }, comp: false, trimIn: 0, trimOut: null, retrigger: 'restart',
    };
  }
  async function assignPad(slot, file) {
    const m = await storeFile(file); if (!m) return;
    if (m.kind === 'video') { /* still usable as a sound — play its audio track */ }
    const existing = padBySlot(slot);
    if (existing) { removePadMediaIfOrphan(existing); existing.mediaId = m.mediaId; existing.name = m.name.replace(/\.[^.]+$/, ''); padRT.delete(existing.id); }
    else pads.push(makePad(slot, { name: m.name.replace(/\.[^.]+$/, ''), mediaId: m.mediaId }));
    decodeBuffer(m.mediaId);
    renderPads(); renderPadInspector(); scheduleSave();
  }
  function removePadMediaIfOrphan(pad) {
    if (!pad || !pad.mediaId) return;
    const used = cues.some(c => c.mediaId === pad.mediaId) || pads.some(p => p !== pad && p.mediaId === pad.mediaId);
    if (!used) idbDel(MEDIA_STORE, pad.mediaId);
    bufferCache.delete(pad.mediaId);
  }
  function clearPad(id) {
    const p = padById(id); if (!p) return;
    stopPad(p); padRT.delete(p.id); removePadMediaIfOrphan(p);
    pads = pads.filter(x => x.id !== id);
    if (selectedPadId === id) selectedPadId = null;
    renderPads(); renderPadInspector(); scheduleSave();
  }
  async function firePad(pad) {
    if (!pad || !pad.mediaId) return;
    if (!ensureAudio()) { toast('Web Audio unavailable in this browser.'); return; }
    let rt = padRT.get(pad.id);
    if (!rt) { rt = { ch: makeChannel(), voices: [], buffer: bufferCache.get(pad.mediaId) || null }; padRT.set(pad.id, rt); }
    if (!rt.buffer) { rt.buffer = bufferCache.get(pad.mediaId) || null; }
    if (!rt.buffer) { const b = await decodeBuffer(pad.mediaId); if (!b) { toast('Could not decode “' + pad.name + '”.'); return; } rt.buffer = b; }

    if (!settings.multiTrigger) pads.forEach(p => { if (p.id !== pad.id) stopPad(p); });
    if (pad.retrigger === 'toggle' && rt.voices.length) { stopPad(pad); return; }
    if (pad.retrigger === 'restart' || !settings.multiTrigger) stopVoices(rt);

    applyChannel(rt.ch, { gain: pad.fadeIn > 0 ? 0 : (pad.gain == null ? 1 : pad.gain), eq: pad.eq, comp: pad.comp });
    const src = ac.createBufferSource();
    src.buffer = rt.buffer; src.loop = !!pad.loop;
    const off = pad.trimIn || 0;
    if (pad.loop) { src.loopStart = off; src.loopEnd = pad.trimOut || rt.buffer.duration; }
    src.connect(rt.ch.input);
    const dur = (!pad.loop && pad.trimOut != null) ? Math.max(0, pad.trimOut - off) : undefined;
    try { src.start(0, off, dur); } catch (e) { try { src.start(0, off); } catch (e2) {} }
    if (pad.fadeIn > 0) runFade('padin-' + pad.id, v => { rt.ch.gain.gain.value = v * (pad.gain == null ? 1 : pad.gain); }, 0, 1, pad.fadeIn * 1000, settings.fadeCurve);
    src.onended = () => { rt.voices = rt.voices.filter(v => v !== src); renderPadLive(pad.id); };
    rt.voices.push(src);
    renderPadLive(pad.id);
  }
  function stopVoices(rt) { if (!rt) return; rt.voices.slice().forEach(v => { try { v.onended = null; v.stop(); } catch (e) {} }); rt.voices = []; }
  function stopPad(pad) { const rt = padRT.get(pad.id); if (!rt) return; cancelFade('padin-' + pad.id); stopVoices(rt); renderPadLive(pad.id); }
  function stopAllPads() { padRT.forEach((rt, id) => { cancelFade('padin-' + id); stopVoices(rt); }); renderPads(); }

  // ── multi-output manager (Phase 3) ───────────────────────────────────────
  // One BroadcastChannel, addressed messages: every output filters on `target`
  // (null = broadcast). Each output window opens with #out=<id> and reports its
  // id back on ready/pong/closed so the controller tracks liveness per output.
  function ensureChannel() {
    if (bc || !('BroadcastChannel' in window)) return;
    bc = new BroadcastChannel(OUTPUT_CHANNEL);
    bc.onmessage = (e) => {
      const m = e.data; if (!m || m._from !== 'output') return;
      const id = m.id || 1, rec = outputWins.get(id);
      if (m.t === 'ready' || m.t === 'pong') { if (rec) rec.alive = true; updateOutputUI(); resendActiveToOutput(id); applyOutputSink(id); }
      if (m.t === 'closed') { if (rec) rec.alive = false; updateOutputUI(); }
    };
  }
  function sendOut(msg, target) { ensureChannel(); if (bc) bc.postMessage(Object.assign({ _from: 'control', target: (target == null ? null : target) }, msg)); }
  function outputById(id) { return outputs.find(o => o.id === id) || null; }
  function isOutputAlive(id) { const r = outputWins.get(id); return !!(r && r.win && !r.win.closed); }

  function openOutput(id) {
    ensureChannel();
    const o = outputById(id) || outputs[0]; if (!o) return;
    let feats = 'width=1280,height=720';
    const scr = (o.screenId != null && screensCache) ? screensCache.find(s => s.id === o.screenId) : null;
    if (scr) feats = 'left=' + scr.availLeft + ',top=' + scr.availTop + ',width=' + scr.availWidth + ',height=' + scr.availHeight;
    const win = window.open('outangutan/output.html#out=' + o.id, 'outangutanOutput' + o.id, feats);
    if (!win) { toast('Output window blocked — allow pop-ups for Outangutan.'); return; }
    outputWins.set(o.id, { win, alive: false, identify: false });
    toast(scr ? ('Opened ' + o.label + ' on ' + scr.label + '.') : ('Opened ' + o.label + '. Drag it to a display, then fullscreen it.'));
    setTimeout(() => { sendOut({ t: 'ping' }, o.id); if (scr) tryFullscreen(win); }, 600);
    updateOutputUI();
  }
  function tryFullscreen(win) { try { const d = win.document.documentElement; if (d && d.requestFullscreen) d.requestFullscreen().catch(() => {}); } catch (e) {} }
  function focusOrOpenOutput(id) { const r = outputWins.get(id); if (r && r.win && !r.win.closed) r.win.focus(); else openOutput(id); }
  function resendActiveToOutput(id) {
    if (!active || active.kind !== 'video' || active.cue.output !== id) return;
    sendOut({ t: 'play', mediaId: active.cue.mediaId, at: active.el.currentTime, loop: active.cue.loop, volume: active.cue.volume, fit: active.cue.fit }, id);
  }
  function identifyOutput(id, on) {
    if (!isOutputAlive(id)) { openOutput(id); setTimeout(() => identifyOutput(id, on), 700); return; }
    const rec = outputWins.get(id); if (rec) rec.identify = on;
    const o = outputById(id);
    sendOut({ t: 'identify', on: on, label: o ? o.label : ('Output ' + id) }, id);
    updateOutputUI();
  }

  function addOutput() {
    const id = outputs.reduce((m, o) => Math.max(m, o.id), 0) + 1;
    outputs.push({ id, label: 'Output ' + id, screenId: null, sinkId: null, audioOn: false });
    scheduleSave(); renderOutputs(); renderInspector();
  }
  function removeOutput(id) {
    if (outputs.length <= 1) { toast('Keep at least one output.'); return; }
    const r = outputWins.get(id); if (r && r.win && !r.win.closed) try { r.win.close(); } catch (e) {}
    outputWins.delete(id);
    outputs = outputs.filter(o => o.id !== id);
    cues.forEach(c => { if (c.output === id) c.output = outputs[0].id; });
    scheduleSave(); renderOutputs(); renderInspector();
  }
  async function detectScreens() {
    if (!('getScreenDetails' in window)) { toast('Window Management needs Chrome/Edge — for now drag output windows to displays manually.'); return; }
    try {
      const det = await window.getScreenDetails();
      screensCache = det.screens.map((s, i) => ({ id: i, label: (s.label || ('Display ' + (i + 1))) + (s.isPrimary ? ' · primary' : ''), availLeft: s.availLeft, availTop: s.availTop, availWidth: s.availWidth, availHeight: s.availHeight }));
      toast('Found ' + screensCache.length + ' display' + (screensCache.length === 1 ? '' : 's') + '.');
      renderOutputs();
    } catch (e) { toast('Display access denied — allow “Window management” for this site.'); }
  }

  // audio-device routing (setSinkId) — per output + master (control) bus
  function applyOutputSink(id) { const o = outputById(id); if (!o) return; sendOut({ t: 'audio', on: !!o.audioOn, sinkId: o.sinkId || '' }, id); }
  async function applyMasterSink() { try { if (ac && typeof ac.setSinkId === 'function') await ac.setSinkId(settings.masterSinkId || ''); } catch (e) {} }
  async function listAudioOutputs() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try { const devs = await navigator.mediaDevices.enumerateDevices(); return devs.filter(d => d.kind === 'audiooutput').map((d, i) => ({ id: d.deviceId, label: d.label || ('Audio output ' + (i + 1)) })); } catch (e) { return []; }
  }

  function updateOutputUI() {
    const b = $('og-output-btn'); if (b) b.classList.toggle('on', outputs.some(o => isOutputAlive(o.id)));
    if ($('og-outputs') && $('og-outputs').classList.contains('on')) renderOutputs();
  }

  // ── Stream Deck (WebHID, Phase 3) ────────────────────────────────────────
  // Connect directly over WebHID (no Elgato software). Button press → mapped
  // action; key images painted best-effort for gen-2 (JPEG) models. All HID I/O
  // is guarded — Chromium-only, and only fully verifiable with the hardware.
  const sdState = [];
  function sdActionLabel(m) {
    if (!m || !m.action) return '';
    if (m.action === 'cue') { const c = cueById(m.ref); return c ? ('CUE ' + c.num) : 'CUE ?'; }
    if (m.action === 'pad') { const p = padById(m.ref); return p ? (p.name || 'PAD') : 'PAD ?'; }
    return (SD_ACTIONS[m.action] || m.action).toUpperCase();
  }
  function sdFireKey(i) {
    const m = sdMap[i]; if (!m || !m.action) return;
    if (m.action === 'go') go();
    else if (m.action === 'stop') stopAll();
    else if (m.action === 'pause') pauseResume();
    else if (m.action === 'fadeStop') fadeStopAll();
    else if (m.action === 'panic') panic();
    else if (m.action === 'cue') { const c = cueById(m.ref); if (c) { selectedId = c.id; go(); } }
    else if (m.action === 'pad') { const p = padById(m.ref); if (p) firePad(p); }
  }
  async function sdConnect() {
    if (!('hid' in navigator)) { toast('WebHID needs Chrome/Edge — Stream Deck control is Chromium-only.'); return; }
    let dev;
    try {
      const have = (await navigator.hid.getDevices()).filter(d => d.vendorId === ELGATO_VID);
      dev = have.find(d => SD_MODELS[d.productId]) || have[0];
      if (!dev) { const picked = await navigator.hid.requestDevice({ filters: [{ vendorId: ELGATO_VID }] }); dev = picked && picked[0]; }
    } catch (e) { toast('Stream Deck selection cancelled.'); return; }
    if (!dev) { toast('No Stream Deck selected.'); return; }
    try { if (!dev.opened) await dev.open(); } catch (e) { toast('Could not open the Stream Deck (another app using it?).'); return; }
    const model = SD_MODELS[dev.productId] || { name: 'Stream Deck', keys: 15, cols: 5, img: 72, fmt: 'jpeg', flip: false, reset: [0x03, 0x02], bright: [0x03, 0x08] };
    sd = { device: dev, model };
    dev.oninputreport = onSdInput;
    try { navigator.hid.addEventListener('disconnect', onSdDisconnect); } catch (e) {}
    sdReset(); sdBrightness(80); sdPaintAll();
    toast('Stream Deck connected — ' + model.name + ' (' + model.keys + ' keys).');
    renderStreamDeck();
  }
  function onSdDisconnect(e) { if (!sd) return; if (e && e.device && e.device !== sd.device) return; sd = null; renderStreamDeck(); toast('Stream Deck disconnected.'); }
  function sdDisconnect() { if (sd && sd.device) { try { sdReset(); } catch (e) {} try { sd.device.close(); } catch (e) {} } sd = null; renderStreamDeck(); }
  function onSdInput(e) {
    if (!sd) return;
    const data = new Uint8Array(e.data.buffer);
    const off = sd.model.stateOffset != null ? sd.model.stateOffset : (sd.model.fmt === 'jpeg' ? 3 : 0); // gen2 states @3, gen1 @0 (tune per model)
    for (let i = 0; i < sd.model.keys; i++) {
      const pressed = data[off + i] === 1, was = sdState[i];
      if (pressed && !was) sdFireKey(i);
      sdState[i] = pressed;
    }
  }
  function sdReset() { try { const r = sd.model.reset; sd.device.sendFeatureReport(r[0], new Uint8Array([r[1]])); } catch (e) {} }
  function sdBrightness(pct) { try { const b = sd.model.bright; sd.device.sendFeatureReport(b[0], new Uint8Array([b[1], clamp(pct | 0, 0, 100)])); } catch (e) {} }
  async function sdPaintAll() { if (!sd) return; for (let i = 0; i < sd.model.keys; i++) await sdPaintKey(i); }
  async function sdPaintKey(i) {
    if (!sd || sd.model.fmt !== 'jpeg') return;   // image upload implemented for gen-2 (JPEG) models only
    const bytes = await sdKeyImage(i, sdMap[i]); if (!bytes) return;
    try {
      const PKT = 1024, HEADER = 8, PAYLOAD = PKT - HEADER;   // [0x02][0x07,key,last,len_lo,len_hi,page_lo,page_hi][payload]
      let page = 0, sent = 0;
      while (sent < bytes.length) {
        const chunk = bytes.subarray(sent, sent + PAYLOAD);
        const last = (sent + chunk.length) >= bytes.length ? 1 : 0;
        const pkt = new Uint8Array(PKT);
        pkt[0] = 0x02; pkt[1] = 0x07; pkt[2] = i; pkt[3] = last;
        pkt[4] = chunk.length & 0xff; pkt[5] = (chunk.length >> 8) & 0xff;
        pkt[6] = page & 0xff; pkt[7] = (page >> 8) & 0xff;
        pkt.set(chunk, HEADER);
        await sd.device.sendReport(0x02, pkt.subarray(1));
        sent += chunk.length; page++;
      }
    } catch (e) {}
  }
  function sdKeyImage(i, m) {
    return new Promise(res => {
      const px = sd.model.img, cv = document.createElement('canvas'); cv.width = px; cv.height = px;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = m && m.action ? sdKeyColor(m) : '#101418'; ctx.fillRect(0, 0, px, px);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '700 ' + Math.round(px * 0.16) + 'px -apple-system,system-ui,sans-serif';
      sdWrap(ctx, sdActionLabel(m), px / 2, px * 0.56, px * 0.9, px * 0.2);
      cv.toBlob(b => { if (!b) return res(null); b.arrayBuffer().then(a => res(new Uint8Array(a))).catch(() => res(null)); }, 'image/jpeg', 0.9);
    });
  }
  function sdKeyColor(m) { return ({ go: '#1c7a3e', stop: '#2e3640', pause: '#5a4a12', fadeStop: '#243a66', panic: '#8a1f1f', cue: '#234a8a', pad: '#5a2a8a' })[m.action] || '#234a8a'; }
  function sdWrap(ctx, text, x, y, maxW, lh) { const words = String(text).split(' '); let line = '', yy = y; for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += lh; } else line = t; } if (line) ctx.fillText(line, x, yy); }

  // ── Outputs panel ─────────────────────────────────────────────────────────
  async function openOutputsPanel() { $('og-outputs').classList.add('on'); renderOutputs(); audioDevs = await listAudioOutputs(); renderOutputs(); }
  function closeOutputsPanel() { $('og-outputs').classList.remove('on'); }
  function devOptions(cur) { return '<option value="">Default device</option>' + audioDevs.map(d => '<option value="' + d.id + '"' + (cur === d.id ? ' selected' : '') + '>' + esc(d.label) + '</option>').join(''); }
  function renderOutputs() {
    const body = $('og-outputs-body'); if (!body) return;
    body.innerHTML =
      '<div class="og-out-tools"><button class="og-bar-btn" id="og-out-add">' + sym('action.add') + ' Add output</button>'
        + '<button class="og-bar-btn" id="og-out-detect">' + sym('content.display') + ' Detect displays</button>'
        + '<div class="og-field og-out-mastersink"><label>Master audio output (control)</label><select id="og-master-sink">' + devOptions(settings.masterSinkId) + '</select></div></div>'
      + outputs.map(o => {
        const live = isOutputAlive(o.id);
        const screenSel = screensCache
          ? '<select class="og-out-screen" data-o="' + o.id + '"><option value="">No display set</option>' + screensCache.map(s => '<option value="' + s.id + '"' + (o.screenId === s.id ? ' selected' : '') + '>' + esc(s.label) + '</option>').join('') + '</select>'
          : '<span class="og-out-note">Detect displays to place this on a screen</span>';
        return '<div class="og-out-row">'
          + '<div class="og-out-main"><span class="og-out-dot' + (live ? ' live' : '') + '"></span>'
            + '<input class="og-out-label" data-o="' + o.id + '" value="' + esc(o.label) + '">'
            + '<button class="og-bar-btn og-out-open" data-o="' + o.id + '">' + (live ? 'Focus' : 'Open') + '</button>'
            + '<button class="og-bar-btn og-out-id" data-o="' + o.id + '">Identify</button>'
            + (outputs.length > 1 ? '<button class="og-bar-btn danger og-out-del" data-o="' + o.id + '">' + sym('action.delete') + '</button>' : '')
          + '</div>'
          + '<div class="og-out-cfg">'
            + '<div class="og-field"><label>Display</label>' + screenSel + '</div>'
            + '<label class="og-check og-check-inline og-out-audiochk"><input type="checkbox" class="og-out-audio" data-o="' + o.id + '"' + (o.audioOn ? ' checked' : '') + '> Audio on this output</label>'
            + '<div class="og-field"><label>Device</label><select class="og-out-sink" data-o="' + o.id + '">' + devOptions(o.sinkId) + '</select></div>'
          + '</div></div>';
      }).join('')
      + '<p class="og-sheet-note">Each video cue targets an output (set it in the cue Inspector). Multiple displays use the Window Management API (Chrome/Edge) — “Detect displays”, then pick a screen and Open to place + fullscreen. Per-output audio uses <code>setSinkId</code>.</p>';

    $('og-out-add').onclick = addOutput;
    $('og-out-detect').onclick = detectScreens;
    $('og-master-sink').onchange = e => { settings.masterSinkId = e.target.value || null; applyMasterSink(); scheduleSave(); };
    const each = (sel, fn) => Array.prototype.forEach.call(body.querySelectorAll(sel), fn);
    each('.og-out-label', el => { el.onchange = () => { const o = outputById(+el.getAttribute('data-o')); if (o) { o.label = el.value; scheduleSave(); renderInspector(); } }; });
    each('.og-out-open', el => { el.onclick = () => focusOrOpenOutput(+el.getAttribute('data-o')); });
    each('.og-out-id', el => { el.onclick = () => { const id = +el.getAttribute('data-o'); const rec = outputWins.get(id); identifyOutput(id, !(rec && rec.identify)); }; });
    each('.og-out-del', el => { el.onclick = () => removeOutput(+el.getAttribute('data-o')); });
    each('.og-out-screen', el => { el.onchange = () => { const o = outputById(+el.getAttribute('data-o')); if (o) { o.screenId = el.value === '' ? null : +el.value; scheduleSave(); } }; });
    each('.og-out-audio', el => { el.onchange = () => { const o = outputById(+el.getAttribute('data-o')); if (o) { o.audioOn = el.checked; applyOutputSink(o.id); scheduleSave(); } }; });
    each('.og-out-sink', el => { el.onchange = () => { const o = outputById(+el.getAttribute('data-o')); if (o) { o.sinkId = el.value || null; applyOutputSink(o.id); scheduleSave(); } }; });
  }

  // ── Stream Deck panel ─────────────────────────────────────────────────────
  function openSdPanel() { $('og-sd').classList.add('on'); renderStreamDeck(); }
  function closeSdPanel() { $('og-sd').classList.remove('on'); }
  function renderStreamDeck() {
    const body = $('og-sd-body'); if (!body) return;
    const connected = !!sd, keys = connected ? sd.model.keys : 15, cols = connected ? sd.model.cols : 5;
    let grid = '';
    for (let i = 0; i < keys; i++) {
      const m = sdMap[i] || {};
      const actSel = '<select class="og-sd-act" data-k="' + i + '">' + opt('', '—', m.action || '') + Object.keys(SD_ACTIONS).map(a => opt(a, SD_ACTIONS[a], m.action || '')).join('') + '</select>';
      let refSel = '';
      if (m.action === 'cue') refSel = '<select class="og-sd-ref" data-k="' + i + '"><option value="">Pick cue…</option>' + cues.map(c => '<option value="' + c.id + '"' + (m.ref === c.id ? ' selected' : '') + '>#' + c.num + ' ' + esc(c.name) + '</option>').join('') + '</select>';
      else if (m.action === 'pad') refSel = '<select class="og-sd-ref" data-k="' + i + '"><option value="">Pick pad…</option>' + pads.map(p => '<option value="' + p.id + '"' + (m.ref === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select>';
      grid += '<div class="og-sdk' + (m.action ? ' mapped' : '') + '"><span class="og-sdk-i">' + (i + 1) + '</span>' + actSel + refSel + '</div>';
    }
    const hasHid = ('hid' in navigator);
    body.innerHTML =
      '<div class="og-sd-status">'
        + (connected ? '<span class="og-out-dot live"></span> Connected — ' + esc(sd.model.name) + ' (' + sd.model.keys + ' keys)' : (hasHid ? '<span class="og-out-dot"></span> Not connected' : 'WebHID unavailable — needs Chrome/Edge'))
        + '<div class="og-bar-spacer"></div>'
        + (connected ? '<button class="og-bar-btn danger" id="og-sd-disc">Disconnect</button>' : '<button class="og-bar-btn" id="og-sd-conn"' + (hasHid ? '' : ' disabled') + '>Connect Stream Deck</button>')
      + '</div>'
      + '<p class="og-sheet-note">Map each key to GO / Stop / Pause / Fade·Stop / PANIC, or a specific cue or SFX pad — no Elgato software. Mapping works before the device is connected; once connected, pressing a physical key fires it. Button images paint on gen-2 models (MK.2 / XL / v2).</p>'
      + '<div class="og-sd-grid" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">' + grid + '</div>';
    if ($('og-sd-conn')) $('og-sd-conn').onclick = sdConnect;
    if ($('og-sd-disc')) $('og-sd-disc').onclick = sdDisconnect;
    Array.prototype.forEach.call(body.querySelectorAll('.og-sd-act'), s => { s.onchange = e => { const k = +s.getAttribute('data-k'); const a = e.target.value; if (!a) delete sdMap[k]; else { sdMap[k] = Object.assign({}, sdMap[k], { action: a }); if (a !== 'cue' && a !== 'pad') delete sdMap[k].ref; } settings.sdMap = sdMap; renderStreamDeck(); if (sd) sdPaintKey(k); scheduleSave(); }; });
    Array.prototype.forEach.call(body.querySelectorAll('.og-sd-ref'), s => { s.onchange = e => { const k = +s.getAttribute('data-k'); sdMap[k] = Object.assign({}, sdMap[k], { ref: e.target.value }); settings.sdMap = sdMap; if (sd) sdPaintKey(k); scheduleSave(); }; });
  }

  // ── program decks (transport) ────────────────────────────────────────────
  function deckOf(a) { return a && decks[a.deck]; }
  function freeVideoDeck() { return (active && active.deck === 'a') ? decks.b : decks.a; }
  function deckGain(deck, v) { v = clamp(v, 0, 1); if (audioOK && deck.ch) deck.ch.gain.gain.value = v * (deck.vol == null ? 1 : deck.vol); else deck.el.volume = v * (deck.vol == null ? 1 : deck.vol); }
  function deckSetVol(deck, vol) { deck.vol = clamp(vol, 0, 1); }
  function deckOpacity(deck, v) { if (deck.kind === 'video') deck.el.style.opacity = v; }
  function showDeck(deck) { if (deck.kind !== 'video') return; decks.a.el.classList.toggle('front', deck === decks.a); decks.b.el.classList.toggle('front', deck === decks.b); }
  function applyFit(deck, cue) { const el = deck.el; if (deck.kind !== 'video') return; el.style.objectFit = cue.fit || 'contain'; el.style.transform = 'translate(' + (cue.posX || 0) + '%,' + (cue.posY || 0) + '%) scale(' + (cue.scale || 1) + ')'; }

  function clearPre() { if (preTimer) { clearTimeout(preTimer); preTimer = null; } preInfo = null; }

  function stopDeck(deck, opts) {
    if (!deck) return;
    try { deck.el.pause(); } catch (e) {}
    deck.el.onended = deck.el.ontimeupdate = deck.el.onplay = null;
    cancelFade('in-' + deck.id); cancelFade('out-' + deck.id);
    if (!opts || !opts.keepFrame) { deck.el.removeAttribute('src'); try { deck.el.load(); } catch (e) {} deckOpacity(deck, 0); }
    if (deck._url) { try { URL.revokeObjectURL(deck._url); } catch (e) {} deck._url = null; }
  }
  function stopAllDecks(opts) { ['a', 'b', 'audio'].forEach(k => stopDeck(decks[k], opts)); active = null; }

  function go() {
    let cue = cueById(selectedId);
    if (!cue) { cue = cues.find(c => c.armed !== false); if (cue) selectedId = cue.id; }
    if (!cue) { toast('No cue to fire. Add media first.'); return; }
    const next = nextArmedAfter(cue.id);
    fireCue(cue);
    selectedId = next || selectedId;
    renderCueList(); renderInspector();
  }
  function fireCue(cue) {
    clearPre();
    if (cue.preWait > 0) {
      setStatus('pre');
      preInfo = { cue, until: performance.now() + cue.preWait * 1000 };
      preTimer = setTimeout(() => { preInfo = null; beginMedia(cue); }, cue.preWait * 1000);
      startTicker(); renderCueList();
      return;
    }
    beginMedia(cue);
  }
  async function beginMedia(cue) {
    const media = await idbGet(MEDIA_STORE, cue.mediaId);
    if (!media || !media.blob) { toast('Media missing for "' + cue.name + '".'); setStatus('idle'); return; }
    ensureAudio();
    const isAudio = cue.type === 'audio';
    const prev = active;
    const deck = isAudio ? decks.audio : freeVideoDeck();
    if (deck._url) { try { URL.revokeObjectURL(deck._url); } catch (e) {} }
    deck._url = URL.createObjectURL(media.blob);
    deck.el.src = deck._url; deck.el.loop = !!cue.loop; deckSetVol(deck, cue.volume);
    deck.el.onended = deck.el.ontimeupdate = deck.el.onplay = null;
    if (audioOK && deck.ch) { applyChannel(deck.ch, { eq: cue.eq, comp: cue.comp }); deck.el.volume = 1; }
    applyFit(deck, cue);

    active = { cue, kind: isAudio ? 'audio' : 'video', deck: isAudio ? 'audio' : (deck === decks.a ? 'a' : 'b'), el: deck.el, ch: deck.ch };
    deck.el.onplay = () => { if (cue.continueMode === 'auto_continue') setTimeout(() => autoFrom(cue), 60); };
    deck.el.ontimeupdate = () => { if (cue.trimOut != null && deck.el.currentTime >= cue.trimOut) handleEnded(cue); };
    deck.el.onended = () => { if (!deck.el.loop) handleEnded(cue); };
    try { deck.el.currentTime = cue.trimIn || 0; } catch (e) {}
    if (!isAudio) showDeck(deck);
    try { await deck.el.play(); } catch (e) { toast('Playback blocked — click GO again.'); }

    const curve = fadeCurveOf(cue);
    const xf = cue.xfade || 0;
    const crossing = prev && prev.el && prev.el !== deck.el && (prev.el.currentTime > 0 || !prev.el.paused);
    if (crossing && xf > 0) {
      const pd = deckOf(prev);
      runFade('out-' + pd.id, v => { deckGain(pd, v); deckOpacity(pd, v); }, 1, 0, xf * 1000, curve, () => stopDeck(pd));
      deckOpacity(deck, deck.kind === 'audio' ? 1 : 0); deckGain(deck, 0);
      runFade('in-' + deck.id, v => { deckGain(deck, v); deckOpacity(deck, v); }, 0, 1, xf * 1000, curve);
    } else {
      if (prev) stopDeck(deckOf(prev));
      const fi = cue.fadeIn || 0;
      if (fi > 0) { deckGain(deck, 0); if (deck.kind === 'video') deckOpacity(deck, 1); runFade('in-' + deck.id, v => deckGain(deck, v), 0, 1, fi * 1000, curve); }
      else { deckGain(deck, 1); if (deck.kind === 'video') deckOpacity(deck, 1); }
    }

    setStatus('play'); startTicker(); renderCueList();
    // mirror to the cue's target output window (addressable; other outputs untouched)
    const prevOut = (prev && prev.kind === 'video') ? prev.cue.output : null;
    const out = cue.output || 1;
    const sameOut = prevOut === out;
    if (!isAudio) {
      if (crossing && xf > 0 && sameOut) sendOut({ t: 'xfade', mediaId: cue.mediaId, at: cue.trimIn || 0, ms: xf * 1000, curve, volume: cue.volume, loop: cue.loop, fit: cue.fit }, out);
      else sendOut({ t: 'play', mediaId: cue.mediaId, at: cue.trimIn || 0, loop: cue.loop, volume: cue.volume, fadeIn: (cue.fadeIn || 0) * 1000, curve, fit: cue.fit }, out);
      if (prevOut != null && !sameOut) sendOut({ t: 'stop' }, prevOut);   // clear the output we left
    } else if (prevOut != null) {
      sendOut({ t: 'black', ms: (cue.fadeIn || 0) * 1000 }, prevOut);     // program became audio → clear that picture
    }
  }

  function autoFrom(cue) {
    const nextId = nextArmedAfter(cue.id);
    const next = cueById(nextId);
    if (!next) return;
    selectedId = nextArmedAfter(next.id) || nextId;
    fireCue(next);
    renderCueList(); renderInspector();
  }
  function handleEnded(cue) {
    const m = cue.continueMode;
    if (m === 'auto_follow') { autoFrom(cue); return; }
    // end action for the picture/audio (output messages only for video — audio cues never touch a picture)
    const deck = active ? deckOf(active) : null;
    const isVid = cue.type === 'video', out = cue.output || 1;
    if (deck && cue.endAction === 'hold') { try { deck.el.pause(); } catch (e) {} setStatus('idle'); if (isVid) sendOut({ t: 'holdLast' }, out); renderCueList(); return; }
    if (deck && cue.endAction === 'black') { runFade('out-' + deck.id, v => { deckGain(deck, v); deckOpacity(deck, v); }, 1, 0, 600, fadeCurveOf(cue), () => stopDeck(deck)); active = null; if (isVid) sendOut({ t: 'black', ms: 600 }, out); setStatus('idle'); renderCueList(); return; }
    if (deck) stopDeck(deck); active = null;
    setStatus('idle'); if (isVid) sendOut({ t: 'stop' }, out); renderCueList();
  }

  function stopAll(opts) { clearPre(); stopAllDecks(); setStatus('idle'); sendOut({ t: 'stop' }); renderCueList(); if (!opts || !opts.silent) toast('Stopped.'); }
  function panic() {
    clearPre();
    fades.forEach((r) => cancelAnimationFrame(r)); fades.clear();
    stopAllDecks(); stopAllPads();
    setStatus('idle'); sendOut({ t: 'stop' }); renderCueList(); toast('PANIC — all stopped.');
  }
  function pauseResume() {
    if (!active || !active.el) { if (preInfo) stopAll(); return; }
    const el = active.el;
    const out = active.cue.output || 1;
    if (el.paused) { el.play(); setStatus('play'); sendOut({ t: 'resume' }, out); }
    else { el.pause(); setStatus('pause'); sendOut({ t: 'pause' }, out); }
    renderCueList();
  }
  function fadeStopAll() {
    const ms = 800, curve = settings.fadeCurve;
    sendOut({ t: 'fade', to: 0, ms });
    let any = false;
    ['a', 'b', 'audio'].forEach(k => {
      const d = decks[k];
      if (d._url && !d.el.paused) { any = true; runFade('out-' + d.id, v => { deckGain(d, v); deckOpacity(d, v); }, 1, 0, ms, curve, () => stopDeck(d)); }
    });
    padRT.forEach((rt, id) => { const p = padById(id); if (p && rt.voices.length) { any = true; runFade('padin-' + id, v => { rt.ch.gain.gain.value = v * (p.gain == null ? 1 : p.gain); }, 1, 0, ms, curve, () => stopPad(p)); } });
    if (any) { toast('Fading out…'); setTimeout(() => { active = null; setStatus('idle'); renderCueList(); renderPads(); }, ms + 30); }
    else stopAll();
  }

  function setStatus(s) {
    const tag = $('og-program-status'); if (!tag) return;
    tag.className = 'og-program-status og-status-' + (s === 'play' ? 'play' : s === 'pre' ? 'pre' : s === 'pause' ? 'pause' : 'idle');
    tag.textContent = s === 'play' ? 'ON AIR' : s === 'pre' ? 'PRE-WAIT' : s === 'pause' ? 'PAUSED' : 'IDLE';
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
    if (active && active.el && active.el.paused) {
      const remain = Math.max(0, ((active.cue.trimOut != null ? active.cue.trimOut : active.el.duration) || 0) - active.el.currentTime);
      timeEl.textContent = fmtClock(remain); labelEl.textContent = 'PAUSED'; cueEl.textContent = active.cue.name; wrap.className = 'og-clock warn'; return;
    }
    const sel = cueById(selectedId);
    timeEl.textContent = fmtClock(sel ? sel.duration : 0);
    labelEl.textContent = sel ? 'DURATION' : 'STANDBY';
    cueEl.textContent = sel ? sel.name : '—';
    wrap.className = 'og-clock';
    if (!active && !preInfo) stopTicker();
  }

  // ── meters ───────────────────────────────────────────────────────────────
  function startMeterLoop() { if (meterRAF) return; const loop = () => { paintMeters(); meterRAF = requestAnimationFrame(loop); }; meterRAF = requestAnimationFrame(loop); }
  function level(an, buf) { an.getByteTimeDomainData(buf); let peak = 0, sum = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128, a = x < 0 ? -x : x; if (a > peak) peak = a; sum += x * x; } return { rms: Math.sqrt(sum / buf.length), peak }; }
  function paintMeter(fillEl, peakEl, an, buf) {
    const l = level(an, buf), v = Math.min(1, l.rms * 1.9);
    fillEl.style.transform = 'scaleX(' + v.toFixed(3) + ')';
    if (peakEl) { let ph = parseFloat(peakEl.dataset.p || '0'); ph = Math.max(l.peak, ph - 0.013); peakEl.dataset.p = ph; peakEl.style.left = (Math.min(1, ph) * 100).toFixed(1) + '%'; peakEl.style.opacity = ph > 0.02 ? '1' : '0'; }
  }
  function paintMeters() {
    if (!ac || !isOpen()) return;
    const mf = $('og-master-fill'); if (mf && master) paintMeter(mf, $('og-master-peak'), master.analyser, master.buf);
    const mf2 = $('og-master-fill2'); if (mf2 && master) paintMeter(mf2, null, master.analyser, master.buf);
    const cf = $('og-cue-meter-fill'); if (cf && active && active.ch) paintMeter(cf, null, active.ch.analyser, active.ch.buf);
    if (settings.tab === 'sfx') {
      pads.forEach(p => { const rt = padRT.get(p.id); const f = $('og-padmeter-' + p.id); if (f && rt && rt.voices.length) paintMeter(f, null, rt.ch.analyser, rt.ch.buf); else if (f) f.style.transform = 'scaleX(0)'; });
      const pf = $('og-pad-meter-fill'); const sp = selectedPadId && padRT.get(selectedPadId); if (pf && sp && sp.voices.length) paintMeter(pf, null, sp.ch.analyser, sp.ch.buf); else if (pf) pf.style.transform = 'scaleX(0)';
    }
  }

  // ── rendering ────────────────────────────────────────────────────────────
  function renderAll() { renderCueList(); renderInspector(); renderClock(); renderPads(); renderPadInspector(); }

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
        + '<span class="og-cue-meta">' + (cont ? '<span class="og-cue-cont">' + cont + '</span>' : '') + (c.xfade > 0 ? '<span class="og-cue-cont">XF' + c.xfade + 's</span>' : '') + (c.preWait > 0 ? '<span class="og-cue-cont">' + sym('state.timed') + c.preWait + 's</span>' : '') + '<span>' + fmtClock(c.duration) + '</span></span>'
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
    const eq = c.eq || (c.eq = { low: 0, mid: 0, high: 0 });
    ins.innerHTML =
      field('Name', '<input id="og-i-name" type="text" value="' + esc(c.name) + '">') +
      '<div class="og-field-row">' +
        field('Pre-wait (s)', '<input id="og-i-prewait" type="number" min="0" step="0.5" value="' + c.preWait + '">') +
        field('Continue', '<select id="og-i-continue">' +
          opt('manual', 'Manual', c.continueMode) + opt('auto_continue', 'Auto-continue', c.continueMode) + opt('auto_follow', 'Auto-follow', c.continueMode) + '</select>') +
      '</div>' +
      // ── Audio
      sub('Audio') +
      field('Level <span class="og-cue-meter"><span class="og-cue-meter-fill" id="og-cue-meter-fill"></span></span>', '<input id="og-i-volume" type="range" min="0" max="1" step="0.01" value="' + c.volume + '">') +
      '<div class="og-field-row3">' +
        field('Low', '<input id="og-i-eqlow" type="range" min="-12" max="12" step="0.5" value="' + (eq.low || 0) + '">') +
        field('Mid', '<input id="og-i-eqmid" type="range" min="-12" max="12" step="0.5" value="' + (eq.mid || 0) + '">') +
        field('High', '<input id="og-i-eqhigh" type="range" min="-12" max="12" step="0.5" value="' + (eq.high || 0) + '">') +
      '</div>' +
      '<label class="og-check"><input id="og-i-comp" type="checkbox"' + (c.comp ? ' checked' : '') + '> Compressor</label>' +
      // ── Fades
      sub('Fades') +
      '<div class="og-field-row3">' +
        field('In (s)', '<input id="og-i-fadein" type="number" min="0" step="0.1" value="' + (c.fadeIn || 0) + '">') +
        field('Out (s)', '<input id="og-i-fadeout" type="number" min="0" step="0.1" value="' + (c.fadeOut || 0) + '">') +
        field('Curve', '<select id="og-i-fadecurve">' + opt('', 'Default', c.fadeCurve) + opt('linear', 'Linear', c.fadeCurve) + opt('s', 'S-curve', c.fadeCurve) + opt('log', 'Log', c.fadeCurve) + '</select>') +
      '</div>' +
      (c.type === 'video' ? field('Crossfade in (s)', '<input id="og-i-xfade" type="number" min="0" step="0.1" value="' + (c.xfade || 0) + '">') : '') +
      // ── Edit
      sub('Edit') +
      '<div class="og-field-row">' +
        field('Trim in (s)', '<input id="og-i-trimin" type="number" min="0" step="0.1" value="' + (c.trimIn || 0) + '">') +
        field('Trim out (s)', '<input id="og-i-trimout" type="number" min="0" step="0.1" value="' + (c.trimOut == null ? '' : c.trimOut) + '" placeholder="end">') +
      '</div>' +
      '<div class="og-field-row">' +
        field('Loop', '<select id="og-i-loop">' + opt('0', 'No', c.loop ? '1' : '0') + opt('1', 'Yes', c.loop ? '1' : '0') + '</select>') +
        field('On end', '<select id="og-i-endaction">' + opt('stop', 'Stop / black', c.endAction) + opt('hold', 'Hold last frame', c.endAction) + opt('black', 'Fade to black', c.endAction) + '</select>') +
      '</div>' +
      (c.type === 'video' ?
        '<div class="og-field-row3">' +
          field('Fit', '<select id="og-i-fit">' + opt('contain', 'Contain', c.fit) + opt('cover', 'Cover', c.fit) + opt('fill', 'Fill', c.fit) + '</select>') +
          field('Scale', '<input id="og-i-scale" type="range" min="0.25" max="3" step="0.05" value="' + (c.scale || 1) + '">') +
          field('Armed', '<select id="og-i-armed">' + opt('1', 'On', c.armed === false ? '0' : '1') + opt('0', 'Off', c.armed === false ? '0' : '1') + '</select>') +
        '</div>' +
        '<div class="og-field-row">' +
          field('Pos X (%)', '<input id="og-i-posx" type="number" step="1" value="' + (c.posX || 0) + '">') +
          field('Pos Y (%)', '<input id="og-i-posy" type="number" step="1" value="' + (c.posY || 0) + '">') +
        '</div>' +
        field('Output', '<select id="og-i-output">' + outputs.map(o => opt(o.id, o.label, c.output || 1)).join('') + '</select>')
        : field('Armed', '<select id="og-i-armed">' + opt('1', 'On', c.armed === false ? '0' : '1') + opt('0', 'Off', c.armed === false ? '0' : '1') + '</select>')) +
      // ── meta
      sub('Cue') +
      field('Color', '<div class="og-swatches">' + ['var(--video)', 'var(--green)', 'var(--red)', 'var(--yellow)', 'var(--purple)', 'var(--cyan)'].map(col =>
        '<button class="og-swatch' + (c.color === col ? ' sel' : '') + '" data-col="' + col + '" style="background:' + col + '" aria-label="Set cue color"></button>').join('') + '</div>') +
      field('Notes', '<input id="og-i-notes" type="text" value="' + esc(c.notes || '') + '">') +
      '<button class="og-cue-del" id="og-i-del">' + sym('action.delete') + ' Delete cue</button>';

    const bind = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
    const live = () => { if (active && active.cue.id === c.id && active.ch) applyChannel(active.ch, { eq: c.eq, comp: c.comp }); };
    bind('og-i-name', 'oninput', e => { c.name = e.target.value; renderCueList(); scheduleSave(); });
    bind('og-i-prewait', 'onchange', e => { c.preWait = Math.max(0, parseFloat(e.target.value) || 0); renderCueList(); scheduleSave(); });
    bind('og-i-continue', 'onchange', e => { c.continueMode = e.target.value; renderCueList(); scheduleSave(); });
    bind('og-i-volume', 'oninput', e => { c.volume = clamp(parseFloat(e.target.value), 0, 1); if (active && active.cue.id === c.id) { deckSetVol(deckOf(active), c.volume); deckGain(deckOf(active), 1); sendOut({ t: 'volume', v: c.volume }, c.output || 1); } scheduleSave(); });
    bind('og-i-eqlow', 'oninput', e => { c.eq.low = parseFloat(e.target.value) || 0; live(); scheduleSave(); });
    bind('og-i-eqmid', 'oninput', e => { c.eq.mid = parseFloat(e.target.value) || 0; live(); scheduleSave(); });
    bind('og-i-eqhigh', 'oninput', e => { c.eq.high = parseFloat(e.target.value) || 0; live(); scheduleSave(); });
    bind('og-i-comp', 'onchange', e => { c.comp = e.target.checked; live(); scheduleSave(); });
    bind('og-i-fadein', 'onchange', e => { c.fadeIn = Math.max(0, parseFloat(e.target.value) || 0); scheduleSave(); });
    bind('og-i-fadeout', 'onchange', e => { c.fadeOut = Math.max(0, parseFloat(e.target.value) || 0); scheduleSave(); });
    bind('og-i-fadecurve', 'onchange', e => { c.fadeCurve = e.target.value; scheduleSave(); });
    bind('og-i-xfade', 'onchange', e => { c.xfade = Math.max(0, parseFloat(e.target.value) || 0); renderCueList(); scheduleSave(); });
    bind('og-i-trimin', 'onchange', e => { c.trimIn = Math.max(0, parseFloat(e.target.value) || 0); scheduleSave(); });
    bind('og-i-trimout', 'onchange', e => { const v = parseFloat(e.target.value); c.trimOut = isNaN(v) ? null : v; scheduleSave(); });
    bind('og-i-loop', 'onchange', e => { c.loop = e.target.value === '1'; if (active && active.cue.id === c.id) active.el.loop = c.loop; scheduleSave(); });
    bind('og-i-endaction', 'onchange', e => { c.endAction = e.target.value; scheduleSave(); });
    bind('og-i-fit', 'onchange', e => { c.fit = e.target.value; if (active && active.cue.id === c.id) applyFit(deckOf(active), c); sendOut({ t: 'fit', fit: c.fit }, c.output || 1); scheduleSave(); });
    bind('og-i-scale', 'oninput', e => { c.scale = parseFloat(e.target.value) || 1; if (active && active.cue.id === c.id) applyFit(deckOf(active), c); scheduleSave(); });
    bind('og-i-posx', 'onchange', e => { c.posX = parseFloat(e.target.value) || 0; if (active && active.cue.id === c.id) applyFit(deckOf(active), c); scheduleSave(); });
    bind('og-i-posy', 'onchange', e => { c.posY = parseFloat(e.target.value) || 0; if (active && active.cue.id === c.id) applyFit(deckOf(active), c); scheduleSave(); });
    bind('og-i-output', 'onchange', e => { c.output = parseInt(e.target.value, 10) || 1; scheduleSave(); });
    bind('og-i-armed', 'onchange', e => { c.armed = e.target.value === '1'; renderCueList(); scheduleSave(); });
    bind('og-i-notes', 'oninput', e => { c.notes = e.target.value; scheduleSave(); });
    bind('og-i-del', 'onclick', () => deleteCue(c.id));
    Array.prototype.forEach.call(ins.querySelectorAll('.og-swatch'), sw => { sw.onclick = () => { c.color = sw.getAttribute('data-col'); renderCueList(); renderInspector(); scheduleSave(); }; });
  }
  function field(label, inner) { return '<div class="og-field"><label>' + label + '</label>' + inner + '</div>'; }
  function opt(val, label, cur) { return '<option value="' + val + '"' + (String(cur) === String(val) ? ' selected' : '') + '>' + label + '</option>'; }
  function sub(t) { return '<div class="og-insp-sub">' + t + '</div>'; }

  async function deleteCue(id) {
    const c = cueById(id); if (!c) return;
    if (active && active.cue.id === id) stopAll({ silent: true });
    if (c.mediaId && !cues.some(x => x !== c && x.mediaId === c.mediaId) && !pads.some(p => p.mediaId === c.mediaId)) await idbDel(MEDIA_STORE, c.mediaId);
    cues = cues.filter(x => x.id !== id);
    if (selectedId === id) selectedId = cues.length ? cues[0].id : null;
    renumber(); renderAll(); scheduleSave();
  }

  // ── SFX board rendering ──────────────────────────────────────────────────
  function renderPads() {
    const grid = $('og-pad-grid'); if (!grid) return;
    let html = '';
    for (let i = 0; i < PAD_COUNT; i++) {
      const p = padBySlot(i);
      if (!p) { html += '<button class="og-pad empty" data-slot="' + i + '"><span class="og-pad-empty-l">' + sym('action.add') + '</span><span class="og-pad-hint">Drop a sound</span></button>'; continue; }
      const live = padRT.get(p.id); const playing = live && live.voices.length;
      html += '<button class="og-pad' + (playing ? ' live' : '') + (p.id === selectedPadId ? ' sel' : '') + '" data-pad="' + p.id + '" style="--pad:' + p.color + '">'
        + '<span class="og-pad-key">' + (p.key ? keyLabel(p.key) : '') + '</span>'
        + '<span class="og-pad-edit" data-edit="' + p.id + '" title="Edit pad">' + sym('action.more') + '</span>'
        + '<span class="og-pad-name">' + esc(p.name) + '</span>'
        + '<span class="og-pad-meter"><span class="og-pad-meter-fill" id="og-padmeter-' + p.id + '"></span></span>'
        + '</button>';
    }
    grid.innerHTML = html;
    Array.prototype.forEach.call(grid.querySelectorAll('.og-pad.empty'), b => {
      const slot = +b.getAttribute('data-slot');
      b.onclick = () => { padSlotForFile = slot; $('og-pad-file').click(); };
      ['dragenter', 'dragover'].forEach(ev => b.addEventListener(ev, e => { e.preventDefault(); b.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach(ev => b.addEventListener(ev, e => { e.preventDefault(); b.classList.remove('drag'); }));
      b.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files[0]) assignPad(slot, e.dataTransfer.files[0]); });
    });
    Array.prototype.forEach.call(grid.querySelectorAll('.og-pad[data-pad]'), b => {
      const id = b.getAttribute('data-pad'); const p = padById(id);
      b.onclick = (e) => { if (e.target.closest('.og-pad-edit')) { selectedPadId = id; renderPads(); renderPadInspector(); return; } firePad(p); };
      ['dragenter', 'dragover'].forEach(ev => b.addEventListener(ev, e => { e.preventDefault(); b.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach(ev => b.addEventListener(ev, e => { e.preventDefault(); b.classList.remove('drag'); }));
      b.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files[0]) assignPad(p.slot, e.dataTransfer.files[0]); });
    });
  }
  function renderPadLive(id) { const b = document.querySelector('.og-pad[data-pad="' + id + '"]'); const rt = padRT.get(id); if (b) b.classList.toggle('live', !!(rt && rt.voices.length)); }
  let padSlotForFile = 0;
  let listeningPadKey = false;

  function renderPadInspector() {
    const box = $('og-pad-inspector'); if (!box) return;
    const p = padById(selectedPadId);
    if (!p) { box.innerHTML = '<div class="og-insp-empty">Select a pad’s ' + sym('action.more') + ' to edit it, or drop a sound on an empty pad.</div>'; return; }
    const eq = p.eq || (p.eq = { low: 0, mid: 0, high: 0 });
    box.innerHTML =
      field('Name', '<input id="og-p-name" type="text" value="' + esc(p.name) + '">') +
      '<div class="og-field-row">' +
        field('Hotkey', '<button class="og-bar-btn og-p-key" id="og-p-key">' + (p.key ? keyLabel(p.key) : 'Set key') + '</button>') +
        field('Retrigger', '<select id="og-p-retrig">' + opt('restart', 'Restart', p.retrigger) + opt('poly', 'Layer', p.retrigger) + opt('toggle', 'Toggle', p.retrigger) + '</select>') +
      '</div>' +
      sub('Audio') +
      field('Level <span class="og-cue-meter"><span class="og-cue-meter-fill" id="og-pad-meter-fill"></span></span>', '<input id="og-p-gain" type="range" min="0" max="1" step="0.01" value="' + (p.gain == null ? 1 : p.gain) + '">') +
      '<div class="og-field-row3">' +
        field('Low', '<input id="og-p-eqlow" type="range" min="-12" max="12" step="0.5" value="' + (eq.low || 0) + '">') +
        field('Mid', '<input id="og-p-eqmid" type="range" min="-12" max="12" step="0.5" value="' + (eq.mid || 0) + '">') +
        field('High', '<input id="og-p-eqhigh" type="range" min="-12" max="12" step="0.5" value="' + (eq.high || 0) + '">') +
      '</div>' +
      '<label class="og-check"><input id="og-p-comp" type="checkbox"' + (p.comp ? ' checked' : '') + '> Compressor</label>' +
      sub('Edit') +
      '<div class="og-field-row3">' +
        field('Fade in', '<input id="og-p-fadein" type="number" min="0" step="0.1" value="' + (p.fadeIn || 0) + '">') +
        field('Trim in', '<input id="og-p-trimin" type="number" min="0" step="0.1" value="' + (p.trimIn || 0) + '">') +
        field('Loop', '<select id="og-p-loop">' + opt('0', 'No', p.loop ? '1' : '0') + opt('1', 'Yes', p.loop ? '1' : '0') + '</select>') +
      '</div>' +
      field('Color', '<div class="og-swatches">' + ['var(--purple)', 'var(--cyan)', 'var(--green)', 'var(--yellow)', 'var(--red)', 'var(--video)'].map(col =>
        '<button class="og-swatch' + (p.color === col ? ' sel' : '') + '" data-col="' + col + '" style="background:' + col + '" aria-label="Set pad color"></button>').join('') + '</div>') +
      '<div class="og-pad-actions"><button class="og-bar-btn" id="og-p-fire">' + sym('media.play') + ' Fire</button><button class="og-cue-del og-p-clear" id="og-p-clear">' + sym('action.delete') + ' Clear pad</button></div>';

    const b = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
    const live = () => { const rt = padRT.get(p.id); if (rt) applyChannel(rt.ch, { eq: p.eq, comp: p.comp }); };
    b('og-p-name', 'oninput', e => { p.name = e.target.value; renderPads(); scheduleSave(); });
    b('og-p-retrig', 'onchange', e => { p.retrigger = e.target.value; scheduleSave(); });
    b('og-p-gain', 'oninput', e => { p.gain = clamp(parseFloat(e.target.value), 0, 1); const rt = padRT.get(p.id); if (rt) rt.ch.gain.gain.value = p.gain; scheduleSave(); });
    b('og-p-eqlow', 'oninput', e => { p.eq.low = parseFloat(e.target.value) || 0; live(); scheduleSave(); });
    b('og-p-eqmid', 'oninput', e => { p.eq.mid = parseFloat(e.target.value) || 0; live(); scheduleSave(); });
    b('og-p-eqhigh', 'oninput', e => { p.eq.high = parseFloat(e.target.value) || 0; live(); scheduleSave(); });
    b('og-p-comp', 'onchange', e => { p.comp = e.target.checked; live(); scheduleSave(); });
    b('og-p-fadein', 'onchange', e => { p.fadeIn = Math.max(0, parseFloat(e.target.value) || 0); scheduleSave(); });
    b('og-p-trimin', 'onchange', e => { p.trimIn = Math.max(0, parseFloat(e.target.value) || 0); scheduleSave(); });
    b('og-p-loop', 'onchange', e => { p.loop = e.target.value === '1'; scheduleSave(); });
    b('og-p-fire', 'onclick', () => firePad(p));
    b('og-p-clear', 'onclick', () => clearPad(p.id));
    b('og-p-key', 'onclick', () => {
      const btn = $('og-p-key'); btn.textContent = 'press a key…'; listeningPadKey = true;
      const onk = (ev) => {
        ev.preventDefault(); document.removeEventListener('keydown', onk, true); listeningPadKey = false;
        if (ev.key === 'Escape') { p.key = ''; } else { const v = ev.key === ' ' ? ' ' : ev.key; pads.forEach(x => { if (x !== p && x.key === v) x.key = ''; }); p.key = v; }
        renderPads(); renderPadInspector(); scheduleSave();
      };
      document.addEventListener('keydown', onk, true);
    });
    Array.prototype.forEach.call(box.querySelectorAll('.og-swatch'), sw => { sw.onclick = () => { p.color = sw.getAttribute('data-col'); renderPads(); renderPadInspector(); scheduleSave(); }; });
  }

  // ── tabs ─────────────────────────────────────────────────────────────────
  function setTab(t) {
    settings.tab = t;
    $('og-stage').classList.toggle('sfx', t === 'sfx');
    $('og-tab-play').classList.toggle('on', t === 'play');
    $('og-tab-sfx').classList.toggle('on', t === 'sfx');
    if (t === 'sfx') ensureAudio();
    scheduleSave();
  }

  // ── autosave + recovery ──────────────────────────────────────────────────
  function showKey() { return SHOW_KEY + (sessionCode ? '_' + sessionCode : ''); }
  function scheduleSave() { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(saveShow, 500); }
  async function saveShow() {
    saveTimer = null;
    try { await idbPut(SHOW_STORE, showKey(), { schema: SCHEMA, savedAt: Date.now(), activeCueId: active ? active.cue.id : null, cues, pads, outputs, selectedId, settings }); } catch (e) {}
  }
  async function loadShow() {
    const s = await idbGet(SHOW_STORE, showKey());
    if (!s || !Array.isArray(s.cues)) { outputs = defaultOutputs(); sdMap = {}; return null; }
    cues = s.cues.map(c => Object.assign(makeCue({ type: c.type }), c, { eq: Object.assign({ low: 0, mid: 0, high: 0 }, c.eq || {}) }));
    pads = Array.isArray(s.pads) ? s.pads.map(p => Object.assign({ eq: { low: 0, mid: 0, high: 0 }, gain: 1, retrigger: 'restart', fadeIn: 0, trimIn: 0 }, p, { eq: Object.assign({ low: 0, mid: 0, high: 0 }, p.eq || {}) })) : [];
    outputs = (Array.isArray(s.outputs) && s.outputs.length) ? s.outputs.map(o => Object.assign({ screenId: null, sinkId: null, audioOn: false }, o)) : defaultOutputs();
    selectedId = s.selectedId || (cues[0] && cues[0].id) || null;
    settings = Object.assign(DEFAULT_SETTINGS(), s.settings || {});
    settings.shortcuts = Object.assign({}, DEFAULT_SHORTCUTS, settings.shortcuts || {});
    sdMap = settings.sdMap = settings.sdMap || {};
    renumber();
    pads.forEach(p => { if (p.mediaId) decodeBuffer(p.mediaId); });   // warm pad buffers for instant trigger
    return s;
  }
  function showRecovery(s) {
    const bar = $('og-recovery'); if (!bar) return;
    const wasPlaying = s && s.activeCueId && cueById(s.activeCueId);
    if (!s || (!cues.length && !pads.length)) { bar.classList.remove('on'); return; }
    const cw = cues.length + ' cue' + (cues.length === 1 ? '' : 's') + (pads.length ? ' · ' + pads.length + ' pad' + (pads.length === 1 ? '' : 's') : '');
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
    if (listeningPadKey) return;
    if ($('og-help').classList.contains('on')) { if (e.key === 'Escape') closeHelp(); return; }
    if ($('og-outputs').classList.contains('on')) { if (e.key === 'Escape') closeOutputsPanel(); return; }
    if ($('og-sd').classList.contains('on')) { if (e.key === 'Escape') closeSdPanel(); return; }
    if ($('og-join') && $('og-join').classList.contains('on')) return;
    if (typingTarget(e)) return;
    const sc = settings.shortcuts, k = e.key;
    const match = (bound) => bound && (bound.length === 1 ? k.toLowerCase() === bound.toLowerCase() : k === bound);
    if (k === sc.panic) { e.preventDefault(); panic(); return; }
    if (match(sc.go)) { e.preventDefault(); if (!e.repeat) go(); return; }
    if (e.repeat) return;
    if (match(sc.stop)) { e.preventDefault(); stopAll(); return; }
    if (match(sc.pause)) { e.preventDefault(); pauseResume(); return; }
    if (match(sc.fadeStop)) { e.preventDefault(); fadeStopAll(); return; }
    // SFX pad hotkeys (fire independently of and simultaneously with the program)
    const pad = pads.find(p => p.key && (p.key.length === 1 ? k.toLowerCase() === p.key.toLowerCase() : k === p.key));
    if (pad) { e.preventDefault(); firePad(pad); return; }
    if (k === 'ArrowDown') { e.preventDefault(); moveSelection(1); return; }
    if (k === 'ArrowUp') { e.preventDefault(); moveSelection(-1); return; }
    if (k === 'Tab') { e.preventDefault(); setTab(settings.tab === 'play' ? 'sfx' : 'play'); return; }
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
    ).join('')
      + '<div class="og-help-row" style="color:var(--text2)"><span>Select prev / next</span><span>↑ / ↓ (fixed)</span></div>'
      + '<div class="og-help-row" style="border:none;color:var(--text2)"><span>Switch Playback / SFX</span><span>Tab (fixed)</span></div>'
      + '<div class="og-help-row" style="border:none;color:var(--text2)"><span>SFX pads</span><span>per-pad hotkeys (set on the board)</span></div>';
    Array.prototype.forEach.call(body.querySelectorAll('input[data-sc]'), inp => {
      inp.onkeydown = (ev) => { ev.preventDefault(); const key = inp.getAttribute('data-sc'); const v = ev.key === ' ' ? ' ' : ev.key; settings.shortcuts[key] = v; inp.value = keyLabel(v); renderFoot(); renderTransportKeys(); scheduleSave(); };
      inp.onfocus = () => { inp.value = 'press a key…'; };
      inp.onblur = () => { inp.value = keyLabel(settings.shortcuts[inp.getAttribute('data-sc')]); };
    });
    $('og-help').classList.add('on');
  }
  function closeHelp() { $('og-help').classList.remove('on'); }

  // ── lock / footer ─────────────────────────────────────────────────────────
  function toggleLock() { settings.showLock = !settings.showLock; $('outangutan').classList.toggle('locked', settings.showLock); $('og-lock-btn').classList.toggle('on', settings.showLock); toast(settings.showLock ? 'Show mode locked — edits disabled.' : 'Show mode unlocked.'); scheduleSave(); }
  function renderFoot() {
    const f = $('og-foot-keys'); if (!f) return;
    const sc = settings.shortcuts;
    f.innerHTML = '<span class="og-kbd">' + keyLabel(sc.go) + '</span> GO · '
      + '<span class="og-kbd">' + keyLabel(sc.stop) + '</span> Stop · '
      + '<span class="og-kbd">' + keyLabel(sc.pause) + '</span> Pause · '
      + '<span class="og-kbd">' + keyLabel(sc.fadeStop) + '</span> Fade·Stop · '
      + '<span class="og-kbd">' + keyLabel(sc.panic) + '</span> PANIC · '
      + '<span class="og-kbd">Tab</span> SFX';
  }

  // ── DOM build ────────────────────────────────────────────────────────────
  function build() {
    const root = $('outangutan'); if (!root || built) return;
    root.innerHTML =
      '<div class="og-bar">'
        + '<button class="og-back" id="og-back">' + sym('action.back') + '<span>Cueola</span></button>'
        + '<div class="og-title"><span class="og-glyph">🦧</span>Out<span class="og-wm-hi">rangutan</span></div>'
        + '<span class="og-mode-badge" id="og-mode-badge">Standalone</span>'
        + '<div class="og-tabs"><button class="og-tab on" id="og-tab-play">' + sym('content.display') + 'Playback</button><button class="og-tab" id="og-tab-sfx">' + sym('action.grid') + 'SFX Board</button></div>'
        + '<div class="og-bar-spacer"></div>'
        + '<button class="og-bar-btn" id="og-output-btn" title="Manage output windows &amp; displays">' + sym('content.display') + 'Outputs</button>'
        + '<button class="og-bar-btn" id="og-sd-btn" title="Stream Deck control (WebHID)">' + sym('action.grid') + 'Stream Deck</button>'
        + '<button class="og-bar-btn" id="og-lock-btn" title="Lock edits during the show">Show Lock</button>'
        + '<button class="og-bar-btn" id="og-help-btn" title="Keyboard shortcuts">' + sym('action.guide') + 'Shortcuts</button>'
      + '</div>'
      + '<div class="og-recovery" id="og-recovery"><span id="og-recovery-text"></span><div class="og-bar-spacer"></div>'
        + '<button id="og-recovery-standby">Standby that cue</button><button id="og-recovery-dismiss">Dismiss</button></div>'
      + '<div class="og-stage" id="og-stage">'
        // ── PLAYBACK ──
        + '<div class="og-main">'
          + '<div class="og-pane og-cuelist-pane">'
            + '<div class="og-pane-head">Cue List<div class="og-pane-actions"><button class="og-bar-btn" id="og-add-btn">Add media</button></div></div>'
            + '<div class="og-cuelist" id="og-cuelist"></div>'
            + '<button class="og-cue-add" id="og-cue-add">Drop video / audio here, or click to add</button>'
            + '<input type="file" id="og-file-input" accept="video/*,audio/*" multiple hidden>'
          + '</div>'
          + '<div class="og-pane og-program-pane">'
            + '<div class="og-pane-head">Program<div class="og-pane-actions"><span class="og-master"><span class="og-master-lbl">MASTER</span><span class="og-meter"><span class="og-meter-fill" id="og-master-fill"></span><span class="og-meter-peak" id="og-master-peak"></span></span></span><span class="og-wallclock" id="og-wallclock" title="Time of day">' + sym('state.timed') + '<span id="og-wallclock-t">--:--:--</span></span></div></div>'
            + '<div class="og-program-wrap"><span class="og-program-tag">PROGRAM</span><span class="og-program-status og-status-idle" id="og-program-status">IDLE</span>'
              + '<video id="og-program-a" class="og-deck front" playsinline></video><video id="og-program-b" class="og-deck" playsinline></video></div>'
            + '<div class="og-clock" id="og-clock"><div class="og-clock-time" id="og-clock-time">0:00</div><div class="og-clock-label" id="og-clock-label">STANDBY</div><div class="og-clock-cue" id="og-clock-cue">—</div></div>'
            + '<div class="og-transport">'
              + '<button class="og-tbtn" id="og-stop">' + sym('media.stop') + 'Stop<span class="og-tbtn-key" id="og-k-stop"></span></button>'
              + '<button class="og-tbtn og-tbtn-go" id="og-go">' + sym('media.play') + 'GO<span class="og-tbtn-key" id="og-k-go"></span></button>'
              + '<button class="og-tbtn" id="og-pause">' + sym('media.pause') + 'Pause<span class="og-tbtn-key" id="og-k-pause"></span></button>'
              + '<button class="og-tbtn" id="og-fade">' + sym('action.down') + 'Fade Out<span class="og-tbtn-key" id="og-k-fade"></span></button>'
              + '<button class="og-tbtn og-tbtn-panic" id="og-panic">' + sym('action.power') + 'PANIC<span class="og-tbtn-key" id="og-k-panic"></span></button>'
            + '</div>'
          + '</div>'
          + '<div class="og-pane og-inspector-pane">'
            + '<div class="og-pane-head">Inspector</div><div class="og-inspector" id="og-inspector"></div>'
          + '</div>'
        + '</div>'
        // ── SFX ──
        + '<div class="og-sfx">'
          + '<div class="og-pane og-sfx-main">'
            + '<div class="og-pane-head">SFX Board<div class="og-pane-actions"><label class="og-check og-check-inline"><input type="checkbox" id="og-multi"> Multi-trigger</label><button class="og-bar-btn" id="og-sfx-stop">' + sym('media.stop') + 'Stop SFX</button></div></div>'
            + '<div class="og-pad-grid" id="og-pad-grid"></div>'
            + '<input type="file" id="og-pad-file" accept="audio/*,video/*" hidden>'
          + '</div>'
          + '<div class="og-pane og-sfx-side">'
            + '<div class="og-pane-head">Pad Inspector<div class="og-pane-actions"><span class="og-master"><span class="og-master-lbl">MASTER</span><span class="og-meter"><span class="og-meter-fill" id="og-master-fill2"></span></span></span></div></div>'
            + '<div class="og-sfx-master"><label class="og-field"><span>Master level</span><input type="range" id="og-master-gain" min="0" max="1.2" step="0.01" value="1"></label></div>'
            + '<div class="og-pad-inspector" id="og-pad-inspector"></div>'
          + '</div>'
        + '</div>'
      + '</div>'
      + '<div class="og-foot"><span id="og-foot-keys"></span><div class="og-foot-spacer"></div><span id="og-foot-mode">Local-first · IndexedDB · Web Audio</span></div>'
      + '<audio id="og-audio-deck"></audio>'
      + '<div class="og-help" id="og-help"><div class="og-help-card"><h3>Keyboard shortcuts</h3><div id="og-help-rows"></div>'
        + '<p style="color:var(--text2);font-size:12px;margin:12px 0 0">Click a field and press a key to rebind. GO and PANIC are always reachable by keyboard.</p>'
        + '<button class="og-help-close" id="og-help-close">Done</button></div></div>'
      + '<div class="og-sheet" id="og-outputs"><div class="og-sheet-card"><div class="og-sheet-head"><h3>' + sym('content.display') + ' Outputs &amp; displays</h3><button class="og-sheet-x" id="og-outputs-x">Done</button></div><div id="og-outputs-body"></div></div></div>'
      + '<div class="og-sheet" id="og-sd"><div class="og-sheet-card"><div class="og-sheet-head"><h3>' + sym('action.grid') + ' Stream Deck</h3><button class="og-sheet-x" id="og-sd-x">Done</button></div><div id="og-sd-body"></div></div></div>'
      + '<div class="og-join" id="og-join"><div class="og-join-card">'
        + '<div class="og-join-glyph">🦧</div><h3>Join a session</h3>'
        + '<p>Enter your show’s session code to tie Outrangutan to it — the same code Cueola, Planda Bear, and Flowmingo use. Live cross-device cue sync arrives in Phase 4; for now your cue list is saved under this code on this device.</p>'
        + '<input id="og-join-code" placeholder="SESSION CODE" autocomplete="off" autocapitalize="characters" spellcheck="false">'
        + '<div class="og-join-err" id="og-join-err"></div>'
        + '<button class="og-join-go" id="og-join-go">Join Session</button>'
        + '<button class="og-join-skip" id="og-join-skip">Continue without a session</button>'
      + '</div></div>';

    // program decks reference
    decks = {
      a: { id: 'a', kind: 'video', el: $('og-program-a'), src: null, ch: null, vol: 1, _url: null },
      b: { id: 'b', kind: 'video', el: $('og-program-b'), src: null, ch: null, vol: 1, _url: null },
      audio: { id: 'audio', kind: 'audio', el: $('og-audio-deck'), src: null, ch: null, vol: 1, _url: null },
    };
    decks.a.el.style.opacity = 1; decks.b.el.style.opacity = 0;

    // wire static controls
    $('og-back').onclick = exitOutangutan;
    $('og-tab-play').onclick = () => setTab('play');
    $('og-tab-sfx').onclick = () => setTab('sfx');
    $('og-output-btn').onclick = openOutputsPanel;
    $('og-sd-btn').onclick = openSdPanel;
    $('og-lock-btn').onclick = toggleLock;
    $('og-help-btn').onclick = openHelp;
    $('og-help-close').onclick = closeHelp;
    $('og-outputs-x').onclick = closeOutputsPanel;
    $('og-sd-x').onclick = closeSdPanel;
    $('og-join-go').onclick = joinSession;
    $('og-join-skip').onclick = joinStandaloneInstead;
    $('og-join-code').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); joinSession(); } else if (e.key === 'Escape') { e.preventDefault(); joinStandaloneInstead(); } });
    $('og-go').onclick = go;
    $('og-stop').onclick = () => stopAll();
    $('og-pause').onclick = pauseResume;
    $('og-fade').onclick = fadeStopAll;
    $('og-panic').onclick = panic;
    $('og-clock').onclick = () => { settings.clockMode = settings.clockMode === 'remaining' ? 'elapsed' : 'remaining'; renderClock(); scheduleSave(); };
    $('og-recovery-dismiss').onclick = () => $('og-recovery').classList.remove('on');
    $('og-sfx-stop').onclick = stopAllPads;
    $('og-multi').onchange = (e) => { settings.multiTrigger = e.target.checked; scheduleSave(); };
    $('og-master-gain').oninput = (e) => { ensureAudio(); setMasterGain(parseFloat(e.target.value)); scheduleSave(); };

    const fileInput = $('og-file-input');
    $('og-add-btn').onclick = () => fileInput.click();
    $('og-cue-add').onclick = () => fileInput.click();
    fileInput.onchange = () => { importFiles(fileInput.files); fileInput.value = ''; };
    const padFile = $('og-pad-file');
    padFile.onchange = () => { if (padFile.files[0]) assignPad(padSlotForFile, padFile.files[0]); padFile.value = ''; };

    // drag & drop onto the cue pane
    const dropZone = $('og-cue-add'), listPane = root.querySelector('.og-cuelist-pane');
    ['dragenter', 'dragover'].forEach(ev => listPane.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => listPane.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === listPane) dropZone.classList.remove('drag'); }));
    listPane.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });

    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', () => { if (cues.length || pads.length) saveShow(); });

    built = true;
    renderTransportKeys();

    const pad2 = n => String(n).padStart(2, '0');
    setInterval(() => { const t = $('og-wallclock-t'); if (!t || !isOpen()) return; const d = new Date(); t.textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }, 1000);
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
    renderTransportKeys(); renderAll();
    setTab(settings.tab || 'play');
    const mc = $('og-multi'); if (mc) mc.checked = !!settings.multiTrigger;
    const mg = $('og-master-gain'); if (mg) mg.value = settings.masterGain == null ? 1 : settings.masterGain;
    if (s) showRecovery(s); else $('og-recovery').classList.remove('on');
    setModeBadge();
  }
  async function enterOutangutan(m) {
    build(); ensureChannel(); showScreen();
    if (m === 'session') openSessionJoin();
    else { mode = 'standalone'; sessionCode = null; closeSessionJoin(); await applyShow(); }
  }

  function openSessionJoin() {
    mode = 'session';
    const sheet = $('og-join'); if (!sheet) { applyShow(); return; }
    const input = $('og-join-code');
    let pre = sessionCode || '';
    try { pre = pre || localStorage.getItem('cueola_outangutan_code') || (window.session && window.session.code) || localStorage.getItem('cueola_last_code') || ''; } catch (e) {}
    if (input) input.value = pre;
    const err = $('og-join-err'); if (err) err.textContent = '';
    renderTransportKeys(); renderAll();
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
    closeSessionJoin(); await applyShow();
    toast('Joined session ' + code + '. Live cross-device cue sync arrives in Phase 4 — your cue list is saved under this code on this device.');
  }
  async function joinStandaloneInstead() { mode = 'standalone'; sessionCode = null; closeSessionJoin(); await applyShow(); }

  function exitOutangutan() {
    stopAll({ silent: true }); stopAllPads(); closeSessionJoin();
    outputs.forEach(o => { const r = outputWins.get(o.id); if (r && r.identify) identifyOutput(o.id, false); });
    closeOutputsPanel(); closeSdPanel();
    $('outangutan').classList.remove('on');
    const entry = $('entry'); if (entry) entry.classList.add('on');
    try { if (typeof window.pushSessionHistoryState === 'function') window.pushSessionHistoryState('entry'); } catch (e) {}
  }

  // ── exports ──────────────────────────────────────────────────────────────
  window.enterOutangutan = enterOutangutan;
  window.exitOutangutan = exitOutangutan;
  window.Outangutan = { enter: enterOutangutan, exit: exitOutangutan, _state: () => ({ cues, pads, outputs, sdMap, selectedId, settings, active: active && active.cue.id, mode }) };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { if ($('outangutan')) build(); }, { once: true });
  else if ($('outangutan')) build();
})();
