# Outangutan 🦧 — NOTES

Running log of decisions, tradeoffs, reduced-scope choices, and browser limits.
Newest phase on top.

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
