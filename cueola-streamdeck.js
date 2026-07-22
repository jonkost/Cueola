/* Cueola Control Surface. One Stream Deck + XL drives the whole rig.
 *
 * This is the browser-side controller that sits on top of three things that
 * already exist:
 *   - CueolaDeckDevice  (cueola-streamdeck-device.js): the pure WebHID protocol.
 *   - CueolaStreamDeckLabel (outrangutan/stream-deck-label.js): key-image render.
 *   - window.cueolaSurfaceBridge (cueola-app.js): the one seam into the running
 *     show: the KEYMAP action table, the prompter/playout/clock dispatchers,
 *     and a paint snapshot of live state.
 *
 * A physical control is bound to an ACTION. Pressing a key runs the same code
 * the keyboard shortcut runs (so every guard, every cross-device write, every
 * bit of Live single-authority is inherited for free). Dials send relative
 * ticks into continuous controls (volume, prompter speed/size/jog, rundown
 * select). The touch strip shows a live readout above each dial and taps fire
 * that dial's press action. Talkback A/B speak the talkbackd loopback socket
 * directly, momentary, with an all-off safety net.
 *
 * Phase 1 is same-machine: the deck lives in the show operator's own Cueola tab
 * and dispatches locally. The dispatch() seam is written so a Phase-2 cloud mode
 * (drive a show on another machine via the Firestore controlBus) can slot in
 * without touching the catalog, the profile, or the UI.
 *
 * Chromium only (WebHID). Quit the Elgato Stream Deck app first. It claims the
 * USB device exclusively.
 */
(function () {
  'use strict';

  var Device = window.CueolaDeckDevice;
  var TALKBACK_URLS = ['ws://127.0.0.1:17844', 'ws://localhost:17844'];
  var PROFILE_KEY = 'cueola_streamdeck_profile';   // per-productId mapping + geometry overrides
  var BRIGHTNESS_KEY = 'cueola_streamdeck_bright';
  var PAINT_HZ = 5;

  // ── Action catalog ─────────────────────────────────────────────────────────
  // Everything a control can be bound to. `kind` drives dispatch; `lamp(state)`
  // decides whether the key glows; `color` tints it. KEYMAP-backed actions pull
  // their label from the live registry so they can never drift from the app.
  var KEYMAP_ACTIONS = [
    ['playout.go', '#1c7a3e', 'GO'], ['playout.pause', '#5a4a12', 'PAUSE'],
    ['playout.stop', '#2e3640', 'STOP'], ['playout.fade', '#243a66', 'FADE'],
    ['playout.panic', '#8a1f1f', 'PANIC'],
    ['rundown.next', '#234a8a', 'NEXT'], ['rundown.back', '#2e3640', 'PREV'],
    ['prompter.cue.current', '#234a8a', 'CUE ROW'],
    ['prompter.playpause', '#6a3b8a', 'SCROLL'], ['prompter.top', '#2e3640', 'TOP'],
    ['prompter.size.up', '#2e3640', 'A+'], ['prompter.size.down', '#2e3640', 'A-'],
    ['prompter.speed.up', '#2e3640', 'SPD+'], ['prompter.speed.down', '#2e3640', 'SPD-'],
    ['prompter.dir.fwd', '#2e3640', 'FWD'], ['prompter.dir.rev', '#2e3640', 'REV'],
    ['prompter.fullscreen', '#2e3640', 'FULL'], ['prompter.hideui', '#2e3640', 'HIDE UI'],
    ['prompter.mirror', '#2e3640', 'MIRROR'], ['prompter.brake', '#5a4a12', 'BRAKE'],
    ['prompter.boost', '#5a4a12', 'BOOST'], ['prompter.nudge.back', '#2e3640', 'NUDGE-'],
    ['prompter.nudge.fwd', '#2e3640', 'NUDGE+'], ['prompter.editscript', '#2e3640', 'EDIT'],
    ['ref.open', '#2e3640', 'HELP'], ['scrub.open', '#2e3640', 'SCRUB']
  ];

  var catalog = {};   // id -> descriptor
  function registerAction(desc) { catalog[desc.id] = desc; }

  function buildCatalog() {
    catalog = {};
    registerAction({ id: 'none', kind: 'none', group: 'Blank', label: '' });
    var km = surfaceKeymap();
    KEYMAP_ACTIONS.forEach(function (row) {
      var id = row[0], color = row[1], short = row[2];
      var entry = km.find(function (a) { return a.id === id; });
      registerAction({
        id: 'km:' + id, kind: 'keymap', keymapId: id, hold: !!(entry && entry.hold),
        group: (entry && entry.group) || 'Show', color: color,
        label: short, full: (entry && entry.label) || id,
        lamp: lampFor(id)
      });
    });
    // Playout by slot. Resolves to the Nth cue/pad in the loaded show at fire
    // time, so a profile does not have to name volatile cue ids.
    for (var p = 1; p <= 8; p++) registerAction({ id: 'pad:' + p, kind: 'pad', slot: p, group: 'SFX pads', color: '#5a2a8a', label: 'PAD ' + p, full: 'SFX pad slot ' + p });
    for (var c = 1; c <= 8; c++) registerAction({ id: 'cue:' + c, kind: 'cue', slot: c, group: 'Cues', color: '#234a8a', label: 'CUE ' + c, full: 'Playout cue slot ' + c });
    registerAction({ id: 'golive', kind: 'golive', group: 'Show', color: '#8a1f1f', label: 'GO LIVE', full: 'Enter Live / start show', lamp: function (s) { return !!(s.live && s.live.on); } });
    registerAction({ id: 'clock', kind: 'clock', group: 'Show', color: '#243a66', label: 'CLOCK', full: 'Start / pause show clock', lamp: function (s) { return !!(s.clock && s.clock.running); } });
    registerAction({ id: 'talk.a', kind: 'talkback', bus: 'A', momentary: true, group: 'Talkback', color: '#17653a', label: 'TALK A', full: 'Talk A (outs 1-2), hold', lamp: function () { return talkbackState.A; } });
    registerAction({ id: 'talk.b', kind: 'talkback', bus: 'B', momentary: true, group: 'Talkback', color: '#1c4a86', label: 'TALK B', full: 'Talk B (outs 3-4), hold', lamp: function () { return talkbackState.B; } });
    registerAction({ id: 'talk.off', kind: 'talkbackPanic', group: 'Talkback', color: '#8a1f1f', label: 'ALL TALK OFF', full: 'Cut both talkback buses' });
  }

  function lampFor(id) {
    if (id === 'playout.go') return function (s) { return s.playout && s.playout.status === 'play'; };
    if (id === 'playout.pause') return function (s) { return s.playout && s.playout.status === 'pause'; };
    if (id === 'prompter.playpause') return function (s) { return s.prompter && s.prompter.playing; };
    return null;
  }

  // Dial controllers, continuous. accum keeps sub-step fractions so a slow turn
  // still moves. reset is the dial-press action.
  var DIAL_CONTROLLERS = {
    master: { label: 'Program vol', readout: function (s) { return pct(masterGain()); }, tick: function (d) { setMaster(masterGain() + d * 0.03); }, press: function () { toggleMasterMute(); }, pressLabel: 'Mute' },
    prompterSpeed: { label: 'Prompter speed', readout: function (s) { return s.prompter ? String(Math.round(s.prompter.speed || 0)) : '-'; }, tick: function (d) { surfacePrompter(d > 0 ? 'speed_up' : 'speed_down'); }, press: function () { surfaceRun('prompter.playpause'); }, pressLabel: 'Play/Pause' },
    prompterSize: { label: 'Text size', readout: function (s) { return s.prompter ? String(Math.round(s.prompter.size || 0)) : '-'; }, tick: function (d) { surfacePrompter(d > 0 ? 'size_up' : 'size_down'); }, press: function () { surfacePrompter('reset'); }, pressLabel: 'Reset' },
    prompterJog: { label: 'Jog', readout: function (s) { return s.prompter && s.prompter.positionPct != null ? pct(s.prompter.positionPct / 100) : 'jog'; }, tick: jogTick, press: function () { surfaceRun('prompter.cue.current'); }, pressLabel: 'Cue row' },
    rundownSelect: { label: 'Rundown', readout: function (s) { return s.live ? ((s.live.selectedIndex + 1) + '/' + s.live.rowCount) : '-'; }, tick: rundownTick, press: function () { rundownTake(); }, pressLabel: 'Take' },
    brightness: { label: 'Deck light', readout: function () { return pct(brightness / 100); }, tick: function (d) { setBrightness(brightness + d * 5); }, press: function () { setBrightness(80); }, pressLabel: 'Reset' }
  };

  var DEFAULT_DIALS = ['master', 'prompterSpeed', 'prompterSize', 'prompterJog', 'rundownSelect', 'brightness'];

  // ── Default profile (36 keys, laid out by band) ────────────────────────────
  function defaultKeyLayout(keys) {
    var L = [
      'km:playout.go', 'km:playout.pause', 'km:playout.stop', 'km:playout.fade', 'km:playout.panic', 'km:rundown.next', 'km:rundown.back', 'golive', 'km:prompter.cue.current',
      'km:prompter.playpause', 'km:prompter.top', 'km:prompter.size.up', 'km:prompter.size.down', 'km:prompter.speed.up', 'km:prompter.speed.down', 'km:prompter.dir.fwd', 'km:prompter.dir.rev', 'km:prompter.fullscreen',
      'km:prompter.hideui', 'km:prompter.mirror', 'km:prompter.brake', 'km:prompter.boost', 'km:prompter.nudge.back', 'km:prompter.nudge.fwd', 'km:prompter.editscript', 'km:ref.open', 'km:scrub.open',
      'pad:1', 'pad:2', 'pad:3', 'pad:4', 'talk.a', 'talk.b', 'talk.off', 'clock', 'none'
    ];
    var out = [];
    for (var i = 0; i < keys; i++) out.push(L[i] || 'none');
    return out;
  }
  function defaultTouch(zones) {
    // Each zone mirrors the dial above it (tap == dial press).
    var out = [];
    for (var i = 0; i < zones; i++) out.push({ dial: i });
    return out;
  }

  // ── Module state ────────────────────────────────────────────────────────────
  var device = null;          // { hid, profile }
  var profile = null;         // CueolaDeckDevice profile for the connected model
  var mapping = null;         // { keys:[actionId], dials:[controllerId], touch:[{dial}] }
  var keyState = [];          // last physical key up/down
  var dialPress = [];         // last physical dial press state
  var lastPainted = [];       // last key descriptor signature (repaint only on change)
  var lastStripSig = '';
  var brightness = 80;
  var paintTimer = null;
  var jogAccum = 0;
  var muteMemory = null;      // restore level after a dial mute
  var learn = { open: false, overrides: {} };
  var mode = 'local';         // 'local' (same machine) | 'cloud' (Phase 2)

  // Talkback
  var tbSocket = null, tbUrlIndex = 0, tbReconnect = null;
  var talkbackState = { A: false, B: false, connected: false };
  var talkbackHeld = { A: false, B: false };

  // ── Bridge accessors (all defensive, the app may not be loaded in a test) ──
  function bridge() { return window.cueolaSurfaceBridge || null; }
  function surfaceKeymap() { var b = bridge(); try { return (b && b.keymap()) || []; } catch (e) { return []; } }
  function surfaceState() {
    var b = bridge();
    var base = { session: { code: '', active: false }, playout: {}, prompter: null, clock: {}, live: null };
    try { return (b && b.state()) || base; } catch (e) { return base; }
  }
  function surfaceRun(id) { var b = bridge(); try { b && b.runAction(id); } catch (e) {} }
  function surfacePrompter(a) { var b = bridge(); try { b && b.prompter(a); } catch (e) {} }
  function masterGain() { var b = bridge(); try { return (b && b.masterGain != null ? b.masterGain() : 0) || 0; } catch (e) { return 0; } }
  function setMaster(v) { var b = bridge(); try { b && b.setMasterGain && b.setMasterGain(Math.max(0, Math.min(1.2, v))); } catch (e) {} }
  function toggleMasterMute() {
    var g = masterGain();
    if (g > 0.001) { muteMemory = g; setMaster(0); } else { setMaster(muteMemory != null ? muteMemory : 0.8); muteMemory = null; }
  }
  function jogTick(d) { jogAccum = Math.max(0, Math.min(1, jogAccum + d * 0.02)); surfacePrompter('seek_set_' + jogAccum.toFixed(2)); }
  function rundownTick(d) {
    var b = bridge(); if (!b) return;
    var s = surfaceState(); if (!s.live) return;
    var next = Math.max(0, Math.min((s.live.rowCount || 1) - 1, (s.live.selectedIndex || 0) + (d > 0 ? 1 : -1)));
    try { b.liveSelect(next, false); } catch (e) {}
  }
  function rundownTake() { var b = bridge(); var s = surfaceState(); if (b && s.live) { try { b.liveSelect(s.live.selectedIndex || 0, true); } catch (e) {} } }

  // ── Dispatch ────────────────────────────────────────────────────────────────
  // The single seam. mode==='local' calls straight into the app (Phase 1). The
  // 'cloud' branch is where a future controlBus fan-out lands; today it degrades
  // to the local path so nothing silently no-ops.
  function fireAction(actionId, phase) {
    var a = catalog[actionId];
    if (!a || a.kind === 'none') return;
    if (mode === 'cloud' && dispatchCloud(a, phase)) return;
    switch (a.kind) {
      case 'keymap':
        if (a.hold) { var b = bridge(); try { phase === 'down' ? b.holdStart(a.keymapId) : b.holdStop(a.keymapId); } catch (e) {} }
        else if (phase === 'down') surfaceRun(a.keymapId);
        break;
      case 'pad': if (phase === 'down') firePlayoutSlot('pad', a.slot); break;
      case 'cue': if (phase === 'down') firePlayoutSlot('cue', a.slot); break;
      case 'golive': if (phase === 'down') { var bb = bridge(); try { bb && bb.goLive && bb.goLive(); } catch (e) {} } break;
      case 'clock': if (phase === 'down') { var bc = bridge(); try { bc && bc.showClockToggle && bc.showClockToggle(); } catch (e) {} } break;
      case 'talkback': talkbackSet(a.bus, phase === 'down'); break;
      case 'talkbackPanic': if (phase === 'down') releaseTalkback(true); break;
    }
  }
  function dispatchCloud() { return false; }   // Phase 2 seam (controlBus fan-out).

  function firePlayoutSlot(kind, slot) {
    var b = bridge(); if (!b) return;
    var s = surfaceState();
    var map = (kind === 'pad' ? (s.playout && s.playout.pads) : (s.playout && s.playout.cues)) || {};
    var ids = Object.keys(map);
    var id = ids[slot - 1];
    if (!id) { toast('No ' + (kind === 'pad' ? 'SFX pad' : 'cue') + ' in slot ' + slot + ' yet.'); return; }
    try { kind === 'pad' ? b.playoutPad(id) : b.playoutCue(id); } catch (e) {}
  }

  // ── Talkback (loopback WebSocket, momentary) ────────────────────────────────
  function talkbackConnect() {
    if (tbSocket && (tbSocket.readyState === 0 || tbSocket.readyState === 1)) return;
    var url = TALKBACK_URLS[tbUrlIndex % TALKBACK_URLS.length];
    var ws;
    try { ws = new WebSocket(url); } catch (e) { scheduleTalkbackReconnect(); return; }
    tbSocket = ws;
    ws.onopen = function () { talkbackState.connected = true; try { ws.send('state?'); } catch (e) {} renderStatus(); };
    ws.onmessage = function (evt) {
      var msg; try { msg = JSON.parse(evt.data); } catch (e) { return; }
      if (msg && msg.type === 'state') { talkbackState.A = !!msg.talkA; talkbackState.B = !!msg.talkB; schedulePaint(); renderStatus(); }
    };
    ws.onclose = function () {
      talkbackState.connected = false; talkbackState.A = false; talkbackState.B = false;
      talkbackHeld.A = false; talkbackHeld.B = false;
      tbUrlIndex++; scheduleTalkbackReconnect(); schedulePaint(); renderStatus();
    };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  function scheduleTalkbackReconnect() { clearTimeout(tbReconnect); tbReconnect = setTimeout(talkbackConnect, 2000); }
  function talkbackSend(cmd) { if (tbSocket && tbSocket.readyState === 1) { try { tbSocket.send(cmd); return true; } catch (e) {} } return false; }
  function talkbackSet(bus, on) {
    talkbackHeld[bus] = on;
    if (!talkbackSend(bus + (on ? ' on' : ' off')) && on) toast('Talkback daemon not running (start talkbackd).');
  }
  // Safety net: never leave a bus live if a key-up is lost, focus leaves, or the
  // socket drops. force=true also cuts buses the daemon shows live but we did
  // not open (belt and suspenders before going off air).
  function releaseTalkback(force) {
    ['A', 'B'].forEach(function (bus) {
      if (talkbackHeld[bus] || (force && talkbackState[bus])) { talkbackHeld[bus] = false; talkbackSend(bus + ' off'); }
    });
  }

  // ── Device lifecycle ────────────────────────────────────────────────────────
  function supportedFilter(d) { return d && d.vendorId === Device.ELGATO_VID; }

  async function connect() {
    if (!navigator.hid) { toast('WebHID needs Chrome or Edge. The control surface is Chromium only.'); return false; }
    var dev;
    try {
      var have = (await navigator.hid.getDevices()).filter(supportedFilter);
      dev = have[0];
      if (!dev) { var picked = await navigator.hid.requestDevice({ filters: [{ vendorId: Device.ELGATO_VID }] }); dev = picked && picked[0]; }
    } catch (e) { toast('Stream Deck selection cancelled.'); return false; }
    if (!dev) { toast('No Stream Deck selected. Quit the Elgato app first, then Connect.'); return false; }
    return openDevice(dev);
  }

  async function openDevice(dev) {
    try { if (!dev.opened) await dev.open(); }
    catch (e) { toast('Could not open the Stream Deck. Quit the Elgato Stream Deck app (it grabs the device), then Connect again.'); return false; }
    var unitInfo = {};
    try {
      var fr = await dev.receiveFeatureReport(0x08);
      unitInfo = Device.parseUnitInfo(fr && fr.buffer ? new Uint8Array(fr.buffer) : fr) || {};
    } catch (e) { /* older firmware: fall back to profile defaults + Learn */ }
    var overrides = loadOverrides(dev.productId);
    profile = Device.makeProfile(dev.productId, { unitInfo: unitInfo, overrides: overrides });
    device = { hid: dev, profile: profile, unitInfo: unitInfo };
    keyState = new Array(profile.keys).fill(false);
    dialPress = new Array(profile.dials).fill(false);
    lastPainted = new Array(profile.keys).fill(null);
    lastStripSig = '';
    registerLabelModel(profile);
    ensureMapping();
    dev.oninputreport = onInputReport;
    try { navigator.hid.addEventListener('disconnect', onDisconnect); } catch (e) {}
    sendFeature(Device.resetReport(profile));
    setBrightness(brightness);
    // Draw the on-screen setup grid immediately; painting 36 device images can
    // take a second and must never gate the UI appearing.
    render();
    startPaintLoop();
    paintAll();
    toast('Connected: ' + profile.name + ' (' + profile.keys + ' keys, ' + profile.dials + ' dials).');
    return true;
  }

  function onDisconnect(e) {
    if (!device) return;
    if (e && e.device && e.device !== device.hid) return;
    teardownDevice();
    toast('Stream Deck disconnected.');
    render();
  }
  function disconnect() {
    if (device && device.hid) { try { sendFeature(Device.resetReport(profile)); } catch (e) {} try { device.hid.close(); } catch (e) {} }
    teardownDevice();
    render();
  }
  function teardownDevice() { stopPaintLoop(); device = null; profile = null; keyState = []; dialPress = []; }

  function onInputReport(e) {
    if (!device) return;
    var data = new Uint8Array(e.data.buffer);
    var evt = Device.parseInputReport(e.reportId, data, profile);
    if (evt.type === 'keys') {
      var edges = Device.keyEdges(keyState, evt.states);
      keyState = evt.states;
      edges.downs.forEach(function (i) { fireKey(i, 'down'); });
      edges.ups.forEach(function (i) { fireKey(i, 'up'); });
      if (edges.downs.length || edges.ups.length) schedulePaint();
    } else if (evt.type === 'dials') {
      if (evt.kind === 'rotate') evt.ticks.forEach(function (t, i) { if (t) dialTick(i, t); });
      else evt.press.forEach(function (down, i) { if (down !== dialPress[i]) { dialPress[i] = down; if (down) dialPressFire(i); } });
      schedulePaint();
    } else if (evt.type === 'touch') {
      touchFire(evt);
    }
  }

  function actionForKey(i) { return (mapping && mapping.keys[i]) || 'none'; }
  function fireKey(i, phase) { fireAction(actionForKey(i), phase); }
  function controllerForDial(i) { var id = mapping && mapping.dials[i]; return DIAL_CONTROLLERS[id]; }
  function dialTick(i, ticks) { var c = controllerForDial(i); if (c) { try { c.tick(ticks); } catch (e) {} } }
  function dialPressFire(i) { var c = controllerForDial(i); if (c) { try { c.press(); } catch (e) {} } }
  function touchFire(evt) {
    if (evt.zone == null) return;
    var z = (mapping.touch[evt.zone]) || { dial: evt.zone };
    var c = DIAL_CONTROLLERS[mapping.dials[z.dial]];
    if (c && evt.gesture !== 'flick') { try { c.press(); } catch (e) {} }
    else if (c && evt.gesture === 'flick') { try { c.tick(evt.x2 > evt.x ? 3 : -3); } catch (e) {} }
  }

  // ── Painting ────────────────────────────────────────────────────────────────
  function startPaintLoop() { stopPaintLoop(); paintTimer = setInterval(paintTick, Math.round(1000 / PAINT_HZ)); }
  function stopPaintLoop() { if (paintTimer) clearInterval(paintTimer); paintTimer = null; }
  var paintScheduled = false;
  function schedulePaint() { paintScheduled = true; }
  function paintTick() { if (paintScheduled) { paintScheduled = false; paintChanged(); } }

  function keySignature(i, s) {
    var a = catalog[actionForKey(i)] || {};
    var active = (a.lamp && a.lamp(s)) || keyState[i];
    var label = keyLabel(a, s);
    return active + '|' + label + '|' + (a.color || '');
  }
  function keyLabel(a, s) {
    if (!a || a.kind === 'none') return '';
    if (a.kind === 'pad' || a.kind === 'cue') {
      var map = (a.kind === 'pad' ? (s.playout && s.playout.pads) : (s.playout && s.playout.cues)) || {};
      var id = Object.keys(map)[a.slot - 1];
      if (id && map[id]) return (a.kind === 'cue' ? '#' + (map[id].num || a.slot) + '\n' : '') + (map[id].name || a.label);
      return a.label;
    }
    return a.label;
  }
  async function paintAll() { lastPainted = new Array(profile ? profile.keys : 0).fill(null); await paintChanged(); await paintStrip(true); }
  async function paintChanged() {
    if (!device || !profile) return;
    var s = surfaceState();
    for (var i = 0; i < profile.keys; i++) {
      var sig = keySignature(i, s);
      if (sig === lastPainted[i]) continue;
      lastPainted[i] = sig;
      await paintKey(i, s);
    }
    await paintStrip(false);
  }
  async function paintKey(i, s) {
    var renderer = window.CueolaStreamDeckLabel;
    if (!renderer || !device) return;
    var a = catalog[actionForKey(i)] || {};
    var active = !!((a.lamp && a.lamp(s)) || keyState[i]);
    try {
      var rendered = await renderer.renderKeyImage(profile.productId, i, {
        text: keyLabel(a, s), active: active,
        backgroundColor: a.color || '#101418', accentColor: '#8ff7bc', maxLines: 3
      });
      var packets = Device.keyImagePackets(profile, i, rendered.bytes);
      for (var pk = 0; pk < packets.length; pk++) { if (!device) return; await device.hid.sendReport(packets[pk].reportId, packets[pk].data); }
    } catch (e) { /* one bad key must not abort the sweep */ }
  }
  async function paintStrip(force) {
    if (!device || !profile || !profile.strip) return;
    var s = surfaceState();
    var cells = [];
    for (var z = 0; z < profile.strip.zones; z++) {
      var dialId = mapping.dials[(mapping.touch[z] || { dial: z }).dial];
      var c = DIAL_CONTROLLERS[dialId];
      cells.push({ title: c ? c.label : '', value: c ? String(c.readout(s)) : '', tap: c ? c.pressLabel : '' });
    }
    var sig = JSON.stringify(cells);
    if (!force && sig === lastStripSig) return;
    lastStripSig = sig;
    try {
      var bytes = await renderStripJpeg(cells);
      if (!bytes) return;
      var packets = Device.stripImagePackets(profile, bytes);
      for (var pk = 0; pk < packets.length; pk++) { if (!device) return; await device.hid.sendReport(packets[pk].reportId, packets[pk].data); }
    } catch (e) { /* strip is a nicety; keys/dials keep working without it */ }
  }
  async function renderStripJpeg(cells) {
    var w = profile.strip.w, h = profile.strip.h;
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d'); if (!ctx) return null;
    ctx.fillStyle = '#0b0e13'; ctx.fillRect(0, 0, w, h);
    var zw = w / cells.length;
    ctx.textAlign = 'center';
    cells.forEach(function (cell, i) {
      var x = i * zw + zw / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.moveTo(i * zw, 8); ctx.lineTo(i * zw, h - 8); ctx.stroke();
      ctx.fillStyle = '#8a93a3'; ctx.font = '600 15px -apple-system, "Segoe UI", sans-serif';
      ctx.fillText(cell.title, x, 24);
      ctx.fillStyle = '#ffffff'; ctx.font = '700 34px -apple-system, "Segoe UI", sans-serif';
      ctx.fillText(cell.value, x, 66);
      ctx.fillStyle = '#5b647a'; ctx.font = '600 12px -apple-system, "Segoe UI", sans-serif';
      ctx.fillText(cell.tap, x, h - 12);
    });
    var blob = await new Promise(function (res) { cv.toBlob(res, 'image/jpeg', 0.85); });
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  }

  function sendFeature(rep) { if (device) { try { device.hid.sendFeatureReport(rep.reportId, rep.data); } catch (e) {} } }
  function setBrightness(pct) {
    brightness = Math.max(0, Math.min(100, Math.round(pct)));
    try { localStorage.setItem(BRIGHTNESS_KEY, String(brightness)); } catch (e) {}
    if (device && profile) sendFeature(Device.brightnessReport(profile, brightness));
    var el = document.getElementById('sd-bright'); if (el && el.value != brightness) el.value = brightness;
    var lbl = document.getElementById('sd-bright-val'); if (lbl) lbl.textContent = brightness + '%';
  }

  function registerLabelModel(prof) {
    var r = window.CueolaStreamDeckLabel;
    if (!r || typeof r.registerModel !== 'function') return;
    try {
      r.registerModel({
        productId: prof.productId, name: prof.name, keys: prof.keys, columns: prof.cols,
        imageWidth: prof.keyPx, imageHeight: prof.keyPx, imageType: 'image/jpeg', imageQuality: 0.9,
        deviceRotationDegrees: prof.rotation, inputStateOffset: prof.stateOffset,
        packet: { reportId: prof.keyImage.reportId, command: prof.keyImage.command, packetSize: prof.keyImage.packetSize, headerSize: prof.keyImage.headerSize, payloadSize: prof.keyImage.packetSize - prof.keyImage.headerSize }
      });
    } catch (e) {}
  }

  // ── Profile persistence + mapping ───────────────────────────────────────────
  function ensureMapping() {
    var saved = loadMapping(profile.productId);
    mapping = {
      keys: (saved && saved.keys && saved.keys.length === profile.keys) ? saved.keys : defaultKeyLayout(profile.keys),
      dials: (saved && saved.dials && saved.dials.length === profile.dials) ? saved.dials : DEFAULT_DIALS.slice(0, profile.dials),
      touch: (saved && saved.touch && saved.touch.length) ? saved.touch : defaultTouch(profile.strip ? profile.strip.zones : 0)
    };
  }
  function profileStore() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'); } catch (e) { return {}; } }
  function loadMapping(pid) { return (profileStore()[pid] || {}).mapping || null; }
  function loadOverrides(pid) { return (profileStore()[pid] || {}).overrides || {}; }
  function saveProfile() {
    if (!profile) return;
    var store = profileStore();
    store[profile.productId] = { mapping: mapping, overrides: loadOverrides(profile.productId) };
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(store)); } catch (e) {}
  }
  function saveOverrides(ov) {
    if (!profile) return;
    var store = profileStore();
    store[profile.productId] = { mapping: mapping, overrides: ov };
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(store)); } catch (e) {}
  }
  function resetProfile() {
    if (!profile) return;
    mapping = { keys: defaultKeyLayout(profile.keys), dials: DEFAULT_DIALS.slice(0, profile.dials), touch: defaultTouch(profile.strip ? profile.strip.zones : 0) };
    saveProfile(); paintAll(); render();
  }

  // ── Utilities ────────────────────────────────────────────────────────────────
  function pct(v) { return Math.round((v || 0) * 100) + '%'; }
  function toast(msg) {
    if (typeof window.toast === 'function') { try { window.toast(msg); return; } catch (e) {} }
    var el = document.getElementById('sd-toast'); if (el) { el.textContent = msg; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove('on'); }, 3200); }
  }

  // ── Setup UI (rendered into #streamdeck) ────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function root() { return document.getElementById('sd-surface-root'); }

  function render() {
    var r = root(); if (!r) return;
    if (!navigator.hid) { r.innerHTML = '<div class="sd-empty">The control surface needs Chrome or Edge (WebHID). Open Cueola there to connect a Stream Deck.</div>'; return; }
    r.innerHTML = statusBar() + (device ? surfaceGrid() + learnPanel() : connectHelp());
    wire();
    renderStatus();
  }
  function statusBar() {
    var s = surfaceState();
    return '<div class="sd-status">'
      + statusChip('Device', device ? profile.name : 'Not connected', device ? 'ok' : 'off')
      + statusChip('Talkback', talkbackState.connected ? 'Daemon connected' : 'Not running', talkbackState.connected ? 'ok' : 'off')
      + statusChip('Session', s.session && s.session.code ? s.session.code : 'None', s.session && s.session.code ? 'ok' : 'off')
      + '<div class="sd-status-actions">'
      + (device ? '<button class="btn-secondary" id="sd-disconnect">Disconnect</button>' : '<button class="btn-primary" id="sd-connect">Connect deck</button>')
      + '<button class="btn-secondary" id="sd-talkoff">All talk off</button>'
      + '</div></div>';
  }
  function statusChip(label, value, cls) { return '<div class="sd-chip sd-chip-' + cls + '"><span class="sd-chip-l">' + esc(label) + '</span><span class="sd-chip-v">' + esc(value) + '</span></div>'; }
  function connectHelp() {
    return '<div class="sd-connect-help">'
      + '<h3>Connect your Stream Deck + XL</h3>'
      + '<ol><li>Plug the deck into this computer over USB.</li>'
      + '<li><b>Quit the Elgato Stream Deck app</b> if it is running. It holds the device exclusively and blocks the browser.</li>'
      + '<li>Click <b>Connect deck</b> and pick the device when the browser asks.</li></ol>'
      + '<p class="sd-note">Everything is driven from this tab, so keep Cueola open here while you run the show.</p>'
      + '<button class="btn-primary" id="sd-connect2">Connect deck</button></div>';
  }
  function surfaceGrid() {
    var s = surfaceState();
    var html = '<div class="sd-bright-row"><label>Deck brightness</label><input type="range" id="sd-bright" min="0" max="100" value="' + brightness + '"><span id="sd-bright-val">' + brightness + '%</span>'
      + '<button class="btn-secondary" id="sd-test">Test pattern</button><button class="btn-secondary" id="sd-reset">Reset layout</button></div>';
    html += '<div class="sd-keys" style="grid-template-columns:repeat(' + profile.cols + ',1fr)">';
    for (var i = 0; i < profile.keys; i++) {
      var a = catalog[actionForKey(i)] || {};
      var active = !!((a.lamp && a.lamp(s)) || keyState[i]);
      html += '<button class="sd-key' + (active ? ' on' : '') + (a.kind === 'none' ? ' blank' : '') + '" data-key="' + i + '" style="--kc:' + (a.color || '#1a1f27') + '">'
        + '<span class="sd-key-lbl">' + esc(keyLabel(a, s) || '') + '</span></button>';
    }
    html += '</div>';
    if (profile.dials) {
      html += '<div class="sd-dials">';
      for (var d = 0; d < profile.dials; d++) {
        var c = DIAL_CONTROLLERS[mapping.dials[d]] || {};
        html += '<div class="sd-dial" data-dial="' + d + '"><div class="sd-dial-knob">' + esc(c.readout ? String(c.readout(s)) : '') + '</div>'
          + '<div class="sd-dial-lbl">' + esc(c.label || 'unset') + '</div><div class="sd-dial-tap">tap: ' + esc(c.pressLabel || '') + '</div></div>';
      }
      html += '</div>';
    }
    return html;
  }
  function learnPanel() {
    var u = device.unitInfo || {};
    return '<details class="sd-learn"' + (learn.open ? ' open' : '') + '><summary>Connect &amp; Learn (device details)</summary>'
      + '<div class="sd-learn-body">'
      + '<p class="sd-note">The Stream Deck + XL is new enough that its exact USB profile is confirmed here from your actual unit. Adjust only if the test pattern looks wrong.</p>'
      + '<div class="sd-learn-grid">'
      + learnField('Product id', '0x' + profile.productId.toString(16))
      + learnField('Keys', profile.keys + (u.keys ? ' (device says ' + u.keys + ')' : ''))
      + learnField('Columns', profile.cols)
      + learnField('Key pixels', profile.keyPx)
      + learnField('Dials', profile.dials)
      + learnField('Strip', profile.strip ? (profile.strip.w + '×' + profile.strip.h + ', ' + profile.strip.zones + ' zones') : 'none')
      + '</div>'
      + '<div class="sd-learn-tune"><label><input type="checkbox" id="sd-flip"' + (profile.rotation ? ' checked' : '') + '> Key images upside-down (flip 180°)</label>'
      + '<label>Columns <input type="number" id="sd-cols" min="3" max="12" value="' + profile.cols + '"></label>'
      + '<button class="btn-secondary" id="sd-relearn">Apply &amp; repaint</button></div>'
      + '</div></details>';
  }
  function learnField(k, v) { return '<div class="sd-lf"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>'; }

  function renderStatus() {
    var bar = document.querySelector('.sd-status'); if (!bar) return;
    // Cheap targeted refresh of the chips without rebuilding the whole grid.
    var chips = bar.querySelectorAll('.sd-chip');
    if (chips[1]) { chips[1].className = 'sd-chip sd-chip-' + (talkbackState.connected ? 'ok' : 'off'); chips[1].querySelector('.sd-chip-v').textContent = talkbackState.connected ? 'Daemon connected' : 'Not running'; }
  }

  function openPicker(kind, index) {
    var groups = {};
    if (kind === 'key') {
      Object.keys(catalog).forEach(function (id) { var a = catalog[id]; (groups[a.group] = groups[a.group] || []).push({ id: id, label: a.full || a.label || id }); });
    } else {
      Object.keys(DIAL_CONTROLLERS).forEach(function (id) { (groups['Dials'] = groups['Dials'] || []).push({ id: id, label: DIAL_CONTROLLERS[id].label }); });
    }
    var cur = kind === 'key' ? actionForKey(index) : mapping.dials[index];
    var html = '<div class="sd-picker-head">Assign ' + (kind === 'key' ? 'key ' + (index + 1) : 'dial ' + (index + 1)) + '</div><div class="sd-picker-list">';
    Object.keys(groups).forEach(function (g) {
      html += '<div class="sd-picker-g">' + esc(g) + '</div>';
      groups[g].forEach(function (o) { html += '<button class="sd-picker-opt' + (o.id === cur ? ' cur' : '') + '" data-pick="' + esc(o.id) + '">' + esc(o.label || '(blank)') + '</button>'; });
    });
    html += '</div>';
    var ov = document.getElementById('sd-picker');
    ov.innerHTML = '<div class="sd-picker-card">' + html + '</div>';
    ov.className = 'sd-picker on';
    ov.onclick = function (e) {
      if (e.target === ov) { ov.className = 'sd-picker'; return; }
      var pick = e.target.getAttribute && e.target.getAttribute('data-pick');
      if (pick == null) return;
      if (kind === 'key') mapping.keys[index] = pick; else mapping.dials[index] = pick;
      saveProfile(); ov.className = 'sd-picker'; paintAll(); render();
    };
  }

  function wire() {
    var r = root(); if (!r) return;
    bind('sd-connect', connect); bind('sd-connect2', connect); bind('sd-disconnect', disconnect);
    bind('sd-talkoff', function () { releaseTalkback(true); });
    bind('sd-reset', resetProfile);
    bind('sd-test', testPattern);
    var br = document.getElementById('sd-bright'); if (br) br.oninput = function () { setBrightness(+br.value); };
    var relearn = document.getElementById('sd-relearn');
    if (relearn) relearn.onclick = function () {
      var ov = loadOverrides(profile.productId);
      ov.rotation = document.getElementById('sd-flip').checked ? 180 : 0;
      var cols = +document.getElementById('sd-cols').value; if (cols >= 3 && cols <= 12) ov.cols = cols;
      learn.open = true; saveOverrides(ov);
      profile = Device.makeProfile(profile.productId, { unitInfo: device.unitInfo, overrides: ov });
      device.profile = profile; registerLabelModel(profile); ensureMapping(); paintAll(); render();
    };
    r.querySelectorAll('.sd-key').forEach(function (btn) { btn.onclick = function () { openPicker('key', +btn.getAttribute('data-key')); }; });
    r.querySelectorAll('.sd-dial').forEach(function (el) { el.onclick = function () { openPicker('dial', +el.getAttribute('data-dial')); }; });
  }
  function bind(id, fn) { var el = document.getElementById(id); if (el) el.onclick = fn; }

  async function testPattern() {
    if (!device) return;
    var r = window.CueolaStreamDeckLabel;
    for (var i = 0; i < profile.keys; i++) {
      try {
        var rendered = await r.renderKeyImage(profile.productId, i, { text: String(i + 1), active: (i % 2 === 0), backgroundColor: '#243a66' });
        var packets = Device.keyImagePackets(profile, i, rendered.bytes);
        for (var pk = 0; pk < packets.length; pk++) await device.hid.sendReport(packets[pk].reportId, packets[pk].data);
      } catch (e) {}
    }
    lastPainted = new Array(profile.keys).fill('test');
    toast('Test pattern sent. If the numbers read upside-down, tick the flip box in Connect & Learn.');
  }

  // ── Entry / gating ──────────────────────────────────────────────────────────
  function open() {
    var id = window.CueolaIdentity;
    if (id && typeof id.identity === 'function' && !id.identity()) {
      try { id.openSignIn && id.openSignIn(); } catch (e) {}
      toast('Sign in to open the control surface.');
      return false;
    }
    showScreen();
    buildCatalog();
    try { brightness = Math.max(0, Math.min(100, parseInt(localStorage.getItem(BRIGHTNESS_KEY), 10) || 80)); } catch (e) {}
    talkbackConnect();
    render();
    // Reconnect a deck the browser already remembers (no picker needed).
    if (navigator.hid) navigator.hid.getDevices().then(function (list) {
      var d = (list || []).filter(supportedFilter)[0];
      if (d && !device) openDevice(d);
    }).catch(function () {});
    return true;
  }
  function close() {
    hideScreen();
  }
  function showScreen() {
    var scr = document.getElementById('streamdeck'); if (!scr) return;
    document.querySelectorAll('.screen.on').forEach(function (s) { s.classList.remove('on'); });
    scr.classList.add('on');
    try { if (typeof window.pushSessionHistoryState === 'function') window.pushSessionHistoryState('streamdeck'); } catch (e) {}
  }
  function hideScreen() {
    var scr = document.getElementById('streamdeck'); if (scr) scr.classList.remove('on');
    var entry = document.getElementById('entry'); if (entry) entry.classList.add('on');
  }

  // Safety nets: never leave the mic open or a hold stuck.
  window.addEventListener('blur', function () { releaseTalkback(false); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) releaseTalkback(false); });
  window.addEventListener('beforeunload', function () { releaseTalkback(true); });

  window.CueolaStreamDeck = {
    open: open, close: close, connect: connect, disconnect: disconnect,
    isConnected: function () { return !!device; },
    talkbackConnected: function () { return talkbackState.connected; },
    // Rehearsal + test hooks (no hardware needed).
    _catalog: function () { buildCatalog(); return catalog; },
    _fire: fireAction,
    _profileFor: function (pid, opts) { return Device.makeProfile(pid, opts || {}); }
  };
})();
