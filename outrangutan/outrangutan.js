/* ============================================================================
 * Outrangutan 🦧 — web playback & cue system for Cueola.
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
 * `enterX()` screen pattern. Self-contained in /outrangutan.
 * Build for Chromium (Chrome/Edge) first; degrade gracefully elsewhere.
 * ==========================================================================*/
(function () {
  'use strict';

  // ── constants ──────────────────────────────────────────────────────────
  const DB_NAME = 'outrangutan', DB_VER = 1;
  const MEDIA_STORE = 'media', SHOW_STORE = 'show', SHOW_KEY = 'current';
  const OUTPUT_CHANNEL = 'outrangutan-output';
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
    clockMode: 'remaining', wallClockMode: '24', multiTrigger: true, showLock: false, tab: 'play',
    fadeCurve: 'linear', masterGain: 1, masterSinkId: null, sdMap: {}, midiMap: {}, transcode: false,
    layout: { wCuelist: 280, wInspector: 280, hEdit: 150 }, shortcuts: Object.assign({}, DEFAULT_SHORTCUTS),
  });
  const defaultOutputs = () => ([{ id: 1, label: 'Output 1', screenId: null, sinkId: null, audioOn: false }]);
  const THEME_ORDER = ['cool','warm','white','green','koala','panda','flamingo','outrangutan','prepbear'];
  const THEME_LABELS = {
    cool:'Glacier', warm:'Honey', white:'Polar Bear', green:'Eucalyptus',
    koala:'Koala', panda:'Planda Bear', flamingo:'Flowmingo',
    outrangutan:'Outrangutan', prepbear:'PrepBear',
  };
  const THEME_PREVIEWS = {
    cool:'#0a0d18', warm:'#ffc400', white:'#fafaf7', green:'#041208',
    koala:'#1c1c1b', panda:'#000000', flamingo:'#0e0410',
    outrangutan:'#ff6a00', prepbear:'#080a14',
  };

  // ── state ──────────────────────────────────────────────────────────────
  let built = false;
  let showLoaded = false;         // true once applyShow() has hydrated state from IndexedDB — until then, writing a pad would clobber the saved show
  let mode = 'standalone';
  let sessionCode = null;
  let sessionUserName = '';       // name entered on the join splash (parity with other modules)
  let cues = [];
  let pads = [];                 // SFX pads: [{ id, slot, bank, name, emoji, mediaId, color, key, gain, ... }]
  let banks = [];                // SFX banks (pages): [{ id, name }]
  let currentBankId = null;      // active SFX bank
  let bankRenamingId = null;     // SFX bank being inline-renamed
  let padSearch = '';            // SFX search query
  let selectedId = null;         // standby cue
  let selectedPadId = null;      // pad in the SFX inspector
  let settings = DEFAULT_SETTINGS();
  let themeObserver = null;

  let active = null;             // { cue, kind, deck:'a'|'b'|'audio'|'img', el, ch } — running program cue
  let preTimer = null, preInfo = null;
  let rafId = null, saveTimer = null;
  let pendingResume = null;      // { cueId, offset } — recovered pause point; next fire of that cue starts there
  let lastTransportSave = 0;     // throttles playhead persistence during playback

  // ── multi-output (Phase 3) ───────────────────────────────────────────────
  let bc = null;
  let outputMessageSeq = 0;
  let outputWindowListenerReady = false;
  const outputMessageIds = new Set();
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
  const filmstripCache = new Map(); // mediaId -> [frameDataURL,...] (Clip Editor filmstrip)
  const filmstripJobs = new Map();  // mediaId -> Promise<frames|null>
  const FILMSTRIP_FRAMES = 14;
  const padRT = new Map();       // padId -> { ch, voices:[], buffer }
  const fades = new Map();       // fade token -> rAF id
  let meterRAF = null;

  // ── tiny helpers ───────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const rid = (p) => p + Math.random().toString(36).slice(2, 9);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function toast(msg) { try { if (typeof window.toast === 'function') return window.toast(msg); } catch (e) {} console.log('[outrangutan]', msg); }
  // P7: same-tab bridge into Cueola's structured show log — cue fires, media
  // failures, and transport hits land in the same per-session record.
  function slog(cat, msg) { try { window.CueolaShowLog && window.CueolaShowLog.add(cat, '[Outrangutan] ' + msg); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function fmtClock(sec) { sec = Math.max(0, sec || 0); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60); return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0'); }
  // SMPTE timecode HH:MM:SS;FF for the big count clock (30 fps frame base).
  const OG_FPS = 30;
  function fmtSmpte(sec) { sec = Math.max(0, sec || 0); const t = Math.floor(sec), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60, f = Math.min(OG_FPS - 1, Math.floor((sec - t) * OG_FPS)); const p = n => String(n).padStart(2, '0'); return p(h) + ':' + p(m) + ':' + p(s) + ';' + p(f); }
  function keyLabel(k) { return !k ? '—' : (k === ' ' ? 'Space' : (k === 'Escape' ? 'Esc' : k.toUpperCase())); }
  function sym(name, cls) { try { if (typeof window.sfIcon === 'function') return window.sfIcon(name, cls || ''); } catch (e) {} return '<span class="sf-symbol ' + (cls || '') + '" data-symbol="' + name + '" aria-hidden="true"></span>'; }
  function assetIcon(name, cls) { return '<span class="og-svg-icon og-icon-' + name + (cls ? ' ' + cls : '') + '" aria-hidden="true"></span>'; }
  function currentCueolaTheme() {
    return document.documentElement.getAttribute('data-theme') || localStorage.getItem('cueola_theme') || 'cool';
  }
  function renderThemeControl() {
    const current = THEME_ORDER.includes(currentCueolaTheme()) ? currentCueolaTheme() : 'cool';
    const label = $('og-theme-label');
    const list = $('og-theme-options');
    if (label) label.textContent = THEME_LABELS[current] || 'Theme';
    if (!list) return;
    list.innerHTML = THEME_ORDER.map(name => {
      const active = name === current;
      const previewClass = 'ts-preview';
      const style = ' style="background:' + esc(THEME_PREVIEWS[name] || '#222') + '"';
      return '<button type="button" class="theme-swatch' + (active ? ' active' : '') + '" data-theme="' + name + '" aria-pressed="' + (active ? 'true' : 'false') + '">'
        + '<div class="' + previewClass + '"' + style + '></div>'
        + '<div class="ts-name">' + esc(THEME_LABELS[name] || name) + '</div>'
      + '</button>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('.theme-swatch'), btn => {
      btn.onclick = () => setCueolaThemeFromOutrangutan(btn.getAttribute('data-theme'));
    });
  }
  function setCueolaThemeFromOutrangutan(name) {
    if (!THEME_ORDER.includes(name)) return;
    if (typeof window.pickEntryTheme === 'function') window.pickEntryTheme(name);
    else if (typeof window.selectTheme === 'function') {
      window.selectTheme(name);
      try { localStorage.setItem('cueola_theme', name); } catch (e) {}
    }
    else {
      document.documentElement.setAttribute('data-theme', name);
      try { localStorage.setItem('cueola_theme', name); } catch (e) {}
    }
    renderThemeControl();
    const menu = $('og-theme-menu');
    if (menu) menu.open = false;
  }
  function watchCueolaTheme() {
    if (themeObserver) return;
    try {
      themeObserver = new MutationObserver(renderThemeControl);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    } catch (e) {}
  }

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
        // True stereo tap for the program VU: split the master bus into L/R and
        // meter each channel independently (the mono `an` above still drives the
        // horizontal master fills). Splitter analysers are passive taps — no need
        // to connect them onward to the destination.
        const splitter = ac.createChannelSplitter(2);
        const anL = ac.createAnalyser(); anL.fftSize = 1024; anL.smoothingTimeConstant = 0.6;
        const anR = ac.createAnalyser(); anR.fftSize = 1024; anR.smoothingTimeConstant = 0.6;
        g.connect(splitter); splitter.connect(anL, 0); splitter.connect(anR, 1);
        master = {
          gain: g, analyser: an, buf: new Uint8Array(an.fftSize),
          analyserL: anL, bufL: new Uint8Array(anL.fftSize),
          analyserR: anR, bufR: new Uint8Array(anR.fftSize),
        };
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
  function setMasterGain(v, sourceId) { settings.masterGain = clamp(v, 0, 1.2); if (master) master.gain.gain.value = settings.masterGain; syncMasterGainInputs(sourceId); }
  function syncMasterGainInputs(skip) {
    ['og-master-gain', 'og-master-gain-play'].forEach(id => {
      if (id === skip) return;
      const input = $(id);
      if (input) input.value = settings.masterGain == null ? 1 : settings.masterGain;
    });
  }

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
  // Probe on import: duration, dimensions, thumbnail — and REJECT anything this
  // browser can't decode (unsupported codec/container, damaged file), so
  // failures surface at import time, never at showtime. 8 s stall guard.
  function probeMedia(blob, kind) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
      let settled = false;
      const finish = (res) => { if (settled) return; settled = true; clearTimeout(guard); URL.revokeObjectURL(url); resolve(res); };
      const fail = (why) => finish({ ok: false, error: why || 'undecodable', duration: 0, thumb: null, width: 0, height: 0 });
      const guard = setTimeout(() => fail('timed out reading metadata'), 8000);
      el.preload = 'metadata'; el.muted = true; el.src = url;
      el.onerror = () => fail((el.error && el.error.message) || 'undecodable');
      el.onloadedmetadata = () => {
        const duration = isFinite(el.duration) ? el.duration : 0;
        const width = el.videoWidth || 0, height = el.videoHeight || 0;
        if (kind !== 'video') return finish({ ok: true, duration, thumb: null, width: 0, height: 0 });
        if (!width || !height) return fail('no decodable video track');
        const t = Math.min(Math.max(0.1, duration * 0.1), Math.max(0.1, duration - 0.05));
        el.onseeked = () => {
          try {
            const c = document.createElement('canvas');
            const w = 160, h = Math.max(1, Math.round(w * height / width));
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(el, 0, 0, w, h);
            finish({ ok: true, duration, thumb: c.toDataURL('image/jpeg', 0.6), width, height });
          } catch (e) { finish({ ok: true, duration, thumb: null, width, height }); }
        };
        try { el.currentTime = t; } catch (e) { finish({ ok: true, duration, thumb: null, width, height }); }
      };
    });
  }
  // Stills probe: dimensions + thumbnail via Image() (PNG/JPEG/WebP/SVG/GIF).
  function probeImage(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const im = new Image();
      let settled = false;
      const finish = (res) => { if (settled) return; settled = true; clearTimeout(guard); URL.revokeObjectURL(url); resolve(res); };
      const fail = (why) => finish({ ok: false, error: why, duration: 0, thumb: null, width: 0, height: 0 });
      const guard = setTimeout(() => fail('timed out decoding image'), 8000);
      im.onload = () => {
        const width = im.naturalWidth || 0, height = im.naturalHeight || 0;
        if (!width || !height) return fail('empty image');
        let thumb = null;
        try {
          const c = document.createElement('canvas');
          const w = 160, h = Math.max(1, Math.round(w * height / width));
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(im, 0, 0, w, h);
          thumb = c.toDataURL('image/jpeg', 0.6);
        } catch (e) {}
        finish({ ok: true, duration: 0, thumb, width, height });
      };
      im.onerror = () => fail('undecodable image');
      im.src = url;
    });
  }
  // ── Waveform peaks (V2 Phase 5 item 3) ──
  // Pads: peaks come straight off the live AudioBuffer already in bufferCache.
  // Clips: a one-time OfflineAudioContext decode of the media's audio track;
  // the resulting peak strip (600 bytes) is persisted onto the media record in
  // IndexedDB, so every later open paints synchronously. Media ids are
  // immutable (new file = new id), so cached peaks never need invalidating.
  const WAVE_BUCKETS = 600;
  const peaksCache = new Map();   // mediaId -> Uint8Array — sync repaints during trim drags
  const peakJobs = new Map();     // mediaId -> Promise — dedupe concurrent builds
  function peaksFromAudioBuffer(buf, buckets) {
    const out = new Uint8Array(buckets);
    const chans = Math.min(buf.numberOfChannels || 1, 2);
    const len = buf.length;
    if (!len) return out;
    const per = len / buckets;
    for (let ch = 0; ch < chans; ch++) {
      const data = buf.getChannelData(ch);
      for (let b = 0; b < buckets; b++) {
        const start = Math.floor(b * per), end = Math.min(len, Math.ceil((b + 1) * per));
        let peak = 0;
        // sample within the bucket (stride keeps huge files cheap; ≥1 sample/bucket)
        const stride = Math.max(1, Math.floor((end - start) / 64));
        for (let i = start; i < end; i += stride) { const a = Math.abs(data[i]); if (a > peak) peak = a; }
        const v = Math.min(255, Math.round(peak * 255));
        if (v > out[b]) out[b] = v;
      }
    }
    return out;
  }
  function getWaveformPeaks(mediaId) {
    if (!mediaId) return Promise.resolve(null);
    if (peaksCache.has(mediaId)) return Promise.resolve(peaksCache.get(mediaId));
    if (peakJobs.has(mediaId)) return peakJobs.get(mediaId);
    const job = (async () => {
      try {
        const live = bufferCache.get(mediaId);   // pads: the playback buffer is already decoded
        if (live) {
          const peaks = peaksFromAudioBuffer(live, WAVE_BUCKETS);
          peaksCache.set(mediaId, peaks);
          idbGet(MEDIA_STORE, mediaId).then(m => { if (m && !m.peaks) idbPut(MEDIA_STORE, mediaId, { ...m, peaks }); }).catch(() => {});
          return peaks;
        }
        const m = await idbGet(MEDIA_STORE, mediaId);
        if (!m || !m.blob) return null;
        if (m.peaks && m.peaks.length) { peaksCache.set(mediaId, m.peaks); return m.peaks; }
        const raw = await m.blob.arrayBuffer();
        const octx = new OfflineAudioContext(1, 1, 44100);
        const buf = await octx.decodeAudioData(raw);   // one-time decode; buffer is NOT kept
        const peaks = peaksFromAudioBuffer(buf, WAVE_BUCKETS);
        peaksCache.set(mediaId, peaks);
        await idbPut(MEDIA_STORE, mediaId, { ...m, peaks }).catch?.(() => {});
        return peaks;
      } catch (e) { return null; }                     // no audio track / undecodable → no wave, no error
      finally { peakJobs.delete(mediaId); }
    })();
    peakJobs.set(mediaId, job);
    return job;
  }
  function paintWaveform(canvas, peaks) {
    if (!canvas || !peaks || !peaks.length) return;
    const W = canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1) || peaks.length;
    const H = canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1) || 48;
    const cx = canvas.getContext('2d');
    cx.clearRect(0, 0, W, H);
    const css = getComputedStyle(canvas);
    cx.fillStyle = css.color || 'rgba(34,211,160,.8)';
    const mid = H / 2;
    const barW = W / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const h = Math.max(1, (peaks[i] / 255) * (H * 0.94) / 2);
      cx.fillRect(i * barW, mid - h, Math.max(1, barW * 0.8), h * 2);   // mirrored bars
    }
  }
  // Paint (sync when cached) into a host element; async build fills in later.
  function mountWaveInto(host, mediaId) {
    if (!host || !mediaId) return;
    let canvas = host.querySelector('canvas.og-wave');
    if (!canvas) { canvas = document.createElement('canvas'); canvas.className = 'og-wave'; host.appendChild(canvas); }
    const cached = peaksCache.get(mediaId);
    if (cached) { paintWaveform(canvas, cached); return; }
    getWaveformPeaks(mediaId).then(peaks => {
      if (!peaks) { canvas.remove(); return; }
      // the editor may have re-rendered — repaint whatever canvas is live now
      const liveCanvas = host.isConnected ? canvas : document.querySelector('.og-wave');
      if (liveCanvas && liveCanvas.isConnected) paintWaveform(liveCanvas, peaks);
    });
  }

  // Build a filmstrip (row of frames) for a video clip — sampled across its duration.
  // Cached per mediaId; generated on demand the first time a video cue opens in the Clip Editor.
  function buildFilmstrip(mediaId, frames) {
    if (filmstripCache.has(mediaId)) return Promise.resolve(filmstripCache.get(mediaId));
    if (filmstripJobs.has(mediaId)) return filmstripJobs.get(mediaId);
    const job = (async () => {
      const media = await idbGet(MEDIA_STORE, mediaId);
      if (!media || !media.blob || media.kind !== 'video') return null;
      const url = URL.createObjectURL(media.blob);
      const v = document.createElement('video');
      v.preload = 'auto'; v.muted = true; v.playsInline = true; v.src = url;
      try {
        await new Promise((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error('meta')); });
        const dur = isFinite(v.duration) ? v.duration : 0;
        const W = 96, H = Math.max(1, Math.round(W * (v.videoHeight || 9) / (v.videoWidth || 16)));
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const cx = cv.getContext('2d');
        const out = [];
        for (let i = 0; i < frames; i++) {
          const t = dur > 0 ? Math.min(Math.max(0, dur - 0.04), dur * (i + 0.5) / frames) : 0;
          await new Promise((res) => { let fin = false; const done = () => { if (fin) return; fin = true; res(); }; v.onseeked = done; try { v.currentTime = t; } catch (e) { done(); } setTimeout(done, 1200); });
          try { cx.drawImage(v, 0, 0, W, H); out.push(cv.toDataURL('image/jpeg', 0.55)); } catch (e) { out.push(null); }
        }
        filmstripCache.set(mediaId, out);
        return out;
      } catch (e) { return null; }
      finally { URL.revokeObjectURL(url); filmstripJobs.delete(mediaId); }
    })();
    filmstripJobs.set(mediaId, job);
    return job;
  }
  async function storeFile(file) {       // import one file → MEDIA_STORE, return { mediaId, kind, duration, thumb, name }
    // Phase 5: transcode-on-upload — normalize non-web-playable video to H.264 MP4.
    if (settings.transcode && !webPlayable(file) && ((file.type || '').startsWith('video') || /\.(mov|mkv|avi|mxf|m2ts|ts)$/i.test(file.name || ''))) {
      file = await transcodeFile(file);
    }
    const t = file.type || '';
    const kind = t.startsWith('video') ? 'video' : t.startsWith('audio') ? 'audio' : t.startsWith('image') ? 'image' : null;
    if (!kind) { toast('Skipped "' + file.name + '" — not a video, audio, or image file.'); return null; }
    const blob = file.slice(0, file.size, file.type);
    const probe = kind === 'image' ? await probeImage(blob) : await probeMedia(blob, kind);
    if (!probe.ok) { slog('media', 'Import rejected: “' + file.name + '” — ' + (probe.error || 'unsupported or damaged')); toast('⚠ "' + file.name + '" can’t play in this browser (' + (probe.error || 'unsupported or damaged') + ') — not added.'); return null; }
    const mediaId = rid('m_');
    await idbPut(MEDIA_STORE, mediaId, { blob, name: file.name, mime: file.type, kind, duration: probe.duration, thumb: probe.thumb, width: probe.width || 0, height: probe.height || 0 });
    return { mediaId, kind, duration: probe.duration, thumb: probe.thumb, name: file.name, width: probe.width || 0, height: probe.height || 0 };
  }
  async function importFiles(fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    let added = 0;
    for (const file of files) {
      try {
        const m = await storeFile(file); if (!m) continue;
        cues.push(makeCue({ name: m.name.replace(/\.[^.]+$/, ''), type: m.kind, mediaId: m.mediaId, duration: m.duration, thumb: m.thumb, srcW: m.width, srcH: m.height }));
        added++;
      } catch (e) { toast('Could not import "' + file.name + '".'); }
    }
    if (added) { if (!selectedId) selectedId = cues[0].id; renumber(); renderAll(); scheduleSave(); toast(added + ' cue' + (added > 1 ? 's' : '') + ' added.'); }
  }

  // Colors/thumbs from an imported .ogshow are attacker-controllable — a crafted
  // file could stuff a style attribute with an image-onerror payload. Whitelist
  // the shapes we actually emit (hex, rgb/hsl, var(--token)); anything else falls
  // back to a safe default. Thumbs must be a data:image/ URL.
  function safeColor(v, fallback) {
    const s = String(v == null ? '' : v).trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
    if (/^(rgb|hsl)a?\([\d.,%\s/]+\)$/.test(s)) return s;
    if (/^var\(--[\w-]+\)$/.test(s)) return s;
    return fallback || 'var(--video)';
  }
  function safeThumb(v) {
    const s = String(v == null ? '' : v);
    return /^data:image\/(png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(s) ? s : null;
  }
  function sanitizeImportedShow(s) {
    if (Array.isArray(s.cues)) s.cues.forEach(c => { if (c) { c.color = safeColor(c.color); c.thumb = safeThumb(c.thumb); if (c.key) { c.key.color = safeColor(c.key.color, '#00b140'); c.key.bg = safeColor(c.key.bg, '#000000'); } } });
    if (Array.isArray(s.pads)) s.pads.forEach(p => { if (p) { p.color = safeColor(p.color, 'var(--accent)'); p.emoji = typeof p.emoji === 'string' ? p.emoji.slice(0, 4) : ''; } });
    return s;
  }

  function makeCue(o) {
    return {
      id: rid('c_'), num: 0, name: o.name || 'Untitled', type: o.type || 'video',
      mediaId: o.mediaId || null, color: o.type === 'audio' ? 'var(--green)' : (o.type === 'image' ? 'var(--yellow)' : 'var(--video)'),
      srcW: o.srcW || 0, srcH: o.srcH || 0, broken: false,
      preWait: 0, continueMode: 'manual', duration: o.duration || 0, thumb: o.thumb || null,
      trimIn: 0, trimOut: null, volume: 1, loop: false, armed: true, notes: '',
      // Phase 2 audio + fades + edits
      eq: { low: 0, mid: 0, high: 0 }, comp: false,
      fadeIn: 0, fadeOut: 0, fadeCurve: '', xfade: 0,
      endAction: 'stop',        // 'stop' | 'hold' | 'black'
      fit: 'contain', scale: 1, posX: 0, posY: 0,
      output: 1,                // target output window id (Phase 3 multi-output)
      key: { mode: 'off', color: '#00b140', sim: 0.30, smooth: 0.10, bg: '#000000' }, // Phase 5 keying
      obs: { action: 'none', scene: '' },   // OBS action on fire
      obsTriggerScene: '',                  // fire this cue when OBS switches to this scene
    };
  }
  function renumber() { cues.forEach((c, i) => { c.num = i + 1; }); clearPreload(); }   // order changed → staged next-cue is stale
  function cueById(id) { return cues.find(c => c.id === id) || null; }
  function cueIndex(id) { return cues.findIndex(c => c.id === id); }
  function nextArmedAfter(id) { let i = cueIndex(id); for (let j = i + 1; j < cues.length; j++) if (cues[j].armed !== false) return cues[j].id; return null; }
  function fadeCurveOf(cue) { return cue && cue.fadeCurve ? cue.fadeCurve : settings.fadeCurve; }

  // ── SFX banks + pads ───────────────────────────────────────────────────────
  function defaultBanks() { return [{ id: rid('bk_'), name: 'Bank 1' }]; }
  function ensureBanks() {
    if (!Array.isArray(banks) || !banks.length) banks = defaultBanks();
    if (!banks.find(b => b.id === currentBankId)) currentBankId = banks[0].id;
  }
  function padBySlot(slot) { return pads.find(p => (p.bank || (banks[0] && banks[0].id)) === currentBankId && p.slot === slot) || null; }
  function padById(id) { return pads.find(p => p.id === id) || null; }
  function nextFreePadKey() { const used = new Set(pads.map(p => p.key).filter(Boolean)); const tk = new Set(Object.values(settings.shortcuts)); for (const k of PAD_KEYS) if (!used.has(k) && !tk.has(k)) return k; return ''; }
  function makePad(slot, o) {
    return {
      id: rid('p_'), slot, bank: o.bank || currentBankId, name: o.name || 'Pad', emoji: o.emoji || '',
      mediaId: o.mediaId, color: o.color || 'var(--purple)',
      key: nextFreePadKey(), gain: 1, loop: false, fadeIn: 0, fadeOut: 0, dur: o.dur || 0,
      eq: { low: 0, mid: 0, high: 0 }, comp: false, trimIn: 0, trimOut: null, retrigger: 'restart',
    };
  }
  function setBank(id) { if (!banks.find(b => b.id === id)) return; currentBankId = id; selectedPadId = null; renderBanks(); renderPads(); renderPadInspector(); renderPadEditArea(); scheduleSave(); }
  function addBank() { const b = { id: rid('bk_'), name: 'Bank ' + (banks.length + 1) }; banks.push(b); currentBankId = b.id; selectedPadId = null; renderBanks(); renderPads(); renderPadInspector(); renderPadEditArea(); scheduleSave(); }
  function renameBank(id, name) { const b = banks.find(x => x.id === id); if (b) { b.name = name || b.name; renderBanks(); scheduleSave(); } }
  function removeBank(id) {
    if (banks.length <= 1) { toast('Keep at least one bank.'); return; }
    const bank = banks.find(b => b.id === id); if (!bank) return;
    if (!dangerOK('Delete “' + bank.name + '” and its pads?')) return;
    pads.filter(p => p.bank === id).forEach(p => { stopPad(p); padRT.delete(p.id); removePadMediaIfOrphan(p); });
    pads = pads.filter(p => p.bank !== id);
    banks = banks.filter(b => b.id !== id);
    if (currentBankId === id) currentBankId = banks[0].id;
    selectedPadId = null;
    renderBanks(); renderPads(); renderPadInspector(); renderPadEditArea(); scheduleSave();
  }
  function dangerOK(msg) { try { return window.confirm(msg); } catch (e) { return true; } }
  async function assignPad(slot, file) {
    const m = await storeFile(file); if (!m) return;
    if (m.kind === 'video') { /* still usable as a sound — play its audio track */ }
    const existing = padBySlot(slot);
    if (existing) { removePadMediaIfOrphan(existing); existing.mediaId = m.mediaId; existing.name = m.name.replace(/\.[^.]+$/, ''); existing.dur = m.duration || 0; padRT.delete(existing.id); }
    else pads.push(makePad(slot, { name: m.name.replace(/\.[^.]+$/, ''), mediaId: m.mediaId, dur: m.duration }));
    decodeBuffer(m.mediaId);
    renderPads(); renderPadInspector(); renderPadEditArea(); scheduleSave();
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
    if (!rt.buffer) { const b = await decodeBuffer(pad.mediaId); if (!b) { slog('error', 'SFX pad “' + pad.name + '” would not decode'); toast('Could not decode “' + pad.name + '”.'); return; } rt.buffer = b; }

    if (!settings.multiTrigger) pads.forEach(p => { if (p.id !== pad.id) stopPad(p); });
    if (pad.retrigger === 'toggle' && rt.voices.length) { stopPad(pad); return; }
    if (pad.retrigger === 'restart' || !settings.multiTrigger) stopVoices(rt);
    slog('sfx', 'Pad · “' + (pad.name || 'Pad') + '”');

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
    publishSfxFire(pad);   // P4: discrete fire event → follower chips
  }
  function stopVoices(rt) { if (!rt) return; rt.voices.slice().forEach(v => { try { v.onended = null; v.stop(); } catch (e) {} }); rt.voices = []; }
  function stopPad(pad) { const rt = padRT.get(pad.id); if (!rt) return; cancelFade('padin-' + pad.id); stopVoices(rt); renderPadLive(pad.id); }
  function stopAllPads() { padRT.forEach((rt, id) => { cancelFade('padin-' + id); stopVoices(rt); }); renderPads(); }

  // ── multi-output manager (Phase 3) ───────────────────────────────────────
  // BroadcastChannel is the primary bus, with direct postMessage mirrored to
  // every window as a show-safe fallback. Message ids make the dual path safe:
  // a play/seek command is applied once even when both transports deliver it.
  function seenOutputMessage(m) {
    if (!m || !m._mid) return false;
    if (outputMessageIds.has(m._mid)) return true;
    outputMessageIds.add(m._mid);
    if (outputMessageIds.size > 300) outputMessageIds.delete(outputMessageIds.values().next().value);
    return false;
  }
  function handleOutputMessage(m) {
    if (!m || m._from !== 'output' || seenOutputMessage(m)) return;
    const id = m.id || 1, rec = outputWins.get(id);
    // 'ready' = a fresh window that needs full state. A plain beat/pong must
    // NOT re-push (a 2s heartbeat re-sending 'play' would glitch the video);
    // it only re-syncs when it revives an output the watchdog declared dead.
    if (m.t === 'ready') {
      if (rec) { rec.alive = true; rec.lastBeat = Date.now(); rec.painting = true; }
      updateOutputUI(); resendActiveToOutput(id); applyOutputSink(id);
    }
    if (m.t === 'pong' || m.t === 'beat') {
      if (rec) {
        const wasDead = rec.alive === false;
        rec.lastBeat = Date.now();
        rec.alive = true;
        const painting = (m.raf !== false);
        if (!painting && rec.painting && active && active.kind === 'video' && active.cue.output === id) {
          slog('error', 'Output ' + id + ' event loop is alive but frames are not painting.');
        }
        rec.painting = painting;
        if (wasDead) {
          const o = outputById(id);
          slog('output', (o ? o.label : 'Output ' + id) + ' recovered — re-syncing its program state.');
          toast('✓ ' + (o ? o.label : 'Output ' + id) + ' recovered — re-synced.');
          resendActiveToOutput(id); applyOutputSink(id);
          updateOutputUI();
        }
      }
    }
    if (m.t === 'closed') { if (rec) rec.alive = false; updateOutputUI(); }
    if (m.t === 'error') toast('⚠ Output ' + id + ' could not play the media — black slate on that output.');
  }
  function ensureChannel() {
    if (!outputWindowListenerReady) {
      window.addEventListener('message', e => {
        if (e.origin !== location.origin || !e.data || !e.data._og) return;
        handleOutputMessage(e.data);
      });
      outputWindowListenerReady = true;
    }
    if (!bc && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel(OUTPUT_CHANNEL);
      bc.onmessage = e => handleOutputMessage(e.data);
    }
  }
  function sendOut(msg, target) {
    ensureChannel();
    const out = Object.assign({ _og: true, _from: 'control', target: (target == null ? null : target), _mid: 'c' + Date.now().toString(36) + '-' + (++outputMessageSeq).toString(36) }, msg);
    if (bc) bc.postMessage(out);
    outputWins.forEach((rec, id) => {
      if (target != null && id !== target) return;
      if (!rec.win || rec.win.closed) return;
      try { rec.win.postMessage(out, location.origin); } catch (e) {}
    });
  }
  function outputById(id) { return outputs.find(o => o.id === id) || null; }
  function isOutputAlive(id) { const r = outputWins.get(id); return !!(r && r.win && !r.win.closed); }
  // Healthy = window open AND the watchdog has heard a beat recently. A frozen
  // renderer keeps win.closed === false forever — only the heartbeat catches it.
  function isOutputHealthy(id) { const r = outputWins.get(id); return !!(r && r.win && !r.win.closed && r.alive); }

  // ── watchdog: ping every WATCHDOG_MS, two missed beats = dead ──
  const WATCHDOG_MS = 2000, WATCHDOG_DEAD_MS = 5000;
  let watchdogTimer = null;
  function ensureWatchdog() {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
      const now = Date.now();
      outputWins.forEach((rec, id) => {
        if (!rec.win || rec.win.closed) { if (rec.alive) { rec.alive = false; updateOutputUI(); } return; }
        sendOut({ t: 'ping' }, id);
        if (rec.alive && rec.lastBeat && now - rec.lastBeat > WATCHDOG_DEAD_MS) {
          rec.alive = false;
          const o = outputById(id);
          slog('error', (o ? o.label : 'Output ' + id) + ' stopped responding — the window may be frozen. It re-syncs automatically if it comes back.');
          toast('⚠ ' + (o ? o.label : 'Output ' + id) + ' stopped responding.');
          updateOutputUI();
        }
      });
    }, WATCHDOG_MS);
  }

  function openOutput(id) {
    ensureChannel();
    const o = outputById(id) || outputs[0]; if (!o) return null;
    let feats = 'width=1280,height=720';
    const scr = (o.screenId != null && screensCache) ? screensCache.find(s => s.id === o.screenId) : null;
    if (scr) feats = 'left=' + scr.availLeft + ',top=' + scr.availTop + ',width=' + scr.availWidth + ',height=' + scr.availHeight;
    const win = window.open('outrangutan/output.html#out=' + o.id, 'outrangutanOutput' + o.id, feats);
    if (!win) { toast('Output window blocked — allow pop-ups for Outrangutan.'); return null; }
    // lastBeat seeded at open so a slow first load gets the full grace window.
    outputWins.set(o.id, { win, alive: false, identify: false, lastBeat: Date.now(), painting: true });
    ensureWatchdog();
    toast(scr ? ('Opened ' + o.label + ' on ' + scr.label + '.') : ('Opened ' + o.label + '. Drag it to a display, then fullscreen it.'));
    setTimeout(() => { sendOut({ t: 'ping' }, o.id); if (scr) tryFullscreen(win); }, 600);
    updateOutputUI();
    return win;
  }
  function tryFullscreen(win) { try { const d = win.document.documentElement; if (d && d.requestFullscreen) d.requestFullscreen().catch(() => {}); } catch (e) {} }
  function focusOrOpenOutput(id) { const r = outputWins.get(id); if (r && r.win && !r.win.closed) r.win.focus(); else openOutput(id); }
  function popOutProgram() {
    const o = outputs[0] || { id: 1 };
    focusOrOpenOutput(o.id);
  }
  function resendActiveToOutput(id) {
    if (!active || active.cue.output !== id) return;
    if (active.kind === 'image') { sendOut({ t: 'image', mediaId: active.cue.mediaId, fadeIn: 0, fit: active.cue.fit, scale: active.cue.scale || 1, posX: active.cue.posX || 0, posY: active.cue.posY || 0 }, id); return; }
    if (active.kind !== 'video') return;
    sendOut({ t: 'play', mediaId: active.cue.mediaId, at: active.el.currentTime, loop: active.cue.loop, volume: active.cue.volume, fit: active.cue.fit, scale: active.cue.scale || 1, posX: active.cue.posX || 0, posY: active.cue.posY || 0, paused: !!(active.el && active.el.paused) }, id);
    // Keyer re-push: a rebooted/recovered output loses its WebGL key state.
    sendOut({ t: 'key', key: active.cue.key || { mode: 'off' } }, id);
  }
  function identifyOutput(id, on) {
    if (!isOutputAlive(id)) { if (!openOutput(id)) return; setTimeout(() => identifyOutput(id, on), 700); return; }   // blocked pop-up: stop, don't retry-loop
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
    const b = $('og-output-btn');
    if (b) {
      b.classList.toggle('on', outputs.some(o => isOutputHealthy(o.id)));
      b.classList.toggle('dead', outputs.some(o => isOutputAlive(o.id) && !isOutputHealthy(o.id)));
    }
    const pop = $('og-program-popout');
    if (pop) {
      pop.classList.toggle('on', outputs.some(o => isOutputHealthy(o.id)));
      pop.classList.toggle('dead', outputs.some(o => isOutputAlive(o.id) && !isOutputHealthy(o.id)));
      pop.setAttribute('aria-pressed', outputs.some(o => isOutputAlive(o.id)) ? 'true' : 'false');
    }
    if ($('og-outputs') && $('og-outputs').classList.contains('on')) renderOutputs();
  }

  // Preflight bridge: Cueola's go-live panel asks how the outputs are doing.
  function outputHealth() {
    let open = 0, healthy = 0; const dead = [];
    outputs.forEach(o => {
      if (!isOutputAlive(o.id)) return;
      open++;
      if (isOutputHealthy(o.id)) healthy++;
      else dead.push(o.label || ('Output ' + o.id));
    });
    return { open, healthy, dead };
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
  // One action switch for every control surface (Stream Deck keys, MIDI pads,
  // keyboard-shortcut parity) — V2 Phase 5 item 4 hangs Web MIDI off this too.
  function fireSurfaceAction(m) {
    if (!m || !m.action) return;
    if (m.action === 'go') go();
    else if (m.action === 'stop') stopAll();
    else if (m.action === 'pause') pauseResume();
    else if (m.action === 'fadeStop') fadeStopAll();
    else if (m.action === 'panic') panic();
    else if (m.action === 'cue') { const c = cueById(m.ref); if (c) { selectedId = c.id; go(); } }
    else if (m.action === 'pad') { const p = padById(m.ref); if (p) firePad(p); }
  }
  function sdFireKey(i) { fireSurfaceAction(sdMap[i]); }

  // ── Web MIDI control surfaces with learn-mode mapping (V2 Phase 5 item 4) ──
  // Any pad/fader box: arm Learn, touch a control, pick its action. Notes and
  // CC buttons fire through fireSurfaceAction (rising-edge for CC); a CC mapped
  // to "Master level" rides the fader straight into setMasterGain.
  let midi = null;          // MIDIAccess once connected
  let midiMap = {};         // 'n|cc:<channel>:<number>' -> { action, ref } (persisted in settings)
  let midiLearn = false;    // learn armed: next control touched becomes a mapping
  const midiCcEdge = {};    // last CC value per key — buttons fire on the rising edge
  const MIDI_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function midiKeyOf(status, d1) {
    const type = (status & 0xF0) === 0xB0 ? 'cc' : 'n';
    return type + ':' + (status & 0x0F) + ':' + d1;
  }
  function midiKeyLabel(key) {
    const [t, ch, n] = key.split(':');
    const num = Number(n);
    return (t === 'cc' ? 'CC ' + num : MIDI_NOTE_NAMES[num % 12] + (Math.floor(num / 12) - 1)) + ' · ch ' + (Number(ch) + 1);
  }
  async function midiConnect() {
    if (!('requestMIDIAccess' in navigator)) { toast('Web MIDI needs Chrome/Edge.'); return; }
    try { midi = await navigator.requestMIDIAccess({ sysex: false }); }
    catch (e) { toast('MIDI access was blocked — allow it in the site settings.'); return; }
    const hook = () => { midi.inputs.forEach(inp => { inp.onmidimessage = onMidiMessage; }); };
    midi.onstatechange = () => { hook(); renderMidi(); };   // hot-plug: new boxes just work
    hook();
    renderMidi();
    toast('MIDI connected — ' + midi.inputs.size + ' input' + (midi.inputs.size === 1 ? '' : 's') + '.');
  }
  function onMidiMessage(e) {
    const [status, d1, d2] = e.data;
    const type = status & 0xF0;
    if (type !== 0x90 && type !== 0x80 && type !== 0xB0) return;
    const key = midiKeyOf(status, d1);
    if (midiLearn) {
      if (type === 0x80 || (type === 0x90 && !d2)) return;        // ignore releases while learning
      if (!midiMap[key]) midiMap[key] = { action: type === 0xB0 ? 'master' : 'go' };
      settings.midiMap = midiMap;
      midiLearn = false;
      renderMidi(); scheduleSave();
      toast('Learned ' + midiKeyLabel(key) + ' — pick its action below.');
      return;
    }
    const m = midiMap[key];
    if (!m || !m.action) return;
    if (type === 0xB0) {
      if (m.action === 'master') { setMasterGain(d2 / 127); return; }   // continuous fader
      const was = (midiCcEdge[key] || 0) > 63, is = d2 > 63;
      midiCcEdge[key] = d2;
      if (is && !was) fireSurfaceAction(m);
      return;
    }
    if (type === 0x90 && d2 > 0) fireSurfaceAction(m);               // note-on = press
  }
  function openMidiPanel() { $('og-midi').classList.add('on'); renderMidi(); }
  function closeMidiPanel() { midiLearn = false; $('og-midi').classList.remove('on'); }
  function renderMidi() {
    const body = $('og-midi-body'); if (!body) return;
    const hasApi = 'requestMIDIAccess' in navigator;
    const keys = Object.keys(midiMap);
    const rows = keys.map(key => {
      const m = midiMap[key] || {};
      const isCc = key.indexOf('cc:') === 0;
      const acts = Object.assign({}, SD_ACTIONS, isCc ? { master: 'Master level' } : {});
      const actSel = '<select class="og-sd-act og-midi-act" data-mk="' + esc(key) + '">' + Object.keys(acts).map(a => opt(a, acts[a], m.action || '')).join('') + '</select>';
      let refSel = '';
      if (m.action === 'cue') refSel = '<select class="og-sd-ref og-midi-ref" data-mk="' + esc(key) + '"><option value="">Pick cue…</option>' + cues.map(c => '<option value="' + c.id + '"' + (m.ref === c.id ? ' selected' : '') + '>#' + c.num + ' ' + esc(c.name) + '</option>').join('') + '</select>';
      if (m.action === 'pad') refSel = '<select class="og-sd-ref og-midi-ref" data-mk="' + esc(key) + '"><option value="">Pick pad…</option>' + pads.map(p => '<option value="' + p.id + '"' + (m.ref === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select>';
      return '<div class="og-midi-row"><span class="og-midi-key">' + esc(midiKeyLabel(key)) + '</span>' + actSel + refSel
        + '<button class="og-sheet-x og-midi-del" data-mk="' + esc(key) + '" title="Remove mapping">✕</button></div>';
    }).join('');
    body.innerHTML =
      (hasApi ? '' : '<div class="og-edit-empty">Web MIDI needs Chrome or Edge.</div>')
      + '<div class="og-midi-rows">' + (rows || '<div class="og-edit-empty">No mappings yet — connect a box and learn its controls.</div>') + '</div>'
      + '<div class="og-midi-actions">'
      + (midi ? '<span class="og-midi-status">● ' + midi.inputs.size + ' input' + (midi.inputs.size === 1 ? '' : 's') + '</span>'
              : '<button class="og-bar-btn" id="og-midi-conn"' + (hasApi ? '' : ' disabled') + '>Connect MIDI</button>')
      + '<button class="og-bar-btn' + (midiLearn ? ' danger' : '') + '" id="og-midi-learn">'
      + (midiLearn ? 'Waiting — touch a control…' : '+ Learn a control') + '</button>'
      + '</div>';
    if ($('og-midi-conn')) $('og-midi-conn').onclick = midiConnect;
    if ($('og-midi-learn')) $('og-midi-learn').onclick = () => { midiLearn = !midiLearn; renderMidi(); };
    Array.prototype.forEach.call(body.querySelectorAll('.og-midi-act'), s => { s.onchange = e => { const k = s.getAttribute('data-mk'); midiMap[k] = Object.assign({}, midiMap[k], { action: e.target.value }); if (e.target.value !== 'cue' && e.target.value !== 'pad') delete midiMap[k].ref; settings.midiMap = midiMap; renderMidi(); scheduleSave(); }; });
    Array.prototype.forEach.call(body.querySelectorAll('.og-midi-ref'), s => { s.onchange = e => { const k = s.getAttribute('data-mk'); midiMap[k] = Object.assign({}, midiMap[k], { ref: e.target.value }); settings.midiMap = midiMap; scheduleSave(); }; });
    Array.prototype.forEach.call(body.querySelectorAll('.og-midi-del'), b => { b.onclick = () => { delete midiMap[b.getAttribute('data-mk')]; settings.midiMap = midiMap; renderMidi(); scheduleSave(); }; });
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
        const open = isOutputAlive(o.id);
        const live = isOutputHealthy(o.id);
        const dead = open && !live;   // window exists but the heartbeat stopped
        const screenSel = screensCache
          ? '<select class="og-out-screen" data-o="' + o.id + '"><option value="">No display set</option>' + screensCache.map(s => '<option value="' + s.id + '"' + (o.screenId === s.id ? ' selected' : '') + '>' + esc(s.label) + '</option>').join('') + '</select>'
          : '<span class="og-out-note">Detect displays to place this on a screen</span>';
        return '<div class="og-out-row">'
          + '<div class="og-out-main"><span class="og-out-dot' + (live ? ' live' : dead ? ' dead' : '') + '"' + (dead ? ' title="Not responding — the window may be frozen"' : '') + '></span>'
            + '<input class="og-out-label" data-o="' + o.id + '" value="' + esc(o.label) + '">'
            + '<button class="og-bar-btn og-out-open" data-o="' + o.id + '">' + (open ? 'Focus' : 'Open') + '</button>'
            + '<button class="og-bar-btn og-out-id" data-o="' + o.id + '">Identify</button>'
            + (outputs.length > 1 ? '<button class="og-bar-btn danger og-out-del" data-o="' + o.id + '">' + sym('action.delete') + '</button>' : '')
          + '</div>'
          + '<div class="og-out-cfg">'
            + '<div class="og-field"><label>Display</label>' + screenSel + '</div>'
            + '<label class="og-check og-check-inline og-out-audiochk"><input type="checkbox" class="og-out-audio" data-o="' + o.id + '"' + (o.audioOn ? ' checked' : '') + '> Audio on this output</label>'
            + '<div class="og-field"><label>Device</label><select class="og-out-sink" data-o="' + o.id + '">' + devOptions(o.sinkId) + '</select></div>'
          + '</div></div>';
      }).join('')
      + '<p class="og-sheet-note">Outputs are where video appears. Add an output, choose its display and audio device, then Open it. Set each cue\'s output in the Inspector.</p>';

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

  // ── Integrations panel (OBS · Dropbox · Transcode) — Phase 5 ─────────────
  function openIntegrations() { $('og-integrations').classList.add('on'); renderIntegrations(); }
  function closeIntegrations() { $('og-integrations').classList.remove('on'); }
  function renderIntegrations() {
    const body = $('og-integrations-body'); if (!body) return;
    // OBS
    const obsConn = obs.connected;
    const sceneBtns = obs.scenes.map(s => '<button class="og-bar-btn og-obs-scene' + (s === obs.current ? ' on' : '') + '" data-scene="' + esc(s) + '">' + esc(s) + '</button>').join('') || '<span class="og-out-note">No scenes — connect to load.</span>';
    const obsHTML =
      '<div class="og-intg-sect"><div class="og-intg-head">' + sym('content.display') + ' OBS Studio <span class="og-out-note">obs-websocket v5</span><span class="og-out-dot' + (obsConn ? ' live' : '') + '" style="margin-left:auto"></span></div>'
      + (obsConn
        ? '<div class="og-obs-scenes">' + sceneBtns + '</div>'
          + '<div class="og-intg-row">'
            + '<button class="og-bar-btn' + (obs.streaming ? ' on' : '') + '" id="og-obs-stream">' + (obs.streaming ? 'Stop Stream' : 'Start Stream') + '</button>'
            + '<button class="og-bar-btn' + (obs.recording ? ' on' : '') + '" id="og-obs-record">' + (obs.recording ? 'Stop Record' : 'Start Record') + '</button>'
            + '<button class="og-bar-btn danger" id="og-obs-disc">Disconnect</button>'
          + '</div>'
        : '<div class="og-intg-row"><input class="og-intg-in" id="og-obs-host" placeholder="host" value="' + esc(obs.cfg.host) + '"><input class="og-intg-in og-intg-port" id="og-obs-port" placeholder="4455" value="' + obs.cfg.port + '"><input class="og-intg-in" id="og-obs-pw" type="password" placeholder="password" value="' + esc(obs.cfg.password) + '"><button class="og-bar-btn" id="og-obs-conn"' + (('WebSocket' in window) ? '' : ' disabled') + '>Connect</button></div>')
      + '<p class="og-sheet-note">Enable in OBS: <code>Tools ▸ WebSocket Server Settings</code>. Per-cue OBS actions (switch scene / start-stop record &amp; stream) are set in the cue Inspector; a cue can also fire when OBS switches to a named scene.</p></div>';
    // Dropbox
    const fileRows = dbx.files.map(f => '<div class="og-dbx-file"><span class="og-dbx-name">' + esc(f.name) + '</span><button class="og-bar-btn og-dbx-pull" data-path="' + esc(f.path_lower || f.path_display) + '" data-name="' + esc(f.name) + '">Pull</button></div>').join('');
    const dbxHTML =
      '<div class="og-intg-sect"><div class="og-intg-head">' + sym('action.down') + ' Dropbox</div>'
      + '<div class="og-intg-row"><input class="og-intg-in" id="og-dbx-token" type="password" placeholder="access token" value="' + esc(dbx.token) + '"><input class="og-intg-in" id="og-dbx-folder" placeholder="/folder (blank = root)" value="' + esc(dbx.folder) + '"><button class="og-bar-btn" id="og-dbx-list">List media</button></div>'
      + (fileRows ? '<div class="og-dbx-files">' + fileRows + '<button class="og-bar-btn og-dbx-pullall" id="og-dbx-pullall">Pull all ' + dbx.files.length + '</button></div>' : '')
      + '<p class="og-sheet-note">Paste a Dropbox <em>access token</em> (from a Dropbox app). Full OAuth needs a registered redirect — deferred. Files download into local cues (IndexedDB).</p></div>';
    // Transcode
    const intgHTML =
      '<div class="og-intg-sect"><div class="og-intg-head">' + sym('action.settings') + ' Transcode on upload</div>'
      + '<label class="og-check"><input type="checkbox" id="og-transcode"' + (settings.transcode ? ' checked' : '') + '> Normalize non-web-playable uploads to H.264 MP4 (ffmpeg.wasm)</label>'
      + '<p class="og-sheet-note">When on, dropping a .mov/.mkv/etc. transcodes it in-browser (ffmpeg.wasm, ~30&nbsp;MB, lazy-loaded) before it becomes a cue. ProRes/DNxHD &amp; large jobs belong to the future native engine; this always falls back to storing as-is.</p></div>';
    body.innerHTML = obsHTML + dbxHTML + intgHTML;

    const on = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
    on('og-obs-conn', 'onclick', () => obsConnect($('og-obs-host').value.trim(), parseInt($('og-obs-port').value, 10) || 4455, $('og-obs-pw').value));
    on('og-obs-disc', 'onclick', () => { obsDisconnect(); renderIntegrations(); });
    on('og-obs-stream', 'onclick', () => obsReq(obs.streaming ? 'StopStream' : 'StartStream'));
    on('og-obs-record', 'onclick', () => obsReq(obs.recording ? 'StopRecord' : 'StartRecord'));
    Array.prototype.forEach.call(body.querySelectorAll('.og-obs-scene'), b => { b.onclick = () => obsReq('SetCurrentProgramScene', { sceneName: b.getAttribute('data-scene') }); });
    on('og-dbx-token', 'onchange', e => { dbx.token = e.target.value.trim(); });
    on('og-dbx-folder', 'onchange', e => { dbx.folder = e.target.value.trim(); });
    on('og-dbx-list', 'onclick', () => { dbx.token = $('og-dbx-token').value.trim(); dbx.folder = $('og-dbx-folder').value.trim(); dropboxList(); });
    Array.prototype.forEach.call(body.querySelectorAll('.og-dbx-pull'), b => { b.onclick = () => dropboxPull(b.getAttribute('data-path'), b.getAttribute('data-name')); });
    on('og-dbx-pullall', 'onclick', () => { dbx.files.forEach(f => dropboxPull(f.path_lower || f.path_display, f.name)); });
    on('og-transcode', 'onchange', e => { settings.transcode = e.target.checked; scheduleSave(); if (e.target.checked) loadFFmpeg(); });
  }

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

  // ── Cueola session sync (Phase 4) ────────────────────────────────────────
  // When joined to a session, ride the existing Firestore session doc as a bus:
  //   • LISTEN for `outrangutan.command` (the rundown's playback cue fires us);
  //   • PUBLISH a lightweight cue-list summary (`outrangutan.cues`, no media blobs)
  //     and live transport (`outrangutan.live`) so the rundown auto-populates.
  // Strictly an overlay — every transport path fires LOCALLY first (live-critical
  // never blocks on the network); sync is best-effort and survives a drop.
  const OG_SENDER = 'outrangutan_' + Math.random().toString(36).slice(2, 9);
  let sessionSub = null;          // onSnapshot unsubscribe
  let lastCmdId = null;           // dedupe handled commands (snapshots re-fire)
  let pubTimer = null, lastLiveTs = 0;

  function fbReady() { return !!(window._firebaseReady && window._db && window._doc && window._updateDoc && window._onSnapshot); }
  function sessionRef() { return window._doc(window._db, 'sessions', sessionCode); }

  function subscribeSession() {
    unsubscribeSession();
    if (mode !== 'session' || !sessionCode || !fbReady()) return;
    try { sessionSub = window._onSnapshot(sessionRef(), snap => { try { onSessionDoc(snap.data() || {}); } catch (e) {} }, () => {}); } catch (e) {}
    publishCues(); publishLive(true);
  }
  function unsubscribeSession() { if (sessionSub) { try { sessionSub(); } catch (e) {} sessionSub = null; } lastCmdId = null; }

  function onSessionDoc(d) {
    const cmd = d && d.outrangutan && d.outrangutan.command;
    if (!cmd || !cmd.commandId || cmd.commandId === lastCmdId) return;
    if (cmd.sender === OG_SENDER) return;                       // ignore our own writes (loop guard)
    if (cmd.ts && Date.now() - cmd.ts > 30000) return;          // ignore stale commands
    lastCmdId = cmd.commandId;
    applyRemoteCommand(cmd);
  }
  function applyRemoteCommand(cmd) {
    switch (cmd.action) {
      case 'go': go(); break;
      case 'stop': stopAll(); break;
      case 'panic': panic(); break;
      case 'fadeStop': fadeStopAll(); break;
      case 'pause': pauseResume(); break;   // P5: live-screen P key
      case 'cue': {
        const c = cueById(cmd.cueId) || cues.find(x => String(x.num) === String(cmd.cueId));
        if (c) { selectedId = c.id; go(); }
        else toast('Rundown fired a cue Outrangutan doesn’t have on this device (' + cmd.cueId + ').');
        break;
      }
      case 'pad': {   // Phase 4 (master plan): rundown-cued SFX
        const p = padById(cmd.padId);
        if (p && p.mediaId) firePad(p);
        else toast('Rundown fired an SFX pad Outrangutan doesn’t have on this device.');
        break;
      }
      default: return;
    }
    renderCueList(); renderInspector(); renderEditArea();
  }

  // publish a media-free cue-list summary so the rundown can list + link cues
  function publishCues() {
    if (mode !== 'session' || !sessionCode || !fbReady()) return;
    if (pubTimer) clearTimeout(pubTimer);
    pubTimer = setTimeout(() => {
      pubTimer = null;
      const map = {};
      cues.forEach(c => { map[c.id] = { num: c.num, name: c.name, type: c.type, dur: Math.round(c.duration || 0) }; });
      // P4: also publish the SFX pad summary so rundown cells can link pads.
      const padMap = {};
      pads.forEach(p => {
        if (!p.mediaId) return;
        const bank = banks.find(bk => bk.id === p.bank);
        padMap[p.id] = { name: p.name || 'Pad', bank: bank ? bank.name : '', emoji: p.emoji || '' };
      });
      try { window._updateDoc(sessionRef(), { 'outrangutan.cues': map, 'outrangutan.pads': padMap, 'outrangutan.cuesTs': Date.now(), 'outrangutan.sender': OG_SENDER }); } catch (e) {}
    }, 400);
  }
  // P4: broadcast each SFX fire as a discrete event (followers show a transient
  // chip — Decisions Log #7). Light 250 ms throttle so pad-mashing can't flood
  // the doc; the newest fire always wins.
  let _sfxFireSeq = 0, _lastSfxFireTs = 0;
  function publishSfxFire(pad) {
    if (mode !== 'session' || !sessionCode || !fbReady()) return;
    const now = Date.now();
    if (now - _lastSfxFireTs < 250) return;
    _lastSfxFireTs = now;
    try { window._updateDoc(sessionRef(), { 'outrangutan.sfxFire': { padId: pad.id, name: pad.name || 'SFX', emoji: pad.emoji || '', ts: now, seq: ++_sfxFireSeq, sender: OG_SENDER } }); } catch (e) {}
  }
  // publish live transport (throttled ~1 Hz, Decisions Log #5) — feeds the
  // rundown cell's name/dur/status/thumb. Monotonic seq lets receivers drop
  // stale out-of-order packets (P3 sync hardening).
  let _liveSeq = 0;
  function publishLive(force) {
    if (mode !== 'session' || !sessionCode || !fbReady()) return;
    const now = Date.now();
    if (!force && now - lastLiveTs < 700) return;
    lastLiveTs = now;
    let live = { status: 'idle', ts: now, sender: OG_SENDER };
    if (preInfo) live = { status: 'pre', cueId: preInfo.cue.id, name: preInfo.cue.name, type: preInfo.cue.type, ts: now, sender: OG_SENDER };
    else if (active && active.kind === 'image') {
      const left = active.remainMs > 0
        ? (active.paused ? active.remainMs : Math.max(0, active.remainMs - (performance.now() - active.timerStart))) / 1000
        : 0;
      live = { status: active.paused ? 'pause' : 'play', cueId: active.cue.id, name: active.cue.name, type: 'image', dur: Math.round(active.cue.duration || 0), remaining: Math.round(left), thumb: active.cue.thumb || '', ts: now, sender: OG_SENDER };
    }
    else if (active && active.el) {
      const el = active.el, end = (active.cue.trimOut != null ? active.cue.trimOut : (isFinite(el.duration) ? el.duration : active.cue.duration));
      const remaining = Math.max(0, (end || 0) - el.currentTime);
      live = { status: el.paused ? 'pause' : 'play', cueId: active.cue.id, name: active.cue.name, type: active.cue.type, dur: Math.round(active.cue.duration || 0), remaining: Math.round(remaining), offset: Math.round(el.currentTime * 10) / 10, thumb: active.cue.thumb || '', ts: now, sender: OG_SENDER };
    }
    live.seq = ++_liveSeq;
    try { window._updateDoc(sessionRef(), { 'outrangutan.live': live }); } catch (e) {}
  }

  // ── Phase 5: scopes (waveform monitor + vectorscope) ─────────────────────
  // Computed from the program frame on a small offscreen canvas — resolution-
  // aware (we always downsample to ~192px wide, so 4K stays cheap). Toggleable.
  // Each canvas is re-backed at its on-screen size × devicePixelRatio so the
  // traces and graticules stay crisp however the panes are resized.
  let scopesOn = false, scopeRAF = null;
  const scopeSrc = document.createElement('canvas');
  function frontVideoEl() {
    if (active && active.kind === 'video' && active.el && active.el.videoWidth) return active.el;
    if (decks) for (const k of ['a', 'b']) { const d = decks[k]; if (d && d.el && d.el.videoWidth && d.el.classList.contains('front')) return d.el; }
    return null;
  }
  function fitScopeCanvas(cv) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  }
  function toggleScopes() {
    scopesOn = !scopesOn;
    const s = $('og-scopes'); if (s) s.classList.toggle('on', scopesOn);
    const b = $('og-scopes-btn'); if (b) b.classList.toggle('on', scopesOn);
    if (scopesOn) { if (!scopeRAF) { const loop = () => { drawScopes(); scopeRAF = requestAnimationFrame(loop); }; scopeRAF = requestAnimationFrame(loop); } }
    else if (scopeRAF) { cancelAnimationFrame(scopeRAF); scopeRAF = null; }
  }
  function drawScopes() {
    const wfm = $('og-wfm'), vec = $('og-vscope'); if (!wfm || !vec) return;
    fitScopeCanvas(wfm); fitScopeCanvas(vec);
    const v = frontVideoEl();
    if (!v) { drawWfmGraticule(wfm); drawVecGraticule(vec); return; }
    const sw = 192, sh = Math.max(1, Math.round(sw * ((v.videoHeight || 9) / (v.videoWidth || 16))));
    scopeSrc.width = sw; scopeSrc.height = sh;
    const sc = scopeSrc.getContext('2d', { willReadFrequently: true });
    let img; try { sc.drawImage(v, 0, 0, sw, sh); img = sc.getImageData(0, 0, sw, sh); } catch (e) { return; }
    drawWaveform(wfm, img, sw, sh);
    drawVectorscope(vec, img, sw, sh);
  }
  function drawWfmGraticule(cv) {
    const W = cv.width, H = cv.height, ctx = cv.getContext('2d');
    ctx.fillStyle = '#04060a'; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1;
    [0, 0.25, 0.5, 0.75, 1].forEach(f => {
      const y = Math.round(f * (H - 1)) + 0.5;
      ctx.strokeStyle = f === 0 || f === 1 ? 'rgba(150,180,210,.30)' : 'rgba(150,180,210,.16)';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    });
    const fs = Math.max(9, Math.round(H * 0.085));
    ctx.fillStyle = 'rgba(160,190,220,.55)'; ctx.font = fs + 'px monospace'; ctx.textAlign = 'right';
    ctx.textBaseline = 'top'; ctx.fillText('100', W - 5, 3);
    ctx.textBaseline = 'bottom'; ctx.fillText('0', W - 5, H - 3);
    return ctx;
  }
  function drawWaveform(cv, img, sw, sh) {
    const W = cv.width, H = cv.height, ctx = drawWfmGraticule(cv), d = img.data;
    // Additive luma trace: one source column per output pixel column, so the
    // plot is continuous (no comb gaps) at any backing resolution.
    const out = ctx.getImageData(0, 0, W, H), o = out.data;
    for (let X = 0; X < W; X++) {
      const x = (X * sw / W) | 0;
      for (let y = 0; y < sh; y++) {
        const i = (y * sw + x) * 4, luma = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
        const py = ((1 - luma / 255) * (H - 1)) | 0, oi = (py * W + X) * 4;
        o[oi] = Math.min(255, o[oi] + 24); o[oi + 1] = Math.min(255, o[oi + 1] + 92); o[oi + 2] = Math.min(255, o[oi + 2] + 42); o[oi + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  }
  // Rec.601 75% color-bar targets for the vectorscope graticule
  const VEC_TARGETS = ['R,191,0,0', 'Mg,191,0,191', 'B,0,0,191', 'Cy,0,191,191', 'G,0,191,0', 'Yl,191,191,0'].map(s => {
    const [k, R, G, B] = s.split(',').map((v, i) => i ? +v : v);
    return { k, u: -0.169 * R - 0.331 * G + 0.5 * B, v: 0.5 * R - 0.419 * G - 0.081 * B };
  });
  function drawVecGraticule(cv) {
    const W = cv.width, H = cv.height, ctx = cv.getContext('2d');
    const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - Math.max(3, Math.min(W, H) * 0.03);
    ctx.fillStyle = '#04060a'; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(150,180,210,.30)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(150,180,210,.14)';
    ctx.beginPath(); ctx.arc(cx, cy, r / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
    const scale = r / 140, box = Math.max(3, r * 0.05);
    ctx.font = Math.max(8, Math.round(r * 0.11)) + 'px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    VEC_TARGETS.forEach(t => {
      const x = cx + t.u * scale, y = cy - t.v * scale;
      ctx.strokeStyle = 'rgba(220,235,255,.42)';
      ctx.strokeRect(x - box, y - box, box * 2, box * 2);
      ctx.fillStyle = 'rgba(200,220,245,.6)';
      ctx.fillText(t.k, cx + t.u * scale * 1.3, cy - t.v * scale * 1.3);
    });
    return { ctx, cx, cy, r, scale };
  }
  function drawVectorscope(cv, img, sw, sh) {
    const g = drawVecGraticule(cv), ctx = g.ctx;
    const d = img.data, ds = Math.max(1.5, g.r / 70);
    ctx.fillStyle = 'rgba(125,240,180,.65)';
    const step = sw * sh > 20000 ? 2 : 1;   // resolution-aware thinning
    for (let p = 0; p < sw * sh; p += step) {
      const i = p * 4, R = d[i], G = d[i + 1], B = d[i + 2];
      const U = -0.169 * R - 0.331 * G + 0.5 * B;     // Rec.601 chroma
      const V = 0.5 * R - 0.419 * G - 0.081 * B;
      ctx.fillRect(g.cx + U * g.scale - ds / 2, g.cy - V * g.scale - ds / 2, ds, ds);
    }
  }

  // ── Phase 5: WebGL keyer (chroma / luma / alpha → composite over a bg) ────
  const KEY_FRAG = [
    'precision mediump float;',
    'uniform sampler2D u_tex; uniform int u_mode; uniform vec3 u_key;',
    'uniform float u_sim; uniform float u_smooth; uniform vec3 u_bg;',
    'varying vec2 v_uv;',
    'void main(){',
    '  vec4 c = texture2D(u_tex, v_uv); float a = c.a;',
    '  if(u_mode==1){ float d = distance(c.rgb, u_key); a = smoothstep(u_sim, u_sim+u_smooth+0.001, d); }',
    '  else if(u_mode==2){ float l = dot(c.rgb, vec3(0.299,0.587,0.114)); a = smoothstep(u_sim, u_sim+u_smooth+0.001, l); }',
    '  else if(u_mode==3){ a = c.a; }',
    '  gl_FragColor = vec4(mix(u_bg, c.rgb, a), 1.0);',
    '}'
  ].join('\n');
  const KEY_VERT = 'attribute vec2 p; varying vec2 v_uv; void main(){ v_uv = vec2((p.x+1.0)/2.0, 1.0-(p.y+1.0)/2.0); gl_Position = vec4(p,0.0,1.0); }';
  function makeKeyer(canvas) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false }) || canvas.getContext('experimental-webgl');
    if (!gl) return null;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { console.warn('[outrangutan] key shader', gl.getShaderInfoLog(o)); return null; } return o; };
    const vs = sh(gl.VERTEX_SHADER, KEY_VERT), fs = sh(gl.FRAGMENT_SHADER, KEY_FRAG);
    if (!vs || !fs) return null;
    const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const U = {
      mode: gl.getUniformLocation(prog, 'u_mode'), key: gl.getUniformLocation(prog, 'u_key'), sim: gl.getUniformLocation(prog, 'u_sim'),
      smooth: gl.getUniformLocation(prog, 'u_smooth'), bg: gl.getUniformLocation(prog, 'u_bg'),
    };
    const MODES = { off: 0, chroma: 1, luma: 2, alpha: 3 };
    return {
      gl, ok: true,
      render(video, p) {
        if (!video || !video.videoWidth) return;
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
        gl.viewport(0, 0, canvas.width, canvas.height);
        try { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); } catch (e) { return; }
        gl.uniform1i(U.mode, MODES[p.mode] || 0);
        const k = hexRGB(p.color || '#00b140'); gl.uniform3f(U.key, k[0], k[1], k[2]);
        gl.uniform1f(U.sim, p.sim == null ? 0.3 : p.sim); gl.uniform1f(U.smooth, p.smooth == null ? 0.1 : p.smooth);
        const bg = hexRGB(p.bg || '#000000'); gl.uniform3f(U.bg, bg[0], bg[1], bg[2]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
    };
  }
  function hexRGB(h) { h = (h || '').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h || '000000', 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }

  let keyer = null, keyRAF = null;
  function keyActiveFor(cue) { return cue && cue.type === 'video' && cue.key && cue.key.mode && cue.key.mode !== 'off'; }
  function startKeyLoop() {
    const cv = $('og-key-canvas'); if (!cv) return;
    if (!keyer) keyer = makeKeyer(cv);
    if (!keyer || !keyer.ok) { toast('Keying needs WebGL (Chrome/Edge).'); return; }
    cv.classList.add('on');
    if (keyRAF) return;
    const loop = () => {
      const v = active && active.kind === 'video' ? active.el : frontVideoEl();
      const cue = active && active.cue;
      if (v && cue && keyActiveFor(cue)) keyer.render(v, cue.key);
      keyRAF = requestAnimationFrame(loop);
    };
    keyRAF = requestAnimationFrame(loop);
  }
  function stopKeyLoop() { if (keyRAF) { cancelAnimationFrame(keyRAF); keyRAF = null; } const cv = $('og-key-canvas'); if (cv) cv.classList.remove('on'); if (decks) { decks.a.el.style.visibility = ''; decks.b.el.style.visibility = ''; } }
  function applyKeyForActive() {
    const cue = active && active.cue;
    if (keyActiveFor(cue)) { startKeyLoop(); if (active.deck && decks[active.deck]) decks[active.deck].el.style.visibility = 'hidden'; }
    else { stopKeyLoop(); if (active && active.deck && decks[active.deck]) decks[active.deck].el.style.visibility = ''; }
    if (active && active.kind === 'video') sendOut({ t: 'key', key: cue.key || { mode: 'off' } }, cue.output || 1);
  }

  // ── Phase 5: OBS integration (obs-websocket v5) ──────────────────────────
  // Talks directly to OBS's WebSocket server (Tools ▸ WebSocket Server Settings).
  // v5 handshake: Hello(op0) → Identify(op1, SHA-256 auth) → Identified(op2);
  // requests op6/responses op7; events op5. Needs a running OBS to round-trip.
  let obs = { ws: null, connected: false, scenes: [], current: '', streaming: false, recording: false, cfg: { host: 'localhost', port: 4455, password: '' } };
  let _obsSeq = 0; const obsPending = {};
  async function sha256b64(str) { const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); let bin = ''; new Uint8Array(buf).forEach(b => bin += String.fromCharCode(b)); return btoa(bin); }
  function obsConnect(host, port, password) {
    obsDisconnect();
    obs.cfg = { host: host || 'localhost', port: port || 4455, password: password || '' };
    let ws; try { ws = new WebSocket('ws://' + obs.cfg.host + ':' + obs.cfg.port); } catch (e) { toast('OBS: invalid address.'); return; }
    obs.ws = ws;
    ws.onclose = () => { obs.connected = false; renderIntegrations(); };
    ws.onerror = () => { toast('OBS: connection failed — enable the WebSocket server in OBS.'); };
    ws.onmessage = async (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.op === 0) {
        const id = { op: 1, d: { rpcVersion: 1 } };
        if (m.d.authentication) { const a = m.d.authentication; const secret = await sha256b64(obs.cfg.password + a.salt); id.d.authentication = await sha256b64(secret + a.challenge); }
        ws.send(JSON.stringify(id));
      } else if (m.op === 2) {
        obs.connected = true; toast('OBS connected.'); obsReq('GetSceneList'); obsReq('GetStreamStatus'); obsReq('GetRecordStatus'); renderIntegrations();
      } else if (m.op === 7) {
        const cb = obsPending[m.d.requestId]; if (cb) { delete obsPending[m.d.requestId]; cb(m.d.responseData || {}); }
        const rd = m.d.responseData || {};
        if (m.d.requestType === 'GetSceneList') { obs.scenes = (rd.scenes || []).map(s => s.sceneName).reverse(); obs.current = rd.currentProgramSceneName || ''; renderIntegrations(); }
        if (m.d.requestType === 'GetStreamStatus') { obs.streaming = !!rd.outputActive; renderIntegrations(); }
        if (m.d.requestType === 'GetRecordStatus') { obs.recording = !!rd.outputActive; renderIntegrations(); }
      } else if (m.op === 5) {
        const e = m.d;
        if (e.eventType === 'CurrentProgramSceneChanged') { obs.current = e.eventData.sceneName; onObsSceneChanged(obs.current); renderIntegrations(); }
        else if (e.eventType === 'StreamStateChanged') { obs.streaming = !!e.eventData.outputActive; renderIntegrations(); }
        else if (e.eventType === 'RecordStateChanged') { obs.recording = !!e.eventData.outputActive; renderIntegrations(); }
      }
    };
  }
  function obsDisconnect() { if (obs.ws) { try { obs.ws.close(); } catch (e) {} obs.ws = null; } obs.connected = false; }
  function obsReq(requestType, requestData, cb) {
    if (!obs.ws || obs.ws.readyState !== 1) return;
    const requestId = 'r' + (++_obsSeq); if (cb) obsPending[requestId] = cb;
    obs.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData: requestData || {} } }));
  }
  function fireObsForCue(cue) {
    const a = cue && cue.obs; if (!a || !a.action || a.action === 'none' || !obs.connected) return;
    if (a.action === 'scene' && a.scene) obsReq('SetCurrentProgramScene', { sceneName: a.scene });
    else if (a.action === 'startRecord') obsReq('StartRecord');
    else if (a.action === 'stopRecord') obsReq('StopRecord');
    else if (a.action === 'startStream') obsReq('StartStream');
    else if (a.action === 'stopStream') obsReq('StopStream');
  }
  function onObsSceneChanged(scene) { const c = cues.find(x => x.obsTriggerScene && x.obsTriggerScene === scene); if (c) { selectedId = c.id; go(); } }

  // ── Phase 5: Dropbox sync (token connect → list a folder → pull to cues) ──
  // Personal access token (OBS-style, no backend): a full OAuth/PKCE flow needs a
  // registered Dropbox app + redirect, deferred. Token paste works for one user.
  let dbx = { token: '', folder: '', files: [] };
  function guessMime(n) { n = n.toLowerCase(); if (/\.(mp4|m4v|mov)$/.test(n)) return 'video/mp4'; if (/\.webm$/.test(n)) return 'video/webm'; if (/\.mp3$/.test(n)) return 'audio/mpeg'; if (/\.wav$/.test(n)) return 'audio/wav'; if (/\.(m4a|aac)$/.test(n)) return 'audio/aac'; if (/\.(ogg|opus)$/.test(n)) return 'audio/ogg'; return ''; }
  async function dropboxList() {
    if (!dbx.token) { toast('Paste a Dropbox access token first.'); return; }
    try {
      const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', { method: 'POST', headers: { 'Authorization': 'Bearer ' + dbx.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: dbx.folder === '/' ? '' : (dbx.folder || ''), recursive: false }) });
      if (!res.ok) { toast('Dropbox: ' + res.status + ' — check the token/folder.'); return; }
      const j = await res.json();
      dbx.files = (j.entries || []).filter(e => e['.tag'] === 'file' && /\.(mp4|webm|mov|m4v|mp3|wav|aac|m4a|ogg|opus)$/i.test(e.name));
      toast('Dropbox: ' + dbx.files.length + ' media file' + (dbx.files.length === 1 ? '' : 's') + ' found.');
      renderIntegrations();
    } catch (e) { toast('Dropbox list failed (token/CORS).'); }
  }
  async function dropboxPull(path, name) {
    try {
      const res = await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { 'Authorization': 'Bearer ' + dbx.token, 'Dropbox-API-Arg': JSON.stringify({ path }) } });
      if (!res.ok) { toast('Dropbox download failed (' + res.status + ').'); return; }
      const blob = await res.blob();
      await importFiles([new File([blob], name, { type: blob.type || guessMime(name) })]);
    } catch (e) { toast('Dropbox pull failed.'); }
  }

  // ── Phase 5: transcode-on-upload (ffmpeg.wasm, lazy) ─────────────────────
  // Browsers can't decode ProRes/DNxHD/MOV/MKV — when "Normalize uploads" is on we
  // transcode non-web-playable files to H.264/AAC MP4 via ffmpeg.wasm (lazy CDN
  // load, ~30 MB). No server here, so this is the ffmpeg.wasm path; large/pro files
  // belong to the future native engine (§4). Always falls back to storing as-is.
  let ffmpeg = null, ffmpegLoading = null;
  function webPlayable(file) {
    const t = (file.type || '').toLowerCase(), n = (file.name || '').toLowerCase();
    if (t.startsWith('video/')) return /mp4|webm|ogg/.test(t) || /\.(mp4|m4v|webm|ogv)$/.test(n);
    if (t.startsWith('audio/')) return /mpeg|mp3|aac|wav|ogg|opus|webm/.test(t) || /\.(mp3|m4a|aac|wav|ogg|opus|weba)$/.test(n);
    return /\.(mp4|m4v|webm|ogv|mp3|m4a|aac|wav|ogg|opus)$/.test(n);
  }
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  async function loadFFmpeg() {
    if (ffmpeg) return ffmpeg;
    if (ffmpegLoading) return ffmpegLoading;
    ffmpegLoading = (async () => {
      try {
        if (!window.FFmpeg) await loadScript('https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js');
        const ff = window.FFmpeg.createFFmpeg({ log: false, corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js' });
        await ff.load(); ffmpeg = ff; return ff;
      } catch (e) { ffmpegLoading = null; return null; }
    })();
    return ffmpegLoading;
  }
  async function transcodeFile(file) {
    const ff = await loadFFmpeg();
    if (!ff) { toast('Transcoder unavailable — storing “' + file.name + '” as-is.'); return file; }
    try {
      toast('Transcoding “' + file.name + '” → web-playable MP4…');
      const inName = 'in_' + Date.now(), outName = 'out.mp4';
      ff.FS('writeFile', inName, new Uint8Array(await file.arrayBuffer()));
      await ff.run('-i', inName, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', outName);
      const data = ff.FS('readFile', outName);
      try { ff.FS('unlink', inName); ff.FS('unlink', outName); } catch (e) {}
      toast('Transcoded “' + file.name + '”.');
      return new File([data.buffer], file.name.replace(/\.[^.]+$/, '') + '.mp4', { type: 'video/mp4' });
    } catch (e) { toast('Transcode failed — storing as-is.'); return file; }
  }

  // ── program decks (transport) ────────────────────────────────────────────
  function deckOf(a) { return a && decks[a.deck]; }
  function freeVideoDeck() { return (active && active.deck === 'a') ? decks.b : decks.a; }
  function deckGain(deck, v) { v = clamp(v, 0, 1); if (audioOK && deck.ch) deck.ch.gain.gain.value = v * (deck.vol == null ? 1 : deck.vol); else deck.el.volume = v * (deck.vol == null ? 1 : deck.vol); }
  function deckSetVol(deck, vol) { deck.vol = clamp(vol, 0, 1); }
  function deckOpacity(deck, v) { if (deck.kind === 'video' || deck.kind === 'image') deck.el.style.opacity = v; }
  function showDeck(deck) { if (deck.kind !== 'video') return; decks.a.el.classList.toggle('front', deck === decks.a); decks.b.el.classList.toggle('front', deck === decks.b); }
  function applyFit(deck, cue) { const el = deck.el; if (deck.kind !== 'video' && deck.kind !== 'image') return; el.style.objectFit = cue.fit || 'contain'; el.style.transform = 'translate(' + (cue.posX || 0) + '%,' + (cue.posY || 0) + '%) scale(' + (cue.scale || 1) + ')'; }
  function aspectLabel(w, h) { const g = (a, b) => b ? g(b, a % b) : a; const d = g(w, h) || 1; const rw = w / d, rh = h / d; return (rw > 40 || rh > 40) ? (w / h).toFixed(2) + ':1' : rw + ':' + rh; }

  function clearPre() { if (preTimer) { clearTimeout(preTimer); preTimer = null; } preInfo = null; }

  function stopDeck(deck, opts) {
    if (!deck) return;
    deck.el.onerror = null;   // teardown must never look like a media failure
    if (deck.kind === 'image') {
      cancelFade('in-img');
      if (!opts || !opts.keepFrame) { deck.el.removeAttribute('src'); deck.el.style.opacity = 0; }
      if (deck._url) { try { URL.revokeObjectURL(deck._url); } catch (e) {} deck._url = null; }
      return;
    }
    try { deck.el.pause(); } catch (e) {}
    deck.el.onended = deck.el.ontimeupdate = deck.el.onplay = deck.el.onplaying = null;
    cancelFade('in-' + deck.id); cancelFade('out-' + deck.id);
    if (!opts || !opts.keepFrame) { deck.el.removeAttribute('src'); try { deck.el.load(); } catch (e) {} deckOpacity(deck, 0); }
    if (deck._url) { try { URL.revokeObjectURL(deck._url); } catch (e) {} deck._url = null; }
  }
  function stopAllDecks(opts) { clearImageTimer(); clearPreload(); ['a', 'b', 'audio', 'img'].forEach(k => stopDeck(decks[k], opts)); active = null; }

  function isActivePaused() {
    if (!active || preInfo || active.held) return false;   // held = finished, frame parked; GO fires the next cue
    return active.kind === 'image' ? !!active.paused : !!(active.el && active.el.paused);
  }
  // GO doubles as RESUME while the program is paused — the AVT-lab fix:
  // trigger-after-pause continues from the pause offset, never from the top.
  function go() {
    if (isActivePaused()) { pauseResume(); return; }
    let cue = cueById(selectedId);
    if (!cue) { cue = cues.find(c => c.armed !== false); if (cue) selectedId = cue.id; }
    if (!cue) { toast('No cue to fire. Add media first.'); return; }
    const next = nextArmedAfter(cue.id);
    fireCue(cue);
    selectedId = next || selectedId;
    renderCueList(); renderInspector(); renderEditArea();
  }
  // The green transport button (and its advertised GO/Space key): toggle pause
  // while a cue is live, else fire the armed cue (folding in resume). Pausing an
  // actively-playing cue matches its Play/Pause label — the key routes here too
  // so the shortcut and the button behave identically.
  function goPauseButton() {
    if (preInfo) return;              // mid pre-wait: ignore taps, let it count in
    if (active && !active.held) { pauseResume(); return; }
    go();
  }
  // Keep the big transport button honest about what it will do: pause glyph while
  // a cue is actively playing, play glyph when idle or paused ("Resume").
  function syncGoButton() {
    const b = $('og-go'); if (!b) return;
    const paused = isActivePaused();
    const playing = !!active && !preInfo && !paused && !active.held;
    const state = playing ? 'playing' : paused ? 'paused' : 'idle';
    if (b._goState === state) return;
    b._goState = state;
    const keyTxt = ($('og-k-go') && $('og-k-go').textContent) || '';
    const icon = sym('media.playpause');   // playpause.circle.fill — one glyph for the toggle; label + color carry the state
    const label = paused ? 'Resume' : 'Play / Pause';
    b.innerHTML = icon + label + '<span class="og-tbtn-key" id="og-k-go">' + esc(keyTxt) + '</span>';
  }
  function fireCue(cue) {
    clearPre();
    slog('cue', 'GO · #' + cue.num + ' “' + cue.name + '”' + (cue.preWait > 0 ? ' (pre-wait ' + cue.preWait + 's)' : ''));
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
    if (cue.type === 'image') return beginImage(cue);
    const media = await idbGet(MEDIA_STORE, cue.mediaId);
    if (!media || !media.blob) { slog('error', 'Media missing for “' + cue.name + '” at fire time'); toast('Media missing for "' + cue.name + '".'); setStatus('idle'); return; }
    ensureAudio();
    const isAudio = cue.type === 'audio';
    const prev = active;
    // fire on the preloaded deck when this cue was cue-ahead staged there
    let deck = isAudio ? decks.audio : freeVideoDeck();
    if (!isAudio && preloaded && preloaded.cueId === cue.id && preloaded.kind === 'video' && decks[preloaded.deck] && (!active || active.deck !== preloaded.deck)) deck = decks[preloaded.deck];
    const pre = (preloaded && preloaded.cueId === cue.id && preloaded.deck === deck.id) ? preloaded : null;
    if (pre) { preloaded = null; }   // media already staged on this deck's src
    else {
      if (deck._url) { try { URL.revokeObjectURL(deck._url); } catch (e) {} }
      deck._url = URL.createObjectURL(media.blob);
      deck.el.src = deck._url;
    }
    deck.el.loop = !!cue.loop; deckSetVol(deck, cue.volume);
    deck.el.onended = deck.el.ontimeupdate = deck.el.onplay = deck.el.onplaying = deck.el.onerror = null;
    if (audioOK && deck.ch) { applyChannel(deck.ch, { eq: cue.eq, comp: cue.comp }); deck.el.volume = 1; }
    applyFit(deck, cue);

    active = { cue, kind: isAudio ? 'audio' : 'video', deck: isAudio ? 'audio' : (deck === decks.a ? 'a' : 'b'), el: deck.el, ch: deck.ch };
    deck.el.onplay = () => { if (cue.continueMode === 'auto_continue') setTimeout(() => autoFrom(cue), 60); };
    deck.el.onplaying = () => { if (cue.broken) { cue.broken = false; renderCueList(); scheduleSave(); } };
    deck.el.ontimeupdate = () => { if (cue.trimOut != null && deck.el.currentTime >= cue.trimOut) handleEnded(cue); };
    deck.el.onended = () => { if (!deck.el.loop) handleEnded(cue); };
    deck.el.onerror = () => failLive(cue, deck);   // decode death mid-show → black slate, never a hang
    // resume from a persisted pause offset when this cue was recovered mid-show
    let startAt = cue.trimIn || 0;
    if (pendingResume && pendingResume.cueId === cue.id) { startAt = Math.max(startAt, pendingResume.offset || 0); pendingResume = null; }
    try { deck.el.currentTime = startAt; } catch (e) {}
    if (!isAudio) showDeck(deck);
    try { await deck.el.play(); } catch (e) {
      if (e && e.name === 'NotAllowedError') {
        // Autoplay blocked: nothing is on air — do NOT report ON AIR, notify the
        // output, or advance. Re-arm this cue so GO genuinely retries it.
        toast('Playback blocked by the browser — press GO again.');
        active = prev;
        if (!isAudio && prev && prev.kind === 'video') showDeck(deckOf(prev));
        selectedId = cue.id;
        renderCueList(); renderInspector(); renderEditArea();
        return;
      }
      failLive(cue, deck, e); return;
    }

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
      if (crossing && xf > 0 && sameOut) sendOut({ t: 'xfade', mediaId: cue.mediaId, at: cue.trimIn || 0, ms: xf * 1000, curve, volume: cue.volume, loop: cue.loop, fit: cue.fit, scale: cue.scale || 1, posX: cue.posX || 0, posY: cue.posY || 0 }, out);
      else sendOut({ t: 'play', mediaId: cue.mediaId, at: cue.trimIn || 0, loop: cue.loop, volume: cue.volume, fadeIn: (cue.fadeIn || 0) * 1000, curve, fit: cue.fit, scale: cue.scale || 1, posX: cue.posX || 0, posY: cue.posY || 0 }, out);
      if (prevOut != null && !sameOut) sendOut({ t: 'stop' }, prevOut);   // clear the output we left
    } else if (prevOut != null) {
      sendOut({ t: 'black', ms: (cue.fadeIn || 0) * 1000 }, prevOut);     // program became audio → clear that picture
    }
    applyKeyForActive();          // Phase 5: keying on/off for this cue (control + output)
    fireObsForCue(cue);           // Phase 5: any OBS action programmed on this cue
    preloadNext(cue);             // Phase 2 (master plan): stage the next armed cue for an instant GO
  }

  // ── Phase 2 (master plan): stills as first-class playout items ───────────
  // An image cue holds on screen until advanced; an optional duration (>0)
  // arms an auto-advance timer that honours the cue's continue/end settings.
  async function beginImage(cue) {
    const media = await idbGet(MEDIA_STORE, cue.mediaId);
    if (!media || !media.blob) { toast('Media missing for "' + cue.name + '".'); setStatus('idle'); return; }
    const prev = active;
    const deck = decks.img, el = deck.el;
    const pre = (preloaded && preloaded.cueId === cue.id && preloaded.kind === 'image') ? preloaded : null;
    if (deck._url && (!pre || pre.url !== deck._url)) { try { URL.revokeObjectURL(deck._url); } catch (e) {} deck._url = null; }
    if (pre) { deck._url = pre.url; preloaded = null; }
    if (!deck._url) deck._url = URL.createObjectURL(media.blob);
    el.onerror = () => failLive(cue, deck);
    el.src = deck._url;
    el.style.objectFit = cue.fit || 'contain';
    el.style.transform = 'translate(' + (cue.posX || 0) + '%,' + (cue.posY || 0) + '%) scale(' + (cue.scale || 1) + ')';
    active = { cue, kind: 'image', deck: 'img', el: null, paused: false, shownAt: performance.now(), remainMs: cue.duration > 0 ? cue.duration * 1000 : 0, imgTimer: null, timerStart: 0 };
    const out = cue.output || 1, curve = fadeCurveOf(cue), fi = (cue.fadeIn || 0) * 1000;
    sendOut({ t: 'image', mediaId: cue.mediaId, fadeIn: fi, curve, fit: cue.fit, scale: cue.scale || 1, posX: cue.posX || 0, posY: cue.posY || 0 }, out);
    if (prev) {
      const pd = deckOf(prev); if (pd && pd !== deck) stopDeck(pd);
      if (prev.kind === 'video' && (prev.cue.output || 1) !== out) sendOut({ t: 'stop' }, prev.cue.output || 1);
    }
    if (fi > 0) { el.style.opacity = 0; runFade('in-img', v => { el.style.opacity = v; }, 0, 1, fi, curve); }
    else el.style.opacity = 1;
    if (active.remainMs > 0) armImageTimer();
    setStatus('play'); startTicker(); renderCueList();
    applyKeyForActive();          // stills never key — this also stops a leftover key loop
    fireObsForCue(cue);
    preloadNext(cue);
  }
  function armImageTimer() {
    clearImageTimer();
    if (!active || active.kind !== 'image' || !(active.remainMs > 0)) return;
    active.timerStart = performance.now();
    active.imgTimer = setTimeout(() => { if (active && active.kind === 'image') handleEnded(active.cue); }, active.remainMs);
  }
  function clearImageTimer() { if (active && active.imgTimer) { clearTimeout(active.imgTimer); active.imgTimer = null; } }

  // ── Phase 2 (master plan): black-slate failure containment ───────────────
  // A cue that dies mid-show never hangs the program: picture cuts to black,
  // the operator gets a non-blocking alert, the cue is flagged in the list,
  // and the rundown stays advanceable. (Decisions Log #4: black slate.)
  function failLive(cue, deck, err) {
    try { console.warn('[outrangutan] cue failed:', cue && cue.name, (err && err.message) || (deck && deck.el && deck.el.error && deck.el.error.message) || err || ''); } catch (e) {}
    if (active && active.kind === 'image') clearImageTimer();
    cue.broken = true;
    if (deck) stopDeck(deck);
    if (active && active.cue && active.cue.id === cue.id) { active = null; stopKeyLoop(); }
    setStatus('idle');
    if (cue.type === 'video' || cue.type === 'image') sendOut({ t: 'black', ms: 0 }, cue.output || 1);
    renderCueList(); scheduleSave();
    slog('error', '“' + cue.name + '” failed to play — cut to black slate' + (err && err.message ? ' (' + err.message + ')' : ''));
    toast('⚠ “' + cue.name + '” failed to play — black slate. Show continues; cue is marked.');
  }

  // ── Phase 2 (master plan): cue-ahead preload ──────────────────────────────
  // Scoped to the control-side decks (outputs still load on demand at fire
  // time): the next armed cue's media is staged on the idle deck so GO is
  // instant. Staged video/audio URLs are owned by the deck lifecycle; a staged
  // image URL is owned by `preloaded` until adopted.
  let preloaded = null;   // { cueId, kind, deck? , url? }
  function clearPreload() {
    if (preloaded && preloaded.kind === 'image' && preloaded.url) { try { URL.revokeObjectURL(preloaded.url); } catch (e) {} }
    preloaded = null;
  }
  async function preloadNext(fromCue) {
    try {
      const next = cueById(nextArmedAfter(fromCue.id));
      if (!next || !next.mediaId || next.broken) { clearPreload(); return; }
      if (preloaded && preloaded.cueId === next.id) return;
      clearPreload();
      const media = await idbGet(MEDIA_STORE, next.mediaId);
      if (!media || !media.blob) return;
      if (next.type === 'video' || next.type === 'audio') {
        const deck = next.type === 'audio' ? decks.audio : freeVideoDeck();
        if (active && deckOf(active) === deck) return;   // never touch the live deck
        if (deck._url) { try { URL.revokeObjectURL(deck._url); } catch (e) {} }
        deck.el.onended = deck.el.ontimeupdate = deck.el.onplay = deck.el.onplaying = deck.el.onerror = null;
        deck._url = URL.createObjectURL(media.blob);
        deck.el.preload = 'auto'; deck.el.src = deck._url;
        try { deck.el.load(); } catch (e) {}
        preloaded = { cueId: next.id, kind: next.type, deck: deck.id };
      } else if (next.type === 'image') {
        const url = URL.createObjectURL(media.blob);
        const im = new Image(); im.src = url;   // warms the decode cache
        preloaded = { cueId: next.id, kind: 'image', url };
      }
    } catch (e) { clearPreload(); }
  }

  function autoFrom(cue) {
    const nextId = nextArmedAfter(cue.id);
    const next = cueById(nextId);
    if (!next) return;
    selectedId = nextArmedAfter(next.id) || nextId;
    fireCue(next);
    renderCueList(); renderInspector(); renderEditArea();
  }
  function handleEnded(cue) {
    clearImageTimer();
    const m = cue.continueMode;
    if (m === 'auto_follow') { autoFrom(cue); return; }
    // end action for the picture/audio (output messages only for picture cues — audio never touches one)
    const deck = active ? deckOf(active) : null;
    const hasPicture = cue.type === 'video' || cue.type === 'image', out = cue.output || 1;
    // hold-last-frame: keep the frame up but mark the cue finished — GO must fire
    // the NEXT cue, never resume this one from 0:00 (play() on ended media rewinds)
    if (deck && cue.endAction === 'hold') { try { if (deck.el.pause) deck.el.pause(); } catch (e) {} if (active) active.held = true; setStatus('idle'); if (cue.type === 'video') sendOut({ t: 'holdLast' }, out); renderCueList(); return; }
    if (deck && cue.endAction === 'black') { runFade('out-' + deck.id, v => { deckGain(deck, v); deckOpacity(deck, v); }, 1, 0, 600, fadeCurveOf(cue), () => stopDeck(deck)); active = null; stopKeyLoop(); if (hasPicture) sendOut({ t: 'black', ms: 600 }, out); setStatus('idle'); renderCueList(); return; }
    if (deck) stopDeck(deck); active = null; stopKeyLoop();
    setStatus('idle'); if (hasPicture) sendOut({ t: 'stop' }, out); renderCueList();
  }

  // Cue the standby cursor back to the first armed cue, so the next GO restarts the show.
  function cueToTop() { const first = cues.find(c => c.armed !== false) || cues[0]; if (first) selectedId = first.id; }
  function stopAll(opts) {
    clearPre(); stopAllDecks(); stopKeyLoop(); setStatus('idle'); sendOut({ t: 'stop' });
    if (!opts || !opts.silent) { cueToTop(); renderInspector(); renderEditArea(); slog('media', 'Stop'); toast('Stopped.'); }
    renderCueList();
  }
  function panic() {
    clearPre();
    fades.forEach((r) => cancelAnimationFrame(r)); fades.clear();
    stopAllDecks(); stopAllPads(); stopKeyLoop();
    setStatus('idle'); sendOut({ t: 'stop' }); cueToTop(); renderCueList(); renderInspector(); renderEditArea();
    slog('media', 'PANIC — everything stopped');
    toast('PANIC — all stopped.');
  }
  function pauseResume() {
    if (active && active.held) return;   // a held-last-frame cue is finished — nothing to pause or resume
    if (active && active.kind === 'image') {
      if (active.paused) { active.paused = false; if (active.remainMs > 0) armImageTimer(); setStatus('play'); }
      else {
        if (active.imgTimer) { active.remainMs = Math.max(0, active.remainMs - (performance.now() - active.timerStart)); clearImageTimer(); }
        active.paused = true; setStatus('pause'); saveShow();
      }
      renderCueList(); return;
    }
    if (!active || !active.el) { if (preInfo) stopAll(); return; }
    const el = active.el;
    const out = active.cue.output || 1;
    if (el.paused) { el.play(); setStatus('play'); sendOut({ t: 'resume' }, out); slog('media', 'Resume · “' + active.cue.name + '” at ' + (Math.round(el.currentTime * 10) / 10) + 's'); }
    else { el.pause(); setStatus('pause'); sendOut({ t: 'pause' }, out); saveShow(); slog('media', 'Pause · “' + active.cue.name + '” at ' + (Math.round(el.currentTime * 10) / 10) + 's'); }   // persist the pause offset immediately
    renderCueList();
  }
  function fadeStopAll() {
    clearPre();   // a pending pre-wait cue must never fire on air after the operator stopped everything
    const ms = 800, curve = settings.fadeCurve;
    clearImageTimer();
    sendOut({ t: 'fade', to: 0, ms });
    let any = false;
    ['a', 'b', 'audio', 'img'].forEach(k => {
      const d = decks[k];
      if (d._url && !d.el.paused) { any = true; runFade('out-' + d.id, v => { deckGain(d, v); deckOpacity(d, v); }, 1, 0, ms, curve, () => stopDeck(d)); }
    });
    padRT.forEach((rt, id) => { const p = padById(id); if (p && rt.voices.length) { any = true; runFade('padin-' + id, v => { rt.ch.gain.gain.value = v * (p.gain == null ? 1 : p.gain); }, 1, 0, ms, curve, () => stopPad(p)); } });
    const wasActive = active;   // if a new cue fires during the fade, this reset must not clobber it
    if (any) { toast('Fading out…'); setTimeout(() => { if (active !== wasActive) return; active = null; stopKeyLoop(); setStatus('idle'); cueToTop(); renderCueList(); renderInspector(); renderEditArea(); renderPads(); }, ms + 30); }
    else stopAll();
  }

  function setStatus(s) {
    const tag = $('og-program-status');
    if (tag) {
      tag.className = 'og-program-status og-status-' + (s === 'play' ? 'play' : s === 'pre' ? 'pre' : s === 'pause' ? 'pause' : 'idle');
      tag.textContent = s === 'play' ? 'ON AIR' : s === 'pre' ? 'PRE-WAIT' : s === 'pause' ? 'PAUSED' : 'IDLE';
    }
    syncGoButton();               // GO ⇄ RESUME label tracks the paused state
    publishLive(true);            // push transport change to the rundown immediately
  }

  // ── count-out clock + ticker ─────────────────────────────────────────────
  function startTicker() { if (rafId) return; const loop = () => { renderClock(); renderEditPlayhead(); publishLive(); maybePersistTransport(); rafId = requestAnimationFrame(loop); }; rafId = requestAnimationFrame(loop); }
  // Persist the playhead every ~10 s while the program runs, so a UI reload
  // mid-show recovers to (at worst) a few seconds behind the real position.
  function maybePersistTransport() {
    if (!active) return;
    const now = Date.now();
    if (now - lastTransportSave < 10000) return;
    lastTransportSave = now;
    saveShow();
  }
  function stopTicker() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
  function cuePlayoutDuration(c, el) {
    if (!c) return 0;
    const base = c.type === 'image' ? (c.duration || 0) : ((el && isFinite(el.duration)) ? el.duration : (c.duration || 0));
    const out = c.trimOut != null ? c.trimOut : base;
    return Math.max(0, (out || 0) - (c.trimIn || 0));
  }
  function renderClock() {
    const timeEl = $('og-clock-time'), labelEl = $('og-clock-label'), durEl = $('og-clock-duration'), wrap = $('og-clock');
    if (!timeEl) return;
    const setDuration = (secs) => { if (durEl) durEl.textContent = 'DUR ' + fmtClock(Math.max(0, secs || 0)); };
    // dir: 'up' counting up (elapsed → green), 'down' counting down (remaining → red)
    const setClock = (state, dir) => { wrap.className = 'og-clock' + (state ? ' ' + state : '') + ' ' + (dir === 'up' ? 'og-count-up' : 'og-count-down'); };
    if (preInfo) {
      const remain = Math.max(0, (preInfo.until - performance.now()) / 1000);
      setDuration(cuePlayoutDuration(preInfo.cue));
      timeEl.textContent = fmtSmpte(remain); labelEl.textContent = 'PRE-WAIT · ' + esc(preInfo.cue.name);
      setClock('warn', 'down'); return;
    }
    if (active && active.kind === 'image') {
      const c = active.cue;
      setDuration(cuePlayoutDuration(c));
      if (active.remainMs > 0 || c.duration > 0) {
        const left = active.paused ? active.remainMs / 1000
          : Math.max(0, (active.remainMs - (performance.now() - active.timerStart)) / 1000);
        timeEl.textContent = fmtSmpte(left);
        labelEl.textContent = active.paused ? 'PAUSED' : 'REMAINING';
        setClock(active.paused || left <= 10 ? 'warn' : 'run', 'down');
      } else {
        timeEl.textContent = fmtSmpte((performance.now() - active.shownAt) / 1000);
        labelEl.textContent = active.paused ? 'PAUSED' : 'HOLD';
        setClock(active.paused ? 'warn' : 'run', 'up');
      }
      return;
    }
    if (active && active.el && !active.el.paused) {
      const el = active.el, end = (active.cue.trimOut != null ? active.cue.trimOut : (isFinite(el.duration) ? el.duration : active.cue.duration));
      const elapsed = el.currentTime - (active.cue.trimIn || 0);
      const remain = Math.max(0, end - el.currentTime);
      const up = settings.clockMode === 'elapsed';
      timeEl.textContent = fmtSmpte(up ? Math.max(0, elapsed) : remain);
      labelEl.textContent = up ? 'ELAPSED' : 'REMAINING';
      setDuration(cuePlayoutDuration(active.cue, active.el));
      setClock(remain <= 10 ? 'warn' : 'run', up ? 'up' : 'down');
      return;
    }
    if (active && active.el && active.el.paused) {
      const remain = Math.max(0, ((active.cue.trimOut != null ? active.cue.trimOut : active.el.duration) || 0) - active.el.currentTime);
      timeEl.textContent = fmtSmpte(remain); labelEl.textContent = 'PAUSED'; setDuration(cuePlayoutDuration(active.cue, active.el)); setClock('warn', 'down'); return;
    }
    const sel = cueById(selectedId);
    timeEl.textContent = fmtSmpte(sel ? sel.duration : 0);
    labelEl.textContent = sel ? 'DURATION' : 'STANDBY';
    setDuration(sel ? cuePlayoutDuration(sel) : 0);
    // idle standby: colour by the clockMode preference (remaining→down/red, elapsed→up/green)
    setClock('', settings.clockMode === 'elapsed' ? 'up' : 'down');
    if (!active && !preInfo) stopTicker();
  }

  function formatWallClock(d) {
    const pad2 = n => String(n).padStart(2, '0');
    if (settings.wallClockMode === '12') {
      const h = d.getHours();
      const hr = h % 12 || 12;
      return hr + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + ' ' + (h >= 12 ? 'PM' : 'AM');
    }
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function renderWallClock() {
    const t = $('og-wallclock-t'), wrap = $('og-wallclock');
    if (!t || !wrap || !isOpen()) return;
    t.textContent = formatWallClock(new Date());
    wrap.setAttribute('aria-label', 'Time of day, ' + (settings.wallClockMode === '12' ? '12-hour' : '24-hour') + '. Click to toggle.');
    wrap.title = settings.wallClockMode === '12' ? 'Switch to 24-hour clock' : 'Switch to 12-hour clock';
  }

  function toggleWallClockMode() {
    settings.wallClockMode = settings.wallClockMode === '12' ? '24' : '12';
    renderWallClock();
    scheduleSave();
  }

  // ── meters ───────────────────────────────────────────────────────────────
  function startMeterLoop() { if (meterRAF) return; const loop = () => { paintMeters(); meterRAF = requestAnimationFrame(loop); }; meterRAF = requestAnimationFrame(loop); }
  function level(an, buf) { an.getByteTimeDomainData(buf); let peak = 0, sum = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128, a = x < 0 ? -x : x; if (a > peak) peak = a; sum += x * x; } return { rms: Math.sqrt(sum / buf.length), peak }; }
  function paintMeter(fillEl, peakEl, an, buf) {
    const l = level(an, buf), v = Math.min(1, l.rms * 1.9);
    fillEl.style.transform = 'scaleX(' + v.toFixed(3) + ')';
    if (peakEl) { let ph = parseFloat(peakEl.dataset.p || '0'); ph = Math.max(l.peak, ph - 0.013); peakEl.dataset.p = ph; peakEl.style.left = (Math.min(1, ph) * 100).toFixed(1) + '%'; peakEl.style.opacity = ph > 0.02 ? '1' : '0'; }
  }
  // Vertical variant for the program VU bars (transform-origin: bottom in CSS).
  function paintMeterY(fillEl, an, buf) {
    const l = level(an, buf), v = Math.min(1, l.rms * 1.9);
    fillEl.style.transform = 'scaleY(' + v.toFixed(3) + ')';
  }
  function paintMeters() {
    if (!ac || !isOpen()) return;
    // program VU: two vertical bars driven from the true L/R channel taps
    // (falls back to the mono master analyser if the splitter is unavailable)
    if (master) {
      const vl = $('og-vu-l'), vr = $('og-vu-r');
      if (vl) paintMeterY(vl, master.analyserL || master.analyser, master.bufL || master.buf);
      if (vr) paintMeterY(vr, master.analyserR || master.analyser, master.bufR || master.buf);
    }
    const mf2 = $('og-master-fill2'); if (mf2 && master) paintMeter(mf2, null, master.analyser, master.buf);
    const cf = $('og-cue-meter-fill'); if (cf && active && active.ch) paintMeter(cf, null, active.ch.analyser, active.ch.buf);
    if (settings.tab === 'sfx') {
      pads.forEach(p => { const rt = padRT.get(p.id); const f = $('og-padmeter-' + p.id); if (f && rt && rt.voices.length) paintMeter(f, null, rt.ch.analyser, rt.ch.buf); else if (f) f.style.transform = 'scaleX(0)'; });
      const pf = $('og-pad-meter-fill'); const sp = selectedPadId && padRT.get(selectedPadId); if (pf && sp && sp.voices.length) paintMeter(pf, null, sp.ch.analyser, sp.ch.buf); else if (pf) pf.style.transform = 'scaleX(0)';
    }
  }

  // ── rendering ────────────────────────────────────────────────────────────
  function renderAll() { renderCueList(); renderInspector(); renderEditArea(); renderClock(); renderBanks(); renderPads(); renderPadInspector(); renderPadEditArea(); renderPadSearch(); }

  function renderCueList() {
    const wrap = $('og-cuelist'); if (!wrap) return;
    if (!cues.length) { wrap.innerHTML = '<div class="og-cue-empty">No cues yet.<br>Drop a video, audio, or still-image file below, or click “Add media”.</div>'; return; }
    const playingId = active ? active.cue.id : (preInfo ? preInfo.cue.id : null);
    wrap.innerHTML = cues.map(c => {
      const cls = ['og-cue']; if (c.id === selectedId) cls.push('selected'); if (c.id === playingId) cls.push('playing'); if (c.armed === false) cls.push('armed-off'); if (c.broken) cls.push('broken');
      const cont = c.continueMode === 'auto_follow' ? 'FOLLOW' : c.continueMode === 'auto_continue' ? 'CONT' : '';
      const durTxt = c.type === 'image' ? (c.duration > 0 ? fmtClock(c.duration) : 'HOLD') : fmtClock(c.duration);
      return '<div class="' + cls.join(' ') + '" data-id="' + c.id + '">'
        + '<span class="og-cue-color-dot" style="background:' + c.color + '"></span>'
        + '<span class="og-cue-num">' + c.num + '</span>'
        + '<span class="og-cue-typeicon og-type-' + c.type + '">' + sym(c.type === 'audio' ? 'department.audio' : c.type === 'image' ? 'content.image' : 'department.video') + '</span>'
        + '<span class="og-cue-name">' + esc(c.name) + '</span>'
        + '<span class="og-cue-meta">' + (c.broken ? '<span class="og-cue-cont og-cue-bad" title="Failed to play last time — replace or re-import this media">⚠</span>' : '') + (cont ? '<span class="og-cue-cont">' + cont + '</span>' : '') + (c.xfade > 0 ? '<span class="og-cue-cont">XF' + c.xfade + 's</span>' : '') + (c.preWait > 0 ? '<span class="og-cue-cont">' + sym('state.timed') + c.preWait + 's</span>' : '') + '<span>' + durTxt + '</span></span>'
        + '</div>';
    }).join('');
    Array.prototype.forEach.call(wrap.querySelectorAll('.og-cue'), el => {
      el.onclick = () => { selectedId = el.getAttribute('data-id'); renderCueList(); renderInspector(); renderEditArea(); if (!active && !preInfo) renderClock(); };
      el.ondblclick = () => { selectedId = el.getAttribute('data-id'); go(); };
    });
  }

  function renderInspector() {
    const ins = $('og-inspector'); if (!ins) return;
    const c = cueById(selectedId);
    updateSelectionState();
    if (!c) { ins.innerHTML = '<div class="og-insp-empty">Select a cue to edit its properties.</div>'; return; }
    const eq = c.eq || (c.eq = { low: 0, mid: 0, high: 0 });
    const dims = c.srcW && c.srcH
      ? '<div class="og-insp-meta">' + c.srcW + '×' + c.srcH + ' · ' + aspectLabel(c.srcW, c.srcH) + (c.type === 'image' ? ' · still' : '') + '</div>'
      : '';
    // Inspector standard (DESIGN_GUIDELINES.md): icon tabs pick ONE flat group;
    // sections are bold text headers + hairlines, controls sit on the panel
    // background — no ui-card boxes. Tab remembered in localStorage.
    const hasAudio = c.type !== 'image';
    const hasPicture = c.type === 'video' || c.type === 'image';
    const tabs = [{ key: 'timing', icon: 'state.timed', label: 'Timing' }]
      .concat(hasAudio ? [{ key: 'audio', icon: 'department.audio', label: 'Audio' }] : [])
      .concat(hasPicture ? [{ key: 'picture', icon: 'content.image', label: 'Picture' }] : [])
      .concat([{ key: 'cue', icon: 'action.settings', label: 'Cue' }]);
    let activeTab = 'timing';
    try { activeTab = localStorage.getItem('og_insp_tab') || 'timing'; } catch (e) {}
    if (!tabs.some(t => t.key === activeTab)) activeTab = 'timing';

    const timingPane =
      sec('Timing',
        field('Pre-wait (s)', '<input id="og-i-prewait" type="number" min="0" step="0.5" value="' + c.preWait + '">') +
        field('Continue', '<select id="og-i-continue">' +
          opt('manual', 'Manual', c.continueMode) + opt('auto_continue', 'Continue', c.continueMode) + opt('auto_follow', 'Follow', c.continueMode) + '</select>') +
        (c.type === 'image' ?
          field('Duration (s) — 0 holds', '<input id="og-i-imgdur" type="number" min="0" step="0.5" value="' + (c.duration || 0) + '">') +
          field('On end', '<select id="og-i-endaction">' + opt('stop', 'Cut', c.endAction) + opt('hold', 'Hold', c.endAction) + opt('black', 'Fade', c.endAction) + '</select>')
        : '')
      ) +
      sec('Fades',
        field('In (s)', '<input id="og-i-fadein" type="number" min="0" step="0.1" value="' + (c.fadeIn || 0) + '">') +
        field('Out (s)', '<input id="og-i-fadeout" type="number" min="0" step="0.1" value="' + (c.fadeOut || 0) + '">') +
        field('Curve', '<select id="og-i-fadecurve">' + opt('', 'Auto', c.fadeCurve) + opt('linear', 'Linear', c.fadeCurve) + opt('s', 'S', c.fadeCurve) + opt('log', 'Log', c.fadeCurve) + '</select>') +
        (c.type === 'video' ? field('Crossfade in (s)', '<input id="og-i-xfade" type="number" min="0" step="0.1" value="' + (c.xfade || 0) + '">') : '')
      ) +
      (c.type === 'image' ? '' :
      sec('Edit',
        '<div class="og-field-row">' +
          field('Trim in (s)', '<input id="og-i-trimin" type="number" min="0" step="0.1" value="' + (c.trimIn || 0) + '">') +
          field('Trim out (s)', '<input id="og-i-trimout" type="number" min="0" step="0.1" value="' + (c.trimOut == null ? '' : c.trimOut) + '" placeholder="end">') +
        '</div>' +
        field('Loop', '<select id="og-i-loop">' + opt('0', 'No', c.loop ? '1' : '0') + opt('1', 'Yes', c.loop ? '1' : '0') + '</select>') +
        field('On end', '<select id="og-i-endaction">' + opt('stop', 'Stop', c.endAction) + opt('hold', 'Hold', c.endAction) + opt('black', 'Fade', c.endAction) + '</select>')
      ));

    const audioPane = !hasAudio ? '' :
      sec('Audio',
        field('Level <span class="og-cue-meter"><span class="og-cue-meter-fill" id="og-cue-meter-fill"></span></span>', '<input id="og-i-volume" type="range" min="0" max="1" step="0.01" value="' + c.volume + '">') +
        '<details class="og-eq-details"><summary class="og-drill">EQ <span class="og-drill-val">' + (eq.low || 0) + ' / ' + (eq.mid || 0) + ' / ' + (eq.high || 0) + '</span><span class="ui-chevron">›</span></summary>' +
        '<div class="og-field-row3">' +
          field('Low', '<input id="og-i-eqlow" type="range" min="-12" max="12" step="0.5" value="' + (eq.low || 0) + '">') +
          field('Mid', '<input id="og-i-eqmid" type="range" min="-12" max="12" step="0.5" value="' + (eq.mid || 0) + '">') +
          field('High', '<input id="og-i-eqhigh" type="range" min="-12" max="12" step="0.5" value="' + (eq.high || 0) + '">') +
        '</div></details>' +
        '<label class="og-check og-field"><span style="flex:1">Compressor</span><input id="og-i-comp" type="checkbox"' + (c.comp ? ' checked' : '') + '></label>'
      );

    const picturePane = !hasPicture ? '' :
      sec('Picture',
        field('Fit', '<select id="og-i-fit">' + opt('contain', 'Contain', c.fit) + opt('cover', 'Cover', c.fit) + opt('fill', 'Fill', c.fit) + '</select>') +
        field('Scale', '<input id="og-i-scale" type="range" min="0.25" max="3" step="0.05" value="' + (c.scale || 1) + '">') +
        '<div class="og-field-row">' +
          field('Pos X (%)', '<input id="og-i-posx" type="number" step="1" value="' + (c.posX || 0) + '">') +
          field('Pos Y (%)', '<input id="og-i-posy" type="number" step="1" value="' + (c.posY || 0) + '">') +
        '</div>' +
        field('Output', '<select id="og-i-output">' + outputs.map(o => opt(o.id, o.label, c.output || 1)).join('') + '</select>')
      ) +
      (c.type === 'video' ? (function () { const k = c.key || (c.key = { mode: 'off', color: '#00b140', sim: 0.3, smooth: 0.1, bg: '#000000' });
        return sec('Key',
          field('Mode', '<select id="og-i-keymode">' + opt('off', 'Off', k.mode) + opt('chroma', 'Chroma', k.mode) + opt('luma', 'Luma', k.mode) + opt('alpha', 'Alpha', k.mode) + '</select>') +
          field('Key colour', '<input id="og-i-keycolor" type="color" value="' + (k.color || '#00b140') + '">') +
          '<div class="og-field-row">' +
            field('Similarity', '<input id="og-i-keysim" type="range" min="0" max="1" step="0.01" value="' + (k.sim == null ? 0.3 : k.sim) + '">') +
            field('Smoothness', '<input id="og-i-keysmooth" type="range" min="0" max="0.5" step="0.01" value="' + (k.smooth == null ? 0.1 : k.smooth) + '">') +
          '</div>' +
          field('Background', '<input id="og-i-keybg" type="color" value="' + (k.bg || '#000000') + '">'));
      })() : '');

    const cuePane =
      sec('Cue',
        field('Armed', '<select id="og-i-armed">' + opt('1', 'On', c.armed === false ? '0' : '1') + opt('0', 'Off', c.armed === false ? '0' : '1') + '</select>') +
        field('Color', '<div class="og-swatches">' + ['var(--video)', 'var(--green)', 'var(--red)', 'var(--yellow)', 'var(--purple)', 'var(--cyan)'].map(col =>
          '<button class="og-swatch' + (c.color === col ? ' sel' : '') + '" data-col="' + col + '" style="background:' + col + '" aria-label="Set cue color"></button>').join('') + '</div>') +
        field('Notes', '<input id="og-i-notes" type="text" value="' + esc(c.notes || '') + '">')
      ) +
      (function () { const ob = c.obs || (c.obs = { action: 'none', scene: '' });
        return sec('OBS',
          field('On fire', '<select id="og-i-obsaction">' + opt('none', '—', ob.action) + opt('scene', 'Switch scene', ob.action) + opt('startRecord', 'Start record', ob.action) + opt('stopRecord', 'Stop record', ob.action) + opt('startStream', 'Start stream', ob.action) + opt('stopStream', 'Stop stream', ob.action) + '</select>') +
          (ob.action === 'scene' ? field('Scene', '<input id="og-i-obsscene" type="text" value="' + esc(ob.scene || '') + '" placeholder="Scene name">') : '') +
          field('Fire on OBS scene', '<input id="og-i-obstrigger" type="text" value="' + esc(c.obsTriggerScene || '') + '" placeholder="(optional) OBS scene">'));
      })() +
      '<button class="og-cue-del" id="og-i-del">' + sym('action.delete') + ' Delete cue</button>';

    const paneFor = { timing: timingPane, audio: audioPane, picture: picturePane, cue: cuePane };
    ins.innerHTML =
      '<div class="insp-head og-insp-head">' +
        '<div class="insp-tabs" role="tablist" aria-label="Cue inspector groups">' +
          tabs.map(t => '<button type="button" class="insp-tab' + (t.key === activeTab ? ' on' : '') + '" role="tab" aria-selected="' + (t.key === activeTab ? 'true' : 'false') + '" data-insp="' + t.key + '" title="' + t.label + '">' + sym(t.icon) + '</button>').join('') +
        '</div>' +
        '<div class="insp-caption" id="og-insp-caption">' + (tabs.find(t => t.key === activeTab) || tabs[0]).label + '</div>' +
      '</div>' +
      '<div class="og-insp-body">' +
        '<div class="ui-context-pill"><span class="ui-pill-dot" style="background:' + c.color + '"></span><span class="ui-pill-name"><input id="og-i-name" type="text" value="' + esc(c.name) + '" aria-label="Cue name"></span></div>' +
        dims +
        tabs.map(t => '<div class="insp-pane' + (t.key === activeTab ? ' on' : '') + '" data-insp-pane="' + t.key + '">' + paneFor[t.key] + '</div>').join('') +
      '</div>';

    Array.prototype.forEach.call(ins.querySelectorAll('.insp-tab'), b => {
      b.onclick = () => {
        const key = b.getAttribute('data-insp');
        try { localStorage.setItem('og_insp_tab', key); } catch (e) {}
        Array.prototype.forEach.call(ins.querySelectorAll('.insp-tab'), x => {
          const on = x === b;
          x.classList.toggle('on', on);
          x.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        Array.prototype.forEach.call(ins.querySelectorAll('.insp-pane'), p => p.classList.toggle('on', p.getAttribute('data-insp-pane') === key));
        const cap = $('og-insp-caption');
        if (cap) cap.textContent = (tabs.find(t => t.key === key) || tabs[0]).label;
      };
    });

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
    bind('og-i-imgdur', 'onchange', e => {   // still-image duration: 0 = hold until advanced
      c.duration = Math.max(0, parseFloat(e.target.value) || 0);
      if (active && active.kind === 'image' && active.cue.id === c.id) {
        active.remainMs = c.duration > 0 ? c.duration * 1000 : 0;
        if (active.paused || !(active.remainMs > 0)) clearImageTimer(); else armImageTimer();
      }
      renderCueList(); scheduleSave();
    });
    bind('og-i-fit', 'onchange', e => { c.fit = e.target.value; if (active && active.cue.id === c.id) applyFit(deckOf(active), c); sendOut({ t: 'fit', fit: c.fit }, c.output || 1); scheduleSave(); });
    bind('og-i-scale', 'oninput', e => { c.scale = parseFloat(e.target.value) || 1; if (active && active.cue.id === c.id) applyFit(deckOf(active), c); scheduleSave(); });
    bind('og-i-posx', 'onchange', e => { c.posX = parseFloat(e.target.value) || 0; if (active && active.cue.id === c.id) applyFit(deckOf(active), c); scheduleSave(); });
    bind('og-i-posy', 'onchange', e => { c.posY = parseFloat(e.target.value) || 0; if (active && active.cue.id === c.id) applyFit(deckOf(active), c); scheduleSave(); });
    bind('og-i-output', 'onchange', e => { c.output = parseInt(e.target.value, 10) || 1; scheduleSave(); });
    // keying (live: the key loop reads c.key each frame; mode change starts/stops it; output mirrors)
    const keyOut = () => { if (active && active.cue.id === c.id && active.kind === 'video') sendOut({ t: 'key', key: c.key }, c.output || 1); };
    bind('og-i-keymode', 'onchange', e => { c.key.mode = e.target.value; renderInspector(); if (active && active.cue.id === c.id) applyKeyForActive(); else keyOut(); scheduleSave(); });
    bind('og-i-keycolor', 'oninput', e => { c.key.color = e.target.value; keyOut(); scheduleSave(); });
    bind('og-i-keysim', 'oninput', e => { c.key.sim = parseFloat(e.target.value); keyOut(); scheduleSave(); });
    bind('og-i-keysmooth', 'oninput', e => { c.key.smooth = parseFloat(e.target.value); keyOut(); scheduleSave(); });
    bind('og-i-keybg', 'oninput', e => { c.key.bg = e.target.value; keyOut(); scheduleSave(); });
    bind('og-i-obsaction', 'onchange', e => { c.obs.action = e.target.value; renderInspector(); scheduleSave(); });
    bind('og-i-obsscene', 'onchange', e => { c.obs.scene = e.target.value; scheduleSave(); });
    bind('og-i-obstrigger', 'onchange', e => { c.obsTriggerScene = e.target.value; scheduleSave(); });
    bind('og-i-armed', 'onchange', e => { c.armed = e.target.value === '1'; renderCueList(); scheduleSave(); });
    bind('og-i-notes', 'oninput', e => { c.notes = e.target.value; scheduleSave(); });
    bind('og-i-del', 'onclick', () => deleteCue(c.id));
    Array.prototype.forEach.call(ins.querySelectorAll('.og-swatch'), sw => { sw.onclick = () => { c.color = sw.getAttribute('data-col'); renderCueList(); renderInspector(); scheduleSave(); }; });
    // P6: upgrade to kit controls IN PLACE — bindings stay on the original
    // elements (hidden but still receiving value + onchange from the upgrades).
    ['og-i-continue', 'og-i-fadecurve', 'og-i-endaction', 'og-i-fit', 'og-i-loop', 'og-i-armed'].forEach(id => upgradeSelectToSeg(ins, id));
    [['og-i-prewait', 0.5], ['og-i-fadein', 0.1], ['og-i-fadeout', 0.1], ['og-i-xfade', 0.1], ['og-i-imgdur', 0.5]].forEach(p => upgradeNumberToStepper(ins, p[0], p[1]));
    upgradeCheckToToggle(ins, 'og-i-comp');
  }
  function field(label, inner) { return '<div class="og-field"><label>' + label + '</label>' + inner + '</div>'; }
  function opt(val, label, cur) { return '<option value="' + val + '"' + (String(cur) === String(val) ? ' selected' : '') + '>' + label + '</option>'; }
  function sub(t) { return '<div class="og-insp-sub">' + t + '</div>'; }
  // Inspector-standard section: bold text header on the panel background —
  // hairlines between sections come from CSS, never a nested card.
  function sec(title, inner) { return '<div class="og-insp-sec"><div class="og-sec-title">' + title + '</div><div class="og-kit">' + inner + '</div></div>'; }
  // ── P6 kit upgrades: swap a rendered control for its reference-language
  // equivalent without touching the binding (the original element keeps its id,
  // holds the value, and still fires its own onchange/oninput). ──
  function upgradeSelectToSeg(root, id) {
    const sel = root.querySelector('#' + id);
    if (!sel || sel.options.length > 4) return;
    const wrap = document.createElement('div');
    wrap.className = 'ui-seg';
    Array.from(sel.options).forEach(o => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ui-seg-btn' + (o.value === sel.value ? ' on' : '');
      b.textContent = o.textContent;
      b.onclick = () => { sel.value = o.value; Array.from(wrap.children).forEach(x => x.classList.toggle('on', x === b)); if (sel.onchange) sel.onchange({ target: sel }); };
      wrap.appendChild(b);
    });
    sel.style.display = 'none';
    sel.parentNode.insertBefore(wrap, sel);
  }
  function upgradeNumberToStepper(root, id, step) {
    const inp = root.querySelector('#' + id);
    if (!inp) return;
    const st = step || parseFloat(inp.step) || 1;
    const wrap = document.createElement('div');
    wrap.className = 'ui-stepper';
    const bump = d => {
      const min = inp.min !== '' ? parseFloat(inp.min) : -1e9, max = inp.max !== '' ? parseFloat(inp.max) : 1e9;
      inp.value = String(Math.round(Math.max(min, Math.min(max, (parseFloat(inp.value) || 0) + d)) * 100) / 100);
      if (inp.onchange) inp.onchange({ target: inp });
    };
    const mk = (t, d) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ui-step-btn'; b.textContent = t; b.onclick = () => bump(d); return b; };
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(mk('−', -st));
    wrap.appendChild(inp);            // moves the input inside the stepper
    wrap.appendChild(mk('+', st));
    inp.classList.add('ui-step-input');
  }
  function upgradeCheckToToggle(root, id) {
    const chk = root.querySelector('#' + id);
    if (!chk) return;
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'ui-toggle' + (chk.checked ? ' on' : '');
    t.setAttribute('role', 'switch');
    t.setAttribute('aria-checked', chk.checked ? 'true' : 'false');
    t.onclick = () => { chk.checked = !chk.checked; t.classList.toggle('on', chk.checked); t.setAttribute('aria-checked', chk.checked ? 'true' : 'false'); if (chk.onchange) chk.onchange({ target: chk }); };
    chk.style.display = 'none';
    chk.parentNode.insertBefore(t, chk);
  }

  // ── Clip Editor (trim / scrub the selected cue) ──────────────────────────
  // The full-width bottom pane: a timeline of the selected clip with draggable
  // IN/OUT handles + a scrub playhead. Live — drives cue.trimIn/trimOut and seeks
  // the active deck. (Resizable layout below.)
  function editClipDuration(c) { return (c && c.duration) || ((active && active.cue.id === (c && c.id) && active.el && isFinite(active.el.duration)) ? active.el.duration : 0); }
  function renderEditArea() {
    const body = $('og-edit-body'), acts = $('og-edit-actions'); if (!body) return;
    const c = cueById(selectedId);
    if (!c) { body.innerHTML = '<div class="og-edit-empty">Select a cue to trim and scrub it.</div>'; if (acts) acts.innerHTML = ''; return; }
    if (c.type === 'image') { body.innerHTML = '<div class="og-edit-empty">Stills have no timeline — set an optional duration in the Inspector (0 holds until advanced).</div>'; if (acts) acts.innerHTML = ''; return; }
    const dur = editClipDuration(c) || 0;
    const tin = clamp(c.trimIn || 0, 0, dur || 1e9);
    const tout = (c.trimOut == null ? dur : clamp(c.trimOut, 0, dur || 1e9)) || dur;
    const isLive = active && active.cue.id === c.id;
    if (acts) acts.innerHTML =
      '<button class="og-bar-btn" id="og-edit-setin" title="Set IN at the playhead">Set In</button>'
      + '<button class="og-bar-btn" id="og-edit-setout" title="Set OUT at the playhead">Set Out</button>'
      + '<button class="og-bar-btn" id="og-edit-reset" title="Clear trim">Reset</button>';
    const pct = (t) => dur > 0 ? (clamp(t, 0, dur) / dur * 100) : 0;
    body.innerHTML =
      '<div class="og-trk-meta"><span class="og-trk-name og-type-' + c.type + '-fg">' + esc(c.name) + '</span>'
        + '<span class="og-trk-times"><b id="og-trk-cur">0:00</b> · IN <span id="og-trk-in-t">' + fmtClock(tin) + '</span> · OUT <span id="og-trk-out-t">' + fmtClock(tout) + '</span> · ' + fmtClock(dur) + '</span></div>'
      + '<div class="og-track" id="og-track">'
        + (c.type === 'video'
            ? '<div class="og-track-strip loading" id="og-trk-strip">' + (c.thumb ? '<div class="frame" style="background-image:url(' + c.thumb + ')"></div>' : '') + '</div>'
            : '<div class="og-track-thumb og-track-' + c.type + '"></div>')
        + '<div class="og-track-region" id="og-trk-region" style="left:' + pct(tin) + '%;right:' + (100 - pct(tout)) + '%"></div>'
        + '<div class="og-track-h og-track-in" id="og-trk-in" style="left:' + pct(tin) + '%" title="Trim in"></div>'
        + '<div class="og-track-h og-track-out" id="og-trk-out" style="left:' + pct(tout) + '%" title="Trim out"></div>'
        + '<div class="og-track-play" id="og-trk-play" style="left:' + pct(isLive ? active.el.currentTime : tin) + '%"></div>'
      + '</div>'
      + '<div class="og-trk-fields">'
        + field('Trim in (s)', '<input id="og-trk-in-n" type="number" min="0" step="0.1" value="' + (Math.round(tin * 10) / 10) + '">')
        + field('Trim out (s)', '<input id="og-trk-out-n" type="number" min="0" step="0.1" value="' + (c.trimOut == null ? '' : Math.round(tout * 10) / 10) + '" placeholder="end">')
        + field('Loop', '<select id="og-trk-loop">' + opt('0', 'No', c.loop ? '1' : '0') + opt('1', 'Yes', c.loop ? '1' : '0') + '</select>')
      + '</div>';

    const track = $('og-track');
    // Patch only the trim DOM in place — keeps drag handles alive (a full re-render would
    // detach the element being dragged) and avoids regenerating the filmstrip on every move.
    const refreshTrimUI = () => {
      const ti = clamp(c.trimIn || 0, 0, dur || 1e9);
      const to = (c.trimOut == null ? dur : clamp(c.trimOut, 0, dur || 1e9)) || dur;
      const region = $('og-trk-region'), inH = $('og-trk-in'), outH = $('og-trk-out');
      if (region) { region.style.left = pct(ti) + '%'; region.style.right = (100 - pct(to)) + '%'; }
      if (inH) inH.style.left = pct(ti) + '%';
      if (outH) outH.style.left = pct(to) + '%';
      const inT = $('og-trk-in-t'); if (inT) inT.textContent = fmtClock(ti);
      const outT = $('og-trk-out-t'); if (outT) outT.textContent = fmtClock(to);
      const nIn = $('og-trk-in-n'); if (nIn && document.activeElement !== nIn) nIn.value = Math.round(ti * 10) / 10;
      const nOut = $('og-trk-out-n'); if (nOut && document.activeElement !== nOut) nOut.value = (c.trimOut == null ? '' : Math.round(to * 10) / 10);
      if (!isLive) { const ph = $('og-trk-play'); if (ph) ph.style.left = pct(ti) + '%'; }
    };
    const setIn = (v) => { c.trimIn = clamp(v, 0, (c.trimOut == null ? dur : c.trimOut) - 0.05); if (active && active.cue.id === c.id) { try { active.el.currentTime = c.trimIn; } catch (e) {} } refreshTrimUI(); renderInspector(); scheduleSave(); };
    const setOut = (v) => { c.trimOut = clamp(v, (c.trimIn || 0) + 0.05, dur || v); refreshTrimUI(); renderInspector(); scheduleSave(); };
    const tFromX = (clientX) => { const r = track.getBoundingClientRect(); return clamp((clientX - r.left) / r.width, 0, 1) * dur; };
    const liveIn = (v) => { c.trimIn = clamp(v, 0, (c.trimOut == null ? dur : c.trimOut) - 0.05); if (active && active.cue.id === c.id) { try { active.el.currentTime = c.trimIn; } catch (e) {} } refreshTrimUI(); };
    const liveOut = (v) => { c.trimOut = clamp(v, (c.trimIn || 0) + 0.05, dur || v); refreshTrimUI(); };
    const dragHandle = (el, live) => {
      if (!el) return;
      el.onpointerdown = (e) => {
        e.preventDefault(); e.stopPropagation();
        try { el.setPointerCapture(e.pointerId); } catch (er) {}
        const mv = (ev) => live(tFromX(ev.clientX));
        const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); try { el.releasePointerCapture(e.pointerId); } catch (er) {} renderInspector(); scheduleSave(); };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      };
    };
    dragHandle($('og-trk-in'), liveIn);
    dragHandle($('og-trk-out'), liveOut);
    // click/drag on the track body = scrub the live cue (or set the playhead preview)
    track.onpointerdown = (e) => { if (e.target.id === 'og-trk-in' || e.target.id === 'og-trk-out') return; const t = tFromX(e.clientX); if (active && active.cue.id === c.id) { try { active.el.currentTime = t; sendOut({ t: 'seek', at: t }, c.output || 1); } catch (er) {} } const ph = $('og-trk-play'); if (ph && dur) ph.style.left = (t / dur * 100) + '%'; };
    const b = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
    b('og-edit-setin', 'onclick', () => setIn(isLive ? active.el.currentTime : (c.trimIn || 0)));
    b('og-edit-setout', 'onclick', () => setOut(isLive ? active.el.currentTime : dur));
    b('og-edit-reset', 'onclick', () => { c.trimIn = 0; c.trimOut = null; refreshTrimUI(); renderInspector(); scheduleSave(); });
    b('og-trk-in-n', 'onchange', (e) => setIn(Math.max(0, parseFloat(e.target.value) || 0)));
    b('og-trk-out-n', 'onchange', (e) => { const v = parseFloat(e.target.value); if (isNaN(v)) { c.trimOut = null; refreshTrimUI(); renderInspector(); scheduleSave(); } else setOut(v); });
    b('og-trk-loop', 'onchange', (e) => { c.loop = e.target.value === '1'; if (active && active.cue.id === c.id) active.el.loop = c.loop; renderInspector(); scheduleSave(); });
    mountFilmstrip(c);
  }
  function paintFilmstrip(strip, frames) {
    if (!strip) return;
    strip.innerHTML = frames.map(f => '<div class="frame"' + (f ? ' style="background-image:url(' + f + ')"' : '') + '></div>').join('');
    strip.classList.remove('loading');
  }
  function mountFilmstrip(c) {
    if (!c.mediaId) return;
    if (c.type !== 'video') {
      // audio clips render og-track-thumb, not a strip — waveform goes there
      // (one-time OfflineAudioContext decode, peaks cached on the media record)
      mountWaveInto(document.querySelector('#og-track .og-track-thumb'), c.mediaId);
      return;
    }
    const strip = $('og-trk-strip'); if (!strip) return;
    const cached = filmstripCache.get(c.mediaId);
    if (cached) { paintFilmstrip(strip, cached); return; }
    strip.classList.add('loading');
    buildFilmstrip(c.mediaId, FILMSTRIP_FRAMES).then((frames) => {
      if (!frames) { const s = $('og-trk-strip'); if (s) s.classList.remove('loading'); return; }
      const cur = cueById(selectedId), liveStrip = $('og-trk-strip');
      if (liveStrip && cur && cur.id === c.id) paintFilmstrip(liveStrip, frames);
    });
  }
  function renderEditPlayhead() {
    const ph = $('og-trk-play'), cur = $('og-trk-cur'); if (!ph || !active) return;
    const c = cueById(selectedId); if (!c || active.cue.id !== c.id) return;
    const dur = editClipDuration(c) || 0; if (!dur) return;
    ph.style.left = (clamp(active.el.currentTime, 0, dur) / dur * 100) + '%';
    if (cur) cur.textContent = fmtClock(active.el.currentTime);
  }

  // ── Pad Editor (the SFX-board bottom pane: trim the selected pad's sound) ──
  function padDuration(p) { const buf = p && bufferCache.get(p.mediaId); return (buf && buf.duration) || (p && p.dur) || 0; }
  function renderPadEditArea() {
    const body = $('og-sfx-edit-body'), acts = $('og-sfx-edit-actions'); if (!body) return;
    const p = padById(selectedPadId);
    updatePadSelectionState();
    if (!p) { body.innerHTML = '<div class="og-edit-empty">Select a pad’s ' + sym('action.more') + ' to trim its sound.</div>'; if (acts) acts.innerHTML = ''; return; }
    const dur = padDuration(p) || 0;
    const tin = clamp(p.trimIn || 0, 0, dur || 1e9);
    const tout = (p.trimOut == null ? dur : clamp(p.trimOut, 0, dur || 1e9)) || dur;
    if (acts) acts.innerHTML = '<button class="og-bar-btn" id="og-sfx-edit-fire">' + sym('media.play') + ' Fire</button><button class="og-bar-btn" id="og-sfx-edit-reset">Reset</button>';
    const pct = (t) => dur > 0 ? clamp(t, 0, dur) / dur * 100 : 0;
    body.innerHTML =
      '<div class="og-trk-meta"><span class="og-trk-name" style="color:' + p.color + '">' + esc(p.name) + '</span>'
        + '<span class="og-trk-times">IN ' + fmtClock(tin) + ' · OUT ' + fmtClock(tout) + ' · ' + (dur ? fmtClock(dur) : '—') + '</span></div>'
      + '<div class="og-track" id="og-sfx-track">'
        + '<div class="og-track-thumb og-track-audio"></div>'
        + '<div class="og-track-region" style="left:' + pct(tin) + '%;right:' + (100 - pct(tout)) + '%"></div>'
        + '<div class="og-track-h og-track-in" id="og-sfx-in" style="left:' + pct(tin) + '%" title="Trim in"></div>'
        + '<div class="og-track-h og-track-out" id="og-sfx-out" style="left:' + pct(tout) + '%" title="Trim out"></div>'
      + '</div>'
      + '<div class="og-trk-fields">'
        + field('Trim in (s)', '<input id="og-sfx-in-n" type="number" min="0" step="0.1" value="' + (Math.round(tin * 10) / 10) + '">')
        + field('Trim out (s)', '<input id="og-sfx-out-n" type="number" min="0" step="0.1" value="' + (p.trimOut == null ? '' : Math.round(tout * 10) / 10) + '" placeholder="end">')
        + field('Loop', '<select id="og-sfx-loop">' + opt('0', 'No', p.loop ? '1' : '0') + opt('1', 'Yes', p.loop ? '1' : '0') + '</select>')
      + '</div>';
    const track = $('og-sfx-track');
    // live AudioBuffer → peaks; cached peaks repaint synchronously through drag re-renders
    mountWaveInto(track ? track.querySelector('.og-track-thumb') : null, p.mediaId);
    const setIn = (v) => { p.trimIn = clamp(v, 0, (p.trimOut == null ? dur : p.trimOut) - 0.05); renderPadEditArea(); renderPadInspector(); scheduleSave(); };
    const setOut = (v) => { p.trimOut = clamp(v, (p.trimIn || 0) + 0.05, dur || v); renderPadEditArea(); renderPadInspector(); scheduleSave(); };
    const tFromX = (x) => { const r = track.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1) * dur; };
    const dh = (el, apply) => { if (!el) return; el.onpointerdown = (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (er) {} const mv = (ev) => apply(tFromX(ev.clientX)); const up = () => { try { el.releasePointerCapture(e.pointerId); } catch (er) {} el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); }; el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); }; };
    dh($('og-sfx-in'), setIn); dh($('og-sfx-out'), setOut);
    const b = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
    b('og-sfx-edit-fire', 'onclick', () => firePad(p));
    b('og-sfx-edit-reset', 'onclick', () => { p.trimIn = 0; p.trimOut = null; renderPadEditArea(); renderPadInspector(); scheduleSave(); });
    b('og-sfx-in-n', 'onchange', (e) => setIn(Math.max(0, parseFloat(e.target.value) || 0)));
    b('og-sfx-out-n', 'onchange', (e) => { const v = parseFloat(e.target.value); if (isNaN(v)) { p.trimOut = null; renderPadEditArea(); renderPadInspector(); scheduleSave(); } else setOut(v); });
    b('og-sfx-loop', 'onchange', (e) => { p.loop = e.target.value === '1'; renderPadInspector(); scheduleSave(); });
  }

  // ── Resizable panes ──────────────────────────────────────────────────────
  function applyLayout() {
    const L = settings.layout || (settings.layout = { wCuelist: 280, wInspector: 280, hEdit: 150 });
    const root = $('outrangutan'); if (!root) return;
    const top = $('og-toprow');
    const topW = (top && top.clientWidth) || root.clientWidth || 1280;
    const maxSide = clamp(Math.floor(topW * 0.28), 240, 380);
    const minCenter = clamp(Math.floor(topW * 0.46), 480, 820);
    let cuelistW = clamp(Number(L.wCuelist) || 280, 210, maxSide);
    let inspectorW = clamp(Number(L.wInspector) || 280, 210, maxSide);
    const sideBudget = topW - minCenter - 12;
    if (sideBudget > 0 && cuelistW + inspectorW > sideBudget) {
      const side = clamp(Math.floor(sideBudget / 2), 210, maxSide);
      cuelistW = Math.min(cuelistW, side);
      inspectorW = Math.min(inspectorW, side);
    }
    const main = document.querySelector('.og-main');
    const mainH = (main && main.clientHeight) || root.clientHeight || 900;
    const maxEdit = clamp(Math.floor(mainH * 0.24), 140, 260);
    const editH = clamp(Number(L.hEdit) || 150, 96, maxEdit);
    root.style.setProperty('--og-w-cuelist', cuelistW + 'px');
    root.style.setProperty('--og-w-inspector', inspectorW + 'px');
    root.style.setProperty('--og-h-edit', editH + 'px');
  }
  function wireSplitter(id, onMove) {
    const el = $(id); if (!el) return;
    let dragging = false;
    const start = (e, moveName, upName, pointerId) => {
      if (dragging) return;
      dragging = true;
      e.preventDefault();
      if (pointerId != null) { try { el.setPointerCapture(pointerId); } catch (er) {} }
      el.classList.add('drag');
      const mv = (ev) => { ev.preventDefault(); onMove(ev); };
      const up = () => {
        if (pointerId != null) { try { el.releasePointerCapture(pointerId); } catch (er) {} }
        dragging = false;
        el.classList.remove('drag');
        document.removeEventListener(moveName, mv);
        document.removeEventListener(upName, up);
        scheduleSave();
      };
      document.addEventListener(moveName, mv);
      document.addEventListener(upName, up);
      onMove(e);
    };
    el.onpointerdown = (e) => start(e, 'pointermove', 'pointerup', e.pointerId);
    el.onmousedown = (e) => start(e, 'mousemove', 'mouseup', null);
  }
  function initSplitters() {
    // read settings.layout fresh each move — `settings` is reassigned by loadShow()
    wireSplitter('og-split-c', (ev) => { const r = $('og-toprow').getBoundingClientRect(); settings.layout.wCuelist = clamp(ev.clientX - r.left, 180, r.width - 420); applyLayout(); });
    wireSplitter('og-split-i', (ev) => { const r = $('og-toprow').getBoundingClientRect(); settings.layout.wInspector = clamp(r.right - ev.clientX, 180, r.width - 420); applyLayout(); });
    wireSplitter('og-split-h', (ev) => { const m = document.querySelector('.og-main'); if (!m) return; const r = m.getBoundingClientRect(); settings.layout.hEdit = clamp(r.bottom - ev.clientY, 80, r.height - 240); applyLayout(); });
    // SFX board shares the same inspector-width + edit-height vars (one resize, both views)
    wireSplitter('og-split-si', (ev) => { const r = $('og-sfx-toprow').getBoundingClientRect(); settings.layout.wInspector = clamp(r.right - ev.clientX, 220, r.width - 320); applyLayout(); });
    wireSplitter('og-split-sh', (ev) => { const m = document.querySelector('.og-sfx'); if (!m) return; const r = m.getBoundingClientRect(); settings.layout.hEdit = clamp(r.bottom - ev.clientY, 80, r.height - 240); applyLayout(); });
  }

  // ── Responsive layout modes ───────────────────────────────────────────────
  // wide (>720): three columns (Cue List | Program | Inspector) + bottom clip
  //   editor, splitters live. The Inspector stays a right-hand column.
  // narrow (≤720): the same panes stack and scroll as one column.
  let layoutMode = null, bottomTab = 'insp';
  function currentMode() {
    const w = window.innerWidth || document.documentElement.clientWidth || 1280;
    if (w <= 720) return 'narrow';
    return 'wide';
  }
  function applyLayoutMode() {
    const main = document.querySelector('.og-main');
    const mode = currentMode();
    if (main) {
      main.classList.remove('og-lay-wide', 'og-lay-medium', 'og-lay-narrow');
      main.classList.add('og-lay-' + mode);
    }
    // relocate the Inspector pane: a top-row column at wide, part of the shared
    // tabbed bottom region at medium/narrow. Keep #og-inspector-pane intact.
    const insp = $('og-inspector-pane'), bottom = $('og-bottom'),
          editPane = $('og-edit-pane'), toprow = $('og-toprow');
    if (insp && bottom && editPane && toprow) {
      if (mode === 'wide') {
        if (insp.parentElement !== toprow) toprow.appendChild(insp);   // back to the 3rd column slot
      } else {
        if (insp.parentElement !== bottom) bottom.insertBefore(insp, editPane);
      }
    }
    layoutMode = mode;
    updateSelectionState();
    applyLayout();
  }
  // Reflect current cue selection so empty panes collapse instead of hogging space.
  function updateSelectionState() {
    const main = document.querySelector('.og-main'); if (!main) return;
    const has = !!cueById(selectedId);
    main.classList.toggle('og-has-sel', has);
    main.classList.toggle('og-no-sel', !has);
  }
  // Pad-editor collapse mirror for the SFX board.
  function updatePadSelectionState() {
    const sfx = document.querySelector('.og-sfx'); if (!sfx) return;
    const has = !!padById(selectedPadId);
    sfx.classList.toggle('og-has-padsel', has);
    sfx.classList.toggle('og-no-padsel', !has);
  }
  function setBottomTab(t) {
    bottomTab = t;
    const bottom = $('og-bottom'); if (bottom) bottom.classList.toggle('show-edit', t === 'edit');
    const bi = $('og-bottom-tab-insp'), be = $('og-bottom-tab-edit');
    if (bi) { bi.classList.toggle('on', t === 'insp'); bi.setAttribute('aria-selected', t === 'insp' ? 'true' : 'false'); }
    if (be) { be.classList.toggle('on', t === 'edit'); be.setAttribute('aria-selected', t === 'edit' ? 'true' : 'false'); }
  }

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
    ensureBanks();
    let html = '';
    for (let i = 0; i < PAD_COUNT; i++) {
      const p = padBySlot(i);
      if (!p) { html += '<button class="og-pad empty" data-slot="' + i + '"><span class="og-pad-empty-l">' + sym('action.add') + '</span><span class="og-pad-hint">Drop a sound</span></button>'; continue; }
      const live = padRT.get(p.id); const playing = live && live.voices.length;
      html += '<button class="og-pad' + (playing ? ' live' : '') + (p.id === selectedPadId ? ' sel' : '') + '" data-pad="' + p.id + '" style="--pad:' + p.color + '">'
        + '<span class="og-pad-key">' + (p.key ? keyLabel(p.key) : '') + '</span>'
        + '<span class="og-pad-edit" data-edit="' + p.id + '" title="Edit pad">' + sym('action.more') + '</span>'
        + (p.emoji ? '<span class="og-pad-emoji">' + esc(p.emoji) + '</span>' : '')
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
      b.onclick = (e) => { if (e.target.closest('.og-pad-edit')) { selectedPadId = id; renderPads(); renderPadInspector(); renderPadEditArea(); return; } firePad(p); };
      ['dragenter', 'dragover'].forEach(ev => b.addEventListener(ev, e => { e.preventDefault(); b.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach(ev => b.addEventListener(ev, e => { e.preventDefault(); b.classList.remove('drag'); }));
      b.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files[0]) assignPad(p.slot, e.dataTransfer.files[0]); });
    });
  }
  function renderPadLive(id) { const b = document.querySelector('.og-pad[data-pad="' + id + '"]'); const rt = padRT.get(id); if (b) b.classList.toggle('live', !!(rt && rt.voices.length)); }
  let padSlotForFile = 0;
  let listeningPadKey = false;

  // ── SFX banks bar + search ─────────────────────────────────────────────────
  function renderBanks() {
    const bar = $('og-bank-bar'); if (!bar) return;
    ensureBanks();
    bar.innerHTML = banks.map(b => {
      const on = b.id === currentBankId, n = pads.filter(p => p.bank === b.id && p.mediaId).length;
      const editing = b.id === bankRenamingId;
      const label = editing
        ? '<input class="og-bank-rename" type="text" value="' + esc(b.name) + '" maxlength="40" spellcheck="false" aria-label="Bank name">'
        : '<span class="og-bank-name">' + esc(b.name) + '</span>';
      return '<button class="og-bank-tab' + (on ? ' on' : '') + (editing ? ' editing' : '') + '" data-bank="' + b.id + '" title="Double-click or ✎ to rename">'
        + label + (n && !editing ? '<span class="og-bank-count">' + n + '</span>' : '')
        + (on && !editing ? '<span class="og-bank-edit" data-edit="' + b.id + '" title="Rename bank" role="button" aria-label="Rename bank">' + sym('action.edit') + '</span>' : '')
        + (on && banks.length > 1 && !editing ? '<span class="og-bank-x" data-del="' + b.id + '" title="Delete bank">×</span>' : '')
        + '</button>';
    }).join('') + '<button class="og-bank-add" id="og-bank-add" title="Add a bank">' + sym('action.add') + '</button>';
    Array.prototype.forEach.call(bar.querySelectorAll('.og-bank-tab'), t => {
      const id = t.getAttribute('data-bank');
      const input = t.querySelector('.og-bank-rename');
      if (input) {
        const commit = (save) => { if (bankRenamingId !== id) return; bankRenamingId = null; if (save) renameBank(id, input.value.trim()); else renderBanks(); };
        input.onclick = (e) => e.stopPropagation();
        input.ondblclick = (e) => e.stopPropagation();
        input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(true); } else if (e.key === 'Escape') { e.preventDefault(); commit(false); } };
        input.onblur = () => commit(true);
        return;
      }
      const startRename = () => { bankRenamingId = id; if (currentBankId !== id) { currentBankId = id; selectedPadId = null; renderPads(); renderPadInspector(); renderPadEditArea(); } renderBanks(); };
      t.onclick = (e) => { if (e.target.closest('.og-bank-x')) { removeBank(id); return; } if (e.target.closest('.og-bank-edit')) { startRename(); return; } setBank(id); };
      t.ondblclick = (e) => { e.preventDefault(); startRename(); };
    });
    const add = $('og-bank-add'); if (add) add.onclick = addBank;
    if (bankRenamingId) { const inp = bar.querySelector('.og-bank-rename'); if (inp) { inp.focus(); inp.select(); } }
  }
  function renderPadSearch() {
    const box = $('og-pad-search-results'); if (!box) return;
    const q = (padSearch || '').trim();
    if (!q) { box.classList.remove('on'); box.innerHTML = ''; return; }
    const ql = q.toLowerCase();
    const matches = pads.filter(p => p.mediaId && ((p.name || '').toLowerCase().includes(ql) || (p.emoji && p.emoji.includes(q)) || (p.key && keyLabel(p.key).toLowerCase() === ql)));
    box.classList.add('on');
    if (!matches.length) { box.innerHTML = '<div class="og-search-none">No pads match “' + esc(q) + '”.</div>'; return; }
    box.innerHTML = matches.map(p => {
      const bank = banks.find(b => b.id === p.bank);
      return '<div class="og-search-row" data-pad="' + p.id + '">'
        + '<span class="og-search-emoji">' + (p.emoji ? esc(p.emoji) : '<span class="og-search-dot" style="background:' + p.color + '"></span>') + '</span>'
        + '<span class="og-search-name">' + esc(p.name) + '</span>'
        + '<span class="og-search-bank">' + esc(bank ? bank.name : '') + (p.key ? ' · ' + keyLabel(p.key) : '') + '</span>'
        + '<button class="og-search-fire" data-fire="' + p.id + '" title="Fire">' + sym('media.play') + '</button>'
        + '</div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.og-search-row'), row => {
      const id = row.getAttribute('data-pad');
      row.onclick = (e) => {
        if (e.target.closest('.og-search-fire')) { const p = padById(id); if (p) firePad(p); return; }
        const p = padById(id); if (!p) return;
        currentBankId = p.bank; selectedPadId = id; padSearch = '';
        const inp = $('og-pad-search'); if (inp) inp.value = '';
        renderBanks(); renderPads(); renderPadInspector(); renderPadEditArea(); renderPadSearch();
      };
    });
  }

  function renderPadInspector() {
    const box = $('og-pad-inspector'); if (!box) return;
    const p = padById(selectedPadId);
    if (!p) { box.innerHTML = '<div class="og-insp-empty">Select a pad’s ' + sym('action.more') + ' to edit it, or drop a sound on an empty pad.</div>'; return; }
    const eq = p.eq || (p.eq = { low: 0, mid: 0, high: 0 });
    box.innerHTML =
      '<div class="og-field-row og-namerow">' +
        field('Label', '<input id="og-p-name" type="text" value="' + esc(p.name) + '">') +
        field('Emoji', '<input id="og-p-emoji" class="og-emoji-in" type="text" value="' + esc(p.emoji || '') + '" maxlength="4" placeholder="🔔">') +
      '</div>' +
      '<div class="og-emoji-quick">' + ['🔔', '💥', '🎺', '👏', '😂', '🚨', '🥁', '✨', '🎉', '💨', '🐶', '📣', '🔥', '💧', '🎬', '📢'].map(e => '<button type="button" class="og-emoji-pick" data-e="' + e + '">' + e + '</button>').join('') + '</div>' +
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
    b('og-p-emoji', 'oninput', e => { p.emoji = e.target.value; renderPads(); scheduleSave(); });
    Array.prototype.forEach.call(box.querySelectorAll('.og-emoji-pick'), btn => { btn.onclick = () => { p.emoji = btn.getAttribute('data-e'); const inp = $('og-p-emoji'); if (inp) inp.value = p.emoji; renderPads(); scheduleSave(); }; });
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
  function scheduleSave() { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(saveShow, 500); publishCues(); }
  function activeOffset() {
    if (!active || active.kind === 'image') return 0;
    const el = active.el;
    return el && isFinite(el.currentTime) ? el.currentTime : 0;
  }
  async function saveShow() {
    saveTimer = null;
    const transport = active
      ? { cueId: active.cue.id, offset: Math.round(activeOffset() * 10) / 10, paused: isActivePaused() }
      : null;
    try { await idbPut(SHOW_STORE, showKey(), { schema: SCHEMA, savedAt: Date.now(), activeCueId: active ? active.cue.id : null, transport, cues, pads, banks, currentBankId, outputs, selectedId, settings }); } catch (e) {}
  }
  async function loadShow() {
    const s = await idbGet(SHOW_STORE, showKey());
    if (!s || !Array.isArray(s.cues)) { outputs = defaultOutputs(); sdMap = {}; banks = defaultBanks(); currentBankId = banks[0].id; return null; }
    cues = s.cues.map(c => Object.assign(makeCue({ type: c.type }), c, { eq: Object.assign({ low: 0, mid: 0, high: 0 }, c.eq || {}) }));
    banks = (Array.isArray(s.banks) && s.banks.length) ? s.banks.slice() : defaultBanks();
    currentBankId = (s.currentBankId && banks.find(b => b.id === s.currentBankId)) ? s.currentBankId : banks[0].id;
    pads = Array.isArray(s.pads) ? s.pads.map(p => Object.assign({ eq: { low: 0, mid: 0, high: 0 }, gain: 1, retrigger: 'restart', fadeIn: 0, trimIn: 0, emoji: '', bank: banks[0].id }, p, { eq: Object.assign({ low: 0, mid: 0, high: 0 }, p.eq || {}) })) : [];
    pads.forEach(p => { if (!banks.find(b => b.id === p.bank)) p.bank = banks[0].id; });   // re-home orphaned pads
    outputs = (Array.isArray(s.outputs) && s.outputs.length) ? s.outputs.map(o => Object.assign({ screenId: null, sinkId: null, audioOn: false }, o)) : defaultOutputs();
    selectedId = s.selectedId || (cues[0] && cues[0].id) || null;
    settings = Object.assign(DEFAULT_SETTINGS(), s.settings || {});
    settings.shortcuts = Object.assign({}, DEFAULT_SHORTCUTS, settings.shortcuts || {});
    sdMap = settings.sdMap = settings.sdMap || {};
    midiMap = settings.midiMap = settings.midiMap || {};
    renumber();
    pads.forEach(p => { if (p.mediaId) decodeBuffer(p.mediaId); });   // warm pad buffers for instant trigger
    return s;
  }
  // ── Save / open a show file (a portable backup that includes the media) ────
  // P7 + V2 Phase 5: branded ".ogshow" files. Since 2026-07-13 the container is
  // a plain STORE zip — show.json (manifest, no media bytes) + media/<id> raw
  // blobs. The old format base64'd every blob into ONE JSON string, and V8's
  // string ceiling silently broke big-show exports; a zip built from Blob
  // parts never materializes the media in memory at all (the original blobs
  // ride into the output Blob by reference; only the CRC pass reads them, in
  // bounded chunks). Legacy JSON .ogshow/.json files still import.
  let showFileHandle = null;   // FileSystemFileHandle → Cmd+S saves back into the same file
  function showFileName() { return 'Outrangutan Show ' + new Date().toISOString().slice(0, 10) + '.ogshow'; }

  // ── minimal zip (STORE) writer/reader — no deps, ~4GB classic-zip bounds ──
  const _crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  async function blobCrc32(blob) {
    let crc = 0xFFFFFFFF;
    const CHUNK = 4 * 1024 * 1024;   // CRC reads in 4MB slices so memory stays flat
    for (let off = 0; off < blob.size; off += CHUNK) {
      const buf = new Uint8Array(await blob.slice(off, Math.min(off + CHUNK, blob.size)).arrayBuffer());
      for (let i = 0; i < buf.length; i++) crc = _crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function dosDateTime(ts) {
    const d = new Date(ts || Date.now());
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: (((d.getFullYear() - 1980) & 0x7F) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }
  async function buildZipBlob(entries) {   // entries: [{ name (ascii), blob }]
    const parts = [], central = [];
    const { time, date } = dosDateTime(Date.now());
    const te = new TextEncoder();
    let offset = 0;
    for (const e of entries) {
      const nameBytes = te.encode(e.name);
      const crc = await blobCrc32(e.blob);
      const size = e.blob.size;
      if (size > 0xFFFFFFFE || offset + size > 0xFFFFFFFE) throw new Error('over 4GB — too large for the .ogshow container');
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);                       // version needed to extract
      lh.setUint16(8, 0, true);                        // method 0 = STORE
      lh.setUint16(10, time, true); lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, nameBytes.length, true);
      parts.push(lh.buffer, nameBytes, e.blob);        // the blob itself — no copy
      central.push({ nameBytes, crc, size, offset });
      offset += 30 + nameBytes.length + size;
    }
    const cdStart = offset;
    for (const c of central) {
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true);
      ch.setUint32(16, c.crc, true);
      ch.setUint32(20, c.size, true); ch.setUint32(24, c.size, true);
      ch.setUint16(28, c.nameBytes.length, true);
      ch.setUint32(42, c.offset, true);
      parts.push(ch.buffer, c.nameBytes);
      offset += 46 + c.nameBytes.length;
    }
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, central.length, true); eocd.setUint16(10, central.length, true);
    eocd.setUint32(12, offset - cdStart, true);
    eocd.setUint32(16, cdStart, true);
    parts.push(eocd.buffer);
    return new Blob(parts, { type: 'application/zip' });
  }
  async function readZipEntries(file) {
    const tailSize = Math.min(file.size, 65558);       // EOCD + max comment
    const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) { if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('no zip directory');
    const count = tail.getUint16(eocd + 10, true);
    const cdSize = tail.getUint32(eocd + 12, true);
    const cdStart = tail.getUint32(eocd + 16, true);
    const cd = new DataView(await file.slice(cdStart, cdStart + cdSize).arrayBuffer());
    const td = new TextDecoder();
    const entries = new Map();
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const method = cd.getUint16(p + 10, true);
      const compSize = cd.getUint32(p + 20, true);
      const nameLen = cd.getUint16(p + 28, true), extraLen = cd.getUint16(p + 30, true), cmtLen = cd.getUint16(p + 32, true);
      const lhOff = cd.getUint32(p + 42, true);
      const name = td.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
      entries.set(name, { method, compSize, lhOff });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return {
      async blobFor(name, mime) {
        const e = entries.get(name); if (!e) return null;
        const lh = new DataView(await file.slice(e.lhOff, e.lhOff + 30).arrayBuffer());
        if (lh.getUint32(0, true) !== 0x04034b50) return null;
        const dataOff = e.lhOff + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        const comp = file.slice(dataOff, dataOff + e.compSize, mime || '');
        if (e.method === 0) return comp;               // STORE: a lazy slice, zero copy
        if (e.method === 8 && typeof DecompressionStream === 'function') {
          // tolerate a user re-zipping the show with real compression
          return await new Response(comp.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
        }
        return null;
      },
    };
  }

  // ── Printable show-day pack (V2 Phase 5 item 5): cue sheet + pad map ──
  // Rides Cueola's exportPaperHTMLAsPDF pipeline (same page, same look as the
  // rundown/call-sheet paperwork).
  async function printShowPack() {
    if (!cues.length && !pads.length) { toast('Nothing to print yet — add a cue or pad first.'); return; }
    if (typeof window.exportPaperHTMLAsPDF !== 'function') { toast('The print pipeline is not available here.'); return; }
    const contLabel = c => c.continueMode === 'auto_follow' ? 'Follow' : c.continueMode === 'auto_continue' ? 'Continue' : 'Manual';
    const trimLabel = c => (c.trimIn || c.trimOut != null) ? fmtClock(c.trimIn || 0) + ' → ' + (c.trimOut == null ? 'end' : fmtClock(c.trimOut)) : '—';
    const cueRows = cues.map((c, i) => `<tr>
        <td>${i + 1}</td><td><strong>${esc(c.name || 'Untitled')}</strong></td>
        <td>${esc(c.type || '—')}</td><td>${c.dur ? fmtClock(c.dur) : '—'}</td>
        <td>${trimLabel(c)}</td><td>${contLabel(c)}</td><td>${c.loop ? 'Loop' : ''}</td>
      </tr>`).join('');
    const cueSheet = cues.length ? `
      <h2>Cue Sheet — ${cues.length} cue${cues.length === 1 ? '' : 's'}</h2>
      <table><thead><tr><th>#</th><th>Cue</th><th>Type</th><th>Duration</th><th>Trim</th><th>Continue</th><th></th></tr></thead>
      <tbody>${cueRows}</tbody></table>` : '';
    const padSections = banks.map(bank => {
      const bp = pads.filter(p => p.bank === bank.id).sort((a, b) => (a.slot || 0) - (b.slot || 0));
      if (!bp.length) return '';
      const rows = bp.map(p => `<tr>
          <td>${(p.slot || 0) + 1}</td><td>${p.emoji ? esc(p.emoji) + ' ' : ''}<strong>${esc(p.name || 'Pad')}</strong></td>
          <td>${p.key ? esc(String(p.key).toUpperCase()) : '—'}</td>
          <td>${p.loop ? 'Loop' : ''}${p.trimIn || p.trimOut != null ? (p.loop ? ' · ' : '') + 'trimmed' : ''}</td>
        </tr>`).join('');
      return `<h3>${esc(bank.name || 'Bank')}</h3>
        <table><thead><tr><th>Pad</th><th>Sound</th><th>Hotkey</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join('');
    const padMap = pads.length ? `<h2>SFX Pad Map — ${pads.length} pad${pads.length === 1 ? '' : 's'}</h2>${padSections}` : '';
    const title = mode === 'session' && sessionCode ? 'Session ' + sessionCode : 'Standalone show';
    try {
      await window.exportPaperHTMLAsPDF(`
        <h1>Outrangutan Show Pack</h1>
        <div>${esc(title)} · printed ${esc(new Date().toLocaleString())}</div>
        ${cueSheet}
        ${padMap}
      `, 'outrangutan-show-pack.pdf', { orientation: 'portrait', margin: 24 });
      slog('session', 'Show pack printed — ' + cues.length + ' cues · ' + pads.length + ' pads');
      toast('Show pack PDF downloaded.');
    } catch (e) { toast('Could not build the show pack PDF.'); }
  }

  async function exportShowFile() {
    try {
      if (!cues.length && !pads.length) { toast('Nothing to save yet — add a cue or pad first.'); return; }
      const ids = new Set();
      cues.forEach(c => { if (c.mediaId) ids.add(c.mediaId); });
      pads.forEach(p => { if (p.mediaId) ids.add(p.mediaId); });
      const mediaIndex = {};
      const zipEntries = [];
      for (const id of ids) {
        const m = await idbGet(MEDIA_STORE, id);
        if (!m || !m.blob) continue;
        const entryName = 'media/' + String(id).replace(/[^\w.-]/g, '_');
        mediaIndex[id] = { name: m.name || '', mime: m.mime || '', kind: m.kind || 'video', duration: m.duration || 0, thumb: m.thumb || null, width: m.width || 0, height: m.height || 0, file: entryName };
        zipEntries.push({ name: entryName, blob: m.blob });
      }
      const payload = { kind: 'outrangutan-show', app: 'outrangutan', schema: SCHEMA, container: 'zip', exportedAt: Date.now(),
        show: { cues, pads, banks, currentBankId, outputs, selectedId, settings }, mediaIndex };
      zipEntries.unshift({ name: 'show.json', blob: new Blob([JSON.stringify(payload)], { type: 'application/json' }) });
      const showBlob = await buildZipBlob(zipEntries);
      const nMedia = Object.keys(mediaIndex).length;
      const summary = cues.length + ' cue' + (cues.length === 1 ? '' : 's') + (pads.length ? ' · ' + pads.length + ' pad' + (pads.length === 1 ? '' : 's') : '') + (nMedia ? ' · ' + nMedia + ' media' : '');
      if (window.showSaveFilePicker) {
        try {
          if (!showFileHandle) {
            showFileHandle = await window.showSaveFilePicker({
              suggestedName: showFileName(),
              types: [{ description: 'Outrangutan Show', accept: { 'application/zip': ['.ogshow'] } }],
            });
          }
          const w = await showFileHandle.createWritable();
          await w.write(showBlob);
          await w.close();
          slog('session', 'Show saved → ' + showFileHandle.name + ' (' + summary + ')');
          toast('Saved — ' + showFileHandle.name);
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;   // user cancelled the picker
          showFileHandle = null;                      // stale or denied handle → plain download below
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(showBlob);
      a.download = showFileName();
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      slog('session', 'Show downloaded → ' + showFileName() + ' (' + summary + ')');
      toast('Show saved — ' + summary + '.');
    } catch (e) { toast(e && /4GB/.test(String(e.message)) ? 'Too big: the .ogshow container caps at 4 GB.' : 'Could not save the show file.'); }
  }
  async function openShowFilePicker() {
    if (window.showOpenFilePicker) {
      try {
        const [h] = await window.showOpenFilePicker({
          types: [{ description: 'Outrangutan Show', accept: { 'application/zip': ['.ogshow'], 'application/json': ['.json'] } }],
        });
        const ok = await importShowFile(await h.getFile());
        if (ok) showFileHandle = h;   // Cmd+S now saves back into the opened file
        return;
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const input = $('og-showfile-input');
    if (input) input.click();
  }
  // Container sniff: zip magic → the new raw-media path; anything else falls
  // back to the legacy base64-in-JSON format (still openable forever).
  async function importShowFile(file) {
    let head;
    try { head = new Uint8Array(await file.slice(0, 4).arrayBuffer()); } catch (e) { toast('Could not read that file.'); return false; }
    if (head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04) return importShowZip(file);
    return importShowLegacyJson(file);
  }

  function validShowPayload(payload) {
    return payload && payload.kind === 'outrangutan-show' && payload.show && Array.isArray(payload.show.cues);
  }
  function confirmShowReplace(payload) {
    const sc = payload.show.cues.length, sp = Array.isArray(payload.show.pads) ? payload.show.pads.length : 0;
    if (!(cues.length || pads.length)) return true;
    return dangerOK('Open this show? It replaces the current ' + cues.length + ' cue' + (cues.length === 1 ? '' : 's') + ' / ' + pads.length + ' pad' + (pads.length === 1 ? '' : 's') + ' with ' + sc + ' / ' + sp + '.');
  }
  // Shared tail for both containers: media is already in IndexedDB by now.
  async function finishShowImport(payload) {
    bufferCache.clear(); decodeJobs.clear(); filmstripCache.clear(); filmstripJobs.clear();
    const s = sanitizeImportedShow(payload.show);
    await idbPut(SHOW_STORE, showKey(), { schema: payload.schema || SCHEMA, savedAt: Date.now(), activeCueId: null,
      cues: s.cues, pads: s.pads || [], banks: s.banks || [], currentBankId: s.currentBankId || null,
      outputs: s.outputs || defaultOutputs(), selectedId: s.selectedId || null, settings: s.settings || DEFAULT_SETTINGS() });
    active = null;
    await loadShow();
    renderAll();
    scheduleSave();
    slog('session', 'Show opened from file — ' + cues.length + ' cues · ' + pads.length + ' pads');
    toast('Show opened — ' + cues.length + ' cue' + (cues.length === 1 ? '' : 's') + (pads.length ? ' · ' + pads.length + ' pad' + (pads.length === 1 ? '' : 's') : '') + '.');
    return true;
  }

  async function importShowZip(file) {
    let payload, zip;
    try {
      zip = await readZipEntries(file);
      const manifest = await zip.blobFor('show.json', 'application/json');
      if (!manifest) { toast('That show file is missing its manifest.'); return false; }
      payload = JSON.parse(await manifest.text());
    } catch (e) { toast('That file isn’t a valid show file.'); return false; }
    if (!validShowPayload(payload)) { toast('That isn’t an Outrangutan show file.'); return false; }
    if (!confirmShowReplace(payload)) return false;
    try {
      try { stopAll({ silent: true }); } catch (e) {}
      const mediaIndex = payload.mediaIndex || {};
      for (const id of Object.keys(mediaIndex)) {
        const m = mediaIndex[id] || {};
        if (!m.file) continue;
        const blob = await zip.blobFor(m.file, m.mime || '');
        if (!blob) continue;
        await idbPut(MEDIA_STORE, id, { blob, name: m.name || '', mime: m.mime || blob.type, kind: m.kind || 'video', duration: m.duration || 0, thumb: m.thumb || null, width: m.width || 0, height: m.height || 0 });
      }
      return await finishShowImport(payload);
    } catch (e) { toast('Could not open the show file.'); return false; }
  }

  async function importShowLegacyJson(file) {
    let payload;
    try { payload = JSON.parse(await file.text()); } catch (e) { toast('That file isn’t a valid show file.'); return false; }
    if (!validShowPayload(payload)) { toast('That isn’t an Outrangutan show file.'); return false; }
    if (!confirmShowReplace(payload)) return false;
    try {
      try { stopAll({ silent: true }); } catch (e) {}
      const media = payload.media || {};
      for (const id of Object.keys(media)) {
        const m = media[id]; if (!m || !m.data) continue;
        let blob; try { blob = await (await fetch(m.data)).blob(); } catch (e) { continue; }
        await idbPut(MEDIA_STORE, id, { blob, name: m.name || '', mime: m.mime || blob.type, kind: m.kind || 'video', duration: m.duration || 0, thumb: m.thumb || null, width: m.width || 0, height: m.height || 0 });
      }
      return await finishShowImport(payload);
    } catch (e) { toast('Could not open the show file.'); return false; }
  }
  function showRecovery(s) {
    const bar = $('og-recovery'); if (!bar) return;
    const wasPlaying = s && s.activeCueId && cueById(s.activeCueId);
    if (!s || (!cues.length && !pads.length)) { bar.classList.remove('on'); return; }
    const cw = cues.length + ' cue' + (cues.length === 1 ? '' : 's') + (pads.length ? ' · ' + pads.length + ' pad' + (pads.length === 1 ? '' : 's') : '');
    // A persisted transport offset means we can resume from the exact point.
    const t = (s.transport && s.transport.cueId === s.activeCueId) ? s.transport : null;
    const at = t && t.offset > 0 ? ' at ' + fmtClock(t.offset) : '';
    $('og-recovery-text').textContent = wasPlaying
      ? 'Recovered ' + cw + '. The show was mid-playback (“' + wasPlaying.name + '”' + at + ') when it stopped.'
      : 'Recovered your previous show — ' + cw + '.';
    const standbyBtn = $('og-recovery-standby');
    standbyBtn.style.display = wasPlaying ? '' : 'none';
    standbyBtn.textContent = t && t.offset > 0 ? 'Standby at ' + fmtClock(t.offset) : 'Standby that cue';
    standbyBtn.onclick = () => {
      selectedId = s.activeCueId;
      if (t && t.offset > 0) pendingResume = { cueId: t.cueId, offset: t.offset };   // next GO starts there
      renderAll(); bar.classList.remove('on');
    };
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
    if ($('og-integrations').classList.contains('on')) { if (e.key === 'Escape') closeIntegrations(); return; }
    if ($('og-join') && $('og-join').classList.contains('on')) return;
    if (typingTarget(e)) return;
    const sc = settings.shortcuts, k = e.key;
    const match = (bound) => bound && (bound.length === 1 ? k.toLowerCase() === bound.toLowerCase() : k === bound);
    if (match(sc.panic)) { e.preventDefault(); panic(); return; }
    if (match(sc.go)) { e.preventDefault(); if (!e.repeat) goPauseButton(); return; }
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
    selectedId = cues[i].id; renderCueList(); renderInspector(); renderEditArea(); if (!active && !preInfo) renderClock();
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
  function toggleLock() { settings.showLock = !settings.showLock; $('outrangutan').classList.toggle('locked', settings.showLock); $('og-lock-btn').classList.toggle('on', settings.showLock); toast(settings.showLock ? 'Show mode locked — edits disabled.' : 'Show mode unlocked.'); scheduleSave(); }
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
    const root = $('outrangutan'); if (!root || built) return;
    root.innerHTML =
      '<div class="og-bar">'
        + '<button class="og-back" id="og-back">' + sym('action.back') + '<span>Cueola</span></button>'
        + '<div class="og-title"><span class="og-glyph"><svg class="brand-ico"><use href="#ic-outrangutan"/></svg></span><span class="og-wordmark">Out<span class="og-wm-hi">rangutan</span></span></div>'
        + '<span class="og-mode-badge" id="og-mode-badge">Standalone</span>'
        + '<div class="og-tabs"><button class="og-tab on" id="og-tab-play">' + sym('content.display') + 'Playback</button><button class="og-tab" id="og-tab-sfx">' + sym('action.grid') + 'SFX Board</button></div>'
        + '<div class="og-bar-spacer"></div>'
        + '<span class="og-wallclock og-top-wallclock" id="og-wallclock" role="button" tabindex="0" title="Switch to 12-hour clock">' + assetIcon('clock') + '<span id="og-wallclock-t">--:--:--</span></span>'
        + '<button class="og-bar-btn og-program-popout" id="og-program-popout" title="Pop the program output into a movable window for another display" aria-label="Pop out program window" aria-pressed="false">' + sym('action.fullscreen') + '<span>Pop out program</span></button>'
        + '<details class="og-theme-menu og-settings-menu" id="og-theme-menu"><summary title="Settings" aria-label="Settings">' + sym('action.settings') + '<span id="og-theme-label" hidden>Theme</span></summary><div class="og-theme-pop og-settings-pop">'
          + '<details class="og-themes-submenu"><summary class="og-themes-row"><span class="og-tr-ico" aria-hidden="true"></span><span class="og-tr-lbl">Themes</span><span class="og-tr-val">Choose<span class="og-tr-chev" aria-hidden="true">›</span></span></summary>'
            + '<div class="og-theme-grid" id="og-theme-options"></div>'
          + '</details>'
          + '<div class="og-tools-sep"></div>'
          + '<div class="og-settings-label">Tools</div>'
          + '<div class="og-tools-pop-inline">'
            + '<button class="og-bar-btn og-scopes-btn" id="og-scopes-btn" title="Waveform + vectorscope">' + assetIcon('scope') + '<span>Scopes</span></button>'
            + '<button class="og-bar-btn" id="og-output-btn" title="Manage output windows &amp; displays">' + sym('content.display') + 'Outputs</button>'
            + '<button class="og-bar-btn" id="og-sd-btn" title="Stream Deck control (WebHID)">' + sym('action.grid') + 'Stream Deck</button>'
            + '<button class="og-bar-btn" id="og-midi-btn" title="MIDI control surfaces (Web MIDI)">' + sym('action.grid') + 'MIDI</button>'
            + '<button class="og-bar-btn" id="og-print-btn" title="Print the show-day pack — cue sheet + SFX pad map">' + sym('action.export') + 'Print</button>'
            + '<button class="og-bar-btn" id="og-pro-btn" title="OBS · Dropbox · Transcode">' + sym('action.more') + 'Integrations</button>'
            + '<button class="og-bar-btn" id="og-lock-btn" title="Lock edits during the show">' + sym('action.lock') + 'Show Lock</button>'
            + '<button class="og-bar-btn" id="og-help-btn" title="Keyboard shortcuts">' + sym('action.guide') + 'Shortcuts</button>'
            + '<button class="og-bar-btn" id="og-save-file-btn" title="Save this show (with its media) to a file on your computer">' + sym('action.download') + 'Save Show</button>'
            + '<button class="og-bar-btn" id="og-open-file-btn" title="Open a saved show file from your computer">' + sym('action.upload') + 'Open Show</button>'
          + '</div>'
        + '</div></details>'
        + '<input type="file" id="og-showfile-input" accept=".ogshow,.json,application/json" hidden>'
      + '</div>'
      + '<div class="og-recovery" id="og-recovery"><span id="og-recovery-text"></span><div class="og-bar-spacer"></div>'
        + '<button id="og-recovery-standby">Standby that cue</button><button id="og-recovery-dismiss">Dismiss</button></div>'
      + '<div class="og-stage" id="og-stage">'
        // ── PLAYBACK ──
        + '<div class="og-main">'
          + '<div class="og-toprow" id="og-toprow">'
          + '<div class="og-pane og-cuelist-pane">'
            + '<div class="og-pane-head">Cue List</div>'
            + '<div class="og-cuelist" id="og-cuelist"></div>'
            + '<button class="og-cue-add" id="og-cue-add">' + assetIcon('document-plus') + '<span>Drop video / audio / stills here, or click to add</span></button>'
            + '<input type="file" id="og-file-input" accept="video/*,audio/*,image/*" multiple hidden>'
          + '</div>'
          + '<div class="og-splitter og-splitter-v" id="og-split-c" title="Drag to resize"></div>'
          + '<div class="og-pane og-program-pane">'
            + '<div class="og-pane-head">Program</div>'
            + '<div class="og-program-top">'
              + '<div class="og-program-wrap"><span class="og-program-tag">PROGRAM</span><span class="og-program-status og-status-idle" id="og-program-status">IDLE</span>'
                + '<video id="og-program-a" class="og-deck front" playsinline></video><video id="og-program-b" class="og-deck" playsinline></video>'
                + '<img id="og-program-img" class="og-deck og-img-deck" alt="">'
                + '<canvas id="og-key-canvas" class="og-deck og-key"></canvas></div>'
              + '<div class="og-meters">'
                + '<div class="og-vu-col"><div class="og-vu-pair"><span class="og-vu"><span class="og-vu-fill og-vu-fill-y" id="og-vu-l"></span></span><span class="og-vu"><span class="og-vu-fill og-vu-fill-y" id="og-vu-r"></span></span></div><span class="og-meter-col-lbl">VU</span></div>'
                + '<div class="og-fader-col"><input type="range" class="og-vfader" id="og-master-gain-play" min="0" max="1.2" step="0.01" value="1" aria-label="Output level"><span class="og-meter-col-lbl">Output</span></div>'
              + '</div>'
            + '</div>'
            + '<div class="og-scopes" id="og-scopes"><div class="og-scope og-scope-wfm"><canvas id="og-wfm"></canvas><span class="og-scope-lbl">WAVEFORM</span></div><div class="og-scope og-scope-vec"><canvas id="og-vscope"></canvas><span class="og-scope-lbl">VECTORSCOPE</span></div></div>'
            + '<div class="og-clock" id="og-clock"><div class="og-clock-meta"><span class="og-clock-label" id="og-clock-label">STANDBY</span><button type="button" class="og-clock-dir" id="og-clock-dir" title="Toggle count direction (elapsed / remaining)" aria-label="Toggle count direction">' + sym('media.forward') + '</button><span class="og-clock-duration" id="og-clock-duration">DUR 0:00</span></div><div class="og-clock-time" id="og-clock-time">0:00</div></div>'
            + '<div class="og-transport">'
              + '<div class="og-transport-group">'
                + '<button class="og-tbtn" id="og-prev">' + sym('media.backward.circle') + 'Previous Cue<span class="og-tbtn-key">↑</span></button>'
                + '<button class="og-tbtn og-tbtn-go" id="og-go">' + sym('media.playpause') + 'Play / Pause<span class="og-tbtn-key" id="og-k-go"></span></button>'
                + '<button class="og-tbtn" id="og-fade">' + sym('media.waveform.low') + 'Fade Out<span class="og-tbtn-key" id="og-k-fade"></span></button>'
                + '<button class="og-tbtn" id="og-next">' + sym('media.forward.circle') + 'Next Cue<span class="og-tbtn-key">↓</span></button>'
              + '</div>'
              + '<button class="og-tbtn og-tbtn-panic" id="og-panic">' + sym('action.power') + 'Panic<span class="og-tbtn-key" id="og-k-panic"></span></button>'
            + '</div>'
          + '</div>'
          + '<div class="og-splitter og-splitter-v" id="og-split-i" title="Drag to resize"></div>'
          + '<div class="og-pane og-inspector-pane" id="og-inspector-pane">'
            + '<div class="og-pane-head">Inspector</div><div class="og-inspector" id="og-inspector"></div>'
          + '</div>'
          + '</div>'   // /og-toprow
          + '<div class="og-splitter og-splitter-h" id="og-split-h" title="Drag to resize the clip editor"></div>'
          // shared bottom region — at medium/narrow widths the Inspector pane is
          // relocated here (JS applyLayoutMode) and these tabs switch between it
          // and the Clip Editor; hidden at wide, where the Inspector is a column.
          + '<div class="og-bottom" id="og-bottom">'
            + '<div class="og-bottom-tabs" id="og-bottom-tabs" role="tablist" aria-label="Bottom panel">'
              + '<button type="button" class="og-bottom-tab on" id="og-bottom-tab-insp" data-btab="insp" role="tab">Inspector</button>'
              + '<button type="button" class="og-bottom-tab" id="og-bottom-tab-edit" data-btab="edit" role="tab">Clip Editor</button>'
              + '<span class="og-bottom-hint" id="og-bottom-hint">Select a cue to inspect or trim</span>'
            + '</div>'
            + '<div class="og-pane og-edit-pane" id="og-edit-pane">'
              + '<div class="og-pane-head">Clip Editor<div class="og-pane-actions" id="og-edit-actions"></div></div>'
              + '<div class="og-edit-body" id="og-edit-body"></div>'
            + '</div>'
          + '</div>'
        + '</div>'
        // ── SFX ── (mockup: SFX Board | Pad Inspector on top + full-width Pad Editor below)
        + '<div class="og-sfx">'
          + '<div class="og-toprow" id="og-sfx-toprow">'
          + '<div class="og-pane og-sfx-main">'
            + '<div class="og-pane-head">SFX Board<div class="og-pane-actions"><div class="og-pad-search"><span class="og-search-glyph" aria-hidden="true"></span><input id="og-pad-search" type="search" placeholder="Search pads…" autocomplete="off"></div><label class="og-check og-check-inline"><input type="checkbox" id="og-multi"> Multi-trigger</label><button class="og-bar-btn og-sfx-stop-btn" id="og-sfx-stop">' + sym('media.stop', 'og-sfx-stop-icon') + 'Stop SFX</button></div></div>'
            + '<div class="og-bank-bar" id="og-bank-bar"></div>'
            + '<div class="og-pad-grid-wrap"><div class="og-pad-grid" id="og-pad-grid"></div><div class="og-pad-search-results" id="og-pad-search-results"></div></div>'
            + '<input type="file" id="og-pad-file" accept="audio/*,video/*" hidden>'
          + '</div>'
          + '<div class="og-splitter og-splitter-v" id="og-split-si" title="Drag to resize"></div>'
          + '<div class="og-pane og-sfx-side">'
            + '<div class="og-pane-head">Pad Inspector<div class="og-pane-actions"><span class="og-master"><span class="og-master-lbl">MASTER</span><span class="og-meter"><span class="og-meter-fill" id="og-master-fill2"></span></span></span></div></div>'
            + '<div class="og-sfx-master"><label class="og-field"><span>Master level</span><input type="range" id="og-master-gain" min="0" max="1.2" step="0.01" value="1"></label></div>'
            + '<div class="og-pad-inspector" id="og-pad-inspector"></div>'
          + '</div>'
          + '</div>'   // /og-sfx-toprow
          + '<div class="og-splitter og-splitter-h" id="og-split-sh" title="Drag to resize the pad editor"></div>'
          + '<div class="og-pane og-edit-pane" id="og-sfx-edit-pane">'
            + '<div class="og-pane-head">Pad Editor<div class="og-pane-actions" id="og-sfx-edit-actions"></div></div>'
            + '<div class="og-edit-body" id="og-sfx-edit-body"></div>'
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
      + '<div class="og-sheet" id="og-midi"><div class="og-sheet-card"><div class="og-sheet-head"><h3>' + sym('action.grid') + ' MIDI Control</h3><button class="og-sheet-x" id="og-midi-x">Done</button></div><div id="og-midi-body"></div></div></div>'
      + '<div class="og-sheet" id="og-integrations"><div class="og-sheet-card"><div class="og-sheet-head"><h3>' + sym('action.more') + ' Integrations</h3><button class="og-sheet-x" id="og-integrations-x">Done</button></div><div id="og-integrations-body"></div></div></div>'
      + '<div class="og-join" id="og-join"><div class="modal">'
        + '<div class="modal-title">Open Outrangutan</div>'
        + '<div class="modal-sub">Enter the session code to run playback for this show.</div>'
        + '<div class="field"><label class="field-lbl">Session Code</label><input class="field-in" id="og-join-code" type="text" placeholder="Session code" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" style="font-size:24px;font-family:var(--mono);letter-spacing:.2em;text-align:center"></div>'
        + '<div class="field"><label class="field-lbl">Your Name</label><input class="field-in" id="og-join-name" type="text" placeholder=\'e.g. "Alex"\' maxlength="40"></div>'
        + '<div class="modal-err" id="og-join-err">Please fill in both fields.</div>'
        + '<button class="btn-primary" id="og-join-go">Open Outrangutan</button>'
        + '<button class="btn-secondary" id="og-join-skip">Cancel</button>'
      + '</div></div>';

    // program decks reference
    decks = {
      a: { id: 'a', kind: 'video', el: $('og-program-a'), src: null, ch: null, vol: 1, _url: null },
      b: { id: 'b', kind: 'video', el: $('og-program-b'), src: null, ch: null, vol: 1, _url: null },
      audio: { id: 'audio', kind: 'audio', el: $('og-audio-deck'), src: null, ch: null, vol: 1, _url: null },
      img: { id: 'img', kind: 'image', el: $('og-program-img'), src: null, ch: null, vol: 1, _url: null },
    };
    decks.a.el.style.opacity = 1; decks.b.el.style.opacity = 0;

    // wire static controls
    $('og-back').onclick = exitOutrangutan;
    $('og-tab-play').onclick = () => setTab('play');
    $('og-tab-sfx').onclick = () => setTab('sfx');
    $('og-bottom-tab-insp').onclick = () => setBottomTab('insp');
    $('og-bottom-tab-edit').onclick = () => setBottomTab('edit');
    $('og-program-popout').onclick = popOutProgram;
    $('og-output-btn').onclick = openOutputsPanel;
    $('og-sd-btn').onclick = openSdPanel;
    $('og-midi-btn').onclick = openMidiPanel;
    $('og-midi-x').onclick = closeMidiPanel;
    $('og-print-btn').onclick = printShowPack;
    $('og-pro-btn').onclick = openIntegrations;
    $('og-scopes-btn').onclick = toggleScopes;
    $('og-lock-btn').onclick = toggleLock;
    $('og-help-btn').onclick = openHelp;
    $('og-save-file-btn').onclick = exportShowFile;
    const showFileInput = $('og-showfile-input');
    $('og-open-file-btn').onclick = openShowFilePicker;
    showFileInput.onchange = () => { if (showFileInput.files[0]) importShowFile(showFileInput.files[0]); showFileInput.value = ''; };
    $('og-help-close').onclick = closeHelp;
    $('og-outputs-x').onclick = closeOutputsPanel;
    $('og-sd-x').onclick = closeSdPanel;
    $('og-integrations-x').onclick = closeIntegrations;
    $('og-join-go').onclick = joinSession;
    $('og-join-skip').onclick = exitOutrangutan;   // Cancel → back to the front page (standalone is its own card button)
    const ogJoinKey = e => { if (e.key === 'Enter') { e.preventDefault(); joinSession(); } else if (e.key === 'Escape') { e.preventDefault(); exitOutrangutan(); } };
    $('og-join-code').addEventListener('keydown', ogJoinKey);
    $('og-join-name').addEventListener('keydown', ogJoinKey);
    $('og-go').onclick = goPauseButton;
    $('og-prev').onclick = () => moveSelection(-1);
    $('og-next').onclick = () => moveSelection(1);
    $('og-fade').onclick = fadeStopAll;
    $('og-panic').onclick = panic;
    const syncClockDir = () => { const d = $('og-clock-dir'); if (d) d.classList.toggle('is-elapsed', settings.clockMode === 'elapsed'); };
    const toggleClockDir = () => { settings.clockMode = settings.clockMode === 'remaining' ? 'elapsed' : 'remaining'; syncClockDir(); renderClock(); toast(settings.clockMode === 'elapsed' ? 'Clock counts up (elapsed)' : 'Clock counts down (remaining)'); scheduleSave(); };
    $('og-clock-dir').onclick = toggleClockDir;   // the ›/‹ chevron is the sole count-direction toggle
    $('og-clock').style.cursor = 'default';
    syncClockDir();
    $('og-wallclock').onclick = toggleWallClockMode;
    $('og-wallclock').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleWallClockMode(); } };
    $('og-recovery-dismiss').onclick = () => $('og-recovery').classList.remove('on');
    $('og-sfx-stop').onclick = stopAllPads;
    $('og-pad-search').oninput = (e) => { padSearch = e.target.value; renderPadSearch(); };
    $('og-pad-search').onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); padSearch = ''; e.target.value = ''; renderPadSearch(); e.target.blur(); } };
    $('og-multi').onchange = (e) => { settings.multiTrigger = e.target.checked; scheduleSave(); };
    ['og-master-gain', 'og-master-gain-play'].forEach(id => {
      const gain = $(id);
      if (gain) gain.oninput = (e) => { ensureAudio(); setMasterGain(parseFloat(e.target.value), id); scheduleSave(); };
    });
    renderThemeControl();
    watchCueolaTheme();
    const settingsSummary = document.querySelector('#og-theme-menu > summary');
    if (settingsSummary) {
      settingsSummary.onclick = (e) => { e.preventDefault(); const menu = $('og-theme-menu'); if (menu) menu.open = !menu.open; };
      settingsSummary.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); settingsSummary.click(); } };
    }
    // P6: pad inspector rides the shared kit's row mapping
    const padIns = $('og-pad-inspector'); if (padIns) padIns.classList.add('og-kit');
    // P6: theme/tools popovers close on outside click (shared dismissal pattern)
    document.addEventListener('pointerdown', (e) => {
      document.querySelectorAll('details.og-theme-menu[open], details.og-tools-menu[open]').forEach(d => {
        if (!d.contains(e.target)) d.removeAttribute('open');
      });
    }, true);

    const fileInput = $('og-file-input');
    $('og-cue-add').onclick = () => fileInput.click();
    fileInput.onchange = () => { importFiles(fileInput.files); fileInput.value = ''; };
    const padFile = $('og-pad-file');
    padFile.onchange = () => { if (padFile.files[0]) assignPad(padSlotForFile, padFile.files[0]); padFile.value = ''; };

    // drag & drop onto the cue pane
    const dropZone = $('og-cue-add'), listPane = root.querySelector('.og-cuelist-pane');
    ['dragenter', 'dragover'].forEach(ev => listPane.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => listPane.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === listPane) dropZone.classList.remove('drag'); }));
    listPane.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });

    // P7: contained — a throwing shortcut handler must never kill live keys.
    document.addEventListener('keydown', e => { try { onKey(e); } catch (err) { slog('error', 'Keyboard handler: ' + ((err && err.message) || err)); } });
    // Close the top-bar Theme / Tools dropdowns when clicking anywhere outside them.
    document.addEventListener('pointerdown', (e) => {
      if (!isOpen()) return;
      Array.prototype.forEach.call(document.querySelectorAll('#outrangutan details.og-theme-menu[open], #outrangutan details.og-tools-menu[open]'), (d) => {
        if (!d.contains(e.target)) d.removeAttribute('open');
      });
    });
    window.addEventListener('beforeunload', () => { if (cues.length || pads.length) saveShow(); });

    built = true;
    renderTransportKeys();
    initSplitters(); applyLayoutMode();
    let ogResizeT = 0;
    window.addEventListener('resize', () => { if (ogResizeT) clearTimeout(ogResizeT); ogResizeT = setTimeout(applyLayoutMode, 120); });

    renderWallClock();
    setInterval(renderWallClock, 1000);
  }

  function renderTransportKeys() {
    const sc = settings.shortcuts;
    const set = (id, k) => { const el = $(id); if (el) el.textContent = keyLabel(k); };
    set('og-k-go', sc.go); set('og-k-stop', sc.stop); set('og-k-pause', sc.pause); set('og-k-fade', sc.fadeStop); set('og-k-panic', sc.panic);
    renderFoot();
  }

  // ── screen nav ───────────────────────────────────────────────────────────
  function isOpen() { const el = $('outrangutan'); return el && el.classList.contains('on'); }
  function setModeBadge() { const b = $('og-mode-badge'); if (b) b.textContent = (mode === 'session' && sessionCode) ? ('Session · ' + sessionCode) : 'Standalone'; }
  function showScreen() {
    ['entry', 'rundown', 'liveshow', 'promptypus', 'flowOp'].forEach(s => { const el = $(s); if (el) el.classList.remove('on'); });
    $('outrangutan').classList.add('on');
    try { if (typeof window.pushSessionHistoryState === 'function') window.pushSessionHistoryState('outrangutan'); } catch (e) {}
    $('outrangutan').classList.toggle('locked', settings.showLock);
    $('og-lock-btn').classList.toggle('on', settings.showLock);
  }
  async function applyShow() {
    const s = await loadShow();
    if (!settings.layout) settings.layout = { wCuelist: 280, wInspector: 280, hEdit: 150 };
    ensureBanks();
    applyLayoutMode();
    renderTransportKeys(); renderAll();
    setTab(settings.tab || 'play');
    const mc = $('og-multi'); if (mc) mc.checked = !!settings.multiTrigger;
    syncMasterGainInputs();
    if (s) showRecovery(s); else $('og-recovery').classList.remove('on');
    setModeBadge();
    if (mode === 'session' && sessionCode) subscribeSession(); else unsubscribeSession();
    showLoaded = true;   // state is now hydrated — safe for an external add (e.g. a Cueola audio note → SFX pad)
  }

  // External hand-off: add an audio File as an SFX pad. Cueola's Production Notes
  // call this when the operator sends a note's audio to the board. Guarded — it
  // only writes when the show is loaded, so it can never clobber the saved show.
  async function addAudioPad(file) {
    if (!built || !showLoaded) return { ok: false, reason: 'not-open' };
    if (!file) return { ok: false, reason: 'no-file' };
    try {
      ensureBanks();
      let slot = -1;
      for (let i = 0; i < PAD_COUNT; i++) { const p = padBySlot(i); if (!p || !p.mediaId) { slot = i; break; } }
      if (slot < 0) { addBank(); slot = 0; }   // current bank full → start a fresh one
      await assignPad(slot, file);
      setTab('sfx');
      return { ok: true };
    } catch (e) { return { ok: false, reason: 'error' }; }
  }
  async function enterOutrangutan(m) {
    build(); ensureChannel(); showScreen();
    if (m === 'session') openSessionJoin();
    else { mode = 'standalone'; sessionCode = null; closeSessionJoin(); await applyShow(); }
  }

  function openSessionJoin() {
    mode = 'session';
    const sheet = $('og-join'); if (!sheet) { applyShow(); return; }
    const codeEl = $('og-join-code'), nameEl = $('og-join-name'), err = $('og-join-err');
    let preCode = sessionCode || '', preName = '';
    try {
      preCode = preCode || localStorage.getItem('cueola_outrangutan_code') || (window.session && window.session.code) || localStorage.getItem('cueola_last_code') || '';
      preName = localStorage.getItem('cueola_last_name') || '';
    } catch (e) {}
    if (codeEl && !codeEl.value) codeEl.value = preCode;
    if (nameEl && !nameEl.value) nameEl.value = preName;
    if (err) err.classList.remove('on');
    renderTransportKeys(); renderAll();
    sheet.classList.add('on');
    setTimeout(() => { const f = (codeEl && codeEl.value) ? nameEl : codeEl; if (f) { f.focus(); if (f.select) f.select(); } }, 40);
  }
  function closeSessionJoin() { const s = $('og-join'); if (s) s.classList.remove('on'); }
  async function joinSession() {
    const codeEl = $('og-join-code'), nameEl = $('og-join-name'), err = $('og-join-err');
    const code = (codeEl ? codeEl.value : '').trim().toUpperCase();
    const name = (nameEl ? nameEl.value : '').trim();
    if (!code || !name) { if (err) { err.textContent = 'Please fill in both fields.'; err.classList.add('on'); } const f = code ? nameEl : codeEl; if (f) f.focus(); return; }
    if (err) err.classList.remove('on');
    sessionCode = code; sessionUserName = name; mode = 'session';
    try { localStorage.setItem('cueola_outrangutan_code', code); localStorage.setItem('cueola_last_code', code); localStorage.setItem('cueola_last_name', name); } catch (e) {}
    closeSessionJoin(); await applyShow();
    slog('session', 'Joined session ' + code);
    toast('Joined session ' + code + '.');
  }

  function exitOutrangutan() {
    stopAll({ silent: true }); stopAllPads(); closeSessionJoin(); unsubscribeSession();
    outputs.forEach(o => { const r = outputWins.get(o.id); if (r && r.identify) identifyOutput(o.id, false); });
    closeOutputsPanel(); closeSdPanel();
    $('outrangutan').classList.remove('on');
    const entry = $('entry'); if (entry) entry.classList.add('on');
    try { if (typeof window.pushSessionHistoryState === 'function') window.pushSessionHistoryState('entry'); } catch (e) {}
  }

  // ── P7: preflight — deep-check this machine's library for the Cueola panel:
  // every cue's media exists + probed decodable with known dimensions, every
  // pad's audio decodes, and per-bank pad counts (empty banks get flagged).
  async function preflightReport() {
    // Use the live module state when loaded. Otherwise read the right show
    // record straight from IndexedDB — the show for the joined session code
    // (one show per code), never via loadShow(): a preflight must not mutate
    // the running app, and on a fresh tab loadShow() would pull the
    // *standalone* show and validate the wrong library (dress-rehearsal find).
    let rCues = cues, rPads = pads, rBanks = banks;
    if (!cues.length && !pads.length) {
      let code = (mode === 'session' && sessionCode) || '';
      try { code = code || localStorage.getItem('cueola_outrangutan_code') || localStorage.getItem('cueola_last_code') || ''; } catch (e) {}
      const s = await idbGet(SHOW_STORE, SHOW_KEY + (code ? '_' + code : ''));
      if (s && Array.isArray(s.cues)) {
        rCues = s.cues; rPads = Array.isArray(s.pads) ? s.pads : []; rBanks = Array.isArray(s.banks) ? s.banks : [];
      } else { rCues = []; rPads = []; rBanks = []; }
    }
    const report = { cues: [], pads: [], banks: [] };
    for (const c of rCues) {
      if (!c.mediaId) { report.cues.push({ id: c.id, num: c.num, name: c.name, ok: false, checked: true, issue: 'no media attached' }); continue; }
      const m = await idbGet(MEDIA_STORE, c.mediaId);
      let ok = true, issue = '';
      if (!m || !m.blob) { ok = false; issue = 'media missing from the library'; }
      else if (c.broken) { ok = false; issue = 'failed at its last play (⚠)'; }
      else if (c.type !== 'image' && !(m.duration > 0)) { ok = false; issue = 'no decodable duration'; }
      else if (c.type !== 'audio' && !(m.width > 0 && m.height > 0)) { ok = false; issue = 'unknown dimensions — re-import to probe'; }
      report.cues.push({ id: c.id, num: c.num, name: c.name, ok, checked: true, issue, dims: (m && m.width) ? m.width + '×' + m.height : '', dur: (m && m.duration) || 0 });
    }
    for (const p of rPads) {
      if (!p.mediaId) continue;
      const bank = rBanks.find(b => b.id === p.bank);
      const m = await idbGet(MEDIA_STORE, p.mediaId);
      let ok = true, issue = '';
      if (!m || !m.blob) { ok = false; issue = 'media missing from the library'; }
      else {
        const buf = bufferCache.get(p.mediaId) || await decodeBuffer(p.mediaId);
        if (!buf) { ok = false; issue = 'audio won’t decode'; }
      }
      report.pads.push({ id: p.id, name: p.name || 'Pad', bank: bank ? bank.name : '', ok, issue });
    }
    report.banks = rBanks.map(b => ({ id: b.id, name: b.name, padCount: rPads.filter(p => p.bank === b.id && p.mediaId).length }));
    const badC = report.cues.filter(c => !c.ok).length, badP = report.pads.filter(p => !p.ok).length;
    slog('preflight', 'Deep check — ' + report.cues.length + ' cues (' + badC + ' bad) · ' + report.pads.length + ' pads (' + badP + ' bad)');
    return report;
  }

  // ── exports ──────────────────────────────────────────────────────────────
  window.enterOutrangutan = enterOutrangutan;
  window.exitOutrangutan = exitOutrangutan;
  window.Outrangutan = { enter: enterOutrangutan, exit: exitOutrangutan,
    preflight: preflightReport,                     // P7: deep media/SFX check for the Cueola preflight panel
    outputHealth,                                   // watchdog status for the preflight "Playout outputs" row
    saveShowFile: () => { exportShowFile(); },      // P7: Cmd+S save-in-place hook
    isReady: () => built && showLoaded && isOpen(),  // safe to receive an external SFX pad right now?
    addAudioPad,                                    // Cueola audio note → SFX pad hand-off
    goToSfx: () => { if (built) { showScreen(); setTab('sfx'); } },
    // Console rehearsal hook: test MIDI mappings (incl. learn mode) without a
    // box plugged in — Outrangutan.midiInject(0x90, 60, 127) is a C4 note-on.
    midiInject: (status, d1, d2) => onMidiMessage({ data: [status, d1, d2 || 0] }),
    _state: () => ({ cues, pads, banks, currentBankId, outputs, sdMap, selectedId, selectedPadId, settings, active: active && active.cue.id, mode, sessionCode }),
    _onSessionDoc: onSessionDoc, _sender: () => OG_SENDER,
    // P4: same-page fast path — when Cueola and Outrangutan share this tab (the
    // one-operator setup), the rundown fires pads/cues directly (<30 ms) instead
    // of round-tripping a Firestore command.
    _local: {
      session: () => (mode === 'session' ? sessionCode : ''),
      firePad: (id) => { const p = padById(id); if (p && p.mediaId) { firePad(p); return true; } return false; },
      fireCue: (id) => { const c = cueById(id); if (c) { selectedId = c.id; go(); renderCueList(); renderInspector(); renderEditArea(); return true; } return false; },
      // P5: whole-transport fast path for the live-screen keymap (G/P/S/…)
      transport: (action) => {
        if (action === 'go') { go(); return true; }
        if (action === 'pause') { pauseResume(); return true; }
        if (action === 'stop') { stopAll(); return true; }
        if (action === 'fadeStop') { fadeStopAll(); return true; }
        if (action === 'panic') { panic(); return true; }
        return false;
      },
    },
    _p5: { drawScopes, makeKeyer, webPlayable, obs, obsReq, frontVideoEl } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { if ($('outrangutan')) build(); }, { once: true });
  else if ($('outrangutan')) build();
})();
