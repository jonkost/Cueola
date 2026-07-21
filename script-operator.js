(() => {
  'use strict';

  const THEMES = ['cool', 'warm', 'white', 'green', 'koala', 'panda', 'flamingo', 'outrangutan', 'prepbear'];
  const TAB_LABELS = {
    prompter: 'Prompter',
    live: 'Cue & On Air',
    clocks: 'Clocks & Alerts',
    formatting: 'Formatting & Markers'
  };
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
  let stateApplied = false;
  let sessionControlsEnabled = false;
  let disconnected = false;
  let editorDirty = false;
  let pendingEditorText = null;
  let currentSnapshot = {};
  let clockState = { mode: 'off', label: '', targetTs: 0, size: 1 };
  let questionOn = false;
  let activeTheme = initialTheme();
  let closed = false;
  const seenMessageIds = new Map();
  const activeHolds = new Map();
  const pendingControlValues = new Map();
  const pendingIntents = new Map();

  document.documentElement.dataset.theme = activeTheme;
  init();

  function init() {
    restoreTab();
    bindEvents();
    setCommandAvailability(false);

    if (!productionCode || !sessionId || !controllerInstanceId) {
      setDisconnected('This Script Operator link is missing its production, session, or controller identity.');
      return;
    }

    protocol = createProtocolAdapter();
    try {
      channel = new BroadcastChannel(protocol.channelName);
      channel.addEventListener('message', onChannelMessage);
    } catch (error) {
      console.warn('[Script Operator] BroadcastChannel unavailable; using opener messaging', error);
      channel = null;
    }

    sendReady('operator-opened');
    heartbeatTimer = window.setInterval(heartbeatTick, protocol.heartbeatInterval);
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
      if (document.visibilityState === 'hidden') releaseAllHolds();
    });
    // D11.1: window-level keycommands (J/L brake/boost, Space/K, ?, sizes)
    // with the same blur hold-safety as the pointer holds above.
    document.addEventListener('keydown', e => operatorKeymapDispatch(e, 'down'));
    document.addEventListener('keyup', e => operatorKeymapDispatch(e, 'up'));
    window.addEventListener('blur', () => operatorHolds?.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') operatorHolds?.releaseAll();
    });

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

  function createProtocolAdapter() {
    const factoryOptions = { ...identity };
    let instance = null;
    try {
      if (protocolApi && typeof protocolApi.createOperator === 'function') {
        instance = protocolApi.createOperator(factoryOptions);
      }
    } catch (error) {
      console.error('[Script Operator] Protocol initialization failed', error);
    }

    let name = '';
    if (instance && typeof instance.channelName === 'string') name = instance.channelName;
    if (!name && protocolApi && typeof protocolApi.channelName === 'function') {
      try { name = protocolApi.channelName(factoryOptions); } catch {}
      if (!name) {
        try { name = protocolApi.channelName(productionCode, controllerInstanceId); } catch {}
      }
    }
    if (!name) name = `cueola-script-operator:${productionCode}:${sessionId}:${controllerInstanceId}`;

    const heartbeatInterval = Number(protocolApi?.HEARTBEAT_INTERVAL_MS) || 2000;
    const misses = Number(protocolApi?.HEARTBEAT_MISSES_ALLOWED) || 3;
    const heartbeatTimeout = Number(protocolApi?.HEARTBEAT_TIMEOUT_MS) || heartbeatInterval * misses;

    return {
      instance,
      channelName: name,
      heartbeatInterval,
      heartbeatTimeout,
      accepts(message) {
        if (!message || typeof message !== 'object') return false;
        if (instance && typeof instance.accepts === 'function') {
          try { return instance.accepts(message); } catch { return false; }
        }
        if (protocolApi && typeof protocolApi.accepts === 'function') {
          try { return protocolApi.accepts(message, factoryOptions); } catch {}
        }
        return manualIdentityAccepts(message);
      },
      ready() {
        if (instance && typeof instance.buildReady === 'function') return instance.buildReady();
        return envelope('READY', { reason: 'operator-ready' });
      },
      heartbeat() {
        if (instance && typeof instance.buildHeartbeat === 'function') return instance.buildHeartbeat();
        return envelope('HEARTBEAT', {});
      },
      applyState(message) {
        let result = null;
        if (instance && typeof instance.applyState === 'function') result = instance.applyState(message);
        if (result === false || result?.accepted === false) return null;
        let state = null;
        if (instance && typeof instance.getState === 'function') {
          try { state = instance.getState(); } catch {}
        }
        return state || result || message;
      },
      stateApplied() {
        if (instance && typeof instance.buildStateApplied === 'function') return instance.buildStateApplied();
        return envelope('STATE_APPLIED', {});
      },
      noteHeartbeat(message) {
        if (instance && typeof instance.noteHeartbeat === 'function') {
          try { instance.noteHeartbeat(message); } catch {}
        }
      },
      checkHeartbeat() {
        if (instance && typeof instance.checkHeartbeat === 'function') {
          try { return instance.checkHeartbeat(); } catch {}
        }
        return false;
      },
      noteCommandAck(message) {
        if (instance && typeof instance.noteCommandAck === 'function') {
          try { return instance.noteCommandAck(message); } catch {}
        }
        return null;
      },
      noteControllerClosing(message) {
        if (instance && typeof instance.noteControllerClosing === 'function') {
          try { instance.noteControllerClosing(message); } catch {}
        }
      },
      command(kind, data) {
        if (instance && typeof instance.buildCommand === 'function') return instance.buildCommand(kind, data);
        return envelope('COMMAND', { commandType: kind, data });
      },
      closing(reason) {
        if (instance && typeof instance.close === 'function') return instance.close(reason);
        return envelope('CLOSING', { reason });
      }
    };

    function envelope(type, payload) {
      if (instance && typeof instance.envelope === 'function') {
        try { return instance.envelope(type, payload); } catch {}
      }
      if (protocolApi && typeof protocolApi.envelope === 'function') {
        try { return protocolApi.envelope(type, payload, factoryOptions); } catch {}
      }
      return {
        protocolVersion: Number(protocolApi?.PROTOCOL_VERSION) || 1,
        type,
        messageId: makeId(type.toLowerCase()),
        timestamp: Date.now(),
        ...identity,
        payload
      };
    }
  }

  function manualIdentityAccepts(message) {
    const value = (key) => message[key] ?? message.identity?.[key] ?? message.payload?.[key];
    const code = value('productionCode');
    const session = value('sessionId');
    const controller = value('controllerInstanceId');
    if (code && String(code).toUpperCase() !== productionCode) return false;
    if (sessionId && session && String(session) !== sessionId) return false;
    if (controller && String(controller) !== controllerInstanceId) return false;
    return true;
  }

  function sendReady(reason) {
    if (!protocol || closed) return;
    lastControllerSeenAt = Date.now();
    stateApplied = false;
    disconnected = false;
    setConnection('connecting', 'Connecting…', reason === 'operator-reconnect' ? 'Requesting fresh state…' : 'Waiting for Cueola Live…');
    setCommandAvailability(false);
    postMessageToController(protocol.ready());
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
    const messageId = message.messageId || message.mid || message.id;
    if (messageId && isDuplicate(messageId)) return;
    const type = normalizeMessageType(message.type || message.messageType || message.kind);
    if (!type) return;

    lastControllerSeenAt = Date.now();
    if (type === 'STATE' || type === 'SYNC_STATE') {
      const initialState = !stateApplied;
      const state = protocol.applyState(message);
      if (!state) return;
      const snapshot = state.data || state.payload?.data || state.payload?.state || message.data || message.state || message.snapshot || message.payload?.data || message.payload?.state || message.payload || {};
      currentSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
      patchSnapshot(currentSnapshot);
      const applied = protocol.stateApplied();
      postMessageToController(applied);
      stateApplied = true;
      disconnected = false;
      const readyLabel = productionCode ? `Ready · ${productionCode}` : 'Ready';
      setConnection('ready', readyLabel, sessionControlsEnabled ? 'State applied' : 'Live controls paused');
      setCommandAvailability(sessionControlsEnabled);
      if (initialState) setDraftStatus(sessionControlsEnabled ? 'Ready' : 'Live controls paused', sessionControlsEnabled ? 'ok' : 'busy');
      return;
    }

    if (type === 'HEARTBEAT') {
      protocol.noteHeartbeat(message);
      if (stateApplied) {
        disconnected = false;
        setConnection('ready', productionCode ? `Ready · ${productionCode}` : 'Ready', 'Connected');
        setCommandAvailability(sessionControlsEnabled);
      }
      return;
    }

    if (type === 'COMMAND_ACK' || type === 'ACK') {
      const ackState = protocol.noteCommandAck(message);
      if (ackState === false) return;
      const payload = message.payload || message.data || {};
      const pending = clearPendingIntent(payload.commandId);
      const result = ackState && typeof ackState === 'object' ? ackState : (payload.result || payload);
      const ok = result.ok !== false && result.accepted !== false;
      const detail = result.error || result.reason || result.detail || (ok ? 'Command acknowledged' : 'Command failed');
      if (!ok || pending?.kind !== 'preview') setDraftStatus(detail, ok ? 'ok' : 'error');
      if (pending && (pending.kind === 'push' || pending.kind === 'clear')) toast(ok ? (pending.kind === 'push' ? 'Pushed to Flowmingo' : detail) : detail);
      return;
    }

    if (type === 'CONTROLLER_CLOSING' || type === 'CLOSED' || type === 'DISCONNECTED') {
      protocol.noteControllerClosing(message);
      const reason = message.payload?.reason || message.reason || 'Cueola Live closed the Script Operator connection.';
      setDisconnected(reason);
      if (type === 'CONTROLLER_CLOSING') queueMicrotask(() => window.close());
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

    if (button.matches('[data-nudge]')) {
      const seek = document.getElementById('seekRange');
      const next = clamp(Number(seek.value) + Number(button.dataset.nudge), 0, 100);
      seek.value = String(next);
      document.getElementById('seekValue').textContent = `${Math.round(next)}%`;
      sendIntent('control', { action: `seek_set_${formatNumber(next)}` });
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
    if (button.hasAttribute('data-paste')) { pasteIntoEditor(false); return; }
    if (button.hasAttribute('data-paste-push')) pasteIntoEditor(true);
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
      sendIntent('preview', { action: target.dataset.previewPrefix + formatNumber(target.value) });
    }
  }

  function onDelegatedChange(event) {
    const target = event.target;
    if (target.matches('input[type="range"][data-preview-prefix]')) {
      target.dataset.dragging = '';
      sendIntent('control', { action: target.dataset.previewPrefix + formatNumber(target.value) });
    }
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

  function releaseHold(button, pointerId) {
    const hold = activeHolds.get(button);
    if (!hold || (pointerId != null && hold.pointerId !== pointerId)) return;
    activeHolds.delete(button);
    button.classList.remove('is-active');
    button.setAttribute('aria-pressed', 'false');
    try { if (button.hasPointerCapture(hold.pointerId)) button.releasePointerCapture(hold.pointerId); } catch {}
    if (hold.stopAction && stateApplied && !disconnected) sendIntent('control', { action: hold.stopAction });
  }

  function releaseAllHolds() {
    [...activeHolds.entries()].forEach(([button, hold]) => releaseHold(button, hold.pointerId));
  }

  function preserveEditorSelection(event) {
    if (event.target.closest('[data-wrap-before],[data-insert],[data-paste],[data-paste-push]')) event.preventDefault();
  }

  function onControlsKeydown(event) {
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

  // ── D11.1: window-level keycommands via the shared engine ─────────────────
  // The desk finally gets registered keys — including the owner's direct ask,
  // J/L hold-to-Brake/Boost — dispatched through cueola-keymap.js so bindings,
  // overrides, and the "?" reference match the Live surface exactly.
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
    ? keymapApi.createHoldTracker(action => sendIntent('control', { action }))
    : null;

  // Buttons, tabs, and fields own their native keys (Space clicks a focused
  // button; the hold buttons have their own Space/Enter handling above).
  function isOperatorInteractiveTarget(target) {
    return Boolean(target?.closest?.('textarea, input, select, button, [role="tab"], [contenteditable="true"]'));
  }

  function operatorKeymapDispatch(event, phase) {
    if (!keymapApi || event.metaKey || event.ctrlKey || event.defaultPrevented) return false;
    if (isOperatorInteractiveTarget(event.target)) {
      // Releasing a held key while focus sits in a field must still send the
      // stop control — same blur-safety contract as the Live surface.
      if (phase === 'up' && operatorHolds.size()) operatorHolds.upByEvent(OPERATOR_KEYMAP, event);
      return false;
    }
    for (const action of OPERATOR_KEYMAP) {
      if (!keymapApi.actionMatches(action, event)) continue;
      if (action.hold) {
        event.preventDefault();
        if (phase === 'down') operatorHolds.down(action, event);
        else operatorHolds.up(action);
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
      title: 'Keyboard shortcuts — Script Operator',
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

  async function pasteIntoEditor(pushNow) {
    let text = '';
    try { text = await navigator.clipboard.readText(); }
    catch { setDraftStatus('Allow clipboard access to paste', 'error'); return; }
    text = cleanText(text);
    if (!text) { setDraftStatus('Clipboard empty', 'error'); return; }
    const prefix = editor.value.trim() ? '\n\n' : '';
    insertAtSelection(`${prefix}[CHAT]\n${text}`);
    if (pushNow) {
      window.clearTimeout(draftTimer);
      sendIntent('push', { text: editor.value });
    }
  }

  function onEditorBlur() {
    if (pendingEditorText !== null && !editorDirty) editor.value = pendingEditorText;
    pendingEditorText = null;
  }

  function patchSnapshot(snapshot) {
    const lifecycle = String(first(snapshot, ['liveLifecycle', 'lifecycle']) || 'live');
    const nextControlsEnabled = first(snapshot, ['controlsEnabled']) !== false && lifecycle === 'live';
    if (sessionControlsEnabled && !nextControlsEnabled) releaseAllHolds();
    sessionControlsEnabled = nextControlsEnabled;
    root.dataset.controlsEnabled = sessionControlsEnabled ? 'true' : 'false';
    const text = first(snapshot, ['prompterText', 'text', 'draft.text', 'prompter.text', 'prompter.scriptText', 'prompter.script']);
    if (typeof text === 'string') patchEditor(text);

    const playing = Boolean(first(snapshot, ['playing', 'running', 'transport.running', 'prompter.playing', 'prompter.running', 'prompter.transport.running']) ?? false);
    patchPlayButton(playing);

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
    patchCueAvailability(snapshot);
    renderClockPreview();
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
    const activeIndex = rowIndex(first(snapshot, ['currentRow', 'prompter.currentRow']), first(snapshot, ['activeIdx', 'currentRowIndex', 'prompter.activeIdx']));
    const nextIndex = rowIndex(first(snapshot, ['nextRow', 'prompter.nextRow']), first(snapshot, ['nextRowIndex', 'prompter.nextRowIndex']));
    setDynamicAction(document.getElementById('cueNowButton'), activeIndex == null ? '' : `seek_row_${activeIndex + 1}`);
    setDynamicAction(document.getElementById('cueNextButton'), nextIndex == null ? '' : `seek_row_${nextIndex + 1}`);
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
    if (!TAB_LABELS[key]) key = 'prompter';
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
    let key = 'prompter';
    try { key = localStorage.getItem('cueola_script_operator_tab') || key; } catch {}
    selectTab(key, false);
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
    releaseAllHolds();
    setConnection('disconnected', 'Disconnected', detail);
    setCommandAvailability(false);
    setDraftStatus('Disconnected', 'error');
  }

  function setCommandAvailability(enabled) {
    controlsRoot.querySelectorAll('[data-requires-state]').forEach((element) => {
      const unavailable = element.dataset.unavailable === '1';
      element.disabled = !enabled || unavailable;
    });
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

  function cleanup() {
    if (closed) return;
    releaseAllHolds();
    closed = true;
    window.clearInterval(heartbeatTimer);
    window.clearInterval(clockTimer);
    window.clearTimeout(draftTimer);
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
