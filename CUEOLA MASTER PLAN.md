# CUEOLA MASTER PLAN — Production-Readiness Build

**How to use this (for the operator):**
1. Drop this file in the repo root as `CUEOLA_MASTER_PLAN.md`.
2. Save the inspector reference screenshot at `design/reference/inspector-reference.jpeg`.
3. Tell Claude Code: *"Read CUEOLA_MASTER_PLAN.md, create PROGRESS.md, and begin Phase 0. Stop at every phase gate."*
4. Answer the ⚠️ questions when asked. Say **"Proceed to Phase N"** to advance past a gate.
5. If a session ends mid-work, start the next one with: *"Read CUEOLA_MASTER_PLAN.md and PROGRESS.md and resume where we left off."*

Everything below is addressed to Claude Code. This document supersedes all previous prompt files.

---

## 1. Mission and definition of production-ready

You are bringing **Cueola**, a live show-control application, to production quality. In a recent live run (session "AVT Lab"), the app suffered: videos that refused to play, no still-image support, unreliable sync, no pause/resume, a rundown segment that blanked and flashed on-screen while followers went blind, missing keyboard control (the operator needed a second computer), and broken/confusing UI. The person running it was simultaneously rundown op, script op, and on-air reader — the software must carry more of that load.

**Production-ready means all of the following are true:**
1. A full show (rundown + script + playout + connected followers) runs start to finish with zero crashes, blanking, or desync.
2. One operator can drive the entire show from one machine, keyboard-first.
3. Media failures degrade gracefully — operator alerted, show continues. Nothing ever hangs the live view.
4. A preflight check validates the whole show before going live.
5. The UI is consistent, uncluttered, and matches the design reference.
6. State survives trouble: session autosave, follower reconnect, resumable playback.

## 2. Components
- **Cueola** — the application, including the rundown and the script op.
- **Outrangutan** — the media playout engine.
- **Flowmingo** — the follow-along system for others to track the operator. **It currently works well. Never regress it. Verify follower behavior after every phase.**

## 3. Operating rules (apply to every phase)

1. **Phase gates are mandatory.** At the end of each phase: update `PROGRESS.md`, run the smoke test (§4), and post a **Phase Report** — what changed (files, commits), test results, decisions needed, risks spotted. Then **STOP and wait** for my explicit "Proceed to Phase N". Never begin the next phase without it.
2. **Maintain `PROGRESS.md`** at the repo root, updated after every completed task. It contains: phase/task status checklist, a **Decisions Log** (my answers to ⚠️ questions — never re-ask an answered one), deferred items, and known issues. Every new session begins by reading this plan and `PROGRESS.md`.
3. **Reproduce before fixing.** For every bug: confirm current behavior, write a one-to-two-sentence root-cause statement in `PROGRESS.md`, then fix the cause, not the symptom.
4. **Ask, don't guess.** ⚠️ items require my answer before implementation. If a feature or component described here cannot be found in the code, stop and ask — do not build a duplicate in the wrong place.
5. **Scope discipline.** Minimal, well-scoped changes. Propose before executing any refactor that touches core state architecture or more than ~10 files.
6. **Commits:** one commit per task, imperative message prefixed with the phase (e.g., `P2: resume playback from pause offset`). Tag the repo at each passed gate (`phase-2-complete`).
7. **Tests:** where test infrastructure exists, add or extend tests covering every fix. If none exists, flag it in Phase 0 and propose a lightweight harness. At minimum, every phase appends to a manual QA checklist kept in `PROGRESS.md`.

## 4. Smoke test — run at every gate

Recreate the failure conditions of the AVT Lab session: a session with **≥3 rundown segments where segment 3 ("Questions") has active playout**; a media set including 16:9, 4:3, and 9:16 video plus a still image; at least one SFX cue (once Phase 4 is done); **one Flowmingo follower connected**.

**Pass =** advancing start to finish produces: no blanking or flashing anywhere; the follower mirrors the operator the whole way; all media plays correctly fitted; pause → trigger resumes from the pause point; no console errors, no crashes.

---

## Phase 0 — Discovery & architecture audit (read-only)

**Goal:** ground every later phase in how the code actually works. No code changes in this phase.

1. Map the repo: language(s), frameworks, build system, target platform(s) (Electron, native, web?), and exact run/build/debug commands.
2. Locate the four surfaces — rundown, script op, Outrangutan playout, Flowmingo — their modules, entry points, and how they communicate (IPC, WebSocket, shared store, OSC?).
3. Document the **show-state model**: where authoritative state lives, how updates propagate to the operator UI and to followers, and the transport + serialization used for Flowmingo.
4. Document the **media pipeline**: how items are loaded, decoded, and rendered; where any format/dimension validation happens; what the audio path looks like (for SFX later).
5. Inventory test and CI infrastructure; note gaps.
6. Write findings concisely to `docs/ARCHITECTURE.md`. Answer from the code where possible: what the "time up" display represents (elapsed vs remaining), what the "wrap" element is, how many themes exist and how theming is implemented, and how keyboard input is currently handled.
7. Produce a **risk list**: the five things in this codebase most likely to cause a live-show failure.

**Exit criteria:** `ARCHITECTURE.md` written; the questions above answered or explicitly queued; risk list posted. **GATE — stop and report.**

---

## Phase 1 — Branding refresh

**Goal:** the app carries the new artwork everywhere.

1. Locate the **updated SVG in the brand asset folder** (check file dates; ask if multiple candidates).
2. List every place brand artwork is used or derived — app icons, in-app logos, splash/loading screens, exported PNG/ICO sizes, favicons, installer/build assets, docs imagery — and show me the list before replacing anything.
3. Regenerate all derived assets from the new SVG at correct sizes/formats. No hand-edited copies.
4. Produce a fresh build with the new branding live.
5. ⚠️ The memo said "make a new run with the updated svg." I read this as *refresh brand assets and rebuild*. If the codebase has a "run" concept (e.g., a show-run template) that embeds branding, flag it and ask before touching it.

**Exit criteria:** no stale artwork anywhere in app or build outputs; app builds and launches showing the new branding. **GATE.**

---

## Phase 2 — Outrangutan media engine core

**Goal:** any valid media plays, fits, pauses, and resumes; failures are graceful.

1. **Diagnose the video failures.** Do not assume aspect ratio is the cause until confirmed. Check in order: (a) validation/probe logic that rejects mismatched dimensions; (b) codec/container support in the renderer identified in Phase 0 — if Chromium/HTML5-based, check `canPlayType` and known H.264/HEVC gaps; if a native pipeline (ffmpeg/AVFoundation/GStreamer), check demuxer/decoder configuration; (c) renderer assumptions such as fixed-size textures or canvases.
2. **Fit policy:** implement *contain* (letterbox/pillarbox) as the default, computed from probed dimensions vs output, with optional cover/stretch selectable per item. Never distort by default. ⚠️ Confirm the default with me.
3. **Probe media on import:** capture duration, codec, dimensions, aspect ratio; store them on the media item; surface unsupported formats **at import time, not showtime**.
4. **Still images** become first-class playout items (PNG/JPEG minimum; WebP/SVG if the pipeline makes it cheap): cueable from the rundown, same fit policy, hold on screen until advanced. ⚠️ Should stills also support an optional fixed duration?
5. **Pause/resume:** play → pause → next trigger **resumes from the pause offset**, not the top. Persist the playhead offset in show state so it survives a UI reload and syncs to followers. Make play/paused/resumed state clearly visible in the operator UI.
6. **Graceful failure:** an item that fails to load or decode mid-show must not hang the view — fall back to a defined slate (⚠️ black slate vs hold-last-frame: confirm) plus a non-blocking operator alert; the rundown must remain advanceable.
7. **Cue-ahead preload:** preload/prepare the next cued item so triggering is instant. If the pipeline makes this expensive, propose a scoped version before building.

**Exit criteria:** the mixed-aspect test set plus stills all play correctly fitted; pause/resume verified on video; a deliberately broken file degrades gracefully mid-run; smoke test passes. **GATE.**

---

## Phase 3 — Rundown stability & sync hardening

**Goal:** kill the "Questions" segment blanking/flashing bug and make operator↔follower sync trustworthy.

1. **Reproduce the bug:** build a rundown of ≥3 segments with playout active on segment 3. Determine the actual trigger by isolating variables — segment *position* (third), segment *type* ("Questions"), or *concurrent playout*.
2. **Instrument rendering:** log or profile re-renders of the segment view (React DevTools profiler if React; the platform equivalent otherwise). Prime suspects: a state feedback loop (high-frequency playhead updates → rundown re-render → state write → loop), a key collision causing unmount/remount cycles, or timer-driven state updates flooding the render path.
3. Fix the **root cause**. The segment must render stably for the operator and stream to followers for its full duration.
4. **Sync architecture hardening**, using the Phase 0 findings: one authoritative show-state on the operator side; **versioned updates with monotonic sequence numbers** so receivers drop stale packets; **throttle continuous values** (playhead position) to a sane broadcast rate (~4–10 Hz) while discrete cue events broadcast immediately.
5. **Follower resilience:** heartbeat, automatic reconnect, and full-state resync on rejoin. A follower that loses connection shows an explicit "reconnecting" state — never a stale or blank screen.
6. ⚠️ Confirm sync scope: cue/state changes must be exact everywhere; is continuous playhead position required on follower screens, and at what fidelity?

**Exit criteria:** a 30-minute stress run with segment-3 playout shows zero blanking; the follower is never stale for more than ~1 second; a forced disconnect/reconnect recovers cleanly; smoke test passes. **GATE.**

---

## Phase 4 — SFX system

1. **Rundown items can cue SFX** through the same cue flow as other cue types, visible on the rundown item. ⚠️ Confirm firing model: auto-fire when the item goes live, manual trigger, or both.
2. **Latency:** preload and decode SFX into memory (Web Audio API buffers if web-based; the platform's low-latency audio API if native). Target under ~30 ms trigger-to-sound.
3. **Bank renaming:** inline rename following existing UI conventions. Cues must reference banks by **stable ID, not display name**, so renames never break existing cues. Renames persist with the project.
4. SFX fire events flow through the same show-state/sync stream. ⚠️ Should followers see SFX fires indicated?

**Exit criteria:** an SFX cued from a rundown item fires with low latency; a renamed bank keeps its contents and its cue links across an app restart; smoke test passes. **GATE.**

---

## Phase 5 — Single-operator control

**Goal:** the whole show is drivable keyboard-first from one machine.

1. **Keymap engine:** a central shortcut registry with **context scopes** (global / rundown / script op / playout), explicit priority rules when multiple contexts are live, and suppression while focus is in any editable field. Persist the keymap as a user-editable config file (JSON) if the architecture makes it reasonable; otherwise ship strong defaults and document the extension point.
2. **Coverage:** rundown advance and back; script op control (next/previous line or block, jump to top/current position, plus the core script-op actions identified in Phase 0); playout play, pause/resume, and stop.
3. ⚠️ **Propose the complete keymap to me for approval before implementing.** Nothing destructive may sit adjacent to high-frequency keys — this gets used under live pressure.
4. **In-app shortcut reference** (on `?` or a menu item), **generated from the registry** so documentation can never drift from behavior.
5. **Jog-wheel scrubbing:** a continuous scrub control traversing the **entire script and all cues** — not discrete step buttons. Position model = (cue index, time offset). Inputs: pointer drag, scroll wheel, and a hold-key that accelerates movement. Show a position indicator with nearby cue context while scrubbing. Use virtualized rendering if scripts are long. **Scrubbing is local to the operator until committed** — followers see nothing until the operator cues from the chosen point. ⚠️ Confirm the commit interaction.

**Exit criteria:** a full mock show is operated start to finish using only the keyboard on one machine; the shortcut reference matches actual behavior; the scrub traverses the whole script smoothly and cues from an exact point; smoke test passes. **GATE.**

---

## Phase 6 — Control & inspector redesign

**Reference:** `design/reference/inspector-reference.jpeg` — open and study it before writing any UI code. It shows the target language (an iOS Pages-style inspector). The spec below is the fallback if the image is missing.

**Design language:** floating panels over a dimmed backdrop; neutral grays with a **single accent color reserved for active/selected states** (⚠️ keep the reference orange or switch to a Cueola brand color from Phase 1 assets — confirm). Controls grouped in rounded cards (~16–20 px radius), related controls sharing a card with hairline dividers, cards separated by clear gaps, a muted section label above. A prominent primary-context pill pinned at top. Row pattern: label left, muted current value right, `>` chevron for drill-in. Segmented icon rows for option sets, active item as a filled accent pill. Numeric values as a pill plus a **− / + stepper**. Booleans as toggles. Colors as inline swatches. Overflow behind "…" or a full-width "More Options" row — progressive disclosure keeps the top level clean. Simple line glyphs, generous padding, large hit targets.

**Adaptation rules:** this is a touch-first pattern — adapt density for desktop while keeping the card grouping, row patterns, and accent-active behavior. **Live-critical controls are never buried behind drill-ins**; progressive disclosure is for setup, not live actions. Every control stays keyboard-reachable per the Phase 5 keymap. Build **shared components + design tokens** (card, row, segmented control, stepper, toggle, swatch) used by both Cueola and Outrangutan — the rebuild on shared components *is* the fix for the current broken/inconsistent styling.

1. Inventory all inspectors, tool windows, theme windows, and control panels across Cueola and Outrangutan. Propose a card/row layout for each — **show me before implementing**.
2. Rebuild them on the shared components. Where a control's *behavior* (not just styling) is broken, fix that too and note it.
3. **Theme picker:** in the script op, the 9 themes as a **3×3 grid** of visual previews, current theme marked with the accent state.
4. **Script op button audit:** flag redundant, non-functional, or unclear buttons with reasoning. ⚠️ I approve every removal; ambiguous items stay.
5. **Replace "bigger/smaller"** with a clearly labeled − / + stepper (the Size-row pattern) scaling the on-screen readouts: the **time-up display**, the **chat questions**, and the **wrap** indicator. ⚠️ Confirm: one global stepper vs a drill-in with per-element steppers; and report what "time up" and "wrap" actually are per the Phase 0 findings before wiring.
6. **Click-outside-to-close** for all tool/inspector/theme windows via **one shared dismissal utility**, project-wide. Exception: panels with unsaved edits must not silently discard — persist or prompt. ⚠️ Flag any window where auto-close seems risky.

**Exit criteria:** rebuilt panels visibly match the reference language and run on the shared token set; theme grid, stepper, and dismissal verified; every live-critical action remains one keystroke/click away; before/after screenshots captured; smoke test passes. **GATE.**

---

## Phase 7 — Production hardening

**Goal:** the "no embarrassment in front of an audience" layer.

1. **Show preflight:** a single command/panel run before going live that validates: every rundown media reference exists on disk and probes as decodable with known dimensions; all SFX banks load; the Flowmingo link passes a round-trip test; theme assets present. Output a pass/fail list with jump-to-item links.
2. **Error containment:** a global error boundary / crash guard around the live surfaces — an exception in one panel logs and recovers without taking down the show UI.
3. **Session autosave + crash recovery:** the app reopens to its last state after a crash or force-quit. ⚠️ Confirm autosave cadence and recovery UX.
4. **Structured show log:** per-session, timestamped record of cue fires, media events, sync events, and errors — so any future live problem is diagnosable afterward. (Every issue from the AVT Lab run would have been visible in such a log.)
5. **Performance pass:** profile the live view during playout — no dropped frames, no runaway re-renders, stable memory across a 60-minute run.
6. **Edge-case sweep:** missing media file at cue time, follower joining mid-show, rapid double-triggers, advancing while media is paused, empty SFX bank, scrubbing during playout.

**Exit criteria:** preflight catches a deliberately planted broken file; a forced in-panel exception recovers without killing the live view; a 60-minute soak run is clean; smoke test passes. **GATE.**

---

## Phase 8 — Dress rehearsal & release

1. Write `docs/REHEARSAL_CHECKLIST.md`: a scripted end-to-end dress rehearsal reproducing the AVT Lab show — setup, preflight, full run with a live follower, SFX fires, pause/resume mid-video, a deliberate scrub-and-recover, and one intentional failure drill (pull a media file) to confirm graceful degradation.
2. I run the rehearsal and report issues; you triage into a punch list (P0 blocks release, P1 fix now, P2 defer) and fix P0/P1.
3. **Operator docs:** a one-page shortcut card generated from the keymap, plus a 10-line "going live" checklist.
4. **Release:** version bump, `CHANGELOG.md` summarizing all phases, final tagged build.

**Exit criteria:** punch list shows zero P0/P1; tagged release build produced; operator docs delivered. **DONE — production ready.**

---

## Appendix — Consolidated ⚠️ decisions you will ask me for

| Phase | Decision needed |
|---|---|
| 1 | Meaning of "make a new run" if a run/template concept exists |
| 2 | Default fit policy (contain recommended); stills with fixed duration?; failure slate: black vs hold-last-frame |
| 3 | Sync scope: continuous playhead on followers, and at what fidelity |
| 4 | SFX firing model (auto/manual/both); do followers see SFX fires |
| 5 | Full keymap approval; scrub commit interaction |
| 6 | Accent color (orange vs brand); button removals; global vs per-element size stepper; "time up"/"wrap" semantics |
| 7 | Autosave cadence and crash-recovery UX |

Record every answer in the `PROGRESS.md` Decisions Log.
