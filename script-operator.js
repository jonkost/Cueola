(() => {
  'use strict';

  const THEMES = ['cool', 'warm', 'white', 'green', 'koala', 'panda', 'flamingo', 'outrangutan', 'prepbear'];
  // Tab names and grouping mirror the in-app operator inspector
  // (OP_INSP_LABELS); the pop-out stops at four tabs, so Screen rides
  // Transport and the editor helpers ride Display & Theme.
  const TAB_LABELS = {
    transport: 'Transport',
    live: 'Cue & On Air',
    clocks: 'Clocks & Alerts',
    display: 'Display & Theme'
  };
  // Remembered tab keys from the pre-regroup layout map onto their new homes.
  const LEGACY_TAB_KEYS = { prompter: 'transport', formatting: 'display' };
  const COMMAND_RETRY_MS = 1500;
  const COMMAND_MAX_ATTEMPTS = 4;
  const params = new URLSearchParams(location.search);
  const productionCode = String(params.get('code') || params.get('productionCode') || '').trim().toUpperCase();
  const sessionId = String(params.get('session') || params.get('sessionId') || '').trim();
  const controllerInstanceId = String(params.get('controller') || params.get('controllerInstanceId') || '').trim();
  const operatorInstanceId = makeId('script-op');
  const expectedOrigin = location.origin;
  const protocolApi = window.CueolaScriptOperatorProtocol || null;
  const identity = { productionCode, sessionId, controllerInstanceId, operatorInstanceId };

  const root = document.getElementById('scriptOperatorRoot');
  const editor = document.getElementById('scriptEditor');
  const controlsRoot = document.getElementById('scriptOperatorControls');
  const connectionStatus = document.getElementById('connectionStatus');
  const connectionStatusText = document.getElementById('connectionStatusText');
  const connectionBanner = document.getElementById('connectionBanner');
  const connectionDetail = document.getElementById('connectionDetail');
  const draftStatus = document.getElementById('draftStatus');

  let protocol = null;
  let channel = null;
  let heartbeatTimer = null;
  let clockTimer = null;
  let draftTimer = null;
  let lastControllerSeenAt = Date.now();
  let lastReadySentAt = 0;   // rate limit for automatic READY re-requests
  let stateApplied = false;
  let talentLine = '';   // heartbeat truth from the host: 'Talent connected · row 4 · rolling · seen 1s ago'
  let sessionControlsEnabled = false;
  let disconnected = false;
  let editorDirty = false;
  let pendingEditorText = null;
  let currentSnapshot = {};
  let clockState = { mode: 'off', label: '', targetTs: 0, size: 1 };
  let questionOn = false;
  let questionCardsFingerprint = '';
  let activeTheme = initialTheme();
  let closed = false;
  const seenMessageIds = new Map();
  const activeHolds = new Map();
  const pendingControlValues = new Map();
  const pendingIntents = new Map();
  const previewThrottles = new Map();

  // D11.1: window-level keycommands via the shared cueola-keymap.js engine,
  // including the owner's direct ask, J/L hold-to-Brake/Boost, so bindings,
  // overrides, and the "?" reference match the Live surface exactly.
  // Declared with the boot state so hold release paths can run during init.
  const keymapApi = window.CueolaKeymap || null;
  const OPERATOR_KEYMAP = [
    { id: 'scriptop.playpause',  scope: 'scriptop', group: 'Prompter', keys: ['Space', 'K'], label: 'Play / pause',
      run: () => sendIntent('control', { action: document.getElementById('playButton')?.dataset.action || 'resume' }) },
    { id: 'scriptop.brake',      scope: 'scriptop', group: 'Prompter', keys: ['J'], label: 'Brake (hold)', hold: ['brake_start', 'brake_stop'] },
    { id: 'scriptop.boost',      scope: 'scriptop', group: 'Prompter', keys: ['L'], label: 'Boost (hold)', hold: ['boost_start', 'boost_stop'] },
    { id: 'scriptop.size.down',  scope: 'scriptop', group: 'Prompter', keys: ['-'], label: 'Text smaller', run: () => sendIntent('control', { action: 'size_down' }) },
    { id: 'scriptop.size.up',    scope: 'scriptop', group: 'Prompter', keys: ['='], label: 'Text bigger',  run: () => sendIntent('control', { action: 'size_up' }) },
    { id: 'scriptop.speed.down', scope: 'scriptop', group: 'Prompter', keys: ['['], label: 'Speed down',   run: () => sendIntent('control', { action: 'speed_down' }) },
    { id: 'scriptop.speed.up',   scope: 'scriptop', group: 'Prompter', keys: [']'], label: 'Speed up',     run: () => sendIntent('control', { action: 'speed_up' }) },
    { id: 'scriptop.ref',        scope: 'scriptop', group: 'Reference', keys: ['?'], label: 'This shortcut reference', run: () => toggleOperatorKeymapRef() },
  ];
  const operatorHolds = keymapApi
    ? keymapApi.createHoldTracker(sendHoldControl)
    : null;

  document.documentElement.dataset.theme = activeTheme;
  init();

  function init() {
    restoreTab();
    restorePanelZoom();
    bindEvents();
    setCommandAvailability(false);
    // Section arranging + favorites quick row (shared with the built-in
    // Script Op sidebar via localStorage; this pop-out is the reference UI).
    const inspector = document.querySelector('section.inspector');
    if (window.CueolaScriptOpPrefs && inspector) {
      window.CueolaScriptOpPrefs.init({ root: inspector, before: inspector.querySelector('.inspector-tabs') });
    }

    if (!productionCode || !sessionId || !controllerInstanceId) {
      setDisconnected('This Script Operator link is missing its production, session, or controller identity.');
      return;
    }

    protocol = createProtocolAdapter();
    if (!protocol) {
      setDisconnected('The Script Operator protocol failed to load. Close this panel and reopen it from Cueola Live.');
      return;
    }
    try {
      channel = new BroadcastChannel(protocol.channelName);
      channel.addEventListener('message', onChannelMessage);
    } catch (error) {
      console.warn('[Script Operator] BroadcastChannel unavailable; using opener messaging', error);
      channel = null;
    }

    sendReady('operator-opened');
    // Worker-driven interval: a hidden popup's setInterval throttles to once
    // a minute after ~5 idle minutes, blowing the 6s heartbeat budget — the
    // "times out when idle" report. Worker timers are exempt.
    heartbeatTimer = protocolApi && protocolApi.createSteadyInterval
      ? protocolApi.createSteadyInterval(heartbeatTick, protocol.heartbeatInterval)
      : { cancel: window.clearInterval.bind(window, window.setInterval(heartbeatTick, protocol.heartbeatInterval)) };
    clockTimer = window.setInterval(renderClockPreview, 500);
  }

  function bindEvents() {
    document.getElementById('closeWindowButton').addEventListener('click', () => window.close());
    document.getElementById('reconnectButton').addEventListener('click', () => sendReady('operator-reconnect'));
    window.addEventListener('message', onWindowMessage);
    window.addEventListener('pagehide', cleanup, { once: true });
    window.addEventListener('beforeunload', cleanup, { once: true });
    window.addEventListener('blur', releaseAllHolds);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { releaseAllHolds(); return; }
      wakeResync();
    });
    window.addEventListener('focus', wakeResync);
    window.addEventListener('pageshow', wakeResync);
    // D11.1: window-level keycommands (J/L brake/boost, Space/K, ?, sizes).
    // releaseAllHolds above covers keyboard holds on blur and hide too.
    document.addEventListener('keydown', e => operatorKeymapDispatch(e, 'down'));
    document.addEventListener('keyup', e => operatorKeymapDispatch(e, 'up'));

    controlsRoot.addEventListener('click', onDelegatedClick);
    controlsRoot.addEventListener('input', onDelegatedInput);
    controlsRoot.addEventListener('change', onDelegatedChange);
    controlsRoot.addEventListener('pointerdown', onDelegatedPointerDown);
    controlsRoot.addEventListener('pointerup', onDelegatedPointerEnd);
    controlsRoot.addEventListener('pointercancel', onDelegatedPointerEnd);
    controlsRoot.addEventListener('lostpointercapture', onDelegatedPointerEnd, true);
    controlsRoot.addEventListener('focusout', onControlFocusOut);
    controlsRoot.addEventListener('mousedown', preserveEditorSelection);
    controlsRoot.addEventListener('keydown', onControlsKeydown);
    controlsRoot.addEventListener('keyup', onControlsKeyup);
    editor.addEventListener('blur', onEditorBlur);
  }

  // cueola-script-operator-protocol.js is a hard dependency loaded by
  // script-operator.html before this file; the adapter is a thin wrapper over
  // its operator instance with no hand-rolled fallback envelopes.
  function createProtocolAdapter() {
    if (!protocolApi || typeof protocolApi.createOperator !== 'function') {
      console.error('[Script Operator] Protocol library missing');
      return null;
    }
    let instance = null;
    try {
      instance = protocolApi.createOperator({ ...identity });
    } catch (error) {
      console.error('[Script Operator] Protocol initialization failed', error);
      return null;
    }
    const heartbeatInterval = Number(protocolApi.HEARTBEAT_INTERVAL_MS) || 2000;
    const heartbeatTimeout = Number(protocolApi.HEARTBEAT_TIMEOUT_MS) || heartbeatInterval * 3;

    return {
      channelName: instance.channelName,
      heartbeatInterval,
      heartbeatTimeout,
      accepts(message) {
        if (!message || typeof message !== 'object') return false;
        return instance.accepts(message);
      },
      ready() { return instance.buildReady(); },
      heartbeat() { return instance.buildHeartbeat(); },
      applyState(message) {
        const state = instance.applyState(message);
        return state && typeof state === 'object' ? state : null;
      },
      stateApplied() { return instance.buildStateApplied(); },
      noteHeartbeat(message) { instance.noteHeartbeat(message); },
      checkHeartbeat() { return instance.checkHeartbeat(); },
      noteCommandAck(message) { return instance.noteCommandAck(message); },
      noteControllerClosing(message) { instance.noteControllerClosing(message); },
      command(kind, data) { return instance.buildCommand(kind, data); },
      closing(reason) { return instance.close(reason); }
    };
  }

  function sendReady(reason) {
    if (!protocol || closed) return;
    lastReadySentAt = Date.now();
    lastControllerSeenAt = Date.now();
    stateApplied = false;
    disconnected = false;
    setConnection('connecting', 'Connecting…', reason === 'operator-reconnect' ? 'Requesting fresh state…' : 'Waiting for Cueola Live…');
    setCommandAvailability(false);
    postMessageToController(protocol.ready());
  }

  // Coming back to the panel after idle re-requests state immediately when
  // the link went stale, instead of waiting for the next heartbeat cycle.
  function wakeResync() {
    if (closed || !protocol) return;
    if ((disconnected || !stateApplied) && Date.now() - lastReadySentAt > 3000) sendReady('operator-wake');
  }

  function heartbeatTick() {
    if (closed || !protocol) return;
    const heartbeat = protocol.heartbeat();
    if (heartbeat?.payload) heartbeat.payload.focused = document.hasFocus();
    postMessageToController(heartbeat);
    if (window.opener && window.opener.closed) {
      setDisconnected('The Cueola Live window was closed. Reopen Live, then reconnect this panel.');
      return;
    }
    if (Date.now() - lastControllerSeenAt >= protocol.heartbeatTimeout) {
      protocol.checkHeartbeat();
      setDisconnected('The Cueola Live window missed three heartbeats. Controls are paused.');
      // Keep knocking: a reloaded Live window re-creates its host on the SAME
      // channel (persisted controller id) but knows no operator until a READY
      // arrives — without this both sides waited on each other forever.
      if (Date.now() - lastReadySentAt > 6000) sendReady('operator-rebind');
    }
  }

  function onChannelMessage(event) {
    receiveMessage(event.data);
  }

  function onWindowMessage(event) {
    if (event.origin !== expectedOrigin) return;
    if (window.opener && event.source !== window.opener) return;
    receiveMessage(event.data);
  }

  function receiveMessage(message) {
    if (closed || !protocol?.accepts(message)) return;
    const messageId = message.messageId;
    if (messageId && isDuplicate(messageId)) return;
    const type = normalizeMessageType(message.type);
    if (!type) return;

    lastControllerSeenAt = Date.now();
    if (type === 'STATE') {
      const initialState = !stateApplied;
      const state = protocol.applyState(message);
      if (!state) return;
      currentSnapshot = state.data && typeof state.data === 'object' ? state.data : {};
      // Acknowledge before patching: the forced hold release inside
      // patchSnapshot may need to send stop controls, and the protocol only
      // builds commands once the snapshot is acknowledged.
      const applied = protocol.stateApplied();
      postMessageToController(applied);
      stateApplied = true;
      disconnected = false;
      patchSnapshot(currentSnapshot);
      setConnection('ready', readyStatusLabel(), sessionControlsEnabled ? 'State applied' : 'Live controls paused');
      setCommandAvailability(sessionControlsEnabled);
      if (initialState) setDraftStatus(sessionControlsEnabled ? 'Ready' : 'Live controls paused', sessionControlsEnabled ? 'ok' : 'busy');
      return;
    }

    if (type === 'HEARTBEAT') {
      protocol.noteHeartbeat(message);
      if (stateApplied) {
        disconnected = false;
        setConnection('ready', readyStatusLabel(), 'Connected');
        setCommandAvailability(sessionControlsEnabled);
      } else if (Date.now() - lastReadySentAt > 5000) {
        // The controller is alive but this panel has no acknowledged snapshot
        // (a timeout cleared it): ask for a fresh one instead of waiting on a
        // manual Reconnect click. The rate limit keeps the initial handshake
        // (READY just sent, STATE still in flight) from double-requesting.
        sendReady('operator-resync');
      }
      return;
    }

    if (type === 'COMMAND_ACK') {
      const ackState = protocol.noteCommandAck(message);
      if (ackState === false) return;
      const payload = message.payload || {};
      const pending = clearPendingIntent(payload.commandId);
      const result = ackState && typeof ackState === 'object' ? ackState : (payload.result || payload);
      const ok = result.ok !== false && result.accepted !== false;
      const detail = result.error || result.reason || result.detail || (ok ? 'Command acknowledged' : 'Command failed');
      // Preview intents are never tracked, so read the ack's own commandType
      // to keep slider preview acks from spamming the status line.
      const ackKind = pending ? pending.kind : String(payload.commandType || '');
      if (!ok || ackKind !== 'preview') setDraftStatus(detail, ok ? 'ok' : 'error');
      if (pending && (pending.kind === 'push' || pending.kind === 'clear')) toast(ok ? (pending.kind === 'push' ? 'Pushed to Flowmingo' : detail) : detail);
      return;
    }

    if (type === 'CONTROLLER_CLOSING') {
      protocol.noteControllerClosing(message);
      const reason = message.payload?.reason || 'Cueola Live closed the Script Operator connection.';
      setDisconnected(reason);
      queueMicrotask(() => window.close());
    }
  }

  function postMessageToController(message) {
    if (!message || closed) return false;
    let sent = false;
    if (channel) {
      try { channel.postMessage(message); sent = true; }
      catch (error) { console.warn('[Script Operator] BroadcastChannel send failed', error); }
    }
    if (window.opener && !window.opener.closed) {
      try { window.opener.postMessage(message, expectedOrigin); sent = true; }
      catch (error) { console.warn('[Script Operator] Opener send failed', error); }
    }
    return sent;
  }

  function sendIntent(kind, data = {}) {
    if (!stateApplied || disconnected || closed || !sessionControlsEnabled) {
      setDraftStatus(sessionControlsEnabled ? 'Reconnect before sending controls' : 'Live controls are paused', 'error');
      return false;
    }
    const payload = { kind, ...data };
    if ((kind === 'draft' || kind === 'push') && typeof payload.text !== 'string') payload.text = editor.value;
    const message = protocol.command(kind, payload);
    if (!postMessageToController(message)) {
      setDisconnected('No Cueola Live controller is available for this panel.');
      return false;
    }
    if (kind !== 'preview') {
      trackPendingIntent(message, kind);
      setDraftStatus('Sent · waiting for Cueola', 'busy');
    }
    return true;
  }

  function trackPendingIntent(message, kind) {
    const commandId = String(message?.messageId || '');
    if (!commandId) return;
    clearPendingIntent(commandId);
    const entry = { commandId, kind, message, attempts:1, timer:null };
    pendingIntents.set(commandId, entry);
    schedulePendingIntent(entry);
  }

  function schedulePendingIntent(entry) {
    entry.timer = window.setTimeout(() => {
      if (closed || !pendingIntents.has(entry.commandId)) return;
      if (entry.attempts >= COMMAND_MAX_ATTEMPTS) {
        pendingIntents.delete(entry.commandId);
        setDraftStatus('No command acknowledgement · state unknown', 'error');
        console.error('[Script Operator] Command acknowledgement timed out', { commandId:entry.commandId, kind:entry.kind, attempts:entry.attempts });
        return;
      }
      entry.attempts += 1;
      postMessageToController(entry.message);
      setDraftStatus(`Retrying command · ${entry.attempts}/${COMMAND_MAX_ATTEMPTS}`, 'busy');
      schedulePendingIntent(entry);
    }, COMMAND_RETRY_MS);
  }

  function clearPendingIntent(commandId) {
    const entry = pendingIntents.get(String(commandId || ''));
    if (!entry) return null;
    window.clearTimeout(entry.timer);
    pendingIntents.delete(entry.commandId);
    return entry;
  }

  function onDelegatedClick(event) {
    const tab = event.target.closest('[data-tab]');
    if (tab) { selectTab(tab.dataset.tab, true); return; }

    const button = event.target.closest('button');
    if (!button || button.disabled) return;

    // Hold buttons are owned by pointerdown/up or keyboard down/up handlers.
    if (button.matches('[data-hold-start]')) return;

    if (button.matches('[data-command-kind]')) {
      const kind = button.dataset.commandKind;
      if (kind === 'clear' && !window.confirm('Clear the live Flowmingo script? This immediately pushes an empty script to the talent display.')) return;
      let action = button.dataset.action || '';
      if (!action && button.dataset.dynamicAction) action = resolveDynamicAction(button.dataset.dynamicAction);
      if (button.dataset.dynamicAction && !action) {
        setDraftStatus('No rundown row is available to cue', 'error');
        return;
      }
      const data = action ? { action } : {};
      if (kind === 'clear') data.confirmed = true;
      if (button.hasAttribute('data-include-draft') || kind === 'draft' || kind === 'push') data.text = editor.value;
      if (sendIntent(kind, data) && kind === 'clear') setDraftStatus('Clear requested', 'busy');
      return;
    }

    if (button.hasAttribute('data-question-push')) { pushQuestionLane(); return; }
    if (button.hasAttribute('data-question-insert')) { insertQuestionLane(); return; }

    if (button.matches('[data-nudge]')) {
      // Relative nudge: seek_line moves from wherever the talent IS, so a
      // stale slider value can no longer teleport them (each point = one
      // line of copy). The slider re-syncs from the next state push.
      const step = clamp(Number(button.dataset.nudge) || 0, -200, 200);
      if (step) sendIntent('control', { action: `seek_line_${step}` });
      return;
    }

    if (button.hasAttribute('data-punch')) {
      const value = formatNumber(document.getElementById('seekRange').value);
      sendIntent('control', { action: `seek_set_${value}` });
      sendIntent('control', { action: 'resume' });
      return;
    }

    if (button.hasAttribute('data-clock-duration')) {
      const minutes = clampedInteger(document.getElementById('durationMinutes').value, 1, 999, 5);
      sendIntent('control', { action: `clock_duration_${minutes * 60}` });
      return;
    }

    if (button.hasAttribute('data-clock-count-to')) {
      const target = nextClockTarget(document.getElementById('countToTime').value);
      if (!target) { setDraftStatus('Set a countdown time first', 'error'); return; }
      sendIntent('control', { action: `clock_until_${target}_label_Countdown` });
      return;
    }

    if (button.dataset.wrapMinutes) {
      sendIntent('control', { action: `wrapup_${clampedInteger(button.dataset.wrapMinutes, 1, 999, 5) * 60}` });
      return;
    }

    if (button.hasAttribute('data-wrap-custom')) {
      const minutes = clampedInteger(document.getElementById('wrapMinutes').value, 1, 999, 5);
      sendIntent('control', { action: `wrapup_${minutes * 60}` });
      return;
    }

    if (button.hasAttribute('data-wrap-before')) {
      wrapSelection(button.dataset.wrapBefore || '', button.dataset.wrapAfter || '');
      return;
    }
    if (button.hasAttribute('data-insert')) { insertAtSelection(button.dataset.insert || ''); return; }
    if (button.hasAttribute('data-find')) sendFindInScript();
  }

  // Jump to line: the host executes seek_text and the talent glides the first
  // matching line (searching forward from the read position) to the read line.
  function sendFindInScript() {
    const input = document.getElementById('findInput');
    const q = String(input?.value || '').trim();
    if (!q) { setDraftStatus('Type a few words from the script first', 'error'); return; }
    if (q.length < 3) { setDraftStatus('Use at least three characters to find', 'error'); return; }
    sendIntent('control', { action: 'seek_text', q });
  }

  function onDelegatedInput(event) {
    const target = event.target;
    if (target === editor) {
      editorDirty = true;
      setDraftStatus('Drafting…', 'busy');
      queueDraft();
      return;
    }
    if (target.matches('input[type="range"][data-preview-prefix]')) {
      updateRangeReadout(target);
      queuePreviewIntent(target);
    }
  }

  function onDelegatedChange(event) {
    const target = event.target;
    if (target.matches('input[type="range"][data-preview-prefix]')) {
      target.dataset.dragging = '';
      cancelPreviewIntent(target);
      sendIntent('control', { action: target.dataset.previewPrefix + formatNumber(target.value) });
    }
  }

  // INC-20: previews send at most every 100ms, trailing, so a slider drag
  // does not spam per-input preview commands at the controller.
  function queuePreviewIntent(input) {
    const key = input.id || input.dataset.previewPrefix;
    if (previewThrottles.has(key)) return;
    previewThrottles.set(key, window.setTimeout(() => {
      previewThrottles.delete(key);
      sendIntent('preview', { action: input.dataset.previewPrefix + formatNumber(input.value) });
    }, 100));
  }

  function cancelPreviewIntent(input) {
    const key = input.id || input.dataset.previewPrefix;
    const timer = previewThrottles.get(key);
    if (timer == null) return;
    window.clearTimeout(timer);
    previewThrottles.delete(key);
  }

  function onDelegatedPointerDown(event) {
    const range = event.target.closest('input[type="range"]');
    if (range) {
      range.dataset.dragging = '1';
      try { range.setPointerCapture(event.pointerId); } catch {}
      return;
    }
    const button = event.target.closest('[data-hold-start]');
    if (!button || button.disabled || !stateApplied || disconnected || !sessionControlsEnabled) return;
    event.preventDefault();
    const previous = activeHolds.get(button);
    if (previous) releaseHold(button, previous.pointerId);
    const hold = { pointerId: event.pointerId, stopAction: button.dataset.holdStop };
    activeHolds.set(button, hold);
    button.classList.add('is-active');
    button.setAttribute('aria-pressed', 'true');
    try { button.setPointerCapture(event.pointerId); } catch {}
    sendIntent('control', { action: button.dataset.holdStart });
  }

  function onDelegatedPointerEnd(event) {
    const range = event.target.closest?.('input[type="range"]');
    if (range) {
      range.dataset.dragging = '';
      try { if (range.hasPointerCapture(event.pointerId)) range.releasePointerCapture(event.pointerId); } catch {}
      applyPendingControlValue(range.id);
    }
    const button = event.target.closest?.('[data-hold-start]');
    if (button) releaseHold(button, event.pointerId);
  }

  function onControlFocusOut(event) {
    const id = event.target?.id;
    if (!id || !pendingControlValues.has(id)) return;
    window.setTimeout(() => applyPendingControlValue(id), 0);
  }

  function releaseHold(button, pointerId, force) {
    const hold = activeHolds.get(button);
    if (!hold) return;
    if (!force && pointerId != null && hold.pointerId !== pointerId) return;
    activeHolds.delete(button);
    button.classList.remove('is-active');
    button.setAttribute('aria-pressed', 'false');
    try { if (button.hasPointerCapture(hold.pointerId)) button.releasePointerCapture(hold.pointerId); } catch {}
    if (!hold.stopAction) return;
    if (force) { sendControlDirect(hold.stopAction); return; }
    if (stateApplied && !disconnected) sendIntent('control', { action: hold.stopAction });
  }

  function releaseAllHolds() {
    [...activeHolds.entries()].forEach(([button, hold]) => releaseHold(button, hold.pointerId));
    operatorHolds?.releaseAll();
  }

  // Any transition to paused, disconnected, or closing must release every
  // active hold, keyboard and pointer, even though sendIntent refuses while
  // controls are disabled; stops go out through the direct path instead.
  function forceReleaseAllHolds() {
    [...activeHolds.keys()].forEach((button) => releaseHold(button, null, true));
    operatorHolds?.releaseAll();
  }

  // Fire-and-forget control send that bypasses the disabled guard. Only hold
  // stop releases route through here; the protocol layer still drops it when
  // the controller is truly gone.
  function sendControlDirect(action) {
    if (!action || closed || !protocol) return false;
    return postMessageToController(protocol.command('control', { kind: 'control', action }));
  }

  // Send function for the keyboard hold tracker: normal tracked sends while
  // live, direct stop delivery once controls are paused or disconnected.
  function sendHoldControl(action) {
    if (stateApplied && !disconnected && !closed && sessionControlsEnabled) {
      sendIntent('control', { action });
      return;
    }
    sendControlDirect(action);
  }

  function preserveEditorSelection(event) {
    if (event.target.closest('[data-wrap-before],[data-insert]')) event.preventDefault();
  }

  function onControlsKeydown(event) {
    if (event.target.id === 'findInput') {
      if (event.key === 'Enter') { event.preventDefault(); sendFindInScript(); }
      return;
    }
    if (event.target.id === 'questionLaneInput') {
      // Same grammar as the in-app lane: Enter pushes, Esc clears the card.
      if (event.key === 'Enter') { event.preventDefault(); pushQuestionLane(); }
      else if (event.key === 'Escape') {
        event.preventDefault();
        event.target.value = '';
        sendIntent('control', { action: 'question_off' });
      }
      return;
    }
    const holdButton = event.target.closest?.('[data-hold-start]');
    if (holdButton && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      if (event.repeat || holdButton.disabled || activeHolds.has(holdButton)) return;
      const hold = { pointerId:null, keyboardKey:event.key, stopAction:holdButton.dataset.holdStop };
      activeHolds.set(holdButton, hold);
      holdButton.classList.add('is-active');
      holdButton.setAttribute('aria-pressed', 'true');
      sendIntent('control', { action:holdButton.dataset.holdStart });
      return;
    }
    if (event.target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const tabs = [...controlsRoot.querySelectorAll('[role="tab"]')];
      const index = tabs.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      selectTab(tabs[next].dataset.tab, true);
      tabs[next].focus();
      return;
    }
    if (event.target !== editor || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'b') { event.preventDefault(); wrapSelection('**', '**'); }
    else if (key === 'i') { event.preventDefault(); wrapSelection('*', '*'); }
    else if (key === 'enter') { event.preventDefault(); sendIntent('push', { text: editor.value }); }
  }

  function onControlsKeyup(event) {
    const holdButton = event.target.closest?.('[data-hold-start]');
    const hold = holdButton && activeHolds.get(holdButton);
    if (!hold || hold.keyboardKey !== event.key) return;
    event.preventDefault();
    releaseHold(holdButton, null);
  }

  // D12.6 parity: the pop-out question lane mirrors the in-app lane. One card
  // at a time, last write wins; an empty push clears the card, same as Esc.
  // The text rides the control command envelope (question_on carries payload).
  function pushQuestionLane() {
    const input = document.getElementById('questionLaneInput');
    const text = cleanText(input?.value || '').replace(/\s+/g, ' ').slice(0, 280);
    if (!text) { sendIntent('control', { action: 'question_off' }); return; }
    sendIntent('control', { action: 'question_on', text });
  }
  // "Into script": the host inserts the question into the script copy of the
  // row the talent is on (anchor-preserving push, so their read line holds).
  function insertQuestionLane() {
    const input = document.getElementById('questionLaneInput');
    const text = cleanText(input?.value || '').replace(/\s+/g, ' ').slice(0, 280);
    if (!text) { setDraftStatus('Type or paste the question first', 'error'); return; }
    sendIntent('control', { action: 'question_insert', text });
    if (input) input.value = '';
  }

  // ── D11.1: window-level keycommand dispatch ───────────────────────────────
  // Buttons, tabs, and fields own their native keys (Space clicks a focused
  // button; the hold buttons have their own Space/Enter handling above).
  function isOperatorInteractiveTarget(target) {
    return Boolean(target?.closest?.('textarea, input, select, button, [role="tab"], [contenteditable="true"]'));
  }

  function operatorKeymapDispatch(event, phase) {
    if (!keymapApi || event.metaKey || event.ctrlKey || event.defaultPrevented) return false;
    if (isOperatorInteractiveTarget(event.target)) {
      // Releasing a held key while focus sits in a field must still send the
      // stop control, same blur-safety contract as the Live surface.
      if (phase === 'up' && operatorHolds.size()) operatorHolds.upByEvent(OPERATOR_KEYMAP, event);
      return false;
    }
    for (const action of OPERATOR_KEYMAP) {
      if (!keymapApi.actionMatches(action, event)) continue;
      if (action.hold) {
        event.preventDefault();
        if (phase === 'down') {
          // Never start a hold while controls are disabled; the pointer path
          // has the same guard in onDelegatedPointerDown.
          if (!stateApplied || disconnected || !sessionControlsEnabled) return true;
          operatorHolds.down(action, event);
        } else {
          operatorHolds.up(action);
        }
        return true;
      }
      if (phase !== 'down' || event.repeat) { if (phase === 'down') event.preventDefault(); return true; }
      event.preventDefault();
      action.run();
      return true;
    }
    return false;
  }

  function toggleOperatorKeymapRef() {
    let ov = document.getElementById('keymapRefOv');
    if (ov && !ov.hidden) { ov.hidden = true; return; }
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'keymapRefOv'; ov.className = 'km-ov';
      ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.km-x')) ov.hidden = true; });
      document.body.appendChild(ov);
    }
    ov.innerHTML = keymapApi.referenceHTML({
      title: 'Keyboard shortcuts: Script Operator',
      sections: keymapApi.sectionsForScope(OPERATOR_KEYMAP, 'scriptop'),
      foot: 'Arrows drive the rundown on the main Cueola window; Space/J/K/L drive the prompter from this desk. Typing in any field suppresses shortcuts.',
    });
    ov.hidden = false;
  }

  function queueDraft() {
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => sendIntent('draft', { text: editor.value }), 180);
  }

  function wrapSelection(before, after) {
    const start = editor.selectionStart ?? editor.value.length;
    const end = editor.selectionEnd ?? start;
    const selected = editor.value.slice(start, end) || 'text';
    editor.setRangeText(before + selected + after, start, end, 'select');
    editor.setSelectionRange(start + before.length, start + before.length + selected.length);
    editor.focus();
    editorDirty = true;
    queueDraft();
  }

  function insertAtSelection(text) {
    const start = editor.selectionStart ?? editor.value.length;
    const end = editor.selectionEnd ?? start;
    editor.setRangeText(text, start, end, 'end');
    editor.focus();
    editorDirty = true;
    queueDraft();
  }

  // The [CHAT] pasteIntoEditor path is retired (D12.6): it appended clipboard
  // text into the rolling script and re-pushed the whole thing mid-read.
  // Audience copy rides the Question lane instead.

  function onEditorBlur() {
    if (pendingEditorText !== null && !editorDirty) editor.value = pendingEditorText;
    pendingEditorText = null;
  }

  function patchSnapshot(snapshot) {
    const lifecycle = String(first(snapshot, ['liveLifecycle', 'lifecycle']) || 'live');
    const nextControlsEnabled = first(snapshot, ['controlsEnabled']) !== false && lifecycle === 'live';
    const controlsWereEnabled = sessionControlsEnabled;
    sessionControlsEnabled = nextControlsEnabled;
    if (controlsWereEnabled && !nextControlsEnabled) forceReleaseAllHolds();
    root.dataset.controlsEnabled = sessionControlsEnabled ? 'true' : 'false';
    const text = first(snapshot, ['prompterText', 'text', 'draft.text', 'prompter.text', 'prompter.scriptText', 'prompter.script']);
    if (typeof text === 'string') patchEditor(text);

    const playing = Boolean(first(snapshot, ['playing', 'running', 'transport.running', 'prompter.playing', 'prompter.running', 'prompter.transport.running']) ?? false);
    patchPlayButton(playing);
    // The status chip says what the TALENT is doing, from the host's heartbeat
    // registry; the host handshake only decides whether controls are enabled.
    const line = first(snapshot, ['talent.line']);
    talentLine = typeof line === 'string' ? line.trim() : '';

    const speed = finite(first(snapshot, ['speed', 'targetSpeed', 'transport.targetSpeed', 'prompter.speed', 'prompter.targetSpeed']), 50);
    const size = finite(first(snapshot, ['size', 'fontSize', 'prompter.size', 'prompter.fontSize']), 48);
    const seek = finite(first(snapshot, ['progress', 'progressPct', 'seek', 'seekPercent', 'transport.progress', 'prompter.progress']), 0);
    patchRange('speedRange', speed);
    patchRange('sizeRange', size);
    patchRange('seekRange', clamp(seek, 0, 100));

    const align = String(first(snapshot, ['align', 'alignment', 'prompter.align']) || 'left');
    controlsRoot.querySelectorAll('[data-align]').forEach((button) => button.classList.toggle('is-active', button.dataset.align === align));

    const reversing = Boolean(first(snapshot, ['reversing', 'reverse', 'prompter.reversing']) ?? false);
    patchStateButton('reversing', reversing);
    patchStateButton('forward', !reversing);
    patchStateButton('mirrored', Boolean(first(snapshot, ['mirrored', 'mirror', 'prompter.mirrored']) ?? false));

    const uiTheme = normalizeTheme(first(snapshot, ['uiTheme', 'cueolaTheme', 'theme']));
    const prompterTheme = normalizeTheme(first(snapshot, ['prompterTheme', 'prompter.theme'])) || activeTheme;
    if (uiTheme) applyTheme(uiTheme);
    controlsRoot.querySelectorAll('[data-theme-choice]').forEach((button) => {
      const on = button.dataset.themeChoice === prompterTheme;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    const techOn = Boolean(first(snapshot, ['techSlateOn', 'techSlate', 'slate.tech', 'prompter.techSlateOn']) ?? false);
    const barsOn = Boolean(first(snapshot, ['colorBarsOn', 'barsOn', 'slate.bars', 'prompter.colorBarsOn']) ?? false);
    patchToggle('techButton', techOn, techOn ? 'slate_tech_off' : 'slate_tech_on', techOn ? 'Back on air' : 'Tech Difficulty', 'techButtonLabel');
    patchToggle('barsButton', barsOn, barsOn ? 'slate_bars_off' : 'slate_bars_on', barsOn ? 'Back on air' : 'NTSC Bars', 'barsButtonLabel');

    questionOn = Boolean(first(snapshot, ['questionOn', 'question', 'alerts.question', 'prompter.questionOn']) ?? false);
    patchToggle('questionButton', questionOn, questionOn ? 'question_off' : 'question_on', questionOn ? 'Clear question' : 'Question', 'questionButtonLabel');
    document.getElementById('questionButtonSymbol').dataset.symbol = questionOn ? 'notification.unread' : 'notification.default';

    const incomingClock = first(snapshot, ['clockState', 'clock', 'prompter.clockState', 'prompter.clock']);
    if (incomingClock && typeof incomingClock === 'object') clockState = { ...clockState, ...incomingClock };
    controlsRoot.querySelectorAll('[data-clock-mode]').forEach((button) => button.classList.toggle('is-active', button.dataset.clockMode === clockState.mode));
    const sizeIndex = clamp(Math.round(finite(clockState.size, 1)), 0, 4);
    document.getElementById('overlaySizeValue').textContent = ['S', 'M', 'L', 'XL', 'MAX'][sizeIndex];

    patchField('durationMinutes', first(snapshot, ['clockDurationMinutes', 'controls.durationMinutes', 'flowClockDurationMin']));
    patchField('countToTime', first(snapshot, ['clockCountTime', 'controls.countToTime', 'flowClockCountTime']));
    patchField('wrapMinutes', first(snapshot, ['wrapMinutes', 'controls.wrapMinutes', 'flowWrapCustomMin']));
    patchQuestionCards(first(snapshot, ['questionCards']));
    patchCueAvailability(snapshot);
    renderClockPreview();
    // Favorites chips mirror their source buttons (labels, disabled state).
    if (window.CueolaScriptOpPrefs) window.CueolaScriptOpPrefs.sync();
  }

  // Prepared question cards (seeded test shows) become datalist suggestions
  // under the question lane, same as the in-app lane's ${scope}-question-cards.
  function patchQuestionCards(cards) {
    if (!Array.isArray(cards)) return;
    const list = cards.map((card) => String(card || '')).filter(Boolean).slice(0, 30);
    const fingerprint = JSON.stringify(list);
    if (fingerprint === questionCardsFingerprint) return;
    questionCardsFingerprint = fingerprint;
    const datalist = document.getElementById('questionLaneCards');
    if (!datalist) return;
    datalist.replaceChildren(...list.map((value) => Object.assign(document.createElement('option'), { value })));
  }

  function patchEditor(text) {
    if (editor.value === text) {
      editorDirty = false;
      pendingEditorText = null;
      return;
    }
    if (document.activeElement === editor) {
      pendingEditorText = text;
      return;
    }
    if (!editorDirty) editor.value = text;
  }

  function patchRange(id, value) {
    const input = document.getElementById(id);
    if (!input) return;
    const next = String(clamp(value, Number(input.min), Number(input.max)));
    if (input.dataset.dragging === '1' || document.activeElement === input) {
      pendingControlValues.set(id, next);
      return;
    }
    pendingControlValues.delete(id);
    input.value = next;
    updateRangeReadout(input);
  }

  function patchField(id, value) {
    if (value == null) return;
    const input = document.getElementById(id);
    if (!input) return;
    const next = String(value);
    if (document.activeElement === input) {
      pendingControlValues.set(id, next);
      return;
    }
    pendingControlValues.delete(id);
    input.value = next;
  }

  function applyPendingControlValue(id) {
    const input = document.getElementById(id);
    if (!input || document.activeElement === input || input.dataset.dragging === '1' || !pendingControlValues.has(id)) return;
    input.value = pendingControlValues.get(id);
    pendingControlValues.delete(id);
    if (input.matches('input[type="range"]')) updateRangeReadout(input);
  }

  function patchPlayButton(playing) {
    const button = document.getElementById('playButton');
    button.dataset.action = playing ? 'pause' : 'resume';
    button.classList.toggle('is-active', playing);
    button.setAttribute('aria-pressed', playing ? 'true' : 'false');
    document.getElementById('playButtonSymbol').dataset.symbol = playing ? 'media.pause' : 'media.play';
    document.getElementById('playButtonLabel').textContent = playing ? 'Pause' : 'Play';
  }

  function patchStateButton(name, on) {
    controlsRoot.querySelectorAll(`[data-state-button="${name}"]`).forEach((button) => {
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function patchToggle(buttonId, on, action, label, labelId) {
    const button = document.getElementById(buttonId);
    button.dataset.action = action;
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    document.getElementById(labelId).textContent = label;
  }

  function patchCueAvailability(snapshot) {
    const currentRow = first(snapshot, ['currentRow', 'prompter.currentRow']);
    const nextRow = first(snapshot, ['nextRow', 'prompter.nextRow']);
    const activeIndex = rowIndex(currentRow, first(snapshot, ['activeIdx', 'currentRowIndex', 'prompter.activeIdx']));
    const nextIndex = rowIndex(nextRow, first(snapshot, ['nextRowIndex', 'prompter.nextRowIndex']));
    // seek_row_N carries the crew-facing DISPLAY number (segment rows never
    // count), which the host publishes as row.number; index + 1 is only the
    // fallback for a host that predates it.
    const activeNumber = rowNumber(currentRow, activeIndex);
    const nextNumber = rowNumber(nextRow, nextIndex);
    setDynamicAction(document.getElementById('cueNowButton'), activeNumber == null ? '' : `seek_row_${activeNumber}`);
    setDynamicAction(document.getElementById('cueNextButton'), nextNumber == null ? '' : `seek_row_${nextNumber}`);
  }

  function rowNumber(row, fallbackIndex) {
    const number = row && typeof row === 'object' ? finite(row.number ?? row.rowNum, NaN) : NaN;
    if (Number.isFinite(number) && number >= 1) return Math.floor(number);
    return fallbackIndex == null ? null : fallbackIndex + 1;
  }

  function setDynamicAction(button, action) {
    button.dataset.resolvedAction = action;
    button.dataset.unavailable = action ? '' : '1';
    button.disabled = !stateApplied || disconnected || !sessionControlsEnabled || !action;
  }

  function resolveDynamicAction(name) {
    const button = name === 'cue-now' ? document.getElementById('cueNowButton') : document.getElementById('cueNextButton');
    return button.dataset.resolvedAction || '';
  }

  function renderClockPreview() {
    const mode = clockState.mode || 'off';
    const targetTs = Number(clockState.targetTs) || 0;
    let label = clockState.label || 'Clock';
    let value = 'Off';
    if (mode === 'timeofday') {
      label = clockState.label || 'Time';
      value = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    } else if (mode !== 'off') {
      const left = targetTs - Date.now();
      value = formatClock(left, mode !== 'wrap');
      if (!clockState.label) label = mode === 'wrap' ? 'Wrap up' : mode === 'duration' ? 'Duration' : 'Countdown';
    }
    const labelElement = document.getElementById('clockPreviewLabel');
    const valueElement = document.getElementById('clockPreviewValue');
    if (labelElement.textContent !== label) labelElement.textContent = label;
    if (valueElement.textContent !== value) valueElement.textContent = value;
    document.getElementById('questionPreview').hidden = !questionOn;
  }

  function updateRangeReadout(input) {
    if (input.id === 'speedRange') document.getElementById('speedValue').textContent = formatNumber(input.value);
    if (input.id === 'sizeRange') document.getElementById('sizeValue').textContent = formatNumber(input.value);
    if (input.id === 'seekRange') document.getElementById('seekValue').textContent = `${Math.round(Number(input.value))}%`;
  }

  function selectTab(key, remember) {
    key = LEGACY_TAB_KEYS[key] || key;
    if (!TAB_LABELS[key]) key = 'transport';
    controlsRoot.querySelectorAll('[data-tab]').forEach((button) => {
      const active = button.dataset.tab === key;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });
    controlsRoot.querySelectorAll('[data-pane]').forEach((pane) => {
      const active = pane.dataset.pane === key;
      pane.classList.toggle('is-active', active);
      pane.hidden = !active;
    });
    document.getElementById('inspectorCaption').textContent = TAB_LABELS[key];
    if (remember) {
      try { localStorage.setItem('cueola_script_operator_tab', key); } catch {}
    }
  }

  function restoreTab() {
    let key = 'transport';
    try { key = localStorage.getItem('cueola_script_operator_tab') || key; } catch {}
    selectTab(key, false);
  }

  function readyStatusLabel() {
    if (talentLine) return talentLine;
    return productionCode ? `Ready · ${productionCode}` : 'Ready';
  }

  function setConnection(state, label, detail) {
    if (root.dataset.connectionState !== state) root.dataset.connectionState = state;
    if (connectionStatus.dataset.state !== state) connectionStatus.dataset.state = state;
    if (connectionStatusText.textContent !== label) connectionStatusText.textContent = label;
    const bannerHidden = state !== 'disconnected';
    if (connectionBanner.hidden !== bannerHidden) connectionBanner.hidden = bannerHidden;
    if (detail && connectionDetail.textContent !== detail) connectionDetail.textContent = detail;
  }

  function setDisconnected(detail) {
    if (disconnected && connectionDetail.textContent === detail) return;
    disconnected = true;
    stateApplied = false;
    forceReleaseAllHolds();
    setConnection('disconnected', 'Disconnected', detail);
    setCommandAvailability(false);
    setDraftStatus('Disconnected', 'error');
  }

  function setCommandAvailability(enabled) {
    controlsRoot.querySelectorAll('[data-requires-state]').forEach((element) => {
      const unavailable = element.dataset.unavailable === '1';
      element.disabled = !enabled || unavailable;
    });
    // Arrange mode force-enables starrable controls so they can be starred
    // (disabled buttons swallow clicks); every heartbeat and snapshot lands
    // here and would silently re-disable them, so hand control back.
    if (window.CueolaScriptOpPrefs && window.CueolaScriptOpPrefs.isArranging()) window.CueolaScriptOpPrefs.sync();
  }

  function setDraftStatus(text, state = '') {
    draftStatus.textContent = text;
    draftStatus.className = `draft-status${state ? ` is-${state}` : ''}`;
  }

  function toast(msg, dur = 2500) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    window.clearTimeout(el._t);
    el._t = window.setTimeout(() => { el.style.display = 'none'; }, dur);
  }

  function applyTheme(theme) {
    const normalized = normalizeTheme(theme);
    if (!normalized) return;
    activeTheme = normalized;
    document.documentElement.dataset.theme = normalized;
    try { localStorage.setItem('cueola_theme', normalized); } catch {}
  }

  function initialTheme() {
    const queryTheme = normalizeTheme(params.get('theme'));
    if (queryTheme) return queryTheme;
    try { return normalizeTheme(localStorage.getItem('cueola_theme')) || 'cool'; } catch { return 'cool'; }
  }

  // Panel Text size (Formatting tab): local-only, works while disconnected.
  // Percent zoom on .operator-scroll so buttons and labels scale together.
  function applyPanelZoom(percent) {
    const clamped = Math.min(150, Math.max(85, Math.round((Number(percent) || 100) / 5) * 5));
    document.documentElement.style.setProperty('--op-zoom', String(clamped / 100));
    const range = document.getElementById('panelZoomRange');
    const value = document.getElementById('panelZoomValue');
    if (range) range.value = String(clamped);
    if (value) value.textContent = `${clamped}%`;
    try { localStorage.setItem('cueola_op_panel_zoom', String(clamped)); } catch {}
    return clamped;
  }

  function restorePanelZoom() {
    let saved = 100;
    try { saved = parseInt(localStorage.getItem('cueola_op_panel_zoom'), 10) || 100; } catch {}
    applyPanelZoom(saved);
    const range = document.getElementById('panelZoomRange');
    if (range) range.addEventListener('input', () => applyPanelZoom(range.value));
    const down = document.getElementById('panelZoomDown');
    const up = document.getElementById('panelZoomUp');
    if (down) down.addEventListener('click', () => applyPanelZoom((parseInt(range?.value, 10) || 100) - 5));
    if (up) up.addEventListener('click', () => applyPanelZoom((parseInt(range?.value, 10) || 100) + 5));
  }

  function cleanup() {
    if (closed) return;
    forceReleaseAllHolds();
    closed = true;
    if (heartbeatTimer && typeof heartbeatTimer.cancel === 'function') heartbeatTimer.cancel();
    window.clearInterval(clockTimer);
    window.clearTimeout(draftTimer);
    previewThrottles.forEach((timer) => window.clearTimeout(timer));
    previewThrottles.clear();
    const toastElement = document.getElementById('toast');
    if (toastElement) window.clearTimeout(toastElement._t);
    pendingIntents.forEach(entry => window.clearTimeout(entry.timer));
    pendingIntents.clear();
    if (protocol) {
      const closing = protocol.closing('operator-window-closing');
      if (channel) { try { channel.postMessage(closing); } catch {} }
      if (window.opener && !window.opener.closed) {
        try { window.opener.postMessage(closing, expectedOrigin); } catch {}
      }
    }
    if (channel) {
      try { channel.removeEventListener('message', onChannelMessage); } catch {}
      try { channel.close(); } catch {}
    }
    window.removeEventListener('message', onWindowMessage);
  }

  function isDuplicate(id) {
    const key = String(id);
    if (seenMessageIds.has(key)) return true;
    seenMessageIds.set(key, Date.now());
    if (seenMessageIds.size > 200) {
      const oldest = [...seenMessageIds.entries()].sort((a, b) => a[1] - b[1]).slice(0, 80);
      oldest.forEach(([oldId]) => seenMessageIds.delete(oldId));
    }
    return false;
  }

  function normalizeMessageType(value) {
    return String(value || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
  }

  function first(object, paths) {
    for (const path of paths) {
      let value = object;
      for (const key of path.split('.')) {
        if (value == null || typeof value !== 'object' || !(key in value)) { value = undefined; break; }
        value = value[key];
      }
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  }

  function rowIndex(row, fallback) {
    const index = row && typeof row === 'object' ? finite(row.index ?? row.rowIndex, NaN) : NaN;
    if (Number.isFinite(index) && index >= 0) return Math.floor(index);
    const direct = finite(fallback, NaN);
    return Number.isFinite(direct) && direct >= 0 ? Math.floor(direct) : null;
  }

  function nextClockTarget(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return 0;
    const date = new Date();
    date.setHours(clamp(Number(match[1]), 0, 23), clamp(Number(match[2]), 0, 59), 0, 0);
    if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
    return date.getTime();
  }

  function formatClock(milliseconds, showHours) {
    const seconds = Math.max(0, Math.ceil((Number(milliseconds) || 0) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remaining = seconds % 60;
    const pad = (number) => String(number).padStart(2, '0');
    return showHours || hours ? `${pad(hours)}:${pad(minutes)}:${pad(remaining)}` : `${pad(minutes)}:${pad(remaining)}`;
  }

  function clampedInteger(value, min, max, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Math.round(clamp(Number.isFinite(parsed) ? parsed : fallback, min, max));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function formatNumber(value) {
    const number = Number(value);
    return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function cleanText(value) {
    return String(value || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  }

  function normalizeTheme(value) {
    const theme = String(value || '').toLowerCase();
    return THEMES.includes(theme) ? theme : '';
  }

  function makeId(prefix) {
    let suffix = '';
    try { suffix = crypto.randomUUID(); }
    catch { suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
    return `${prefix}-${suffix}`;
  }
})();
