// Minimal OSC 1.0 message encoder + UDP sender.
// Hand-rolled so the agent has zero native dependencies — we only ever send
// simple messages to QLab (an address plus optional string/int/float args).
import dgram from 'node:dgram';

function oscString(str) {
  const buf = Buffer.from(String(str), 'utf8');
  // OSC strings are null-terminated and padded to a 4-byte boundary.
  const padded = Buffer.alloc(buf.length + (4 - (buf.length % 4)));
  buf.copy(padded);
  return padded;
}

// args: array of { type: 's' | 'i' | 'f', value }
export function oscMessage(address, args = []) {
  const parts = [oscString(address)];
  let typetags = ',';
  const argBufs = [];
  for (const a of args) {
    if (a.type === 's') {
      typetags += 's';
      argBufs.push(oscString(a.value));
    } else if (a.type === 'i') {
      typetags += 'i';
      const b = Buffer.alloc(4);
      b.writeInt32BE(a.value | 0);
      argBufs.push(b);
    } else if (a.type === 'f') {
      typetags += 'f';
      const b = Buffer.alloc(4);
      b.writeFloatBE(Number(a.value));
      argBufs.push(b);
    }
  }
  parts.push(oscString(typetags));
  return Buffer.concat([...parts, ...argBufs]);
}

export class OscSender {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', (err) => console.error('[osc] socket error:', err.message));
  }

  send(address, args = []) {
    const msg = oscMessage(address, args);
    return new Promise((resolve, reject) => {
      this.socket.send(msg, this.port, this.host, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  close() {
    try { this.socket.close(); } catch {}
  }
}
