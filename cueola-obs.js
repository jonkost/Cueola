/* Cueola OBS bridge: a small obs-websocket v5 client for KeyWi.
 *
 * OBS Studio 28+ ships obs-websocket v5, a WebSocket server (default
 * ws://localhost:4455). A browser page can drive it directly: connect, do the
 * Hello/Identify handshake (with the SHA-256 challenge/response when a password
 * is set, via crypto.subtle), then send requests and receive events. KeyWi uses
 * this for scene switching, stream/record, virtual cam, replay, and audio mutes,
 * and mirrors OBS state so keys can light up (LIVE, REC, current scene).
 *
 * Show-length hardening (9/3): a Worker-timed keepalive re-reads stream and
 * record status every 5s so a hung OBS or a half-open socket is declared dead
 * after two silent keepalives instead of leaving keys lit forever; request
 * failures reach the caller (and lastRequestError) instead of vanishing; a
 * rejected password (close 4009) stops the reconnect loop with a plain message;
 * every close resets the mirrored state so a relaunched OBS never shows a stale
 * LIVE; exactly one socket owns the handlers at any time, so an orphaned
 * socket's late close cannot dim a fresh connection; and an 8s handshake
 * deadline (connect through Identified) declares a hung OBS dead instead of
 * leaving a CONNECTING socket that connect() would return early on forever.
 *
 * Loopback only, plain ws. crypto.subtle needs a secure context; the deployed
 * HTTPS site and http://localhost both qualify. Dependency-free classic script;
 * attaches window.CueolaOBS.
 */
(function () {
  'use strict';

  // obs-websocket opcodes.
  var OP_HELLO = 0, OP_IDENTIFY = 1, OP_IDENTIFIED = 2, OP_EVENT = 5, OP_REQUEST = 6, OP_RESPONSE = 7;
  // EventSubscription bits we care about: General|Scenes|Inputs|Transitions|Outputs|Ui.
  // Ui (1 << 10) carries StudioModeStateChanged; without it that handler never ran.
  var EVENT_SUBS = (1 << 0) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 6) | (1 << 10);
  // obs-websocket close codes that mean "retrying will not help".
  var CLOSE_AUTH_FAILED = 4009, CLOSE_RPC_UNSUPPORTED = 4010;

  var REQUEST_TIMEOUT_MS = 5000;
  var RECONNECT_MS = 3000;
  var KEEPALIVE_MS = 5000;          // status re-read cadence while connected
  var KEEPALIVE_TIMEOUT_MS = 4000;  // shorter than the cadence so misses count once per tick
  var KEEPALIVE_MISSES = 2;         // consecutive silent keepalives before OBS is declared dead
  var HANDSHAKE_MS = 8000;          // connect() to Identified deadline; a hung OBS keeps its listening socket open and never sends the 101
  var STARTING_STALE_MS = 20000;    // a STARTING/STOPPING with no follow-up event this old is dropped

  var ws = null;
  var ready = false;
  var wantOpen = false;              // user asked to stay connected: auto-reconnect
  var reconnectTimer = null;
  var reqSeq = 0;
  var pending = {};                  // requestId -> {resolve, reject, timer}
  var config = { url: 'ws://localhost:4455', password: '' };
  var changeCb = null;
  var lastError = '';                // connection-level reason (settings row shows it while not connected)
  var lastRequestError = '';         // most recent refused or timed-out request (separate on purpose)
  var gen = 0;                       // connection generation: async work from an old socket bails
  var keepalive = null;              // steadyInterval handle
  var handshakeTimer = null;         // steadyTimeout handle: CONNECTING through Identified must finish inside HANDSHAKE_MS
  var keepaliveBusy = false;         // single in-flight keepalive (the strip poll floods a hung socket on its own)
  var keepaliveMisses = 0;

  var state = {
    connected: false,
    currentScene: '',
    scenes: [],                      // array of scene name strings, program order
    streaming: false,
    recording: false,
    recordPaused: false,
    virtualCam: false,
    studioMode: false,
    streamState: '',                 // OBS_WEBSOCKET_OUTPUT_STARTING/STARTED/STOPPING/STOPPED from events, '' when unknown
    recordState: '',                 // same for the record output (also PAUSED/RESUMED)
    inputs: [],                      // array of input name strings
    mutes: {},                       // inputName -> bool
    volumes: {}                      // inputName -> volume multiplier (1.0 = 0 dB)
  };
  var transitionAt = { stream: 0, record: 0 };

  function emitChange() { state.connected = ready; try { changeCb && changeCb(state); } catch (e) {} }

  function loadConfig() { try { var c = JSON.parse(localStorage.getItem('cueola_obs_config') || '{}'); if (c && c.url) config = { url: c.url, password: c.password || '' }; } catch (e) {} return config; }
  function saveConfig(c) { config = { url: (c && c.url) || 'ws://localhost:4455', password: (c && c.password) || '' }; try { localStorage.setItem('cueola_obs_config', JSON.stringify(config)); } catch (e) {} }

  async function sha256b64(str) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    var bytes = new Uint8Array(buf), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  async function authResponse(password, salt, challenge) {
    var secret = await sha256b64(password + salt);
    return await sha256b64(secret + challenge);
  }

  // Worker-backed interval: page timers throttle to about once a minute after
  // the tab has been hidden a while (the operator lives in OBS during a show),
  // Worker timers do not. Same trick as KeyWi's paint loop. Falls back to a
  // page setInterval where Workers are unavailable.
  function steadyInterval(fn, ms) {
    try {
      var src = 'let t=null;onmessage=e=>{if(e.data&&e.data.ms){clearInterval(t);t=setInterval(()=>postMessage(1),e.data.ms)}else clearInterval(t)}';
      var w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = function () { try { fn(); } catch (e) {} };
      w.postMessage({ ms: ms });
      return { stop: function () { try { w.terminate(); } catch (e) {} } };
    } catch (e) {
      var t = setInterval(fn, ms);
      return { stop: function () { clearInterval(t); } };
    }
  }

  // One-shot on the same Worker clock (fires once, then stops), plain setTimeout
  // where even the fallback interval could not be built.
  function steadyTimeout(fn, ms) {
    var done = false, handle = null;
    try {
      handle = steadyInterval(function () {
        if (done) return;
        done = true;
        try { handle && handle.stop(); } catch (e) {}
        fn();
      }, ms);
      return { stop: function () { done = true; try { handle && handle.stop(); } catch (e) {} } };
    } catch (e) {
      var t = setTimeout(function () { if (done) return; done = true; fn(); }, ms);
      return { stop: function () { done = true; clearTimeout(t); } };
    }
  }

  function send(obj) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) {} } }
  function requestWithTimeout(requestType, requestData, timeoutMs) {
    return new Promise(function (resolve, reject) {
      // A CLOSING socket used to pass this gate and drop the frame into a silent 5s timeout.
      if (!ready || !ws || ws.readyState !== 1) { reject(new Error('OBS not connected')); return; }
      var requestId = 'k' + (++reqSeq);
      var timer = setTimeout(function () {
        if (!pending[requestId]) return;
        delete pending[requestId];
        reject(new Error('OBS request timed out'));
      }, timeoutMs);
      pending[requestId] = { resolve: resolve, reject: reject, timer: timer };
      send({ op: OP_REQUEST, d: { requestType: requestType, requestId: requestId, requestData: requestData || {} } });
    });
  }
  function request(requestType, requestData) { return requestWithTimeout(requestType, requestData, REQUEST_TIMEOUT_MS); }
  function rejectPending(reason) {
    var ids = Object.keys(pending);
    for (var i = 0; i < ids.length; i++) {
      var p = pending[ids[i]];
      delete pending[ids[i]];
      clearTimeout(p.timer);
      try { p.reject(new Error(reason)); } catch (e) {}
    }
  }

  // Everything the deck mirrors from OBS goes back to "off" when the socket is
  // gone: dimmed keys read as off, so an unknown value is honestly off, and a
  // relaunched OBS never flashes a stale LIVE before the re-prime lands.
  function resetLiveState() {
    state.currentScene = '';
    state.scenes = [];
    state.streaming = false;
    state.recording = false;
    state.recordPaused = false;
    state.virtualCam = false;
    state.studioMode = false;
    state.streamState = '';
    state.recordState = '';
    state.inputs = [];
    state.mutes = {};
    state.volumes = {};
    transitionAt.stream = 0; transitionAt.record = 0;
  }
  function detachSocket(sock) { if (!sock) return; try { sock.onopen = null; sock.onmessage = null; sock.onclose = null; sock.onerror = null; } catch (e) {} }
  function stopKeepalive() { if (keepalive) { try { keepalive.stop(); } catch (e) {} } keepalive = null; keepaliveBusy = false; keepaliveMisses = 0; }
  function startKeepalive() { stopKeepalive(); keepalive = steadyInterval(keepaliveTick, KEEPALIVE_MS); }
  function stopHandshakeDeadline() { if (handshakeTimer) { try { handshakeTimer.stop(); } catch (e) {} } handshakeTimer = null; }
  // A hung OBS still accepts TCP, so the browser socket sits in CONNECTING (or
  // OPEN with no Identified) with no browser-side timeout, and connect() would
  // return early on it forever. Gen-scoped: an old socket's deadline can never
  // fire on its replacement.
  function startHandshakeDeadline(sock) {
    stopHandshakeDeadline();
    var myGen = gen, mine = null;
    mine = steadyTimeout(function () {
      if (handshakeTimer === mine) handshakeTimer = null;
      if (myGen !== gen || sock !== ws || ready) return;
      markDead('OBS is not completing the handshake');
    }, HANDSHAKE_MS);
    handshakeTimer = mine;
  }

  function connect() {
    wantOpen = true;
    loadConfig();
    clearTimeout(reconnectTimer); reconnectTimer = null;
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    if (ws) {
      // A CLOSING or CLOSED socket is replaced; detach it first so its late
      // close event cannot touch the connection that replaces it.
      var stale = ws; ws = null; detachSocket(stale);
      try { stale.close(); } catch (e) {}
    }
    if (!/^wss?:\/\//.test(config.url)) { lastError = 'OBS address must start with ws://'; emitChange(); return; }
    var sock;
    try { sock = new WebSocket(config.url); } catch (e) { lastError = 'Could not open ' + config.url; emitChange(); scheduleReconnect(); return; }
    gen++;
    ws = sock;
    // Per-connection capture: a handler only acts while its socket is still the live one.
    sock.onmessage = function (evt) { if (sock !== ws) return; onMessage(evt); };
    sock.onclose = function (ev) { if (sock !== ws) return; onClose(ev); };
    sock.onerror = function () { if (sock !== ws) return; lastError = 'OBS not reachable at ' + config.url + ' (is obs-websocket enabled?)'; };
    startHandshakeDeadline(sock);
  }
  function onClose(ev) {
    var code = ev && ev.code;
    ws = null; ready = false; gen++;
    stopHandshakeDeadline();
    stopKeepalive();
    rejectPending('OBS connection closed');
    resetLiveState();
    if (code === CLOSE_AUTH_FAILED) {
      lastError = 'OBS rejected the password. Open Deck settings, OBS Studio, and enter the current one.';
      wantOpen = false; clearTimeout(reconnectTimer); reconnectTimer = null;
      emitChange(); return;
    }
    if (code === CLOSE_RPC_UNSUPPORTED) {
      lastError = 'This OBS speaks a WebSocket version Cueola does not. Update OBS Studio to 28 or newer.';
      wantOpen = false; clearTimeout(reconnectTimer); reconnectTimer = null;
      emitChange(); return;
    }
    // 4011 (SessionInvalidated: the OBS WebSocket settings changed) and every
    // other close keep retrying; a password change surfaces as 4009 next time.
    lastError = lastError || 'OBS connection closed';
    emitChange();
    scheduleReconnect();
  }
  // Liveness failure: two keepalives in a row went unanswered, or the handshake
  // deadline passed. Do not wait for the close handshake (a frozen peer can sit
  // in CLOSING for a long time); detach the socket, declare the link dead, and
  // let the reconnect loop find OBS again when it answers.
  function markDead(reason) {
    reason = reason || 'OBS stopped answering';
    var old = ws;
    detachSocket(old);
    ws = null; ready = false; gen++;
    stopHandshakeDeadline();
    stopKeepalive();
    lastError = reason;
    rejectPending(reason);
    resetLiveState();
    emitChange();
    if (old) { try { old.close(); } catch (e) {} }
    scheduleReconnect();
  }
  function disconnect() {
    wantOpen = false; clearTimeout(reconnectTimer); reconnectTimer = null;
    var old = ws;
    detachSocket(old);
    ws = null; ready = false; gen++;
    stopHandshakeDeadline();
    stopKeepalive();
    rejectPending('OBS disconnected');
    resetLiveState();
    if (old) { try { old.close(); } catch (e) {} }
    emitChange();
  }
  function scheduleReconnect() { if (!wantOpen) return; clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, RECONNECT_MS); }

  async function onMessage(evt) {
    var msg; try { msg = JSON.parse(evt.data); } catch (e) { return; }
    keepaliveMisses = 0;   // anything from OBS proves it is alive, even if a keepalive is slow
    if (msg.op === OP_HELLO) {
      var d = msg.d || {}, identify = { rpcVersion: 1, eventSubscriptions: EVENT_SUBS };
      if (d.authentication) {
        if (!config.password) { lastError = 'OBS needs a password (set it in obs-websocket settings, then enter it here).'; disconnect(); return; }
        var myGen = gen;
        try { identify.authentication = await authResponse(config.password, d.authentication.salt, d.authentication.challenge); }
        catch (e) { if (myGen !== gen) return; lastError = 'Could not compute OBS auth (needs a secure context).'; disconnect(); return; }
        if (myGen !== gen) return;
      }
      send({ op: OP_IDENTIFY, d: identify });
    } else if (msg.op === OP_IDENTIFIED) {
      // ready first so primeState's requests pass the gate; primeState's own
      // emitChange is the first "connected" emit, after real status is in hand.
      ready = true; lastError = ''; lastRequestError = '';
      stopHandshakeDeadline();
      startKeepalive();
      primeState();
    } else if (msg.op === OP_RESPONSE) {
      var r = msg.d || {}, p = pending[r.requestId];
      if (p) {
        delete pending[r.requestId];
        clearTimeout(p.timer);
        if (r.requestStatus && r.requestStatus.result) p.resolve(r.responseData || {});
        else p.reject(new Error((r.requestStatus && r.requestStatus.comment) || 'OBS request failed'));
      }
    } else if (msg.op === OP_EVENT) {
      onEvent(msg.d || {});
    }
  }

  // Apply GetStreamStatus / GetRecordStatus answers. Returns true when the
  // mirrored state moved. Status answers carry no outputState, so the event-fed
  // transition words are only reconciled, never invented: an output that reads
  // active settles STARTING into STARTED, one that reads inactive settles
  // STOPPING into STOPPED, and a transition older than STARTING_STALE_MS with
  // no follow-up event (a missed event across a busy moment) is dropped so a
  // deck-side "connecting" gate can never stick.
  function applyOutputStatus(kind, st) {
    var changed = false, now = Date.now();
    var active = !!st.outputActive;
    var key = kind === 'stream' ? 'streaming' : 'recording';
    var stKey = kind === 'stream' ? 'streamState' : 'recordState';
    if (state[key] !== active) { state[key] = active; changed = true; }
    if (kind === 'record' && st.outputPaused != null && state.recordPaused !== !!st.outputPaused) { state.recordPaused = !!st.outputPaused; changed = true; }
    var ts = state[stKey], next = ts;
    if (active && (ts === '' || ts === 'OBS_WEBSOCKET_OUTPUT_STARTING')) next = 'OBS_WEBSOCKET_OUTPUT_STARTED';
    else if (!active && ts === 'OBS_WEBSOCKET_OUTPUT_STOPPING') next = 'OBS_WEBSOCKET_OUTPUT_STOPPED';
    else if (!active && ts === 'OBS_WEBSOCKET_OUTPUT_STARTING' && transitionAt[kind] && now - transitionAt[kind] > STARTING_STALE_MS) next = '';
    if (next !== ts) { state[stKey] = next; changed = true; }
    return changed;
  }

  async function keepaliveTick() {
    if (!ready || keepaliveBusy) return;
    keepaliveBusy = true;
    var myGen = gen;
    try {
      var ss = await requestWithTimeout('GetStreamStatus', null, KEEPALIVE_TIMEOUT_MS);
      var rs = await requestWithTimeout('GetRecordStatus', null, KEEPALIVE_TIMEOUT_MS);
      if (myGen !== gen || !ready) return;
      keepaliveMisses = 0;
      var changed = applyOutputStatus('stream', ss || {});
      if (applyOutputStatus('record', rs || {})) changed = true;
      if (changed) emitChange();
    } catch (e) {
      if (myGen !== gen || !ready) return;
      // Only the keepalive's own silence counts; a refused request is still an answer.
      if (e && /timed out/.test(e.message || '')) {
        keepaliveMisses++;
        if (keepaliveMisses >= KEEPALIVE_MISSES) markDead();
      }
    } finally {
      if (myGen === gen) keepaliveBusy = false;
    }
  }

  async function primeState() {
    var myGen = gen;
    var alive = function () { return myGen === gen && ready; };
    try {
      var sl = await request('GetSceneList');
      if (!alive()) return;
      state.scenes = (sl.scenes || []).map(function (s) { return s.sceneName; }).reverse(); // OBS lists reverse of UI; program order top-down
      state.currentScene = sl.currentProgramSceneName || '';
    } catch (e) {}
    try { var ss = await request('GetStreamStatus'); if (!alive()) return; applyOutputStatus('stream', ss || {}); } catch (e) {}
    try { var rs = await request('GetRecordStatus'); if (!alive()) return; applyOutputStatus('record', rs || {}); } catch (e) {}
    try { var vc = await request('GetVirtualCamStatus'); if (!alive()) return; state.virtualCam = !!vc.outputActive; } catch (e) {}
    try { var sm = await request('GetStudioModeEnabled'); if (!alive()) return; state.studioMode = !!sm.studioModeEnabled; } catch (e) {}
    try {
      var il = await request('GetInputList');
      if (!alive()) return;
      state.inputs = (il.inputs || []).map(function (i) { return i.inputName; });
      for (var k = 0; k < state.inputs.length; k++) {
        try { var m = await request('GetInputMute', { inputName: state.inputs[k] }); if (!alive()) return; state.mutes[state.inputs[k]] = !!m.inputMuted; } catch (e) {}
        try { var v = await request('GetInputVolume', { inputName: state.inputs[k] }); if (!alive()) return; state.volumes[state.inputs[k]] = v.inputVolumeMul; } catch (e) {}
      }
    } catch (e) {}
    if (!alive()) return;
    emitChange();
  }

  function onEvent(d) {
    var t = d.eventType, e = d.eventData || {};
    if (t === 'CurrentProgramSceneChanged') state.currentScene = e.sceneName;
    else if (t === 'StreamStateChanged') { state.streaming = !!e.outputActive; state.streamState = e.outputState || ''; transitionAt.stream = Date.now(); }
    else if (t === 'RecordStateChanged') { state.recording = !!e.outputActive; state.recordState = e.outputState || ''; transitionAt.record = Date.now(); if (e.outputPaused != null) state.recordPaused = !!e.outputPaused; }
    else if (t === 'RecordPauseStateChanged') state.recordPaused = !!e.outputPaused;
    else if (t === 'VirtualcamStateChanged') state.virtualCam = !!e.outputActive;
    else if (t === 'StudioModeStateChanged') state.studioMode = !!e.studioModeEnabled;
    else if (t === 'InputMuteStateChanged') state.mutes[e.inputName] = !!e.inputMuted;
    else if (t === 'InputVolumeChanged') state.volumes[e.inputName] = e.inputVolumeMul;
    else if (t === 'SceneListChanged') state.scenes = (e.scenes || []).map(function (s) { return s.sceneName; }).reverse();
    else if (t === 'InputCreated' && e.inputName) { if (state.inputs.indexOf(e.inputName) < 0) state.inputs.push(e.inputName); }
    else if (t === 'InputRemoved' && e.inputName) { state.inputs = state.inputs.filter(function (n) { return n !== e.inputName; }); delete state.mutes[e.inputName]; delete state.volumes[e.inputName]; }
    else return;
    emitChange();
  }

  // ── Public control methods ──────────────────────────────────────────────────
  // Each returns the request promise so a caller can show OBS's reason (a
  // renamed scene, a refused toggle, a timeout). The side branch records the
  // failure in lastRequestError and marks the rejection handled, so a caller
  // that ignores the promise gets no console noise and the connection-level
  // lastError stays untouched.
  function noteRequestError(e) { lastRequestError = (e && e.message) || 'OBS request failed'; emitChange(); }
  function control(requestType, requestData) {
    var p = request(requestType, requestData);
    p.then(null, noteRequestError);
    return p;
  }
  function setScene(name) { return control('SetCurrentProgramScene', { sceneName: name }); }
  function toggleStream() { return control('ToggleStream'); }
  function toggleRecord() { return control('ToggleRecord'); }
  function pauseRecord() { return control('ToggleRecordPause'); }
  function toggleVirtualCam() { return control('ToggleVirtualCam'); }
  function saveReplay() { return control('SaveReplayBuffer'); }
  function studioTransition() { return control('TriggerStudioModeTransition'); }
  function toggleMute(input) { return control('ToggleInputMute', { inputName: input }); }
  function setVolume(input, mul) { mul = Math.max(0, Math.min(1, mul)); state.volumes[input] = mul; return control('SetInputVolume', { inputName: input, inputVolumeMul: mul }); }

  window.CueolaOBS = {
    configure: saveConfig, config: function () { return loadConfig(); },
    connect: connect, disconnect: disconnect,
    isReady: function () { return ready; },
    lastError: function () { return lastError; },
    lastRequestError: function () { return lastRequestError; },
    state: function () { return state; },
    onChange: function (cb) { changeCb = cb; },
    setScene: setScene, toggleStream: toggleStream, toggleRecord: toggleRecord, pauseRecord: pauseRecord,
    toggleVirtualCam: toggleVirtualCam, saveReplay: saveReplay, studioTransition: studioTransition,
    toggleMute: toggleMute, setVolume: setVolume, request: request
  };
})();
