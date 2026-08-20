# September Show Update Plan

Intake date: 2026-08-20, debrief after the August podcast (the show went well: director on rundown, prompter live, lighting cues followed, playout running, two Stream Decks in use).

Owner's show rig, for reference in every fix below:

- MacBook Pro: rundown + script op on the attached widescreen; OBS + KeyWi Bird on the built-in display. Two Stream Decks connected (one large "control everything" deck, one director deck).
- MacBook Air (separate machine): Outrangutan, with the playout output on its attached display.
- Prompter and playout outputs go to small (~10 inch) desk displays.
- Cross-machine state rides Firestore only.

## Priorities

- P0: Flowmingo prompter rebuild (traditional scroll model, scrub, punch-in, cue anchors). Owner: "all of that really needs to happen immediately."
- P0: READY / TRACK / ROLL / TAKE auto-flow (no per-item Roll Now press).
- P0: Cross-machine playout preflight all-clear + stability (no false reconnect warnings).
- P1: Control grant actually lets a student run the rundown.
- P1: Stream Deck truth: live rundown/cue time key, playout state on the LCD strip, playout audio dial, panic from the top, prompter scrub knob.
- P1: PB preview export matches the real export.
- P2: Script Op visual parity (built-in vs pop-out), idle-proofing confidence.
- P2: Workspace launcher: one click opens/places the windows for this machine's role.
- P2: Playout fun feature: instant live SFX recording.
- P2: Dashboard/PB instructional UI overhaul (chips → organized, student-facing explanations, demos of READY/TRACK/ROLL/TAKE, prune redundant features).

## A. Flowmingo prompter rebuild (P0)

Symptoms from the show:

1. Cue-by-cue "glide and catch up" model makes punch-ins unfindable: operator pushes text from the Stream Deck Edit key, it lands somewhere, nobody can see where.
2. Long stretches of blank prompter during the show; hard to know where the prompter is.
3. The sync/catch-up button snapped the prompter back to an earlier cue AND moved the rundown selection backwards, losing the operator's place in the rundown.
4. No scrub. Owner wants a Stream Deck knob assigned to free forward/backward scrubbing over the whole script.
5. Students type into label fields; labels do not render on the prompter, so their segments come out blank.

Target model (owner's words, translated): a traditional prompter. One continuous scrolling script surface. Rundown script cues are anchors inside that scroll, not the unit of navigation. Live punch-ins insert visibly at the current position. The Stream Deck is the primary controller (scroll speed, scrub knob, punch-in). Rundown movement can pull the prompter to an anchor, but prompter navigation must never move the rundown.

Root causes (investigated 2026-08-20):

Good news first: the talent scroll engine is ALREADY a continuous pixel offset with an eased glide (`ptOffset`, `ptScrollLoop`, `ptGlideToOffset`, cueola-app.js:13278/13651/14062). The "cue by cue" feel comes from how anchors, position state, and cue commands are wired around it. The rebuild is rewiring, not a new engine.

1. Blank screens (b) have three causes: (i) rows whose script cue has no `text`/`dialogueNote` are DROPPED from the assembled script entirely (filter at cueola-app.js:10304 via `scriptCueText` :7087, which reads only those two fields), so label-only rows produce no header, no anchor, no copy; (ii) `#pt-track` pads a full viewport top and bottom (index.html:2599) so every reset lands on an empty screen; (iii) cueing to a dropped row is a silent no-op (`ptSeekToRow` returns false at :14160) while the hold boundary still advances, so the talent free-runs into blank track.
2. Students-type-labels (e): in free-text mode the FIRST and LARGEST field in the cue panel is "Script Cue" (`d.on`, index :7838, builder :7398-7422) with "Script Copy" underneath. Students fill the top field; the assembler never reads `d.on`, `b.info`, or `b.notes`. And `preLiveCheck` (:9426) counts only rows that pass the same filter, so "3 of 24 rows have script" still reports a pass. This is a UI trap, not just a training gap.
3. Punch-in unfindable (a): `saveLiveScript` (:11117) writes the row, reassembles, pushes, closes the overlay, and never sends a seek or highlight to the insert point. The Edit deck key also targets `lsIdx` (selected row, :6286) while the pop-out targets the ACTIVE row (:12574): two surfaces, two different rows. And the talent's position is rescaled proportionally on script replace (:14852), so an insert slides the talent off the line they were reading.
4. Snap-back (c): "Cue Now" and every advance seek to `liveActiveCueIndex()` (the SHARED active cue), and on a non-caller surface advances don't move the shared cue, so cueing yanks the prompter back to the stale shared row; simultaneously the Firestore follow adoption (:5770-5775) pulls the local rundown selection back. Also "Recover Flowmingo" re-seeds the talent from the operator window's stale pixel offset (seed scope keeps `state.position`, :11559), where the operator's hidden track makes positions meaningless.
5. No scrub (d): every seek verb is an absolute 0-100 integer percent of pixel height (one step is ~12s of read on a long script); there is no relative seek verb at all, so a knob can't be a knob. The deck's `prompterScrub` dial exists but sends 0..1 into the 0..100 API (covers 1% of the script) and never seeds from the live position. The jog overlay maps CHARACTER offsets to pixel percents, so "cue here" lands elsewhere.

Rebuild design (traditional prompter model):

1. Real anchors: emit `<span data-row-key>` anchor elements during assembly instead of regex-parsed `[N]` headers; seeks, holds, and hold recalc query anchors. Anchors survive mid-show row inserts.
2. Emit every row: assembler includes all non-segment rows, with fallback copy `text -> dialogueNote -> on -> info -> notes`, fallback rendered as dimmed non-read copy so nothing is ever blank and every row is seekable.
3. Position becomes `{anchorKey, offsetWithinAnchor}` instead of raw pixels in the shared state (cueola-prompter-session.js:53). This single change kills punch-in drift, recovery snap-back, and the operator's always-zero progress (hidden track has scrollHeight 0).
4. Relative seek verbs: `seek_by_<lines/px>` added to the control grammar + allowlist, so the deck knob scrubs incrementally, seeded from the talent's reported position. Fix the 0..1 vs 0..100 dial bug either way.
5. Punch-in carries its destination: after push, seek/highlight the edited block on the talent AND scroll the desk editor to it; unify Edit-key targeting (active row) across surfaces; insert marker renders dimmed.
6. Split "cue the prompter" from the shared active cue: prompter cue commands use the operator's own intent row and NEVER move the rundown selection; the follow adoption stops moving a driving operator's selection.
7. Operator gets a real scrolling mirror of the talent view (the current op views render the script with no transform ever applied), with the read line drawn, so "where is the prompter" is answerable at a glance.

## B. Playout: READY / TRACK / ROLL / TAKE auto-flow (P0)

Symptom: rundown-triggered playout worked, but each item needed a manual Roll Now press and presented a roll-or-abort choice. Desired: reaching the pre-run cue puts the track up automatically (READY), then TRACK, ROLL, TAKE tick through on their own; that cadence IS the abort window. Abort is a button you can hit during the count; doing nothing means it plays. No mandatory confirm.

Also: the countdown ("count out") visible through the rundown was singled out as excellent. Keep it exactly as is and feed it from the new auto-flow.

Root cause (investigated 2026-08-20): the auto-roll already exists and is the default. `RTRT_STAGES = ['ready','track','roll']` with a 1s cadence and auto-TAKE (cueola-app.js:8939-9060, timer at :9004, auto-take at :9011); abort is bound to S, the banner button, and the bus. Two things defeat it:

1. Sticky per-device "Manual TAKE" flag: `localStorage.cueola_rtrt_manual` (cueola-app.js:8950). When set, the timer never starts and the banner parks at READY showing TAKE/ABORT. That IS the reported "roll now for each item, plus roll-or-abort." The checkbox lives at cueola-app.js:14372, and docs/PRESHOW_FIX_PLAN_STATUS.md:162 already flagged that a per-device flag silently reverts on a machine swap. Likely simply left on for the show.
2. Rows only auto-call when `outAuto && outCueId` (cueola-app.js:9212). A row with a linked cue but the "Run the playback call" checkbox unchecked gets no call at all, only arming, and then needs the per-row GO.

Fix: mirror the manual-arm flag to the session doc (visible, not per-device), surface its state loudly in the call banner, and make the row editor make the auto-call state obvious (or default `outAuto` on when a cue is linked). Keep the countdown rendering untouched; the owner loves it.

## C. Cross-machine playout preflight + stability (P0)

Symptoms:

1. With Outrangutan on the MacBook Air, the preflight never gives the all-clear that playout is working, even while triggers work fine.
2. Repeated "reconnect" warnings during the show. Owner's word for the requirement: stability.
3. Panic (kill playout) works inside Outrangutan but was hard to trigger from the top (main machine / deck).
4. Playout audio shows "idle" in the main app; no fader/meter movement; no way to ride playout volume from the deck.

Root causes (investigated 2026-08-20):

1. Local-instance shadowing. index.html loads outrangutan/outrangutan.js into the main app page, so the rundown machine ALWAYS has a live, empty, standalone `window.Outrangutan`. Every status/preflight probe hits it local-first: cueola-app.js:8378 `window.Outrangutan?.outputStatus?.() || og?.live?.outputs` never falls through because the local `outputStatus()` always returns a truthy `{status:'closed'...}`. Result: remote playing + local closed = `status='disconnected'` ("Media is active but no playback output is connected") = the red PLAYOUT chip and "Recover Playback" rail, firing precisely when playout is working. Preflight rows (:9551, :9556, :9572, :9627, :9646) all read the same empty local instance, so cross-machine never all-clears. The COMMAND path already has the correct guard (`local.session() === session.code`, cueola-app.js:8772); the status/preflight probes just never got it. Fix seam: apply that guard to every probe, make `og.live.outputs` authoritative with a `live.ts` freshness window.
2. No idle heartbeat. Outrangutan's `publishLive` only ticks while the play RAF runs (outrangutan.js:3279); when idle it publishes nothing, and the main app never checks `live.ts` freshness. Add a ~2s idle publish or an explicit heartbeat field, then a dead remote is detectable and a healthy idle one stops looking dead.
3. Panic from the top: the wire works (`fireOutrangutanCommand('panic')` -> outrangutan.js:2336) but there is NO panic button anywhere in the main app UI (zero hits in index.html), the keyboard chord is Shift+Escape scoped to the Live screen only, it's gated by `liveCommandDispatchAllowed`, and `runControlBusAction` has no `playout` target so panic cannot ride the control bus. The Stream Deck path (km:playout.panic) is actually the most reliable today since the bridge skips the dispatch gate. Fix: visible Live-bar panic button, ungate it, add `playout` to the control bus.
4. Audio: Outrangutan has full metering locally (AnalyserNodes, outrangutan.js:243-278) but never publishes levels or gain; the deck's PLBK vol dial calls `window.Outrangutan.setMasterGain()` which on the rundown machine is the silent LOCAL instance, so the dial moves nothing on the Air. Fix: publish throttled `outrangutan.levels` + `masterGain` alongside `live`, and route `setMasterGain` through `outrangutan.command` as a new verb (outrangutan.js:2332), same pattern as the talkbackd-fed Micochondria meters.
5. Command single-slot race: `outrangutan.command` is one field with dedupe + 30s staleness; a panic can be overwritten by a following write before the remote snapshot lands. Consider a command queue or at least panic priority.

## D. Control grant (P1)

Symptom: admin assigns a student control of the rundown; the student's Go button never illuminates and pressing it warns. Grant feature exists (badge picker, username identity) but does not actually confer the ability to advance the rundown.

Root causes (investigated 2026-08-20, ranked):

1. Identity source mismatch. The grant picker writes `controlGrant.username` from presence, which carries `session.username` (persisted in localStorage, survives resume). But `sessionControlGrantHeldByMe()` (cueola-app.js:390) compares against `CueolaIdentity.profile()?.username`, an in-memory page-lifetime cache that is only populated by sign-in / join-modal / front-door render and is NEVER rehydrated on boot. On resume-after-reload, dashboard launch, or `?code=` deep link (exactly the mid-show paths), `profile()` is null, so the granted student never matches: `hasControlGrant:false` -> not caller -> Go disabled with the ":10810" tooltip naming the student themself as the holder. Fix: match against `session.username` (what the picker actually wrote) or `CueolaIdentity.identity()?.username` (localStorage-backed), with `profile()` only as fallback. Same fix needed at :5767 (follower routing).
2. No recompute after adoption: `adoptControlGrant` early-returns on unchanged grant (:398), and the `cueola-identity-change` listener never re-evaluates the grant or `updateLiveGoControl()`. If the profile loads after the grant snapshot, the button stays dark until an unrelated re-render. Classic show-day intermittent; revoke-and-regrant "fixes" it.
3. Side effect worth knowing: while a grant is outstanding, `grantHeldElsewhere` demotes the ADMIN to follower too, so under this bug nobody is the show caller: whole-show stall, matching the report. Take-back from the caller badge always works (admin-gated, not caller-gated); that is the in-show recovery.
4. Rules are NOT the cause: authed students can write everything Go writes (no field allowlist on the session doc). Note in passing: a student could technically write `controlGrant` themselves; accepted trust level, but log it in the security backlog.
5. Test gap that let this ship: the only test injects `hasControlGrant:true` straight into the pure resolver; the identity plumbing between the doc field and that boolean is untested. Add a test that walks the real path (grant doc -> adopt -> heldByMe with a null profile()).

## E. Stream Deck truth (P1)

The owner watches seven screens plus the deck; every key that tells the truth is one fewer glance. Items:

1. Rundown cue time / show time key does not update live on the hardware deck, and its face needs a better design.
2. Show real playout state on the deck (which track is up, time remaining), ideally on the LCD strip of the big deck.
3. Playout audio dial: ride playout volume from a knob.
4. Prompter scrub knob (ties into section A).
5. Panic reachable from the deck across machines (ties into section C).

Root causes (investigated 2026-08-20):

1. Stale time key, primary cause: repaints ride two setIntervals (5 Hz paintTick, 7.7 Hz animateKeys, cueola-streamdeck.js:1698/1803) that Chrome throttles to 1/min after ~5 minutes in a background tab. During a show the Cueola tab IS backgrounded (operator is on OBS etc.), so the clock key freezes while presses still work (HID input isn't throttled; the input path was already patched to paint from the event at :1016-1019, the state path never was). Fix: Worker-based steady timer (the exact `createSteadyInterval` pattern already in cueola-script-operator-protocol.js:796) for the paint loop.
2. Dead push seam: `notifyControlSurfaceState()` (cueola-app.js:6490) fires a `cueola-surface-state` event from 13 call sites; cueola-streamdeck.js never subscribes. Adding the listener gives instant clock start/pause/state repaints.
3. Freeze-everything bug: `paintChangedPass` awaits each key write with no catch (cueola-streamdeck.js:1766, `drawKeyInto` outside the inner try at :1739). One key whose art throws (custom image, GIF frame) permanently freezes every higher-indexed key; on the +XL default layout the clock is index 13. Highest-confidence hard bug; wrap per-key.
4. There is NO rundown-time key type at all. The bridge already publishes `liveRowInfo` (current/next row, cueola-app.js:6464) with a comment saying the deck's next-cue key reads it; grep shows the consumer was never written. Build the rundown-row/cue-time key on it.
5. "Needs to look better": the clock keycap branch (cueola-streamdeck.js:1603-1608) is bare: non-tabular digits that jitter, no remaining/over-under, no label, and it's excluded from the icon/progress path. Redesign with tabular figures, remaining vs total, progress ring.
6. Scrub knob: a `prompterScrub` dial controller already exists and is in the +XL defaults, but `jogTick` (cueola-streamdeck.js:406) clamps to 0..1 and sends `seek_set_0.00..1.00` into an API that expects 0..100, so the dial's full travel covers 1% of the script, and it never seeds from the real prompter position (first tick teleports talent to the top). Fix: seed from `prompterStripInfo().pct`, step relatively in percent, clamp 0-100.
7. Playout on the strip: `ogProgram` strip zone ALREADY renders a playout monitor (cueola-streamdeck.js:2186; real video frames same-origin, else a PLAYBACK card with cue name/remaining/progress), it's just not in the default dial set. Promote it, and fix its data source: it reads the ~1 Hz Firestore `live.remaining` instead of the app's locally-reckoned `playoutNow()` (cueola-app.js:8472), which isn't on the bridge. Expose `playoutNow` on the bridge; add `pre` and loop states to the strip renderer.
8. Secondary deck: `animateKeys` only serves the active deck, so the director deck's clock never pulses and animates nothing. Extend the anim pass to secondary decks.

## F. Planda Bear preview export mismatch (P1)

Symptom: the preview export shows different information than the actual exported file. Which paperwork type diverged was not specified; audit the pipeline for all of them.

Root causes (investigated 2026-08-20): the renderers and paginator ARE shared between preview and export; every divergence is upstream in what data each path feeds them. Six confirmed seams, ranked:

1. Grouped workspaces read the wrong doc. `preProDocRef()` (cueola-app.js:16898) parameterizes all paperwork reads/writes to the group doc, but the export snapshot reader (`readServerPaperworkSnapshot`, :21734) hardcodes the ungrouped session doc. With a group active: exports show whole-class paperwork under the group's page header, and the PDF package filters class sheets by group-computed ids, matches nothing, and silently prints one wrong call sheet (:25467 vs :25559). The fingerprint carries the group id but the read path was never parameterized.
2. Three per-item previews bypass the snapshot entirely: safety plan (:24981), production schedule (:25210), patch sheets (:25442) preview from live DOM/local state while the package exports them from the server snapshot. Preview shows what you just typed; the PDF shows what the server has. Their "UNVERIFIED PREVIEW" label is computed then discarded by the de-branded page renderer (:25628 vs :25698), so no signal reaches the user.
3. Call sheet index guard drops the fingerprint check (:26548): with the preview modal open and a stale fingerprint, a fresh snapshot with a re-sanitized/reordered sheet list gets indexed by the OLD index, exporting a different sheet than previewed. Relabeling a sheet re-ids/reorders the array, so this is reachable in normal use. Plus a latent null crash when a bare per-item preview is open (`previewIsOpen` true via undefined===undefined).
4. Mixed snapshot/live in one renderer: `callSheetPreviewHTML(data, prePro = loadPreProData())` (:24852): sheet body from frozen snapshot, hospital row + day-of-days re-read live at export time. Same pattern in stagePlotPreviewHTML (:24010, live `show.name` vs snapshot production name).
5. Package stage plot: export swaps SVG for cached 2x PNG; raster prep failures are swallowed by bare catches (:21918, :24176) so export silently falls back to different-looking SVG. Package also passes no layers argument, ignoring the user's layer selection that the standalone export honors.
6. Assignment hydration (:21668, :4164) can mutate assignments/revision between preview and export, changing the register and defeating the preview-reuse guard.

Fix order: (1) route the snapshot reader through `preProDocRef()`; (2) make the three bypass previews snapshot-fed; (3) restore the fingerprint term in the index guard; (4) thread snapshot prePro into the renderers' second argument; (5) surface raster failure; (6) settle hydration before snapshotting.

## G. Script Op parity and idle-proofing (P2)

1. Built-in Script Op, the pop-out, and "the thing" should look identical; some controls/buttons at the top are warped.
2. Owner is "scared things are going idle": confirm the heartbeat/self-heal round actually covers the show-length case, close the known main-window-reload-orphans-popout hole, and surface liveness so the fear goes away (a visible "connected, n seconds ago" truth chip beats silent correctness).

Findings (investigated 2026-08-20):

The "warped" look has two exact causes, both in the built-in drawer:

1. Compounding zoom. `index.html:707` applies `zoom:var(--live-zoom,1)` to both `.ls-sidebar` and `.prompt-op-panel`, and only the Transport pane (cueola-app.js:13820) and Display & Theme pane (cueola-app.js:13859) are wrapped in `.prompt-op-panel`, which sits inside `.ls-sidebar`. So at 150% text zoom those two panes render at 2.25x while the tabs and the Cue/Clocks panes render at 1.5x. Exactly "some of the controllers and some of the buttons are warped." Fix: exclude `.prompt-op-panel` when nested, or zoom one flat wrapper like the pop-out does (`script-operator.css:216`).
2. Squashed circles. `.ls-popout-btn` is a 34x34 circle (index.html:3393), but index.html:4513 forces `min-height:44px;height:44px` on it, so the four top-right header buttons (A-, A+, pop-out, close) render as 34x44 ovals.

Deeper truth: the built-in drawer and the pop-out are two separate design systems (`.insp-tab`/`.pt-btn` vs `.inspector-tab`/`.control-button`); only the arrange/favorites engine is shared (cueola-scriptop-prefs.js:49 bridges the selectors). Full parity means unifying the control markup/CSS, not spot fixes. Also small drifts: active-tab fill 18% vs 26%, sticky offsets, pane key naming (`clock` vs `clocks`), and the drawer shows 4 tabs while `OP_INSP_LABELS` has 5.

Idle-proofing state: worker heartbeats (createSteadyInterval, cueola-script-operator-protocol.js:796), host STATE self-heal (cueola-app.js:12690), operator auto-resync (script-operator.js:271), and wake resync all exist. The remaining hole is confirmed: reloading the main window (a) closes the pop-out via the `pagehide` handler at cueola-app.js:12804, and (b) even if it survived, `FLOWMINGO_ENDPOINT_ID` is a fresh UUID per load (cueola-app.js:695) and the BroadcastChannel name + accepts() filter are derived from it, so a reloaded host can never re-reach the old pop-out. Fix: persist the controller id in sessionStorage across reloads (and stop closing the pop-out on pagehide when a reload is detected), or add a re-hello on a session-scoped channel.

## G2. Multi-display "window goes silent" (fold into C/H stability work)

- The one auto-recovery that exists (cueola-app.js:626) resyncs an open-but-silent talent window exactly once per transition into lost, with no retry.
- No display-topology listeners anywhere (`screenschange` never used); screen lists are one-shot snapshots (cueola-app.js:13052, outrangutan/outrangutan.js:1173), so unplug/replug or resolution changes silently invalidate saved placements.
- No programmatic re-place (zero moveTo/resizeTo in cueola-app.js) and no auto-reopen; close-and-reopen is the only remedy, which is literally the "re-send the screen" ritual.
- Saved talent screen is an index into an in-memory list that is null on fresh load: unless the operator presses "Detect displays" again before launching, the talent window opens unplaced (cueola-app.js:13062). Likely a real source of daily pain.
- Outrangutan fullscreens its placed output (outrangutan.js:1105); the Flowmingo talent window does not (cueola-app.js:13096).

Fix direction: listen to `screenschange`, persist stable screen identity (label + geometry, not index), retry silent-window recovery on a backoff, auto-reopen closed outputs with the saved placement, and fullscreen the talent window after placement.

## H. Workspace launcher (P2, owner calls it "a side little thing")

Wish: from the admin login, one click per machine role: open the rundown on this display, KeyWi setup there, feed the prompter from here, playout window placed on its output display. Choose which windows open and close. Reduce window-management load during setup.

Note: a front-door Show setup launcher with per-app URLs and display targeting already exists from the 8/19 round; this item is likely "extend and harden" rather than "build new". Also fold in the multi-display dropout: output windows sometimes go silent and must be re-sent to their display; add a watchdog/re-place path (see G2).

Findings (investigated 2026-08-20): the launcher (`openWorkspaceLauncher`, cueola-app.js:13121; modal index.html:6420) already does session pick, rundown-in-this-tab, Flowmingo talent window, PB tab via ?prepro=1, and deferred Script Op auto-open, with `getScreenDetails()` display targeting. Gaps vs the wish:

1. Only ONE window is display-targetable (the talent window; `TALENT_SCREEN_KEY` is a single scalar). No per-window screen picker.
2. No playout checkbox at all, even though Outrangutan has its own per-output screen placement + auto-fullscreen (outrangutan.js:1085-1111) the launcher never touches.
3. No KeyWi checkbox, and KeyWi cannot be a window today (`openControlSurface` opens in-page only). "KeyWi setup on that display" needs a windowed KeyWi mode first.
4. No close/teardown control; the only teardown is the blunt pagehide handler.
5. The saved talent screen is an INDEX into an in-memory screen list that is null on fresh load: unless "Detect displays" is pressed again before launching, the talent window opens unplaced. Persist stable screen identity (label + geometry) and auto-detect on modal open.
6. No layout presets. Target: per-machine role presets ("Rundown machine", "Playout machine") remembering which windows open where.

## I. Live SFX recording in playout (P2, fun feature)

Owner: "something really quick, really stupid, I can record sound effects live." One-button record in Outrangutan: capture mic input, trim is optional, lands immediately on a pad ready to fire.

## J. Instructional / dashboard UI overhaul (P2, sweep)

1. The chip smatter across the dashboard and PB guidance areas needs organization and more context about what is happening.
2. This is a teaching product: features like READY/TRACK/ROLL/TAKE need student-facing explanation and a demo mode ("this is what's going to happen").
3. Prune redundant features wherever found. Tight over broad.
4. Script building: students wrote content into labels and got blank prompter output. Beyond the section A fix, the builder should teach the difference (affordance in the editor, not just a lesson page).

## Recommended build order

Round 1, correctness — BUILT 2026-08-20 (uncommitted, WORKER_SCHEMA 39 -> 40, all 19 test suites green, boot + CSS geometry browser-verified):

1. DONE Playout status shadowing guard (C.1): new `playoutIsRemote()` + `remotePlayoutFresh()` gate every status probe; preflight grew a "Playout machine" row (waits up to 5s for a fresh heartbeat) and skips the local-only rows when remote; armed-meta cleared for remote so the chip can't show a stale NOT ARMED.
2. DONE Idle heartbeat (C.2): Outrangutan publishes `live` every 3s while idle via a Worker-backed interval (throttle-proof), started/stopped with the session subscription.
3. DONE RTRT manual flag (B.1): `rtrtManual` mirrored on the session doc (localStorage is fallback + seed), cross-machine flips toast, and a parked manual call banner now reads "READY · MANUAL" instead of hanging at READY. NOT done: row `outAuto` visibility (B.2) - Round 3.
4. DONE Control grant (D.1, D.2): `myControlUsername()` matches session.username -> identity() -> profile(); `cueola-identity-change` now re-runs the held transition via `refreshControlGrantHeld()`.
5. DONE Deck paint (E.1-E.3, E.6): Worker-backed steadyInterval for paint + anim loops, per-key try/catch containment (one bad key can't freeze the rest), `cueola-surface-state` listener wired to paintNow, scrub dial fixed to 0-100 percent with live-position re-seed (fresh gesture after 1.5s idle picks up from the talent's reported pct; bridge now exposes `positionPct`).
6. DONE PB export (F.1, F.3, F.4): server snapshot reader reads the group subdoc's prePro when a group is active (revision fence included); call-sheet export index rides the same fingerprint guard as the snapshot (plus the null-crash on bare previews); call-sheet preview AND export both pass snapshot prePro so hospital/day-of-days can't diverge. NOT done: F.2 (three bypass previews), F.5 (raster failure surfacing), F.6 (hydration settle) - next round.
7. DONE Script Op warped controls (G.1, G.2): nested `.prompt-op-panel` zoom reset to 1 inside `.ls-sidebar` (kills zoom-squared); `.ls-popout-btn` removed from the 44px height override, coarse-pointer gets a full 44x44 circle instead.

Deploy note: every open Cueola window on every machine must be reloaded after deploy (schema 40 forces it on next visit); the playout Air needs its Outrangutan reloaded to start the idle heartbeat, or preflight will read it as "not reporting."

Round 2, the prompter rebuild — BUILT 2026-08-20 (same uncommitted batch, schema 40, suites green, talent-screen behavior browser-verified in a live ?prompter=1 tab):

1. DONE Emit every row (A.2): assembler includes every non-segment, non-cut row; rows without copy carry their Script Cue label or notes as dimmed [bracket] guidance, so nothing is blank and every row is a seekable anchor. Cut (disabled) rows now stay OFF the prompter. preLiveCheck reports "N of M rows have script copy · the rest show dimmed label guidance".
2. DONE Reset lands on content: T/reset/rewind/new-script now put the FIRST line on the read line instead of showing a viewport of lead-in padding (verified: first line top == readY).
3. DONE Anchor-preserving re-layout (A.1+A.3, implemented talent-side): live pushes capture the line under the read line (row block + line index) and restore it after re-render; in-flight glides shift with it. Verified: punch-in above the read position kept the same line on the read line (offset auto-corrected 5200 -> 5643). Proportional rescale remains only as the fallback for scripts with no row headers. NOTE: the deeper protocol change (position as {anchorKey, offset} in shared state) was NOT needed for the reported failures and was skipped to keep the wire format compatible.
4. DONE Relative scrub (A.4): new `seek_line_<±n>` verb (validated ±200) moves ± lines from wherever the talent is; the deck knob sends coalesced detents (2 lines each, ~120ms batching so a fast spin is one session-doc write); nudge buttons (keyboard , . / built-in / pop-out / flowop) all converted from absolute-percent to seek_line; the jog overlay opens at the talent's real position and commits row-accurate `seek_row` instead of char-percent math.
5. DONE Punch-in destination (A.5): saveLiveScript scrolls the desk editor to the edited row and toasts "row N (name)"; the keyboard/deck EDIT key now targets the ON AIR row like the pop-out (they used to edit two different rows); the talent needs no seek because of item 3.
6. DONE (mostly via Round 1) Cue/rundown split (A.6): investigation traced the show's rundown snap-back to the control-grant stall (nobody was caller, active cue froze, cueing went to the stale row, and the admin was demoted to follower); fixed by the grant repair. Follow adoption is correct by role. Edit-key targeting unified.
7. DONE Operator mirror (A.7): the Flowmingo Op overlay's script view now tracks the talent's reported position against the read line (smooth ~1s glide); the pop-out seek slider and the jog overlay read the talent's percent instead of the hidden local track's constant 0.

Still open from the A design (fold into Round 4 polish): builder affordance teaching Script Cue vs Script Copy, and a visible transient highlight on punched-in text.

Round 3, deck truth + cross-machine control — BUILT 2026-08-20 (same uncommitted batch, schema 40, suites green, boot verified):

1. DONE Rundown info key: new `info.rundown` display-only key (Cueola group in the key picker): ROW n/total, current row name auto-fitted, running show clock in monospace digits, NEXT row line, red running dot. First consumer of the bridge's `liveRowInfo`. Pressing it does nothing by design.
2. DONE Clock keycap: monospace digits (no more per-second jitter).
3. DONE Playback on the LCD strip: bridge exposes `playoutNow()` and the deck's `s.playout` now derives from it (smooth locally-reckoned remaining incl. loops/pre-wait, not the stepping ~1Hz packet); the ogProgram strip zone renders PRE (amber), PAUSED tag, and loop (infinity) states; strip decks get the Playback view zone by default (replaces the master dial: its turn IS playback volume). Existing saved layouts unchanged; assign "Playback view" to a dial to get it.
4. DONE Playback volume cross-machine: `outrangutan.gain` doc field (own slot: a volume turn can never clobber an unconsumed cue-fire command), trailing-throttled writes, dedupe + stale guard on the playout machine, gain echoed in every live packet so the dial/readout shows the real fader; bridge masterGain/setMasterGain route local vs remote with a 4s optimistic echo.
5. DONE Panic from the top: a red PANIC button ON the Live playout strip (hover fills red), the panic path bypasses the lifecycle dispatch gate (the deck bridge already did), keyboard Shift+Esc unchanged.
6. DONE Pop-out reload survival: controller id persisted in sessionStorage (channel + accepts() derive from it), pagehide no longer closes the pop-out or tells it to give up, the host self-resumes after reload once the session doc's prompter identity is adopted, and the pop-out keeps knocking (READY every ~6s while disconnected) so the two sides can no longer deadlock. A genuinely closed Live tab still reports via opener-closed detection.

NOT in this round (moved to Round 4): display-topology watchdog + launcher presets/per-window screens, row `outAuto` visibility, PB F.2/F.5/F.6, live SFX recording, teaching UI sweep, punch-in highlight, builder Script Cue affordance.

Round 4 — BUILT 2026-08-20 (same uncommitted batch, schema 40, suites green, boot + UI browser-verified) except the dashboard reorganization, which is scoped below for an owner design pass:

1. DONE Live SFX recording (I): a REC button on Outrangutan's SFX bank bar. Press: records the mic raw (no echo cancel), button pulses red with the take length. Press again: the take lands on the next free pad of the current bank (mic emoji, named "Live SFX hh.mm.ss"), selected and trimmable like any pad. Honest failure toasts for blocked mic / full bank / empty take.
2. DONE Launcher (H): Playout and KeyWi Bird checkboxes (own tabs via ?app= deep links); the talent screen choice is stored as a stable identity (label + geometry, legacy index still resolves) instead of an index into a list that was null every boot; the modal silently re-detects displays when the permission is already granted; a boot-time warm detect makes recovery reopens place correctly too.
3. DONE Display watchdog (G2): `screenschange` listener refreshes the screen snapshot in place (replug/resolution changes logged to the show log); the placed talent window goes fullscreen on its display (Outrangutan-style); the open-but-silent talent window now gets reconnect nudges on a ladder (hello every 8s, 5 tries) instead of exactly once.
4. DONE Row auto-call visibility (B.2): a linked-but-manual playback cue now shows a dimmed amber MANUAL chip beside the badge (auto shows the green CALL chip as before), and the row editor's call checkbox grew a plain-language explainer of READY · TRACK · ROLL · TAKE and the abort window.
5. DONE PB seams: F.2 (safety plan / production schedule / patch sheet previews are now snapshot-fed: save first, then render what the export will actually contain), F.5 (stage plot raster failures toast instead of silently swapping figures). F.6 is covered by the existing hydration join + the F.3 fingerprint guard (a moved fingerprint re-snapshots, so exports stay self-consistent).
6. DONE Builder affordance (J.4): the Script Cue fields (free-text AND structured) are labeled "short label / not the script" with hints, and Script Copy says "what the talent reads." Paired with R2's emit-every-row, a label-only row is now visible-but-dimmed instead of invisible.

## Dashboard / teaching reorganization: owner design pass wanted (J.1-J.3)

Proposals to react to before this gets built (deliberately not built solo):

1. Group the dashboard chip smatter into three labeled bands: "Run a show" (launcher, live, decks), "Build" (rundown, paperwork, script), "Learn" (guides, lessons, demos). Chips keep their ids; only layout and section headers change.
2. Every band gets one status line of live truth (next session, paperwork readiness, deck connected) instead of per-chip badges.
3. A "How a playback call works" demo card: a fake 4-step READY/TRACK/ROLL/TAKE animation students can run with no session, plus the same for GO/prompter-follow.
4. Redundancy candidates to prune (need owner confirmation): duplicate join entry points on the front door vs dashboard; the legacy per-chip guide links vs the Guides band; Flowmingo Op overlay vs Script Op drawer overlap (two control surfaces for the same thing on one machine).

## Non-goals this round

- No visual restyle of Live (standing owner decision).
- Stage plot and gear patching paperwork continue as their own track; owner is starting patching work separately.
