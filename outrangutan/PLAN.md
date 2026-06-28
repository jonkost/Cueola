# Outrangutan 🦧 — PLAN (web playback & cue system for Cueola)

> A lightweight, web-native show-playback system — "QLab/Mitti, but simpler" — that
> plays and cues **video** and **sound effects**, driven by keyboard / Stream Deck / the
> Cueola rundown, routed to one or more output windows. **Web build only.** No accounts,
> pricing, tiers, or entitlements — Cueola's session system is used only as a technical
> join/sync transport.

---

## Phase 0 — What's in the repo and how Outrangutan plugs in

**Stack (matched exactly — no new stack):**
- Vanilla JS, **no framework, no bundler, no package manager** for the web app. `index.html`
  (~3.2k lines, all CSS + markup) loads `cueola-app.js` (~12k lines, one global script) and
  the small `cueola-entitlements.js`. Firebase (`app` + `app-check` + `firestore`) is the
  only "backend"; **no server**, **no Firebase Storage**, **no media-upload path** exists.
- State is plain globals; persistence is `localStorage` + Firestore. Files today are read
  client-side via `FileReader` (scripts, PDFs) — never uploaded to a server.
- **Routing/screens:** each module is `<div class="screen" id="…">` shown by toggling `.on`
  (others off), via an `enterX()` that calls `pushSessionHistoryState(...)` and installs a
  keydown handler scoped to "only when my screen is `.on`". The front page (`#entry`) lists
  modules as `.e-card`s (Cueola / Planda Bear / Flowmingo / Demo / Blank Slate).
- **Theme:** global CSS custom properties (`--bg`, `--s1..s4`, `--border`, `--text/2/3`,
  `--accent`, dept colors `--video/--green/--red/--yellow/--purple/--cyan`, `--mono`,
  `--syne`, `--sans`, radii `--r*`) defined per `[data-theme]`. All new UI uses these.
- **SF Symbols** icon system (`assets/sf-symbols.css`, `data-symbol="…"`/`sfIcon()`); emoji
  reserved for brand glyphs (🐨/🐼/🦩 — Outrangutan adds **🦧**).

**Session system (used only as join/sync transport):**
- Session code (e.g. `2606K`, `genCode()`); shared doc at Firestore `sessions/{code}`
  (rundown beats, prompter, presence, `qlab.command`). `window._db/_doc/_setDoc/_getDoc/
  _onSnapshot/_updateDoc/...` are the injected Firestore handles. The app already degrades
  to local-only when Firestore is unreachable (`waitForFirebaseReady` timeout) — Outrangutan
  follows the same offline-tolerant pattern.

**Rundown / live cue firing (Phase 4 seam):**
- Rundown = ordered `beats`; each beat has `cues` keyed by department. There is already a
  **`playback`** department cue type (red) with a manual **GO** button that fires QLab via
  `sessions/{code}.qlab.command` (see `qlab-agent/`). Outrangutan's rundown trigger mirrors
  this exactly: a `playback` cue links to an Outrangutan cue id; live GO fires it; status/
  name/thumb/duration flow back into the cue cell. Live state is driven by `lsIdx`/`goLive()`.

### Architecture decision (flag for review)
Outrangutan is large (engine + cue list + SFX + outputs + scopes + keying + OBS…). Inlining
it into the 12k-line `cueola-app.js` would bloat it and raise merge risk (this repo has
already lost markup in a merge once). So Outrangutan lives in its **own folder, same stack**
— vanilla JS global scripts + theme tokens, exactly like `cueola-entitlements.js`. It still
*feels native*: a front-page `.e-card`, a `.screen` it owns, the same `enterX()`/back-nav
pattern, the same tokens/symbols. **Not a new stack; not a framework — just file isolation.**

```
outrangutan/
  PLAN.md, NOTES.md
  outrangutan.css        # uses the global theme tokens
  outrangutan.js         # engine + control UI (global script; window.Outrangutan + enterOutrangutan)
  output.html           # chrome-free output window (separate doc for a 2nd monitor)
```
Integration into the app is **additive and minimal**: a front-page card, an empty
`<div class="screen" id="outrangutan">`, and `<link>`/`<script>` includes in `index.html`.
**Phase 1 touches `cueola-app.js` zero times** (lowest-risk path).

---

## How each phase maps onto the repo

### Phase 1 — MVP playback  ← built now, then STOP for review
Cue list (Video + Audio/SFX), media upload to **IndexedDB** (local-first; no server exists),
transport (GO / Stop / Pause-Resume) with **pre-wait** + **continue modes** (manual /
auto-continue-on-start / auto-follow-on-end), **count-out clock front & center**, **one
output window** (chrome-free, drag to 2nd display), **keyboard-first** (Space=GO, Esc=panic,
S=stop, P=pause; editable map shown on screen), **All-Stop/Panic + Fade&Stop-All**, and
**autosave + crash recovery** (everything in IndexedDB; offer restore on reload). Standalone
mode works with no session — session join is wired in Phase 4.

### Phase 2 — SFX board + audio engine  ← BUILT (awaiting review); see NOTES.md
Trigger-pad grid (drag file → pad, name/color/hotkey), **Web Audio pre-decoded `AudioBuffer`s**
(low latency), per-cue/pad chain (gain / 3-band EQ / compressor / VU), A/V fades with curves
(in/out/to-black/crossfade), master+per-cue meters, small edits (trim in/out, crop/scale,
volume, loop/hold/fade-on-end). Phase 1 audio uses a simple element player as a placeholder;
Phase 2 replaces it with the Web Audio graph.

### Phase 3 — Workspaces, multi-output, control surfaces  ← BUILT (awaiting review); see NOTES.md
Tabs/custom workspaces (persisted). Multi-output via **Window Management API**
(`getScreenDetails`), per-cue output targeting, **identify** patterns, per-output `setSinkId`.
**Stream Deck via WebHID** (no Elgato software). Multi-trigger toggle.

### Phase 4 — Cueola integration  ← BUILT (awaiting review); see NOTES.md
Front-page **session** entry; join the same `sessions/{code}` and sync the cue list +
transport; live rundown fires Outrangutan cues (link a `playback` cue → Outrangutan cue id);
auto-populate the rundown cell (name/thumb/duration/live status) and keep it in sync.

### Phase 5 — Pro features & monitoring (web-achievable)  ← BUILT (awaiting review); see NOTES.md
Waveform + vectorscope (canvas/WebGL on the program frame; toggleable, resolution-aware),
keying (chroma/luma WebGL/WebGPU shaders; alpha via VP9/AV1 WebM-alpha), **OBS** via
obs-websocket v5, **Dropbox** folder sync, **transcode-on-upload** (server `ffmpeg` or
`ffmpeg.wasm`) normalizing uploads + generating thumbs/proxies.

---

## Web scope reality (deferred to the future native Mac engine — do NOT attempt)
Hardware video outs (SDI/NDI/GPU-outs) — web does **browser windows on monitors only**.
Pro codecs (ProRes/DNxHD/HEVC-with-alpha) — not browser-decodable; rely on transcode-on-upload.
Broadcast key+fill signal output. Frame-accurate genlock / multi-output sync (WebCodecs can
tighten single-output, but the default stays a plain `HTMLVideoElement`). Each is noted in
`NOTES.md` when it comes up.

**Browser support:** full feature set (WebHID Stream Deck, Window Management API multi-output,
`setSinkId`, WebGPU keying/scopes) needs **Chromium (Chrome/Edge)**. Build for Chrome/Edge
first; degrade gracefully elsewhere.

---

## Definition of done (per phase) — tracking — ALL PHASES BUILT (1–5)
- [x] Runs in the existing dev env, **no new stack**, matches conventions. *(Phase 1 · 2 · 3 · 4 · 5)*
- [x] Live-critical paths (GO / Stop / Panic) fully **keyboard-operable**. *(Phase 1 · 2: + pad hotkeys, Tab · 3: + Stream Deck keys)*
- [x] Autosave/recovery protects anything that would hurt to lose mid-show. *(Phase 1 · 2 · 3: schema-3 incl. pads/outputs/sdMap/settings · 5: key/obs per-cue)*
- [x] Live-critical features keep working through a network drop (local-first IndexedDB). *(Phase 1 · 2 · 3 · 4: session is a pure overlay; transport fires locally first)*
- [x] `NOTES.md` records reduced-scope + browser limits; pause & summarize before next phase. *(Phase 1 · 2 · 3 · 4 · 5)*

**Phase 5 status (FINAL):** Scopes (waveform + vectorscope, resolution-aware, toggle),
WebGL keyer (chroma/luma/alpha → composite over bg; per-cue Inspector; mirrored to the
output window via a `key` msg + identical shader on `#keycv`), OBS obs-websocket v5 (auth
handshake, scenes, stream/record, per-cue on-fire actions + fire-cue-on-scene), Dropbox
(token connect → list/pull → local cues), transcode-on-upload (webPlayable gate + lazy
ffmpeg.wasm → H.264 MP4, opt-in, falls back to as-is). Surfaced via a **Scopes** toggle,
**Tools ▸ Integrations** sheet, and Inspector **Key**/**OBS** sections. Verified in preview:
scopes plot from a real frame, keyer shader compiles + chroma engages, transcode detection,
OBS safe-when-disconnected, panels render. Live picture (scope animation, keyer composite),
OBS round-trip (needs running OBS), Dropbox (needs token), and transcode (CDN ffmpeg.wasm)
need a real/visible environment. Cache-bust `?v=20260628h`.

**Phase 2 status:** Web Audio engine, SFX pad board (pre-decoded buffers, instant
trigger, per-pad EQ/comp/meter, hotkeys, retrigger), per-cue audio chain, A/V fades
+ curves, A/B-deck video crossfade, master/active/pad meters, small edits
(fit/scale/pos, on-end hold/black), Playback/SFX tabs. Verified in the browser
preview (audio path, simultaneity, transport, inspector, A/B alternation). The
cross-dissolve + meter animation need a quick check in a **visible** Chrome/Edge
window (the headless preview pauses rAF and won't play media).

**Phase 3 status:** Addressable multi-output (one BroadcastChannel + `target`;
`output.html#out=<id>` filters; per-cue Output target; Outputs panel with add/remove/
identify/screen/audio-device), Window Management `getScreenDetails()` placement,
per-output + master `setSinkId` (outputs muted by default → fixes P2 double-audio),
WebHID **Stream Deck** (connect, press→action map for GO/Stop/Pause/Fade/PANIC/cue/pad,
gen-2 key images), persisted workspace (tab + outputs + sdMap + devices). Schema → **3**
(back-fills P1/P2). Verified in preview: addressing both control + output side, panels,
mapping, per-cue routing, no regressions. **Window-placement / WebHID input / setSinkId
device routing need real hardware + permission** — written defensively, degrade
gracefully, need a real Chrome/Edge check. Cache-bust `?v=20260628b`.

**Phase 4 status:** First touch of `cueola-app.js`. Bus = `sessions/<code>.outrangutan`
(dotted sub-fields): rundown writes `outrangutan.command`, Outrangutan publishes
`outrangutan.cues` (media-free summary) + `outrangutan.live`. **Rundown side**
(cueola-app): a 🦧 link block on the **playback** cue modal (`d.outCueId`/`d.outAuto`),
manual GO on the live card, auto-fire in `lsNext`, and `applyOutrangutanState` →
playback-cell badge (name/dur + ON AIR). **Module side** (outrangutan): subscribe on
session join, consume commands (dedupe + own-sender loop guard + local-first fire),
publish cues on list change + live on transport. Verified end-to-end with **mocked
Firestore** (preview FS is permission-denied): join publishes cues+live, fire publishes
live `status:play`, remote stop/cue commands execute, loop guard holds, cueola options +
badge render. **One-way sync by design** (media blobs can’t cross Firestore; a 2nd
device can’t play media it lacks). Real Firestore delivery needs a live non-demo
session. Cache-bust: cueola-app `?v=20260628b`, outrangutan `?v=20260628c`.
