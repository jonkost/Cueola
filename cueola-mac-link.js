/* Cueola direct link to Outrangutan for Mac.
 *
 * When the Mac app runs on the SAME Mac as this browser window, playback
 * commands (GO, a cue, a pad, Stop, PANIC, volume) go straight to it over a
 * private connection on this Mac (ws://127.0.0.1:47810), in about a
 * hundredth of a second, and keep working with the internet down.
 *
 * The cloud write still happens every time, as the backup: the Mac app runs
 * each command once by its origId, so a command that arrives both ways plays
 * once. Replies come back the same way as a cmdAck.
 *
 * Off until someone switches it on in KeyWi Bird's Deck settings, per
 * browser, so a machine without the Mac app never goes looking (Chrome asks
 * once to let the page talk to apps on this device).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaMacLink = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var PORT = 47810;
  var KEY = 'cueola_mac_direct';
  var ws = null;
  var status = 'off';        // off | looking | connected | other-show
  var macCode = '';          // the show the Mac app is on, from its hello
  var retryMs = 2000;
  var retryTimer = null;
  var getCode = function () { return ''; };
  var ackHandler = null;
  var listeners = [];
  var sentCode = null;       // the code the Mac last heard from us
  var codeWatch = null;

  function store() { try { return root && root.localStorage; } catch (e) { return null; } }
  function enabled() { var s = store(); try { return !!s && s.getItem(KEY) === '1'; } catch (e) { return false; } }

  function setStatus(next) {
    if (next === status) return;
    status = next;
    listeners.forEach(function (fn) { try { fn(status); } catch (e) {} });
  }

  // The Mac app answers hello with the show it is on. Only a match counts
  // as connected: a Mac on another show must never take this show's fires.
  function judge() {
    var code = String(getCode() || '').toUpperCase();
    setStatus(!ws || ws.readyState !== 1 ? (enabled() ? 'looking' : 'off')
      : (macCode && code && macCode === code ? 'connected' : 'other-show'));
  }

  function hello() {
    if (ws && ws.readyState === 1) {
      sentCode = String(getCode() || '').toUpperCase();
      try { ws.send(JSON.stringify({ type: 'hello', code: sentCode })); } catch (e) {}
    }
  }

  function connect() {
    clearTimeout(retryTimer); retryTimer = null;
    if (!enabled() || ws || typeof root.WebSocket !== 'function') { judge(); return; }
    setStatus('looking');
    var sock;
    try { sock = new root.WebSocket('ws://127.0.0.1:' + PORT); } catch (e) { schedule(); return; }
    ws = sock;
    sock.onopen = function () {
      retryMs = 2000;
      hello();
      // This window can join another show at any time: say so, and re-check.
      clearInterval(codeWatch);
      codeWatch = setInterval(function () {
        if (String(getCode() || '').toUpperCase() !== sentCode) hello();
        judge();
      }, 1000);
    };
    sock.onmessage = function (e) {
      var msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'hello') { macCode = String(msg.code || '').toUpperCase(); judge(); }
      else if (msg.type === 'ack' && ackHandler) { try { ackHandler(msg); } catch (err) {} }
    };
    sock.onclose = function () {
      if (ws === sock) { ws = null; macCode = ''; clearInterval(codeWatch); codeWatch = null; }
      judge();
      schedule();
    };
    sock.onerror = function () {};
  }

  // Not there yet (the Mac app is closed): look again, backing off to 10 s.
  function schedule() {
    if (!enabled() || retryTimer) return;
    retryTimer = setTimeout(function () { retryTimer = null; connect(); }, retryMs);
    retryMs = Math.min(10000, retryMs * 1.5);
  }

  function close() {
    clearTimeout(retryTimer); retryTimer = null;
    clearInterval(codeWatch); codeWatch = null;
    if (ws) { var s = ws; ws = null; macCode = ''; try { s.close(); } catch (e) {} }
    judge();
  }

  function sendRaw(msg, code) {
    if (status !== 'connected' || !ws || ws.readyState !== 1) return false;
    if (String(code || '').toUpperCase() !== macCode) return false;
    try { ws.send(JSON.stringify(msg)); return true; } catch (e) { return false; }
  }

  return {
    PORT: PORT,
    // getCode: () => this window's show code. onAck: called with each reply.
    configure: function (opts) {
      if (opts && typeof opts.getCode === 'function') getCode = opts.getCode;
      if (opts && typeof opts.onAck === 'function') ackHandler = opts.onAck;
      connect();
    },
    enabled: enabled,
    setEnabled: function (on) {
      var s = store();
      try { if (s) { if (on) s.setItem(KEY, '1'); else s.removeItem(KEY); } } catch (e) {}
      retryMs = 2000;
      if (on) connect(); else close();
    },
    // Call when this window joins another show.
    codeChanged: function () { hello(); judge(); },
    status: function () { return status; },
    macShow: function () { return macCode; },
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    // A playback command in the cloud's own shape. true when it went direct.
    send: function (command, code) { return sendRaw({ type: 'command', code: String(code || '').toUpperCase(), command: command }, code); },
    sendGain: function (v, id, code) { return sendRaw({ type: 'gain', code: String(code || '').toUpperCase(), v: v, id: id }, code); },
  };
});
