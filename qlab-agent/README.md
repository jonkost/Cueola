# Cueola → QLab Bridge

Lets **Cueola fire QLab cues**. A small helper runs on (or near) your QLab Mac,
watches your Cueola session, and forwards each cue you fire to QLab over OSC.

```
Cueola (browser, anywhere)
   │  writes sessions/<code>.qlab.command
   ▼
Firestore  ──────────────►  Bridge (this)  ──OSC/UDP──►  QLab :53000
```

The operator can be on the **same Mac as QLab** or **across the internet** — the
command rides through Firestore either way, so there's no network setup.

---

## ⭐ Easiest way — double-click, no Terminal, no install

This path uses **plain Python**, which is already on every Mac. Nothing to
install — no Node, no Homebrew, no `npm`.

1. **Open your QLab workspace** and make sure OSC is allowed (see *QLab setup*
   below — by default it already is).
2. In Finder, open the `qlab-agent` folder and **double-click
   `Start QLab Bridge.command`**.
3. A dialog pops up — type your **Cueola session code** and click **Start**.
   (It remembers the last one, so next show you just click Start.)
4. A small window shows `Listening for cue commands…`. That's it — leave it open
   during your show. **Closing the window stops the bridge.**

Cueola flips to **🟢 QLab Connected**, and firing a cue prints e.g.
`→ /cue/14.5/start`.

> First double-click only: if macOS says it can't verify the file, right-click
> `Start QLab Bridge.command` → **Open** → **Open**. After that, double-click works.

---

## QLab setup (one time, usually already done)

In your **open workspace**, click the **⚙︎ gear (Settings)** at the bottom-right →
**Network** → **OSC Access**:

- **Allow OSC connections** is on by default.
- The **"No Passcode"** row has **Control** checked by default → the bridge needs
  no passcode. Leave `qlabPasscode` blank.
- **OSC Listening Port** is **53000** (matches the bridge default).

To require a passcode instead: uncheck Control on the "No Passcode" row, add a
4-digit passcode with Control, and put it in `config.json` → `qlabPasscode`.

---

## Settings — `config.json`

Created for you next to the bridge. You normally only set `sessionCode` (and the
double-click dialog does that for you).

| field             | what it is                                                       |
|-------------------|------------------------------------------------------------------|
| `sessionCode`     | Your Cueola session code.                                        |
| `qlabHost`        | `127.0.0.1` if QLab is on this Mac, else the QLab Mac's IP.       |
| `qlabPort`        | QLab's OSC UDP port (default `53000`).                            |
| `qlabPasscode`    | QLab OSC passcode, or `""` if none.                              |
| `pollSeconds`     | How often to check for new cues (default `0.35`).               |
| `heartbeatSeconds`| How often to report "online" to Cueola (default `5`).           |

> Tip: quit the bridge when you're not in a show — it polls Firestore while
> running, and there's no reason to leave it on overnight.

---

## Action → OSC mapping

| Cueola action | OSC sent                  |
|---------------|---------------------------|
| Start         | `/cue/<n>/start`          |
| Stop          | `/cue/<n>/stop`           |
| Pause         | `/cue/<n>/pause`          |
| Resume        | `/cue/<n>/resume`         |
| Load          | `/cue/<n>/load`           |
| Panic         | `/cue/<n>/panic`          |
| GO (playhead) | `/go`                     |

`<n>` is the cue **number** (or unique ID) exactly as it appears in QLab.

---

## Advanced — Node version

`agent.js` is a lower-latency alternative (real-time Firestore listener instead
of polling). It needs Node 18+:

```bash
brew install node
cd qlab-agent
npm install
npm start            # reads the same config.json
```

Most people should just use the double-click Python bridge above.

---

## Troubleshooting

- **"QLab Disconnected" in Cueola** — the bridge isn't running, or the session
  code doesn't match the live Cueola session.
- **Bridge prints `→ /cue/…` but QLab does nothing** — wrong port, OSC access
  off, passcode mismatch, or that cue number doesn't exist in QLab.
- **Window flashes and closes instantly** — open it once via right-click →
  **Open** so macOS lets it run; any error now stays on screen.

## Security note

Uses the same public Firebase config and open Firestore rules as the Cueola web
app — anyone with your session code can write cue commands. Treat the session
code like a show password.
