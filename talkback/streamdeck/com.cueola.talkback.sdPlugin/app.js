/* Cueola Talkback: Stream Deck plugin.
 * keyDown → "<bus> on", keyUp → "<bus> off" over the talkbackd WebSocket.
 * State pushes from the daemon light the button (state 1 = live).
 */

const DAEMON_URL = 'ws://127.0.0.1:17844';
const RECONNECT_MS = 2000;

const BUS_BY_ACTION = {
  'com.cueola.talkback.talk-a': 'A',
  'com.cueola.talkback.talk-b': 'B'
};

let sdSocket = null;                 // socket to the Stream Deck app
let daemonSocket = null;             // socket to talkbackd
let daemonUp = false;
const contexts = { A: new Set(), B: new Set() };
const lastState = { A: false, B: false };

/* ---- Stream Deck side ---- */

function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo) {
  sdSocket = new WebSocket('ws://127.0.0.1:' + inPort);
  sdSocket.onopen = function () {
    sdSocket.send(JSON.stringify({ event: inRegisterEvent, uuid: inPluginUUID }));
    connectDaemon();
  };
  sdSocket.onmessage = function (evt) {
    let msg;
    try { msg = JSON.parse(evt.data); } catch (e) { return; }
    const bus = BUS_BY_ACTION[msg.action];
    switch (msg.event) {
      case 'willAppear':
        if (bus) {
          contexts[bus].add(msg.context);
          paint(msg.context, bus);
        }
        break;
      case 'willDisappear':
        if (bus) contexts[bus].delete(msg.context);
        break;
      case 'keyDown':
        if (bus) sendToDaemon(bus + ' on', msg.context);
        break;
      case 'keyUp':
        if (bus) sendToDaemon(bus + ' off', msg.context);
        break;
    }
  };
}

function setState(context, on) {
  if (!sdSocket || sdSocket.readyState !== WebSocket.OPEN) return;
  sdSocket.send(JSON.stringify({
    event: 'setState',
    context: context,
    payload: { state: on ? 1 : 0 }
  }));
}

function showAlert(context) {
  if (!sdSocket || sdSocket.readyState !== WebSocket.OPEN) return;
  sdSocket.send(JSON.stringify({ event: 'showAlert', context: context }));
}

function paint(context, bus) {
  setState(context, daemonUp && lastState[bus]);
}

function paintAll() {
  ['A', 'B'].forEach(function (bus) {
    contexts[bus].forEach(function (ctx) { paint(ctx, bus); });
  });
}

/* ---- Daemon side ---- */

function connectDaemon() {
  daemonSocket = new WebSocket(DAEMON_URL);
  daemonSocket.onopen = function () {
    daemonUp = true;
    daemonSocket.send('state?');
  };
  daemonSocket.onmessage = function (evt) {
    let msg;
    try { msg = JSON.parse(evt.data); } catch (e) { return; }
    if (msg.type === 'state') {
      lastState.A = !!msg.talkA;
      lastState.B = !!msg.talkB;
      paintAll();
    }
  };
  daemonSocket.onclose = function () {
    daemonUp = false;
    lastState.A = false;
    lastState.B = false;
    paintAll();
    setTimeout(connectDaemon, RECONNECT_MS);
  };
  daemonSocket.onerror = function () {
    try { daemonSocket.close(); } catch (e) { /* already closing */ }
  };
}

function sendToDaemon(command, context) {
  if (daemonSocket && daemonSocket.readyState === WebSocket.OPEN) {
    daemonSocket.send(command);
  } else if (context) {
    showAlert(context); // daemon not running: warn instead of silently doing nothing
  }
}
