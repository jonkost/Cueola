/* Cueola OBS bridge: a small obs-websocket v5 client for KeyWi.
 *
 * OBS Studio 28+ ships obs-websocket v5, a WebSocket server (default
 * ws://localhost:4455). A browser page can drive it directly: connect, do the
 * Hello/Identify handshake (with the SHA-256 challenge/response when a password
 * is set, via crypto.subtle), then send requests and receive events. KeyWi uses
 * this for scene switching, stream/record, virtual cam, replay, and audio mutes,
 * and mirrors OBS state so keys can light up (LIVE, REC, current scene).
 *
 * Loopback only, plain ws. crypto.subtle needs a secure context; the deployed
 * HTTPS site and http://localhost both qualify. Dependency-free classic script;
 * attaches window.CueolaOBS.
 */
(function () {
  'use strict';

  // obs-websocket opcodes.
  var OP_HELLO = 0, OP_IDENTIFY = 1, OP_IDENTIFIED = 2, OP_EVENT = 5, OP_REQUEST = 6, OP_RESPONSE = 7;
  // EventSubscription bits we care about: General|Scenes|Inputs|Outputs|Transitions.
  var EVENT_SUBS = (1 << 0) | (1 << 2) | (1 << 3) | (1 << 6) | (1 << 4);

  var ws = null;
  var ready = false;
  var wantOpen = false;              // user asked to stay connected → auto-reconnect
  var reconnectTimer = null;
  var reqSeq = 0;
  var pending = {};                  // requestId -> {resolve, reject}
  var config = { url: 'ws://localhost:4455', password: '' };
  var changeCb = null;
  var lastError = '';

  var state = {
    connected: false,
    currentScene: '',
    scenes: [],                      // array of scene name strings, program order
    streaming: false,
    recording: false,
    recordPaused: false,
    virtualCam: false,
    studioMode: false,
    inputs: [],                      // array of input name strings
    mutes: {}                        // inputName -> bool
  };

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

  function send(obj) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) {} } }
  function request(requestType, requestData) {
    return new Promise(function (resolve, reject) {
      if (!ready) { reject(new Error('OBS not connected')); return; }
      var requestId = 'k' + (++reqSeq);
      pending[requestId] = { resolve: resolve, reject: reject };
      send({ op: OP_REQUEST, d: { requestType: requestType, requestId: requestId, requestData: requestData || {} } });
      setTimeout(function () { if (pending[requestId]) { delete pending[requestId]; reject(new Error('OBS request timed out')); } }, 5000);
    });
  }

  function connect() {
    wantOpen = true;
    loadConfig();
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    if (!/^wss?:\/\//.test(config.url)) { lastError = 'OBS address must start with ws://'; emitChange(); return; }
    try { ws = new WebSocket(config.url); } catch (e) { lastError = 'Could not open ' + config.url; scheduleReconnect(); return; }
    ws.onmessage = onMessage;
    ws.onclose = function () { ready = false; lastError = lastError || 'OBS connection closed'; emitChange(); scheduleReconnect(); };
    ws.onerror = function () { lastError = 'OBS not reachable at ' + config.url + ' (is obs-websocket enabled?)'; };
  }
  function disconnect() { wantOpen = false; clearTimeout(reconnectTimer); ready = false; if (ws) { try { ws.close(); } catch (e) {} } ws = null; state.currentScene = ''; emitChange(); }
  function scheduleReconnect() { if (!wantOpen) return; clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 3000); }

  async function onMessage(evt) {
    var msg; try { msg = JSON.parse(evt.data); } catch (e) { return; }
    if (msg.op === OP_HELLO) {
      var d = msg.d || {}, identify = { rpcVersion: 1, eventSubscriptions: EVENT_SUBS };
      if (d.authentication) {
        if (!config.password) { lastError = 'OBS needs a password (set it in obs-websocket settings, then enter it here).'; disconnect(); return; }
        try { identify.authentication = await authResponse(config.password, d.authentication.salt, d.authentication.challenge); }
        catch (e) { lastError = 'Could not compute OBS auth (needs a secure context).'; disconnect(); return; }
      }
      send({ op: OP_IDENTIFY, d: identify });
    } else if (msg.op === OP_IDENTIFIED) {
      ready = true; lastError = ''; emitChange(); primeState();
    } else if (msg.op === OP_RESPONSE) {
      var r = msg.d || {}, p = pending[r.requestId];
      if (p) { delete pending[r.requestId]; if (r.requestStatus && r.requestStatus.result) p.resolve(r.responseData || {}); else p.reject(new Error((r.requestStatus && r.requestStatus.comment) || 'OBS request failed')); }
    } else if (msg.op === OP_EVENT) {
      onEvent(msg.d || {});
    }
  }

  async function primeState() {
    try {
      var sl = await request('GetSceneList');
      state.scenes = (sl.scenes || []).map(function (s) { return s.sceneName; }).reverse(); // OBS lists reverse of UI; program order top-down
      state.currentScene = sl.currentProgramSceneName || '';
    } catch (e) {}
    try { state.streaming = !!(await request('GetStreamStatus')).outputActive; } catch (e) {}
    try { var rs = await request('GetRecordStatus'); state.recording = !!rs.outputActive; state.recordPaused = !!rs.outputPaused; } catch (e) {}
    try { state.virtualCam = !!(await request('GetVirtualCamStatus')).outputActive; } catch (e) {}
    try { state.studioMode = !!(await request('GetStudioModeEnabled')).studioModeEnabled; } catch (e) {}
    try {
      var il = await request('GetInputList');
      state.inputs = (il.inputs || []).map(function (i) { return i.inputName; });
      for (var k = 0; k < state.inputs.length; k++) { try { state.mutes[state.inputs[k]] = !!(await request('GetInputMute', { inputName: state.inputs[k] })).inputMuted; } catch (e) {} }
    } catch (e) {}
    emitChange();
  }

  function onEvent(d) {
    var t = d.eventType, e = d.eventData || {};
    if (t === 'CurrentProgramSceneChanged') state.currentScene = e.sceneName;
    else if (t === 'StreamStateChanged') state.streaming = !!e.outputActive;
    else if (t === 'RecordStateChanged') { state.recording = !!e.outputActive; if (e.outputPaused != null) state.recordPaused = !!e.outputPaused; }
    else if (t === 'RecordPauseStateChanged') state.recordPaused = !!e.outputPaused;
    else if (t === 'VirtualcamStateChanged') state.virtualCam = !!e.outputActive;
    else if (t === 'StudioModeStateChanged') state.studioMode = !!e.studioModeEnabled;
    else if (t === 'InputMuteStateChanged') state.mutes[e.inputName] = !!e.inputMuted;
    else if (t === 'SceneListChanged') state.scenes = (e.scenes || []).map(function (s) { return s.sceneName; }).reverse();
    else if (t === 'InputCreated' && e.inputName) { if (state.inputs.indexOf(e.inputName) < 0) state.inputs.push(e.inputName); }
    else if (t === 'InputRemoved' && e.inputName) { state.inputs = state.inputs.filter(function (n) { return n !== e.inputName; }); delete state.mutes[e.inputName]; }
    else return;
    emitChange();
  }

  // ── Public control methods ──────────────────────────────────────────────────
  function setScene(name) { return request('SetCurrentProgramScene', { sceneName: name }).catch(noop); }
  function toggleStream() { return request('ToggleStream').catch(noop); }
  function toggleRecord() { return request('ToggleRecord').catch(noop); }
  function pauseRecord() { return request('ToggleRecordPause').catch(noop); }
  function toggleVirtualCam() { return request('ToggleVirtualCam').catch(noop); }
  function saveReplay() { return request('SaveReplayBuffer').catch(noop); }
  function studioTransition() { return request('TriggerStudioModeTransition').catch(noop); }
  function toggleMute(input) { return request('ToggleInputMute', { inputName: input }).catch(noop); }
  function setVolume(input, mul) { return request('SetInputVolume', { inputName: input, inputVolumeMul: Math.max(0, Math.min(1, mul)) }).catch(noop); }
  function noop() {}

  window.CueolaOBS = {
    configure: saveConfig, config: function () { return loadConfig(); },
    connect: connect, disconnect: disconnect,
    isReady: function () { return ready; },
    lastError: function () { return lastError; },
    state: function () { return state; },
    onChange: function (cb) { changeCb = cb; },
    setScene: setScene, toggleStream: toggleStream, toggleRecord: toggleRecord, pauseRecord: pauseRecord,
    toggleVirtualCam: toggleVirtualCam, saveReplay: saveReplay, studioTransition: studioTransition,
    toggleMute: toggleMute, setVolume: setVolume, request: request
  };
})();
