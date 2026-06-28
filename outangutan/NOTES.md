# Outangutan 🦧 — NOTES

Running log of decisions, tradeoffs, reduced-scope choices, and browser limits.
Newest phase on top.

---

## Phase 4 — Cueola integration  (built; awaiting review)

**First phase that touches `cueola-app.js`** (P1–3 changed it zero times). Mirrors
the existing **QLab transport** exactly — but Outangutan *is* the consumer (no
external agent) and also *publishes back*.

### The bus — `sessions/<code>.outangutan` (dotted sub-fields, never clobbered)
- `outangutan.command` — **written by the rundown** (cueola-app), read by Outangutan.
  `{ commandId, ts, sender, action:'cue'|'go'|'stop'|'panic'|'fadeStop', cueId }`.
- `outangutan.cues` / `outangutan.cuesTs` — **written by Outangutan**: a media-free
  cue-list summary `{ [cueId]: {num,name,type,dur} }` (blobs never go to Firestore).
- `outangutan.live` — **written by Outangutan**: `{ status, cueId, name, type, dur,
  remaining, thumb, ts, sender }` (the live cue's thumb only — one at a time keeps the
  doc small).
  Both sides use `updateDoc` with dotted paths, so the rundown's `command` and
  Outangutan's `cues`/`live` coexist without overwriting each other.

### cueola-app.js (rundown side)
- **Link block** on the **playback** cue-config modal only (`outangutanCueFields`,
  appended next to `qlabCueFields`): a `<select>` of the session's published
  Outangutan cues + “Auto-fire when this row advances live” + “Fire now”. Saved as
  `d.outCueId` / `d.outAuto`.
- **Manual GO** on the live cue card (`outangutanGoBtnHTML` → `fireOutangutanCueCell`)
  and **auto-fire** in `lsNext` (`fireOutangutanAutoForBeat`) — both call
  `fireOutangutanCommand`, which writes `outangutan.command` (same guard/shape as
  `fireQlabCommand`: live non-demo session, id’d by `commandId`).
- **Auto-populate**: the session snapshot calls `applyOutangutanState(d.outangutan)`,
  which caches cues/live and re-renders the rundown/live **only on cue-set or
  status change** (not every remaining-time tick — avoids thrashing). The playback
  cell shows a 🦧 badge with the linked cue’s name/dur + an **ON AIR / PRE / PAUSE**
  pill (`outangutanCellBadge`). A playback cell with *only* a link no longer counts as
  empty.

### outangutan.js (module side)
- On **session join** (`applyShow` when mode=session) it `subscribeSession()`s to
  `sessions/<code>`, listens for `outangutan.command`, dedupes by `commandId`, ignores
  its **own** sender (loop guard) and stale (>30 s) commands, then runs the action
  **locally** (GO/stop/panic/fade/`cue`-by-id). Standalone never subscribes.
- **Publishes** a cue summary on any list change (via `scheduleSave` → `publishCues`,
  debounced) and live transport on every status change (`setStatus` → `publishLive`)
  + throttled (~700 ms) during playback (the ticker). All writes are guarded by
  `fbReady()` + session mode.
- **Live-critical stays local-first**: every transport path fires locally *first*;
  the session is a pure overlay, so a network drop never blocks GO/stop/panic.

### Verified (browser preview, mocked Firestore)
Real Firestore is permission-denied/App-Check-unconfigured in the preview, so the
round-trip was verified with `window._updateDoc`/`_onSnapshot` mocked:
- Join → Outangutan publishes **`outangutan.cues` + `outangutan.live`**.
- Fire a cue → publishes **`outangutan.live` `status:play`** (auto-populate).
- Remote **`stop`** command → clears program; remote **`cue`** command → fires that cue.
- **Loop guard**: a command with Outangutan’s own sender is ignored.
- cueola-app: `applyOutangutanState` populates the link `<select>` and the cell badge
  shows the linked name + **ON AIR**; `outangutanCueFields` is **playback-only**
  (video/audio return empty); `getCueCell` renders the badge without error.
- Both files load clean (no console errors); rundown render unaffected.

### Reduced scope / honest limits
- **Real Firestore delivery** needs a live (non-demo) session on a network — not
  reachable in the locked-down preview; the *logic* on both sides is mock-verified.
- **One-way cue-list sync.** Outangutan publishes a *summary* (+ accepts commands);
  it does **not** sync the editable cue list or media across devices — **media blobs
  can’t traverse Firestore**, and a second device can’t play media it doesn’t hold.
  The authoritative cue list + media stay on the operator’s Outangutan (local-first).
  This is the web-feasible reading of “sync cue list + transport”.
- The rundown cell shows live **status** (not a per-second countdown) to avoid
  re-rendering the rundown every tick; the precise count-out lives in Outangutan.
- **Multiple Outangutan operators** in one session would each act on a command
  (they may hold different media) — typical setup is one operator + the rundown.

### How to test Phase 4 (live, non-demo session, 2 devices or 2 tabs)
1. Open Cueola on a session code; open **🦧 Outrangutan → Session**, join the same
   code. Add a couple of cues in Outangutan.
2. In the rundown, open a **Playback** cue → the “Outrangutan playback” block lists
   those cues → link one, tick auto-fire. The cell shows the 🦧 name/dur badge.
3. Go **Live**; advancing onto that row (or the cell’s 🦧 GO) fires the Outangutan
   cue on the other device; the cell flips to **ON AIR** while it plays.

---

## Phase 3 — Workspaces, multi-output, control surfaces  (built; awaiting review)

### What shipped
- **Addressable multi-output.** One `BroadcastChannel`, but every message now
  carries a `target` (null = broadcast); each output window opens with
  `output.html#out=<id>`, reads its id from the hash, and **filters on `target`**
  (verified). Each video cue has an **`output`** id (Inspector → Output select);
  GO posts `play`/`xfade` to that output only, and `stop`s the output it left.
  Outputs report id back on ready/pong/closed so the controller tracks liveness.
- **Outputs panel** (top bar → Outputs): add/remove/rename outputs, **Open/Focus**,
  per-output **Identify** (color bars + label), a **master audio device** select,
  and per-output **Display** + **audio device**. ≥1 output always kept; deleting an
  output re-homes its cues.
- **Window Management API**: “Detect displays” calls `getScreenDetails()`; an output
  can target a screen, and Open places the window on that screen’s bounds +
  requests fullscreen. Guarded — degrades to manual drag where unsupported/denied.
- **Per-output + master audio device (`setSinkId`)**: output windows are **muted by
  default** (the control bus carries program audio — this also kills the latent
  P2 double-audio), and a per-output “Audio on this output” + device routes that
  window via `videoEl.setSinkId`. Master (control) device via `AudioContext.setSinkId`
  where supported. Devices come from `enumerateDevices()` (labels need OS permission).
- **Stream Deck over WebHID** (top bar → Stream Deck): connect directly (vendor
  `0x0fd9`, no Elgato software), parse key-press input reports → fire a mapped action
  (**GO / Stop / Pause / Fade·Stop / PANIC / a specific cue / an SFX pad**), and paint
  key images on gen-2 (JPEG) models (MK.2 / XL / v2) + brightness/reset. Model table
  keyed by productId (15/6/32 keys). One-screen mapping grid that works **before** the
  device is attached. Persisted in `settings.sdMap`.
- **Workspaces**: P2’s Playback/SFX tabs + the persisted layout (active tab, outputs,
  Stream Deck map, master device, multi-trigger) **is** the persisted-workspace story.
  Schema bumped to **3**; loader back-fills P1/P2 saves (default 1 output, empty map).

### Verified (browser preview, Chromium)
- No console errors through enter / panels / add-output / mapping / GO / stop.
- **Multi-output addressing, control side**: a video cue set to Output 2 → GO posts a
  `play` message with **`target: 2`** (captured off the channel).
- **Multi-output addressing, output side**: two `#out=1` / `#out=2` frames — an
  addressed `identify` lit **only** Output 2 (with its label); a broadcast cleared it;
  each frame self-titled from its id.
- Outputs panel renders (2 rows, master sink, detect, per-output device); inspector
  **Output select** lists every output and routes `cue.output`.
- Stream Deck panel renders a 15-key grid, mapping persists (`sdMap`), the cue/pad
  **ref select appears** when action = Cue/Pad, Connect enabled (WebHID present).
- Regression: audio cue still GO → **ON AIR** → stop clears.

### Reduced scope / can only be verified with hardware (noted honestly)
- **Second-monitor placement (Window Management), Stream Deck key I/O (WebHID), and
  per-output `setSinkId` device routing need real hardware + a permission grant** — not
  reachable in a headless tab. All three are written defensively (feature-detected,
  every HID/screen/sink call guarded) and degrade gracefully; they need a 2-minute
  check on a real Chrome/Edge with a 2nd display / a Stream Deck / multiple audio devices.
- **Stream Deck input byte-offset + image protocol** are model-specific and untested
  without the device: input `stateOffset` defaults to gen2=3 / gen1=0, image upload is
  implemented for gen-2 JPEG only (gen-1 BMP keys stay dark but still trigger). If keys
  map to the wrong index on a given unit, adjust `SD_MODELS[pid].stateOffset`.
- **Cross-display crossfade** isn’t a real dissolve (different screens) — a cue moving
  to a *different* output cuts in there and clears the old output; same-output
  crossfade dissolves via the output’s A/B decks (from P2).
- **Custom drag-to-rearrange workspace layouts** beyond tabs/panels — deferred; tabs +
  the Outputs/Stream Deck panels cover the practical need. Noted, not pretended.

### How to test Phase 3 (real Chrome/Edge)
1. **Outputs**: top bar → Outputs → Add output (2). “Detect displays”, allow Window
   management → pick a screen per output → Open (it should place + fullscreen there).
   Set cue 1 → Output 1 and cue 2 → Output 2 in the Inspector; GO each → they land on
   the right screen. Identify shows bars+label per output.
2. **Per-output audio**: tick “Audio on this output”, pick a device → that window’s
   audio routes there; the control master device routes the program/SFX bus.
3. **Stream Deck**: top bar → Stream Deck → Connect (pick the device). Map keys to GO /
   PANIC / a cue / a pad; press physical keys → they fire; gen-2 keys show labels.

---

## Phase 2 — SFX board + audio engine  (built; awaiting review)

### What shipped
- **Web Audio engine** (`outangutan.js`): one lazy `AudioContext` (created on first
  GO / pad / SFX-tab, resumed on the user gesture). Master bus = `masterGain →
  masterAnalyser → destination`. A reusable **channel** = `input → lowshelf →
  peaking → highshelf → compressor → gain → analyser → master`. `makeChannel()`,
  `applyChannel()`, `setComp()` (compressor bypass = transparent settings, not a
  reconnect — simpler + glitch-free).
- **Program cues now route through Web Audio.** The single `<audio>`/`<video>`
  elements feed a `MediaElementAudioSourceNode → channel` (created once per element,
  cached). Element volume stays 1; the **channel gain** carries level + fades, so
  cues get EQ / compressor / metering while keeping element-based transport
  (pause/resume/seek/clock) robust. **Design split, deliberate:** *cues* use the
  element-source path (transport robustness); *pads* use **pre-decoded
  `AudioBuffer`s** (the brief's mandatory instant low-latency trigger).
- **SFX pad board** (new **SFX** tab): 12-slot grid (3×4). Drag a file onto a pad →
  stored in IndexedDB + `decodeAudioData` cached → instant trigger. Each pad: name,
  color, **hotkey** (auto-assigned 1–9/0/q/w on add, rebindable), per-pad
  gain/3-band EQ/compressor + meter, fade-in, trim-in, loop, and **retrigger mode**
  (Restart / Layer / Toggle). Pads fire **simultaneously with the program cue**
  (verified). Hotkeys work on either tab. Pad buffers warm on show-load for instant
  first hit.
- **A/V fades with curves** (linear / S-curve / log, shared `curveK()` for gain +
  opacity): per-cue **fade-in / fade-out**, per-cue **crossfade** between video
  cues (A/B decks), **fade-to-black** (end action), and the master **Fade & Stop**
  now ramps every deck + ringing pad with a curve.
- **A/B program decks** (`og-program-a` / `og-program-b`, `.front` z-toggle): video
  cues alternate decks so a crossfade can dissolve A↔B; `freeVideoDeck()` picks the
  idle one. Audio cues use a single audio deck. Output window upgraded to the same
  A/B model (`xfade` / `play` / `black` / `fade` messages).
- **Meters**: master (peak-hold) in both the Program header and the SFX master strip;
  per-active-cue meter in the inspector; per-pad meters on the board + pad inspector.
  Lightweight div-bars driven by one `AnalyserNode` rAF loop (`getByteTimeDomainData`
  → RMS), running only while the screen is open and the context exists.
- **Small edits**: trim in/out (refined), per-cue level, loop, **on-end action**
  (Stop/black · Hold last frame · Fade to black), and for video **fit**
  (contain/cover/fill) + **scale** + **position X/Y** (CSS `object-fit` + `transform`,
  mirrored to the output window).
- **Tabs**: Playback / SFX (`Tab` key toggles), persisted in settings. Schema bumped
  to 2; loader back-fills Phase-1 shows with the new fields, so old saves open clean.

### Verified (browser preview, Chromium)
- No console errors on enter / tab switch / GO / pad fire / panic.
- Audio cue GO → channel path: **ON AIR**, element volume 1 (gain on the channel),
  pause→**PAUSED**, resume→**ON AIR**, stop clears.
- **SFX pad fires simultaneously with a running program cue** (the headline
  requirement) — both live at once.
- Inspector renders the audio chain + fades + edit; **video-only fields
  (crossfade/fit/scale/pos) correctly hidden for audio cues**; EQ / compressor /
  master-gain all persist. Pad inspector renders + binds.
- **A/B deck alternation**: 1st video → deck A (front); 2nd video → deck B (front
  switches, deck A torn down). Front-switch + hard-cut teardown correct.
- PANIC clears program + all pad voices; clean recovery (schema-2 loader).

### Reduced scope / environment limits (noted honestly)
- **The live cross-dissolve and meter/clock animation can't be seen in the headless
  preview** — that tab is `document.hidden`, so `requestAnimationFrame` is paused
  (rAF-driven fades + meters don't advance) and HTML media won't actually play, so
  the `crossing` guard (needs the outgoing deck mid-playback) stays false. The deck
  selection, channel routing, transport, and audio playback are all verified; the
  **dissolve + meters need a 10-second visual check in a real Chrome/Edge window.**
- **Output-window audio** still plays at the cue volume via element volume (no EQ
  chain on the output, no `setSinkId`) — per-output device + chain is **Phase 3**.
- **Audio-cue crossfade** is a fade-swap on the single audio deck (no A/B overlap for
  audio); true overlapping audio program layers aren't needed (that's the pad board).
- **List audio cues remain single-program** (one count-out clock). Simultaneous
  layered audio is the **pad board's** job, per the brief.
- Waveform-based visual trim, scopes/vectorscope, keying, OBS, Dropbox, transcode,
  Stream Deck, multi-window enumeration — **Phases 3 / 5** (unchanged).

### How to test Phase 2 (in a visible Chrome/Edge window)
1. Open **🦧 Outangutan → Standalone**. Drop a few audio + video files on the cue
   list. Select one → GO: it plays, **MASTER meter** moves, clock counts down.
2. **SFX tab**: drop sounds on pads; each gets a hotkey. With a program cue running,
   hit a pad hotkey → the SFX layers **over** the program (toggle Multi-trigger off
   to make pads choke each other). Open a pad's ⓘ → tweak gain/EQ/compressor/loop.
3. **Fades**: set a cue's Fade-in / Fade-out + Curve; set a video cue's **Crossfade
   in**, GO it over another playing video → watch the dissolve. **Fade·Stop (F)**
   ramps everything down. **On end → Hold last frame / Fade to black**.
4. **Output window** (Chromium): open it, GO video cues with crossfades → the output
   dissolves A↔B in sync.

---

## Phase 1.2 — Session entry fix (owner: "can't click Session to get anywhere")

Two real problems, both fixed:
- **Root cause of "can't click":** the front-page Outangutan card was a plain `.e-card`,
  which gives the whole card body `cursor:pointer` + a hover-lift — but only the small
  Session/Standalone pills had handlers, so clicking the card body did nothing. The
  Flowmingo card avoids this with a `cursor:default` / no-lift override; Outangutan was
  missing it. Added `.outangutan-card` to that rule so the card reads as a container and
  the pills are clearly the actionable targets (consistent with Flowmingo).
- **"Doesn't get anywhere":** Session mode previously just opened the same empty workspace
  as Standalone, badged "Session (sync: Phase 4)" — a dead end. Now **Session opens a join
  sheet**: enter the show's session code (prefilled from a prior Outangutan code, an active
  Cueola session, or the last code used), or "Continue without a session". On join the
  badge shows **"Session · <CODE>"**, the code is remembered, and the cue list is **scoped
  per-session** in IndexedDB (`current_<CODE>` vs standalone `current`). Empty code shows an
  inline error; Enter joins, Esc skips to standalone.
- **Still honest about Phase 4:** this is session *entry + local per-code scoping* only —
  live cross-device cue/transport sync over Firestore remains Phase 4. The join toast says so.
- Verified end-to-end in the browser: card cursor now `default`; Session → join sheet
  (focused input) → code "2606k" → badge "Session · 2606K", saved under `current_2606K`;
  empty-code error; prefill on return; "Continue without a session" → Standalone; Back →
  front page. No console errors. Cache-bust `?v=20260622d`.

---

## Phase 1.1 — design polish pass (owner feedback)

- **Wordmark**: two-tone like the other Cueola modules — **“Out” rides `--text`** (white on
  dark, black on light; theme-aware + legible) and **“angutan” is the signature blue
  `#5b8df8`** (a deliberate fixed brand constant, same exception class as the LED clock
  faces, so it reads blue across every theme as requested). Card brand color (`--oc`/`--ob`)
  switched red → blue to match.
- **Front-page card**: buttons reordered to **Session, then Standalone**.
- **SF Symbols everywhere** (the repo's `assets/sf-symbols.css` library, via `sfIcon`) — no
  more unicode glyphs: cue type = `department.video`/`department.audio`; pre-wait =
  `state.timed`; transport = `media.play`/`media.stop`/`media.pause`, Fade·Stop =
  `action.down`, PANIC = `action.power`; bar = `content.display` (Output), `action.grid`
  (Identify), `action.guide` (Shortcuts), `action.back` (Cueola), `action.delete` (delete).
  Show Lock stays text-only (no lock glyph exists in the library; a wrong icon is worse).
  Brand emoji 🦧 kept only as the module glyph (HIG: emoji allowed for brand glyphs only).
- **Recommended additions** (kept tasteful, per "add as needed"): a **wall clock** (time of
  day, mono, in the Program header — "alongside the count-out clock" from the brief §3) and
  **per-cue color** swatches in the inspector (theme department colors).

---

## Phase 1 — MVP playback  (built; awaiting review)

### What shipped
- **`outangutan/outangutan.js`** — engine + control UI (one vanilla global script, the
  same stack as the rest of Cueola). Builds its own DOM into `<div id="outangutan">`.
- **`outangutan/output.html`** — chrome-free output window (separate doc for a 2nd
  monitor); reads media from IndexedDB and follows transport over a `BroadcastChannel`.
- **`outangutan/outangutan.css`** — styles via the global theme tokens.
- **`index.html`** — front-page **🦧 Outangutan** card (Standalone / Session), an empty
  `<div class="screen" id="outangutan">`, and the `<link>`/`<script>` includes. Cache-bust
  `?v=20260622a`. **`cueola-app.js` was not touched** (lowest-risk integration).

### Features delivered (Phase 1 brief)
- **Cue list** of ordered cues — types **Video** and **Audio**; select, reorder by number,
  arm/disarm, per-cue color dot.
- **Upload media** via click or **drag-and-drop**; stored as Blobs in **IndexedDB**
  (`media` store) with a probed **duration** and a generated **thumbnail** (video frame
  ~10% in). No server exists in this repo, so local-first IndexedDB is the store of record.
- **Transport**: **GO** (fire standby, advance standby), **Stop**, **Pause/Resume**, with
  **pre-wait** and **continue modes** — *manual*, *auto-continue* (fire next on start),
  *auto-follow* (fire next on end = the "follow-to").
- **Count-out clock front & center** — large remaining time for the running cue; click to
  toggle remaining/elapsed; shows pre-wait countdown; warns under 10 s.
- **One output window** — `window.open` → chrome-free `output.html`, draggable to a 2nd
  display, with an **Identify** pattern (color bars + label) for pre-show setup.
- **Keyboard-first**: Space=GO, S=Stop, P=Pause, F=Fade&Stop, **Esc=PANIC**; map shown on
  the transport buttons + footer + an editable **Shortcuts** sheet (rebind any action).
- **Safety**: **PANIC / All-Stop** (instant, no fades, clears both media elements + output)
  and **Fade & Stop All** (800 ms fade then stop). Both keyboard-reachable.
- **Autosave + crash recovery**: the cue list + selection + settings persist to IndexedDB
  (`show/current`) on every change (debounced) and on `beforeunload`; on re-enter the show
  is restored and, if it was mid-playback when it stopped, a **recovery banner** offers to
  standby that cue. Media survives because blobs live in IndexedDB too.
- **Show-mode lock**: toggle that disables edit affordances during a live show.
- **Standalone mode** fully works with no session.

### Key decisions / tradeoffs
- **Local-first, no server.** The repo has no backend media path and no Firebase Storage,
  so Phase 1 stores media + show state entirely in **IndexedDB**. This is also exactly what
  "live use must survive a bad network" wants — nothing live-critical touches the network.
- **Control window is the authoritative player; the output window mirrors it** over a
  `BroadcastChannel`. The control `<video id="og-program">` drives the count-out clock and
  the continue/auto-follow logic; the output window plays its own copy of the blob and
  follows play/pause/seek/stop/fade/identify. This makes Phase 1 testable on one screen.
  *Tradeoff:* the program is decoded twice and the two elements aren't frame-locked — fine
  for MVP; **frame-accurate multi-output sync is a deferred Mac-engine concern (§4).**
- **Self-contained in `/outangutan`** (not inlined into `cueola-app.js`). Same stack, same
  tokens, same `enterX()` screen + back-nav pattern, so it *feels native* while keeping the
  12k-line file untouched (this repo has lost markup in a merge before). Flag for review:
  if you'd rather it live in `cueola-app.js`, say so.
- **GO = fire the selected cue, then advance the selection** (QLab-style standby). Selecting
  a cue makes it the standby; double-clicking a cue fires it immediately.

### Reduced scope (deferred to later phases, by design)
- **Audio engine** — Phase 1 plays audio cues through a plain `<audio>` element for
  correctness. The **low-latency Web Audio pre-decoded buffers + EQ/comp/VU + the SFX pad
  board** are **Phase 2**. So Phase 1 fires one main program cue at a time; the multi-pad
  simultaneous SFX board is not here yet (the multi-trigger setting is stored but the pad
  surface lands in Phase 2/3).
- **Auto-continue with two *videos*** swaps the single program element (last-wins). Audio
  layered under video works (separate elements). True simultaneous video layers need
  multi-output/compositing — **Phase 3**. Noted, not pretended.
- **Session mode** shows a badge and runs locally; **joining/syncing the session is Phase 4.**
- **Output audio routing** (`setSinkId` per output) is **Phase 3**; Phase 1 audio plays on
  the control window's default device.
- A/V fades beyond the master Fade&Stop, crossfades, trims-as-waveform, scopes, keying, OBS,
  Dropbox, transcode-on-upload, Stream Deck, multi-output enumeration — **Phases 2/3/5**.

### Browser limitations encountered / noted (web scope reality, §4)
- **Chromium-first.** Output window, `BroadcastChannel`, and (later) WebHID/Window
  Management/`setSinkId`/WebGPU are best/only in Chrome/Edge. Phase 1 degrades: if
  `BroadcastChannel` is absent the control window still plays its own program preview.
- **Codecs**: only browser-decodable formats play (H.264/VP9/AV1, AAC/MP3/Opus/WAV). ProRes/
  DNxHD/HEVC-with-alpha are **not** decodable in-browser → deferred to the Mac engine; the
  transcode-on-upload step (Phase 5) will normalize arbitrary uploads.
- **Pop-up blocker** can stop the output window — the app toasts a hint to allow pop-ups.

### How to test Phase 1 (before Phase 2)
1. Front page shows the **🦧 Outangutan** card. Click **Standalone** → the Outangutan
   screen builds (cue list / program / clock / inspector / transport / footer). No console
   errors. Back button returns to the front page.
2. **Add media**: drag a video and an audio file onto the cue pane (or “Add media”). Cues
   appear with thumbnail + duration; selecting one shows it in the Inspector and the clock
   shows its duration.
3. **Transport**: `Space` = GO (program plays, clock counts down, status “ON AIR”), `P`
   pause/resume, `S` stop, `F` fade&stop, `Esc` PANIC (instant stop). All work by keyboard.
4. **Continue modes**: set a cue to Auto-follow → the next cue fires when it ends; pre-wait
   shows a countdown before firing.
5. **Output window**: click **Output Window**, drag it to a 2nd display, fullscreen it →
   the program mirrors there; **Identify** shows bars + label.
6. **Crash recovery**: add cues, then reload the page and re-enter Outangutan → the show is
   restored; if you reload mid-playback, the recovery banner offers to standby that cue.
7. **Network**: everything above works with the network off (local-first IndexedDB).
