#!/usr/bin/env python3
"""
Cueola -> QLab Bridge + Console

Pure Python standard library only — no Node, no pip, no Homebrew.

Double-click "Start QLab Bridge.command" and it:
  1. starts a tiny local web server,
  2. opens a cute "Cue → Q" control panel in your browser, and
  3. (optionally) watches a Cueola session in Firestore.

From the panel you punch in a cue number and hit GO; the bridge sends the OSC
to QLab. Cues fired from the Cueola web app come through the same bridge.

QLab connection defaults live in config.json next to this file.
"""

import json
import os
import socket
import subprocess
import threading
import time
import urllib.parse
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")

PROJECT_ID = "cueola"
API_KEY = "AIzaSyCr5ZuIB1kjPRxdDd2X2-FnFef-r1ZUFIA"
FIRESTORE_BASE = (
    f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}"
    f"/databases/(default)/documents"
)


# ── Config ──────────────────────────────────────────────────────────────────
def load_config():
    cfg = {
        "sessionCode": "",
        "qlabHost": "127.0.0.1",
        "qlabPort": 53000,
        "qlabPasscode": "",
        "pollSeconds": 0.35,
        "heartbeatSeconds": 5,
        "uiPort": 8765,
    }
    try:
        with open(CONFIG_PATH) as f:
            cfg.update(json.load(f))
    except Exception:
        pass
    return cfg


def save_config(cfg):
    try:
        with open(CONFIG_PATH, "w") as f:
            json.dump(cfg, f, indent=2)
            f.write("\n")
    except Exception as e:
        print(f"  (couldn't save config: {e})")


CFG = load_config()
HOST = CFG["qlabHost"]
PORT = int(CFG["qlabPort"])
PASSCODE = str(CFG.get("qlabPasscode", "")).strip()


# ── Shared state ──────────────────────────────────────────────────────────────
class State:
    def __init__(self):
        self.lock = threading.Lock()
        sc = CFG.get("sessionCode", "")
        self.session = "" if sc in ("", "PASTE_YOUR_CUEOLA_CODE_HERE") else sc
        self.log = deque(maxlen=40)       # recent fires (newest last)
        self.qlab_ok = False
        self.qlab_checked = 0

    def add_log(self, cue, action, addr, source):
        with self.lock:
            self.log.append({
                "t": time.strftime("%H:%M:%S"),
                "cue": cue, "action": action, "addr": addr, "source": source,
            })

    def snapshot(self):
        with self.lock:
            return {
                "session": self.session,
                "qlab": self.qlab_ok,
                "host": HOST, "port": PORT,
                "log": list(self.log)[-20:],
            }


ST = State()
SOCK = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)


# ── OSC over UDP ─────────────────────────────────────────────────────────────
def osc_string(s):
    b = s.encode("utf-8")
    return b + b"\x00" * (4 - (len(b) % 4))


def osc_message(address, args=None):
    out = osc_string(address)
    tt = ","
    argbufs = b""
    for a in (args or []):
        tt += "s"
        argbufs += osc_string(str(a))
    return out + osc_string(tt) + argbufs


WORKSPACE_ACTIONS = {"go": "/go", "stopAll": "/stop", "panicAll": "/panic"}
CUE_ACTIONS = {"start", "stop", "hardStop", "pause", "resume", "load", "preview", "panic"}


def address_for(cue, action):
    action = (action or "start").strip()
    if action in WORKSPACE_ACTIONS:
        return WORKSPACE_ACTIONS[action]
    cue = str(cue or "").strip()
    if not cue:
        return None
    act = action if action in CUE_ACTIONS else "start"
    return f"/cue/{urllib.parse.quote(cue)}/{act}"


def send_osc(address, args=None):
    SOCK.sendto(osc_message(address, args), (HOST, PORT))


def fire_cue(cue, action, source="panel"):
    addr = address_for(cue, action)
    if not addr:
        return False, "needs a cue number"
    try:
        if PASSCODE:
            send_osc("/connect", [PASSCODE])
        send_osc(addr)
    except Exception as e:
        return False, str(e)
    ST.add_log(cue, action, addr, source)
    print(f"  → {addr}  ({source})")
    return True, addr


def qlab_reachable():
    """QLab listens on TCP too, so a quick connect tells us if it's up."""
    try:
        s = socket.create_connection((HOST, PORT), timeout=0.4)
        s.close()
        return True
    except OSError:
        return False


# ── Firestore typed-value <-> Python ─────────────────────────────────────────
def unwrap(v):
    if not isinstance(v, dict):
        return v
    if "stringValue" in v:
        return v["stringValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return v["doubleValue"]
    if "booleanValue" in v:
        return v["booleanValue"]
    if "nullValue" in v:
        return None
    if "timestampValue" in v:
        return v["timestampValue"]
    if "mapValue" in v:
        return {k: unwrap(x) for k, x in v.get("mapValue", {}).get("fields", {}).items()}
    if "arrayValue" in v:
        return [unwrap(x) for x in v.get("arrayValue", {}).get("values", [])]
    return v


def wrap(v):
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {k: wrap(x) for k, x in v.items()}}}
    if isinstance(v, list):
        return {"arrayValue": {"values": [wrap(x) for x in v]}}
    return {"nullValue": None}


def doc_url(code):
    return f"{FIRESTORE_BASE}/sessions/{urllib.parse.quote(code)}"


def _curl(extra_args):
    proc = subprocess.run(
        ["curl", "-sS", "-w", "\n%{http_code}"] + extra_args,
        capture_output=True, text=True, timeout=20,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"curl exit {proc.returncode}")
    body, _, status = proc.stdout.rpartition("\n")
    return int(status or 0), body


def get_doc(code):
    status, body = _curl([f"{doc_url(code)}?key={API_KEY}"])
    if status == 404:
        return {}
    if status != 200:
        raise RuntimeError(f"HTTP {status}: {body[:160]}")
    return {k: unwrap(v) for k, v in json.loads(body).get("fields", {}).items()}


def patch_field(code, dotted_path, value):
    parts = dotted_path.split(".")
    body_val = wrap(value)
    for p in reversed(parts[1:]):
        body_val = {"mapValue": {"fields": {p: body_val}}}
    body = {"fields": {parts[0]: body_val}}
    url = (f"{doc_url(code)}?key={API_KEY}"
           f"&updateMask.fieldPaths={urllib.parse.quote(dotted_path)}")
    try:
        _curl(["-X", "PATCH", "-H", "Content-Type: application/json",
               "-d", json.dumps(body), url])
    except Exception as e:
        print(f"  (firestore write failed: {e})")


# ── Background: watch the Cueola session + keep QLab status fresh ────────────
def poller():
    last_cmd_id = None
    first = True
    last_beat = 0
    cur_session = None

    while True:
        with ST.lock:
            session = ST.session
            ST.qlab_ok = qlab_reachable()

        if session != cur_session:
            cur_session, last_cmd_id, first = session, None, True

        if session:
            try:
                doc = get_doc(session)
                qlab = doc.get("qlab", {}) or {}
                cmd = qlab.get("command")
                if cmd and cmd.get("commandId"):
                    if first:
                        last_cmd_id = cmd["commandId"]
                    elif cmd["commandId"] != last_cmd_id:
                        last_cmd_id = cmd["commandId"]
                        sent = 0
                        for c in (cmd.get("cues") or []):
                            ok, _ = fire_cue(c.get("cue"), c.get("action"), "cueola")
                            sent += 1 if ok else 0
                        patch_field(session, "qlab.lastAck", {
                            "commandId": cmd["commandId"], "ok": True,
                            "sentCount": sent, "ts": int(time.time() * 1000)})
                first = False
                now = time.time()
                if now - last_beat >= float(CFG.get("heartbeatSeconds", 5)):
                    last_beat = now
                    patch_field(session, "qlab.agentHeartbeat",
                                {"ts": int(now * 1000), "host": HOST, "port": PORT})
            except Exception as e:
                print(f"  ...retrying ({e})")
                time.sleep(1)

        time.sleep(float(CFG.get("pollSeconds", 0.35)))


# ── Web console ───────────────────────────────────────────────────────────────
PANEL_HTML = r"""<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Cue → Q</title>
<style>
 :root{--bg:#0b0d14;--panel:#161a26;--panel2:#1d2230;--line:#2a3142;
   --txt:#e9edf6;--mut:#8a93a8;--accent:#5b8cff;--go:#3ddc84;--stop:#ff6b6b;--amber:#ffce5a}
 *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
 body{margin:0;font:16px -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;
   background:radial-gradient(120% 80% at 50% -10%,#16203a 0,#0b0d14 60%),var(--bg);
   color:var(--txt);min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:18px}
 .wrap{width:100%;max-width:420px}
 header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
 .brand{font-size:22px;font-weight:800;letter-spacing:-.02em}
 .brand .b{color:var(--accent)}
 .pills{display:flex;gap:8px}
 .pill{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--mut);
   background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:5px 10px}
 .dot{width:8px;height:8px;border-radius:50%;background:var(--mut)}
 .dot.on{background:var(--go);box-shadow:0 0 8px var(--go)} .dot.off{background:var(--stop)}
 .readout{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px 20px;margin-bottom:12px}
 .ro-lbl{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);margin-bottom:4px}
 .ro-num{font-size:46px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;min-height:46px}
 .ro-num.empty{color:var(--mut)}
 .acts{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
 .act{flex:1;min-width:64px;padding:10px 6px;border-radius:12px;border:1.5px solid var(--line);
   background:var(--panel);color:var(--mut);font-weight:700;font-size:13px;cursor:pointer;transition:.12s}
 .act.sel{border-color:var(--accent);color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,transparent)}
 .keys{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px}
 .key{padding:20px 0;border-radius:14px;border:1px solid var(--line);background:var(--panel2);
   color:var(--txt);font-size:26px;font-weight:700;cursor:pointer;transition:.08s;font-variant-numeric:tabular-nums}
 .key:active{transform:scale(.95);background:#283041}
 .key.util{font-size:18px;color:var(--mut)}
 .go{width:100%;padding:22px;border:none;border-radius:16px;background:var(--go);color:#06281a;
   font-size:24px;font-weight:900;letter-spacing:.04em;cursor:pointer;transition:.1s}
 .go:active{transform:scale(.98)} .go:disabled{opacity:.4;cursor:not-allowed}
 .go.stopclr{background:var(--stop);color:#330} .go.amberclr{background:var(--amber);color:#3a2c00}
 .log{margin-top:16px}
 .log h3{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);margin:0 0 8px}
 .row{display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--panel);
   border:1px solid var(--line);border-radius:10px;margin-bottom:6px;font-size:13px}
 .row .tag{font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;background:var(--panel2);color:var(--mut)}
 .row .tag.cueola{color:var(--accent)} .row .addr{margin-left:auto;color:var(--mut);font-family:ui-monospace,monospace;font-size:12px}
 .row .t{color:var(--mut);font-variant-numeric:tabular-nums}
 .link{margin-top:18px;display:flex;gap:8px}
 .link input{flex:1;padding:11px 13px;border-radius:11px;border:1px solid var(--line);
   background:var(--panel);color:var(--txt);font-size:15px;text-transform:uppercase;letter-spacing:.05em}
 .link button{padding:0 16px;border-radius:11px;border:1px solid var(--accent);background:transparent;
   color:var(--accent);font-weight:700;cursor:pointer}
 .hint{color:var(--mut);font-size:12px;margin-top:8px;text-align:center}
 .flash{animation:fl .5s} @keyframes fl{0%{background:color-mix(in srgb,var(--go) 30%,var(--panel))}100%{background:var(--panel)}}
</style></head><body><div class="wrap">
 <header>
   <div class="brand">Cue<span class="b">ola</span> → <span class="b">Q</span></div>
   <div class="pills">
     <div class="pill"><span class="dot" id="dq"></span>QLab</div>
     <div class="pill"><span class="dot" id="ds"></span><span id="ss">Cueola</span></div>
   </div>
 </header>

 <div class="readout"><div class="ro-lbl">Cue number</div><div class="ro-num empty" id="ro">—</div></div>

 <div class="acts" id="acts">
   <div class="act sel" data-a="start">GO</div>
   <div class="act" data-a="stop">Stop</div>
   <div class="act" data-a="pause">Pause</div>
   <div class="act" data-a="panic">Panic</div>
 </div>

 <div class="keys" id="keys">
   <div class="key">1</div><div class="key">2</div><div class="key">3</div>
   <div class="key">4</div><div class="key">5</div><div class="key">6</div>
   <div class="key">7</div><div class="key">8</div><div class="key">9</div>
   <div class="key util" data-k=".">·</div><div class="key">0</div><div class="key util" data-k="del">⌫</div>
 </div>

 <button class="go" id="go">GO</button>

 <div class="log"><h3>Fired</h3><div id="rows"></div></div>

 <div class="link">
   <input id="sess" placeholder="Cueola session code" maxlength="12">
   <button id="connect">Link</button>
 </div>
 <div class="hint">Punch a cue number → pick an action → GO. Cues fired in Cueola appear here too.</div>
</div>
<script>
let cue="", action="start";
const ro=document.getElementById("ro"), go=document.getElementById("go");
function render(){
  ro.textContent = cue || "—"; ro.classList.toggle("empty", !cue);
  const lbl = action==="start"?"GO":action[0].toUpperCase()+action.slice(1);
  go.textContent = lbl; go.className = "go" + (action==="stop"?" stopclr":action==="panic"||action==="pause"?" amberclr":"");
}
document.getElementById("keys").addEventListener("click",e=>{
  const k=e.target.closest(".key"); if(!k) return;
  const v=k.dataset.k || k.textContent;
  if(v==="del") cue=cue.slice(0,-1);
  else if(v==="·"||v===".") { if(!cue.includes(".")&&cue) cue+="."; }
  else if(cue.length<8) cue+=v;
  render();
});
document.getElementById("acts").addEventListener("click",e=>{
  const a=e.target.closest(".act"); if(!a) return;
  action=a.dataset.a;
  document.querySelectorAll(".act").forEach(x=>x.classList.toggle("sel",x===a));
  render();
});
go.addEventListener("click",async()=>{
  if(action!=="panic" && !cue) return;
  go.disabled=true;
  try{ await fetch(`/fire?cue=${encodeURIComponent(cue)}&action=${action}`); }catch(e){}
  cue=""; render(); go.disabled=false; refresh();
});
document.getElementById("connect").addEventListener("click",async()=>{
  const v=document.getElementById("sess").value.trim().toUpperCase();
  await fetch(`/link?session=${encodeURIComponent(v)}`); refresh();
});
async function refresh(){
  try{
    const s=await (await fetch("/status")).json();
    document.getElementById("dq").className="dot "+(s.qlab?"on":"off");
    document.getElementById("ds").className="dot "+(s.session?"on":"off");
    document.getElementById("ss").textContent=s.session||"Cueola";
    if(document.activeElement!==document.getElementById("sess"))
      document.getElementById("sess").value=s.session||"";
    const rows=document.getElementById("rows");
    rows.innerHTML = (s.log.slice().reverse().map(r=>
      `<div class="row"><span class="t">${r.t}</span>`+
      `<span class="tag ${r.source}">${r.source}</span>`+
      `<b>${r.action==="start"?"GO":r.action} ${r.cue||""}</b>`+
      `<span class="addr">${r.addr}</span></div>`).join("")) || `<div class="hint">No cues fired yet.</div>`;
  }catch(e){}
}
render(); refresh(); setInterval(refresh,1500);
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass  # quiet

    def _send(self, code, body, ctype="application/json"):
        b = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/" or u.path == "/index.html":
            return self._send(200, PANEL_HTML, "text/html; charset=utf-8")
        if u.path == "/status":
            return self._send(200, json.dumps(ST.snapshot()))
        if u.path == "/fire":
            ok, info = fire_cue(q.get("cue", [""])[0], q.get("action", ["start"])[0], "panel")
            return self._send(200, json.dumps({"ok": ok, "info": info}))
        if u.path == "/link":
            code = q.get("session", [""])[0].strip().upper()
            with ST.lock:
                ST.session = code
            CFG["sessionCode"] = code
            save_config(CFG)
            return self._send(200, json.dumps({"ok": True, "session": code}))
        return self._send(404, json.dumps({"ok": False}))


def main():
    ui_port = int(CFG.get("uiPort", 8765))
    server = None
    for p in range(ui_port, ui_port + 6):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", p), Handler)
            ui_port = p
            break
        except OSError:
            continue
    if not server:
        print("Couldn't open a local port for the console.")
        return

    threading.Thread(target=poller, daemon=True).start()

    url = f"http://localhost:{ui_port}/"
    print("=" * 50)
    print("  Cueola → QLab  —  console running")
    print(f"  Open: {url}")
    print(f"  QLab: {HOST}:{PORT}" + ("  (passcode set)" if PASSCODE else ""))
    print("  Close this window to stop.")
    print("=" * 50)
    try:
        subprocess.run(["open", url])
    except Exception:
        pass
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
