/* Cueola KeyWi (control surface). One Stream Deck + XL drives the whole rig.
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
 * ticks into continuous controls. The touch strip shows a live readout above
 * each dial and taps fire that dial's press action. Talkback A/B speak the
 * talkbackd loopback socket directly, momentary, with an all-off safety net.
 *
 * Deck Studio (the setup screen) adds named profiles, per-key custom
 * label/colour/icon, import/export to a file, and live-learn (press a control
 * to map it, or bind a cue/pad by name).
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
  var STORE_KEY = 'cueola_streamdeck_profile';   // per-productId config (profiles + geometry overrides)
  var BRIGHTNESS_KEY = 'cueola_streamdeck_bright';
  var PAINT_HZ = 5;
  var SWATCHES = ['#1c7a3e', '#8a1f1f', '#243a66', '#5a2a8a', '#5a4a12', '#2e3640', '#17653a', '#1c4a86', '#6a3b8a', '#7a5a1c', '#0f4c81', '#a4741e'];
  // Key-art quick picks: show-runner sounds and moments. Owner-requested fun.
  var EMOJI_ART = ['🔊', '💥', '👏', '🎉', '😂', '🥁', '🎺', '🔔', '⚡', '🌩️', '🎵', '📣', '🚨', '🎬', '🎸', '🦆', '💨', '🏆', '❤️', '🤫'];

  // ── Action catalog ─────────────────────────────────────────────────────────
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

  var catalog = {};
  function registerAction(desc) { catalog[desc.id] = desc; }

  // Plain-language explanations, shown as tooltips and inside the key editor,
  // so no binding is ever a mystery ("what is jog?" must never happen again).
  var KEYMAP_DESCS = {
    'playout.go': 'Fires the standby cue in Outrangutan. Doubles as resume when paused.',
    'playout.pause': 'Pauses the playing clip; press again to resume. Toggle.',
    'playout.stop': 'Stops all playback and resets standby to the top.',
    'playout.fade': 'Fades everything out over 0.8s, then stops.',
    'playout.panic': 'Hard-kills all video and SFX instantly. The emergency brake.',
    'rundown.next': 'Advances the live rundown to the next row.',
    'rundown.back': 'Steps the live rundown back one row.',
    'prompter.cue.current': 'Jumps the talent prompter to the current live row.',
    'prompter.playpause': 'Starts or stops the prompter scroll. Toggle.',
    'prompter.top': 'Sends the prompter back to the top of the script.',
    'prompter.size.up': 'Makes the talent text one step bigger.',
    'prompter.size.down': 'Makes the talent text one step smaller.',
    'prompter.speed.up': 'Scrolls the prompter a little faster.',
    'prompter.speed.down': 'Scrolls the prompter a little slower.',
    'prompter.dir.fwd': 'Prompter scrolls forward (normal). Toggle pair with REV.',
    'prompter.dir.rev': 'Prompter scrolls backward, for walking the script back. Toggle pair with FWD.',
    'prompter.fullscreen': 'Puts the talent display into fullscreen.',
    'prompter.hideui': 'Hides the chrome on the talent display. Toggle.',
    'prompter.mirror': 'Mirror-flips the talent display for a beam-splitter rig. Toggle.',
    'prompter.brake': 'HOLD to slow the prompter to a crawl. Releases when you let go.',
    'prompter.boost': 'HOLD to speed the prompter up. Releases when you let go.',
    'prompter.nudge.back': 'Nudges the script back 3 lines.',
    'prompter.nudge.fwd': 'Nudges the script forward 3 lines.',
    'prompter.editscript': 'Opens the current row script for editing.',
    'ref.open': 'Shows the keyboard shortcut reference overlay.',
    'scrub.open': 'Opens the jog-wheel scrub overlay for the prompter.'
  };
  var KEYMAP_TOGGLES = { 'playout.pause': 1, 'prompter.playpause': 1, 'prompter.hideui': 1, 'prompter.mirror': 1 };

  function buildCatalog() {
    catalog = {};
    registerAction({ id: 'none', kind: 'none', group: 'Blank', label: '', desc: 'Nothing. A spacer key.' });
    var km = surfaceKeymap();
    KEYMAP_ACTIONS.forEach(function (row) {
      var id = row[0], color = row[1], short = row[2];
      var entry = km.find(function (a) { return a.id === id; });
      registerAction({ id: 'km:' + id, kind: 'keymap', keymapId: id, hold: !!(entry && entry.hold), group: (entry && entry.group) || 'Show', color: color, label: short, full: (entry && entry.label) || id, desc: KEYMAP_DESCS[id] || '', toggle: !!KEYMAP_TOGGLES[id], lamp: lampFor(id) });
    });
    for (var p = 1; p <= 8; p++) registerAction({ id: 'pad:' + p, kind: 'pad', slot: p, group: 'SFX pads (by slot)', color: '#5a2a8a', label: 'PAD ' + p, full: 'SFX pad slot ' + p, icon: '🔊', desc: 'Fires whatever SFX pad sits in position ' + p + ' of the loaded show.' });
    for (var c = 1; c <= 8; c++) registerAction({ id: 'cue:' + c, kind: 'cue', slot: c, group: 'Cues (by slot)', color: '#234a8a', label: 'CUE ' + c, full: 'Playout cue slot ' + c, desc: 'Fires cue number ' + c + ' of the loaded show.' });
    // Named cue/pad refs are bound from the live show list in the key editor.
    registerAction({ id: 'padRef', kind: 'padRef', group: 'This show', color: '#5a2a8a', label: 'PAD', full: 'SFX pad (by name)', icon: '🔊', desc: 'Fires one specific SFX pad, picked by name.' });
    registerAction({ id: 'cueRef', kind: 'cueRef', group: 'This show', color: '#234a8a', label: 'CUE', full: 'Cue (by name)', desc: 'Fires one specific cue, picked by name.' });
    registerAction({ id: 'golive', kind: 'golive', group: 'Show', color: '#8a1f1f', label: 'GO LIVE', full: 'Enter Live / start show', desc: 'Opens the Live show screen (with its go-live check).', lamp: function (s) { return !!(s.live && s.live.on); } });
    // The clock suite: one toggle plus explicit Start / Pause / Resume verbs.
    // Lamps: Start+Resume glow while running; Pause glows while paused mid-show.
    registerAction({ id: 'clock', kind: 'clock', verb: 'toggle', group: 'Show clock', color: '#243a66', label: 'CLOCK', full: 'Show clock: start / pause', desc: 'One-key clock: starts it, or pauses it if running. Toggle.', toggle: true, lamp: function (s) { return !!(s.clock && s.clock.running); } });
    registerAction({ id: 'clock.start', kind: 'clock', verb: 'start', group: 'Show clock', color: '#1c7a3e', label: 'CLOCK GO', full: 'Show clock: start', desc: 'Starts the shared show clock. Quiet no-op if already running.', lamp: function (s) { return !!(s.clock && s.clock.running); } });
    registerAction({ id: 'clock.pause', kind: 'clock', verb: 'pause', group: 'Show clock', color: '#5a4a12', label: 'CLOCK ❚❚', full: 'Show clock: pause', desc: 'Pauses the shared show clock. Quiet no-op if already paused.', lamp: function (s) { return !!(s.clock && !s.clock.running && s.clock.elapsed > 0); } });
    registerAction({ id: 'clock.resume', kind: 'clock', verb: 'resume', group: 'Show clock', color: '#0f4c81', label: 'CLOCK ▶', full: 'Show clock: resume', desc: 'Resumes a paused show clock from where it stopped.', lamp: function (s) { return !!(s.clock && s.clock.running); } });
    registerAction({ id: 'talk.a', kind: 'talkback', bus: 'A', momentary: true, group: 'Talkback', color: '#17653a', label: 'TALK A', full: 'Talk A (outs 1-2), hold', desc: 'HOLD to talk to output pair A. Mic cuts the moment you release.', lamp: function () { return talkbackState.A; } });
    registerAction({ id: 'talk.b', kind: 'talkback', bus: 'B', momentary: true, group: 'Talkback', color: '#1c4a86', label: 'TALK B', full: 'Talk B (outs 3-4), hold', desc: 'HOLD to talk to output pair B. Mic cuts the moment you release.', lamp: function () { return talkbackState.B; } });
    registerAction({ id: 'talk.off', kind: 'talkbackPanic', group: 'Talkback', color: '#8a1f1f', label: 'ALL TALK OFF', full: 'Cut both talkback buses', desc: 'Cuts both talkback buses instantly. The off-air safety.' });
    // Layouts as pages: a key can jump straight to a saved layout, or cycle them.
    registerAction({ id: 'layout.next', kind: 'layoutNext', group: 'Layouts', color: '#2e3640', label: 'PAGE →', full: 'Next saved layout', desc: 'Cycles to the next saved layout. Turns the deck into pages.' });
    registerAction({ id: 'layoutRef', kind: 'layoutRef', group: 'Layouts', color: '#2e3640', label: 'PAGE', full: 'Jump to a layout (by name)', desc: 'Switches the whole deck to one specific saved layout.', lamp: function (s, slot) { return !!(slot && slot.ref && mapping().name === slot.ref); } });
    // OBS (obs-websocket). Lamps read live OBS state so keys glow when live.
    registerAction({ id: 'obs.stream', kind: 'obs', op: 'toggleStream', group: 'OBS', color: '#8a1f1f', label: 'STREAM', full: 'OBS: start / stop streaming', desc: 'Starts or stops the OBS stream. Glows while you are live. Toggle.', toggle: true, lamp: function () { return obsState().streaming; } });
    registerAction({ id: 'obs.record', kind: 'obs', op: 'toggleRecord', group: 'OBS', color: '#a4741e', label: 'REC', full: 'OBS: start / stop recording', desc: 'Starts or stops the OBS recording. Glows while recording. Toggle.', toggle: true, lamp: function () { return obsState().recording; } });
    registerAction({ id: 'obs.record.pause', kind: 'obs', op: 'pauseRecord', group: 'OBS', color: '#5a4a12', label: 'REC ❚❚', full: 'OBS: pause / resume recording', desc: 'Pauses the recording without stopping it. Toggle.', toggle: true, lamp: function () { return obsState().recordPaused; } });
    registerAction({ id: 'obs.vcam', kind: 'obs', op: 'toggleVirtualCam', group: 'OBS', color: '#243a66', label: 'V-CAM', full: 'OBS: virtual camera', desc: 'Toggles the OBS virtual camera output.', toggle: true, lamp: function () { return obsState().virtualCam; } });
    registerAction({ id: 'obs.replay', kind: 'obs', op: 'saveReplay', group: 'OBS', color: '#2e3640', label: 'CLIP', full: 'OBS: save replay buffer', desc: 'Saves the replay buffer: the instant highlight-clip button.' });
    registerAction({ id: 'obs.transition', kind: 'obs', op: 'studioTransition', group: 'OBS', color: '#2e3640', label: 'OBS TAKE', full: 'OBS: studio-mode transition', desc: 'Takes preview to program in OBS studio mode.' });
    for (var sc = 1; sc <= 6; sc++) registerAction({ id: 'obs.scene:' + sc, kind: 'obsScene', slot: sc, group: 'OBS scenes (by slot)', color: '#0f4c81', label: 'SCN ' + sc, full: 'OBS scene slot ' + sc, desc: 'Switches OBS to scene ' + sc + ' in the scene list. Glows when on air.', lamp: obsSceneSlotLamp(sc) });
    registerAction({ id: 'obs.sceneRef', kind: 'obsSceneRef', group: 'This OBS', color: '#0f4c81', label: 'SCENE', full: 'OBS scene (by name)', desc: 'Switches OBS to one specific scene, picked by name. Glows when on air.', lamp: function (s, slot) { return !!(slot && slot.ref && obsState().currentScene === slot.ref); } });
    registerAction({ id: 'obs.muteRef', kind: 'obsMuteRef', group: 'This OBS', color: '#5a4a12', label: 'MUTE', full: 'OBS mute (by name)', desc: 'Mutes or unmutes one OBS audio input. Glows while muted. Toggle.', toggle: true, lamp: function (s, slot) { return !!(slot && slot.ref && obsState().mutes && obsState().mutes[slot.ref]); } });
  }
  function obsSceneSlotLamp(sc) { return function () { var st = obsState(); return !!(st.currentScene && st.currentScene === (st.scenes || [])[sc - 1]); }; }
  function lampFor(id) {
    if (id === 'playout.go') return function (s) { return s.playout && s.playout.status === 'play'; };
    if (id === 'playout.pause') return function (s) { return s.playout && s.playout.status === 'pause'; };
    if (id === 'prompter.playpause') return function (s) { return s.prompter && s.prompter.playing; };
    if (id === 'prompter.mirror') return function (s) { return s.prompter && s.prompter.mirrored; };
    if (id === 'prompter.dir.rev') return function (s) { return s.prompter && s.prompter.reversed; };
    if (id === 'prompter.dir.fwd') return function (s) { return !!(s.prompter && s.prompter.playing && !s.prompter.reversed); };
    return null;
  }

  // Dial controllers. Every one declares, in plain words, what TURNING does and
  // what PRESSING the dial (or tapping its touch-strip zone) does. That text is
  // shown on the dial card, in the dial editor, and on the touch strip itself.
  // `bar(s)` returns 0..1 for the strip's progress bar; `hue` tints its zone.
  var DIAL_CONTROLLERS = {
    master: { label: 'Program vol', hue: '#22d3a0', turnLabel: 'Volume up / down', pressLabel: 'Mute / unmute',
      desc: 'Turn: program master volume. Press: instant mute, press again to restore.',
      readout: function () { return pct(masterGain()); }, bar: function () { return Math.min(1, masterGain() / 1.2); },
      tick: function (d) { setMaster(masterGain() + d * 0.03); }, press: function () { toggleMasterMute(); } },
    prompterSpeed: { label: 'Prompter speed', hue: '#b06ef8', turnLabel: 'Faster / slower', pressLabel: 'Play / pause',
      desc: 'Turn: prompter scroll speed. Press: start or stop the scroll.',
      readout: function (s) { return s.prompter ? String(Math.round(s.prompter.speed || 0)) : '-'; }, bar: function (s) { return s.prompter ? Math.min(1, (s.prompter.speed || 0) / 200) : 0; },
      tick: function (d) { surfacePrompter(d > 0 ? 'speed_up' : 'speed_down'); }, press: function () { surfaceRun('prompter.playpause'); } },
    prompterSize: { label: 'Text size', hue: '#b06ef8', turnLabel: 'Bigger / smaller', pressLabel: 'Reset size',
      desc: 'Turn: talent text size. Press: back to the default size.',
      readout: function (s) { return s.prompter ? String(Math.round(s.prompter.size || 0)) : '-'; }, bar: function (s) { return s.prompter ? Math.min(1, (s.prompter.size || 0) / 120) : 0; },
      tick: function (d) { surfacePrompter(d > 0 ? 'size_up' : 'size_down'); }, press: function () { surfacePrompter('reset'); } },
    prompterScrub: { label: 'Prompter scrub', hue: '#22d3d3', turnLabel: 'Scrub the script', pressLabel: 'Cue to live row',
      desc: 'Turn: glide the prompter anywhere in the script, like a scrub wheel on a video editor. Press: snap it to the current live row.',
      readout: function () { return pct(jogAccum); }, bar: function () { return jogAccum; },
      tick: jogTick, press: function () { surfaceRun('prompter.cue.current'); } },
    rundownSelect: { label: 'Rundown row', hue: '#5b8df8', turnLabel: 'Pick a row', pressLabel: 'Take that row',
      desc: 'Turn: move the selection up and down the rundown. Press: make the selected row the live row.',
      readout: function (s) { return s.live ? ((s.live.selectedIndex + 1) + '/' + s.live.rowCount) : '-'; }, bar: function (s) { return s.live && s.live.rowCount ? (s.live.selectedIndex + 1) / s.live.rowCount : 0; },
      tick: rundownTick, press: function () { rundownTake(); } },
    showClock: { label: 'Show clock', hue: '#f5b731', turnLabel: 'Nothing (display)', pressLabel: 'Start / pause',
      desc: 'A clock face on the strip. Press the dial (or tap the zone) to start or pause the shared show clock. Turning does nothing on purpose.',
      readout: function (s) { return fmtClock(s.clock && s.clock.elapsed); }, bar: function (s) { return s.clock && s.clock.running ? 1 : 0; }, live: function (s) { return !!(s.clock && s.clock.running); },
      tick: function () {}, press: function () { var b = bridge(); try { b && b.showClock && b.showClock('toggle'); } catch (e) {} } },
    brightness: { label: 'Deck light', hue: '#f5b731', turnLabel: 'Brighter / dimmer', pressLabel: 'Reset to 80%',
      desc: 'Turn: the physical deck backlight. Press: back to the default brightness.',
      readout: function () { return pct(brightness / 100); }, bar: function () { return brightness / 100; },
      tick: function (d) { setBrightness(brightness + d * 5); }, press: function () { setBrightness(80); } }
  };
  var DEFAULT_DIALS = ['master', 'prompterSpeed', 'prompterSize', 'prompterScrub', 'rundownSelect', 'showClock'];
  function fmtClock(secs) { secs = Math.max(0, Math.round(secs || 0)); var m = Math.floor(secs / 60), s = secs % 60; return m + ':' + (s < 10 ? '0' : '') + s; }

  // Curated default layouts per deck size, so ANY Stream Deck gets a sensible
  // out-of-the-box surface: a Mini gets the survival kit, a classic 15 gets a
  // show-runner page, the XL family gets the full spread.
  var DEFAULT_LAYOUTS = {
    6:  ['km:playout.go', 'km:playout.stop', 'km:playout.panic', 'km:rundown.next', 'talk.a', 'clock'],
    8:  ['km:playout.go', 'km:playout.stop', 'km:playout.panic', 'km:rundown.next', 'km:rundown.back', 'talk.a', 'talk.b', 'clock'],
    15: ['km:playout.go', 'km:playout.pause', 'km:playout.stop', 'km:playout.panic', 'km:rundown.next',
         'km:prompter.playpause', 'km:prompter.top', 'km:prompter.cue.current', 'km:rundown.back', 'golive',
         'pad:1', 'pad:2', 'talk.a', 'talk.b', 'clock'],
    32: ['km:playout.go', 'km:playout.pause', 'km:playout.stop', 'km:playout.fade', 'km:playout.panic', 'km:rundown.next', 'km:rundown.back', 'golive',
         'km:prompter.playpause', 'km:prompter.top', 'km:prompter.size.up', 'km:prompter.size.down', 'km:prompter.speed.up', 'km:prompter.speed.down', 'km:prompter.cue.current', 'km:prompter.mirror',
         'pad:1', 'pad:2', 'pad:3', 'pad:4', 'km:prompter.brake', 'km:prompter.boost', 'obs.scene:1', 'obs.scene:2',
         'talk.a', 'talk.b', 'talk.off', 'clock.start', 'clock.pause', 'obs.stream', 'obs.record', 'layout.next'],
    36: ['km:playout.go', 'km:playout.pause', 'km:playout.stop', 'km:playout.fade', 'km:playout.panic', 'km:rundown.next', 'km:rundown.back', 'golive', 'km:prompter.cue.current',
         'km:prompter.playpause', 'km:prompter.top', 'km:prompter.size.up', 'km:prompter.size.down', 'km:prompter.speed.up', 'km:prompter.speed.down', 'km:prompter.dir.fwd', 'km:prompter.dir.rev', 'km:prompter.mirror',
         'pad:1', 'pad:2', 'pad:3', 'pad:4', 'km:prompter.brake', 'km:prompter.boost', 'obs.scene:1', 'obs.scene:2', 'obs.scene:3',
         'talk.a', 'talk.b', 'talk.off', 'clock.start', 'clock.pause', 'clock.resume', 'obs.stream', 'obs.record', 'layout.next']
  };
  function defaultKeySlots(keys) {
    var sizes = Object.keys(DEFAULT_LAYOUTS).map(Number).sort(function (a, b) { return a - b; });
    var best = sizes[0];
    sizes.forEach(function (n) { if (n <= keys) best = n; });
    var L = DEFAULT_LAYOUTS[best];
    var out = []; for (var i = 0; i < keys; i++) out.push({ a: L[i] || 'none' }); return out;
  }
  function defaultTouch(zones) { var out = []; for (var i = 0; i < zones; i++) out.push({ dial: i }); return out; }

  // ── Module state ────────────────────────────────────────────────────────────
  var device = null, profile = null;
  var overrides = {};                 // device geometry (Connect & Learn), per productId
  var profiles = {};                  // id -> { name, keys:[slot], dials:[id], touch:[{dial}] }
  var activeProfileId = '';           // selected profile
  var defaultProfileId = '';          // auto-selected on connect
  function mapping() { return profiles[activeProfileId] || { keys: [], dials: [], touch: [] }; }

  var keyState = [], dialPress = [], lastPainted = [], lastStripSig = '';
  var brightness = 80, paintTimer = null, jogAccum = 0, muteMemory = null;
  var learnArmed = false, editingKey = -1;
  var mode = 'local';

  var tbSocket = null, tbUrlIndex = 0, tbReconnect = null;
  var talkbackState = { A: false, B: false, connected: false };
  var talkbackHeld = { A: false, B: false };

  // ── Bridge accessors (defensive) ────────────────────────────────────────────
  function bridge() { return window.cueolaSurfaceBridge || null; }
  function surfaceKeymap() { var b = bridge(); try { return (b && b.keymap()) || []; } catch (e) { return []; } }
  function surfaceState() { var b = bridge(); var base = { session: { code: '', active: false }, playout: {}, prompter: null, clock: {}, live: null }; try { return (b && b.state()) || base; } catch (e) { return base; } }
  function surfaceRun(id) { var b = bridge(); try { b && b.runAction(id); } catch (e) {} }
  function surfacePrompter(a) { var b = bridge(); try { b && b.prompter(a); } catch (e) {} }
  function masterGain() { var b = bridge(); try { return (b && b.masterGain ? b.masterGain() : 0) || 0; } catch (e) { return 0; } }
  function setMaster(v) { var b = bridge(); try { b && b.setMasterGain && b.setMasterGain(Math.max(0, Math.min(1.2, v))); } catch (e) {} }
  function toggleMasterMute() { var g = masterGain(); if (g > 0.001) { muteMemory = g; setMaster(0); } else { setMaster(muteMemory != null ? muteMemory : 0.8); muteMemory = null; } }
  function jogTick(d) { jogAccum = Math.max(0, Math.min(1, jogAccum + d * 0.02)); surfacePrompter('seek_set_' + jogAccum.toFixed(2)); }
  function rundownTick(d) { var b = bridge(); if (!b) return; var s = surfaceState(); if (!s.live) return; var next = Math.max(0, Math.min((s.live.rowCount || 1) - 1, (s.live.selectedIndex || 0) + (d > 0 ? 1 : -1))); try { b.liveSelect(next, false); } catch (e) {} }
  function rundownTake() { var b = bridge(); var s = surfaceState(); if (b && s.live) { try { b.liveSelect(s.live.selectedIndex || 0, true); } catch (e) {} } }

  // ── Dispatch ────────────────────────────────────────────────────────────────
  function fireSlot(slot, phase) {
    if (typeof slot === 'string') slot = { a: slot };
    var a = catalog[slot.a];
    if (!a || a.kind === 'none') return;
    if (mode === 'cloud' && dispatchCloud(a, slot, phase)) return;
    switch (a.kind) {
      case 'keymap': if (a.hold) { var b = bridge(); try { phase === 'down' ? b.holdStart(a.keymapId) : b.holdStop(a.keymapId); } catch (e) {} } else if (phase === 'down') surfaceRun(a.keymapId); break;
      case 'pad': if (phase === 'down') firePlayoutSlot('pad', a.slot); break;
      case 'cue': if (phase === 'down') firePlayoutSlot('cue', a.slot); break;
      case 'padRef': if (phase === 'down' && slot.ref) firePlayoutRef('pad', slot.ref); break;
      case 'cueRef': if (phase === 'down' && slot.ref) firePlayoutRef('cue', slot.ref); break;
      case 'golive': if (phase === 'down') { var bb = bridge(); try { bb && bb.goLive && bb.goLive(); } catch (e) {} } break;
      case 'clock': if (phase === 'down') { var bc = bridge(); try { if (bc && bc.showClock) bc.showClock(a.verb || 'toggle'); else if (bc && bc.showClockToggle) bc.showClockToggle(); } catch (e) {} } break;
      case 'layoutNext': if (phase === 'down') cycleLayout(); break;
      case 'layoutRef': if (phase === 'down' && slot.ref) switchLayoutByName(slot.ref); break;
      case 'talkback': talkbackSet(a.bus, phase === 'down'); break;
      case 'talkbackPanic': if (phase === 'down') releaseTalkback(true); break;
      case 'obs': if (phase === 'down') obsDo(a.op); break;
      case 'obsScene': if (phase === 'down') obsSceneSlot(a.slot); break;
      case 'obsSceneRef': if (phase === 'down' && slot.ref) obsDo2('setScene', slot.ref); break;
      case 'obsMuteRef': if (phase === 'down' && slot.ref) obsDo2('toggleMute', slot.ref); break;
    }
  }
  function dispatchCloud() { return false; }
  function firePlayoutSlot(kind, slot) { var s = surfaceState(); var map = (kind === 'pad' ? (s.playout && s.playout.pads) : (s.playout && s.playout.cues)) || {}; var id = Object.keys(map)[slot - 1]; if (!id) { toast('No ' + (kind === 'pad' ? 'SFX pad' : 'cue') + ' in slot ' + slot + ' yet.'); return; } firePlayoutRef(kind, id); }
  function firePlayoutRef(kind, id) { var b = bridge(); if (!b) return; try { kind === 'pad' ? b.playoutPad(id) : b.playoutCue(id); } catch (e) {} }

  // ── OBS bridge accessors ────────────────────────────────────────────────────
  function OBSc() { return window.CueolaOBS; }
  function obsState() { var o = OBSc(); try { return (o && o.state()) || {}; } catch (e) { return {}; } }
  function obsDo(op) { var o = OBSc(); if (!o || !o.isReady || !o.isReady()) { toast('Connect OBS first (bottom of the setup panel).'); return; } try { o[op] && o[op](); } catch (e) {} }
  function obsDo2(op, arg) { var o = OBSc(); if (!o || !o.isReady || !o.isReady()) { toast('Connect OBS first.'); return; } try { o[op] && o[op](arg); } catch (e) {} }
  function obsSceneSlot(slot) { var st = obsState(), name = (st.scenes || [])[slot - 1]; if (name) obsDo2('setScene', name); else toast('No OBS scene in slot ' + slot + '.'); }
  var obsWasReady = false;
  function onObsChange() {
    var now = !!(OBSc() && OBSc().isReady());
    if (now !== obsWasReady) { obsWasReady = now; if (document.getElementById('streamdeck') && document.getElementById('streamdeck').classList.contains('on')) render(); schedulePaint(); }
    else if (now) { updateObsScene(); updateLiveBadge(); schedulePaint(); }
  }
  function updateObsScene() { var el = document.querySelector('.sd-obs-scene'); if (el) el.textContent = obsState().currentScene || '(no scene)'; }
  function updateLiveBadge() { var el = document.getElementById('sd-livebadge'); if (!el) return; var o = obsState(), parts = []; if (o.streaming) parts.push('<span class="sd-lb sd-lb-live">LIVE</span>'); if (o.recording) parts.push('<span class="sd-lb sd-lb-rec">REC' + (o.recordPaused ? ' ❚❚' : '') + '</span>'); el.innerHTML = parts.join(''); }

  // ── Talkback ─────────────────────────────────────────────────────────────────
  function talkbackConnect() {
    if (tbSocket && (tbSocket.readyState === 0 || tbSocket.readyState === 1)) return;
    var url = TALKBACK_URLS[tbUrlIndex % TALKBACK_URLS.length], ws;
    try { ws = new WebSocket(url); } catch (e) { scheduleTalkbackReconnect(); return; }
    tbSocket = ws;
    ws.onopen = function () { talkbackState.connected = true; try { ws.send('state?'); } catch (e) {} renderStatus(); };
    ws.onmessage = function (evt) { var m; try { m = JSON.parse(evt.data); } catch (e) { return; } if (m && m.type === 'state') { talkbackState.A = !!m.talkA; talkbackState.B = !!m.talkB; schedulePaint(); renderStatus(); } };
    ws.onclose = function () { talkbackState.connected = false; talkbackState.A = false; talkbackState.B = false; talkbackHeld.A = false; talkbackHeld.B = false; tbUrlIndex++; scheduleTalkbackReconnect(); schedulePaint(); renderStatus(); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  function scheduleTalkbackReconnect() { clearTimeout(tbReconnect); tbReconnect = setTimeout(talkbackConnect, 2000); }
  function talkbackSend(cmd) { if (tbSocket && tbSocket.readyState === 1) { try { tbSocket.send(cmd); return true; } catch (e) {} } return false; }
  function talkbackSet(bus, on) { talkbackHeld[bus] = on; if (!talkbackSend(bus + (on ? ' on' : ' off')) && on) toast('Talkback daemon not running (start talkbackd).'); }
  function releaseTalkback(force) { ['A', 'B'].forEach(function (bus) { if (talkbackHeld[bus] || (force && talkbackState[bus])) { talkbackHeld[bus] = false; talkbackSend(bus + ' off'); } }); }

  // ── Device lifecycle ─────────────────────────────────────────────────────────
  function supportedFilter(d) { return d && d.vendorId === Device.ELGATO_VID; }
  async function connect() {
    if (!navigator.hid) { toast('WebHID needs Chrome or Edge. The control surface is Chromium only.'); return false; }
    var dev;
    try { var have = (await navigator.hid.getDevices()).filter(supportedFilter); dev = have[0]; if (!dev) { var picked = await navigator.hid.requestDevice({ filters: [{ vendorId: Device.ELGATO_VID }] }); dev = picked && picked[0]; } }
    catch (e) { toast('Stream Deck selection cancelled.'); return false; }
    if (!dev) { toast('No Stream Deck selected. Quit the Elgato app first, then Connect.'); return false; }
    return openDevice(dev);
  }
  async function openDevice(dev) {
    try { if (!dev.opened) await dev.open(); } catch (e) { toast('Could not open the Stream Deck. Quit the Elgato Stream Deck app (it grabs the device), then Connect again.'); return false; }
    var config = loadConfig(dev.productId);
    var unitInfo = {};
    try { var fr = await dev.receiveFeatureReport(0x08); unitInfo = Device.parseUnitInfo(fr && fr.buffer ? new Uint8Array(fr.buffer) : fr) || {}; } catch (e) {}
    profile = Device.makeProfile(dev.productId, { unitInfo: unitInfo, overrides: config.overrides });
    device = { hid: dev, profile: profile, unitInfo: unitInfo };
    keyState = new Array(profile.keys).fill(false);
    dialPress = new Array(profile.dials).fill(false);
    lastPainted = new Array(profile.keys).fill(null);
    lastStripSig = '';
    registerLabelModel(profile);
    ensureProfilesShape();
    dev.oninputreport = onInputReport;
    try { navigator.hid.addEventListener('disconnect', onDisconnect); } catch (e) {}
    sendFeature(Device.resetReport(profile));
    setBrightness(brightness);
    render();
    startPaintLoop();
    connectLightShow().then(function () { return paintAll(); });
    toast('Connected: ' + profile.name + ' (' + profile.keys + ' keys, ' + profile.dials + ' dials).');
    return true;
  }
  // Hello, deck: a rainbow sweep rolls diagonally across the physical keys the
  // moment it connects, then the layout settles in. Pure fun, but also a full
  // pixel test of every key. Skipped under prefers-reduced-motion.
  async function connectLightShow() {
    if (!device || !profile) return;
    try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) {}
    var renderer = getRenderer();
    if (!renderer) return;
    var target = device;
    var order = [];
    for (var i = 0; i < profile.keys; i++) order.push(i);
    order.sort(function (a, b) { return ((a % profile.cols) + Math.floor(a / profile.cols)) - ((b % profile.cols) + Math.floor(b / profile.cols)); });
    for (var k = 0; k < order.length; k++) {
      if (device !== target) return;                       // unplugged mid-show
      var idx = order[k];
      var hue = Math.round(((idx % profile.cols) + Math.floor(idx / profile.cols)) / (profile.cols + profile.rows) * 300);
      try {
        var rendered = await renderer.renderKeyImage(profile.productId, idx, { text: '', backgroundColor: 'hsl(' + hue + ', 80%, 42%)' });
        var packets = Device.keyImagePackets(profile, idx, rendered.bytes);
        for (var pk = 0; pk < packets.length; pk++) { if (device !== target) return; await target.hid.sendReport(packets[pk].reportId, packets[pk].data); }
      } catch (e) { return; }
    }
    lastPainted = new Array(profile.keys).fill('wave');    // force the real layout to repaint over it
  }

  function onDisconnect(e) { if (!device) return; if (e && e.device && e.device !== device.hid) return; teardownDevice(); toast('Stream Deck disconnected.'); render(); }
  function disconnect() { if (device && device.hid) { try { sendFeature(Device.resetReport(profile)); } catch (e) {} try { device.hid.close(); } catch (e) {} } teardownDevice(); render(); }
  function teardownDevice() { stopPaintLoop(); device = null; profile = null; keyState = []; dialPress = []; }

  function onInputReport(e) {
    if (!device) return;
    var data = new Uint8Array(e.data.buffer);
    var evt = Device.parseInputReport(e.reportId, data, profile);
    if (evt.type === 'keys') {
      var edges = Device.keyEdges(keyState, evt.states);
      keyState = evt.states;
      edges.downs.forEach(function (i) { if (learnArmed) { openKeyEditor(i, true); } else { fireSlot(mapping().keys[i], 'down'); } });
      edges.ups.forEach(function (i) { if (!learnArmed) fireSlot(mapping().keys[i], 'up'); });
      if (edges.downs.length || edges.ups.length) schedulePaint();
    } else if (evt.type === 'dials') {
      if (evt.kind === 'rotate') evt.ticks.forEach(function (t, i) { if (t) { if (learnArmed) { openDialEditor(i, true); } else dialTick(i, t); } });
      else evt.press.forEach(function (down, i) { if (down !== dialPress[i]) { dialPress[i] = down; if (down && !learnArmed) dialPressFire(i); } });
      schedulePaint();
    } else if (evt.type === 'touch') { touchFire(evt); }
  }
  function controllerForDial(i) { return DIAL_CONTROLLERS[mapping().dials[i]]; }
  function dialTick(i, ticks) { var c = controllerForDial(i); if (c) { try { c.tick(ticks); } catch (e) {} } }
  function dialPressFire(i) { var c = controllerForDial(i); if (c) { try { c.press(); } catch (e) {} } }
  function touchFire(evt) { if (evt.zone == null) return; var z = (mapping().touch[evt.zone]) || { dial: evt.zone }; var c = DIAL_CONTROLLERS[mapping().dials[z.dial]]; if (c && evt.gesture !== 'flick') { try { c.press(); } catch (e) {} } else if (c && evt.gesture === 'flick') { try { c.tick(evt.x2 > evt.x ? 3 : -3); } catch (e) {} } }

  // ── Slot rendering helpers ────────────────────────────────────────────────
  function slotAt(i) { var s = mapping().keys[i]; return (typeof s === 'string') ? { a: s } : (s || { a: 'none' }); }
  function slotAction(slot) { return catalog[slot.a] || catalog.none; }
  function slotColor(slot) { return slot.color || slotAction(slot).color || '#1a1f27'; }
  function slotLabel(slot, s) {
    if (slot.label != null && slot.label !== '') return slot.label;
    var a = slotAction(slot);
    if ((a.kind === 'padRef' || a.kind === 'cueRef' || a.kind === 'obsSceneRef' || a.kind === 'obsMuteRef') && slot.refName) return slot.refName;
    if (a.kind === 'pad' || a.kind === 'cue') {
      var map = (a.kind === 'pad' ? (s.playout && s.playout.pads) : (s.playout && s.playout.cues)) || {};
      var id = Object.keys(map)[a.slot - 1];
      if (id && map[id]) return (a.kind === 'cue' ? '#' + (map[id].num || a.slot) + '\n' : '') + (map[id].name || a.label);
      return a.label;
    }
    return a.label;
  }
  function slotActive(slot, s) { var a = slotAction(slot); return !!(a.lamp && a.lamp(s, slot)); }

  // ── Painting ──────────────────────────────────────────────────────────────
  // The label module is a factory: it needs a canvas source and a JPEG encoder
  // injected (same pattern Outrangutan uses). Built once, lazily.
  var labelRenderer = null;
  function getRenderer() {
    if (labelRenderer) return labelRenderer;
    var L = window.CueolaStreamDeckLabel;
    if (!L || typeof L.createRenderer !== 'function') return null;
    try {
      labelRenderer = L.createRenderer({
        createCanvas: function (w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; },
        encode: function (canvas, opts) { return new Promise(function (res, rej) { canvas.toBlob(function (b) { b ? res(b) : rej(new Error('JPEG encode failed')); }, opts.type, opts.quality); }); }
      });
    } catch (e) { return null; }
    return labelRenderer;
  }
  function startPaintLoop() { stopPaintLoop(); paintTimer = setInterval(paintTick, Math.round(1000 / PAINT_HZ)); }
  function stopPaintLoop() { if (paintTimer) clearInterval(paintTimer); paintTimer = null; }
  var paintScheduled = false;
  function schedulePaint() { paintScheduled = true; }
  function paintTick() {
    if (paintScheduled) { paintScheduled = false; paintChanged(); }
    refreshDialReadouts();   // keep the on-screen dial values live, not render-stale
  }
  function refreshDialReadouts() {
    var r = root(); if (!r || !profile || !profile.dials) return;
    var s = surfaceState();
    r.querySelectorAll('.sd-dial').forEach(function (el) {
      var c = DIAL_CONTROLLERS[mapping().dials[+el.getAttribute('data-dial')]];
      var knob = el.querySelector('.sd-dial-knob');
      if (c && knob) { var v = String(c.readout(s)); if (knob.textContent !== v) knob.textContent = v; }
    });
  }
  function keySignature(i, s) { var slot = slotAt(i); var active = slotActive(slot, s) || keyState[i] || (i === editingKey); return active + '|' + slotLabel(slot, s) + '|' + slotColor(slot) + '|' + (slot.icon || ''); }
  async function paintAll() { lastPainted = new Array(profile ? profile.keys : 0).fill(null); await paintChanged(); await paintStrip(true); }
  async function paintChanged() {
    if (!device || !profile) return;
    var s = surfaceState();
    for (var i = 0; i < profile.keys; i++) { var sig = keySignature(i, s); if (sig === lastPainted[i]) continue; lastPainted[i] = sig; await paintKey(i, s); }
    await paintStrip(false);
  }
  async function paintKey(i, s) {
    var renderer = getRenderer();
    if (!renderer || !device) return;
    var slot = slotAt(i);
    var active = !!(slotActive(slot, s) || keyState[i] || (i === editingKey));
    try {
      var rendered = await renderer.renderKeyImage(profile.productId, i, { text: slotLabel(slot, s), icon: slot.icon || '', active: active, backgroundColor: slotColor(slot), accentColor: '#8ff7bc', maxLines: 3 });
      var packets = Device.keyImagePackets(profile, i, rendered.bytes);
      for (var pk = 0; pk < packets.length; pk++) { if (!device) return; await device.hid.sendReport(packets[pk].reportId, packets[pk].data); }
    } catch (e) {}
  }
  async function paintStrip(force) {
    if (!device || !profile || !profile.strip) return;
    var s = surfaceState(), cells = [];
    for (var z = 0; z < profile.strip.zones; z++) {
      var dialId = mapping().dials[(mapping().touch[z] || { dial: z }).dial];
      var c = DIAL_CONTROLLERS[dialId];
      cells.push({
        title: c ? c.label : '', value: c ? String(c.readout(s)) : '', tap: c ? c.pressLabel : '',
        hue: (c && c.hue) || '#5b8df8',
        bar: c && c.bar ? Math.max(0, Math.min(1, c.bar(s) || 0)) : null,
        live: !!(c && c.live && c.live(s))
      });
    }
    var sig = JSON.stringify(cells); if (!force && sig === lastStripSig) return; lastStripSig = sig;
    try { var bytes = await renderStripJpeg(cells); if (!bytes) return; var packets = Device.stripImagePackets(profile, bytes); for (var pk = 0; pk < packets.length; pk++) { if (!device) return; await device.hid.sendReport(packets[pk].reportId, packets[pk].data); } } catch (e) {}
  }
  // The strip is a glanceable dashboard: one zone per dial. Accent line in the
  // dial's hue, the big value in tabular digits, a progress bar for continuous
  // things, a breathing dot when its thing is running, and the press action in
  // small type so nobody has to remember what a tap does.
  async function renderStripJpeg(cells) {
    var w = profile.strip.w, h = profile.strip.h;
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d'); if (!ctx) return null;
    ctx.fillStyle = '#07090d'; ctx.fillRect(0, 0, w, h);
    var zw = w / cells.length;
    cells.forEach(function (cell, i) {
      var x0 = i * zw, x = x0 + zw / 2;
      // zone plate with a faint hue wash so zones read as separate touch targets
      var grad = ctx.createLinearGradient(x0, 0, x0, h);
      grad.addColorStop(0, 'rgba(255,255,255,0.05)'); grad.addColorStop(1, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = grad; ctx.fillRect(x0 + 3, 3, zw - 6, h - 6);
      ctx.fillStyle = cell.hue; ctx.fillRect(x0 + 10, 4, zw - 20, 3);       // accent line
      if (cell.live) { ctx.beginPath(); ctx.arc(x0 + zw - 14, 16, 5, 0, Math.PI * 2); ctx.fill(); }
      ctx.textAlign = 'center';
      ctx.fillStyle = '#98a2b8'; ctx.font = '600 14px -apple-system, "Segoe UI", sans-serif';
      ctx.fillText(cell.title.toUpperCase(), x, 25);
      ctx.fillStyle = '#ffffff'; ctx.font = '700 36px ui-monospace, "SF Mono", Menlo, monospace';
      ctx.fillText(cell.value, x, 63);
      if (cell.bar != null) {
        var bw = zw - 28, bx = x0 + 14, by = h - 26;
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(bx, by, bw, 5);
        ctx.fillStyle = cell.hue; ctx.fillRect(bx, by, Math.round(bw * cell.bar), 5);
      }
      ctx.fillStyle = '#6b7690'; ctx.font = '600 11px -apple-system, "Segoe UI", sans-serif';
      ctx.fillText('tap: ' + cell.tap, x, h - 8);
    });
    var blob = await new Promise(function (res) { cv.toBlob(res, 'image/jpeg', 0.85); });
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }
  function sendFeature(rep) { if (device) { try { device.hid.sendFeatureReport(rep.reportId, rep.data); } catch (e) {} } }
  function setBrightness(pctVal) {
    brightness = Math.max(0, Math.min(100, Math.round(pctVal)));
    try { localStorage.setItem(BRIGHTNESS_KEY, String(brightness)); } catch (e) {}
    if (device && profile) sendFeature(Device.brightnessReport(profile, brightness));
    var el = document.getElementById('sd-bright'); if (el && el.value != brightness) el.value = brightness;
    var lbl = document.getElementById('sd-bright-val'); if (lbl) lbl.textContent = brightness + '%';
  }
  function registerLabelModel(prof) {
    var r = window.CueolaStreamDeckLabel; if (!r || typeof r.registerModel !== 'function') return;
    try { r.registerModel({ productId: prof.productId, name: prof.name, keys: prof.keys, columns: prof.cols, imageWidth: prof.keyPx, imageHeight: prof.keyPx, imageType: 'image/jpeg', imageQuality: 0.9, deviceRotationDegrees: prof.rotation, inputStateOffset: prof.stateOffset, packet: { reportId: prof.keyImage.reportId, command: prof.keyImage.command, packetSize: prof.keyImage.packetSize, headerSize: prof.keyImage.headerSize, payloadSize: prof.keyImage.packetSize - prof.keyImage.headerSize } }); } catch (e) {}
  }

  // ── Profile config persistence ─────────────────────────────────────────────
  function readStore() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { return {}; } }
  function writeStore(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} }
  function loadConfig(pid) {
    var raw = readStore()[pid] || {};
    // Migrate the pre-profiles shape ({mapping, overrides}) into a Default profile.
    if (raw.mapping && !raw.profiles) {
      overrides = raw.overrides || {};
      profiles = { p1: { name: 'Default', keys: (raw.mapping.keys || []).map(toSlot), dials: raw.mapping.dials || DEFAULT_DIALS.slice(), touch: raw.mapping.touch || [] } };
      activeProfileId = 'p1'; defaultProfileId = 'p1';
    } else {
      overrides = raw.overrides || {};
      profiles = raw.profiles || {};
      Object.keys(profiles).forEach(function (id) { profiles[id].keys = (profiles[id].keys || []).map(toSlot); });
      activeProfileId = raw.activeProfile && profiles[raw.activeProfile] ? raw.activeProfile : Object.keys(profiles)[0] || '';
      defaultProfileId = raw.defaultProfile && profiles[raw.defaultProfile] ? raw.defaultProfile : activeProfileId;
      activeProfileId = defaultProfileId || activeProfileId;
    }
    return { overrides: overrides };
  }
  function toSlot(s) { return (typeof s === 'string') ? { a: s } : (s && typeof s === 'object' ? s : { a: 'none' }); }
  function persist() { if (!profile) return; var s = readStore(); s[profile.productId] = { overrides: overrides, profiles: profiles, activeProfile: activeProfileId, defaultProfile: defaultProfileId }; writeStore(s); }
  function newId() { var n = 1; while (profiles['p' + n]) n++; return 'p' + n; }
  function uniqueName(base) { var name = base || 'Profile', names = Object.keys(profiles).map(function (id) { return profiles[id].name; }), n = name, i = 2; while (names.indexOf(n) >= 0) n = name + ' ' + (i++); return n; }
  // Make every profile fit the connected device (pad/truncate keys, dials, touch).
  function ensureProfilesShape() {
    if (!Object.keys(profiles).length) { profiles = { p1: { name: 'Default', keys: defaultKeySlots(profile.keys), dials: DEFAULT_DIALS.slice(0, profile.dials), touch: defaultTouch(profile.strip ? profile.strip.zones : 0) } }; activeProfileId = 'p1'; defaultProfileId = 'p1'; }
    Object.keys(profiles).forEach(function (id) {
      var p = profiles[id], def = defaultKeySlots(profile.keys);
      p.keys = p.keys && p.keys.length ? p.keys.slice(0, profile.keys) : def;
      while (p.keys.length < profile.keys) p.keys.push({ a: 'none' });
      p.dials = (p.dials && p.dials.length ? p.dials : DEFAULT_DIALS).slice(0, profile.dials)
        .map(function (id) { return id === 'prompterJog' ? 'prompterScrub' : id; });   // pre-rename profiles migrate
      while (p.dials.length < profile.dials) p.dials.push(DEFAULT_DIALS[p.dials.length] || 'brightness');
      var zones = profile.strip ? profile.strip.zones : 0;
      p.touch = (p.touch && p.touch.length ? p.touch : defaultTouch(zones)).slice(0, zones);
    });
    if (!profiles[activeProfileId]) activeProfileId = Object.keys(profiles)[0];
    persist();
  }
  function switchProfile(id) { if (!profiles[id]) return; activeProfileId = id; persist(); render(); paintAll(); }
  // Page keys: hop between saved layouts straight from the deck.
  function cycleLayout() { var ids = Object.keys(profiles); if (ids.length < 2) { toast('Only one layout saved. Add more to page between them.'); return; } var next = ids[(ids.indexOf(activeProfileId) + 1) % ids.length]; switchProfile(next); toast('Layout: ' + profiles[next].name); }
  function switchLayoutByName(name) { var id = Object.keys(profiles).find(function (k) { return profiles[k].name === name; }); if (id) { switchProfile(id); toast('Layout: ' + name); } else toast('No layout named "' + name + '".'); }
  function addProfile(name, keys, dials, touch) { var id = newId(); profiles[id] = { name: uniqueName(name || 'Profile'), keys: keys || defaultKeySlots(profile.keys), dials: dials || DEFAULT_DIALS.slice(0, profile.dials), touch: touch || defaultTouch(profile.strip ? profile.strip.zones : 0) }; activeProfileId = id; ensureProfilesShape(); render(); paintAll(); return id; }
  function duplicateActive() { var p = mapping(); addProfile(p.name + ' copy', JSON.parse(JSON.stringify(p.keys)), p.dials.slice(), JSON.parse(JSON.stringify(p.touch))); }
  function renameActive(name) { if (name) { mapping().name = uniqueName(name); persist(); render(); } }
  function deleteActive() { if (Object.keys(profiles).length <= 1) { toast('Keep at least one profile.'); return; } delete profiles[activeProfileId]; if (defaultProfileId === activeProfileId) defaultProfileId = Object.keys(profiles)[0]; activeProfileId = Object.keys(profiles)[0]; persist(); render(); paintAll(); }
  function setDefaultActive() { defaultProfileId = activeProfileId; persist(); render(); toast('"' + mapping().name + '" is the default layout for this deck.'); }
  function resetActive() { mapping().keys = defaultKeySlots(profile.keys); mapping().dials = DEFAULT_DIALS.slice(0, profile.dials); mapping().touch = defaultTouch(profile.strip ? profile.strip.zones : 0); persist(); render(); paintAll(); }

  // ── Import / export ─────────────────────────────────────────────────────────
  function slug(s) { return String(s || 'layout').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'layout'; }
  function exportActive() {
    var p = mapping();
    var data = { cueolaDeck: 1, name: p.name, keys: p.keys, dials: p.dials, touch: p.touch };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'cueola-deck-' + slug(p.name) + '.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Exported "' + p.name + '".');
  }
  function importFile(file) {
    if (!file) return;
    var r = new FileReader();
    r.onload = function () {
      var d; try { d = JSON.parse(r.result); } catch (e) { toast('Could not read that layout file.'); return; }
      if (!d || !Array.isArray(d.keys)) { toast('That file is not a Cueola deck layout.'); return; }
      addProfile(d.name || 'Imported', d.keys.map(toSlot), Array.isArray(d.dials) ? d.dials : null, Array.isArray(d.touch) ? d.touch : null);
      toast('Imported layout "' + mapping().name + '".');
    };
    r.readAsText(file);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  function pct(v) { return Math.round((v || 0) * 100) + '%'; }
  function toast(msg) {
    if (typeof window.toast === 'function' && window.toast !== toast) { try { window.toast(msg); return; } catch (e) {} }
    var el = document.getElementById('sd-toast'); if (el) { el.textContent = msg; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove('on'); }, 3200); }
  }

  // ── Setup UI ──────────────────────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function root() { return document.getElementById('sd-surface-root'); }

  function render() {
    var r = root(); if (!r) return;
    if (!navigator.hid) { r.innerHTML = '<div class="sd-empty">KeyWi needs Chrome or Edge (WebHID). Open Cueola there to connect a Stream Deck.</div>'; return; }
    r.innerHTML = statusBar() + (device ? profileBar() + obsBar() + toolsRow() + surfaceGrid() + learnPanel() : connectHelp());
    wire(); renderStatus(); updateLiveBadge();
  }
  function statusBar() {
    var s = surfaceState();
    return '<div class="sd-status">'
      + statusChip('Device', device ? profile.name : 'Not connected', device ? 'ok' : 'off')
      + statusChip('Talkback', talkbackState.connected ? 'Daemon connected' : 'Not running', talkbackState.connected ? 'ok' : 'off')
      + statusChip('Session', s.session && s.session.code ? s.session.code : 'None', s.session && s.session.code ? 'ok' : 'off')
      + '<div class="sd-status-actions">'
      + (device ? '<button class="btn-secondary" id="sd-disconnect">Disconnect</button>' : '<button class="btn-primary" id="sd-connect">Connect deck</button>')
      + '<button class="btn-secondary" id="sd-talkoff">All talk off</button></div></div>';
  }
  function statusChip(label, value, cls) { return '<div class="sd-chip sd-chip-' + cls + '"><span class="sd-chip-l">' + esc(label) + '</span><span class="sd-chip-v">' + esc(value) + '</span></div>'; }
  // First-run setup: a guided stepper. Step 1 is required; talkback and OBS are
  // optional companions with live status dots so it is obvious what is ready.
  function connectHelp() {
    var tbOn = talkbackState.connected, obsOn = !!(OBSc() && OBSc().isReady && OBSc().isReady());
    return '<div class="sd-setup">'
      + '<div class="sd-setup-head"><h3>Set up your deck</h3><p>Any Stream Deck works: Mini, MK.2, XL, +, or the + XL. KeyWi reads the model and lays out a sensible starting page for its size, then everything is yours to remap.</p></div>'
      + stepRow(1, false, 'Connect the deck', 'Plug it in over USB and <b>quit the Elgato Stream Deck app</b> (it holds the hardware and blocks the browser). Then hit Connect and pick it from the list. Expect a little light show.', '<button class="btn-primary" id="sd-connect2">Connect deck</button>')
      + stepRow(2, tbOn, 'Talkback (optional)', tbOn ? 'Daemon connected. TALK A and TALK B are live, hold to talk.' : 'For TALK A / TALK B keys, start the talkbackd daemon on this machine. KeyWi finds it by itself and this dot turns green.', '')
      + stepRow(3, obsOn, 'OBS (optional)', obsOn ? 'OBS connected. Stream, record, and scene keys are live.' : 'For stream, record, and scene keys: in OBS enable Tools &rsaquo; WebSocket Server Settings, then connect below once the deck is on.', '')
      + '<div class="sd-setup-foot">Everything runs from this tab. Keep Cueola open here while you run the show.</div>'
      + '</div>';
  }
  function stepRow(n, done, title, body, action) {
    return '<div class="sd-step' + (done ? ' done' : '') + '"><div class="sd-step-dot">' + (done ? '✓' : n) + '</div>'
      + '<div class="sd-step-body"><div class="sd-step-t">' + title + '</div><div class="sd-step-d">' + body + '</div>' + action + '</div></div>';
  }
  function profileBar() {
    var opts = Object.keys(profiles).map(function (id) { return '<option value="' + id + '"' + (id === activeProfileId ? ' selected' : '') + '>' + esc(profiles[id].name) + (id === defaultProfileId ? ' (default)' : '') + '</option>'; }).join('');
    return '<div class="sd-profiles">'
      + '<label class="sd-pf-lbl">Layout</label><select id="sd-profile">' + opts + '</select>'
      + '<button class="sd-mini" id="sd-pf-new" title="New layout">New</button>'
      + '<button class="sd-mini" id="sd-pf-dup" title="Duplicate">Duplicate</button>'
      + '<button class="sd-mini" id="sd-pf-ren" title="Rename">Rename</button>'
      + '<button class="sd-mini" id="sd-pf-def" title="Use as default on connect">Set default</button>'
      + '<button class="sd-mini danger" id="sd-pf-del" title="Delete layout">Delete</button>'
      + '<span class="sd-pf-sp"></span>'
      + '<button class="sd-mini" id="sd-pf-exp" title="Export to a file">Export</button>'
      + '<button class="sd-mini" id="sd-pf-imp" title="Import from a file">Import</button>'
      + '<input type="file" id="sd-pf-file" accept="application/json,.json" hidden></div>';
  }
  function toolsRow() {
    return '<div class="sd-bright-row">'
      + '<button class="btn-secondary' + (learnArmed ? ' sd-armed' : '') + '" id="sd-learn">' + (learnArmed ? 'Press a control to map it…' : 'Live learn') + '</button>'
      + '<label>Deck brightness</label><input type="range" id="sd-bright" min="0" max="100" value="' + brightness + '"><span id="sd-bright-val">' + brightness + '%</span>'
      + '<button class="btn-secondary" id="sd-test">Test pattern</button><button class="btn-secondary" id="sd-reset">Reset this layout</button></div>';
  }
  function obsBar() {
    var o = OBSc(), ready = !!(o && o.isReady && o.isReady()), cfg = (o && o.config && o.config()) || { url: 'ws://localhost:4455', password: '' }, st = obsState(), err = (o && o.lastError && o.lastError()) || '';
    return '<div class="sd-obs">'
      + '<span class="sd-obs-dot' + (ready ? ' on' : '') + '"></span><span class="sd-obs-lbl">OBS</span>'
      + (ready
        ? '<span class="sd-obs-scene" title="Current program scene">' + esc(st.currentScene || '(no scene)') + '</span>'
          + (st.streaming ? '<span class="sd-obs-tag live">LIVE</span>' : '') + (st.recording ? '<span class="sd-obs-tag rec">REC</span>' : '')
          + '<span class="sd-pf-sp"></span><button class="sd-mini" id="sd-obs-dis">Disconnect OBS</button>'
        : '<input id="sd-obs-url" class="sd-obs-in" placeholder="ws://localhost:4455" value="' + esc(cfg.url) + '"><input id="sd-obs-pw" class="sd-obs-in" type="password" placeholder="password (if set)" value="' + esc(cfg.password || '') + '"><button class="sd-mini" id="sd-obs-con">Connect OBS</button>'
          + (err ? '<span class="sd-obs-err">' + esc(err) + '</span>' : ''))
      + '</div>';
  }
  function surfaceGrid() {
    var s = surfaceState();
    var html = '<div class="sd-sect-t">Keys <span class="sd-sect-hint">click a key to change what it does and how it looks</span></div>';
    html += '<div class="sd-keys" style="grid-template-columns:repeat(' + profile.cols + ',1fr)">';
    for (var i = 0; i < profile.keys; i++) {
      var slot = slotAt(i), a = slotAction(slot), active = !!(slotActive(slot, s) || keyState[i] || i === editingKey);
      var icon = slot.icon != null ? slot.icon : (a.icon || '');
      var tip = (a.full || a.label || 'blank') + (a.toggle ? ' · toggle' : '') + (a.hold ? ' · hold' : '') + (a.desc ? '. ' + a.desc : '');
      html += '<button class="sd-key' + (active ? ' on' : '') + (a.kind === 'none' ? ' blank' : '') + (i === editingKey ? ' editing' : '') + '" data-key="' + i + '" style="--kc:' + slotColor(slot) + '" title="' + esc(tip) + '" aria-label="' + esc('Key ' + (i + 1) + ': ' + (a.full || 'blank')) + '">'
        + (icon ? '<span class="sd-key-ic">' + esc(icon) + '</span>' : '') + '<span class="sd-key-lbl">' + esc(slotLabel(slot, s) || '') + '</span>'
        + (a.toggle ? '<span class="sd-key-tog' + (active ? ' on' : '') + '">' + (active ? 'ON' : 'OFF') + '</span>' : '') + '</button>';
    }
    html += '</div>';
    if (profile.dials) {
      html += '<div class="sd-sect-t">Dials <span class="sd-sect-hint">each shows what turning and pressing does · click to reassign</span></div>';
      html += '<div class="sd-dials">';
      for (var d = 0; d < profile.dials; d++) {
        var c = DIAL_CONTROLLERS[mapping().dials[d]] || {};
        html += '<div class="sd-dial" data-dial="' + d + '" title="' + esc(c.desc || '') + '" style="--dc:' + (c.hue || 'var(--accent)') + '">'
          + '<div class="sd-dial-knob">' + esc(c.readout ? String(c.readout(s)) : '') + '</div>'
          + '<div class="sd-dial-lbl">' + esc(c.label || 'unset') + '</div>'
          + '<div class="sd-dial-row"><span class="sd-dial-verb">turn</span>' + esc(c.turnLabel || '') + '</div>'
          + '<div class="sd-dial-row"><span class="sd-dial-verb">press</span>' + esc(c.pressLabel || '') + '</div>'
          + '</div>';
      }
      html += '</div>';
      if (profile.strip) html += '<div class="sd-strip-note"><span class="sf-symbol" data-symbol="state.info" aria-hidden="true"></span> The touch strip above the dials mirrors these six: accent bar, live value, and a progress bar. Tap a zone = press its dial. Flick left or right = a big turn.</div>';
    }
    html += legendCard();
    return html;
  }
  // "How KeyWi works": flat inspector-style rows, hairline-separated (no boxes
  // in boxes, per the design guidelines).
  function legendCard() {
    return '<details class="sd-legend"><summary>How KeyWi works</summary><div class="sd-legend-body">'
      + '<div class="sd-legend-row"><span class="sf-symbol" data-symbol="action.grid" aria-hidden="true"></span><div><b>Keys</b> press to fire the action printed on them. Keys with a glowing ring are ON (a toggle that is active, a cue that is playing, the scene on air). BRAKE, BOOST, TALK A and TALK B are hold keys: press and hold, release to stop.</div></div>'
      + '<div class="sd-legend-row"><span class="sf-symbol" data-symbol="action.settings" aria-hidden="true"></span><div><b>Dials</b> do two things each: turning adjusts the value, pressing the dial in fires its second action. Both are written on the dial card above.</div></div>'
      + '<div class="sd-legend-row"><span class="sf-symbol" data-symbol="content.display" aria-hidden="true"></span><div><b>Touch strip</b> is a live dashboard over the dials. Tap a zone to fire that dial’s press action; flick along it for a fast turn.</div></div>'
      + '<div class="sd-legend-row"><span class="sf-symbol" data-symbol="action.repeat" aria-hidden="true"></span><div><b>Layouts</b> are whole pages of key assignments. Save one per situation (rehearsal, live, OBS-heavy) and jump between them with a PAGE key, right from the deck.</div></div>'
      + '</div></details>';
  }
  function learnPanel() {
    var u = device.unitInfo || {};
    return '<details class="sd-learn"><summary>Connect &amp; Learn (device details)</summary><div class="sd-learn-body">'
      + '<p class="sd-note">The Stream Deck + XL is new enough that its exact USB profile is confirmed here from your actual unit. Adjust only if the test pattern looks wrong.</p>'
      + '<div class="sd-learn-grid">'
      + learnField('Product id', '0x' + profile.productId.toString(16)) + learnField('Keys', profile.keys + (u.keys ? ' (device says ' + u.keys + ')' : '')) + learnField('Columns', profile.cols)
      + learnField('Key pixels', profile.keyPx) + learnField('Dials', profile.dials) + learnField('Strip', profile.strip ? (profile.strip.w + '×' + profile.strip.h + ', ' + profile.strip.zones + ' zones') : 'none') + '</div>'
      + '<div class="sd-learn-tune"><label><input type="checkbox" id="sd-flip"' + (profile.rotation ? ' checked' : '') + '> Key images upside-down (flip 180°)</label>'
      + '<label>Columns <input type="number" id="sd-cols" min="3" max="12" value="' + profile.cols + '"></label>'
      + '<button class="btn-secondary" id="sd-relearn">Apply &amp; repaint</button></div></div></details>';
  }
  function learnField(k, v) { return '<div class="sd-lf"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>'; }
  function renderStatus() { var bar = document.querySelector('.sd-status'); if (!bar) return; var chips = bar.querySelectorAll('.sd-chip'); if (chips[1]) { chips[1].className = 'sd-chip sd-chip-' + (talkbackState.connected ? 'ok' : 'off'); chips[1].querySelector('.sd-chip-v').textContent = talkbackState.connected ? 'Daemon connected' : 'Not running'; } }

  // ── Key editor (action + cues-by-name + label + colour + icon) ─────────────
  function overlay() { return document.getElementById('sd-picker'); }
  function closeOverlay() { var o = overlay(); if (o) o.className = 'sd-picker'; if (editingKey >= 0) { editingKey = -1; schedulePaint(); render(); } }
  function openKeyEditor(index, fromLearn) {
    learnArmed = false; editingKey = index; schedulePaint();
    var slot = slotAt(index), s = surfaceState();
    var groups = {};
    Object.keys(catalog).forEach(function (id) { var a = catalog[id]; if (a.kind === 'padRef' || a.kind === 'cueRef') return; (groups[a.group] = groups[a.group] || []).push({ id: id, label: a.full || a.label || id }); });
    var curAction = slotAction(slot);
    var body = '<div class="sd-ed-head">Edit key ' + (index + 1) + (fromLearn ? ' <span class="sd-ed-learned">learned</span>' : '')
      + (curAction.toggle ? ' <span class="sd-ed-chip">TOGGLE</span>' : '') + (curAction.hold ? ' <span class="sd-ed-chip">HOLD</span>' : '') + '</div>';
    if (curAction.desc) body += '<div class="sd-ed-desc">' + esc(curAction.desc) + '</div>';
    body += '<div class="sd-ed-cols"><div class="sd-ed-actions"><div class="sd-ed-sub">Action</div>';
    Object.keys(groups).forEach(function (g) { body += '<div class="sd-picker-g">' + esc(g) + '</div>'; groups[g].forEach(function (o) { body += '<button class="sd-picker-opt' + (o.id === slot.a && !slot.ref ? ' cur' : '') + '" data-pick="' + esc(o.id) + '">' + esc(o.label || '(blank)') + '</button>'; }); });
    // This show: live cues + pads bound by name.
    var pads = (s.playout && s.playout.pads) || {}, cues = (s.playout && s.playout.cues) || {};
    if (Object.keys(pads).length || Object.keys(cues).length) {
      body += '<div class="sd-picker-g">This show</div>';
      Object.keys(cues).forEach(function (id) { body += '<button class="sd-picker-opt' + (slot.a === 'cueRef' && slot.ref === id ? ' cur' : '') + '" data-ref="cueRef" data-refid="' + esc(id) + '" data-refname="' + esc(cues[id].name || 'Cue') + '">CUE ' + esc((cues[id].num != null ? '#' + cues[id].num + ' ' : '') + (cues[id].name || '')) + '</button>'; });
      Object.keys(pads).forEach(function (id) { body += '<button class="sd-picker-opt' + (slot.a === 'padRef' && slot.ref === id ? ' cur' : '') + '" data-ref="padRef" data-refid="' + esc(id) + '" data-refname="' + esc(pads[id].name || 'Pad') + '">PAD ' + esc(pads[id].name || '') + '</button>'; });
    } else { body += '<div class="sd-picker-g">This show</div><div class="sd-note" style="padding:4px 2px">Load a show in Outrangutan to bind cues and pads by name.</div>'; }
    // This OBS: bind a specific scene or audio input by name from the live OBS.
    var obs = obsState();
    if (obs.connected && ((obs.scenes && obs.scenes.length) || (obs.inputs && obs.inputs.length))) {
      body += '<div class="sd-picker-g">This OBS</div>';
      (obs.scenes || []).forEach(function (name) { body += '<button class="sd-picker-opt' + (slot.a === 'obs.sceneRef' && slot.ref === name ? ' cur' : '') + '" data-ref="obs.sceneRef" data-refid="' + esc(name) + '" data-refname="' + esc(name) + '">SCENE ' + esc(name) + '</button>'; });
      (obs.inputs || []).forEach(function (name) { body += '<button class="sd-picker-opt' + (slot.a === 'obs.muteRef' && slot.ref === name ? ' cur' : '') + '" data-ref="obs.muteRef" data-refid="' + esc(name) + '" data-refname="' + esc(name) + '">MUTE ' + esc(name) + '</button>'; });
    } else if (OBSc() && OBSc().isReady && !OBSc().isReady()) { body += '<div class="sd-picker-g">This OBS</div><div class="sd-note" style="padding:4px 2px">Connect OBS to bind scenes and audio by name.</div>'; }
    body += '</div><div class="sd-ed-style"><div class="sd-ed-sub">Custom look</div>'
      + '<label class="sd-ed-f">Label<input id="sd-ed-label" placeholder="' + esc(slotAction(slot).label || 'default') + '" value="' + esc(slot.label || '') + '"></label>'
      + '<label class="sd-ed-f">Icon<input id="sd-ed-icon" placeholder="emoji or blank" maxlength="2" value="' + esc(slot.icon || '') + '"></label>'
      + '<div class="sd-ed-f">Key art<div class="sd-emoji">' + EMOJI_ART.map(function (em) { return '<button class="sd-em' + (slot.icon === em ? ' cur' : '') + '" data-emoji="' + em + '" title="Use ' + em + ' on this key">' + em + '</button>'; }).join('') + '</div></div>'
      + '<div class="sd-ed-f">Colour<div class="sd-swatches"><button class="sd-sw sd-sw-auto' + (slot.color ? '' : ' cur') + '" data-color="" title="Auto">Auto</button>'
      + SWATCHES.map(function (col) { return '<button class="sd-sw' + (slot.color === col ? ' cur' : '') + '" data-color="' + col + '" style="background:' + col + '"></button>'; }).join('') + '</div></div>'
      + '<div class="sd-ed-actions-row"><button class="sd-mini" id="sd-ed-clear">Clear custom look</button><button class="btn-primary" id="sd-ed-done">Done</button></div></div></div>';
    var o = overlay(); o.innerHTML = '<div class="sd-picker-card sd-ed-card">' + body + '</div>'; o.className = 'sd-picker on';
    wireKeyEditor(index); render();
  }
  function wireKeyEditor(index) {
    var o = overlay();
    o.onclick = function (e) { if (e.target === o) closeOverlay(); };
    o.querySelectorAll('.sd-picker-opt').forEach(function (btn) {
      btn.onclick = function () {
        var slot = slotAt(index), refKind = btn.getAttribute('data-ref');
        if (refKind) { slot.a = refKind; slot.ref = btn.getAttribute('data-refid'); slot.refName = btn.getAttribute('data-refname'); if (refKind === 'padRef' && !slot.icon) slot.icon = '🔊'; }
        else { slot.a = btn.getAttribute('data-pick'); delete slot.ref; delete slot.refName; }
        mapping().keys[index] = slot; persist(); openKeyEditor(index);
      };
    });
    var lab = document.getElementById('sd-ed-label'); if (lab) lab.oninput = function () { var slot = slotAt(index); slot.label = lab.value; mapping().keys[index] = slot; persist(); refreshKey(index); };
    var ic = document.getElementById('sd-ed-icon'); if (ic) ic.oninput = function () { var slot = slotAt(index); slot.icon = ic.value; mapping().keys[index] = slot; persist(); refreshKey(index); };
    o.querySelectorAll('.sd-sw').forEach(function (sw) { sw.onclick = function () { var slot = slotAt(index), col = sw.getAttribute('data-color'); if (col) slot.color = col; else delete slot.color; mapping().keys[index] = slot; persist(); openKeyEditor(index); }; });
    o.querySelectorAll('.sd-em').forEach(function (em) { em.onclick = function () { var slot = slotAt(index), pick = em.getAttribute('data-emoji'); slot.icon = (slot.icon === pick) ? '' : pick; if (!slot.icon) delete slot.icon; mapping().keys[index] = slot; persist(); openKeyEditor(index); }; });
    var clr = document.getElementById('sd-ed-clear'); if (clr) clr.onclick = function () { var slot = slotAt(index); delete slot.label; delete slot.color; delete slot.icon; mapping().keys[index] = slot; persist(); openKeyEditor(index); };
    var done = document.getElementById('sd-ed-done'); if (done) done.onclick = closeOverlay;
  }
  function refreshKey(index) {
    var tile = root() && root().querySelector('.sd-key[data-key="' + index + '"]'); if (!tile) { render(); }
    else { var slot = slotAt(index), s = surfaceState(); tile.style.setProperty('--kc', slotColor(slot)); tile.querySelector('.sd-key-lbl').textContent = slotLabel(slot, s) || ''; }
    schedulePaint();
  }
  function openDialEditor(index, fromLearn) {
    learnArmed = false;
    var cur = mapping().dials[index];
    var body = '<div class="sd-ed-head">Dial ' + (index + 1) + (fromLearn ? ' <span class="sd-ed-learned">learned</span>' : '') + '</div><div class="sd-picker-list">';
    Object.keys(DIAL_CONTROLLERS).forEach(function (id) {
      var c = DIAL_CONTROLLERS[id];
      body += '<button class="sd-picker-opt sd-dial-opt' + (id === cur ? ' cur' : '') + '" data-dial-pick="' + id + '">'
        + '<span class="sd-dial-opt-t" style="--dc:' + (c.hue || 'var(--accent)') + '">' + esc(c.label) + '</span>'
        + '<span class="sd-dial-opt-d">turn: ' + esc(c.turnLabel || '') + ' &middot; press: ' + esc(c.pressLabel || '') + '</span></button>';
    });
    body += '</div>';
    var o = overlay(); o.innerHTML = '<div class="sd-picker-card">' + body + '</div>'; o.className = 'sd-picker on';
    o.onclick = function (e) { if (e.target === o) { closeOverlay(); return; } var btn = e.target.closest && e.target.closest('[data-dial-pick]'); if (!btn) return; mapping().dials[index] = btn.getAttribute('data-dial-pick'); persist(); closeOverlay(); paintAll(); render(); };
  }

  function wire() {
    var r = root(); if (!r) return;
    bind('sd-connect', connect); bind('sd-connect2', connect); bind('sd-disconnect', disconnect);
    bind('sd-talkoff', function () { releaseTalkback(true); });
    bind('sd-reset', resetActive); bind('sd-test', testPattern);
    bind('sd-learn', function () { learnArmed = !learnArmed; render(); if (learnArmed) toast('Press a key or turn a dial on the deck to map it.'); });
    bind('sd-pf-new', function () { addProfile('Layout'); }); bind('sd-pf-dup', duplicateActive); bind('sd-pf-def', setDefaultActive); bind('sd-pf-del', deleteActive);
    bind('sd-pf-ren', function () { var n = prompt('Rename layout', mapping().name); if (n) renameActive(n.trim()); });
    bind('sd-pf-exp', exportActive);
    bind('sd-pf-imp', function () { var f = document.getElementById('sd-pf-file'); if (f) f.click(); });
    var file = document.getElementById('sd-pf-file'); if (file) file.onchange = function () { if (file.files && file.files[0]) importFile(file.files[0]); file.value = ''; };
    var sel = document.getElementById('sd-profile'); if (sel) sel.onchange = function () { switchProfile(sel.value); };
    bind('sd-obs-con', function () { var url = (document.getElementById('sd-obs-url') || {}).value || 'ws://localhost:4455'; var pw = (document.getElementById('sd-obs-pw') || {}).value || ''; if (OBSc()) { OBSc().configure({ url: url, password: pw }); OBSc().connect(); toast('Connecting to OBS…'); } });
    bind('sd-obs-dis', function () { if (OBSc()) OBSc().disconnect(); });
    var br = document.getElementById('sd-bright'); if (br) br.oninput = function () { setBrightness(+br.value); };
    var relearn = document.getElementById('sd-relearn');
    if (relearn) relearn.onclick = function () { overrides.rotation = document.getElementById('sd-flip').checked ? 180 : 0; var cols = +document.getElementById('sd-cols').value; if (cols >= 3 && cols <= 12) overrides.cols = cols; persist(); profile = Device.makeProfile(profile.productId, { unitInfo: device.unitInfo, overrides: overrides }); device.profile = profile; registerLabelModel(profile); ensureProfilesShape(); paintAll(); render(); };
    r.querySelectorAll('.sd-key').forEach(function (btn) { btn.onclick = function () { openKeyEditor(+btn.getAttribute('data-key')); }; });
    r.querySelectorAll('.sd-dial').forEach(function (el) { el.onclick = function () { openDialEditor(+el.getAttribute('data-dial')); }; });
  }
  function bind(id, fn) { var el = document.getElementById(id); if (el) el.onclick = fn; }

  async function testPattern() {
    if (!device) return;
    var r = getRenderer();
    if (!r) return;
    for (var i = 0; i < profile.keys; i++) { try { var rendered = await r.renderKeyImage(profile.productId, i, { text: String(i + 1), active: (i % 2 === 0), backgroundColor: '#243a66' }); var packets = Device.keyImagePackets(profile, i, rendered.bytes); for (var pk = 0; pk < packets.length; pk++) await device.hid.sendReport(packets[pk].reportId, packets[pk].data); } catch (e) {} }
    lastPainted = new Array(profile.keys).fill('test');
    toast('Test pattern sent. If the numbers read upside-down, tick the flip box in Connect & Learn.');
  }

  // ── Entry / gating ──────────────────────────────────────────────────────────
  function open() {
    var id = window.CueolaIdentity;
    if (id && typeof id.identity === 'function' && !id.identity()) { try { id.openSignIn && id.openSignIn(); } catch (e) {} toast('Sign in to open KeyWi.'); return false; }
    showScreen(); buildCatalog();
    try { brightness = Math.max(0, Math.min(100, parseInt(localStorage.getItem(BRIGHTNESS_KEY), 10) || 80)); } catch (e) {}
    talkbackConnect();
    // OBS: repaint on state changes, and reconnect automatically if the operator
    // set it up before (a saved config means they use OBS with this deck).
    if (OBSc()) { OBSc().onChange(onObsChange); var oc = OBSc().config(); var savedObs = false; try { savedObs = !!localStorage.getItem('cueola_obs_config'); } catch (e) {} if (savedObs && oc && oc.url) OBSc().connect(); }
    render();
    if (navigator.hid) navigator.hid.getDevices().then(function (list) { var d = (list || []).filter(supportedFilter)[0]; if (d && !device) openDevice(d); }).catch(function () {});
    return true;
  }
  function close() { hideScreen(); }
  function showScreen() { var scr = document.getElementById('streamdeck'); if (!scr) return; document.querySelectorAll('.screen.on').forEach(function (s) { s.classList.remove('on'); }); scr.classList.add('on'); try { if (typeof window.pushSessionHistoryState === 'function') window.pushSessionHistoryState('streamdeck'); } catch (e) {} }
  function hideScreen() { var scr = document.getElementById('streamdeck'); if (scr) scr.classList.remove('on'); var entry = document.getElementById('entry'); if (entry) entry.classList.add('on'); }

  window.addEventListener('blur', function () { releaseTalkback(false); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) releaseTalkback(false); });
  window.addEventListener('beforeunload', function () { releaseTalkback(true); });

  window.CueolaStreamDeck = {
    open: open, close: close, connect: connect, disconnect: disconnect,
    isConnected: function () { return !!device; },
    talkbackConnected: function () { return talkbackState.connected; },
    _catalog: function () { buildCatalog(); return catalog; },
    _fire: fireSlot,
    _profileFor: function (pid, opts) { return Device.makeProfile(pid, opts || {}); },
    _profiles: function () { return { profiles: profiles, active: activeProfileId, def: defaultProfileId }; }
  };
})();
