/* Cueola KeyWi Bird (control surface). One Stream Deck + XL drives the whole rig.
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
 * each dial and taps fire that dial's press action. Micochondria's two mics —
 * TKB (bus A) and VofU (bus B) — speak the talkbackd loopback socket directly,
 * momentary, with an all-off safety net.
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
  var SEED_KEY = 'cueola_streamdeck_seed_layouts';   // staged named layouts (e.g. The Break Room demo), added once per deck
  var BRIGHTNESS_KEY = 'cueola_streamdeck_bright';
  var PAINT_HZ = 5;
  // Press feedback duration, mirroring the Outrangutan renderer convention:
  // a key input flashes white for 150ms, as an overlay that composes with the
  // active ring and the progress wipe.
  var SD_PRESS_FLASH_MS = 150;
  var SWATCHES = ['#1c7a3e', '#8a1f1f', '#243a66', '#5a2a8a', '#5a4a12', '#2e3640', '#17653a', '#1c4a86', '#6a3b8a', '#7a5a1c', '#0f4c81', '#a4741e'];
  // Key-art quick picks: show-runner sounds and moments. Owner-requested fun.
  var EMOJI_ART = ['🔊', '💥', '👏', '🎉', '😂', '🥁', '🎺', '🔔', '⚡', '🌩️', '🎵', '📣', '🚨', '🎬', '🎸', '🦆', '💨', '🏆', '❤️', '🤫'];

  // ── Action catalog ─────────────────────────────────────────────────────────
  // Ordered app by app (Outrangutan → Cueola → Flowmingo) so the key editor's
  // groups read like the apps themselves. Colors follow the app family — playback
  // keeps its semantic transport colors, Cueola rides blues, Flowmingo purples —
  // except safety colors (PANIC red, hold-key amber), which always win.
  var KEYMAP_ACTIONS = [
    // Outrangutan (playback)
    ['playout.go', '#1c7a3e', 'GO'], ['playout.pause', '#5a4a12', 'PAUSE'],
    ['playout.stop', '#2e3640', 'STOP'], ['playout.fade', '#243a66', 'FADE'],
    ['playout.panic', '#8a1f1f', 'PANIC'],
    // Cueola (rundown + live)
    ['rundown.next', '#234a8a', 'NEXT'], ['rundown.back', '#22365c', 'PREV'],
    ['ref.open', '#2e3640', 'HELP'],
    // Flowmingo (prompter)
    ['prompter.cue.current', '#4a2f73', 'CUE ROW'],
    ['prompter.playpause', '#6a3b8a', 'SCROLL'], ['prompter.top', '#3d2b52', 'TOP'],
    ['prompter.size.up', '#3d2b52', 'A+'], ['prompter.size.down', '#3d2b52', 'A-'],
    ['prompter.speed.up', '#3d2b52', 'SPD+'], ['prompter.speed.down', '#3d2b52', 'SPD-'],
    ['prompter.dir.fwd', '#3d2b52', 'FWD'], ['prompter.dir.rev', '#3d2b52', 'REV'],
    ['prompter.fullscreen', '#3d2b52', 'FULL'], ['prompter.hideui', '#3d2b52', 'HIDE UI'],
    ['prompter.mirror', '#3d2b52', 'MIRROR'], ['prompter.brake', '#5a4a12', 'BRAKE'],
    ['prompter.boost', '#5a4a12', 'BOOST'], ['prompter.nudge.back', '#3d2b52', 'NUDGE-'],
    ['prompter.nudge.fwd', '#3d2b52', 'NUDGE+'], ['prompter.editscript', '#3d2b52', 'EDIT'],
    ['scrub.open', '#3d2b52', 'SCRUB']
  ];
  // Which app owns each keymap action — the key editor groups by app, so the
  // catalog reads like the rig: Outrangutan, Cueola, Flowmingo, Micochondria, OBS.
  var APP_GROUP = { playout: 'Outrangutan', rundown: 'Cueola', ref: 'Cueola', prompter: 'Flowmingo', scrub: 'Flowmingo' };

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
      registerAction({ id: 'km:' + id, kind: 'keymap', keymapId: id, hold: !!(entry && entry.hold), group: APP_GROUP[id.split('.')[0]] || (entry && entry.group) || 'Cueola', color: color, label: short, full: (entry && entry.label) || id, desc: KEYMAP_DESCS[id] || '', toggle: !!KEYMAP_TOGGLES[id], lamp: lampFor(id) });
    });
    for (var p = 1; p <= 8; p++) registerAction({ id: 'pad:' + p, kind: 'pad', slot: p, group: 'Outrangutan · SFX pads', color: '#5a2a8a', label: 'PAD ' + p, full: 'SFX pad slot ' + p, desc: 'Fires whatever SFX pad sits in position ' + p + ' of the loaded show.' });
    for (var c = 1; c <= 8; c++) registerAction({ id: 'cue:' + c, kind: 'cue', slot: c, group: 'Outrangutan · cues', color: '#234a8a', label: 'CUE ' + c, full: 'Playout cue slot ' + c, desc: 'Fires cue number ' + c + ' of the loaded show.' });
    // Named cue/pad refs are bound from the live show list in the key editor.
    registerAction({ id: 'padRef', kind: 'padRef', group: 'This show', color: '#5a2a8a', label: 'PAD', full: 'SFX pad (by name)', desc: 'Fires one specific SFX pad, picked by name.' });
    registerAction({ id: 'cueRef', kind: 'cueRef', group: 'This show', color: '#234a8a', label: 'CUE', full: 'Cue (by name)', desc: 'Fires one specific cue, picked by name.' });
    registerAction({ id: 'golive', kind: 'golive', group: 'Cueola', color: '#8a1f1f', label: 'GO LIVE', full: 'Enter Live / start show', desc: 'Opens the Live show screen (with its go-live check).', lamp: function (s) { return !!(s.live && s.live.on); } });
    // The clock suite: one toggle plus explicit Start / Pause / Resume verbs.
    // Lamps: Start+Resume glow while running; Pause glows while paused mid-show.
    registerAction({ id: 'clock', kind: 'clock', verb: 'toggle', group: 'Cueola · show clock', color: '#243a66', label: 'CLOCK', full: 'Show clock: start / pause', desc: 'One-key clock: starts it, or pauses it if running. Toggle.', toggle: true, lamp: function (s) { return !!(s.clock && s.clock.running); } });
    registerAction({ id: 'clock.start', kind: 'clock', verb: 'start', group: 'Cueola · show clock', color: '#1c7a3e', label: 'CLOCK GO', full: 'Show clock: start', desc: 'Starts the shared show clock. Quiet no-op if already running.', lamp: function (s) { return !!(s.clock && s.clock.running); } });
    registerAction({ id: 'clock.pause', kind: 'clock', verb: 'pause', group: 'Cueola · show clock', color: '#5a4a12', label: 'CLOCK ❚❚', full: 'Show clock: pause', desc: 'Pauses the shared show clock. Quiet no-op if already paused.', lamp: function (s) { return !!(s.clock && !s.clock.running && s.clock.elapsed > 0); } });
    registerAction({ id: 'clock.resume', kind: 'clock', verb: 'resume', group: 'Cueola · show clock', color: '#0f4c81', label: 'CLOCK ▶', full: 'Show clock: resume', desc: 'Resumes a paused show clock from where it stopped.', lamp: function (s) { return !!(s.clock && s.clock.running); } });
    // Micochondria — the powerhouse for the talkbacks. Two hold-to-talk mics:
    // TKB (Talkback, crew comms on outs 1-2) and VofU (Voice of the Universe, the
    // god-mic to the room on outs 3-4), plus one off-air panic. Action ids, kind,
    // and bus letters are the wire contract with the plugin + daemon — never rename.
    registerAction({ id: 'talk.a', kind: 'talkback', bus: 'A', momentary: true, group: 'Micochondria', color: '#17653a', label: 'TKB', full: 'Talkback (outs 1-2), hold', desc: 'HOLD to talk to the crew on the Talkback bus (outs 1-2). Mic cuts the moment you release.', lamp: function () { return talkbackState.A; } });
    registerAction({ id: 'talk.b', kind: 'talkback', bus: 'B', momentary: true, group: 'Micochondria', color: '#1c4a86', label: 'VofU', full: 'Voice of the Universe (outs 3-4), hold', desc: 'HOLD to open the Voice of the Universe, the god-mic to the room (outs 3-4). Mic cuts the moment you release.', lamp: function () { return talkbackState.B; } });
    registerAction({ id: 'talk.off', kind: 'talkbackPanic', group: 'Micochondria', color: '#8a1f1f', label: 'ALL TALK OFF', full: 'Cut both mics (TKB + VofU)', desc: 'Cuts both Micochondria mics (TKB and VofU) instantly. The off-air safety.' });
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
    // Fun.
    registerAction({ id: 'fx.hype', kind: 'fx', op: 'hype', group: 'Fun', color: '#b06ef8', label: 'HYPE', full: 'Rainbow hype burst', desc: 'A rainbow light show ripples across the whole deck. Pure fun, worth a press.' });
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
    master: { label: 'PLBK vol', hue: '#22d3a0', turnLabel: 'Volume up / down', pressLabel: 'Mute / unmute',
      desc: 'Turn: Outrangutan playback master volume. Press: instant mute, press again to restore.',
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
      tick: function (d) { setBrightness(brightness + d * 5); }, press: function () { setBrightness(80); } },
    // Silly-but-why-not: the live OBS program, right on the touch strip. It is a
    // low-fps monitor glance (a screenshot every ~¼s over the websocket), not
    // smooth video, but it turns a strip zone into a program preview. Turning
    // rides the OBS stream-audio input volume (pick which input in the OBS row);
    // press to start / stop the OBS stream.
    obsProgram: { label: 'OBS program', hue: '#e2477b', turnLabel: 'Stream volume', pressLabel: 'Start / stop stream', obsFrame: true,
      desc: 'A live OBS program monitor. Turn: the OBS stream audio volume (choose which input in the OBS row). Press: start or stop the OBS stream.',
      readout: function () { var st = obsState(); return st.connected ? pct(obsVolume()) : 'off'; },
      bar: function () { var st = obsState(); return st.connected ? obsVolume() : null; }, live: function () { return !!obsState().streaming; },
      tick: obsVolTick, press: function () { var o = OBSc(); if (o && o.isReady && o.isReady()) { try { o.toggleStream(); } catch (e) {} } else toast('Connect OBS first (the OBS row above the deck).'); } },
    // Micochondria on the strip: one zone, split in half. TKB on the left,
    // VofU on the right, each half lit while that mic is live. Tap = off-air panic.
    micoStatus: { label: 'Micochondria', hue: '#22d3a0', turnLabel: 'Nothing (status)', pressLabel: 'All talk off', micoSplit: true,
      desc: 'A Micochondria status zone, split in half: TKB left, VofU right, each lit while that mic is live. Turning does nothing. Press (or tap the zone): cut both mics instantly.',
      readout: function () { return talkbackState.connected ? ((talkbackState.A || talkbackState.B) ? 'LIVE' : 'ready') : 'off'; },
      bar: function () { return null; }, live: function () { return !!(talkbackState.A || talkbackState.B); },
      tick: function () {}, press: function () { releaseTalkback(true); toast('All talk off.'); } }
  };
  var DEFAULT_DIALS = ['master', 'prompterSpeed', 'prompterSize', 'prompterScrub', 'rundownSelect', 'showClock'];
  function fmtClock(secs) { secs = Math.max(0, Math.round(secs || 0)); var m = Math.floor(secs / 60), s = secs % 60; return m + ':' + (s < 10 ? '0' : '') + s; }

  // Curated default layouts per deck size, organized BY APP: each app owns a
  // contiguous band of columns (Outrangutan, then Cueola, then Flowmingo, then
  // Micochondria, then OBS), like channel strips on a console. Redundancy rule:
  // a deck with dials does NOT get keys for things its dials already do (text
  // size, prompter speed, the three separate clock verbs) — one control, one
  // job. The dial-less XL keeps its speed keys. Blanks are deliberate air
  // between bands, not wasted keys.
  var DEFAULT_LAYOUTS = {
    6:  ['km:playout.go', 'km:playout.stop', 'km:playout.panic', 'km:rundown.next', 'talk.a', 'clock'],
    8:  ['km:playout.go', 'km:playout.stop', 'km:playout.panic', 'km:rundown.next',
         'km:rundown.back', 'clock', 'talk.a', 'talk.b'],
    // 5 × 3: row 1 Outrangutan, row 2 Cueola, row 3 Flowmingo + Micochondria.
    15: ['km:playout.go', 'km:playout.pause', 'km:playout.stop', 'km:playout.panic', 'pad:1',
         'km:rundown.next', 'km:rundown.back', 'golive', 'clock', 'km:prompter.playpause',
         'km:prompter.cue.current', 'km:prompter.top', 'talk.a', 'talk.b', 'talk.off'],
    // 8 × 4 (XL, no dials): cols 1-3 Outrangutan, 4-5 Cueola + OBS, 6-7 Flowmingo
    // (keeps SPD keys — nothing else covers speed here), col 8 Micochondria.
    32: ['km:playout.go', 'km:playout.pause', 'km:playout.stop', 'km:rundown.next', 'golive', 'km:prompter.playpause', 'km:prompter.cue.current', 'talk.a',
         'km:playout.fade', 'km:playout.panic', 'pad:1', 'km:rundown.back', 'clock', 'km:prompter.top', 'km:prompter.mirror', 'talk.b',
         'pad:2', 'pad:3', 'pad:4', 'obs.stream', 'obs.record', 'km:prompter.brake', 'km:prompter.boost', 'talk.off',
         'cue:1', 'cue:2', 'cue:3', 'obs.scene:1', 'obs.scene:2', 'km:prompter.speed.down', 'km:prompter.speed.up', 'layout.next'],
    // 9 × 4 (+ XL): cols 1-3 Outrangutan, 4-5 Cueola, 6-7 Flowmingo,
    // col 8 Micochondria, col 9 OBS + pages. Dials cover volume, speed, size,
    // scrub, row, clock — so those keys are gone on purpose.
    36: ['km:playout.go', 'km:playout.pause', 'km:playout.stop', 'km:rundown.next', 'golive', 'km:prompter.playpause', 'km:prompter.cue.current', 'talk.a', 'obs.stream',
         'km:playout.fade', 'km:playout.panic', 'pad:1', 'km:rundown.back', 'clock', 'km:prompter.top', 'km:prompter.mirror', 'talk.b', 'obs.record',
         'pad:2', 'pad:3', 'pad:4', 'none', 'none', 'km:prompter.brake', 'km:prompter.boost', 'talk.off', 'obs.scene:1',
         'cue:1', 'cue:2', 'cue:3', 'none', 'fx.hype', 'km:prompter.editscript', 'km:scrub.open', 'none', 'layout.next']
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
  var seededNames = [];               // layout names already offered from SEED_KEY for this deck (delete stays deleted)
  var activeProfileId = '';           // selected profile
  var defaultProfileId = '';          // auto-selected on connect
  function mapping() { return profiles[activeProfileId] || { keys: [], dials: [], touch: [] }; }

  var keyState = [], dialPress = [], lastPainted = [], lastStripSig = '';
  var pressFlashUntil = [];           // per-key deadline for the 150ms input flash
  var brightness = 80, paintTimer = null, jogAccum = 0, muteMemory = null;
  var learnArmed = false, editingKey = -1;
  var previewMode = false;            // on-screen deck with no hardware, for playing with layouts + themes
  var diagInfo = null;                // last hardware diagnostics capture (read-only report)
  var animTimer = null, animPhase = 0, hypeRunning = false;
  var PREVIEW_PID = 0xf1f1;
  var mode = 'local';

  var tbSocket = null, tbUrlIndex = 0, tbReconnect = null;
  // gains/levels arrive only from an updated talkbackd; hasGains/hasLevels flag
  // what this daemon speaks so the Micochondria panel never shows dead controls.
  var talkbackState = { A: false, B: false, connected: false, gainA: 1, gainB: 1, hasGains: false, hasLevels: false, levels: { mic: 0, a: 0, b: 0 } };
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
      case 'fx': if (phase === 'down' && a.op === 'hype') hypeShow(); break;
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
  // Stream-output volume: obs-websocket has no master fader, so KeyWi rides ONE
  // chosen audio input (the "stream audio" — usually Desktop Audio). The pick is
  // remembered per browser; auto-guess prefers a desktop/stream-sounding name.
  var OBS_VOL_KEY = 'cueola_obs_streamvol_input';
  function obsVolInputName() {
    var inputs = obsState().inputs || [];
    var saved = ''; try { saved = localStorage.getItem(OBS_VOL_KEY) || ''; } catch (e) {}
    if (saved && inputs.indexOf(saved) >= 0) return saved;
    for (var i = 0; i < inputs.length; i++) if (/desktop|stream|program|master|output/i.test(inputs[i])) return inputs[i];
    return inputs[0] || '';
  }
  function setObsVolInput(name) { try { localStorage.setItem(OBS_VOL_KEY, name || ''); } catch (e) {} schedulePaint(); }
  function obsVolume() { var st = obsState(), n = obsVolInputName(); var v = st.volumes ? st.volumes[n] : null; return v == null ? 1 : Math.max(0, Math.min(1, v)); }
  function obsVolTick(d) {
    var o = OBSc();
    if (!o || !o.isReady || !o.isReady()) { toast('Connect OBS first (the OBS row above the deck).'); return; }
    var n = obsVolInputName();
    if (!n) { toast('OBS has no audio inputs to ride.'); return; }
    try { o.setVolume(n, obsVolume() + d * 0.04); } catch (e) {}
    schedulePaint();
  }
  var obsWasReady = false;
  function onObsChange() {
    var now = !!(OBSc() && OBSc().isReady());
    if (now !== obsWasReady) { obsWasReady = now; if (document.getElementById('streamdeck') && document.getElementById('streamdeck').classList.contains('on')) render(); schedulePaint(); if (wizardStep >= 0) wizardRender(); }
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
    ws.onopen = function () { talkbackState.connected = true; try { ws.send('state?'); } catch (e) {} renderStatus(); renderMico(); micoPopoutSync(); if (wizardStep >= 0) wizardRender(); };
    ws.onmessage = function (evt) {
      var m; try { m = JSON.parse(evt.data); } catch (e) { return; }
      if (m && m.type === 'state') {
        var structural = (talkbackState.A !== !!m.talkA) || (talkbackState.B !== !!m.talkB) || (!talkbackState.hasGains && m.gainA != null);
        talkbackState.A = !!m.talkA; talkbackState.B = !!m.talkB;
        if (m.gainA != null) { talkbackState.hasGains = true; talkbackState.gainA = m.gainA; }
        if (m.gainB != null) talkbackState.gainB = m.gainB;
        schedulePaint(); renderStatus();
        if (structural) renderMico(); else micoSync();
        micoPopoutSync();
      } else if (m && m.type === 'levels') {
        if (!talkbackState.hasLevels) { talkbackState.hasLevels = true; renderMico(); }
        talkbackState.levels = { mic: +m.mic || 0, a: +m.a || 0, b: +m.b || 0 };
        updateMicoMeters(); micoPopoutMeters();
      }
    };
    ws.onclose = function () { talkbackState.connected = false; talkbackState.A = false; talkbackState.B = false; talkbackState.hasGains = false; talkbackState.hasLevels = false; talkbackState.levels = { mic: 0, a: 0, b: 0 }; talkbackHeld.A = false; talkbackHeld.B = false; tbUrlIndex++; scheduleTalkbackReconnect(); schedulePaint(); renderStatus(); renderMico(); micoPopoutSync(); if (wizardStep >= 0) wizardRender(); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  function scheduleTalkbackReconnect() { clearTimeout(tbReconnect); tbReconnect = setTimeout(talkbackConnect, 2000); }
  function talkbackSend(cmd) { if (tbSocket && tbSocket.readyState === 1) { try { tbSocket.send(cmd); return true; } catch (e) {} } return false; }
  function talkbackSet(bus, on) { talkbackHeld[bus] = on; if (!talkbackSend(bus + (on ? ' on' : ' off')) && on) toast('Talkback daemon not running (start talkbackd).'); }
  function releaseTalkback(force) { ['A', 'B'].forEach(function (bus) { if (talkbackHeld[bus] || (force && talkbackState[bus])) { talkbackHeld[bus] = false; talkbackSend(bus + ' off'); } }); }
  // Volume rides the daemon ("A gain 0.8"). Sends are debounced so a slider
  // drag is one command stream, not hundreds; local state updates instantly.
  var tbGainTimers = {};
  function talkbackGain(bus, v) {
    v = Math.max(0, Math.min(1, +v || 0));
    if (bus === 'A') talkbackState.gainA = v; else talkbackState.gainB = v;
    clearTimeout(tbGainTimers[bus]);
    tbGainTimers[bus] = setTimeout(function () { talkbackSend(bus + ' gain ' + v.toFixed(2)); }, 60);
  }

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
    previewMode = false;
    stripErrToasted = false;
    render();
    if (wizardStep >= 0) wizardRender();
    startPaintLoop();
    startAnim();
    connectLightShow().then(function () { return paintAll(); }).then(function () { return stripProbe(); });
    toast('Connected: ' + profile.name + ' (' + profile.keys + ' keys, ' + profile.dials + ' dials).');
    return true;
  }
  // Hello, deck: a rainbow sweep rolls diagonally across the physical keys the
  // moment it connects, then the layout settles in. Pure fun, but also a full
  // pixel test of every key. Skipped under prefers-reduced-motion.
  async function connectLightShow() {
    if (!device || !profile) return;
    try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) {}
    var target = device, z = profile.keyPx;
    var order = [];
    for (var i = 0; i < profile.keys; i++) order.push(i);
    order.sort(function (a, b) { return ((a % profile.cols) + Math.floor(a / profile.cols)) - ((b % profile.cols) + Math.floor(b / profile.cols)); });
    // Each frame is one serialized queue job (draw + encode + send together:
    // the offscreen canvas is shared with the regular painters).
    var lightShowFrame = function (idx) {
      return async function () {
        if (device !== target) return;
        var hue = Math.round(((idx % profile.cols) + Math.floor(idx / profile.cols)) / (profile.cols + profile.rows) * 300);
        var cv = offCanvas(z), cx = cv.getContext('2d'); cx.clearRect(0, 0, z, z); cx.fillStyle = 'hsl(' + hue + ', 85%, 45%)'; rr(cx, 0, 0, z, z, z * 0.15); cx.fill();
        var bytes = await keyJpegFromCanvas(cv, z);
        var packets = Device.keyImagePackets(profile, idx, bytes);
        for (var pk = 0; pk < packets.length; pk++) { if (device !== target) return; await target.hid.sendReport(packets[pk].reportId, packets[pk].data); }
      };
    };
    for (var k = 0; k < order.length; k++) {
      if (device !== target) return;                       // unplugged mid-show
      try { await queueDeviceWrite('key:' + order[k], lightShowFrame(order[k])); } catch (e) { return; }
    }
    lastPainted = new Array(profile.keys).fill('wave');    // force the real layout to repaint over it
  }

  // ── Deck diagnostics (read-only) ────────────────────────────────────────────
  // Shows what the hardware itself reports, on screen: vendor/product ids, the
  // product name string, the HID report descriptor as the browser parsed it
  // (WebHID never exposes the raw descriptor bytes — the parsed collections are
  // the closest available), and a hex dump of every feature report the
  // descriptor declares, including 0x08 Unit Information (the report the driver
  // reads geometry from). GET-only inspection: nothing is written to the device
  // and no model definition is touched. Unlike diagnose(), this runs pre-connect
  // so it can inspect a deck the connect flow refuses.
  function hexDump(bytes, max) {
    if (!bytes || !bytes.length) return '(empty)';
    var n = Math.min(bytes.length, max || 96);
    var out = [];
    for (var i = 0; i < n; i++) out.push(('0' + bytes[i].toString(16)).slice(-2));
    return out.join(' ') + (bytes.length > n ? ' … (' + bytes.length + ' bytes total)' : '');
  }
  function describeReports(list, kind) {
    return (list || []).map(function (rep) {
      var items = (rep.items || []).map(function (it) {
        var usages = (it.usages || []).map(function (u) { return '0x' + u.toString(16); }).join(',');
        return it.reportCount + '×' + it.reportSize + 'bit' + (usages ? ' usages[' + usages + ']' : '');
      }).join('; ');
      return kind + ' report 0x' + (rep.reportId || 0).toString(16) + (items ? ' — ' + items : '');
    });
  }
  function describeCollections(cols, indent) {
    var rows = [];
    (cols || []).forEach(function (c) {
      rows.push(indent + 'collection usagePage=0x' + (c.usagePage || 0).toString(16) + ' usage=0x' + (c.usage || 0).toString(16));
      describeReports(c.inputReports, 'input').forEach(function (r) { rows.push(indent + '  ' + r); });
      describeReports(c.outputReports, 'output').forEach(function (r) { rows.push(indent + '  ' + r); });
      describeReports(c.featureReports, 'feature').forEach(function (r) { rows.push(indent + '  ' + r); });
      rows = rows.concat(describeCollections(c.children, indent + '  '));
    });
    return rows;
  }
  async function runDiagnostics() {
    if (!navigator.hid) { toast('WebHID needs Chrome or Edge.'); return; }
    var dev = device && device.hid, openedHere = false;
    try {
      if (!dev) {
        var have = (await navigator.hid.getDevices()).filter(supportedFilter);
        dev = have[0];
        if (!dev) { var picked = await navigator.hid.requestDevice({ filters: [{ vendorId: Device.ELGATO_VID }] }); dev = picked && picked[0]; }
      }
    } catch (e) { toast('Stream Deck selection cancelled.'); return; }
    if (!dev) { toast('No Stream Deck selected. Quit the Elgato app first, then try again.'); return; }
    var known = Device.KNOWN_MODELS[dev.productId];
    var report = {
      vendorId: '0x' + dev.vendorId.toString(16),
      productId: '0x' + dev.productId.toString(16),
      productName: dev.productName || '(no product name string)',
      knownModel: known ? known.name : 'NOT in the model table — the adaptive + XL fallback would apply',
      descriptor: [],
      features: []
    };
    try { if (!dev.opened) { await dev.open(); openedHere = true; } }
    catch (e) {
      report.error = 'Could not open the device (quit the Elgato Stream Deck app — it claims the USB device): ' + (e && e.message ? e.message : e);
      diagInfo = report; render(); return;
    }
    report.descriptor = describeCollections(dev.collections, '');
    // Read every feature report the descriptor declares, plus 0x08 Unit Info
    // even when undeclared — reads only, a GET can't change device state.
    var ids = {};
    (function walk(cols) { (cols || []).forEach(function (c) { (c.featureReports || []).forEach(function (r) { ids[r.reportId] = true; }); walk(c.children); }); })(dev.collections);
    ids[0x08] = true;
    var idList = Object.keys(ids).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < idList.length; i++) {
      var id = idList[i], row = { id: '0x' + id.toString(16) };
      try {
        var dv = await dev.receiveFeatureReport(id);
        var bytes = dv && dv.buffer ? new Uint8Array(dv.buffer, dv.byteOffset || 0, dv.byteLength) : null;
        row.hex = hexDump(bytes, 96);
        if (id === 0x08) row.parsed = JSON.stringify(Device.parseUnitInfo(bytes));
      } catch (e) { row.error = String(e && e.message ? e.message : e); }
      report.features.push(row);
    }
    if (openedHere && !device) { try { await dev.close(); } catch (e) {} }
    diagInfo = report;
    render();
    toast('Deck diagnostics captured. Nothing was changed on the device.');
  }
  function diagText() {
    if (!diagInfo) return '';
    var d = diagInfo, lines = [];
    lines.push('Vendor id:    ' + d.vendorId);
    lines.push('Product id:   ' + d.productId);
    lines.push('Product name: ' + d.productName);
    lines.push('Model table:  ' + d.knownModel);
    if (d.error) lines.push('ERROR:        ' + d.error);
    if (d.descriptor.length) {
      lines.push('');
      lines.push('Report descriptor (parsed by the browser; WebHID does not expose the raw bytes):');
      lines = lines.concat(d.descriptor);
    }
    if (d.features.length) {
      lines.push('');
      lines.push('Feature report dumps (GET only):');
      d.features.forEach(function (f) {
        lines.push('  feature ' + f.id + (f.error ? ' — read failed: ' + f.error : ' — ' + f.hex));
        if (f.parsed) lines.push('    parsed as Unit Information: ' + f.parsed);
      });
    }
    return lines.join('\n');
  }
  function diagPanel() {
    if (!diagInfo) return '';
    return '<div class="sd-diag"><div class="sd-diag-head"><b>Deck diagnostics</b>'
      + '<span class="sd-pf-sp"></span>'
      + '<button class="sd-mini" id="sd-diag-copy">Copy report</button>'
      + '<button class="sd-mini" id="sd-diag-close">Close</button></div>'
      + '<pre class="sd-diag-pre">' + esc(diagText()) + '</pre></div>';
  }

  function onDisconnect(e) { if (!device) return; if (e && e.device && e.device !== device.hid) return; teardownDevice(); toast('Stream Deck disconnected.'); render(); }
  function disconnect() {
    var hid = device && device.hid, prof = profile;
    teardownDevice();   // flushes the queue first, so the goodbye below is the only writer left
    if (hid) {
      var rep = null; try { rep = Device.resetReport(prof); } catch (e) {}
      queueDeviceWrite(null, async function () {
        if (rep) { try { await hid.sendFeatureReport(rep.reportId, rep.data); } catch (e) {} }
        try { hid.close(); } catch (e) {}
      }).catch(function () {});
    }
    render();
  }
  function teardownDevice() { stopPaintLoop(); stopAnim(); stopAutoDim(); flushDeviceWrites(); device = null; if (!previewMode) profile = null; keyState = []; dialPress = []; }

  // Preview mode: a virtual + XL on screen so the deck can be explored, themed,
  // and laid out with no hardware plugged in. Real Connect takes over instantly.
  function startPreview() {
    if (device) return;
    previewMode = true;
    loadConfig(PREVIEW_PID);
    profile = Device.makeProfile(PREVIEW_PID, { overrides: overrides });
    keyState = new Array(profile.keys).fill(false);
    ensureProfilesShape();
    render(); paintMirror(); startAnim(); startPaintLoop();
    toast('Preview mode: this is your deck on screen. Connect real hardware any time.');
  }
  function stopPreview() { previewMode = false; profile = null; stopAnim(); stopPaintLoop(); render(); }

  function onInputReport(e) {
    if (!device) return;
    noteDeckInput();   // any key, dial, or touch input restores + re-arms auto-dim
    var data = new Uint8Array(e.data.buffer);
    var evt = Device.parseInputReport(e.reportId, data, profile);
    if (evt.type === 'keys') {
      var edges = Device.keyEdges(keyState, evt.states);
      keyState = evt.states;
      edges.downs.forEach(function (i) { pressFlashUntil[i] = performance.now() + SD_PRESS_FLASH_MS; if (learnArmed) { openKeyEditor(i, true); } else { fireSlot(mapping().keys[i], 'down'); } });
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

  // ── Rich key art: every key is a little illustrated keycap ──────────────────
  // The SAME canvas art drives the physical deck (JPEG over HID) and the on-screen
  // preview tile, so what you see is exactly what lands on the hardware. Themes
  // reskin the whole deck; glyphs give crisp graphics; widgets add live data.
  var THEME_KEY = 'cueola_streamdeck_theme';
  var deckTheme = 'broadcast';
  function loadTheme() { try { deckTheme = localStorage.getItem(THEME_KEY) || 'broadcast'; } catch (e) {} if (!DECK_THEMES[deckTheme]) deckTheme = 'broadcast'; }
  function setTheme(id) { if (!DECK_THEMES[id]) return; deckTheme = id; try { localStorage.setItem(THEME_KEY, id); } catch (e) {} render(); paintMirror(); paintAll(); }
  function theme() { return DECK_THEMES[deckTheme] || DECK_THEMES.broadcast; }

  function hx(c) { c = String(c || '#000').replace('#', ''); if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]; return [parseInt(c.slice(0, 2), 16) || 0, parseInt(c.slice(2, 4), 16) || 0, parseInt(c.slice(4, 6), 16) || 0]; }
  function rgba(c, a) { var r = hx(c); return 'rgba(' + r[0] + ',' + r[1] + ',' + r[2] + ',' + a + ')'; }
  function mix(c1, c2, t) { var a = hx(c1), b = hx(c2); return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')'; }
  function lighten(c, t) { return mix(c, '#ffffff', t); }
  function darken(c, t) { return mix(c, '#000000', t); }
  function rr(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  // Crisp vector glyphs (cx, cy, r=half-size, color). Reads far better than text.
  var GLYPHS = {
    play: function (c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.moveTo(x - r * 0.5, y - r * 0.78); c.lineTo(x - r * 0.5, y + r * 0.78); c.lineTo(x + r * 0.82, y); c.closePath(); c.fill(); },
    pause: function (c, x, y, r, col) { c.fillStyle = col; rr(c, x - r * 0.62, y - r * 0.8, r * 0.42, r * 1.6, r * 0.12); c.fill(); rr(c, x + r * 0.2, y - r * 0.8, r * 0.42, r * 1.6, r * 0.12); c.fill(); },
    stop: function (c, x, y, r, col) { c.fillStyle = col; rr(c, x - r * 0.7, y - r * 0.7, r * 1.4, r * 1.4, r * 0.2); c.fill(); },
    record: function (c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.arc(x, y, r * 0.72, 0, 7); c.fill(); },
    fade: function (c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.moveTo(x - r * 0.85, y + r * 0.7); c.lineTo(x + r * 0.85, y + r * 0.7); c.lineTo(x + r * 0.85, y - r * 0.7); c.closePath(); c.fill(); },
    panic: function (c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.moveTo(x, y - r * 0.85); c.lineTo(x + r * 0.92, y + r * 0.72); c.lineTo(x - r * 0.92, y + r * 0.72); c.closePath(); c.fill(); c.fillStyle = 'rgba(0,0,0,0.72)'; rr(c, x - r * 0.11, y - r * 0.28, r * 0.22, r * 0.5, r * 0.08); c.fill(); c.beginPath(); c.arc(x, y + r * 0.5, r * 0.12, 0, 7); c.fill(); },
    next: function (c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.moveTo(x - r * 0.75, y - r * 0.7); c.lineTo(x + r * 0.15, y); c.lineTo(x - r * 0.75, y + r * 0.7); c.closePath(); c.fill(); rr(c, x + r * 0.35, y - r * 0.7, r * 0.28, r * 1.4, r * 0.06); c.fill(); },
    prev: function (c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.moveTo(x + r * 0.75, y - r * 0.7); c.lineTo(x - r * 0.15, y); c.lineTo(x + r * 0.75, y + r * 0.7); c.closePath(); c.fill(); rr(c, x - r * 0.63, y - r * 0.7, r * 0.28, r * 1.4, r * 0.06); c.fill(); },
    mic: function (c, x, y, r, col) { c.fillStyle = col; rr(c, x - r * 0.3, y - r * 0.85, r * 0.6, r * 1.05, r * 0.3); c.fill(); c.strokeStyle = col; c.lineWidth = r * 0.14; c.lineCap = 'round'; c.beginPath(); c.arc(x, y - r * 0.1, r * 0.55, 0.12 * Math.PI, 0.88 * Math.PI); c.stroke(); c.beginPath(); c.moveTo(x, y + r * 0.5); c.lineTo(x, y + r * 0.85); c.stroke(); },
    clock: function (c, x, y, r, col) { c.strokeStyle = col; c.lineWidth = r * 0.12; c.lineCap = 'round'; c.beginPath(); c.arc(x, y, r * 0.82, 0, 7); c.stroke(); c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - r * 0.5); c.moveTo(x, y); c.lineTo(x + r * 0.42, y + r * 0.1); c.stroke(); },
    scene: function (c, x, y, r, col) { c.strokeStyle = col; c.lineWidth = r * 0.11; rr(c, x - r * 0.85, y - r * 0.62, r * 1.7, r * 1.24, r * 0.16); c.stroke(); c.fillStyle = col; c.beginPath(); c.arc(x + r * 0.32, y - r * 0.16, r * 0.2, 0, 7); c.fill(); c.beginPath(); c.moveTo(x - r * 0.72, y + r * 0.5); c.lineTo(x - r * 0.1, y - r * 0.1); c.lineTo(x + r * 0.2, y + r * 0.2); c.lineTo(x + r * 0.5, y - r * 0.1); c.lineTo(x + r * 0.8, y + r * 0.5); c.closePath(); c.fill(); },
    broadcast: function (c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.arc(x, y, r * 0.22, 0, 7); c.fill(); c.strokeStyle = col; c.lineWidth = r * 0.13; for (var i = 1; i <= 2; i++) { c.beginPath(); c.arc(x, y, r * 0.22 + i * r * 0.32, -0.32 * Math.PI, 0.32 * Math.PI); c.stroke(); c.beginPath(); c.arc(x, y, r * 0.22 + i * r * 0.32, 0.68 * Math.PI, 1.32 * Math.PI); c.stroke(); } },
    cam: function (c, x, y, r, col) { c.fillStyle = col; rr(c, x - r * 0.85, y - r * 0.5, r * 1.2, r * 1.0, r * 0.16); c.fill(); c.beginPath(); c.moveTo(x + r * 0.4, y - r * 0.12); c.lineTo(x + r * 0.85, y - r * 0.42); c.lineTo(x + r * 0.85, y + r * 0.42); c.lineTo(x + r * 0.4, y + r * 0.12); c.closePath(); c.fill(); },
    pages: function (c, x, y, r, col) { c.fillStyle = rgba(col, 0.5); rr(c, x - r * 0.25, y - r * 0.72, r * 1.0, r * 1.35, r * 0.12); c.fill(); c.fillStyle = col; rr(c, x - r * 0.72, y - r * 0.42, r * 1.0, r * 1.35, r * 0.12); c.fill(); },
    mirror: function (c, x, y, r, col) { c.strokeStyle = col; c.lineWidth = r * 0.09; c.beginPath(); c.moveTo(x, y - r * 0.82); c.lineTo(x, y + r * 0.82); c.stroke(); c.fillStyle = col; c.globalAlpha = 0.95; c.beginPath(); c.moveTo(x - r * 0.18, y - r * 0.6); c.lineTo(x - r * 0.72, y); c.lineTo(x - r * 0.18, y + r * 0.6); c.closePath(); c.fill(); c.globalAlpha = 0.4; c.beginPath(); c.moveTo(x + r * 0.18, y - r * 0.6); c.lineTo(x + r * 0.72, y); c.lineTo(x + r * 0.18, y + r * 0.6); c.closePath(); c.fill(); c.globalAlpha = 1; },
    top: function (c, x, y, r, col) { c.strokeStyle = col; c.lineWidth = r * 0.14; c.lineCap = 'round'; c.beginPath(); c.moveTo(x - r * 0.6, y - r * 0.7); c.lineTo(x + r * 0.6, y - r * 0.7); c.stroke(); c.beginPath(); c.moveTo(x, y + r * 0.75); c.lineTo(x, y - r * 0.35); c.moveTo(x, y - r * 0.35); c.lineTo(x - r * 0.4, y + r * 0.05); c.moveTo(x, y - r * 0.35); c.lineTo(x + r * 0.4, y + r * 0.05); c.stroke(); },
    target: function (c, x, y, r, col) { c.strokeStyle = col; c.lineWidth = r * 0.12; c.beginPath(); c.arc(x, y, r * 0.75, 0, 7); c.stroke(); c.beginPath(); c.arc(x, y, r * 0.35, 0, 7); c.stroke(); c.fillStyle = col; c.beginPath(); c.arc(x, y, r * 0.12, 0, 7); c.fill(); },
    sfx: function (c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.moveTo(x - r * 0.75, y - r * 0.28); c.lineTo(x - r * 0.35, y - r * 0.28); c.lineTo(x + r * 0.05, y - r * 0.62); c.lineTo(x + r * 0.05, y + r * 0.62); c.lineTo(x - r * 0.35, y + r * 0.28); c.lineTo(x - r * 0.75, y + r * 0.28); c.closePath(); c.fill(); c.strokeStyle = col; c.lineWidth = r * 0.12; c.lineCap = 'round'; c.beginPath(); c.arc(x + r * 0.1, y, r * 0.5, -0.35 * Math.PI, 0.35 * Math.PI); c.stroke(); c.beginPath(); c.arc(x + r * 0.1, y, r * 0.82, -0.32 * Math.PI, 0.32 * Math.PI); c.stroke(); },
    cue: function (c, x, y, r, col) { c.strokeStyle = col; c.lineWidth = r * 0.1; rr(c, x - r * 0.82, y - r * 0.62, r * 1.64, r * 1.24, r * 0.12); c.stroke(); c.fillStyle = col; for (var i = 0; i < 4; i++) { rr(c, x - r * 0.7, y - r * 0.5 + i * r * 0.36, r * 0.18, r * 0.18, r * 0.04); c.fill(); rr(c, x + r * 0.52, y - r * 0.5 + i * r * 0.36, r * 0.18, r * 0.18, r * 0.04); c.fill(); } },
    up: function (c, x, y, r, col) { c.strokeStyle = col; c.lineWidth = r * 0.16; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(x - r * 0.55, y + r * 0.15); c.lineTo(x, y - r * 0.5); c.lineTo(x + r * 0.55, y + r * 0.15); c.stroke(); },
    down: function (c, x, y, r, col) { c.strokeStyle = col; c.lineWidth = r * 0.16; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(x - r * 0.55, y - r * 0.15); c.lineTo(x, y + r * 0.5); c.lineTo(x + r * 0.55, y - r * 0.15); c.stroke(); },
    star: function (c, x, y, r, col) { c.fillStyle = col; c.beginPath(); for (var i = 0; i < 10; i++) { var ang = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.42 : r * 0.9; c.lineTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad); } c.closePath(); c.fill(); },
    help: function (c, x, y, r, col) { c.fillStyle = col; c.font = '900 ' + Math.round(r * 1.7) + 'px -apple-system,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', x, y + r * 0.08); }
  };

  // Theme = a background painter + ink/ring palette + font. Key faces stay a
  // curated dark palette (like the LED clocks), independent of the app theme.
  var DECK_THEMES = {
    broadcast: {
      name: 'Broadcast', ink: '#ffffff', sub: '#e6edfb', ring: '#8ff7bc', labelWeight: 800,
      font: function (s, w) { return (w || 800) + ' ' + s + "px -apple-system,'SF Pro Display','Segoe UI',sans-serif"; },
      bg: function (c, z, sp) {
        var col = sp.color, g = c.createLinearGradient(0, 0, 0, z);
        g.addColorStop(0, sp.active ? lighten(col, 0.36) : lighten(col, 0.16)); g.addColorStop(1, darken(col, 0.4));
        c.fillStyle = g; rr(c, 0, 0, z, z, z * 0.15); c.fill();
        var sh = c.createLinearGradient(0, 0, 0, z * 0.52); sh.addColorStop(0, 'rgba(255,255,255,0.2)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = sh; rr(c, z * 0.04, z * 0.04, z * 0.92, z * 0.46, z * 0.12); c.fill();
        var v = c.createRadialGradient(z / 2, z * 0.4, z * 0.08, z / 2, z / 2, z * 0.78); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.3)');
        c.fillStyle = v; rr(c, 0, 0, z, z, z * 0.15); c.fill();
      }
    },
    neon: {
      name: 'Neon', ink: '#ffffff', sub: '#a9bce0', ring: '#00e5ff', labelWeight: 800, glow: true,
      font: function (s, w) { return (w || 800) + ' ' + s + "px 'SF Pro Display',-apple-system,sans-serif"; },
      bg: function (c, z, sp) {
        c.fillStyle = '#0a0c16'; rr(c, 0, 0, z, z, z * 0.15); c.fill();
        var g = c.createRadialGradient(z / 2, z / 2, 0, z / 2, z / 2, z * 0.72); g.addColorStop(0, rgba(sp.color, sp.active ? 0.4 : 0.18)); g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fillRect(0, 0, z, z);
        c.save(); c.shadowColor = sp.color; c.shadowBlur = z * (sp.active ? 0.22 : 0.13); c.strokeStyle = sp.active ? lighten(sp.color, 0.3) : sp.color; c.lineWidth = z * 0.05; rr(c, z * 0.08, z * 0.08, z * 0.84, z * 0.84, z * 0.12); c.stroke(); c.restore();
      }
    },
    synthwave: {
      name: 'Synthwave', ink: '#ffe6fb', sub: '#ff9ae8', ring: '#22d3ff', glyphColor: '#ff5ff0', labelWeight: 800,
      font: function (s, w) { return (w || 800) + ' ' + s + "px 'SF Pro Display',-apple-system,sans-serif"; },
      bg: function (c, z, sp) {
        var g = c.createLinearGradient(0, 0, 0, z); g.addColorStop(0, '#3a1069'); g.addColorStop(0.55, '#7d1f7f'); g.addColorStop(1, '#140720');
        c.fillStyle = g; rr(c, 0, 0, z, z, z * 0.15); c.fill();
        c.save(); rr(c, 0, 0, z, z, z * 0.15); c.clip();
        c.fillStyle = rgba(sp.color, 0.9); c.beginPath(); c.arc(z / 2, z * 0.42, z * 0.17, 0, 7); c.fill();
        c.strokeStyle = rgba('#ff5ff0', 0.45); c.lineWidth = 1; var hy = z * 0.62;
        for (var gy = hy; gy < z; gy += z * 0.1) { c.beginPath(); c.moveTo(0, gy); c.lineTo(z, gy); c.stroke(); }
        for (var vx = -3; vx <= 3; vx++) { c.beginPath(); c.moveTo(z / 2, hy); c.lineTo(z / 2 + vx * z * 0.42, z); c.stroke(); }
        c.restore();
        if (sp.active) { c.strokeStyle = '#22d3ff'; c.lineWidth = z * 0.045; rr(c, z * 0.05, z * 0.05, z * 0.9, z * 0.9, z * 0.12); c.stroke(); }
      }
    },
    terminal: {
      name: 'Terminal', ink: '#43ff9a', sub: '#1f9f5f', ring: '#43ff9a', glyphColor: '#43ff9a', labelWeight: 700, mono: true,
      font: function (s, w) { return (w || 700) + ' ' + s + "px ui-monospace,'SF Mono',Menlo,monospace"; },
      bg: function (c, z, sp) {
        c.fillStyle = '#02100a'; rr(c, 0, 0, z, z, z * 0.1); c.fill();
        if (sp.active) { c.fillStyle = rgba('#43ff9a', 0.1); rr(c, 0, 0, z, z, z * 0.1); c.fill(); }
        c.fillStyle = 'rgba(67,255,154,0.06)'; for (var y = 2; y < z; y += 3) c.fillRect(0, y, z, 1);
        c.strokeStyle = rgba('#43ff9a', sp.active ? 0.95 : 0.45); c.lineWidth = z * 0.035; rr(c, z * 0.06, z * 0.06, z * 0.88, z * 0.88, z * 0.06); c.stroke();
      }
    },
    aurora: {
      name: 'Aurora', ink: '#ffffff', sub: '#d4e6ff', ring: '#7cf7d4', labelWeight: 800,
      font: function (s, w) { return (w || 800) + ' ' + s + "px 'SF Pro Display',-apple-system,sans-serif"; },
      bg: function (c, z, sp) {
        var g = c.createLinearGradient(0, 0, z, z); g.addColorStop(0, lighten(sp.color, sp.active ? 0.25 : 0.05)); g.addColorStop(0.5, '#173059'); g.addColorStop(1, '#0a6b63');
        c.fillStyle = g; rr(c, 0, 0, z, z, z * 0.15); c.fill();
        var g2 = c.createRadialGradient(z * 0.3, z * 0.24, 0, z * 0.3, z * 0.24, z * 0.85); g2.addColorStop(0, rgba(sp.color, 0.55)); g2.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g2; rr(c, 0, 0, z, z, z * 0.15); c.fill();
        if (sp.active) { c.strokeStyle = '#7cf7d4'; c.lineWidth = z * 0.045; rr(c, z * 0.05, z * 0.05, z * 0.9, z * 0.9, z * 0.12); c.stroke(); }
      }
    },
    liquidglass: {
      name: 'Liquid Glass', ink: '#f2f5fa', sub: '#c3ccdd', ring: '#9fd8ff', labelWeight: 800,
      font: function (s, w) { return (w || 800) + ' ' + s + "px -apple-system,'SF Pro Display','Segoe UI',sans-serif"; },
      bg: function (c, z, sp) {
        // Smoked-glass keycap, per the app's liquid-glass doctrine: a near-black
        // base, a translucent accent tint, a top glass fill, and a hairline rim.
        // Depth from layered translucency only: no glow, no shadow.
        c.fillStyle = '#0d1016'; rr(c, 0, 0, z, z, z * 0.15); c.fill();
        c.save(); rr(c, 0, 0, z, z, z * 0.15); c.clip();
        var tint = c.createLinearGradient(0, 0, 0, z);
        tint.addColorStop(0, rgba(sp.color, sp.active ? 0.5 : 0.28)); tint.addColorStop(1, rgba(sp.color, sp.active ? 0.16 : 0.07));
        c.fillStyle = tint; c.fillRect(0, 0, z, z);
        var glass = c.createLinearGradient(0, 0, 0, z * 0.55);
        glass.addColorStop(0, 'rgba(255,255,255,0.11)'); glass.addColorStop(1, 'rgba(255,255,255,0.02)');
        c.fillStyle = glass; c.fillRect(0, 0, z, z * 0.55);
        c.restore();
        c.strokeStyle = sp.active ? rgba('#9fd8ff', 0.9) : 'rgba(255,255,255,0.2)';
        c.lineWidth = Math.max(1, z * (sp.active ? 0.03 : 0.016));
        rr(c, 0.5, 0.5, z - 1, z - 1, z * 0.15); c.stroke();
      }
    }
  };

  function glyphFor(a) {
    var id = a.keymapId || a.id || '';
    var m = { 'playout.go': 'play', 'playout.pause': 'pause', 'playout.stop': 'stop', 'playout.fade': 'fade', 'playout.panic': 'panic', 'rundown.next': 'next', 'rundown.back': 'prev', 'prompter.playpause': 'play', 'prompter.top': 'top', 'prompter.mirror': 'mirror', 'prompter.cue.current': 'target', 'prompter.size.up': 'up', 'prompter.size.down': 'down', 'prompter.speed.up': 'up', 'prompter.speed.down': 'down', 'ref.open': 'help' };
    if (m[id]) return m[id];
    switch (a.kind) {
      case 'talkback': return 'mic'; case 'talkbackPanic': return 'mic';
      case 'clock': return 'clock';
      case 'obs': return a.op === 'toggleStream' ? 'broadcast' : (a.op === 'toggleRecord' || a.op === 'pauseRecord' ? 'record' : (a.op === 'toggleVirtualCam' ? 'cam' : null));
      case 'obsScene': case 'obsSceneRef': return 'scene';
      case 'pad': case 'padRef': return 'sfx';
      case 'cue': case 'cueRef': return 'cue';
      case 'golive': return 'record';
      case 'layoutNext': case 'layoutRef': return 'pages';
      case 'fx': return 'star';
    }
    return null;
  }

  function fmtClockBig(secs) { secs = Math.max(0, Math.round(secs || 0)); var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60, p = function (n) { return (n < 10 ? '0' : '') + n; }; return h ? (h + ':' + p(m) + ':' + p(s)) : (m + ':' + p(s)); }

  // ── SF Symbols (the repo's design-system library) drawn onto the keys ───────
  // Runtime SVGs are monochrome mask shapes; we load, tint to the key ink, and
  // cache. Until a symbol loads, the vector glyph shows, so a key is never blank.
  var SYMBOL_BASE = 'design-system/apple/symbols/runtime/light-small/';
  var SYMBOL_KM = {
    'playout.go': 'media/play.fill.svg', 'playout.pause': 'media/pause.svg', 'playout.stop': 'media/stop.fill.svg',
    'playout.fade': 'editing/slider.vertical.3.svg', 'playout.panic': 'privacyandsecurity/exclamationmark.triangle.svg',
    'rundown.next': 'arrows/arrowshape.turn.up.right.fill.svg', 'rundown.back': 'arrows/arrowshape.turn.up.left.fill.svg',
    'prompter.playpause': 'textformatting/scroll.svg', 'prompter.top': 'arrows/arrow.up.to.line.svg',
    'prompter.size.up': 'objectsandtools/plus.magnifyingglass.svg', 'prompter.size.down': 'objectsandtools/minus.magnifyingglass.svg',
    'prompter.speed.up': 'nature/hare.svg', 'prompter.speed.down': 'nature/tortoise.svg',
    'prompter.dir.fwd': 'arrows/arrowshape.right.svg', 'prompter.dir.rev': 'arrows/arrowshape.left.svg',
    'prompter.fullscreen': 'arrows/square.arrowtriangle.4.outward.svg', 'prompter.hideui': 'arrows/arrow.up.right.and.arrow.down.left.svg',
    'prompter.mirror': 'media/display.2.svg', 'prompter.brake': 'nature/tortoise.svg', 'prompter.boost': 'nature/hare.svg',
    'prompter.nudge.back': 'arrows/chevron.left.svg', 'prompter.nudge.fwd': 'arrows/chevron.right.svg',
    'prompter.editscript': 'editing/pencil.svg', 'prompter.cue.current': 'textformatting/text.line.first.and.arrowtriangle.forward.svg',
    'ref.open': 'communication/questionmark.circle.fill.svg', 'scrub.open': 'media/waveform.path.svg'
  };
  // Curated, searchable subset of the repo's SF Symbol catalog for the key
  // editor's icon picker. Names are the plain words an operator would search.
  // Every path exists under SYMBOL_BASE and draws through the same Path2D
  // pipeline as the built-in key symbols.
  var SYMBOL_PICK = [
    ['Play', 'media/play.fill.svg'], ['Pause', 'media/pause.svg'], ['Stop', 'media/stop.fill.svg'],
    ['Play pause', 'media/playpause.circle.fill.svg'], ['Stop circle', 'media/stop.circle.svg'],
    ['Record', 'objectsandtools/circle.fill.svg'], ['Clapper', 'media/movieclapper.svg'],
    ['Film stack', 'media/film.stack.svg'], ['Popcorn', 'media/popcorn.svg'], ['TV', 'media/tv.svg'],
    ['Display', 'media/display.svg'], ['Two displays', 'media/display.2.svg'], ['Play display', 'media/play.display.svg'],
    ['Speaker', 'media/hifispeaker.svg'], ['Guitar', 'media/guitars.svg'],
    ['Mute', 'media/speaker.slash.svg'], ['Volume up', 'media/speaker.plus.svg'], ['Volume down', 'media/speaker.minus.svg'],
    ['Waveform', 'media/waveform.path.svg'], ['Waveform circle', 'media/waveform.circle.svg'], ['Waveform low', 'media/waveform.low.svg'],
    ['Microphone', 'editing/microphone.svg'], ['Stand mic', 'editing/microphone.dynamic.on.stand.svg'],
    ['Faders', 'editing/slider.vertical.3.svg'], ['Scissors', 'editing/scissors.svg'], ['Sparkles', 'editing/sparkles.svg'],
    ['Pencil', 'editing/pencil.svg'], ['Palette', 'editing/paintpalette.svg'], ['Draw', 'editing/hand.draw.svg'],
    ['Bell', 'objectsandtools/bell.svg'], ['Check', 'objectsandtools/checkmark.svg'], ['Clock', 'objectsandtools/clock.svg'],
    ['Gear', 'objectsandtools/gearshape.svg'], ['Hammer', 'objectsandtools/hammer.svg'], ['Wrench', 'objectsandtools/wrench.adjustable.svg'],
    ['Bulb', 'objectsandtools/lightbulb.svg'], ['Power', 'objectsandtools/power.svg'], ['Lock', 'objectsandtools/lock.fill.svg'],
    ['Repeat', 'objectsandtools/repeat.svg'], ['Grid', 'objectsandtools/square.grid.3x3.svg'], ['Stack', 'objectsandtools/square.stack.3d.up.svg'],
    ['Trash', 'objectsandtools/trash.svg'], ['X mark', 'objectsandtools/xmark.svg'], ['Balloon', 'objectsandtools/balloon.svg'],
    ['Pin', 'objectsandtools/pin.fill.svg'], ['Info', 'objectsandtools/info.circle.svg'], ['Bookmark', 'objectsandtools/bookmark.svg'],
    ['Timer', 'time/timer.svg'], ['Calendar', 'time/calendar.svg'],
    ['Arrow up', 'arrows/arrowshape.up.svg'], ['Arrow down', 'arrows/arrowshape.down.svg'],
    ['Arrow left', 'arrows/arrowshape.left.svg'], ['Arrow right', 'arrows/arrowshape.right.svg'],
    ['Undo', 'arrows/arrow.uturn.left.svg'], ['Redo', 'arrows/arrow.uturn.right.svg'],
    ['Refresh', 'arrows/arrow.counterclockwise.svg'], ['Share', 'arrows/square.and.arrow.up.svg'],
    ['Fullscreen', 'arrows/square.arrowtriangle.4.outward.svg'],
    ['Hare', 'nature/hare.svg'], ['Tortoise', 'nature/tortoise.svg'], ['Tree', 'nature/tree.svg'], ['Ladybug', 'nature/ladybug.fill.svg'],
    ['Sun', 'weather/sun.max.fill.svg'], ['Moon', 'weather/moon.svg'], ['Bolt', 'weather/cloud.bolt.svg'],
    ['Wind', 'weather/wind.svg'], ['Storm', 'weather/hurricane.svg'],
    ['Heart', 'health/heart.svg'], ['Cross', 'health/cross.svg'], ['Bandage', 'health/bandage.svg'],
    ['Person', 'human/person.crop.circle.fill.svg'], ['House', 'home/house.svg'], ['Location', 'maps/location.svg'],
    ['Question', 'communication/questionmark.circle.fill.svg'], ['Bubble', 'communication/plus.bubble.svg'],
    ['Scroll', 'textformatting/scroll.svg'], ['Checklist', 'textformatting/checklist.svg'], ['List', 'textformatting/list.bullet.svg'],
    ['Magazine', 'textformatting/magazine.svg'], ['Quote', 'textformatting/quote.bubble.svg'], ['Page', 'textformatting/text.page.svg'],
    ['Warning', 'privacyandsecurity/exclamationmark.triangle.svg'], ['Extinguisher', 'privacyandsecurity/fire.extinguisher.svg'],
    ['Frame', 'cameraandphotos/photo.artframe.svg'], ['Viewfinder', 'cameraandphotos/plus.viewfinder.svg']
  ];
  function symbolFor(a) {
    var id = a.keymapId || '';
    if (SYMBOL_KM[id]) return SYMBOL_KM[id];
    switch (a.kind) {
      case 'talkback': return 'editing/microphone.svg';
      case 'talkbackPanic': return 'media/speaker.slash.svg';
      case 'clock': return a.id === 'clock' ? null : 'objectsandtools/clock.svg';
      case 'golive': return 'media/play.display.svg';
      case 'pad': case 'padRef': return 'media/waveform.path.svg';
      case 'cue': case 'cueRef': return 'media/movieclapper.svg';
      case 'layoutNext': return 'objectsandtools/repeat.svg';
      case 'layoutRef': return 'objectsandtools/square.stack.3d.up.svg';
      case 'obs': return a.op === 'toggleStream' ? 'media/waveform.circle.svg' : a.op === 'toggleRecord' ? 'objectsandtools/circle.fill.svg' : a.op === 'pauseRecord' ? 'media/pause.svg' : a.op === 'toggleVirtualCam' ? 'cameraandphotos/plus.viewfinder.svg' : a.op === 'saveReplay' ? 'editing/scissors.svg' : a.op === 'studioTransition' ? 'arrows/arrow.up.right.and.arrow.down.left.svg' : null;
      case 'obsScene': case 'obsSceneRef': return 'cameraandphotos/photo.artframe.svg';
      case 'obsMuteRef': return 'media/speaker.slash.svg';
      case 'fx': return 'editing/sparkles.svg';
    }
    return null;
  }
  // Fetch the SVG text and draw its paths natively with Path2D. This is crisp at
  // any size and, unlike drawing an <img>, can NEVER taint the canvas, so the
  // device's toBlob() encode always works.
  var _sym = {};   // path -> { vb:[minX,minY,w,h], paths:[d...] } | 'loading' | 'error'
  function loadSymbol(path) {
    if (_sym[path] !== undefined) return;
    _sym[path] = 'loading';
    fetch(SYMBOL_BASE + path).then(function (r) { return r.ok ? r.text() : Promise.reject(); }).then(function (text) {
      var vb = /viewBox="([^"]+)"/.exec(text);
      var nums = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : [0, 0, 100, 100];
      var paths = [], re = /<path[^>]*\sd="([^"]+)"/g, m;
      while ((m = re.exec(text))) paths.push(m[1]);
      _sym[path] = { vb: nums, paths: paths };
      schedulePaint(); paintMirror();
    }).catch(function () { _sym[path] = 'error'; });
  }
  function symbolReady(path) { var v = _sym[path]; return !!(v && v !== 'loading' && v !== 'error'); }
  function drawSymbolPath(ctx, path, cx, cy, box, color) {
    var sym = _sym[path]; if (!sym || !sym.paths || !sym.paths.length) return false;
    var vb = sym.vb, vw = vb[2] || 1, vh = vb[3] || 1, scale = box / Math.max(vw, vh);
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-(vb[0] + vw / 2), -(vb[1] + vh / 2));
    ctx.fillStyle = color;
    for (var k = 0; k < sym.paths.length; k++) { try { ctx.fill(new Path2D(sym.paths[k])); } catch (e) {} }
    ctx.restore(); return true;
  }
  function ensureSymbols() { var m = mapping(); if (!m || !m.keys) return; m.keys.forEach(function (slot) { var a = catalog[(typeof slot === 'string' ? slot : slot.a)]; if (a) { var p = symbolFor(a); if (p) loadSymbol(p); } }); }

  // ── Playout progress for key art ────────────────────────────────────────────
  // Same-tab Outrangutan is the preferred truth: padProgress/cueProgress read
  // LOCAL playback state (never Firestore echoes). When the deck rides a tab
  // without Outrangutan, the bridge playout snapshot is the fallback. Playing
  // keys get the duration wipe, pre-wait gets the thin bottom pre-roll bar,
  // loop pads get a static corner marker (a loop has no end to count down to).
  function ogAccessors() { var o = window.Outrangutan; return (o && typeof o.padProgress === 'function' && typeof o.cueProgress === 'function') ? o : null; }
  function slotPadId(a, slot, s) {
    if (a.kind === 'padRef') return slot.ref || null;
    if (a.kind === 'pad') { var map = (s.playout && s.playout.pads) || {}; return Object.keys(map)[a.slot - 1] || null; }
    return null;
  }
  function slotCueId(a, slot, s) {
    if (a.kind === 'cueRef') return slot.ref || null;
    if (a.kind === 'cue') { var map = (s.playout && s.playout.cues) || {}; return Object.keys(map)[a.slot - 1] || null; }
    return null;
  }
  function applyPlayoutProgress(spec, a, slot, s) {
    var og = ogAccessors();
    var padId = slotPadId(a, slot, s);
    if (padId) {
      if (!og) return;   // pads have no bridge progress; stay quiet cross-tab
      try {
        var pp = og.padProgress(padId);
        if (!pp || !pp.playing) return;
        if (pp.loop || pp.frac == null) { spec.looping = true; return; }
        spec.progress = Math.max(0, Math.min(1, pp.frac)); spec.phase = 'playing'; spec.progressStyle = 'wipe';
      } catch (e) {}
      return;
    }
    var isGo = a.keymapId === 'playout.go';
    var cueId = slotCueId(a, slot, s);
    if (!isGo && !cueId) return;
    if (og) {
      try {
        var cp = og.cueProgress();
        if (!cp || (cueId && cp.cueId !== cueId)) return;
        if (cp.phase === 'prewait') { spec.preroll = Math.max(0, Math.min(1, cp.frac || 0)); return; }
        if ((cp.phase === 'playing' || cp.phase === 'paused') && cp.frac != null) { spec.progress = Math.max(0, Math.min(1, cp.frac)); spec.phase = 'playing'; spec.progressStyle = 'wipe'; }
      } catch (e) {}
      return;
    }
    var po = s.playout || {};
    if (po.status !== 'play' || !po.dur) return;
    if (cueId && po.cueId !== cueId) return;
    spec.progress = Math.max(0, Math.min(1, 1 - (po.remaining || 0) / po.dur));
    spec.phase = 'playing'; spec.progressStyle = 'wipe';
  }

  // Per-key appearance overrides live as additive fields on the slot (label,
  // hideLabel, color, icon, symbol, style, flash, reactive). Absent = the
  // defaults every existing profile already had: auto look, wipe progress,
  // press flash on, reactive on. Old saved profiles need no migration.
  function keyArtSpec(i, s) {
    var slot = slotAt(i), a = slotAction(slot);
    var active = slotActive(slot, s) || keyState[i];
    var spec = { color: slotColor(slot), label: slot.hideLabel ? '' : slotLabel(slot, s), active: active, pressed: keyState[i], toggle: !!a.toggle, editing: (i === editingKey) };
    spec.flash = (pressFlashUntil[i] || 0) > performance.now();
    if (slot.flash === false) { spec.flash = false; spec.pressed = false; }   // press flash opted out
    spec.emoji = (slot.icon != null ? slot.icon : (a.icon || '')) || '';
    if (slot.symbol) { spec.symbol = slot.symbol; spec.emoji = ''; }          // picked symbol wins
    else if (!spec.emoji) { spec.symbol = symbolFor(a); spec.glyph = glyphFor(a); }
    if (a.id === 'clock') { spec.widget = 'clock'; spec.clockText = fmtClockBig(s.clock && s.clock.elapsed); spec.clockRunning = !!(s.clock && s.clock.running); }
    if (slot.reactive !== false) {   // a key can opt out of animation entirely
      applyPlayoutProgress(spec, a, slot, s);
      if (slot.style && spec.progress != null) spec.progressStyle = slot.style;   // wipe | ring | bar
      if (active && ((a.kind === 'obs' && (a.op === 'toggleStream' || a.op === 'toggleRecord')) || a.kind === 'golive' || a.kind === 'talkback')) { spec.pulse = true; spec.pulseColor = (a.op === 'toggleRecord') ? '#f5b731' : (a.kind === 'talkback' ? '#22d3a0' : '#ff3b3b'); }
    }
    return spec;
  }
  // The full dynamic state rides the signature, so the unconditional paint tick
  // repaints exactly the keys whose art actually changed: playout progress and
  // phase (quantized to 20 steps), pre-roll, loop marker, pulse lamps (talkback,
  // OBS stream/record, GO LIVE), the press flash, prompter/lamp active state,
  // and the show clock readout.
  function specSig(spec, i) { return [i, spec.active, spec.pressed, spec.editing, spec.label, spec.color, spec.emoji, spec.symbol, spec.symbol ? (symbolReady(spec.symbol) ? '1' : '0') : '', spec.glyph, spec.toggle, spec.widget, spec.progress == null ? '' : Math.round(spec.progress * 20), spec.progressStyle || '', spec.preroll == null ? '' : Math.round(spec.preroll * 20), spec.phase || '', spec.pulse ? '1' : '', spec.looping ? '1' : '', spec.flash ? '1' : '', spec.clockText || '', spec.clockRunning ? '1' : '', deckTheme].join('|'); }

  function drawKeyInto(canvas, spec, z) {
    var ctx = canvas.getContext('2d'); if (!ctx) return;
    var t = theme();
    ctx.clearRect(0, 0, z, z);
    ctx.save(); try { t.bg(ctx, z, spec); } catch (e) {} ctx.restore();
    var ink = t.ink, gcol = spec.glyphColor || t.glyphColor || ink;
    if (spec.widget === 'clock') {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = t.sub; ctx.font = t.font(Math.round(z * 0.13), 700); ctx.fillText(spec.clockRunning ? 'ON AIR' : 'CLOCK', z / 2, z * 0.24);
      ctx.fillStyle = ink; ctx.font = t.font(Math.round(z * 0.24), 800); ctx.fillText(spec.clockText || '0:00', z / 2, z * 0.52);
      if (spec.clockRunning) { var ph = (spec.pulsePhase || 0); var al = 0.45 + 0.45 * Math.sin(ph * 0.5); ctx.fillStyle = rgba('#ff3b3b', al); ctx.beginPath(); ctx.arc(z / 2, z * 0.76, z * 0.06, 0, 7); ctx.fill(); }
    } else {
      // Duration wipe: the default for playing SFX/playback keys. A translucent
      // accent fill sweeps left to right BEHIND the icon and label, with a
      // sharp leading edge. No glow, no shadow (UI doctrine, and the same
      // convention as the Outrangutan key renderer).
      if (spec.progress != null && spec.progressStyle === 'wipe') {
        ctx.save(); rr(ctx, 0, 0, z, z, z * 0.15); ctx.clip();
        ctx.fillStyle = rgba(t.ring, 0.34); ctx.fillRect(0, 0, Math.round(z * spec.progress), z);
        ctx.restore();
      }
      // Loop pads carry a static corner marker instead of a wipe.
      if (spec.looping) { var mk = Math.max(3, Math.round(z * 0.1)); ctx.fillStyle = t.ring; ctx.fillRect(z - z * 0.08 - mk, z * 0.08, mk, mk); }
      var hasLabel = spec.label && spec.label.length;
      var gy = hasLabel ? z * 0.37 : z * 0.5, gr = z * (hasLabel ? 0.2 : 0.26);
      var drew = false;
      if (spec.emoji) { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = Math.round(z * (hasLabel ? 0.4 : 0.56)) + "px -apple-system,'Apple Color Emoji','Segoe UI Emoji'"; ctx.fillText(spec.emoji, z / 2, gy); drew = true; }
      else if (spec.symbol) { if (symbolReady(spec.symbol)) drew = drawSymbolPath(ctx, spec.symbol, z / 2, gy, z * (hasLabel ? 0.46 : 0.62), gcol); else loadSymbol(spec.symbol); }
      if (!drew && spec.glyph && GLYPHS[spec.glyph]) { ctx.save(); try { GLYPHS[spec.glyph](ctx, z / 2, gy, gr, gcol); } catch (e) {} ctx.restore(); }
      if (hasLabel) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = ink;
        var lines = String(spec.label).split('\n'); var fs = Math.round(z * (lines.length > 1 ? 0.15 : 0.17));
        var maxw = z * 0.86; ctx.font = t.font(fs, t.labelWeight);
        while (fs > 9 && lines.some(function (ln) { return ctx.measureText(ln).width > maxw; })) { fs -= 1; ctx.font = t.font(fs, t.labelWeight); }
        var baseY = z * ((spec.glyph || spec.emoji || spec.symbol) ? 0.8 : 0.5) - (lines.length - 1) * fs * 0.6;
        lines.forEach(function (ln, k) { ctx.fillText(ln, z / 2, baseY + k * fs * 1.15); });
      }
      // Ring style: a hairline track circle plus a sharp accent arc from 12
      // o'clock. Same doctrine as the wipe: crisp edges, no glow, no shadow.
      if (spec.progress != null && spec.progressStyle === 'ring') {
        var rrad = z * 0.42, rlw = Math.max(2, z * 0.055);
        ctx.lineWidth = rlw; ctx.lineCap = 'butt';
        ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.beginPath(); ctx.arc(z / 2, z / 2, rrad, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = t.ring; ctx.beginPath(); ctx.arc(z / 2, z / 2, rrad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * spec.progress); ctx.stroke();
      } else if (spec.progress != null && spec.progressStyle !== 'wipe') { var bw = z * 0.76, bx = z * 0.12, by = z * 0.9; ctx.fillStyle = 'rgba(255,255,255,0.18)'; rr(ctx, bx, by, bw, z * 0.05, z * 0.025); ctx.fill(); ctx.fillStyle = t.ring; rr(ctx, bx, by, bw * spec.progress, z * 0.05, z * 0.025); ctx.fill(); }
      // Pre-roll: a thin bottom bar counts the pre-wait up, distinct from the
      // playing wipe so an armed cue reads differently from a rolling one.
      if (spec.preroll != null) {
        var pbh = Math.max(2, Math.round(z * 0.05)), pby = z - pbh - Math.round(z * 0.04), pbx = Math.round(z * 0.05), pbw = Math.round(z * 0.9);
        ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(pbx, pby, pbw, pbh);
        ctx.fillStyle = t.ring; ctx.fillRect(pbx, pby, Math.round(pbw * spec.preroll), pbh);
      }
    }
    if (spec.toggle) { var on = spec.active; ctx.fillStyle = on ? t.ring : 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.arc(z * 0.86, z * 0.14, z * 0.055, 0, 7); ctx.fill(); }
    if (spec.pulse) { var pp = (spec.pulsePhase || 0), a2 = 0.35 + 0.4 * Math.sin(pp * 0.5); ctx.strokeStyle = rgba(spec.pulseColor || '#ff3b3b', a2); ctx.lineWidth = z * 0.05; rr(ctx, z * 0.03, z * 0.03, z * 0.94, z * 0.94, z * 0.14); ctx.stroke(); }
    // Press flash: a brief white overlay on key input (SD_PRESS_FLASH_MS), and
    // the same overlay while the key is physically held. It composes with the
    // active ring and the progress wipe; it never replaces them.
    if (spec.pressed || spec.flash) { ctx.fillStyle = 'rgba(255,255,255,0.3)'; rr(ctx, 0, 0, z, z, z * 0.15); ctx.fill(); }
  }

  // ── Serialized HID write queue ─────────────────────────────────────────────
  // WebHID gives no framing guarantee across callers: a key image is a
  // multi-packet message, and two writers interleaving on the same pipe garble
  // frames on the hardware. EVERY device write (key images, the strip,
  // brightness and reset features, light shows, test patterns) goes through
  // this one FIFO queue. Image jobs coalesce by slot key: if a newer image for
  // the same key (or the strip) is queued before the older one started, the
  // older is dropped, so a burst of state changes paints the newest art, never
  // the backlog.
  var hidWriteQueue = [], hidWriteBusy = false;
  function queueDeviceWrite(slotKey, job) {
    return new Promise(function (resolve, reject) {
      if (slotKey != null) {
        for (var i = 0; i < hidWriteQueue.length; i++) {
          if (hidWriteQueue[i].slotKey === slotKey) { hidWriteQueue.splice(i, 1)[0].resolve(false); break; }
        }
      }
      hidWriteQueue.push({ slotKey: slotKey, job: job, resolve: resolve, reject: reject });
      drainDeviceWrites();
    });
  }
  async function drainDeviceWrites() {
    if (hidWriteBusy) return;
    hidWriteBusy = true;
    while (hidWriteQueue.length) {
      var next = hidWriteQueue.shift();
      try { await next.job(); next.resolve(true); }
      catch (e) { next.reject(e); }
    }
    hidWriteBusy = false;
  }
  function flushDeviceWrites() { while (hidWriteQueue.length) hidWriteQueue.shift().resolve(false); }

  // ── Painting ──────────────────────────────────────────────────────────────
  function startPaintLoop() { stopPaintLoop(); paintTimer = setInterval(paintTick, Math.round(1000 / PAINT_HZ)); }
  function stopPaintLoop() { if (paintTimer) clearInterval(paintTimer); paintTimer = null; }
  var paintScheduled = false;
  function schedulePaint() { paintScheduled = true; }
  function paintTick() {
    // Push reactivity: EVERY tick diffs and repaints, no event has to remember
    // to call schedulePaint. specSig carries the full dynamic state and the
    // strip is sig-deduped, so idle ticks are nearly free.
    paintScheduled = false;
    paintChanged();
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
  // Offscreen canvases for device encoding (upright + rotated).
  var _off = null, _rot = null;
  function offCanvas(z) { if (!_off) _off = document.createElement('canvas'); if (_off.width !== z) { _off.width = z; _off.height = z; } return _off; }
  function rotCanvas(z) { if (!_rot) _rot = document.createElement('canvas'); if (_rot.width !== z) { _rot.width = z; _rot.height = z; } return _rot; }
  // The one source of truth for how key art is rotated on its way to the deck:
  // the model's own orientation plus its fixed mount offset. Deliberately NOT
  // operator-adjustable — 270 is the + XL's real physical orientation, and any
  // other value just paints the keys wrong.
  function keyDeg() { return profile ? ((((profile.rotation || 0) + (profile.mountRotation || 0)) % 360) + 360) % 360 : 0; }
  async function keyJpegFromCanvas(cv, z) {
    var out = cv, deg = keyDeg();
    if (deg) { var rc = rotCanvas(z), rx = rc.getContext('2d'); rx.clearRect(0, 0, z, z); rx.save(); rx.translate(z / 2, z / 2); rx.rotate(deg * Math.PI / 180); rx.translate(-z / 2, -z / 2); rx.drawImage(cv, 0, 0); rx.restore(); out = rc; }
    var blob = await new Promise(function (res) { out.toBlob(res, 'image/jpeg', 0.9); });
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }
  // The draw + encode happens INSIDE the queued job (the offscreen canvas is
  // shared, so it must be serialized along with the packet writes).
  function paintKeyDevice(i, spec) {
    if (!device || !profile) return Promise.resolve(false);
    return queueDeviceWrite('key:' + i, async function () {
      if (!device || !profile) return;
      var z = profile.keyPx, cv = offCanvas(z);
      drawKeyInto(cv, spec, z);
      try { var bytes = await keyJpegFromCanvas(cv, z); if (!bytes) return; var packets = Device.keyImagePackets(profile, i, bytes); for (var pk = 0; pk < packets.length; pk++) { if (!device) return; await device.hid.sendReport(packets[pk].reportId, packets[pk].data); } } catch (e) {}
    });
  }
  function mirrorCanvasFor(i) { var r = root(); if (!r) return null; var btn = r.querySelector('.sd-key[data-key="' + i + '"]'); return btn ? btn.querySelector('canvas') : null; }
  // The on-screen grid shows the SAME art the hardware shows: true WYSIWYG.
  function paintMirror() { var cur = profile; if (!cur) return; var s = surfaceState(); for (var i = 0; i < cur.keys; i++) { var cv = mirrorCanvasFor(i); if (cv) { var spec = keyArtSpec(i, s); spec.editing = (i === editingKey); drawKeyInto(cv, spec, cv.width); } } }
  async function paintAll() { var cur = profile; ensureSymbols(); lastPainted = new Array(cur ? cur.keys : 0).fill(null); paintMirror(); await paintChanged(); if (device || previewMode) await paintStrip(true); }
  async function paintChanged() {
    var cur = profile; if (!cur) return;
    var s = surfaceState();
    for (var i = 0; i < cur.keys; i++) {
      var spec = keyArtSpec(i, s); var sig = specSig(spec, i);
      if (sig === lastPainted[i]) continue; lastPainted[i] = sig;
      var cv = mirrorCanvasFor(i); if (cv) drawKeyInto(cv, spec, cv.width);
      if (device) await paintKeyDevice(i, spec);
    }
    if (device || previewMode) await paintStrip(false);
  }
  // Animation loop: clock ticks, pulse lamps, playout wipes and pre-rolls, and
  // press flashes all animate. Only animated keys repaint, on-screen every
  // ~7.7fps; device writes ride the serialized queue, throttled to ~4fps.
  function startAnim() { stopAnim(); animTimer = setInterval(animateKeys, 130); }
  function stopAnim() { if (animTimer) clearInterval(animTimer); animTimer = null; }
  function isSurfaceVisible() { var scr = document.getElementById('streamdeck'); return !!(scr && scr.classList.contains('on')); }
  function specAnimated(spec) { return (spec.widget === 'clock' && spec.clockRunning) || !!spec.pulse || spec.progress != null || spec.preroll != null || !!spec.phase || !!spec.looping || !!spec.flash; }
  function animateKeys() {
    if (!profile || hypeRunning || !isSurfaceVisible()) return;
    animPhase++;
    var s = surfaceState(), cur = profile, r = root();
    for (var i = 0; i < cur.keys; i++) {
      var spec = keyArtSpec(i, s);
      if (!specAnimated(spec)) continue;
      spec.pulsePhase = animPhase;
      if (r) { var cv = mirrorCanvasFor(i); if (cv) drawKeyInto(cv, spec, cv.width); }
      // Stamp the signature so the paint tick does not double-write the same
      // frame; the queue coalesces any stale image still waiting for this key.
      if (device && animPhase % 2 === 0) { lastPainted[i] = specSig(spec, i); paintKeyDevice(i, spec); }
    }
  }
  // The HYPE key: a rainbow ripple parties across the whole deck, then restores.
  async function hypeShow() {
    var cur = profile; if (!cur || hypeRunning) return; hypeRunning = true;
    for (var f = 0; f < 16 && (device || previewMode); f++) {
      for (var i = 0; i < cur.keys; i++) { var hue = (((i % cur.cols) + Math.floor(i / cur.cols)) * 22 + f * 45) % 360; var cv = mirrorCanvasFor(i); if (cv) drawKeyInto(cv, { color: 'hsl(' + hue + ',85%,52%)', label: '' }, cv.width); }
      await new Promise(function (r) { setTimeout(r, 55); });
    }
    hypeRunning = false; lastPainted = new Array(cur.keys).fill(null); paintMirror();
    if (device) connectLightShow().then(function () { return paintAll(); }); else paintAll();
    toast('🎉 HYPE!');
  }
  async function paintStrip(force) {
    if (!profile || !profile.strip || (!device && !previewMode)) return;
    var s = surfaceState(), cells = [];
    for (var z = 0; z < profile.strip.zones; z++) {
      var dialId = mapping().dials[(mapping().touch[z] || { dial: z }).dial];
      var c = DIAL_CONTROLLERS[dialId];
      var cell = {
        title: c ? c.label : '', value: c ? String(c.readout(s)) : '', tap: c ? c.pressLabel : '',
        hue: (c && c.hue) || '#5b8df8',
        bar: c && c.bar ? (c.bar(s) == null ? null : Math.max(0, Math.min(1, c.bar(s) || 0))) : null,
        live: !!(c && c.live && c.live(s)),
        obsFrame: !!(c && c.obsFrame)
      };
      if (c && c.micoSplit) {
        // Quantized levels keep the paint signature calm: at most ~5 strip
        // repaints a second while audio is actually moving.
        cell.micoSplit = true; cell.tkb = !!talkbackState.A; cell.vofu = !!talkbackState.B; cell.tbOn = !!talkbackState.connected;
        if (talkbackState.hasLevels) {
          var lv = talkbackState.levels;
          cell.la = Math.round(Math.min(1, talkbackState.A ? lv.a : lv.mic) * 8);
          cell.lb = Math.round(Math.min(1, talkbackState.B ? lv.b : lv.mic) * 8);
        }
      }
      cells.push(cell);
    }
    ensureObsFrameLoop();
    var sig = JSON.stringify(cells);
    var changed = force || sig !== lastStripSig;
    if (changed) drawStripMirrorCanvas(cells);   // the on-screen strip: always live, hardware or not
    if (stripProbeActive) return;                // don't fight the format probe mid-cycle
    if (!changed) return;
    lastStripSig = sig;
    if (!device) return;                         // preview mode: mirror only
    await queueDeviceWrite('strip', async function () {
      if (!device) return;
      try { var bytes = await renderStripJpeg(cells); if (!bytes) return; var packets = Device.stripImagePackets(profile, bytes); for (var pk = 0; pk < packets.length; pk++) { if (!device) return; await device.hid.sendReport(packets[pk].reportId, packets[pk].data); } }
      catch (e) {
        console.error('[KeyWi] strip paint failed:', e);
        if (!stripErrToasted) { stripErrToasted = true; toast('Touch strip error: ' + ((e && e.message) || e)); }
      }
    });
  }
  function drawStripMirrorCanvas(cells) {
    var cv = document.getElementById('sd-strip-mirror'); if (!cv) return;
    var ctx = cv.getContext('2d'); if (!ctx) return;
    try { drawStripContent(ctx, cells, cv.width, cv.height); } catch (e) {}
  }
  // ── Strip format probe ──────────────────────────────────────────────────────
  // The + XL's window protocol has open questions this firmware can answer for
  // us: partial (0x0c) vs full-window (0x0b) command × rotated (100×1200) vs
  // flat (1200×100) JPEG. On connect, paint a giant numbered card in each of
  // the four formats for a few seconds; whichever number the owner SEES on the
  // physical strip is the format this firmware speaks. One glance, no knobs.
  var stripProbeActive = false, stripErrToasted = false;
  var STRIP_PROBE_VARIANTS = [
    { n: 1, rotate: true,  cmd: 0x0c, color: '#0f4c81' },   // node-lib style
    { n: 2, rotate: false, cmd: 0x0c, color: '#17653a' },
    { n: 3, rotate: true,  cmd: 0x0b, color: '#a4741e' },
    { n: 4, rotate: false, cmd: 0x0b, color: '#5a2a8a' }
  ];
  async function sendStripVariant(v) {
    var w = profile.strip.w, h = profile.strip.h;
    var content = document.createElement('canvas'); content.width = w; content.height = h;
    var ctx = content.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = v.color; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
    ctx.font = '700 78px -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(String(v.n), w / 2, h / 2 + 28);
    ctx.font = '600 20px -apple-system, "Segoe UI", sans-serif';
    ctx.fillText('STRIP TEST', w / 2 - 220, h / 2 + 8);
    ctx.fillText('STRIP TEST', w / 2 + 220, h / 2 + 8);
    var out = content;
    if (v.rotate) {
      var dev2 = document.createElement('canvas'); dev2.width = h; dev2.height = w;
      var d2 = dev2.getContext('2d'); if (!d2) return;
      d2.translate(h / 2, w / 2); d2.rotate(-Math.PI / 2); d2.drawImage(content, -w / 2, -h / 2);
      out = dev2;
    }
    var blob = await new Promise(function (res) { out.toBlob(res, 'image/jpeg', 0.85); });
    if (!blob) return;
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var packets = (v.cmd === 0x0b) ? Device.stripWindowPackets(profile, bytes) : Device.stripImagePackets(profile, bytes);
    console.log('[KeyWi] strip probe ' + v.n + ': cmd 0x' + v.cmd.toString(16) + ', jpeg ' + (v.rotate ? h + '×' + w : w + '×' + h) + ', ' + bytes.length + ' bytes, ' + packets.length + ' packets');
    // Probe frames must all reach the panel, so no coalescing key here; the
    // queue still serializes them against every other write.
    await queueDeviceWrite(null, async function () {
      for (var pk = 0; pk < packets.length; pk++) { if (!device) return; await device.hid.sendReport(packets[pk].reportId, packets[pk].data); }
    });
  }
  async function stripProbe() {
    if (!device || !profile || !profile.strip || stripProbeActive) return;
    stripProbeActive = true;
    toast('Strip check: watch the touch strip and remember which big NUMBER (1-4) shows up.');
    for (var i = 0; i < STRIP_PROBE_VARIANTS.length; i++) {
      var v = STRIP_PROBE_VARIANTS[i];
      try { await sendStripVariant(v); }
      catch (e) { console.warn('[KeyWi] strip probe ' + v.n + ' send failed:', (e && e.message) || e); }
      await new Promise(function (r) { setTimeout(r, 2600); });
      if (!device) break;
    }
    stripProbeActive = false;
    lastStripSig = '';
    try { await paintStrip(true); } catch (e) {}
  }
  // ── OBS-on-the-strip: a low-fps program monitor in any strip zone ────────────
  var obsFrameImg = null, obsFrameBusy = false, obsFrameLoop = null;
  function stripHasObsFrame() {
    if (!profile || !profile.strip) return false;
    var m = mapping();
    for (var z = 0; z < profile.strip.zones; z++) { var c = DIAL_CONTROLLERS[m.dials[(m.touch[z] || { dial: z }).dial]]; if (c && c.obsFrame) return true; }
    return false;
  }
  function ensureObsFrameLoop() {
    var want = !!((device || previewMode) && isSurfaceVisible() && stripHasObsFrame());
    if (want && !obsFrameLoop) obsFrameLoop = setInterval(pollObsFrame, 250);
    else if (!want && obsFrameLoop) { clearInterval(obsFrameLoop); obsFrameLoop = null; if (obsFrameImg) { obsFrameImg = null; paintStrip(true); } }
  }
  async function pollObsFrame() {
    if ((!device && !previewMode) || !isSurfaceVisible() || !stripHasObsFrame()) { if (obsFrameLoop) { clearInterval(obsFrameLoop); obsFrameLoop = null; } return; }
    if (obsFrameBusy || !profile || !profile.strip) return;
    var o = OBSc();
    if (!o || !o.isReady || !o.isReady()) { if (obsFrameImg) { obsFrameImg = null; paintStrip(true); } return; }
    var scene = obsState().currentScene; if (!scene) return;
    obsFrameBusy = true;
    try {
      var rd = await o.request('GetSourceScreenshot', { sourceName: scene, imageFormat: 'jpg', imageWidth: 480, imageHeight: 270 });
      var data = rd && rd.imageData;
      if (data) { await new Promise(function (res) { var img = new Image(); img.onload = function () { obsFrameImg = img; res(); }; img.onerror = function () { res(); }; img.src = data; }); await paintStrip(true); }
    } catch (e) { /* stalled OBS: skip this frame, keep last image */ }
    obsFrameBusy = false;
  }
  // The strip is a glanceable dashboard: one zone per dial. Accent line in the
  // dial's hue, the big value in tabular digits, a progress bar for continuous
  // things, a breathing dot when its thing is running, and the press action in
  // small type so nobody has to remember what a tap does. Drawn in the strip's
  // logical space; stripBytesFromContent handles the device's encode rotation.
  function drawStripContent(ctx, cells, cw, ch) {
    ctx.fillStyle = '#07090d'; ctx.fillRect(0, 0, cw, ch);
    var zw = cw / cells.length;
    cells.forEach(function (cell, i) {
      var x0 = i * zw, x = x0 + zw / 2;
      if (cell.obsFrame) {
        // Live OBS program monitor for this zone (cover-fit the latest frame).
        if (obsFrameImg && obsFrameImg.width) {
          var iw = obsFrameImg.width, ih = obsFrameImg.height, zr = (zw - 4) / (ch - 4), ir = iw / ih, sw, sh, sx, sy;
          if (ir > zr) { sh = ih; sw = ih * zr; sx = (iw - sw) / 2; sy = 0; } else { sw = iw; sh = iw / zr; sx = 0; sy = (ih - sh) / 2; }
          try { ctx.drawImage(obsFrameImg, sx, sy, sw, sh, x0 + 2, 2, zw - 4, ch - 4); } catch (e) {}
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x0 + 2, 2, zw - 4, ch - 4);
          ctx.textAlign = 'center'; ctx.fillStyle = '#6b7690'; ctx.font = '600 13px -apple-system, "Segoe UI", sans-serif';
          ctx.fillText(cell.value === 'off' ? 'OBS off' : 'OBS…', x, ch / 2 + 4);
        }
        if (cell.live) { ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 2; ctx.strokeRect(x0 + 3, 3, zw - 6, ch - 6); ctx.textAlign = 'left'; ctx.fillStyle = '#ff3b3b'; ctx.font = '700 12px -apple-system, "Segoe UI", sans-serif'; ctx.fillText('● LIVE', x0 + 8, 17); }
        // Stream-audio volume rides this zone's dial: a slim fader over the frame.
        if (cell.bar != null) {
          var vbw = zw - 24, vbx = x0 + 12, vby = ch - 12;
          ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(vbx - 3, vby - 3, vbw + 6, 10);
          ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(vbx, vby, vbw, 4);
          ctx.fillStyle = cell.hue; ctx.fillRect(vbx, vby, Math.round(vbw * cell.bar), 4);
        }
        return;
      }
      if (cell.micoSplit) {
        // One block, split in half: TKB left, VofU right. A half lights green
        // while its mic is live; small meter under each when the daemon speaks
        // levels. Tap anywhere on the zone = all talk off.
        var hw = (zw - 10) / 2;
        [['TKB', cell.tkb, cell.la], ['VofU', cell.vofu, cell.lb]].forEach(function (side, k) {
          var sx0 = x0 + 3 + k * (hw + 4);
          var on = !!side[1];
          ctx.fillStyle = on ? 'rgba(34,211,160,0.26)' : 'rgba(255,255,255,0.05)';
          ctx.fillRect(sx0, 3, hw, ch - 6);
          ctx.strokeStyle = on ? '#22d3a0' : 'rgba(255,255,255,0.14)';
          ctx.lineWidth = on ? 3 : 1;
          ctx.strokeRect(sx0 + 1.5, 4.5, hw - 3, ch - 9);
          ctx.textAlign = 'center';
          ctx.fillStyle = on ? '#ffffff' : '#98a2b8';
          ctx.font = '800 26px -apple-system, "Segoe UI", sans-serif';
          ctx.fillText(side[0], sx0 + hw / 2, ch / 2 - 4);
          ctx.font = '700 13px -apple-system, "Segoe UI", sans-serif';
          ctx.fillStyle = on ? '#22d3a0' : '#6b7690';
          ctx.fillText(cell.tbOn ? (on ? '● LIVE' : 'off') : 'daemon off', sx0 + hw / 2, ch / 2 + 18);
          if (side[2] != null) {
            var mbw = hw - 24, mbx = sx0 + 12, mby = ch - 13;
            ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(mbx, mby, mbw, 4);
            ctx.fillStyle = on ? '#22d3a0' : 'rgba(152,162,184,0.7)';
            ctx.fillRect(mbx, mby, Math.round(mbw * Math.min(1, side[2] / 8)), 4);
          }
        });
        return;
      }
      // zone plate with a faint hue wash so zones read as separate touch targets
      var grad = ctx.createLinearGradient(x0, 0, x0, ch);
      grad.addColorStop(0, 'rgba(255,255,255,0.05)'); grad.addColorStop(1, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = grad; ctx.fillRect(x0 + 3, 3, zw - 6, ch - 6);
      ctx.fillStyle = cell.hue; ctx.fillRect(x0 + 10, 4, zw - 20, 3);       // accent line
      if (cell.live) { ctx.beginPath(); ctx.arc(x0 + zw - 14, 16, 5, 0, Math.PI * 2); ctx.fill(); }
      ctx.textAlign = 'center';
      ctx.fillStyle = '#98a2b8'; ctx.font = '600 14px -apple-system, "Segoe UI", sans-serif';
      ctx.fillText(String(cell.title || '').toUpperCase(), x, 25);
      ctx.fillStyle = '#ffffff'; ctx.font = '700 36px ui-monospace, "SF Mono", Menlo, monospace';
      ctx.fillText(cell.value, x, 63);
      if (cell.bar != null) {
        var bw = zw - 28, bx = x0 + 14, by = ch - 26;
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(bx, by, bw, 5);
        ctx.fillStyle = cell.hue; ctx.fillRect(bx, by, Math.round(bw * cell.bar), 5);
      }
      if (cell.tap) { ctx.fillStyle = '#6b7690'; ctx.font = '600 11px -apple-system, "Segoe UI", sans-serif'; ctx.fillText('tap: ' + cell.tap, x, ch - 8); }
    });
  }
  // Encode the strip's content for the wire. Content is always drawn in the
  // strip's logical space (w×h, zones left to right). On the + XL the panel
  // wants that image rotated 90° counterclockwise and encoded height×width
  // (per Elgato's HID docs), while the 0x0c draw header keeps logical coords —
  // `encodeRotate` on the profile carries that fact. Other strip decks (the
  // original +) encode the logical image as-is.
  async function stripBytesFromContent(drawFn) {
    var w = profile.strip.w, h = profile.strip.h;
    var content = document.createElement('canvas'); content.width = w; content.height = h;
    var cctx = content.getContext('2d'); if (!cctx) return null;
    drawFn(cctx, w, h);
    var out = content;
    if (profile.strip.encodeRotate) {
      var dev = document.createElement('canvas'); dev.width = h; dev.height = w;
      var dctx = dev.getContext('2d'); if (!dctx) return null;
      dctx.translate(h / 2, w / 2); dctx.rotate(-Math.PI / 2); dctx.drawImage(content, -w / 2, -h / 2);
      out = dev;
    }
    var blob = await new Promise(function (res) { out.toBlob(res, 'image/jpeg', 0.85); });
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }
  async function renderStripJpeg(cells) {
    return stripBytesFromContent(function (ctx, cw, ch) { drawStripContent(ctx, cells, cw, ch); });
  }
  function sendFeature(rep) {
    if (!device) return;
    queueDeviceWrite(null, async function () { if (device) { try { await device.hid.sendFeatureReport(rep.reportId, rep.data); } catch (e) {} } }).catch(function () {});
  }
  function setBrightness(pctVal) {
    brightness = Math.max(0, Math.min(100, Math.round(pctVal)));
    try { localStorage.setItem(BRIGHTNESS_KEY, String(brightness)); } catch (e) {}
    autoDimmed = false;   // touching the slider is input: dim over, timer restarts
    if (device && profile) { sendFeature(Device.brightnessReport(profile, brightness)); armAutoDim(); }
    var el = document.getElementById('sd-bright'); if (el && el.value != brightness) el.value = brightness;
    var lbl = document.getElementById('sd-bright-val'); if (lbl) lbl.textContent = brightness + '%';
  }
  // ── Auto-dim ────────────────────────────────────────────────────────────────
  // Five minutes with no input from the deck drops the backlight to 20% (never
  // above the operator's own setting). Any key, dial, touch, or slider input
  // restores it instantly. The stored brightness preference is untouched, and
  // the writes ride the same serialized HID queue as every other device write.
  var AUTO_DIM_AFTER_MS = 5 * 60 * 1000, AUTO_DIM_PCT = 20;
  var autoDimmed = false, autoDimTimer = null, lastDeckInputAt = 0;
  function armAutoDim() {
    clearTimeout(autoDimTimer); autoDimTimer = null;
    if (!device) return;
    lastDeckInputAt = Date.now();
    autoDimTimer = setTimeout(autoDimCheck, AUTO_DIM_AFTER_MS + 250);
  }
  function autoDimCheck() {
    autoDimTimer = null;
    if (!device || !profile || autoDimmed) return;
    var idle = Date.now() - lastDeckInputAt;
    if (idle >= AUTO_DIM_AFTER_MS) { autoDimmed = true; sendFeature(Device.brightnessReport(profile, Math.min(brightness, AUTO_DIM_PCT))); }
    else autoDimTimer = setTimeout(autoDimCheck, AUTO_DIM_AFTER_MS - idle + 250);
  }
  function noteDeckInput() {
    if (autoDimmed) { autoDimmed = false; if (device && profile) sendFeature(Device.brightnessReport(profile, brightness)); }
    armAutoDim();
  }
  function stopAutoDim() { clearTimeout(autoDimTimer); autoDimTimer = null; autoDimmed = false; }
  function registerLabelModel(prof) {
    var r = window.CueolaStreamDeckLabel; if (!r || typeof r.registerModel !== 'function') return;
    try { r.registerModel({ productId: prof.productId, name: prof.name, keys: prof.keys, columns: prof.cols, imageWidth: prof.keyPx, imageHeight: prof.keyPx, imageType: 'image/jpeg', imageQuality: 0.9, deviceRotationDegrees: ((((prof.rotation || 0) + (prof.mountRotation || 0)) % 360) + 360) % 360, inputStateOffset: prof.stateOffset, packet: { reportId: prof.keyImage.reportId, command: prof.keyImage.command, packetSize: prof.keyImage.packetSize, headerSize: prof.keyImage.headerSize, payloadSize: prof.keyImage.packetSize - prof.keyImage.headerSize } }); } catch (e) {}
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
    // Geometry model v3: the + XL (0x00c6) is pinned from Elgato's own HID docs,
    // so geometry is a fact of the hardware, not a preference. Wipe anything the
    // old calibration UI stored (manual strip sizes, rotations, column counts) —
    // stale experiments must never shadow verified numbers. Layouts are kept.
    if (overrides._calModel !== 3) {
      ['rotation', 'stripW', 'stripH', 'stripZones', 'stripRotation', 'stripForce', 'strip', 'cols', 'keys', 'keyPx'].forEach(function (k) { delete overrides[k]; });
      overrides._calModel = 3;
    }
    if (overrides.rotation != null) delete overrides.rotation;
    // Staged layout seeds (e.g. "The Break Room" demo show): another module may
    // stage named layouts under SEED_KEY. Add each once per deck, by name, and
    // never touch the active or default selection. seededNames remembers what
    // was already offered so a deliberate delete stays deleted.
    seededNames = (raw.seededNames || []).slice();
    try {
      var seeds = JSON.parse(localStorage.getItem(SEED_KEY) || '[]') || [];
      if (seeds.length) {
        var have = Object.keys(profiles).map(function (id) { return profiles[id].name; });
        var added = false;
        seeds.forEach(function (seed) {
          if (!seed || !seed.name || seededNames.indexOf(seed.name) >= 0 || have.indexOf(seed.name) >= 0) return;
          var id = newId();
          profiles[id] = { name: seed.name, keys: (seed.keys || []).map(toSlot) };
          have.push(seed.name); seededNames.push(seed.name); added = true;
        });
        if (added) {
          if (!activeProfileId) { activeProfileId = Object.keys(profiles)[0]; defaultProfileId = defaultProfileId || activeProfileId; }
          var s = readStore(); s[pid] = s[pid] || {};
          s[pid].profiles = profiles; s[pid].seededNames = seededNames;
          if (s[pid].activeProfile == null) s[pid].activeProfile = activeProfileId;
          if (s[pid].defaultProfile == null) s[pid].defaultProfile = defaultProfileId;
          writeStore(s);
        }
      }
    } catch (e) {}
    return { overrides: overrides };
  }
  function toSlot(s) { return (typeof s === 'string') ? { a: s } : (s && typeof s === 'object' ? s : { a: 'none' }); }
  function persist() { if (!profile) return; var s = readStore(); s[profile.productId] = { overrides: overrides, profiles: profiles, activeProfile: activeProfileId, defaultProfile: defaultProfileId, seededNames: seededNames }; writeStore(s); }
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
    if (!navigator.hid) { r.innerHTML = '<div class="sd-empty">KeyWi Bird needs Chrome or Edge (WebHID). Open Cueola there to connect a Stream Deck.</div>'; return; }
    var showGrid = device || previewMode;
    r.innerHTML = statusBar() + (showGrid ? profileBar() + obsBar() + micoBar() + toolsRow() + surfaceGrid() + (device ? learnPanel() : previewBanner()) + diagPanel() : connectHelp() + micoBar() + diagPanel());
    wire(); renderStatus(); updateLiveBadge();
    if (showGrid) { paintMirror(); paintStrip(true); }
  }
  function previewBanner() {
    return '<div class="sd-preview-banner"><span class="sf-symbol" data-symbol="state.info" aria-hidden="true"></span><div>Preview mode: a virtual Stream Deck + XL so you can lay it out, pick a theme, and press keys on screen. Plug in real hardware and hit <b>Connect real deck</b> to drive the show.</div><button class="btn-secondary" id="sd-preview-connect">Connect real deck</button></div>';
  }
  function statusBar() {
    var s = surfaceState();
    return '<div class="sd-status">'
      + statusChip('Device', device ? profile.name : (previewMode ? 'Preview (virtual)' : 'Not connected'), device ? 'ok' : 'off')
      + statusChip('Micochondria', talkbackState.connected ? 'Daemon connected' : 'Not running', talkbackState.connected ? 'ok' : 'off', 'sd-chip-mico')
      + statusChip('Session', s.session && s.session.code ? s.session.code : 'None', s.session && s.session.code ? 'ok' : 'off')
      + '<div class="sd-status-actions">'
      + (device ? '<button class="btn-secondary" id="sd-disconnect">Disconnect</button>' : '<button class="btn-primary" id="sd-connect">Connect deck</button>')
      + (previewMode ? '<button class="btn-secondary" id="sd-preview-exit">Exit preview</button>' : '')
      // The off-air panic (kills both mics) only makes sense once a deck/preview
      // is up or the talkback daemon is live — hide it on the cold setup page.
      + ((talkbackState.connected || device || previewMode) ? '<button class="btn-secondary" id="sd-talkoff" data-tip="Cut both Micochondria mics (TKB + VofU) instantly">All talk off</button>' : '')
      + '</div></div>';
  }
  function statusChip(label, value, cls, id) { return '<div' + (id ? ' id="' + id + '"' : '') + ' class="sd-chip sd-chip-' + cls + '"><span class="sd-chip-l">' + esc(label) + '</span><span class="sd-chip-v">' + esc(value) + '</span></div>'; }
  // Cold-start hero. The guided path is the setup wizard; this page just offers
  // the three doors (connect, preview, wizard) plus honest readiness dots.
  function connectHelp() {
    var tbOn = talkbackState.connected, obsOn = !!(OBSc() && OBSc().isReady && OBSc().isReady());
    return '<div class="sd-hero">'
      + '<h3>Any Stream Deck. The whole rig.</h3>'
      + '<p>Plug in a deck (Mini to + XL) and KeyWi Bird lays it out by app for its size: playback, rundown, prompter, mics, OBS. Or explore on screen first: preview mode is the full deck with no hardware. Quit the Elgato Stream Deck app before connecting; it hogs the USB device.</p>'
      + '<div class="sd-hero-actions"><button class="btn-primary" id="sd-connect2">Connect deck</button><button class="btn-secondary" id="sd-preview">See it on screen</button><button class="btn-secondary" id="sd-wizard-open">Setup wizard</button><button class="btn-secondary" id="sd-diag">Diagnostics</button></div>'
      + '<div class="sd-hero-checks">'
      + '<span class="sd-ready">Deck</span>'
      + '<span class="sd-ready' + (tbOn ? ' on' : '') + '">Micochondria</span>'
      + '<span class="sd-ready' + (obsOn ? ' on' : '') + '">OBS</span>'
      + '</div></div>';
  }
  function profileBar() {
    var opts = Object.keys(profiles).map(function (id) { return '<option value="' + id + '"' + (id === activeProfileId ? ' selected' : '') + '>' + esc(profiles[id].name) + (id === defaultProfileId ? ' (default)' : '') + '</option>'; }).join('');
    return '<div class="sd-profiles">'
      + '<label class="sd-pf-lbl">Layout</label><select id="sd-profile">' + opts + '</select>'
      + '<button class="sd-mini" id="sd-pf-new" data-tip="New layout">New</button>'
      + '<button class="sd-mini" id="sd-pf-dup" data-tip="Duplicate">Duplicate</button>'
      + '<button class="sd-mini" id="sd-pf-ren" data-tip="Rename">Rename</button>'
      + '<button class="sd-mini" id="sd-pf-def" data-tip="Use as default on connect">Set default</button>'
      + '<button class="sd-mini danger" id="sd-pf-del" data-tip="Delete layout">Delete</button>'
      + '<span class="sd-pf-sp"></span>'
      + '<button class="sd-mini" id="sd-pf-exp" data-tip="Export to a file">Export</button>'
      + '<button class="sd-mini" id="sd-pf-imp" data-tip="Import from a file">Import</button>'
      + '<input type="file" id="sd-pf-file" accept="application/json,.json" hidden></div>';
  }
  function toolsRow() {
    var chips = Object.keys(DECK_THEMES).map(function (id) { return '<button class="sd-theme-chip sd-th-' + id + (id === deckTheme ? ' cur' : '') + '" data-theme="' + id + '" data-tip="Reskin the whole deck">' + esc(DECK_THEMES[id].name) + '</button>'; }).join('');
    return '<div class="sd-bright-row">'
      + '<label>Theme</label><div class="sd-theme-chips">' + chips + '</div>'
      + '<button class="btn-secondary' + (learnArmed ? ' sd-armed' : '') + '" id="sd-learn">' + (learnArmed ? 'Press a control to map it…' : 'Live learn') + '</button>'
      + (device ? '<label>Brightness</label><input type="range" id="sd-bright" min="0" max="100" value="' + brightness + '"><span id="sd-bright-val">' + brightness + '%</span>' : '')
      + (device ? '<button class="btn-secondary" id="sd-test">Test pattern</button>' : '')
      + '<button class="btn-secondary" id="sd-reset">Reset this layout</button>'
      + '<button class="btn-secondary" id="sd-wizard-btn">Setup wizard</button></div>';
  }
  function obsBar() {
    var o = OBSc(), ready = !!(o && o.isReady && o.isReady()), cfg = (o && o.config && o.config()) || { url: 'ws://localhost:4455', password: '' }, st = obsState(), err = (o && o.lastError && o.lastError()) || '';
    return '<div class="sd-obs">'
      + '<span class="sd-obs-dot' + (ready ? ' on' : '') + '"></span><span class="sd-obs-lbl">OBS</span>'
      + (ready
        ? '<span class="sd-obs-scene" data-tip="Current program scene">' + esc(st.currentScene || '(no scene)') + '</span>'
          + (st.streaming ? '<span class="sd-obs-tag live">LIVE</span>' : '') + (st.recording ? '<span class="sd-obs-tag rec">REC</span>' : '')
          + ((st.inputs || []).length
            ? '<label class="sd-obs-vol-lbl" for="sd-obs-vol" data-tip="The OBS audio input the stream-volume dial rides">Stream audio</label><select id="sd-obs-vol">'
              + st.inputs.map(function (n) { return '<option value="' + esc(n) + '"' + (n === obsVolInputName() ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>'
            : '')
          + '<span class="sd-pf-sp"></span><button class="sd-mini" id="sd-obs-dis">Disconnect OBS</button>'
        : '<input id="sd-obs-url" class="sd-obs-in" placeholder="ws://localhost:4455" value="' + esc(cfg.url) + '"><input id="sd-obs-pw" class="sd-obs-in" type="password" placeholder="' + (cfg.password ? '••••••••' : 'password (if set)') + '" value=""><button class="sd-mini" id="sd-obs-con">Connect OBS</button>'
          + (err ? '<span class="sd-obs-err">' + esc(err) + '</span>' : ''))
      + '</div>';
  }
  function surfaceGrid() {
    var s = surfaceState();
    // The deck sits in a hardware-style shell: keys, then the live touch strip
    // (the SAME pixels the hardware shows), inside one dark housing. WYSIWYG.
    var html = '<div class="sd-sect-t">Deck <span class="sd-sect-hint">click a key to change what it does and how it looks</span></div>';
    html += '<div class="sd-shell">';
    html += '<div class="sd-keys" style="grid-template-columns:repeat(' + profile.cols + ',1fr)">';
    for (var i = 0; i < profile.keys; i++) {
      var slot = slotAt(i), a = slotAction(slot);
      var tip = (a.full || a.label || 'blank') + (a.toggle ? ' · toggle' : '') + (a.hold ? ' · hold' : '') + (a.desc ? '. ' + a.desc : '');
      html += '<button class="sd-key' + (i === editingKey ? ' editing' : '') + '" data-key="' + i + '" style="--i:' + i + '" data-tip="' + esc(tip) + '" aria-label="' + esc('Key ' + (i + 1) + ': ' + (a.full || 'blank')) + '"><canvas width="132" height="132"></canvas></button>';
    }
    html += '</div>';
    if (profile.strip) html += '<canvas class="sd-strip-mirror" id="sd-strip-mirror" width="' + profile.strip.w + '" height="' + profile.strip.h + '" data-tip="The touch strip, live. Tap a zone on the hardware = press its dial; flick = a big turn."></canvas>';
    html += '</div>';
    if (profile.dials) {
      html += '<div class="sd-sect-t">Dials <span class="sd-sect-hint">each shows what turning and pressing does · click to reassign</span></div>';
      html += '<div class="sd-dials">';
      for (var d = 0; d < profile.dials; d++) {
        var c = DIAL_CONTROLLERS[mapping().dials[d]] || {};
        html += '<div class="sd-dial" data-dial="' + d + '" data-tip="' + esc(c.desc || '') + '" style="--dc:' + (c.hue || 'var(--accent)') + '">'
          + '<div class="sd-dial-knob">' + esc(c.readout ? String(c.readout(s)) : '') + '</div>'
          + '<div class="sd-dial-lbl">' + esc(c.label || 'unset') + '</div>'
          + '<div class="sd-dial-row"><span class="sd-dial-verb">turn</span>' + esc(c.turnLabel || '') + '</div>'
          + '<div class="sd-dial-row"><span class="sd-dial-verb">press</span>' + esc(c.pressLabel || '') + '</div>'
          + '</div>';
      }
      html += '</div>';
    }
    html += legendCard();
    return html;
  }
  // "How KeyWi Bird works": flat inspector-style rows, hairline-separated (no boxes
  // in boxes, per the design guidelines).
  function legendCard() {
    return '<details class="sd-legend"><summary>How KeyWi Bird works</summary><div class="sd-legend-body">'
      + '<div class="sd-legend-row"><span class="sf-symbol" data-symbol="action.grid" aria-hidden="true"></span><div><b>Keys</b> press to fire the action printed on them. Keys with a glowing ring are ON (a toggle that is active, a cue that is playing, the scene on air). BRAKE, BOOST, TKB and VofU are hold keys: press and hold, release to stop.</div></div>'
      + '<div class="sd-legend-row"><span class="sf-symbol" data-symbol="action.settings" aria-hidden="true"></span><div><b>Dials</b> do two things each: turning adjusts the value, pressing the dial in fires its second action. Both are written on the dial card above.</div></div>'
      + '<div class="sd-legend-row"><span class="sf-symbol" data-symbol="content.display" aria-hidden="true"></span><div><b>Touch strip</b> is a live dashboard over the dials. Tap a zone to fire that dial’s press action; flick along it for a fast turn.</div></div>'
      + '<div class="sd-legend-row"><span class="sf-symbol" data-symbol="action.repeat" aria-hidden="true"></span><div><b>Layouts</b> are whole pages of key assignments. Save one per situation (rehearsal, live, OBS-heavy) and jump between them with a PAGE key, right from the deck.</div></div>'
      + '</div></details>';
  }
  // Read-only facts about the connected deck. Geometry comes from the model
  // table (verified against Elgato's HID docs) — nothing here needs tuning.
  function learnPanel() {
    return '<details class="sd-learn"><summary>Deck details</summary><div class="sd-learn-body">'
      + '<div class="sd-learn-grid">'
      + learnField('Model', profile.name)
      + learnField('Product id', '0x' + profile.productId.toString(16))
      + learnField('Keys', profile.keys + ' (' + profile.cols + ' × ' + profile.rows + ')')
      + learnField('Dials', profile.dials)
      + learnField('Key art', profile.keyPx + ' px')
      + learnField('Touch strip', profile.strip ? (profile.strip.w + '×' + profile.strip.h + ', ' + profile.strip.zones + ' zones') : 'none')
      + '</div><div class="sd-learn-tune"><button class="btn-secondary" id="sd-diag">Diagnostics</button><span class="sd-note">Print what the hardware itself reports (ids, name string, descriptor, feature dumps).</span></div>'
      + '</div></details>';
  }
  function learnField(k, v) { return '<div class="sd-lf"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>'; }
  function renderStatus() { var chip = document.getElementById('sd-chip-mico'); if (!chip) return; chip.className = 'sd-chip sd-chip-' + (talkbackState.connected ? 'ok' : 'off'); var v = chip.querySelector('.sd-chip-v'); if (v) v.textContent = talkbackState.connected ? 'Connected' : 'Not running'; }

  // ── Micochondria: the mic panel ─────────────────────────────────────────────
  // A small honest tool: says whether the daemon is connected, and when it is,
  // gives one strip per mic (TKB, VofU) — hold-to-talk, a live meter (mic input
  // while idle, bus output while keyed), and a volume fader. Meter and fader
  // only appear when the running daemon actually speaks levels/gains, so an
  // older talkbackd still gets a clean connected/off panel, never dead knobs.
  function micoBar() {
    var on = talkbackState.connected;
    var html = '<div class="sd-mico" id="sd-mico">'
      + '<div class="sd-mico-head">'
      + '<span class="sd-obs-dot' + (on ? ' on' : '') + '"></span>'
      + '<span class="sd-mico-name">Mic<span>ochondria</span></span>'
      + '<span class="sd-mico-status">' + (on ? 'Connected' : 'Not running') + '</span>'
      + '<span class="sd-pf-sp"></span>'
      + '<button class="sd-mini" id="sd-mico-pop" data-tip="Pop Micochondria out into its own little window">Pop out</button>'
      + (on ? '<button class="sd-mini danger" id="sd-mico-off" data-tip="Cut both mics (TKB + VofU) instantly">All talk off</button>' : '')
      + '</div>';
    if (on) {
      html += micoStrip('A', 'TKB', 'Talkback · crew · outs 1-2')
            + micoStrip('B', 'VofU', 'Voice of the Universe · room · outs 3-4');
    } else {
      html += '<div class="sd-mico-hint">The talkback daemon runs the mics. Start it on this machine and this dot turns green by itself: <code>cd talkback/daemon && swift run -c release</code></div>';
    }
    return html + '</div>';
  }
  function micoStrip(bus, name, subtitle) {
    var onAir = talkbackState[bus];
    var gain = bus === 'A' ? talkbackState.gainA : talkbackState.gainB;
    return '<div class="sd-mico-strip' + (onAir ? ' onair' : '') + '" data-bus="' + bus + '">'
      + '<button class="sd-mico-talk" data-talk="' + bus + '" data-tip="Hold to talk on ' + name + '. Releases the moment you let go."><span class="sf-symbol" data-symbol="department.audio" aria-hidden="true"></span>' + name + '</button>'
      + '<div class="sd-mico-mid"><div class="sd-mico-sub">' + subtitle + '</div>'
      + (talkbackState.hasLevels
        ? '<div class="sd-mico-meter"><div class="sd-mico-meter-fill" data-meter="' + bus + '"></div></div>'
        : '<div class="sd-mico-sub2">Hold to talk. The lamp is the truth.</div>')
      + '</div>'
      + (talkbackState.hasGains ? '<input type="range" class="sd-mico-vol" data-vol="' + bus + '" min="0" max="100" value="' + Math.round((gain == null ? 1 : gain) * 100) + '" aria-label="' + name + ' volume">' : '')
      + '<span class="sd-mico-lamp">' + (onAir ? 'ON AIR' : 'off') + '</span>'
      + '</div>';
  }
  function renderMico() {
    var el = document.getElementById('sd-mico'); if (!el) return;
    var tmp = document.createElement('div'); tmp.innerHTML = micoBar();
    el.replaceWith(tmp.firstChild);
    wireMico();
  }
  // Lightweight refresh: lamps and faders only, so a slider mid-drag is never
  // rebuilt out from under the operator's pointer.
  function micoSync() {
    var box = document.getElementById('sd-mico'); if (!box) return;
    ['A', 'B'].forEach(function (bus) {
      var strip = box.querySelector('.sd-mico-strip[data-bus="' + bus + '"]'); if (!strip) return;
      strip.classList.toggle('onair', !!talkbackState[bus]);
      var lamp = strip.querySelector('.sd-mico-lamp'); if (lamp) lamp.textContent = talkbackState[bus] ? 'ON AIR' : 'off';
      var sl = strip.querySelector('.sd-mico-vol');
      var g = bus === 'A' ? talkbackState.gainA : talkbackState.gainB;
      if (sl && document.activeElement !== sl && g != null) sl.value = Math.round(g * 100);
    });
  }
  function updateMicoMeters() {
    var box = document.getElementById('sd-mico'); if (!box) return;
    var lv = talkbackState.levels;
    ['A', 'B'].forEach(function (bus) {
      var fill = box.querySelector('.sd-mico-meter-fill[data-meter="' + bus + '"]'); if (!fill) return;
      var on = talkbackState[bus];
      var v = Math.max(0, Math.min(1, on ? (bus === 'A' ? lv.a : lv.b) : lv.mic));
      fill.style.width = Math.round(Math.sqrt(v) * 100) + '%';   // sqrt: quiet speech still visibly moves
      fill.classList.toggle('idle', !on);
      fill.classList.toggle('hot', v > 0.85);
    });
  }
  function wireMico() {
    var box = document.getElementById('sd-mico'); if (!box) return;
    var off = document.getElementById('sd-mico-off'); if (off) off.onclick = function () { releaseTalkback(true); };
    box.querySelectorAll('.sd-mico-talk').forEach(function (btn) {
      var bus = btn.getAttribute('data-talk');
      var down = function (e) { e.preventDefault(); btn.setPointerCapture && e.pointerId != null && btn.setPointerCapture(e.pointerId); talkbackSet(bus, true); };
      var up = function () { talkbackSet(bus, false); };
      btn.onpointerdown = down; btn.onpointerup = up; btn.onpointercancel = up; btn.onpointerleave = up;
      btn.oncontextmenu = function (e) { e.preventDefault(); };
    });
    box.querySelectorAll('.sd-mico-vol').forEach(function (sl) {
      sl.oninput = function () { talkbackGain(sl.getAttribute('data-vol'), sl.value / 100); };
    });
    bind('sd-mico-pop', openMicoPopout);
  }

  // ── Micochondria pop-out: a little status window you can keep on screen ────
  // Same-origin blank window, written and driven directly by this tab: the dot,
  // both mics with lamp + meter, hold-to-talk, and the off-air panic. Closes
  // with the tab; goes quiet (not wrong) if the opener navigates away.
  var micoWin = null;
  // Liquid glass, pop-out edition. This window has no page behind it, so depth
  // comes from layered translucent fills over a near-black base instead of
  // backdrop-filter. It also cannot read the main page's custom properties, so
  // the --mw-* vars below are local copies mirroring the index.html token sheet
  // (--liquid-fill/-strong, --liquid-edge/-strong, --ui-radius-*) at dark-base
  // values. No box-shadows, no glows: rims and fills only, LEDs are solid.
  var MICO_POP_CSS = ':root{'
    + '--mw-base:#0b0d12;'
    + '--mw-fill:linear-gradient(145deg,rgba(255,255,255,.06),rgba(255,255,255,.02));' // mirrors --liquid-fill
    + '--mw-fill-strong:linear-gradient(145deg,rgba(255,255,255,.10),rgba(255,255,255,.04));' // mirrors --liquid-fill-strong
    + '--mw-edge:rgba(255,255,255,.14);' // mirrors --liquid-edge
    + '--mw-edge-strong:rgba(255,255,255,.26);' // mirrors --liquid-edge-strong
    + '--mw-radius-control:12px;--mw-radius-group:16px;--mw-radius-panel:22px;' // mirrors --ui-radius-*
    + '--mw-text:#e8ecf4;--mw-text-dim:#98a2b8;--mw-text-faint:#8a94aa;'
    + '--mw-ok:#22d3a0;--mw-hot:#ff3b3b;--mw-accent:#7ea6ff}'
    + 'body{margin:0;font-family:-apple-system,"SF Pro Display","Segoe UI",sans-serif;background:var(--mw-base);color:var(--mw-text);padding:14px 16px;user-select:none;-webkit-user-select:none}'
    + '#mw-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:0 2px}'
    + '#mw-dot{width:9px;height:9px;box-sizing:border-box;border-radius:50%;background:rgba(255,255,255,.10);border:1px solid var(--mw-edge-strong)}'
    + '#mw-dot.on{background:var(--mw-ok);border-color:rgba(255,255,255,.38)}' // sharp LED: solid fill + rim, zero blur
    + '#mw-name{font-weight:800;font-size:15px}#mw-name span{color:var(--mw-accent)}'
    + '#mw-status{color:var(--mw-text-dim);font-size:12.5px}'
    + '#mw-card{background:var(--mw-fill);border:1px solid var(--mw-edge);border-radius:var(--mw-radius-group);overflow:hidden}'
    + '.mw-strip{display:flex;align-items:center;gap:10px;padding:9px 11px}'
    + '.mw-strip+.mw-strip{border-top:1px solid var(--mw-edge)}'
    + '.mw-talk{min-width:64px;padding:8px 12px;border-radius:var(--mw-radius-control);border:1px solid var(--mw-edge);background:var(--mw-fill-strong);color:var(--mw-text);font-weight:800;font-size:13px;cursor:pointer;touch-action:none}'
    + '.mw-strip.onair .mw-talk{background:rgba(34,211,160,.22);border-color:var(--mw-ok);color:#dffff5}'
    + '.mw-mid{flex:1;min-width:80px}.mw-sub{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--mw-text-faint);margin-bottom:4px}'
    + '.mw-meter{height:8px;border-radius:4px;background:rgba(0,0,0,.38);border:1px solid var(--mw-edge);overflow:hidden}' // solid-fill bar, 1px rim
    + '.mw-fill{height:100%;width:0;background:var(--mw-ok);transition:width 90ms linear}.mw-fill.idle{opacity:.45}.mw-fill.hot{background:var(--mw-hot)}'
    + '.mw-lamp{min-width:52px;box-sizing:border-box;text-align:center;font-size:10px;font-weight:800;letter-spacing:.06em;border-radius:var(--mw-radius-control);padding:4px 7px;background:var(--mw-fill-strong);border:1px solid var(--mw-edge);color:var(--mw-text-faint)}'
    + '.mw-strip.onair .mw-lamp{background:var(--mw-hot);border-color:rgba(255,255,255,.38);color:#fff}'
    + '#mw-off{margin-top:10px;width:100%;padding:9px;border-radius:var(--mw-radius-control);border:1px solid rgba(255,59,59,.5);background:var(--mw-fill-strong);color:#ff8f8f;font-weight:700;font-size:13px;cursor:pointer}';
  function micoPopoutAlive() { try { return !!(micoWin && !micoWin.closed); } catch (e) { return false; } }
  function micoPopStrip(bus, name, sub) {
    return '<div class="mw-strip" data-bus="' + bus + '"><button class="mw-talk" data-talk="' + bus + '" title="Hold to talk on ' + name + '">' + name + '</button>'
      + '<div class="mw-mid"><div class="mw-sub">' + sub + '</div><div class="mw-meter"><div class="mw-fill" data-meter="' + bus + '"></div></div></div>'
      + '<span class="mw-lamp">off</span></div>';
  }
  function openMicoPopout() {
    if (micoPopoutAlive()) { try { micoWin.focus(); } catch (e) {} micoPopoutSync(); return; }
    var w = null;
    try { w = window.open('', 'cueola-mico', 'width=380,height=252,resizable=yes'); } catch (e) {}
    if (!w) { toast('Pop-up blocked. Allow pop-ups for this site to pop Micochondria out.'); return; }
    micoWin = w;
    var d = w.document;
    d.title = 'Micochondria';
    var style = d.createElement('style'); style.textContent = MICO_POP_CSS; d.head.appendChild(style);
    d.body.innerHTML = '<div id="mw-head"><span id="mw-dot"></span><span id="mw-name">Mic<span>ochondria</span></span><span id="mw-status"></span></div>'
      + '<div id="mw-card">'
      + micoPopStrip('A', 'TKB', 'Talkback · crew · outs 1-2')
      + micoPopStrip('B', 'VofU', 'Voice of the Universe · outs 3-4')
      + '</div>'
      + '<button id="mw-off" title="Cut both mics instantly">All talk off</button>';
    d.querySelectorAll('.mw-talk').forEach(function (btn) {
      var bus = btn.getAttribute('data-talk');
      var down = function (e) { e.preventDefault(); talkbackSet(bus, true); };
      var up = function () { talkbackSet(bus, false); };
      btn.onpointerdown = down; btn.onpointerup = up; btn.onpointercancel = up; btn.onpointerleave = up;
      btn.oncontextmenu = function (e) { e.preventDefault(); };
    });
    var off = d.getElementById('mw-off'); if (off) off.onclick = function () { releaseTalkback(true); };
    // Safety mirrors the main tab: losing the pop-out mid-hold releases the mic.
    w.onblur = function () { releaseTalkback(false); };
    w.onpagehide = function () { releaseTalkback(false); };
    var poll = setInterval(function () { if (!micoPopoutAlive()) { clearInterval(poll); micoWin = null; } }, 1500);
    micoPopoutSync(); micoPopoutMeters();
  }
  function micoPopoutSync() {
    if (!micoPopoutAlive()) return;
    var d; try { d = micoWin.document; } catch (e) { return; }
    var dot = d.getElementById('mw-dot'); if (dot) dot.className = talkbackState.connected ? 'on' : '';
    var st = d.getElementById('mw-status'); if (st) st.textContent = talkbackState.connected ? 'Connected' : 'Not running';
    ['A', 'B'].forEach(function (bus) {
      var strip = d.querySelector('.mw-strip[data-bus="' + bus + '"]'); if (!strip) return;
      strip.classList.toggle('onair', !!talkbackState[bus]);
      var lamp = strip.querySelector('.mw-lamp'); if (lamp) lamp.textContent = talkbackState[bus] ? 'ON AIR' : 'off';
    });
  }
  function micoPopoutMeters() {
    if (!micoPopoutAlive() || !talkbackState.hasLevels) return;
    var d; try { d = micoWin.document; } catch (e) { return; }
    var lv = talkbackState.levels;
    ['A', 'B'].forEach(function (bus) {
      var fill = d.querySelector('.mw-fill[data-meter="' + bus + '"]'); if (!fill) return;
      var on = talkbackState[bus];
      var v = Math.max(0, Math.min(1, on ? (bus === 'A' ? lv.a : lv.b) : lv.mic));
      fill.style.width = Math.round(Math.sqrt(v) * 100) + '%';
      fill.classList.toggle('idle', !on);
      fill.classList.toggle('hot', v > 0.85);
    });
  }

  // ── Key editor (action + cues-by-name + label + colour + icon) ─────────────
  function overlay() { return document.getElementById('sd-picker'); }
  function closeOverlay() { var o = overlay(); if (o) o.className = 'sd-picker'; if (editingKey >= 0) { editingKey = -1; schedulePaint(); render(); } }
  function openKeyEditor(index, fromLearn) {
    learnArmed = false; editingKey = index; schedulePaint();
    var slot = slotAt(index), s = surfaceState();
    var groups = {};
    // Ref kinds are bound from the live "This show" / "This OBS" sections below,
    // so their generic entries would be dead weight here.
    Object.keys(catalog).forEach(function (id) { var a = catalog[id]; if (a.kind === 'padRef' || a.kind === 'cueRef' || a.kind === 'obsSceneRef' || a.kind === 'obsMuteRef') return; (groups[a.group] = groups[a.group] || []).push({ id: id, label: a.full || a.label || id }); });
    // App-by-app order, sub-groups right under their app.
    var GROUP_ORDER = ['Outrangutan', 'Outrangutan · SFX pads', 'Outrangutan · cues', 'Cueola', 'Cueola · show clock', 'Flowmingo', 'Micochondria', 'OBS', 'OBS scenes (by slot)', 'Layouts', 'Fun', 'Blank'];
    var orderedGroups = GROUP_ORDER.filter(function (g) { return groups[g]; })
      .concat(Object.keys(groups).filter(function (g) { return GROUP_ORDER.indexOf(g) < 0; }));
    var curAction = slotAction(slot);
    var body = '<div class="sd-ed-head">Edit key ' + (index + 1) + (fromLearn ? ' <span class="sd-ed-learned">learned</span>' : '')
      + (curAction.toggle ? ' <span class="sd-ed-chip">TOGGLE</span>' : '') + (curAction.hold ? ' <span class="sd-ed-chip">HOLD</span>' : '') + '</div>';
    if (curAction.desc) body += '<div class="sd-ed-desc">' + esc(curAction.desc) + '</div>';
    body += '<div class="sd-ed-cols"><div class="sd-ed-actions"><div class="sd-ed-sub">Action</div>';
    orderedGroups.forEach(function (g) { body += '<div class="sd-picker-g">' + esc(g) + '</div>'; groups[g].forEach(function (o) { body += '<button class="sd-picker-opt' + (o.id === slot.a && !slot.ref ? ' cur' : '') + '" data-pick="' + esc(o.id) + '">' + esc(o.label || '(blank)') + '</button>'; }); });
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
    var styleCur = slot.style || 'wipe';
    var customHex = (slot.color && SWATCHES.indexOf(slot.color) < 0) ? slot.color : '';
    body += '</div><div class="sd-ed-style"><div class="sd-ed-sub">Appearance</div>'
      + '<label class="sd-ed-f">Label<input id="sd-ed-label" placeholder="' + esc(slotAction(slot).label || 'default') + '" value="' + esc(slot.label || '') + '"></label>'
      + '<label class="sd-ed-check"><input type="checkbox" id="sd-ed-hidelabel"' + (slot.hideLabel ? ' checked' : '') + '><span>Hide label</span></label>'
      + '<div class="sd-ed-f">Accent color<div class="sd-swatches"><button class="sd-sw sd-sw-auto' + (slot.color ? '' : ' cur') + '" data-color="" data-tip="Auto">Auto</button>'
      + SWATCHES.map(function (col) { return '<button class="sd-sw' + (slot.color === col ? ' cur' : '') + '" data-color="' + col + '" style="background:' + col + '"></button>'; }).join('') + '</div></div>'
      + '<label class="sd-ed-f">Custom color (hex)<input id="sd-ed-hex" placeholder="#1c7a3e" maxlength="7" autocomplete="off" spellcheck="false" value="' + esc(customHex) + '"></label>'
      + '<label class="sd-ed-f">Symbol<input id="sd-ed-symsearch" placeholder="Search symbols" autocomplete="off"></label>'
      + '<div class="sd-symgrid" id="sd-symgrid">' + SYMBOL_PICK.map(function (row) { return '<button class="sd-symopt' + (slot.symbol === row[1] ? ' cur' : '') + '" data-sympick="' + esc(row[1]) + '" data-symname="' + esc(row[0]) + '" data-tip="' + esc(row[0]) + '" aria-label="' + esc(row[0]) + '"><canvas width="52" height="52"></canvas></button>'; }).join('') + '</div>'
      + '<label class="sd-ed-f">Icon<input id="sd-ed-icon" placeholder="emoji or blank" maxlength="2" value="' + esc(slot.icon || '') + '"></label>'
      + '<div class="sd-ed-f">Key art<div class="sd-emoji">' + EMOJI_ART.map(function (em) { return '<button class="sd-em' + (slot.icon === em ? ' cur' : '') + '" data-emoji="' + em + '" data-tip="Use this art on the key">' + em + '</button>'; }).join('') + '</div></div>'
      + '<div class="sd-ed-f">Progress style<div class="sd-seg" id="sd-ed-style-seg">'
      + [['wipe', 'Wipe'], ['ring', 'Ring'], ['bar', 'Bottom bar']].map(function (opt) { return '<button data-style="' + opt[0] + '"' + (styleCur === opt[0] ? ' class="cur"' : '') + '>' + opt[1] + '</button>'; }).join('') + '</div></div>'
      + '<label class="sd-ed-check"><input type="checkbox" id="sd-ed-flash"' + (slot.flash === false ? '' : ' checked') + '><span>Press flash</span></label>'
      + '<label class="sd-ed-check"><input type="checkbox" id="sd-ed-reactive"' + (slot.reactive === false ? '' : ' checked') + '><span>Reactive animation</span></label>'
      + '<div class="sd-ed-actions-row"><button class="sd-mini" id="sd-ed-clear">Reset appearance</button><button class="btn-primary" id="sd-ed-done">Done</button></div></div></div>';
    var o = overlay(); o.innerHTML = '<div class="sd-picker-card sd-ed-card">' + body + '</div>'; o.className = 'sd-picker on';
    wireKeyEditor(index); render();
  }
  function wireKeyEditor(index) {
    var o = overlay();
    o.onclick = function (e) { if (e.target === o) closeOverlay(); };
    o.querySelectorAll('.sd-picker-opt').forEach(function (btn) {
      btn.onclick = function () {
        var slot = slotAt(index), refKind = btn.getAttribute('data-ref');
        if (refKind) { slot.a = refKind; slot.ref = btn.getAttribute('data-refid'); slot.refName = btn.getAttribute('data-refname'); }
        else { slot.a = btn.getAttribute('data-pick'); delete slot.ref; delete slot.refName; }
        mapping().keys[index] = slot; persist(); openKeyEditor(index);
      };
    });
    var lab = document.getElementById('sd-ed-label'); if (lab) lab.oninput = function () { var slot = slotAt(index); slot.label = lab.value; if (!slot.label) delete slot.label; mapping().keys[index] = slot; persist(); refreshKey(index); };
    var hl = document.getElementById('sd-ed-hidelabel'); if (hl) hl.onchange = function () { var slot = slotAt(index); if (hl.checked) slot.hideLabel = true; else delete slot.hideLabel; mapping().keys[index] = slot; persist(); refreshKey(index); };
    var ic = document.getElementById('sd-ed-icon'); if (ic) ic.oninput = function () { var slot = slotAt(index); slot.icon = ic.value; if (!slot.icon) delete slot.icon; else delete slot.symbol; mapping().keys[index] = slot; persist(); refreshKey(index); };
    var hexIn = document.getElementById('sd-ed-hex'); if (hexIn) hexIn.oninput = function () {
      var v = hexIn.value.trim();
      if (!/^#?[0-9a-fA-F]{6}$/.test(v)) return;   // partial typing: wait for a full hex
      var slot = slotAt(index); slot.color = '#' + v.replace('#', '').toLowerCase();
      mapping().keys[index] = slot; persist();
      o.querySelectorAll('.sd-sw').forEach(function (b) { b.classList.remove('cur'); });
      refreshKey(index);
    };
    var ss = document.getElementById('sd-ed-symsearch'); if (ss) ss.oninput = function () {
      var q = ss.value.trim().toLowerCase();
      o.querySelectorAll('.sd-symopt').forEach(function (btn) {
        var name = (btn.getAttribute('data-symname') || '').toLowerCase();
        btn.style.display = (!q || name.indexOf(q) >= 0) ? '' : 'none';
      });
    };
    o.querySelectorAll('.sd-symopt').forEach(function (btn) {
      btn.onclick = function () {
        var slot = slotAt(index), pick = btn.getAttribute('data-sympick');
        var on = slot.symbol !== pick;
        if (on) { slot.symbol = pick; delete slot.icon; } else delete slot.symbol;
        mapping().keys[index] = slot; persist();
        o.querySelectorAll('.sd-symopt').forEach(function (b) { b.classList.toggle('cur', on && b === btn); });
        o.querySelectorAll('.sd-em').forEach(function (b) { b.classList.remove('cur'); });
        var icf = document.getElementById('sd-ed-icon'); if (icf && on) icf.value = '';
        refreshKey(index);
      };
    });
    o.querySelectorAll('#sd-ed-style-seg button').forEach(function (btn) {
      btn.onclick = function () {
        var slot = slotAt(index), v = btn.getAttribute('data-style');
        if (v === 'wipe') delete slot.style; else slot.style = v;
        mapping().keys[index] = slot; persist();
        o.querySelectorAll('#sd-ed-style-seg button').forEach(function (b) { b.classList.toggle('cur', b === btn); });
        refreshKey(index);
      };
    });
    var fl = document.getElementById('sd-ed-flash'); if (fl) fl.onchange = function () { var slot = slotAt(index); if (fl.checked) delete slot.flash; else slot.flash = false; mapping().keys[index] = slot; persist(); refreshKey(index); };
    var rx = document.getElementById('sd-ed-reactive'); if (rx) rx.onchange = function () { var slot = slotAt(index); if (rx.checked) delete slot.reactive; else slot.reactive = false; mapping().keys[index] = slot; persist(); refreshKey(index); };
    o.querySelectorAll('.sd-sw').forEach(function (sw) { sw.onclick = function () { var slot = slotAt(index), col = sw.getAttribute('data-color'); if (col) slot.color = col; else delete slot.color; mapping().keys[index] = slot; persist(); openKeyEditor(index); }; });
    o.querySelectorAll('.sd-em').forEach(function (em) { em.onclick = function () { var slot = slotAt(index), pick = em.getAttribute('data-emoji'); slot.icon = (slot.icon === pick) ? '' : pick; if (!slot.icon) delete slot.icon; else delete slot.symbol; mapping().keys[index] = slot; persist(); openKeyEditor(index); }; });
    var clr = document.getElementById('sd-ed-clear'); if (clr) clr.onclick = function () { var slot = slotAt(index); delete slot.label; delete slot.hideLabel; delete slot.color; delete slot.icon; delete slot.symbol; delete slot.style; delete slot.flash; delete slot.reactive; mapping().keys[index] = slot; persist(); openKeyEditor(index); };
    var done = document.getElementById('sd-ed-done'); if (done) done.onclick = closeOverlay;
    paintSymbolPicker();
  }
  // Draw the symbol picker's little canvases. Symbols still fetching retry on a
  // short timer until the grid is fully painted (or the editor closes).
  function paintSymbolPicker() {
    var o = overlay(); if (!o || !o.classList.contains('on')) return;
    var pending = false;
    o.querySelectorAll('.sd-symopt').forEach(function (btn) {
      var path = btn.getAttribute('data-sympick'), cv = btn.querySelector('canvas');
      if (!path || !cv || btn._symPainted) return;
      if (_sym[path] === undefined) loadSymbol(path);
      if (!symbolReady(path)) { if (_sym[path] !== 'error') pending = true; return; }
      var cx2 = cv.getContext('2d'); if (!cx2) return;
      cx2.clearRect(0, 0, cv.width, cv.height);
      drawSymbolPath(cx2, path, cv.width / 2, cv.height / 2, cv.width * 0.72, '#cfd6e4');
      btn._symPainted = true;
    });
    if (pending) { clearTimeout(paintSymbolPicker._t); paintSymbolPicker._t = setTimeout(paintSymbolPicker, 180); }
  }
  function refreshKey(index) {
    var cv = mirrorCanvasFor(index);
    if (cv) drawKeyInto(cv, keyArtSpec(index, surfaceState()), cv.width);
    else render();
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
    bind('sd-diag', runDiagnostics);
    bind('sd-diag-close', function () { diagInfo = null; render(); });
    bind('sd-diag-copy', function () {
      var text = diagText(); if (!text) return;
      try { navigator.clipboard.writeText(text).then(function () { toast('Diagnostics copied.'); }, function () { toast('Copy failed — select the text and copy by hand.'); }); }
      catch (e) { toast('Copy failed — select the text and copy by hand.'); }
    });
    bind('sd-talkoff', function () { releaseTalkback(true); });
    bind('sd-reset', resetActive); bind('sd-test', testPattern);
    bind('sd-learn', function () { learnArmed = !learnArmed; render(); if (learnArmed) toast('Press a key or turn a dial on the deck to map it.'); });
    bind('sd-pf-new', function () { addProfile('Layout'); }); bind('sd-pf-dup', duplicateActive); bind('sd-pf-def', setDefaultActive); bind('sd-pf-del', deleteActive);
    bind('sd-pf-ren', function () { var n = prompt('Rename layout', mapping().name); if (n) renameActive(n.trim()); });
    bind('sd-pf-exp', exportActive);
    bind('sd-pf-imp', function () { var f = document.getElementById('sd-pf-file'); if (f) f.click(); });
    var file = document.getElementById('sd-pf-file'); if (file) file.onchange = function () { if (file.files && file.files[0]) importFile(file.files[0]); file.value = ''; };
    var sel = document.getElementById('sd-profile'); if (sel) sel.onchange = function () { switchProfile(sel.value); };
    bind('sd-obs-con', function () { var url = (document.getElementById('sd-obs-url') || {}).value || 'ws://localhost:4455'; var pw = (document.getElementById('sd-obs-pw') || {}).value || ''; if (OBSc()) { if (!pw) pw = ((OBSc().config && OBSc().config()) || {}).password || ''; OBSc().configure({ url: url, password: pw }); OBSc().connect(); toast('Connecting to OBS…'); } });
    bind('sd-obs-dis', function () { if (OBSc()) OBSc().disconnect(); });
    var ov = document.getElementById('sd-obs-vol'); if (ov) ov.onchange = function () { setObsVolInput(ov.value); toast('Stream-volume dial now rides "' + ov.value + '".'); };
    var br = document.getElementById('sd-bright'); if (br) br.oninput = function () { setBrightness(+br.value); };
    r.querySelectorAll('.sd-theme-chip').forEach(function (chip) { chip.onclick = function () { setTheme(chip.getAttribute('data-theme')); }; });
    bind('sd-wizard-btn', function () { openWizard(0); });
    bind('sd-wizard-open', function () { openWizard(0); });
    bind('sd-preview', startPreview); bind('sd-preview-connect', connect); bind('sd-preview-exit', stopPreview);
    wireMico();
    r.querySelectorAll('.sd-key').forEach(function (btn) { btn.onclick = function () { openKeyEditor(+btn.getAttribute('data-key')); }; });
    r.querySelectorAll('.sd-dial').forEach(function (el) { el.onclick = function () { openDialEditor(+el.getAttribute('data-dial')); }; });
  }
  function bind(id, fn) { var el = document.getElementById(id); if (el) el.onclick = fn; }

  async function testPattern() {
    if (!device) return;
    var z = profile.keyPx;
    var testKeyJob = function (i) {
      return async function () {
        if (!device) return;
        var cv = offCanvas(z); drawKeyInto(cv, { color: '#243a66', label: String(i + 1), active: (i % 2 === 0) }, z);
        try { var bytes = await keyJpegFromCanvas(cv, z); var packets = Device.keyImagePackets(profile, i, bytes); for (var pk = 0; pk < packets.length; pk++) await device.hid.sendReport(packets[pk].reportId, packets[pk].data); } catch (e) {}
      };
    };
    for (var i = 0; i < profile.keys; i++) { try { await queueDeviceWrite('key:' + i, testKeyJob(i)); } catch (e) {} }
    lastPainted = new Array(profile.keys).fill('test');
    toast('Test pattern sent. Keys are numbered 1-' + profile.keys + ' left to right, top to bottom.');
  }
  // A diagnostic ruler for the touch LCD (console-only tool, no UI): red border
  // on the outermost pixels, yellow corner squares, 100px ticks, green zone
  // dividers, and the pixel dimensions in the middle.
  async function testStrip() {
    if (!device || !profile) { toast('Connect a deck first.'); return; }
    if (!profile.strip) { toast('This deck has no touch strip.'); return; }
    var zones = profile.strip.zones;
    lastStripSig = '';
    // Dump the device's own truth first — product id, resolved profile, and the
    // HID report sizes the hardware actually advertises. If the strip stays dark,
    // this report says whether we are drawing wrong or framing the packets wrong.
    try { console.log('[KeyWi] strip test: device report:', JSON.stringify(deviceDiag(), null, 2)); } catch (e) {}
    var bytes = null;
    try {
      bytes = await stripBytesFromContent(function (ctx, cw, ch) {
        ctx.fillStyle = '#0b0f16'; ctx.fillRect(0, 0, cw, ch);
        ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, cw - 2, ch - 2);
        ctx.textAlign = 'center';
        for (var gx = 0; gx <= cw; gx += 100) {
          ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(gx + 0.5, 0); ctx.lineTo(gx + 0.5, ch); ctx.stroke();
          if (gx < cw) { ctx.fillStyle = '#7ea6ff'; ctx.font = '600 12px ui-monospace, monospace'; ctx.fillText(String(gx), gx + 18, ch - 6); }
        }
        var zw = cw / zones;
        for (var zi = 0; zi < zones; zi++) {
          ctx.strokeStyle = 'rgba(34,211,160,0.9)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(zi * zw + 0.5, 0); ctx.lineTo(zi * zw + 0.5, ch); ctx.stroke();
          ctx.fillStyle = '#22d3a0'; ctx.font = '700 15px -apple-system, "Segoe UI", sans-serif'; ctx.fillText('Z' + (zi + 1), zi * zw + zw / 2, 22);
        }
        ctx.fillStyle = '#f5b731'; ctx.fillRect(0, 0, 12, 12); ctx.fillRect(cw - 12, 0, 12, 12); ctx.fillRect(0, ch - 12, 12, 12); ctx.fillRect(cw - 12, ch - 12, 12, 12);
        ctx.fillStyle = '#ffffff'; ctx.font = '700 22px ui-monospace, monospace'; ctx.fillText(cw + ' × ' + ch, cw / 2, ch / 2 + 8);
      });
    } catch (e) {
      console.error('[KeyWi] strip test: drawing the image failed', e);
      toast('Strip test could not draw the image: ' + ((e && e.message) || e)); return;
    }
    if (!bytes || !bytes.length) { toast('Strip test: the image encoded to zero bytes.'); return; }
    var packets;
    try { packets = Device.stripImagePackets(profile, bytes); }
    catch (e) {
      console.error('[KeyWi] strip test: packetizing failed', e);
      toast('Strip test could not packetize: ' + ((e && e.message) || e)); return;
    }
    var sent = 0, failure = null;
    await queueDeviceWrite(null, async function () {
      for (var pk = 0; pk < packets.length; pk++) {
        if (!device) return;
        try { await device.hid.sendReport(packets[pk].reportId, packets[pk].data); sent++; }
        catch (e) { failure = e; break; }
      }
    });
    if (!device) return;
    if (failure) {
      console.error('[KeyWi] strip test: sendReport rejected at packet ' + (sent + 1) + '/' + packets.length,
        { reportId: packets[0].reportId, bytesPerPacket: packets[0].data.length, totalBytes: bytes.length, error: failure });
      toast('Strip test FAILED at packet ' + (sent + 1) + '/' + packets.length + ': ' + ((failure && failure.message) || failure) + ' (see console).');
      return;
    }
    toast('Strip test sent OK: ' + packets.length + ' packets, ' + bytes.length + ' bytes, ' + profile.strip.w + '×' + profile.strip.h + '.');
  }
  // Everything the driver knows about the connected deck, including the report
  // sizes the hardware itself advertises over WebHID. Console-only diagnostics
  // (CueolaStreamDeck.diagnose()) — geometry itself comes from the model table,
  // verified against Elgato's published HID docs.
  function deviceDiag() {
    if (!device) return { connected: false };
    var d = device.hid;
    var summarize = function (r) {
      var bits = 0;
      (r.items || []).forEach(function (it) { bits += (it.reportCount || 0) * (it.reportSize || 0); });
      return { reportId: r.reportId, payloadBytes: Math.ceil(bits / 8) };
    };
    var out = {
      connected: true,
      vendorId: '0x' + d.vendorId.toString(16), productId: '0x' + d.productId.toString(16),
      productName: d.productName || '(none)', opened: !!d.opened,
      profile: {
        name: profile.name, adaptive: !!profile.adaptive, keys: profile.keys, cols: profile.cols, rows: profile.rows,
        keyPx: profile.keyPx, dials: profile.dials, stateOffset: profile.stateOffset,
        keyRotationDeg: keyDeg(),
        strip: profile.strip ? { w: profile.strip.w, h: profile.strip.h, zones: profile.strip.zones, encodeRotate: !!profile.strip.encodeRotate, command: profile.strip.command, headerSize: profile.strip.headerSize, packetSize: profile.strip.packetSize } : null
      },
      unitInfoFromDevice: device.unitInfo || {},
      savedOverrides: overrides,
      hidCollections: []
    };
    try {
      (d.collections || []).forEach(function (c) {
        out.hidCollections.push({
          usagePage: '0x' + (c.usagePage || 0).toString(16), usage: '0x' + (c.usage || 0).toString(16),
          outputReports: (c.outputReports || []).map(summarize),
          inputReports: (c.inputReports || []).map(summarize),
          featureReports: (c.featureReports || []).map(summarize)
        });
      });
    } catch (e) { out.hidCollectionsError = String(e); }
    return out;
  }

  // ── Setup wizard ────────────────────────────────────────────────────────────
  // Five friendly steps: welcome, deck, Micochondria, OBS, make-it-yours. Live
  // status refreshes in place (connect callbacks re-render the open step), the
  // optional steps skip cleanly, and finishing marks first-run done so the
  // wizard only volunteers itself once. Reopen any time from the toolbar.
  var WIZARD_KEY = 'cueola_streamdeck_wizard_done';
  var wizardStep = -1;   // -1 = closed
  var WIZARD_TOTAL = 5;
  function wizardSeen() { try { return localStorage.getItem(WIZARD_KEY) === '1'; } catch (e) { return true; } }
  function openWizard(step) { wizardStep = step == null ? 0 : step; wizardRender(); }
  function closeWizard(markDone) {
    wizardStep = -1;
    if (markDone) { try { localStorage.setItem(WIZARD_KEY, '1'); } catch (e) {} }
    var o = document.getElementById('sd-wizard'); if (o) { o.className = 'sd-picker sd-wizard'; o.innerHTML = ''; }
    render();
  }
  function wizardRender() {
    var o = document.getElementById('sd-wizard'); if (!o || wizardStep < 0) return;
    var n = wizardStep;
    var deckOn = !!(device || previewMode), tbOn = talkbackState.connected, obsOn = !!(OBSc() && OBSc().isReady && OBSc().isReady());
    var dots = '';
    for (var i = 0; i < WIZARD_TOTAL; i++) dots += '<span class="sd-wz-dot' + (i === n ? ' cur' : (i < n ? ' done' : '')) + '"></span>';
    var body = '';
    if (n === 0) {
      body = '<div class="sd-wz-hero"><h3 class="sd-wordmark sd-wz-mark">Key<span>Wi Bird</span></h3><div class="sd-wz-tag">One deck. The whole rig.</div></div>'
        + '<p class="sd-wz-p">A Stream Deck becomes the control surface for the show: Outrangutan playback and SFX, the Cueola rundown, the Flowmingo prompter, the Micochondria mics, and OBS. Organized by app, like the rig itself.</p>'
        + '<p class="sd-wz-p">A few quick steps. Only the deck matters; the rest is optional and can wait.</p>';
    } else if (n === 1) {
      body = '<div class="sd-wz-t">Connect your deck</div>'
        + (navigator.hid
          ? '<p class="sd-wz-p"><b>Quit the Elgato Stream Deck app first</b>: it holds the USB device and blocks the browser. Then connect and pick your deck from the list. Expect a little light show.</p>'
            + '<div class="sd-wz-actions"><button class="btn-primary" id="sd-wz-connect">Connect deck</button><button class="btn-secondary" id="sd-wz-preview">No deck? Preview on screen</button></div>'
          : '<p class="sd-wz-p">This browser has no WebHID, so real hardware needs <b>Chrome or Edge</b>. Preview mode still works everywhere.</p>'
            + '<div class="sd-wz-actions"><button class="btn-secondary" id="sd-wz-preview">Preview on screen</button></div>')
        + wzStatus(deckOn, deckOn ? (device ? 'Connected: ' + profile.name : 'Preview mode is on: the full deck, on screen.') : 'Waiting for a deck (or preview).');
    } else if (n === 2) {
      body = '<div class="sd-wz-t">Mic<span class="sd-wz-hi">ochondria</span> <span class="sd-wz-opt">optional</span></div>'
        + '<p class="sd-wz-p">The powerhouse for the mics: hold <b>TKB</b> to talk to the crew, hold <b>VofU</b> to speak to the room. It needs the little talkbackd program running on this machine:</p>'
        + '<code class="sd-wz-code">cd talkback/daemon && swift run -c release</code>'
        + '<p class="sd-wz-p">KeyWi Bird finds it by itself. No address, no pairing. The dot below goes green the moment it is up.</p>'
        + wzStatus(tbOn, tbOn ? 'Connected. The mic keys are live: hold to talk.' : 'Not running. Fine to skip; the mic keys wait patiently.');
    } else if (n === 3) {
      body = '<div class="sd-wz-t">OBS Studio <span class="sd-wz-opt">optional</span></div>'
        + '<p class="sd-wz-p">For stream, record, and scene keys, plus the program monitor and stream volume on a dial. In OBS: <b>Tools › WebSocket Server Settings</b>, enable the server, copy the password if one is set.</p>'
        + (obsOn ? '' : '<div class="sd-wz-obs"><input id="sd-wz-obs-url" class="sd-obs-in" placeholder="ws://localhost:4455" value="' + esc(((OBSc() && OBSc().config()) || {}).url || 'ws://localhost:4455') + '"><input id="sd-wz-obs-pw" class="sd-obs-in" type="password" placeholder="' + ((((OBSc() && OBSc().config()) || {}).password) ? '••••••••' : 'password (if set)') + '"><button class="btn-secondary" id="sd-wz-obs-con">Connect OBS</button></div>')
        + wzStatus(obsOn, obsOn ? 'Connected. Scene and stream keys glow live.' : ((OBSc() && OBSc().lastError && OBSc().lastError()) || 'Not connected. Fine to skip.'));
    } else {
      var chips = Object.keys(DECK_THEMES).map(function (id) { return '<button class="sd-theme-chip sd-th-' + id + (id === deckTheme ? ' cur' : '') + '" data-wz-theme="' + id + '">' + esc(DECK_THEMES[id].name) + '</button>'; }).join('');
      body = '<div class="sd-wz-t">Make it yours</div>'
        + '<p class="sd-wz-p">Pick a look. It reskins the physical keys and the on-screen deck alike:</p>'
        + '<div class="sd-theme-chips sd-wz-themes">' + chips + '</div>'
        + '<p class="sd-wz-p">From here: click any key to remap it, use <b>Live learn</b> to map by touch, and save whole layouts as pages. And yes, there is a HYPE key.</p>';
    }
    var foot = '<div class="sd-wz-foot">'
      + (n > 0 ? '<button class="btn-secondary" id="sd-wz-back">Back</button>' : '<button class="btn-secondary" id="sd-wz-skipall">Skip the tour</button>')
      + '<span class="sd-pf-sp"></span>'
      + ((n === 2 || n === 3) ? '<button class="sd-mini" id="sd-wz-skip">Skip</button>' : '')
      + (n < WIZARD_TOTAL - 1 ? '<button class="btn-primary" id="sd-wz-next">' + (n === 0 ? 'Set it up' : 'Next') + '</button>' : '<button class="btn-primary" id="sd-wz-finish">Start driving</button>')
      + '</div>';
    o.innerHTML = '<div class="sd-picker-card sd-wz-card"><div class="sd-wz-dots">' + dots + '</div>' + body + foot + '</div>';
    o.className = 'sd-picker sd-wizard on';
    wireWizard();
  }
  function wzStatus(on, text) { return '<div class="sd-wz-status' + (on ? ' on' : '') + '"><span class="sd-obs-dot' + (on ? ' on' : '') + '"></span>' + esc(text) + '</div>'; }
  function wireWizard() {
    var o = document.getElementById('sd-wizard'); if (!o) return;
    o.onclick = function (e) { if (e.target === o) closeWizard(false); };
    var go = function (id, fn) { var el = document.getElementById(id); if (el) el.onclick = fn; };
    go('sd-wz-back', function () { wizardStep = Math.max(0, wizardStep - 1); wizardRender(); });
    go('sd-wz-next', function () { wizardStep++; wizardRender(); });
    go('sd-wz-skip', function () { wizardStep++; wizardRender(); });
    go('sd-wz-skipall', function () { closeWizard(true); });
    go('sd-wz-finish', function () { closeWizard(true); toast('KeyWi Bird is ready. Enjoy the deck.'); });
    go('sd-wz-connect', function () { connect(); });
    go('sd-wz-preview', function () { startPreview(); wizardRender(); });
    go('sd-wz-obs-con', function () {
      var url = (document.getElementById('sd-wz-obs-url') || {}).value || 'ws://localhost:4455';
      var pw = (document.getElementById('sd-wz-obs-pw') || {}).value || '';
      if (OBSc()) { if (!pw) pw = ((OBSc().config && OBSc().config()) || {}).password || ''; OBSc().configure({ url: url, password: pw }); OBSc().connect(); toast('Connecting to OBS…'); }
    });
    o.querySelectorAll('[data-wz-theme]').forEach(function (chip) { chip.onclick = function () { setTheme(chip.getAttribute('data-wz-theme')); wizardRender(); }; });
  }

  // ── Entry / gating ──────────────────────────────────────────────────────────
  // INC-4: the gate is fail-closed once Firebase is ready. With Firebase up and
  // no signed-in identity, KeyWi Bird does NOT open, even if the identity
  // module itself failed to load. Only a machine with no Firebase at all (pure
  // local dev) may pass without the module.
  function keyWiSignInGate() {
    var id = window.CueolaIdentity;
    var signedIn = false;
    try { signedIn = !!(id && typeof id.identity === 'function' && id.identity()); } catch (e) {}
    if (signedIn) return true;
    var fbReady = false;
    try { fbReady = !!window._firebaseReady; } catch (e) {}
    if (!fbReady && !(id && typeof id.identity === 'function')) return true;   // no Firebase, no identity module: local-only dev
    if (id && typeof id.openSignIn === 'function') {
      // returnTo is new API; call it defensively and fall back to the plain form.
      try { id.openSignIn({ returnTo: 'keywi' }); }
      catch (e) { try { id.openSignIn(); } catch (e2) {} }
    }
    toast('Sign in to open KeyWi Bird.');
    return false;
  }
  function open() {
    if (!keyWiSignInGate()) return false;
    showScreen(); buildCatalog(); loadTheme();
    try { brightness = Math.max(0, Math.min(100, parseInt(localStorage.getItem(BRIGHTNESS_KEY), 10) || 80)); } catch (e) {}
    talkbackConnect();
    // OBS: repaint on state changes, and reconnect automatically if the operator
    // set it up before (a saved config means they use OBS with this deck).
    if (OBSc()) { OBSc().onChange(onObsChange); var oc = OBSc().config(); var savedObs = false; try { savedObs = !!localStorage.getItem('cueola_obs_config'); } catch (e) {} if (savedObs && oc && oc.url) OBSc().connect(); }
    render();
    if (navigator.hid) navigator.hid.getDevices().then(function (list) { var d = (list || []).filter(supportedFilter)[0]; if (d && !device) openDevice(d); }).catch(function () {});
    // First visit: the wizard volunteers itself once. After that it lives in
    // the toolbar. If a remembered deck reconnects above, it re-renders in place.
    if (navigator.hid && !wizardSeen() && !device && !previewMode) openWizard(0);
    return true;
  }
  function close() { hideScreen(); }
  function showScreen() { var scr = document.getElementById('streamdeck'); if (!scr) return; document.querySelectorAll('.screen.on').forEach(function (s) { s.classList.remove('on'); }); scr.classList.add('on'); try { if (typeof window.pushSessionHistoryState === 'function') window.pushSessionHistoryState('streamdeck'); } catch (e) {} }
  function hideScreen() { var scr = document.getElementById('streamdeck'); if (scr) scr.classList.remove('on'); var entry = document.getElementById('entry'); if (entry) entry.classList.add('on'); }

  window.addEventListener('blur', function () {
    // Focus moving to the Micochondria pop-out is not walking away: a hold
    // started there must survive the opener losing focus. Everything else
    // keeps the original safety: blur releases any held mic.
    setTimeout(function () {
      try { if (micoPopoutAlive() && micoWin.document.hasFocus()) return; } catch (e) {}
      releaseTalkback(false);
    }, 60);
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) releaseTalkback(false); });
  window.addEventListener('beforeunload', function () { releaseTalkback(true); try { if (micoPopoutAlive()) micoWin.close(); } catch (e) {} });
  // Esc parity with the rest of Cueola: closes the topmost layer first (key
  // editor, then wizard), then backs out of KeyWi Bird to the front page.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !isSurfaceVisible()) return;
    var o = overlay();
    if (o && o.classList.contains('on')) { closeOverlay(); return; }
    if (wizardStep >= 0) { closeWizard(false); return; }
    close();
  });

  try { console.log('[KeyWi] driver r6: per-key appearance, Liquid Glass theme, auto-dim'); } catch (e) {}
  window.CueolaStreamDeck = {
    open: open, close: close, connect: connect, disconnect: disconnect,
    isConnected: function () { return !!device; },
    talkbackConnected: function () { return talkbackState.connected; },
    openMicoPopout: openMicoPopout,
    _catalog: function () { buildCatalog(); return catalog; },
    _fire: fireSlot,
    _profileFor: function (pid, opts) { return Device.makeProfile(pid, opts || {}); },
    diagnose: deviceDiag,
    _testStrip: testStrip,
    _stripProbe: stripProbe,
    _profiles: function () { return { profiles: profiles, active: activeProfileId, def: defaultProfileId }; }
  };
})();
