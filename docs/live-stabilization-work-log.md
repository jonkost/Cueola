# Cueola Live Stabilization Work Log

This report accompanies the approved **Cueola Live Production Stabilization Plan** supplied with the stabilization request on 2026-07-13. The repository did not contain `CUEOLA_LIVE_STABILIZATION_PLAN.md` at the start of the work, so the supplied plan is the controlling source until that omission is resolved.

## Phase 0 — Reproducible Test Production

### Reproduction

Initial baseline performed on 2026-07-13 in current Chromium on macOS:

1. Start the existing static preview and open `index.html` with a clean browser tab.
2. Dismiss the service-worker update notice.
3. Choose **Load Demo**.
4. Confirm the demo contains 10 rundown rows and two script cues.
5. Choose **Go Live** and review the preflight report.
6. Continue despite missing playout, sound-effects, and output connections.
7. Confirm row 1 is On Air and row 2 is Next.
8. Choose **Exit**, then **Leave Live**.
9. Confirm the local device returns to the build view.
10. Review browser warnings, errors, and uncaught exceptions.

Observed baseline:

- The built-in demo can enter and leave Live mode, and the baseline run produced no browser warning or error.
- The built-in demo is not an acceptable stabilization fixture: it has 10 rows, only two script cues, and no durable profiles, assignments, paperwork, media, or Stream Deck setup.
- The preflight correctly reported missing playout, SFX, and output connections.
- The dedicated `STAB26` local-emulator session is the stabilization fixture. It contains 24 rows, six script cues, six playback cues, mixed departments, short and long notes, four profiles and crew assignments, complete call-sheet/schedule/safety/patch data, 12 readiness checks, three device-local Outrangutan media assets, and six Stream Deck mappings.
- Local Firestore testing is intentionally opt-in: use `?firestoreEmulator=1`. Without it, localhost uses the production Firebase target.

Production-flow reproduction checklist for the reported one-second prompter cutout and shared lifecycle faults:

1. Open the `STAB26` session in the main interface and a second tab.
2. Open the Flowmingo talent display and Script Operator window from the main interface.
3. Enter Live mode and start a script cue from each supported control surface in turn.
4. Let it run for at least 60 seconds while recording operator status, talent status, offset, and browser console output.
5. Pause, resume, jump cues, change speed, and return to the same cue.
6. Leave and re-enter Live mode three times without reloading; repeat the run.
7. Close and reopen the talent and Script Operator windows; repeat the run.
8. Repeat with a second production tab, a brief network interruption, and a cached-shell reload.
9. Run the same matrix in Safari on macOS and record browser differences.

### Root Cause

Phase 0 found a test-infrastructure gap rather than an implementation root cause: the built-in demo cannot exercise the data volume, multi-window protocols, assignments, exports, media, or repeated lifecycle required by the plan. A passing demo smoke test therefore cannot validate production readiness.

### Affected Files

- `cueola-app.js`: demo fixture and the Live workflow under test.
- `index.html`: application shell and cache-versioned assets.
- `sw.js`: cached-shell behavior.
- `firestore.rules`: local-emulator access behavior for the QA session.
- `outrangutan/`: device-local media and output-window state used by the QA session.

### Repair

- Created the `STAB26` session in the local Firestore emulator and populated every session-side fixture requirement.
- Loaded three bundled MP3 assets into the `STAB26` Outrangutan IndexedDB show and mapped Stream Deck keys 1–6 to GO, Stop, Pause, Fade·Stop, PANIC, and cue 1.
- Recorded the baseline and the exact operator reproduction matrix before implementation changes.
- Kept the existing demo only as a small smoke fixture; it is not evidence for phase completion.

### Why This Is Durable

Every later phase will exercise the same known data set and window topology. That prevents a symptom from appearing resolved only because a smaller or differently configured session was used.

### Regression Risk

- Firestore-emulator data and browser IndexedDB data have different lifetimes and require an explicit reset/reseed procedure.
- Outrangutan assets and Stream Deck configuration are device-local, so the QA record must distinguish session data from workstation data.
- Safari and external-display verification require interactive macOS browser coverage and cannot be inferred from Chromium.

### Tests Performed

- Chromium baseline: load demo, enter Live, inspect preflight, leave Live.
- Browser console inspection: no warnings or errors in that baseline.
- Fixture audit against every Phase 0 data requirement: 24 rows, six scripts, six playback cues, four profiles/assignments, full paperwork, three media assets, six Stream Deck mappings.
- Main interface plus a separate Flowmingo talent-display tab, both on `STAB26`; the talent display loaded all six scripts.
- Multiple tabs on the same production: main Cueola, Flowmingo talent, and Outrangutan session surfaces.
- Chromium cached-shell reload while DevTools networking was offline: the Cueola title, entry screen, and shell copy all rendered; networking was then restored.
- Safari WebDriver attempt: blocked before navigation because Safari's **Allow remote automation** setting is disabled. `safaridriver --enable` required interactive macOS authorization and was not bypassed.
- Headless Chromium popup attempt did not create an Outrangutan output target; the external Flowmingo surface was verified in a separate browser tab instead. A physical second display remains an operator/hardware check.

### Result

**Partial.** The dedicated production is complete and the Chromium, multi-tab, external-surface, normal-network, interrupted-network, and cached-shell baselines are recorded. Safari and a physical external display remain blocked operator checks because Safari remote automation is disabled and no display hardware is available to this run.

## Phase 1 — Shared Live-State Architecture

### Reproduction

The architecture fault can be observed without changing data:

1. Load a session and enter Live mode.
2. Advance or browse cues and observe that the same global cue index is used for the locally displayed row, the Firestore active cue, and presence/follower state.
3. Open the prompter and Script Operator surfaces.
4. Leave Live mode and inspect which timers, channels, window references, and subsystem state remain active.
5. Enter Live mode repeatedly and compare listener/timer installation and subsystem status after each cycle.
6. Close an external window manually and compare its stored window reference with its actual connection state.

Current state ownership before repair:

| Value | Current source(s) | Competing authority or ambiguity |
| --- | --- | --- |
| Live mode active | `#liveshow.on`, `sessionStorage.cueola_screen`, history state, imperative calls | No explicit lifecycle state; UI structure acts as authority |
| Current/active cue | global `lsIdx`, Firestore `activeIdx`, presence `idx` | `lsIdx` also represents browse and follower position |
| Selected cue | global `lsIdx` and rendered row state | Not distinct from the active cue |
| Next cue | derived from `lsIdx` and rundown order | Changes when the overloaded index changes for non-live reasons |
| Cue status | rundown beat data plus live rendering | Persistent cue data and transient transport presentation are mixed |
| Rundown ordering | Firestore `beats`, projected into the global `beats` array | Local pending edits and remote snapshots share one mutable projection |
| Prompter active script | current beat/script projection, Firestore `prompter`, operator globals | Script selection and talent transport state can be adopted from different paths |
| Prompter play state | talent globals, Firestore `prompter`, BroadcastChannel/localStorage bridge, Flowmingo operator mirror | Several writers and mirrored booleans |
| Prompter position | talent globals, Firestore, bridge messages | Mirrored position has no single lifecycle owner |
| Prompter speed | talent globals, Firestore, bridge messages | Same value is mutated by talent and operator paths |
| Playback active media | Outrangutan `active`, IndexedDB show state, Firestore transport projection | Device-local playback state and shared session telemetry are different authorities |
| Playback play state | Outrangutan `active.playing`, output-window state, Firestore transport projection | Controller and output can temporarily disagree |
| Playback output status | `outputWins` entries (`win`, `alive`, `painting`) and heartbeat timestamps | Contradictory boolean combinations are possible |
| Script Operator status | `_scriptOpWin` popup reference | A non-null/non-closed reference is treated as connection truth |
| Student assignments | `prePro.roleAssignments`, legacy top-level `roleAssignments`, identity portal projections | Canonical and compatibility copies coexist |
| Required paperwork | session `prePro` data plus local drafts/UI state | Persisted requirement and unsaved operator draft are not clearly separated |

Lifecycle ownership before repair:

| Resource | Installation | Cleanup | Finding |
| --- | --- | --- | --- |
| Live clock interval | Live clock functions | `stopTimer()` | Guarded, but cleanup is not coordinated by a Live lifecycle owner |
| Prompter ping interval | prompter bridge initialization | partial cleanup in `stopTimer()` | Channel, watchdog, pending control timers, and timestamps outlive the same path |
| Talent watchdog | prompter initialization | replaced on re-init | Not owned by Live exit |
| Firestore session listener | `setupFirestore()` | replaced on setup and during front-page leave | Live exit and session leave have different cleanup semantics |
| Presence heartbeat | `joinPresence()` | `leavePresence()` | Cleanup returns early when Firebase is unavailable, so an existing interval can survive |
| Broadcast channels | prompter and Outrangutan initializers | partial or page-lifetime cleanup | Lifetimes are implicit rather than attached to a production session |
| Script Operator popup | open helper | manual close/window state | No independent heartbeat/state machine |
| Outrangutan output watchdog | Outrangutan build | page lifetime | Not reset by leaving the subsystem |
| Window/message listeners | several subsystem initializers | mixed guards and page lifetime | Duplicate protection exists in places, but no common audit boundary |
| Resume-state timer/timeouts | global initialization and resume flow | page lifetime/ad hoc | Reasserts `lsIdx`, reinforcing its multiple meanings |

### Root Cause

The likely shared root is the absence of a single Live-session lifecycle owner. Live state is inferred from DOM classes and imperative functions, while transport, connection, selection, persistence, and popup liveness are distributed across mutable globals. The overloaded `lsIdx` variable is the clearest example: one integer represents active cue, local browse selection, remote follow position, Firestore `activeIdx`, and presence `idx`.

Secondary shared causes:

- Persistent state, UI selection, transport state, and connection telemetry are not modeled as separate domains.
- Subsystems install their own timers, listeners, channels, and popup references without one coordinated enter/leave/recovery boundary.
- Connection status is represented by independent booleans, timestamps, and window references rather than explicit non-contradictory statuses.
- Cross-window messages, especially Outrangutan output messages, do not consistently carry a production-session and window-instance identity.
- Silent error handling hides failed cleanup and failed state adoption.

### Affected Files

- `cueola-app.js`: `goLive`, `showRundown`, `requestExitLive`, `confirmExitLive`, `leaveSessionForFrontPage`, `stopTimer`, `setupFirestore`, `syncLiveIdx`, presence, prompter, resume, and Script Operator functions.
- `outrangutan/outrangutan.js`: playback state, output registry, watchdog, channel, recovery, and subsystem exit.
- `outrangutan/output.js`: output receiver, heartbeat, and message filtering.
- `cueola-identity.js`: assignment compatibility reads.
- `index.html` and `sw.js`: cache-versioned delivery of any changed runtime assets.

### Repair

1. Added `cueola-live-session.js`, a focused dependency-free controller with explicit `build`, `entering`, `live`, `leaving`, `recovering`, and `error` lifecycle states.
2. Routed `goLive()` and `showRundown()` through the controller's single synchronous enter/leave API. Repeated entry and leave calls are idempotent.
3. Split `activeCueIndex` from `selectedCueIndex`. Firestore `activeIdx` updates the controller's active cue; followed/browsed presence updates only the selected cue. `lsIdx` remains a compatibility projection for the existing render code.
4. Restricted shared `activeIdx` writes to an instructor driving their own position. A student or follower now publishes only their presence selection.
5. Normalized prompter, playback, and Script Operator state to one controller status from the approved status vocabulary. The Live DOM exposes these records only as read-only projections for diagnostics.
6. Added one keyed, reverse-order cleanup registry. Live exit now clears the clock, prompter ping, talent watchdog, storage listener, pending control timeouts, BroadcastChannels, heartbeat stamps, and operator-runtime status through that boundary.
7. Fixed `leavePresence()` so it always clears its heartbeat interval before checking Firebase availability.
8. Added an operator-runtime gate so a Firestore talent heartbeat received after Live exit cannot resurrect the closed prompter status or watchdog.
9. Left external playback running and represented it as `ready` after local Live exit; Phase 1 cleanup does not stop a playout surface that may intentionally continue on another machine.
10. Kept the later Flowmingo protocol, Outrangutan output protocol, Script Operator heartbeat, assignment, export, UI, and Stream Deck repairs in their ordered phases.

State ownership after Phase 1:

| Value | Phase 1 authority | Compatibility/projection |
| --- | --- | --- |
| Live lifecycle | `CueolaLiveController.lifecycle` | Live/build DOM classes, history, and `sessionStorage.cueola_screen` are projections/actions |
| Shared active cue | controller `activeCueIndex`, synchronized with Firestore `activeIdx` | Only a self-driving instructor writes the Firestore value |
| Device selected/followed cue | controller `selectedCueIndex` | `lsIdx` and presence `idx` project it for existing rendering and followers |
| Prompter status | controller `subsystems.prompter.status` | Existing status labels render the normalized state |
| Playback status | controller `subsystems.playback.status` | Derived from Outrangutan's published transport; output protocol detail remains Phase 3 |
| Script Operator status | controller `subsystems.scriptOperator.status` | `opening`/`connecting`/`closed` are honest; a real ready heartbeat remains Phase 4 |
| Live-owned resources | controller cleanup registry | Subsystems register keyed cleanup functions on entry |

### Why This Is Durable

The controller defines one transition boundary for UI, cue state, normalized subsystem status, and Live-owned resources. Later Flowmingo, Outrangutan, popup, and Live-exit repairs can attach to that boundary instead of adding more global flags or one-off cleanup calls. Active and selected cues are now separate at the write boundary, so a local browse cannot corrupt the production cue even while legacy rendering still reads `lsIdx`.

### Regression Risk

- Existing callers assume `goLive()` and `showRundown()` synchronously mutate DOM and global state.
- Firestore `forceLive`, history navigation, resume, and preflight paths all enter Live through different call sites.
- Closing transport resources too aggressively could interrupt an external output that is intentionally left running.
- Separating selected and active cue can change keyboard and follower behavior if compatibility rules are not explicit.

### Tests Performed

- Static trace of Live entry, exit, session leave, Firestore adoption, presence, resume, prompter, Script Operator, and Outrangutan lifecycle paths.
- Inventory of Live-related intervals, listeners, channels, popup references, and watchdogs.
- Chromium demo enter/leave baseline with console inspection.
- Five dependency-free controller tests: segment normalization, active/selected separation, repeated-entry idempotence, reverse-order single cleanup, status validation, and entry-error cleanup.
- Current Chromium with `STAB26`: three Live entry/exit cycles. Each exit projected `build`; each re-entry projected `live`; no browser warnings or errors.
- Active/selected regression: a student browsed to row 2. Emulator proof showed shared `activeIdx: 0` and that student's presence `idx: 1`.
- Status regression with a live talent display: in Live, controller state was `live`, prompter `paused`, playback `ready`, Script Operator `closed`; seven seconds after exit and continued talent heartbeats it remained `build`, prompter `closed`, playback `ready`, Script Operator `closed`.
- Current asset proof: the exact final `cueola-app.js?v=2fdc0e32be` and `cueola-live-session.js?v=2762fa1f8a` build entered with `live / paused / ready / closed` lifecycle and subsystem states, then remained `build / closed / ready / closed` after exit while talent heartbeats continued.
- Syntax checks for every changed JavaScript module and test.
- DOM contract lint: 2 pages, 696 id references, 627 handler references, pass.
- Avatar compatibility: 8 tests, pass.
- Entitlements: 21 tests, pass.
- Firestore rules contract against the local emulator, pass. No rules change was needed because Phase 1 added no collection or document fields.
- Cache-bust verification: all managed asset references current.
- `git diff --check`, pass.

### Result

**Pass in current Chromium; cross-browser sign-off partial.** Phase 1's ownership, lifecycle, cleanup, cue-separation, idempotence, and non-contradictory status criteria pass in the automated and live Chromium checks. Safari remains the Phase 0 environment blocker noted above. No Phase 2 or later implementation was started.

## Phase 2 — Flowmingo Prompter Operation

### Reproduction (Pre-Implementation)

Baseline performed on 2026-07-13 against the exact Phase 1 preview and the `STAB26` emulator session:

1. Resume the main operator window into Live mode on row 1.
2. Open a separate Flowmingo talent URL with `?prompter=1&code=STAB26#flowmingo`.
3. Confirm the talent surface loads all six scripts and reports `READY · STAB26`.
4. Wait for the main operator status to change from `FLOWMINGO WAIT` to `FLOWMINGO ON`.
5. Inspect the Live rundown row and column event bindings while following self as the instructor.
6. Inspect the BroadcastChannel/local-storage and Firestore prompter paths from initial output startup through the first script render.
7. Inspect talent touch handling and every Script Op/Flowmingo Op transport control.

Observed baseline:

- The one-second disappearance reported before Phase 1 is not reproduced on the current exact build; the talent surface remains rendered and continues heartbeating. The remaining protocol can still race on a fresh or recovering window because the operator treats any ping as connection truth and sends state without an applied-state acknowledgment.
- The original one-second cutout has a deterministic startup race: BroadcastChannel `script_init` and the first Firestore script snapshot can each take the initial-load path. Both reset scroll and stop playback, so pressing Play after the first render can be undone when the delayed duplicate initialization arrives.
- A second deterministic double-toggle exists when the Play button has focus and the operator presses Space: the document keyboard handler toggles on keydown, then the button's native Space click toggles again.
- Clicking a Live rundown row as the self-following instructor calls `jumpToLsCue()` directly. Selection and activation are therefore still one action, and clicking otherwise blank row space can move the shared live cue.
- Live department column headers are `draggable="true"` and use the build-view column-reorder handlers. Live mode still exposes reordering without an explicit justified live-edit workflow.
- Row controls rely on scattered inline `stopPropagation()` calls. There is no shared `isInteractiveTarget()` policy for buttons, inputs, sliders, links, labels, scrollable panels, or popup controls.
- Talent touch handling excludes a short hard-coded selector but does not use a common pointer/touch interaction policy or pointer capture.
- Startup is an implicit `cueola_hello` / `ping` / `script_init` exchange. There is no explicit `PROMPTER_READY` followed by a complete state snapshot and `PROMPTER_STATE_APPLIED` acknowledgment.
- Talent heartbeat runs every six seconds and the operator waits fourteen seconds before declaring failure. A ping proves the event loop delivered a message but the protocol does not scope readiness to one production session and one output instance.
- Operator feedback collapses the required lifecycle into `FLOWMINGO WAIT`, `FLOWMINGO ON`, `Connected`, and transient command labels; it cannot persistently distinguish opening, connected, ready, running, paused, recovering, and error.

Prompter state ownership before Phase 2 repair:

| State | Current owner(s) | Conflict or gap |
| --- | --- | --- |
| Production/session identity | `session.code`, `ptLinkedCueolaCode`, message `sessionCode`, Firestore document path | Messages are not consistently rejected by session or output instance |
| Script and script version | `prompterText`, `prompterVersion`, Firestore `prompter`, talent DOM/local storage | A complete serializable snapshot does not own all transport state |
| Active rundown cue | Live controller/`lsIdx`, payload `activeIdx`, Firestore `prompter.activeIdx` | Talent state does not acknowledge applying the active cue |
| Playing/paused | `ptPlaying`, `flowOpPlaying`, control messages, controller subsystem projection | Mirrored booleans can be optimistic before talent acknowledgment |
| Position | `ptOffset`, rendered transform, seek sliders, relative control messages | Operator has no authoritative acknowledged position snapshot |
| Speed | `ptTargetSpeed`, `ptLiveSpeed`, Flowmingo mirror globals | Target and effective speed are not part of one state record |
| Connection/readiness | ping timestamps, `lastTalentPingTs`, Firestore heartbeat, status DOM | `Connected` is treated as `Ready`; instance replacement is not modeled |
| Command identity | `controlId`, `_pendingPrompterControls`, receiver signature set | Dedup exists, but old-session and stale-instance commands are not consistently rejected |
| Output instances | per-window `FLOWMINGO_ENDPOINT_ID` plus popup reference | The active output instance is not explicitly adopted/replaced in shared state |
| Error state | transient toast/status strings and controller detail | No serializable error field or one persistent recovery state |

### Root Cause (Pre-Implementation)

The shared Phase 2 root cause is that Flowmingo has a transport bridge but not a session protocol. Script data, transport state, connection liveness, command deduplication, and UI status are maintained by separate globals and inferred from messages arriving. Because readiness is inferred from a ping rather than an acknowledged full-state application, startup and recovery can issue operational commands against a window that has not yet restored the operator's state. The BroadcastChannel and Firestore initial-load paths also lack one shared snapshot identity, so a delayed duplicate can reset and stop a display that already began running.

The interaction root cause is similar: the rundown treats a row as both navigation surface and activation control, while Live drag and control exclusions are inherited from build-mode markup and one-off inline handlers instead of a single input policy.

### Affected Files

- `cueola-prompter-session.js`: new dependency-free protocol/state controller.
- `cueola-app.js`: Live selection/activation policy, interaction guards, talent runtime, protocol transports, watchdog, command acknowledgment, and persistent status projection.
- `index.html`: protocol load order, Live row/control styling, pointer policy, and cache versions.
- `sw.js`, `scripts/bump-cache.mjs`, and `scripts/check-contracts.mjs`: exact-build delivery and contract coverage for the new module.
- `scripts/tests/prompter-session-controller.test.mjs`: protocol, readiness, replacement, recovery, and queue regressions.

### Repair

1. Added protocol version 2 with one complete JSON-serializable state record: production/session/script/cue identity, running state, position, target/effective speed, last command, timestamps, connected operators, error, output instance, status, state version, and snapshot ID.
2. Replaced ping-as-readiness with `PROMPTER_READY → PROMPTER_STATE → PROMPTER_STATE_APPLIED`. Commands remain queued until the active output acknowledges the exact snapshot.
3. Scoped messages and commands to the production, protocol session, and output instance. A replacement output invalidates old readiness; queued recovery commands are retargeted during its handshake and flushed exactly once.
4. Consolidated BroadcastChannel, local-storage, and Firestore delivery under the same message/command IDs. Mirrored messages are deduplicated, including duplicate READY traffic that previously generated multiple paused snapshots after a queued PLAY.
5. Made the two-second talent heartbeat state-bearing and changed the existing watchdog to require three consecutive misses. A miss invalidates readiness before another command can dispatch and projects a persistent recovering state.
6. Prevented a late initial Firestore script snapshot from resetting a renderer that already applied a protocol snapshot. Script edits after startup preserve position and transport.
7. Acknowledged controls only after the talent renderer applies them; row seeks acknowledge after their animation-frame position update.
8. Split Live selection from activation. Row clicks select only; authorized activation uses explicit GO/Next/Previous actions. Removed Live column dragging.
9. Added one interactive-target policy for buttons, inputs, links, labels, sliders, editable/scrollable regions, and controls. Space no longer double-toggles a focused button.
10. Replaced talent touch listeners with pointer events and pointer capture, including cancel/lost-capture cleanup for the stage, brake, and boost controls.
11. Made the talent runtime teardown close channels, listeners, intervals, subscriptions, key handlers, idle timers, and heartbeat state on exit/pagehide.
12. Projected `opening`, `connected`, `ready`, `running`, `paused`, `recovering`, `error`, and `closed` persistently into Live/controller state.

### Why This Is Durable

Readiness now means one identified renderer applied one identified complete snapshot, not merely that some window answered a ping. Every delivery path carries the same identity and dedup key; recovery invalidates the previous proof before accepting commands. Startup script sources converge without invoking the reset path after state application, and all operator surfaces use the same command gate and acknowledged talent state.

### Regression Risk

- Legacy protocol messages remain accepted only for compatibility; they cannot supply version-2 readiness.
- Background-tab throttling can delay heartbeats, so the watchdog requires three misses rather than one late interval.
- Auto-pause markers intentionally stop playback when their marker reaches the reading line; sustained-run QA must distinguish that feature from an uncommanded startup stop.
- Safari pointer, BroadcastChannel, popup, and background-throttling behavior still requires the blocked Safari sign-off from Phase 0.

### Tests Performed

- Seven dependency-free protocol tests: complete serializable state, applied-snapshot readiness, wrong production/session/stale-output rejection, replacement invalidation, one-time queue flush, heartbeat-miss invalidation, and replacement-output retargeting.
- Five shared Live-controller tests, JavaScript syntax checks, and DOM contract lint (`2 pages`, `695 id refs`, `634 handler refs`) all passed.
- Exact preview assets verified in both windows: `cueola-prompter-session.js?v=1002259f73` and `cueola-app.js?v=fb950e7449`.
- Live row regression: clicking row 3 selected it while row 1 remained On Air; Live draggable headers count was zero.
- Sustained playback regression: the talent transform changed continuously for more than four seconds and both windows reported running, instead of stopping after one second.
- Recovery regression: closing the talent surface produced `FLOWMINGO RECOVERING` after three misses; Play displayed `Play queued`; a replacement surface displayed `Play applied`; the operator and talent both reported running; the transform moved from `translateY(-55.9868px)` to `translateY(-239.874px)` over the next three seconds.
- Recovery evidence captured at `/private/tmp/cueola-phase2-operator-running.png` and `/private/tmp/cueola-phase2-talent-running.png`.
- Final safe state: operator `FLOWMINGO PAUSED`, talent control `PLAY`; the preview remains running.
- No Firestore collection or rules change was required; protocol fields extend the already-allowed `sessions/{code}.prompter` map.

### Result

**Pass in current Chromium; cross-browser sign-off partial.** The startup cutout, readiness race, recovery queue, stale-instance protection, active-versus-selected cue behavior, input-policy faults, pointer cleanup, and persistent status criteria pass. Safari and a physical external display remain the Phase 0 environmental blockers.

## Phase 3 — Outrangutan Playback Reliability

### Reproduction (Pre-Implementation)

Baseline performed on 2026-07-13 before changing Outrangutan code:

1. Open the current exact preview on `127.0.0.1:8018` and choose **Outrangutan → Session**.
2. Join `STAB26` as `Stabilization QA` and confirm the surface identifies `Session · STAB26`.
3. Choose **Pop out program** and inspect the controller's output button, output registry, channel traffic, and watchdog.
4. Trace a fresh output's `ready` message through `handleOutputMessage()`, `resendActiveToOutput()`, and `output.html`'s asynchronous `receive() → handle() → doPlay()` path.
5. While a media load is awaiting IndexedDB, issue STOP or a newer cue and inspect whether the older asynchronous load is invalidated.
6. Reload or replace an output with active media and inspect whether the controller restores paused or resumes automatically.
7. Let the heartbeat expire, then inspect operator feedback, show log, recovery behavior, and the main Cueola Live status.
8. Leave and re-enter Outrangutan and inspect the channel, message listener, registry, and watchdog lifetimes.

Observed baseline:

- The existing watchdog is implemented and active: it pings every two seconds and marks an output dead after five seconds. The exact live preview changed the Pop-out button to pressed/healthy after opening. The in-app browser does not expose that popup as a separately claimable tab, so output-document browser manipulation is limited in this environment.
- The watchdog must be consolidated, not duplicated. It currently keys an output only by numeric ID and stores `win`, `alive`, `painting`, and `lastBeat`; a stale and replacement window with the same numeric ID are indistinguishable.
- The global `outrangutan-output` BroadcastChannel is not scoped to a production or controller instance. Two shows on the same origin can receive the same commands.
- A command has `_mid`, `t`, and optional target, but not the required protocol/session/controller/output-instance/cue/media identity. Important commands have no applied acknowledgment.
- `output.html` invokes asynchronous handlers without serialization. A slow IndexedDB load can finish after STOP or a newer cue and put stale media on air.
- Fades, image loads, media error handlers, and key-render animation frames are not canceled by one shared operation generation.
- A fresh/recovered output receives `resendActiveToOutput()`, which sends `play` using the controller playhead and paused flag. When the controller is playing this automatically resumes a recovered renderer without an explicit safe-recovery decision.
- Window readiness and playback health are collapsed. `isOutputHealthy()` requires an open window plus `alive`, but the state model does not separately represent communication, applied configuration, media load, playback, renderer health, last acknowledgment, current cue/media/playhead, or recoverability.
- `exitOutrangutan()` stops local media and the Firestore subscription but leaves the global channel, anonymous window listener, output registry, output windows, and watchdog alive.
- Timeouts produce log/toast messages for heartbeat loss, but command timeouts do not exist, there is no applied-command recovery action, and the main Cueola Live view does not project trustworthy output-protocol status.

Playback state ownership before Phase 3 repair:

| State | Current owner(s) | Conflict or gap |
| --- | --- | --- |
| Production identity | Outrangutan `mode`/`sessionCode`, Cueola Firestore session | Output channel/messages carry neither identity |
| Controller instance | Outrangutan page lifetime | No explicit instance ID in the output protocol |
| Output identity | numeric output config ID and `outputWins` map | Reloaded/stale windows share one ID |
| Command identity | controller `_mid` and receiver `messageIds` | Dual-path dedup exists, but no applied acknowledgment or session scope |
| Active cue/media | controller `active`, cue list, output deck globals | Controller is authoritative, but receiver loads asynchronously without generation cancellation |
| Play state/playhead | controller media element and output media element | Output is a projection but can auto-resume or race stale loads |
| Window state | popup `Window` reference | Open is treated as a prerequisite for health but not modeled independently |
| Communication state | `alive`, `lastBeat`, `window.closed` | No handshake/applied-state phase |
| Renderer health | heartbeat `raf`, `painting` boolean | Not tied to the active output instance or one transition state |
| Media load state | output-local async `getBlob()`/media events | Not reported as state and cannot be canceled coherently |
| Last applied command | receiver dedup set only | Controller never knows which command was actually applied |
| Recovery state | watchdog booleans plus automatic resend | No explicit paused recovery contract or operator action |

### Root Cause (Pre-Implementation)

The shared root cause is that Outrangutan has a dual-path message bus and a heartbeat, but not an identified, acknowledged output-session protocol. Numeric output IDs and window references are used where production, controller, and renderer-instance identity are required. Receiver operations are asynchronous and independent, so delivery order is not application order and destructive commands cannot invalidate work already awaiting IndexedDB/media readiness. The watchdog detects some failures but cannot prove that one current renderer applied one current state.

Lifecycle ownership is the secondary root cause: channel/listener/watchdog/output resources are page-lifetime globals rather than a runtime that can be entered, detached, and cleaned once. Recovery consequently resends active playback optimistically instead of establishing a safe paused state and waiting for explicit operator intent.

### Repair

1. Added `outrangutan/output-protocol.js`, a dependency-free protocol-v2 authority for production/controller/output/renderer identity, the complete wire envelope, independent health fields, `READY → SYNC_STATE → STATE_APPLIED`, command acknowledgments, duplicate-result caching, stale-origin-state rejection, replacement retargeting, and safe paused recovery.
2. Added `outrangutan/output-command-queue.js`. Commands serialize within a generation; a destructive command advances the generation and begins immediately, resolves older work as superseded, and relies on `isCurrent()` guards so a hung decoder/IndexedDB request cannot delay STOP or later repaint the output.
3. Scoped BroadcastChannel names and direct messages to the production session and controller instance. Every command also targets one exact output instance; stale production, controller, output, renderer, and out-of-order state are rejected.
4. Replaced timer-based startup with the applied-state handshake. Before `STATE_APPLIED`, controller intents remain queued. A complete snapshot restores output configuration, routing, active media, transform, key state, and playhead paused.
5. Added applied acknowledgments and a five-second command timeout. Timeout, heartbeat loss, renderer stall, and renderer/media errors each produce one persistent state, recovery control, show-log entry, toast, and console diagnostic rather than silently disappearing.
6. Consolidated the existing two-second/five-second watchdog. It now owns popup/window state, instance heartbeat, renderer painting/progress, acknowledgement state, and recoverability. Video health uses video-frame/playhead progress where available and gives background/minimized documents a visibility-aware grace period.
7. Made the output receiver generation-aware across IndexedDB loads, image decode, media callbacks, fades, keyer animation, transforms, and audio routing. Rapid PLAY/STOP/replacement sequences cannot revive canceled work; duplicate dual-path deliveries re-ACK without reapplying.
8. Modeled window, communication, media load, playback, renderer, heartbeat, cue, media, playhead, last ACK, error, and recoverability separately and projected the same status into the Outputs sheet, Cueola Live badge, preflight, and existing session telemetry.
9. Implemented explicit **Recover paused** / **Resume** behavior. A returned renderer never rolls from an unsafe stale position; Resume first takes a fresh current-playhead snapshot and then applies one explicit resume command.
10. Retired replaced renderers to black with a visible close message. Popup names include session/controller identity, and each launch uses a query-level token so reopening an existing named popup forces a real document reload and a new READY.
11. Made output runtime cleanup named and complete: window listener, channel, watchdog, ACK timers, protocol records, registry, and controlled popups are removed on Outrangutan exit or session identity change.
12. Preserved multi-output, crossfade, image, keyer, per-output audio/sink, display placement, identify, and existing transport call sites. Default-device routing now applies `setSinkId('')` and reports failures.

### Why This Is Durable

The controller can now prove that one current renderer applied one current snapshot, and every later mutation is both instance-scoped and acknowledged. Generation invalidation separates delivery order from stale asynchronous completion, while one state projection prevents the popup button, Outputs sheet, Live badge, and preflight from contradicting each other. Recovery is deliberately paused and operator-owned.

### Regression Risk

- Browsers without `requestVideoFrameCallback` use playhead progress as the decoder-health fallback.
- Background timer throttling can delay heartbeats; returning to the foreground triggers a safe resync rather than an automatic resume.
- A physical multi-display move/fullscreen pass and Safari remain environmental sign-off items from Phase 0.
- The plan's long-running output case is carried into the integrated Phase 10 dwell. The controlled browser profile used for that final run must distinguish an open output window from media that is actually on air.

### Tests Performed

- Eleven protocol tests: complete envelope/state shape, applied-state gate, wrong identity rejection, replacement retarget/one-time flush, duplicate re-ACK, independent state projection, safe pause, state-applied error preservation, heartbeat error preservation, explicit cue/media clearing, and out-of-order heartbeat rejection.
- Nine command-queue tests: asynchronous ordering, destructive invalidation, STOP bypassing an unresolved load, in-flight/cached dedup, bounded cache, structured error recovery, cancellation, close cleanup, and command-ID enforcement.
- Live exact-build handshake: controller reported `READY · Renderer ready and acknowledging commands`; renderer DOM reported `communication=ready`, `mediaLoad=empty`, `playback=stopped`, and `renderer=idle`.
- Live command proof: Identify changed the active renderer and the controller reported `Last ack IDENTIFY ✓` despite mirrored BroadcastChannel/direct delivery.
- Live replacement proof: a separately opened renderer instance replaced the popup, applied the paused snapshot, and exposed the exact new instance ID without reusing the stale renderer.
- Live failure proof: closing the active renderer produced `DISCONNECTED · No renderer heartbeat for 5 seconds`, a persistent **Recover paused** button, one show-log/toast/console error, and no full-app reload.
- Live recovery proof: **Recover paused** forced a new popup navigation/READY and returned the same operator surface to `READY · Renderer ready and acknowledging commands` in place.
- Recovery evidence: `/private/tmp/cueola-phase3-output-recovered.jpg`.
- Exact preview assets: `outrangutan/output-protocol.js?v=515bfb5721`, `outrangutan/output-command-queue.js?v=d3ef82b3a4`, `cueola-app.js?v=ef94e82e64`, and `outrangutan/outrangutan.js?v=fc305a7942`.
- JavaScript syntax, DOM contracts (`3 pages`, `701 id refs`, `634 handler refs`), cache-reference verification, and `git diff --check` passed.
- No Firestore rules change was required: Phase 3 adds no collection and only extends the existing allowed `sessions/{code}.outrangutan.live` map.

### Result

**Pass in current Chromium; endurance/cross-browser sign-off partial.** Handshake, acknowledgments, rapid destructive commands, instance replacement, heartbeat loss, persistent diagnostics, safe recovery, status projection, and runtime cleanup pass without reloading the app. The preview and recovered output remain running for the integrated dwell; Safari and a physical external-display pass remain Phase 0 blockers.

## Phase 4 — Script Operator Popout

### Reproduction (Pre-Implementation)

Baseline performed on 2026-07-13 against the exact Phase 3 preview and the `STAB26` emulator session, before changing Script Operator code:

1. Resume the main operator into Live mode with the docked Script Op drawer open.
2. Choose **Pop out the Script Op controls** twice and inspect the main Live subsystem state.
3. Open the generated `?scriptop=STAB26` URL as an inspectable browser tab and wait for the session and Live drawer to initialize.
4. Inspect its document tree, visible screen, viewport, overflow, hidden workspaces, overlays, and controller status.
5. Focus and hold the Speed slider while tracing every call to `renderLivePrompterControls()` from Live renders, talent state adoption, Firestore adoption, push completion, and control acknowledgment.
6. Compare the V2 fingerprint-gated standalone Flowmingo Op renderer with the Script Op renderer.
7. Trace the popup's production and prompter-session identity, command dispatch, open-twice behavior, manual close, parent close, and Live exit.

Observed baseline:

- The main window changes Script Operator state to `connecting` and never reaches ready because no Script Operator heartbeat or applied-state acknowledgment exists. Opening twice does focus the stored window reference.
- The "popout" is the entire `index.html` application. A body class hides the main rundown and bar, but the document still contains every app screen and 31 modal/overlay layers. At a 1280×720 viewport the hidden-main layout leaves a 53px Live bar and 86px bottom bar; the operator drawer receives only 329px of visible height for 806px of content.
- The child independently joins Firestore, enters Live, installs the full Cueola runtime, starts its own prompter operator bridge, and reports its own Script Operator subsystem as `closed`. It is therefore a second controller disguised as a panel, not a projection of the parent controller.
- `renderLivePrompterControls()` unconditionally replaces `#lsLiveActions`, `#lsClockActions`, and `#lsPrompterRemote` with `innerHTML`. A version-2 talent heartbeat can flow through `adoptPrompterTalentState()` into this function approximately every two seconds, so sliders, inputs, selection, and keyboard focus are structurally disposable during normal operation.
- The standalone Flowmingo Op fingerprint gate is present and defers a structural render around active controls, but Script Op does not use it.
- The child creates its own prompter protocol session identity. Its ordinary Firestore snapshot path adopts script text but not the parent's full protocol identity/state, so its messages can be rejected as a mismatched session; its own `goLive()`/initial push can also overwrite the shared Firestore prompter session identity and strand the original operator.
- Manual child closure has no explicit close message. The parent can only discover `window.closed` opportunistically, has no Script Operator watchdog, never exposes a persistent disconnected state, and does not own popup cleanup on parent close. `dockScriptOpPopout()` is not reachable from the child UI.
- Baseline screenshots were captured in the pre-implementation browser run; the retained post-repair evidence paths are recorded under **Tests Performed** below.

Script Operator state ownership before Phase 4 repair:

| State | Current owner(s) | Conflict or gap |
| --- | --- | --- |
| Popup existence | Parent `_scriptOpWin` reference and browser window | A live `Window` reference is the only parent connection signal |
| Production identity | Parent `session.code`, child URL, child `session.code`, Firestore path | The child reconstructs a full independent production client |
| Prompter session identity | Parent and child `CueolaPrompterSession` controllers | Each page can mint a different session ID for one talent renderer |
| Script text/draft | Parent global/editor, child global/editor, Firestore `prompter.text` | Two editable global copies can overwrite one another |
| Prompter transport | Talent protocol state plus globals in both full app windows | The child dispatches as another controller rather than through the parent path |
| Control values | Talent state, duplicated globals, three rebuilt drawer subtrees | Focused DOM controls are not stable projections |
| Connection status | Parent popup reference, child Live controller, talent heartbeat | None proves that the parent and child are synchronized |
| Theme/layout | Shared local storage plus full main document CSS/body class | Main-workspace chrome, breakpoints, and overlays remain in the popout tree |
| Listener/timer lifetime | Two complete app runtimes | Popup close and parent close have no single paired cleanup boundary |

### Root Cause (Pre-Implementation)

The popout is implemented as a second full Cueola application that happens to hide most of its DOM. That duplicates production state, Firestore listeners, prompter protocol identity, timers, and controls instead of projecting the main operator's one authoritative state. The parent and child therefore have no explicit relationship beyond a popup reference and a shared Firestore document.

The interaction fault is separate but related: the Script Op renderer treats changing values as a reason to replace whole interactive subtrees. Because live talent telemetry regularly reaches that renderer, the identity of a focused control is not stable. The inherited full-app document then compounds the problem with hidden layers and main-workspace sizing rules.

The Phase 4 repair will therefore use one dedicated popout document/root, one production-scoped parent/popup handshake and heartbeat, parent-authoritative state snapshots, and command intents routed through the parent's existing `sendPrompterControl()`/`sendToPrompter()` path. Both the docked panel and popout will mount structure once and patch stateful values without replacing an active control.

### Affected Files

- `cueola-app.js`: docked Script Op mount/patch renderer, authoritative popup host, command allowlist/dispatch, popup lifecycle, and legacy `?scriptop=` redirect.
- `cueola-script-operator-protocol.js`: dependency-free identified host/operator protocol.
- `script-operator.html`, `script-operator.css`, `script-operator.js`: dedicated one-root operator document, layout, in-place projection, controls, retry/timeout feedback, and cleanup.
- `index.html`: protocol loading, cache version, docked control markup, and removal of the old full-app popout layout branch.
- `sw.js`: dedicated navigation target, versioned assets, and deterministic SF Symbol mask assets for first offline opening.
- `scripts/bump-cache.mjs`, `scripts/check-contracts.mjs`: new page/assets in the no-build cache and DOM-contract systems.
- `scripts/tests/script-operator-protocol.test.mjs`: protocol identity, handshake, replay, deduplication, heartbeat, replacement, and cleanup regression coverage.

### Repair

- Replaced the disguised second full Cueola application with `script-operator.html`, whose body has one operator root, one 100vh/100dvh layout boundary, safe-area padding, hidden page overflow, and one internal scrolling region. It loads no Firebase, session listener, rundown, modal layer, or full app runtime.
- Made the main Live page the sole production and Flowmingo authority. It creates a production/session/controller-scoped host, sends complete snapshots, and accepts only allowlisted intent types/actions. Popup control intents use the same `sendPrompterControl()`, preview, draft, push, and editor paths as the docked UI.
- Added the exact `READY → STATE → STATE_APPLIED` readiness gate, two-second heartbeats, three-miss disconnect behavior, monotonic state versions, bounded message/command caches, stale-identity rejection, one-execution duplicate handling, cached re-acknowledgment, explicit closing messages, and idempotent teardown.
- Added a bounded client retry using the original command ID (four attempts over six seconds) and a persistent operator-facing terminal error when no acknowledgment arrives. Transient slider previews remain intentionally non-retried; the committed change command is acknowledged/retried.
- Made both docked and popup structures mount once. Talent telemetry, clocks, and host snapshots patch values, text, classes, symbols, and ARIA state in place. Focused/dragged controls defer external values until release/blur, and editor selection is retained.
- Honored the parent's `controlsEnabled` projection in the popup and reject host commands outside the `live` lifecycle. Flowmingo Op ownership now returns an honest failure instead of a false-success Script Operator acknowledgment.
- Added real keyboard down/up hold semantics for Brake and Boost, reduced live-region churn, retained exact clock/wrap field values in the parent model, and used only catalogued SF Symbol masks.
- Opening twice focuses the named existing window. Popup close updates the parent immediately; parent/Live cleanup closes the controlled popup; replacement operators invalidate old identities; reopening installs one fresh listener/timer set.
- Removed the volatile prompter timestamp/version fields from the popup fingerprint. An idle watchdog now sends a heartbeat rather than forcing a new state handshake.

### Why This Is Durable

The popup is now a view and intent surface, not a second application or second state owner. Production identity, prompter session identity, drafts, transport, command ordering, and output health remain in the main controller. The explicit protocol makes readiness, replacement, retries, and cleanup testable independently of browser-window timing, while mount-once rendering makes DOM identity independent of telemetry cadence. The same-origin dual transport is redundant without being duplicative because every logical message carries a bounded, deduplicated identity.

### Regression Risk

- The docked renderer changed from subtree replacement to targeted patching; newly added controls must be mounted in the structural templates and added to the corresponding patch function.
- A Script Operator command may now be held briefly while a fresh state snapshot is being acknowledged. This is deliberate; it prevents execution against stale lifecycle/session state.
- The dedicated popup no longer has access to unrelated full-app globals. Any future control must be represented in the snapshot/intent contract rather than reaching into the parent DOM.
- Browser popup sizing and physical-display placement remain browser/OS policy. The layout is responsive and isolated, but the external-display hardware matrix is repeated in Phase 10.

### Tests Performed

Automated on 2026-07-13 with the repository's bundled Node runtime:

- JavaScript syntax checks for the main app, popup client, and protocol.
- Script Operator protocol: 9/9 pass.
- Flowmingo protocol: 7/7 pass.
- Outrangutan protocol: 11/11 pass.
- Outrangutan command queue: 9/9 pass.
- Live-session controller: 5/5 pass.
- DOM/inline-handler contracts: 4 pages, 734 ID references, 634 handler references, 9 explicit allowlist entries; pass.
- Cache-bump dry run/actual run and `git diff --check`; pass.

Chromium live preview at `127.0.0.1:8018`, emulator session `STAB26`:

- Verified exact final assets: `cueola-app.js?v=ab9a6aa64d`, `script-operator.js?v=a40bba1297`, `script-operator.css?v=78d9e27bef`, and protocol `?v=209555b4d7`.
- Main Flowmingo status reached `PAUSED`, talent showed `READY · STAB26`, popup showed `Ready · STAB26`, and the popup host button stayed active.
- Opened/closed/reopened the operator ten consecutive times. Every cycle returned to `Ready · STAB26`, kept `data-render-count="1"`, and immediately projected `Pop out Script Operator` after close.
- Exercised transport play/pause, Brake/Boost keyboard holds, forward/reverse, speed/size step and sliders, all alignments, all nine themes, reset/hide/mirror/fullscreen intent, current/next cue, both slates, scrub/nudge/punch, all clocks/wrap alerts, question and overlay-size controls, formatting/marker insertion, draft sync, push, and Edit Script parent handoff. Acknowledgments came through the central path; the rehearsal ended paused, clock/slates/question cleared, theme restored to Glacier, and the original QA script restored and pushed.
- Held popup Speed focus while the main operator changed 60 → 73. Focus and value stayed 60 during the external update, the root stayed at render count 1, and value 73 applied after focus moved.
- Confirmed one body child, zero main-app overlay/modal nodes, 32/32 resolved icon masks, root height exactly 720px in a 1280×720 viewport, hidden page overflow, and a single internal `overflow:auto` region (662px viewport / 1084px content).
- Final visual evidence: `/private/tmp/cueola-phase4-final-main.png` and `/private/tmp/cueola-phase4-final-script-operator.png`.

Not available on this machine during Phase 4: a physical second display and Safari automation. Clipboard Paste/Paste Push were not activated because that would read the user's system clipboard; their delegated paths and failure feedback were inspected statically. Those environmental cases remain explicit in the Phase 10 Safari/Chromium and hardware matrix.

### Result

Pass for the Phase 4 implementation and available Chromium operator matrix. The full-app duplication, focus loss, drift, false status, and uncontrolled lifecycle root causes are removed. Physical multi-display movement, Safari, and privacy-sensitive clipboard activation remain recorded—not silently claimed—and are carried into the integrated Phase 10 run.

## Phase 5 — Live-Mode Entry, Exit, and Recovery

### Reproduction (Pre-Implementation)

Baseline performed on 2026-07-13 against the completed Phase 4 shell and `STAB26` emulator rehearsal, before changing Phase 5 code:

1. Resume the operator at row 1 in Live mode with Flowmingo talent `READY`, the main status `PAUSED`, and the dedicated Script Operator `Ready · STAB26`.
2. Choose the current top-bar **Exit** control.
3. Inspect the dialog language, choices, lifecycle projection, output health, command eligibility, and recovery affordances.
4. While the dialog remains open, issue **Forward** from the Script Operator.
5. Cancel with **Stay Live** and inspect output/controller state.
6. Trace ordinary leave from `showRundown()` through `CueolaLiveController.leave()`, `leaveLiveSessionScreen()`, and the registered cleanup map.
7. Trace every direct Live cue/playout/prompter dispatch path, keyboard hold, transient pointer listener, timer, resume/snapshot write, and output-window handle.
8. Inspect the top-bar/sidebar layout rules at the expected laptop viewport and the existing narrow-width breakpoint.

Observed baseline:

- The dialog always appears, even when there is no external output to resolve. It offers a red **Leave Live** action and **Stay Live**, but cannot distinguish stopping outputs from detaching them.
- Opening the dialog does not start a lifecycle transition or freeze command dispatch. All 60 Script Operator state-dependent controls remained enabled, and **Forward** was accepted and acknowledged while the exit dialog was open.
- The controller uses `build`, `entering`, `live`, `leaving`, `recovering`, and `error` rather than the approved deliberate vocabulary `builder`, `entering-live`, `live`, `leaving-live`, `recovering`, and `live-error`.
- Ordinary leave synchronously flips the screen and runs registered cleanup, but does not own a prepare/cancel/commit transaction, immutable exit snapshot, output disposition, dispatch gate, or emergency recovery path.
- Cleanup currently owns the show clock, prompter operator bridge, and Phase 4 Script Operator host. It does not normalize Outrangutan output disposition, release Live key holds before the bridge closes, cancel an in-progress sidebar/script resize, close transient Live overlays, or clear Live-only draft/status callbacks as one boundary.
- The Script Operator popup correctly closes on completed Live cleanup, while the Flowmingo talent and Outrangutan renderers have independent lifetimes. No UI asks what should happen to them or records the chosen result.
- The ordinary exit does not create a `live-exit` recovery snapshot containing the active cue/subsystem states. The builder is preserved structurally, but the operator receives no explicit saved/saving confirmation.
- No safe **Recover to Rundown** action exists for a failed leave. The controller's existing `reset()` is a session-level reset that clears cue indices and is not an operator-visible Live recovery transaction.
- The only exit control is the generic final item in a wrapping toolbar. The right-side Script Op panel is positioned above the workspace at narrow widths, so the show-critical navigation action has no protected, always-visible slot.

### State Ownership (Pre-Implementation)

| State or action | Current owner(s) | Conflict or gap |
| --- | --- | --- |
| Live lifecycle | `CueolaLiveController` | Vocabulary is shortened; there is no prepare/cancel/commit leave transaction |
| Exit request/cancel | `#exitLiveOv` DOM class and two global handlers | Dialog visibility does not affect lifecycle or dispatch permission |
| GO/cue dispatch | `lsNext()`, row activation/jump, keymap, auto-fire helpers | Permission is inferred from the visible screen, not controller state |
| Flowmingo command dispatch | prompter session controller plus several send helpers | No common Live-leave gate or selected stop/detach policy |
| Playback dispatch/output lifetime | Outrangutan local/session command paths and output manager | No Live exit adapter; controller cannot request stop versus detach |
| Script Operator lifetime | Phase 4 host and Live cleanup registry | Correctly controller-owned after Phase 4 |
| Keyboard holds | page-lifetime keymap listeners plus `_keymapHolds` | Listeners are global/scoped, but an active Live hold is not released by leave |
| Pointer drags | sidebar-resize closures and script-height globals | Transient window listeners are not registered in the Live cleanup boundary |
| Live timers/callbacks | clock, prompter watchdog/handshake, Script Operator watchdog, draft/status timeouts | Core timers are partly owned; transient callbacks remain outside cleanup |
| Active cue and subsystem exit record | controller snapshot, resume state, local recovery history | No immutable exit snapshot or `live-exit` recovery record |
| Rundown, assignments, paperwork | Firestore session model and existing local persistence | Leave does not delete them, but does not confirm pending/saved status |
| Emergency recovery | none | No safe builder return that preserves the production and logs cleanup |

### Root Cause (Pre-Implementation)

Phase 1 introduced a useful single lifecycle controller, but the old exit overlay remained a separate navigation affordance. The UI therefore asks a question without entering a lifecycle state, while cue, prompter, and playback dispatch continue to key off individual screen/feature conditions. Output runtimes expose different lifetime controls, so ordinary cleanup cannot express the operator's stop-versus-detach decision. Persistence, listener teardown, and error recovery are likewise adjacent systems rather than one exit transaction.

The Phase 5 repair will make the lifecycle controller own prepare, cancel, commit, dispatch eligibility, an immutable exit snapshot, and recover-to-builder behavior. The main app will route show-critical commands through that gate, classify active outputs once, adapt Flowmingo/Outrangutan to the selected disposition, release transient Live resources through keyed cleanup, and use a neutral, persistent, output-aware dialog. The prominent **Return to Rundown** control will occupy a protected Live header slot and an error state will expose a safe recovery action.

### Affected Files

- `cueola-live-session.js`: approved lifecycle vocabulary, transactional leave API, immutable exit snapshot, dispatch permission, cleanup registry hardening, and emergency recovery.
- `cueola-app.js`: output classification/disposition orchestration, Flowmingo pause acknowledgment, command gates, saved-state confirmation, transient cleanup, recovery UI handlers, and Outrangutan reattachment on Live entry.
- `outrangutan/outrangutan.js`: observational exit classification, acknowledged renderer stop, transport-neutral detach, and exact-identity controller reattachment.
- `index.html`: protected responsive Return to Rundown slot plus the neutral, accessible output-decision and recovery UI.
- `script-operator.js`: controller-closing now asks the script-opened window to close itself as well as disabling controls, covering browser cases where a replacement opener cannot close the old `WindowProxy` directly.
- `scripts/tests/live-session-controller.test.mjs`: lifecycle, dispatch freeze, immutable snapshot, cleanup, recovery, and repeated-entry regression coverage.
- `sw.js`, `script-operator.html`: mechanically updated cache versions for the changed no-build assets.

### Repair

- Replaced the abbreviated lifecycle with `builder`, `entering-live`, `live`, `leaving-live`, `recovering`, and `live-error`. `prepareLeave()` captures the cue/subsystem exit record and immediately makes `canDispatch()` false; `cancelLeave()` restores the same Live session; `commitLeave()` is the only normal cleanup/navigation commit; `recoverToBuilder()` is non-throwing and preserves production data.
- Routed Live keyboard actions, cue GO/next/previous/jump, live-row activation, playout transport/SFX/auto-fire, row selection, and show-clock changes through the controller gate. Held Brake/Boost commands are explicitly released before `leaving-live`, and the Script Operator receives `controlsEnabled:false` in the same transition.
- Classifies Flowmingo, Outrangutan, and Script Operator once at exit request. No active output returns immediately. Active transport exposes **Stop outputs and return**, **Leave outputs open and return**, and **Cancel** without destructive styling.
- Flowmingo stop sends the ordinary identified pause command and waits on its existing five-second acknowledgment path. Outrangutan stop halts program/SFX, sends correlated `STOP` commands to every open renderer, requires each renderer acknowledgment, and leaves windows safely idle. An unconfirmed stop moves the lifecycle to `live-error` instead of claiming success.
- Detach changes no output transport. Outrangutan preserves exact controller/output identities and `WindowProxy` records while closing listeners, then reclaims the existing renderer on its next heartbeat when Live is re-entered. Pre-detach queued intents are discarded so they cannot replay later.
- Added one keyed `live-transients` cleanup for key holds, sidebar/script pointer drags, jog/reference/row-preview surfaces, draft/status/SFX timeouts, and body selection state. Script Operator, prompter bridge, and clock retain their existing keyed cleanup ownership.
- Exit/recovery snapshots use explicit `live-exit` and `live-recovery` labels. Completion reports **Cloud saved**, **Saved locally · cloud sync pending**, or **Saved locally · cloud sync unavailable** from the actual queue/connection projection; it never equates a local mutation with a server acknowledgment.
- The top bar reserves a responsive, non-scrolling slot for the plain-language **Return to Rundown** action. The decision dialog is focus-contained, output-aware, and keeps recovery persistent beside the failure rather than relying on a toast.

### Why This Is Durable

Lifecycle permission now comes from one controller value rather than overlay visibility or screen classes. Output policy is represented by adapters with serializable before/results and explicit acknowledgments, while renderer windows retain their independent lifetime. Cleanup keys own every Live-only transient, so cancellation runs no cleanup and commit/recovery run each cleanup at most once. Re-entry restores protocol identity instead of manufacturing a second output session or asking the operator to reload a window.

### Regression Risk

- Future Live commands must call the controller gate or flow through an already-gated central path; a new direct inline handler could otherwise bypass the freeze.
- Flowmingo stop deliberately waits up to the existing acknowledgment timeout when talent disappears. This makes failure visible but means a failed stop takes about five seconds before recovery is offered.
- Outrangutan detach retains controller objects in memory until reattach, session change, or full module exit. The preserved record is bounded by configured outputs and is cleared when identities differ.
- A physical second display and Safari remain unavailable in this environment. Browser automation also lost its control channel to the heavily exercised original main tab after the extended scripted matrix; the server/output tab stayed healthy, and a fresh tab resumed the same 24-row Live session. This browser-harness event is carried into Phase 10 rather than being represented as a successful Safari/hardware endurance result.

### Tests Performed

Automated on 2026-07-13 with the repository's bundled Node runtime:

- JavaScript syntax checks for the main app, lifecycle controller, Script Operator client, and Outrangutan controller.
- Avatar compatibility: 8/8 pass.
- Live-session controller: 13/13 pass, including ten simulated entry/leave cycles and cleanup errors.
- Flowmingo protocol: 7/7 pass.
- Script Operator protocol: 9/9 pass.
- Outrangutan output protocol: 11/11 pass.
- Outrangutan command queue: 9/9 pass.
- Outrangutan classify/detach/reattach serialization VM smoke: pass.
- DOM/inline-handler contracts: 4 pages, 751 ID references, 636 handler references, 9 explicit allowlist entries; pass.
- Cache-bump actual/dry run and `git diff --check`: pass. Final changed asset versions are `cueola-live-session.js?v=2999dd8256`, `cueola-app.js?v=b1622c10dc`, `outrangutan/outrangutan.js?v=de298182f6`, and `script-operator.js?v=a0e270f8e1`.

Chromium live preview at `127.0.0.1:8018`, emulator session `STAB26`:

- No-output return skipped the dialog, reached `builder`, retained all 24 rows, and reported `Cloud saved`.
- With Flowmingo scrolling, Return immediately projected `leaving-live`; a forced click on the underlying **Next** control left the active row unchanged. **Cancel** restored `live`, retained `FLOWMINGO RUNNING`, and the next deliberate GO advanced row 1 → row 2.
- **Stop outputs and return** received the Flowmingo pause acknowledgment, retained the talent window at `READY · STAB26` with a **PLAY** control (paused), reached `builder`, and retained all 24 rows.
- **Leave outputs open and return** retained the talent window with a **PAUSE** control (still running), detached the operator, closed the Script Operator subsystem, and reached `builder`. Re-entering Live reclaimed the same output and projected `FLOWMINGO RUNNING` without reopening it.
- Ten consecutive Live → builder cycles each projected `live` then `builder`, kept 24 rows, skipped the decision while outputs were safely paused, and left no dialog behind.
- Dropped an actively scrolling talent window concurrently with exit preparation. Stop timed out honestly into `live-error` with `Flowmingo talent did not acknowledge pause`; **Recover to Rundown** then reached `builder`, kept 24 rows, hid the dialog, and reported `Recovered to rundown · Cloud saved`.
- Closed the exercised main tab and resumed the same production in a fresh tab. Resume restored Live at row 2 with 24 rows and a paused Flowmingo projection, demonstrating the saved recovery boundary.
- Final console contained only the expected App Check-disabled information and Firestore-emulator connection information; no application errors were present in the fresh final tab.
- Visual evidence: `/private/tmp/cueola-phase5-live-final.png` and `/private/tmp/cueola-phase5-exit-final.png`.

`firestore.rules` was not changed: Phase 5 introduces no collection or document-shape change.

### Result

Pass for the Phase 5 implementation and available Chromium matrix. Exit is now a controller-owned transaction, active commands freeze before the operator decides, stop/detach outcomes are explicit and acknowledged, failure has a data-preserving recovery path, repeated entry/exit stays single-owned, and the saved rundown remains intact. Safari, physical-display closure/placement, and the long integrated endurance run remain Phase 10 items.

## Phase 6 — Student Position and Paperwork Assignments

### Reproduction (Pre-Implementation)

Baseline performed on 2026-07-13 against the completed Phase 5 preview and the `STAB26` emulator fixture, before changing Phase 6 code:

1. Resume `STAB26` as the instructor and open **Settings → Planda Bear**.
2. Confirm that the hub currently projects four display-name assignments: Avery Stone / Director, Jordan Lee / Flowmingo Operator, Morgan Cruz / Playback Operator, and Riley Chen / Technical Director, each with paperwork labels.
3. Inspect **Settings → Admin**. Assignment editing is behind the session-admin code, while the currently joined instructor identity alone does not authorize the editor.
4. Trace a main-app assignment change: the editor writes the local `cueola_prepro_{code}` projection immediately, starts a non-awaited `prePro.roleAssignments` update, re-renders, and immediately toasts **Role assignments saved**.
5. Trace a dashboard assignment change: it independently writes the top-level `assignments` name-to-position map and omits paperwork.
6. Open the unsigned profile hub. A student must sign in by username before the portal can attempt assignment aggregation; the active session and resume record still contain only a typed name and role.
7. Trace the portal read order. It prefers a legacy top-level `roleAssignments` array, then `prePro.roleAssignments`, while position lookup first prefers the dashboard `assignments` map. A single card can therefore combine a position and paperwork from different copies.
8. Trace rejected and unavailable reads. Session, assignment, and notes failures are currently collapsed into **Session not available** or **Nothing waiting on you**, so failure is indistinguishable from a confirmed empty result.

The false-save failure is deterministic from the current control flow: `saveRoleAssignmentsFromAdmin()` does not await a cloud result before announcing success. On a rejected write, the failed `roleAssignments` key also remains in `_pbPendingCloudKeys`, which can make the local projection suppress later server reconciliation until reload.

### State Ownership (Pre-Implementation)

| Value | Current source(s) | Competing authority or ambiguity |
| --- | --- | --- |
| Profile identity | `profiles/{username}`, device `cueola_identity` username pointer | Username changes by creating a new profile doc; no immutable profile ID exists |
| Active session person | `session.userName`, resume name, presence name, participant name | Freely typed display name is not linked to the signed-in profile |
| Main assignment | `sessions/{code}.prePro.roleAssignments`, mirrored to device localStorage | Record is only `{person, position, paperwork}` and the local copy is shown before cloud acknowledgment |
| Legacy assignment copies | top-level `roleAssignments`, dashboard `assignments` map | Independently writable, different schemas, unsafe portal precedence |
| Crew position | display label | No stable position ID; multiple rows are writable but readers return only the first |
| Required paperwork | display-label array | Labels can change and are not tied to stable paperwork IDs |
| Assignment save state | local render/toast plus generic cloud dot | No Unsaved, Saving, Saved, Failed, or Conflict state owned by the editor |
| Assignment conflict | whole `roleAssignments` array plus client `Date.now()` field timestamp | Concurrent editors overwrite the whole array; no server revision or precondition |
| Student portal result | one-shot session/notes reads and name matching | Missing, denied, offline, stale fallback, and true empty states collapse together |
| Notes/checklists/actions | note documents with full-name assignee/mentions/seen receipts | Still name-based; canonical assignment identity cannot repair these joins implicitly |
| Authorization | client session role/admin-code UI gates | No Firebase Auth; Firestore sees instructor, admin, and student as the same unauthenticated caller |

### Root Cause (Pre-Implementation)

Assignments never acquired their own canonical persistence boundary. Profile identity, joined-session identity, and assignment identity evolved separately, and compatibility formats remained writers instead of migration-only inputs. The main UI also reuses Planda Bear's local-first generic field merge for an instructor workflow that needs confirmed persistence and conflict detection. Finally, portal aggregation treats display names as keys and suppresses query failures, so even a successful write cannot be proven to belong to the intended profile.

Phase 6 will add an immutable opaque `profileId` preserved across username rename and represented as an alias when profiles merge. Canonical assignments will live under the production at `sessions/{code}/assignments/{assignmentId}`, one record per profile-position pair, with stable profile/position/paperwork IDs, display snapshots, status, assigned-by audit fields, timestamps, and revision. The existing embedded array/map will become an atomically updated compatibility projection and migration fallback, not an independent authority. One server revision on the parent session will gate an atomic transaction across canonical records and compatibility projections.

The instructor editor will keep a confirmed snapshot separate from its draft and expose **Unsaved**, **Saving**, **Saved**, **Failed**, and **Conflict** beside the controls. It will not autosave silently. The portal will query canonical records by the signed-in profile ID (including merge aliases), show multiple positions consistently, and preserve explicit unavailable/denied/error states instead of presenting them as empty.

`firestore.rules` must change in the same phase: profiles need a one-time immutable `profileId` migration and assignment documents need strict shape/bounds/immutable-key validation. Those rules still cannot prove instructor/admin/student authority without Firebase Auth. Production evidence from 2026-07-11 also says the deployed rules deny profiles and new subcollections; owner deployment remains required and will not be performed here.

### Affected Files

- `cueola-assignment-model.js`: dependency-free canonical assignment schema, stable identifiers, migration normalization, compatibility projection, profile alias matching, serialization, and revision conflict detection.
- `cueola-app.js`: stable profile identity propagation, canonical assignment editor, confirmed/draft separation, explicit save states, network/cache discrimination, revision-checked transaction, compatibility projection, and activity audit.
- `cueola-identity.js`: immutable profile identity migration, aliases, profile-bound join identity, canonical multi-role/paperwork portal aggregation, and explicit offline/denied/error states.
- `dashboard.html`: canonical assignment hydration and editing, stable profile verification, revision transaction, compatibility migration, and honest loading/empty/offline/conflict states.
- `firestore.rules`, `scripts/test-rules.mjs`: bounded profile identity migration and canonical assignment document/parent revision validation.
- `index.html`, `sw.js`, `scripts/bump-cache.mjs`, `scripts/check-contracts.mjs`: model loading, Firebase cache-read exports, assignment UI styling, no-build versioning, offline precache, and DOM-contract coverage.
- `scripts/tests/assignment-model.test.mjs`: canonical shape, IDs, migration, paperwork, aliases, serialization, compatibility, and conflicts.

### Repair

- Added one canonical record per profile-position pair with the approved fields: `assignmentId`, `productionSession`, `profileId`, `displayName`, `positionId`, `positionLabel`, `paperworkIds`, `paperworkLabels`, `status`, `assignedBy`, `assignedByLabel`, `createdAt`, `updatedAt`, and `revision`. New profiles receive opaque IDs; legacy profiles receive deterministic compatibility IDs; rename/merge aliases continue to resolve the same person.
- Preserved the repository's existing one-to-160-character production-session identifier contract. Position, paperwork, and assignment IDs are stable and label-independent, so a student may hold multiple roles without name-key collisions.
- Replaced local-first assignment autosave with an explicit draft. The main editor and Dashboard show loading, unsaved, saving, saved, failed/offline, and conflict states beside the controls. A cached snapshot is never called saved, and saving is refused until the server snapshot is confirmed.
- Added a single Firestore transaction gated by `sessions/{code}.assignmentRevision`. It creates, updates, and deletes canonical documents, increments the parent revision, and updates the old embedded array/map only as a compatibility projection. A stale revision preserves the draft and offers an explicit server-copy decision instead of overwriting silently.
- Required every editable assignment to link to one active, unambiguous saved profile. The Dashboard verification view shows stable profile identity, role, paperwork, actor, timestamp, and portal linkage. Legacy name-only rows remain visible for migration but cannot become canonical without a unique link.
- Made the student portal query canonical records for the signed-in profile ID and merge aliases, aggregate all positions and paperwork, suppress completed items, and distinguish true empty from offline, denied, unavailable, and error states. Notes/actions retain profile identity where available with bounded name fallback for legacy records.
- Added bounded network-to-cache fallback reads. If the emulator/network never answers, all three surfaces stop waiting after 4.5 seconds, use available cache only for display, and expose retry without allowing a write or success claim.
- Staged strict rules for profile identity and assignment documents, including exact keys, bounded strings/lists, immutable identity fields, aligned paperwork lists, valid status, timestamp/revision checks, and the parent revision/projection contract. Nothing was deployed.

### Architectural Decisions

Canonical assignments are a production-owned subcollection; the parent session owns the optimistic-concurrency revision and compatibility projections. This keeps record identity granular while allowing one atomic operator save. Display labels are snapshots for audit/readability, not keys. Profile identity is deliberately separate from username so a rename or merge cannot orphan work. The existing unauthenticated architecture means rules can validate data shape and immutability but cannot distinguish an instructor from a student; adding username/password authentication was neither allowed nor attempted.

Firestore Rules has no general list iteration. The staged rules validate paperwork list types, bounds, count alignment, and the rest of the document shape, while the canonical JavaScript model validates every nested paperwork value. Fully unrolling forty element checks would be brittle and was not introduced.

### Regression Risk

- Production continues to reject the new profile/assignment paths until the owner deploys the staged `firestore.rules`.
- A first canonical save rewrites the legacy embedded assignment projections. Older clients can still read them, but concurrent older writers do not understand `assignmentRevision` and should not be used for assignment editing after migration.
- Profile linkage intentionally blocks ambiguous duplicate names. Operators must resolve duplicate profiles rather than creating a name-only canonical record.
- The managed task cannot reach the pre-existing Firestore emulator process on port 8080 (`EPERM`), and a second emulator could not bind another port. Server-acknowledged transaction behavior therefore remains an environmental acceptance item, not a claimed pass.

### Tests Performed

Automated on 2026-07-13 with the repository's bundled Node runtime:

- JavaScript syntax checks for the main app, identity layer, assignment model, and both Dashboard inline scripts; pass.
- Assignment model: 13/13 pass.
- Avatar compatibility: 8/8 pass.
- Live-session controller: 13/13 pass.
- Outrangutan command queue: 9/9 pass.
- Outrangutan output protocol: 11/11 pass.
- Flowmingo session controller: 7/7 pass.
- Script Operator protocol: 9/9 pass.
- Firestore embedded compiler check after the final session-ID rule adjustment: pass.
- DOM/inline-handler contracts: 4 pages, 754 ID references, 646 handler references, 9 explicit allowlist entries; pass.
- Final cache bump and `git diff --check`; pass. Final changed asset versions are `cueola-assignment-model.js?v=d81e0cf353`, `cueola-identity.js?v=9c230d2c7a`, and `cueola-app.js?v=3c9461e54b`.

Chromium live preview at `127.0.0.1:8018`, cached emulator rehearsal `STAB26`:

- Activated the final service worker/assets and confirmed the temporary QA fixture was absent.
- Resumed the 24-row production, opened the session Admin assignment editor, and confirmed all four legacy people link to unique saved profile IDs with positions and paperwork visible.
- After the bounded read timeout, the editor showed **FAILED — Cached legacy assignments are shown, but cloud availability was not confirmed. Reconnect before migration.** Retrying produced the same honest state; no save was attempted or reported.
- Opened the Super Admin Dashboard. It linked the same four participants to stable profile IDs and showed **OFFLINE — 0 cached assignment records shown. Reconnect before saving; cached data is not a fresh confirmation.**
- Signed in without a password as `phase6.avery`. The student portal loaded the cached profile and session, then independently labeled the session, assignments, and assigned actions as offline/not checked instead of showing a false empty result.
- Visual evidence: `/private/tmp/cueola-phase6-assignment-final.jpg`, `/private/tmp/cueola-phase6-dashboard-final.jpg`, and `/private/tmp/cueola-phase6-student-portal-final.jpg`.

The full HTTP rules suite and a server-acknowledged create/update/delete/conflict transaction could not run because this managed task cannot connect to the existing external emulator. The rules compiler and pure contract tests passed, and the live failure path was exercised end to end. Owner rules deployment remains staged and was not performed.

### Result

Implementation complete; environment-blocked for server-confirmed acceptance. Canonical identity, multiple roles, paperwork, migration, conflict handling, and truthful persistence states are implemented and locally verified. The UI correctly fails closed when cloud authority is unavailable. Phase 6 must be rechecked against an owner-reachable emulator or after the staged rules deploy before it can be called a full persistence pass; this blocker does not prevent the local export/UI/orientation phases from proceeding.

## Phase 7 — Paperwork Exports

### Reproduction (Pre-Implementation)

Baseline performed on 2026-07-13 before changing Phase 7 code, using the final Phase 6 shell and the cached `STAB26` rehearsal:

1. Resume the 24-row production, open **Settings → Planda Bear**, and choose **Preview Package**.
2. Inspect the advertised “exactly like the preview” representation. It is one responsive, internally scrolling white panel with dashed DOM page separators, not fixed paper pages; it has no production footer, export timestamp, page number, or repeated table header.
3. Choose **Export PDF Package** while the Firestore connection is unconfirmed and the Phase 6 assignment editor/Dashboard are explicitly offline.
4. Observe that the export neither waits nor warns. It immediately reads localStorage and mutable globals, renders, downloads, and reports **Planda Bear package PDF downloaded** despite having no server-confirmed source.
5. Render the downloaded file with Poppler. The 24-row rundown is forced onto one page at approximately one third of the usable page width/height and is unreadably small. The entire six-page package is landscape because one nested rundown element contains `paper-landscape`.
6. Inspect page boundaries. Explicit package sections are each rasterized as one canvas and scaled to one page; a long section can never flow to a second page. Non-package exports instead rasterize one tall canvas and slice it at fixed pixel offsets, so a row/image/paragraph may be cut between pages and headers do not repeat.
7. Inspect the generated file: six pages, 792 × 612 pt landscape, approximately 95 MB, untagged PDF 1.3, no page numbering or document metadata beyond jsPDF defaults.
8. Compare the Planda Bear hub's four student position/paperwork assignments with the package. The package contains no canonical assignment register at all.
9. Trace renderer fallback. If the preferred HTML path fails, the text jsPDF fallback rebuilds from mutable globals/localStorage and includes Production Notes unconditionally, even when the operator left **Include Production Notes** off.

Baseline visual evidence: `/private/tmp/cueola-phase7-baseline-preview.jpg` and rendered PDF pages under `/private/tmp/pdfs/cueola-phase7-baseline/`. Page 4 is the deterministic unreadable-rundown reproduction.

### State Ownership (Pre-Implementation)

| Export input or behavior | Current owner(s) | Conflict or gap |
| --- | --- | --- |
| Rundown rows/show identity | mutable `beats` / `show` globals plus local draft and Firestore batch queue | exporter reads globals without waiting for `rundownPendingBatches` or selecting a confirmed server snapshot |
| Planda Bear fields | `cueola_prepro_{code}` localStorage plus `prePro` Firestore fields | exporter calls asynchronous persistence and immediately re-reads localStorage; `_pbPendingCloudKeys` is ignored |
| Canonical assignments | `sessions/{code}/assignments/*` plus parent `assignmentRevision` | omitted from the package; old crew labels shown elsewhere are not an authoritative exported register |
| Production Notes | listener/local note array plus attachment cache | metadata/pending state is not part of export readiness; fallback violates the include-notes choice |
| Outrangutan show pack | module-local cue/pad arrays | valid local authority, but it shares the same scaling/slicing renderer and prints user emoji |
| Preview layout | normal modal `.paper-preview` responsive DOM | not the fixed paged representation used by a professional document |
| Generated layout | `html2canvas` raster plus jsPDF | explicit chunks shrink to one page; unchunked documents are cut at arbitrary pixels; no semantic pagination |
| Orientation | inferred by searching the entire HTML string for `paper-landscape` | one nested rundown turns every package page landscape |
| Symbols | emoji, Unicode arrows/pins/camera markers, CSS masks, and system-font substitution | no export-specific deterministic representation or audit boundary |
| Header/footer metadata | individual templates sometimes print ad hoc title/date text | no shared production identity, saved-source revision, timestamp, repeated header, or page count |
| Completion feedback | download call followed by success toast | means only that jsPDF saved a file, not that saved authority, page fit, or content inclusion was correct |

### Root Cause (Pre-Implementation)

The export system treats the interactive preview HTML as both the document model and the pagination model. `exportPaperHTMLAsPDF()` has no concept of saved-source authority, pages, rows, headers, footers, or per-section orientation; it only screenshots arbitrary DOM. Independent state owners expose useful pending/confirmed signals, but no export transaction combines them into one immutable snapshot. Templates also mix user-interface icon conventions with printable content, so browser/system font behavior leaks into the file.

Phase 7 will introduce one export transaction that freezes an identified saved snapshot before rendering. Cloud productions must wait for the rundown, Planda Bear, assignment, and note owners and require a server-backed read; local/demo/standalone workspaces explicitly declare local authority. The package will include the canonical assignment register. A dedicated fixed-letter page renderer will paginate semantic blocks and table rows, repeat table headers, keep rows together, wrap long content, use per-document orientation, and add a production/source header plus timestamp/page footer. Preview and download will use the same page builder. Export markup will use words or embedded export-safe SVG rather than emoji, CSS masks, or system-dependent pseudo-elements.

### Repair (Completed 2026-07-14)

Affected files:

- `cueola-export-model.js` — added the dependency-free authority/readiness model, immutable export snapshot schema, canonical assignment grouping, stable fingerprints, and revision-fence comparison/capture helpers.
- `cueola-app.js` — added one export coordinator for rundown, call sheet, package, saved note, notes log, and explicitly unpublished note-draft exports; added server-only reads, pre/post revision fences, pending/failed-save gates, canonical assignment export, and one fixed-page preview/print/PDF pipeline.
- `index.html` — added fixed Letter portrait/landscape page styling, print-safe typography, repeated table-header rules, page chrome, and the export-model asset.
- `outrangutan/outrangutan.js` — freezes a local point-in-time show-pack snapshot, replaces critical emoji/symbol labels with words, supplies explicit local-source metadata, and uses the identical print representation as fallback.
- `scripts/bump-cache.mjs`, `scripts/check-contracts.mjs`, and `sw.js` — registered and precached the new export model and mechanically versioned every touched JS asset.
- `scripts/tests/export-model.test.mjs` and `scripts/tests/paper-export-contract.test.mjs` — added 23 pure snapshot/authority/difficult-content cases plus a static entry-point, fallback, pagination, privacy, and cache contract.

The export boundary now behaves as a transaction:

1. Flush the current Planda Bear debounce and inspect rundown, paperwork, assignment, and note owners for dirty, loading, pending, failed, conflict, or cache-only state.
2. For a shared production, wait for pending writes, recheck readiness, read the session/assignments/optional notes from the server only, and accept the data only when the before/after revision fence is identical. Recheck local owners after the read so a write that began during capture cannot escape the gate.
3. For Demo/standalone work, freeze a local snapshot and stamp every page **LOCAL DRAFT — NOT CLOUD CONFIRMED**. A composer draft is a separate `unpublished` authority and is stamped **UNPUBLISHED DRAFT — NOT SAVED**.
4. Render preview, generated PDF, and print fallback from the same fixed-page DOM. Tables split between rows with a repeated header. A pathological oversize row/text block is losslessly continued on another page; a final overflow assertion fails the export instead of clipping it. Fonts/images settle before measurement, and late relayout triggers one complete repagination.
5. Production Notes remain package-private by default, and inclusion is read from the frozen snapshot rather than a mutable checkbox. Note attachment metadata is exported, but separately stored image bytes are intentionally listed instead of embedded because those blobs are outside the note revision fence.

Architectural decisions:

- Authority is explicit data, not inferred from whatever DOM happens to be visible. Formal server exports fail closed; local/unpublished artifacts remain useful because their non-authoritative status cannot be omitted from the page.
- The exported canonical assignment register is grouped by stable profile identity and production session. Display names are labels only and never merge identities.
- Interactive SF Symbol masks and UI emoji are removed at the export sanitation boundary. Department meaning remains visible through words and deterministic CSS color keys; user-entered international text is preserved and rasterized into the generated file.
- The PDF stays a compact raster capture of already-paginated fixed pages. This preserves preview parity without adding a dependency or parallel document-layout implementation.

### Verification

Automated verification:

- Syntax: every root `cueola-*.js`, `script-operator.js`, `sw.js`, and `outrangutan/*.js`; pass.
- Pure suites: assignments 13/13, avatars 8/8, exports 23/23, Live lifecycle 13/13, Outrangutan queue 9/9, Outrangutan protocol 11/11, Flowmingo session 7/7, Script Operator protocol 9/9, and entitlements 21/21; pass.
- Paper-export static contract; pass. DOM/inline-handler contract: 4 pages, 755 ID references, 646 handler references, 9 explicit allowlist entries; pass.
- Cache bump dry run is idempotent and `git diff --check` passes. Final Phase 7 asset versions are `cueola-export-model.js?v=b9bc3293de`, `cueola-app.js?v=188abadc17`, and `outrangutan/outrangutan.js?v=db960706bb`.

Chromium operator proof at `127.0.0.1:8018`:

- Activated the final service worker and confirmed those exact asset hashes with zero warning/error console entries.
- Loaded the Demo production, opened **Settings → Planda Bear → Preview Package**, and received eight actual Letter pages. Pages 5–6 are landscape rundown pages, the other six are portrait, the second rundown page repeats its header, every page shows production/source/timestamp/page count, and the local-draft label is unavoidable.
- Downloaded the same eight-page representation. Poppler reports valid PDF 1.3, explicit Cueola title/subject/author metadata, 612 × 792 pt portrait pages plus 792 × 612 pt rundown pages, and a 1.09 MB file. The pre-repair baseline was six all-landscape pages and approximately 95 MB.
- Through normal operator controls, changed the production name to `Cueola International Showcase — Mañana 東京 Finalé QA`, added a long cue and URL-bearing note, and expanded the rundown to 14 rows. The resulting preview/PDF is ten pages, preserves the special characters and URL, repeats the rundown header three times, uses portrait pages 1–5/9–10 and landscape pages 6–8, and remains 1.45 MB. Poppler rendering of page 8 confirms the long row wraps without clipping and later rows remain intact.
- Rejoined the cached 24-row `STAB26` shared production and attempted the same package preview while assignment authority was unresolved. Cueola did not render or download stale data; it reported **Package preview blocked: Assignments is still loading its saved state.**
- Evidence: `/private/tmp/cueola-phase7-fixed-preview.jpg`, `/private/tmp/cueola-phase7-difficult-preview.jpg`, `/private/tmp/cueola-phase7-long-special-row.jpg`, `/private/tmp/cueola-phase7-shared-export-blocked.jpg`, `/private/tmp/pdfs/cueola-phase7-final/`, and `/private/tmp/pdfs/cueola-phase7-difficult/`.

### Result

Implementation and the available local/difficult-content acceptance matrix pass. Preview and generated output now share one page representation; no accidental blank pages, clipped rows, misplaced critical symbols, broken headers, or orientation leakage were observed. The server-confirmed package/assignment acceptance remains environment-blocked by the same external Firestore emulator/rules-deploy condition recorded in Phase 6. That path was verified to fail closed rather than emit stale paperwork; an owner-reachable emulator or staged-rules deployment is still required before claiming the server-authoritative case. No rules were deployed and no commit was created.

## Phase 8 — Live UI and UX Functional Audit

### Reproduction (Pre-Implementation)

Audit performed on 2026-07-14 before changing Phase 8 code, using the final Phase 7 shell, the 24-row `STAB26` rehearsal, the earlier Live proof at `/private/tmp/cueola-phase5-live-final.png`, and expected laptop/operator-window breakpoints:

1. Enter Live at 1280 × 720 and open Script Operator. The top toolbar gives Guide, view, and editor controls similar prominence to show-critical state. The primary advance action is labeled **Next** in a small bottom dock instead of an explicit dominant **GO · Row N — Name** control. The six overview blocks are placed into a five-column grid, so Playout wraps below the show card, and no Script Operator health block is present.
2. In Full Grid, click a Later row body. The active row correctly remains on air, but selection is communicated only with a cyan outline; there is no textual **Selected** state. Activate a row several places ahead: every bypassed row becomes **Done** because rendering uses `i < activeIdx`. Activate a prior row and those same rows become Later/Next again. Skipped, Failed, and Disabled have no model or representation.
3. Compare the same cue in Full Grid, Focus, and the row preview. Ready/Take/GO semantics change between `▶`/`■`, `○`/`▶`, and SF marker icons. The same fullscreen-like symbol is also used for Script Operator popout, and several controls rely on a title alone.
4. Block popups and open Script Operator: the lifecycle controller records `scriptOperator:error`, but the main Live surface exposes only a temporary toast. Interrupt a Flowmingo push: **Update failed** is reset after approximately 2.2 seconds. Reject an Outrangutan session write: the failure is logged/toasted rather than retained beside Playback health.
5. Keep Script Operator open and resize across 901 → 900 px. It changes from an in-flow pane to an 88vw absolute overlay while underlying controls remain active. At 900 px, Outrangutan remains in its wide class even though `.og-lay-medium` CSS exists; JavaScript returns only narrow at ≤720 or wide otherwise, making medium unreachable.
6. Keyboard audit: follow chips and Full Grid row selection are non-focusable `div` interactions. Focus rows declare `role="button"`/`tabindex="0"` but do not activate on Enter/Space. The side-panel resizer has no separator semantics or keyboard operation. Several show-critical targets remain 26–36 px instead of the 44 px production target.

### State Ownership (Pre-Implementation)

| Live state or behavior | Current owner(s) | Conflict or gap |
| --- | --- | --- |
| Lifecycle, active index, selected index, subsystem records | `CueolaLiveSession` controller | active/selected separation is sound, but execution history is absent |
| Completed / Next / Later row labels | `renderLive()` positional comparison against `activeIdx` | history rewrites when jumping; bypassed rows become falsely Done |
| Skipped / Failed / Disabled | no owner | acceptance states cannot be represented or recovered |
| Shared active index | controller plus session `activeIdx`/presence projection | identifies the on-air row, not how other rows reached their state |
| Flowmingo health | Flowmingo controller projected into two bespoke DOM areas | errors time out and copy differs by surface |
| Playback/output health | Outrangutan protocol aggregated into a single chip | detailed failure/recovery is not presented in the shared Live status hierarchy |
| Script Operator health | Live controller subsystem record | no persistent shell projection or recovery action |
| GO/row activation | `lsNext()`, `jumpToLsCue()`, `activateLiveRundownRow()`, and output-specific GO helpers | semantics and labels are duplicated; primary GO is visually weak |
| Cue-line symbols/terminology | Full Grid, Focus, row preview, prompter, and output renderers | contradictory Ready/Take representations and reused ambiguous symbols |
| Errors | subsystem DOM mutations plus toast timers/show log | no one persistent, subsystem-local recovery rail |
| Responsive layout | late `index.html` media overrides plus panel state and Outrangutan JS thresholds | CSS/JS modes disagree; panel opening can unpredictably reflow controls |

### Root Cause (Pre-Implementation)

The lifecycle controller owns only the current transition, while Live history is reconstructed from row position on every render. Positional inference substitutes for an execution state machine, so the interface cannot truthfully distinguish completed, skipped, failed, disabled, selected, and active. The one controller state is then fragmented into bespoke badges/toasts, cue meaning is duplicated across renderers, and responsive behavior is split among unrelated CSS breakpoints and JavaScript thresholds. Accessibility and action priority are applied to individual controls after the fact rather than generated from shared operation semantics.

Phase 8 will add a controller-owned, beat-ID-keyed Live run ledger and keep selected/active orthogonal to execution state. One persistent status/recovery rail will project Flowmingo, Playback/output, Script Operator, and sync failures. The advance control will become a dominant explicit GO action; row states will carry text as well as color; cue verbs/icons will be centralized; production targets and keyboard semantics will be repaired; destructive operations will remain separated/confirmed; and expected laptop/large-monitor/operator-window modes will receive explicit, non-conflicting layout ownership. The ledger is operational client state and will not introduce a Firestore collection, so no rules change is expected.

### Repair (Completed 2026-07-14)

Affected files:

- `cueola-live-session.js` and `scripts/tests/live-session-controller.test.mjs` — added the stable-keyed run ledger, execution transitions, immutable snapshots, and 22 lifecycle/ledger cases.
- `cueola-app.js` — projected the controller state into the Live shell; unified GO, row execution, selection, cue vocabulary, subsystem recovery, keyboard behavior, drawer ownership, and resizers.
- `index.html` — added the named overview layout, persistent status rail, dominant GO control, execution-state styles, accessible targets/focus behavior, responsive drawer/scrim, and semantic separators.
- `outrangutan/outrangutan.js` and `outrangutan/outrangutan.css` — made the visible Outrangutan root the sole owner of reachable narrow, medium, and wide modes and added accessible mode navigation.
- `scripts/tests/live-ui-contract.test.mjs` — added nine dependency-free UI ownership, terminology, accessibility, and responsive-mode contracts.
- `sw.js` and the versioned asset references in `index.html` — mechanically advanced the touched no-build assets.

The Live-session controller now owns a per-run ledger keyed by stable beat identity. Its approved states are `upcoming`, `completed`, `skipped`, `failed`, and `disabled`; `active` and `selected` remain separate controller properties. A forward activation completes the prior active cue and skips eligible bypassed cues. A backward activation preserves terminal history instead of recomputing it from row position. Disabled cues reject activation, failed cues block GO until an explicit recovery, and a rundown reorder retains history by key. Controller state and exit snapshots include a detached, deeply frozen copy of the ledger.

The Live shell now has one explicit **GO to Row N — Name** control. Its enabled state is projected on every lifecycle transition as well as every render, including an empty rundown, so the control never retains stale HTML defaults. Full Grid and Focus use the same **READY** / **TAKE** operation vocabulary and the same text execution states. Selecting a row changes selection only; row-specific GO is the deliberate activation path. Flowmingo, Playback, Script Operator, and cloud sync project into one persistent status/recovery rail rather than transient toast-only failures.

The Script Operator side panel becomes an inert, scrim-backed drawer at the laptop breakpoint; its panel and script-height separators work with pointer and keyboard input. Follow targets and selectable rows are keyboard operable, touched production controls meet the 44 px target, destructive Clear remains separated, and focus/forced-color states are explicit. Outrangutan chooses `narrow` at 720 px or below, `medium` from 721–1180 px, and `wide` above 1180 px from one root-width observer instead of conflicting viewport CSS and JavaScript rules.

### Architectural Decisions

- The ledger is operational client state, not a second persistent rundown. No Firestore collection or rules change was introduced. A late-joining client can stage the authoritative active cue, but it leaves unknown earlier rows `upcoming` rather than inventing completed/skipped history it did not witness.
- Stable beat keys, rather than array indexes, own execution history. The selected row is intentionally orthogonal to the on-air row and ledger state.
- Controller snapshots drive both the status rail and GO availability. Renderers consume the state but do not infer lifecycle from DOM position or transient visual classes.
- The Outrangutan root width is the single responsive authority because the renderer may be embedded, popped out, or displayed beside another operator surface at the same browser viewport width.
- No dependency or build step was added; all new contracts run directly under the repository's bundled Node runtime.

### Regression Risk

- Per-run completed/skipped history is not reconstructed for clients that join after those transitions. Persisting an auditable shared execution log would be a separate data-model/rules phase and was not silently introduced here.
- The fixed in-app preview did not expose arbitrary viewport resizing, so the 721–1180 px and 720 px boundary branches were covered by dependency-free contracts while the 1280 px wide surface and approximately 996 px Script Operator surface were exercised live. The full cross-browser/physical-display matrix remains Phase 10.
- Shared Live state still depends on the owner-deployed Firestore rules/emulator path recorded in Phases 6–7; this phase changed no collection or document shape.

### Verification

Automated verification on 2026-07-14:

- JavaScript syntax for every root `cueola-*.js`, `script-operator.js`, `sw.js`, `outrangutan/*.js`, and repository script/test module; pass.
- Assignment model 13/13, avatar compatibility 8/8, export model 23/23, Live lifecycle/ledger 22/22, Live UI contract 9/9, Outrangutan queue 9/9, Outrangutan protocol 11/11, Flowmingo 7/7, Script Operator 9/9, and entitlements 21/21; pass.
- Paper-export contract and DOM/inline-handler contract (4 pages, 766 ID references, 652 handler references, 9 explicit allowlist entries); pass.
- Cache dry run is idempotent and `git diff --check` passes. Final Phase 8 asset versions are `cueola-live-session.js?v=6a1ac2f19e`, `cueola-app.js?v=97c7134ca2`, `outrangutan/outrangutan.js?v=3a42eb780a`, and `outrangutan/outrangutan.css?v=21993bc9f6`.

Chromium operator proof at `127.0.0.1:8018`:

- In shared rehearsal `STAB26`, entered Live and selected row 4 while row 2 remained active. Full Grid displayed separate **Active**, **Selected**, and **Upcoming** text states, the persistent four-subsystem status rail, unified **READY** / **TAKE** cue lines, dynamic GO, timer, and explicit exit control.
- Opened Script Operator from the status rail. The subsystem advanced through synchronized/ready to active, and the panel and both keyboard separators remained operable.
- In a local instructor workspace, created four cues through normal controls. Jumping row 1 → row 4 completed row 1 and marked rows 2–3 skipped; jumping backward to row 2 retained that terminal history. Sequential GO then advanced to the final cue and changed to disabled **No upcoming cue**. After a reload/entry transition, GO was immediately enabled for the next playable cue without requiring a selection render.
- Opened Playback and confirmed the 1280 px renderer selected the `wide` root-owned mode. The current-URL console contained only the expected App Check-disabled and Firestore-emulator connection information, with no warning or application error entries.
- Evidence: `/private/tmp/cueola-phase8-final.jpg`, `/private/tmp/cueola-phase8-ledger-history.jpg`, `/private/tmp/cueola-phase8-script-operator-ready.jpg`, `/private/tmp/cueola-phase8-script-panel.jpg`, and `/private/tmp/cueola-phase8-playback-wide.jpg`.

### Result

Phase 8 passes the available local/operator matrix. The Live interface now presents truthful persistent execution and subsystem state, keeps selection separate from activation, provides one dominant and lifecycle-safe GO path, and has explicit responsive/accessibility ownership. No rules were changed or deployed, no dependency/build step was added, and no commit was created.

## Phase 9 — Stream Deck Label Orientation

### Reproduction (Pre-Implementation)

Audit performed on 2026-07-14 before changing Phase 9 runtime code:

1. From Cueola's entry screen, choose **Outrangutan → Session**, join `STAB26`, open **Settings → Stream Deck**, and inspect the 15-key mapping panel. It contains action/reference selects only; there is no rendered label preview or simulator, so the image that will be sent cannot be checked before granting WebHID access. Baseline evidence: `/private/tmp/cueola-phase9-baseline-panel.png`.
2. Trace a mapped key. `sdActionLabel()` creates upright text, `sdKeyImage()` creates a fresh square canvas and draws the background/text under the default identity transform, and `canvas.toBlob()` immediately serializes that upright canvas as JPEG.
3. Trace delivery. `sdPaintKey()` divides those unchanged JPEG bytes into 1024-byte HID reports and places the same zero-based key index into every packet. The packet header, chunk length/index, and final-chunk flag match the documented Elgato update-key command; neither delivery nor UI CSS applies an orientation transform.
4. Inspect the model table. JPEG-capable product IDs `0x006D`, `0x0080`, and `0x006C` declare `flip:false`, but no rendering or delivery function reads `flip`. The original `0x0060` and Mini `0x0063` are declared BMP/`flip:true` but are returned early by the JPEG-only paint guard, so this implementation never paints their labels.
5. Compare the generated-asset path with Elgato's device-specific HID documentation. The Classic family (including `0x006D` and `0x0080`) requires a 72 × 72 JPEG rotated 180 degrees before upload, and the XL family (`0x006C`) requires the same 180-degree pre-upload rotation at 96 × 96. Cueola omits that required device-coordinate conversion.
6. The reported physical symptom is therefore deterministic for the supported JPEG path: the device receives canonical upright pixels where it expects a pre-rotated frame, and the LCD's device orientation presents the text upside down. No physical Stream Deck is attached to this managed environment, so the final LCD observation is the reported production symptom plus the protocol trace, not a claimed local hardware reproduction.

### State Ownership (Pre-Implementation)

| Pipeline value | Current owner | Conflict or gap |
| --- | --- | --- |
| Key/action mapping | device-local `sdMap`, persisted inside Outrangutan settings | sound mapping authority, but no label-content options or preview |
| Logical label | `sdActionLabel()` | text only; no icon-only/text-plus-icon or active-state input |
| Label layout | `sdKeyImage()` plus `sdWrap()` | canonical drawing and hardware serialization are conflated; long unbroken tokens can overflow |
| Canvas transform | implicit fresh-canvas default | no explicit reset/clear contract and no paired device transform |
| Device orientation | dead `SD_MODELS[].flip` boolean | ambiguous name, wrong values for supported JPEG models, and never consumed |
| Encoded asset | `canvas.toBlob('image/jpeg')` | serializes canonical pixels directly instead of a model-owned device frame |
| Key position | loop/index `i`, then HID packet byte 2 | direct mapping is consistent across UI, input, and output; not the inversion source |
| HID delivery | `sdPaintKey()` | packetization is sound, but send/encode errors are swallowed and not visible to the operator |
| Preview/simulator | none | operator cannot compare canonical, upload, and simulated physical orientation |
| Physical display | attached Stream Deck firmware/LCD geometry | only hardware or a protocol-faithful simulator can prove the final display |

### Root Cause (Pre-Implementation)

The first incorrect pipeline stage is JPEG serialization. Cueola treats a canonical upright label canvas as though it were already in Stream Deck device coordinates. Elgato requires the supported Classic/MK.2/v2 and XL key image to be rotated exactly once by 180 degrees before JPEG encoding/upload. Because the conversion is absent, the exact upright bytes are packetized and the device presents them upside down. The key index and packet mapping are not inverted, and adding a CSS rotation or another final delivery transform would only hide the missing model boundary.

Phase 9 will separate canonical label rendering from device-frame serialization. A small dependency-free renderer will make orientation explicit per model, reset and clear every render context, pair all transform state with `save()`/`restore()`, keep the canonical preview upright, and rotate the complete text/icon composition once when producing the device JPEG. Unknown/unsupported image protocols will fail closed rather than guess. The Stream Deck panel will expose the same canonical keys and a protocol-faithful simulated display/export seam so text-only, icon-only, combined, line-length, state, position, and repeated-render cases can be verified without pretending that simulation replaces a physical LCD test.

Official protocol references consulted during the audit: Elgato's Stream Deck Classic HID **Key Image** instructions and Stream Deck XL HID **Key Image** instructions, both of which require a 180-degree rotation before JPEG upload.

### Repair (Completed 2026-07-14)

Affected files:

- `outrangutan/stream-deck-label.js` — added a dependency-free canonical-label renderer, explicit supported-device profiles, exactly one model-owned device-frame conversion, JPEG encoding, and HID packetization.
- `outrangutan/outrangutan.js` — integrated the renderer through dependency injection; added deterministic text/icon/state labels, serialized/coalesced repainting, persistent send errors, selectable v2/MK.2/XL simulation, and an orientation-proof export.
- `outrangutan/outrangutan.css` — added the responsive Stream Deck simulator/proof layout, production-size targets, focus/forced-color states, and operator-visible error surface. It intentionally contains no label-orientation transform.
- `index.html` — loads the renderer before the Outrangutan application and references the mechanically versioned Stream Deck assets.
- `sw.js`, `scripts/bump-cache.mjs`, and `scripts/check-contracts.mjs` — precache, version, and contract-check the new no-build module.
- `scripts/tests/stream-deck-label.test.mjs` and `scripts/tests/stream-deck-integration.test.mjs` — added 16 renderer, orientation, model, position, packet, simulator, error, concurrency, and integration cases.

The repaired pipeline has three deliberately separate coordinate spaces. Canonical label content is always rendered upright. A supported device profile then creates a fresh device frame, explicitly resets and clears it, and applies one paired `save()` / `translate(width, height)` / `rotate(Math.PI)` / `drawImage()` / `restore()` conversion before JPEG encoding. The packetizer consumes only that encoded device frame. The simulator reverses the documented device conversion to show the expected physical LCD result; the raw-frame proof deliberately remains upside down because that is the correct upload representation.

### Architectural Decisions

- Orientation is an explicit model property at the image-serialization boundary, not a CSS concern or a final delivery patch. This keeps canonical text and icons upright and prevents a second transform from canceling the protocol conversion.
- Only Cueola's verified JPEG-capable profiles are paintable: Stream Deck v2 (`0x006D`), MK.2 (`0x0080`), and XL (`0x006C`). Original/Mini definitions remain usable for input, but their different BMP output path and unknown devices fail closed instead of receiving a guessed image protocol.
- Every canonical/device render begins from the identity transform and clears its canvas. All later transforms are paired with `save()` and `restore()`, so a repeated render cannot leak state into the next key.
- Key position remains the same zero-based index through mapping, simulation, packet headers, and hardware delivery. The repair does not invert or remap positions because packet tracing showed that stage was already correct.
- Repaints are serialized and coalesced. A burst of transport/cue state changes can request another complete pass, but cannot interleave image packets or silently swallow an encode/send failure.

### Regression Risk

- The simulator implements Elgato's documented image-coordinate behavior and validates every supported position, but it is not a substitute for observing real LCD firmware. No physical Stream Deck is attached to this environment, so hardware acceptance remains explicitly blocked.
- Original and Mini image output remains unsupported rather than being broadened without a complete BMP implementation. Their input events continue to use the established product-specific offsets.
- Safari does not expose WebHID. Its Phase 10 expectation is a clear unavailable-device path, not physical Stream Deck operation.

### Verification

Automated verification on 2026-07-14:

- JavaScript syntax: 31/31 repository JS/MJS files; pass.
- Repository suites: 12/12 files and 128/128 assertions; pass. This includes Stream Deck renderer 9/9 and Stream Deck integration 7/7.
- Entitlements: 21/21 assertions; pass. Overall assertion total: 149/149.
- DOM/inline-handler contract: 4 pages, 766 ID references, 652 handler references, and 9 explicit allowlist entries; pass.
- All 17 managed cache references are current and `git diff --check` passes. Final Stream Deck versions are `stream-deck-label.js?v=c4ae3df80f`, `outrangutan.js?v=f642cd1375`, and `outrangutan.css?v=900667494a`.

Chromium operator proof at `127.0.0.1:8018`:

- Opened Outrangutan session `STAB26`, selected the MK.2 simulator, mapped key 1 to **GO**, and observed the combined triangle icon and text upright on the simulated physical key.
- Switched through v2, MK.2, and XL through normal operator controls. The simulator rebuilt 15, 15, and 32 keys respectively while preserving one upright canonical/device-display orientation and six upright content/state acceptance samples.
- Exported the XL orientation proof through the operator control. The 900 × 1344 PNG contains all 32 simulated physical positions upright, all 32 raw pre-rotated HID frames, and text-only, icon-only, text-plus-icon, multi-line, long-label, and active-state cases. SHA-256: `dc25a6eb6731f4e98fdc88233f0be8b4c46af675e2b1d6f9c3593cd469efdd62`.
- Browser warning/error console entries after the model, mapping, and export operations: none.
- Evidence: `/private/tmp/cueola-phase9-baseline-panel.png`, `/private/tmp/cueola-phase9-stream-deck-simulator.png`, `/private/tmp/cueola-phase9-mapped-key.png`, `/private/tmp/cueola-phase9-proof-ui.png`, and `/Users/jonkost/Downloads/cueola-stream-deck-orientation-006c.png`.

### Result

Phase 9 implementation and the available protocol/simulator acceptance matrix pass. Text and icons share the corrected orientation, all 62 supported key positions are covered, render state does not leak, and the generated HID representation is testable before granting device access. Physical-device LCD observation remains environment-blocked until an actual supported Stream Deck is attached; no hardware result is claimed. No Firestore collection or rules shape was changed, nothing was deployed, and no commit was created.

### Post-Repair Concurrency Finding (Documented Before Follow-Up Edit)

The final Phase 9 audit found one repaint-ownership gap before the Phase 10 run. `sdConnect()` installs `oninputreport` and then calls `sdPaintAll()` directly, while later state-driven repaints use `scheduleStreamDeckRefresh()`. An input report arriving during the initial multi-key/multi-packet paint can therefore start the queued pass before the direct pass finishes and interleave HID pages. A disconnect during an awaited send can also leave that direct pass referring to mutable global device state. The first incorrect transition is the connection path bypassing the single repaint owner, not the renderer or packet format.

The follow-up repair will route initial and subsequent complete paints through one awaited serialized scheduler, bind a paint pass to the device generation that started it, and add a static concurrency contract. The connected-model selector will also show an explicit unsupported option for an input-only Original/Mini device rather than visually falling back to the first JPEG preview profile.

The follow-up repair was completed before Phase 10 execution. `sdConnect()` now awaits the same shared repaint promise used by every later state change. Each complete/key pass captures the connected device object and aborts before further packets when that identity no longer owns `sd`, so disconnect/reconnect cannot redirect an old pass. A concurrent request sets the repeat flag and shares the in-flight promise rather than starting a second writer. The new seventh integration contract enforces that ownership, and the input-only connected-model selector now reports **input only — no image profile**. The full regression rerun passes 31/31 syntax checks, 12/12 suites, 128/128 repository assertions plus 21/21 entitlement assertions, all contracts, cache dry run, and `git diff --check`.

## Phase 10 — Integrated Production Test

### Rehearsal Definition (Pre-Test)

The integrated rehearsal began on 2026-07-14 against the existing 24-row shared QA fixture `STAB26` at `127.0.0.1:8018`. The fixture already contains four stable student profiles, multi-role assignment/paperwork records, six scripted rows, media references, long operator notes, and enough rundown rows to execute the required 20-cue run without manufacturing a second source of truth.

The 30 plan steps are treated as one stateful operator sequence rather than isolated feature demos. Evidence will be captured at the saved-production boundary, Live subsystem/status boundary, cue 20 or later, post-network recovery, post-exit/reload, export boundary, Stream Deck proof, re-entry boundary, and real elapsed +10/+20/+30-minute output checkpoints.

### State Ownership (Pre-Test)

| Integrated state | Authoritative owner | Phase 10 observation |
| --- | --- | --- |
| Rundown and production identity | shared session document plus `CueolaLiveSession` staging | server reads/writes require a reachable owner-deployed Firestore/emulator path; the cached `STAB26` fixture is useful but not server proof |
| Student identity, assignments, and paperwork | canonical profile IDs, assignment subcollection, and assignment controller | cached records can be inspected; student/instructor server visibility cannot pass while the external emulator/rules target is unreachable |
| Active/selected cue and execution history | Live lifecycle controller and stable-keyed run ledger | run locally through at least 20 activations and re-entry without positional re-inference |
| Flowmingo | one controller-owned prompter session and child-window protocol | verify open, ready, pause/resume, close/reopen, and current-session synchronization |
| Script Operator | one child-window protocol plus Live subsystem record | verify one active channel, close/reopen, current cue, and no duplicate delivery |
| Outrangutan playback/output | command queue, output protocol, and Live subsystem projection | verify open, media commands, close/reopen, failure/recovery, and output longevity |
| Export | immutable export transaction with explicit authority | shared export must fail closed if server confirmation is unavailable; local draft proof does not substitute for shared authority |
| Stream Deck labels | canonical renderer, model-owned device frame, HID packet delivery | simulator/export proof is available; physical LCD acceptance requires attached WebHID hardware |
| Browser/platform behavior | Chromium preview plus Safari/WebHID capability surface | Chromium can exercise the full local operator path; Safari and physical hardware are not available in this managed preview |

### Shared-Risk Hypothesis (Pre-Test)

The remaining acceptance risk is integration authority, not another known presentation transform. The same three external boundaries recur across the final matrix: server-confirmed Firestore/rules state for assignment and formal export steps, real child-window/browser focus behavior outside the controlled Chromium preview, and attached Stream Deck hardware. Local subsystem controllers are expected to retain session identity, reject stale/duplicate messages, and surface failure rather than synthesize success when one of those boundaries is unavailable.

No Phase 10 code change is planned unless the integrated sequence produces a new reproducible product defect. If it does, the exact failing step, state owner, and first incorrect transition will be recorded here before any repair begins.

### Integrated Defect 1 — Contradictory Cloud Status (Documented Before Repair)

Reproduction during step 13:

1. Load cached shared production `STAB26` with the Firestore emulator target configured but unavailable for authoritative assignment reads.
2. Observe the builder badge/title: `sync-dot saving` and **Cloud sync saving changes...**.
3. Enter Live through preflight and inspect **System status** without changing network state.
4. The Live rail simultaneously reports **Saved state — Cloud synchronized**.

State ownership and root cause: `setCloudSyncState()` owns the real builder badge state but projects it only into DOM classes/title. `liveSyncStatusRecord()` does not consume that owner; outside explicit browser-offline/reconnecting-chip conditions it invents `{ status:'ready', detail:'Cloud synchronized' }`. A pending initial write, unavailable server confirmation, or other `saving` state therefore becomes a false success in Live. The first incorrect transition is the Live projection fallback, not Firestore metadata or the assignment controller.

The repair will retain one in-memory cloud status record inside `setCloudSyncState()`, derive the Live rail from that same record, map saving to connecting and shared local-only state to disconnected, and refresh the rail whenever its owner changes. No Firestore document, collection, or rules shape is involved.

Repair completed: `setCloudSyncState()` now updates `cloudSyncProjection` before rendering either surface, and the Live rail maps the same `synced`, `saving`, `error`, `local`, and `off` owner states to truthful operation states. After activating `cueola-app.js?v=709c9634c5`, the reproduced builder `saving` state projects as Live `connecting` with identical **Cloud sync saving changes...** detail. The final Live UI contract passes 11/11 focused cases; the integrated dwell screenshots capture the repaired shared projection.

### Integrated Defect 2 — Flowmingo Recovery Dead End (Documented Before Repair)

Reproduction during steps 10 and 18:

1. In Live, choose **Flowmingo**. The talent endpoint is briefly discovered and the rail reports **Talent connected · applying state**.
2. Let the endpoint close or stop heartbeating. After three two-second heartbeat periods, the watchdog correctly reports **Talent unresponsive · missed 3 heartbeats** and the subsystem state becomes `recovering`.
3. The Flowmingo recovery-actions region is empty and remains empty. Re-selecting the toolbar action sees the existing `_prompterTalentWin` handle and only focuses it; it does not create a replacement endpoint.

State ownership and root cause: the prompter session controller intentionally uses `recovering` after `markDisconnected()`, but the generic action-label projection classifies `recovering` as a busy/transient state and therefore hides the prompter recovery action. At the same time, `openFlowmingoTalentWindow()` has no forced-replacement path. The first incorrect transition is mapping a terminal missed-heartbeat condition to a status with neither automatic recovery nor an operator action.

The repair will expose **Recover Flowmingo** for a recovering prompter, close and clear the stale talent-window/output identity on deliberate recovery, and open a fresh output that must complete the normal snapshot handshake. This changes no persisted data or Firestore rules.

Repair completed: a recovering prompter now exposes **Recover Flowmingo**, and deliberate recovery calls `openFlowmingoTalentWindow({ replace:true })`. Replacement closes and clears the stale window, endpoint identity, heartbeat, and handshake record before opening a fresh talent endpoint. The exact current asset `cueola-app.js?v=709c9634c5` was then exercised live: the stalled endpoint exposed the recovery control, activating it moved the rail to **Opening Flowmingo output**, and a fresh controlled talent tab restored `READY · STAB26` before returning to **Talent scrolling**. This is an operator-owned replacement through the existing protocol rather than a focus-only retry.

### Integrated Defect 3 — Fresh-Emulator Rundown Loss (Documented Before Repair)

Reproduction after the Firestore rules contract passed and a fresh long-running emulator started on `127.0.0.1:8080`:

1. Keep the already loaded instructor tab on the cached `STAB26` rehearsal. It still renders **Cueola STAB26 Live Rehearsal**, row 23 of 24, while the cloud rail truthfully reports **Reconnecting — showing last confirmed state**.
2. Choose **Retry cloud sync** and wait for the newly available emulator. The Firebase connection initializes successfully, but the cached rundown has no staged rundown batch, so `syncToFirestore()` returns without writing it.
3. Reload the same instructor URL with `?firestoreEmulator=1&code=STAB26`.
4. `setupFirestore()` finds that `sessions/STAB26` does not exist and writes a metadata-only document containing `code`, `createdBy`, `showName`, `startTime`, `freeMode`, and `createdAt`.
5. The first server snapshot is then adopted as authoritative. Because that document has no `beats` and was created from boot defaults, the interface reports **Cloud sync connected · STAB26**, **Untitled Show**, and zero rows.

State ownership at the failure boundary:

| State | Intended authority | Observed owner during failure |
| --- | --- | --- |
| Existing shared session document | Firestore server snapshot | Correctly absent in the fresh emulator |
| Recoverable local rundown before first server document exists | Current loaded session/draft, pending an explicit bootstrap decision | Rendered in memory, but already equal to `rundownShadowBeats`, so no transaction batch is generated |
| First authoritative session document | One complete, instructor-created bootstrap write | Metadata-only `_setDoc` from boot defaults |
| State adopted after server confirmation | Complete Firestore session document | Incomplete bootstrap document becomes authoritative and projects zero rows |

Root cause and first incorrect transition: recovery/rejoin and first-time server creation share `setupFirestore()` without an explicit bootstrap transaction. The missing-document branch writes an incomplete document from mutable boot state, while the ordinary collaborative queue only writes differences from the local shadow. An intact locally loaded rundown can therefore produce no batch, and the metadata-only create becomes the first server authority. The first incorrect transition is that incomplete creation write—not the emulator, listener metadata, cached snapshot, or later render.

The repair will make missing-session creation one atomic, complete bootstrap operation based on a captured current session payload; it will never overwrite an existing document. The snapshot listener will wait for that decision rather than promoting a metadata-only document, and a focused contract will pin the complete payload and create-only transaction behavior. Because the already restarted emulator has no persisted `STAB26` export, recovery of this particular QA fixture will use Cueola's documented local Session History UI if an intact snapshot remains; no rehearsal data will be silently manufactured.

Repair completed: session role no longer doubles as create permission. The explicit **Create Session** action now performs a create-only Firestore transaction with a complete rundown document; URL, Dashboard, resume, and ordinary join paths install only the listener and never create missing authority. A missing or incomplete server snapshot preserves the per-code local draft, displays a persistent recovery instruction, and blocks both the ordinary rundown transaction and the optimistic cloud-success projection. **Retry cloud sync** now performs a real server read even when networking is already enabled.

Snapshot recovery can recreate a missing or incomplete document only after the existing confirmation. Recovery payloads include show metadata, rundown rows/aliases, custom sources, cues, and the existing restorable paperwork allowlist, while deliberately resetting or excluding presence, participants, active cue, Live status, prompter/playout transport, clocks, commands, kicks/moves, and heartbeats. The same History sheet now exposes **Restore Current Local Copy** when the server session is missing or incomplete; that separate confirmed action recovers the displayed rundown plus locally saved Planda Bear data and production notes.

The live reproduction exposed an additional fixture-retention fact before recovery: all 20 IndexedDB History slots had rolled over to zero-row authoritative snapshots, but the separate per-code local draft still held **Cueola STAB26 Live Rehearsal**, all 24 rows, six script cues, and all six playback references. The repaired build rejected the incomplete server document, rendered those 24 local rows with an explicit error, then recreated `STAB26` through **Restore Current Local Copy**. A full reload returned **Cloud sync connected · STAB26**, the same show identity, and 24 rows. Live preflight received a 51 ms server acknowledgment; Live then rendered row 1 of 24 with the Saved state rail reporting the same connected session. The current-build console contained zero warnings or errors, and the visual proof was captured from the restored Live surface.

This repair does not pretend that a root-session recovery recreates unrelated Firestore collections or device-local media. The fresh emulator still lacks the four canonical profile documents and assignment subcollection records, and Outrangutan's IndexedDB blobs remain workstation-local. That changes later Phase 10 setup: an emulator export/import or deterministic seed must exist before deliberately restarting authority; root Session History alone is not a complete integrated fixture backup.

### Integrated Rehearsal Results (2026-07-14)

| Step | Result | Observation |
| --- | --- | --- |
| 1. Open QA production | Pass | Opened cached shared production `STAB26` as instructor with the expected 24 rundown rows. |
| 2. Assign students | Partial | Four cached student assignments rendered. **Save Assignments** failed closed because only the offline cache was available; no server-confirmed write is claimed. |
| 3. Attach paperwork | Partial | Cached assignment and paperwork requirements rendered for the four profiles, but the unreachable Firestore authority prevented a fresh server-confirmed attachment transaction. |
| 4. Reload the app | Pass against restored emulator authority | After the Defect 3 repair and confirmed local-copy recovery, a full reload returned **Cloud sync connected · STAB26**, the same instructor production, and all 24 rows. |
| 5. Confirm assignments remain | Blocked authoritatively | Cached values remained, but the plan requires persistence across the shared server boundary; the configured emulator/rules target was unavailable. |
| 6. Sign in as a student | Pass locally | Opened Avery's student portal from the cached identity. The portal visibly labeled the profile and session as offline/out of date. |
| 7. Confirm student assignments | Partial | The expected cached assignment rendered, while assignment and paperwork freshness were explicitly reported as not checked offline. |
| 8. Return as instructor | Pass locally | Returned through the dashboard as the Phase 6 QA instructor and reopened `STAB26` with the same 24 rows. |
| 9. Enter Live mode | Pass | Entered Live with row 2 active initially and later re-entered at the preserved cue boundary. |
| 10. Open Flowmingo | Pass | Talent output reported `READY · STAB26`, `✓ Show`, and `✓ Script`; transport and recovery were exercised on the current asset. |
| 11. Open Script Operator | Pass | Script Operator opened, synchronized to the show, and remained active through the final dwell. |
| 12. Open Outrangutan output | Partial | The standalone Outrangutan controller kept its program-output control pressed/open. The managed child renderer was not independently inspectable, and this browser profile contained no media cues. |
| 13. Confirm status indicators | Partial | Flowmingo, Script Operator, and cloud state projected truthfully after the two Phase 10 repairs. The separate standalone playback controller cannot publish same-session status while Firestore is unavailable, so the main Live rail correctly continued to say playback closed. |
| 14. Run at least 20 cues | Pass | Deliberately advanced 20 distinct rows from row 2 through row 22. The execution ledger reported 20 completed, 0 skipped, 0 failed, and 1 active. Evidence: `/private/tmp/cueola-phase10-cue22.png`. |
| 15. Play several media items | Blocked | Both the `STAB26` and standalone controller surfaces in this browser profile reported **No cues yet**. The three repository MP3 fixtures exist, but the managed browser did not expose a successful native file attachment path; no synthetic playback pass is claimed. |
| 16. Pause/resume prompter | Pass | Performed PLAY → PAUSE → PLAY through Flowmingo's visible controls and confirmed acknowledged running/paused state changes. |
| 17. Move focus among windows | Partial | Repeatedly interacted with the controlled main, talent, and playback tabs. Physical multi-display placement and OS-level focus behavior remain unavailable. |
| 18. Close/reopen prompter | Pass | Closed and reopened a fresh talent tab, and separately reproduced the missed-heartbeat recovery state before using the new **Recover Flowmingo** replacement action. |
| 19. Close/reopen playback | Partial | Reopened the standalone program output and confirmed the output control remained pressed. A physical/claimable renderer window and media state were unavailable. |
| 20. Interrupt network | Blocked | The Firestore/emulator target was already unreachable and the managed browser exposed no real network toggle, so a second controlled interruption would not be meaningful. |
| 21. Restore network | Blocked | No reachable authority was available to restore. Local browser connectivity remained healthy. |
| 22. Confirm synchronization | Partial | Flowmingo and Script Operator resynchronized locally after replacement/re-entry. Server-confirmed assignment, export, and playback-session synchronization remained blocked. |
| 23. Exit Live mode | Pass | Used **Return to Rundown** after the cue run; active commands froze through the Phase 5 exit transaction. |
| 24. Return to rundown | Pass locally | Builder restored the 24-row rundown and reported saved locally/cloud sync pending. |
| 25. Confirm no data loss | Pass for root session; profile fixture partial | Production name, role, and all 24 rows survived recovery and a fresh server-backed reload. The restarted emulator had no export for the separate profile/assignment collections, so their earlier records are not claimed as recovered. |
| 26. Export paperwork | Blocked safely | **Preview Package** refused stale cached state with `Package preview blocked: Assignments is still loading its saved state.` This is the intended fail-closed behavior, not a completed formal export. Evidence: `/private/tmp/cueola-phase10-export-blocked.png`. |
| 27. Verify Stream Deck labels | Partial | The integrated MK.2 simulator rendered 15 keys with key 1 mapped to GO, and the Phase 9 XL proof covers all supported positions. Evidence: `/private/tmp/cueola-phase10-stream-deck.png` and `/Users/jonkost/Downloads/cueola-stream-deck-orientation-006c.png`. Physical LCD verification remains blocked without hardware. |
| 28. Re-enter Live mode | Pass | Re-entry preserved row 22 as the active boundary and row 23 as next; a subsequent GO moved exactly once to row 23. |
| 29. Check duplicate actions | Partial | One Live GO produced one row transition and one completion record; one Flowmingo resume/pause pair produced one state change per command. Playback GO could not be tested without media cues. |
| 30. Additional 30-minute dwell | Partial | From 07:16:37 to 07:46:50 EDT, Flowmingo scrolled continuously at speed 5, Script Operator remained active/synchronized, the program-output control remained open, cue 23 remained selected, and all three controlled tabs retained empty diagnostic logs. The temporary long QA script was added and later restored through the visible Live script editor so the run could not end or auto-pause early. Media remained idle because the profile had no cues. Evidence: `/private/tmp/cueola-phase10-dwell3-t00-main.png`, `/private/tmp/cueola-phase10-dwell3-t10-flowmingo.png`, `/private/tmp/cueola-phase10-dwell3-t20-main.png`, and `/private/tmp/cueola-phase10-dwell3-t30-main.png`. |

### Root Cause (Integrated Findings)

The two new product defects were both projection/ownership failures at integration boundaries. Cloud state had a real owner but Live invented a success fallback instead of reading it. Flowmingo had a real recovery state but the UI classified that state as transient while the open helper reused a stale window, leaving no recovery transition. The remaining incomplete acceptance cases are not hidden versions of those defects: they are unavailable external authorities or missing device-local fixtures that the application now surfaces explicitly.

The rehearsal also exposed a test-fixture durability lesson: session-side media references and device-local Outrangutan blobs have different lifetimes. A QA session can retain playback cue references while a fresh browser profile has no IndexedDB assets. Future integrated setup must seed and verify the device-local media store in the exact browser profile before starting the acceptance clock; an open program window is not evidence that media is available or on air.

### Affected Files

- `cueola-app.js`: shared cloud-state projection and forced Flowmingo replacement/recovery path.
- `scripts/tests/live-ui-contract.test.mjs`: focused contracts for the truthful sync owner and recovering-prompter action.
- `index.html` and `sw.js`: current `cueola-app.js?v=709c9634c5` cache references.
- `docs/live-stabilization-work-log.md`: integrated evidence, results, and blockers.

No Phase 10 collection or document shape changed, so no additional Firestore-rules edit was required. The existing `firestore.rules` changes from Phase 6 remain staged only for owner deployment.

### Repair

1. Made `cloudSyncProjection` the common owner for builder and Live saved-state UI, including saving/connecting, error, local-only/disconnected, and synced/ready mappings.
2. Made a missed-heartbeat Flowmingo state actionable and routed deliberate recovery through a forced replacement that clears stale window/protocol identity before the normal handshake.
3. Added the two focused Live UI contracts and bumped every touched cache reference.
4. Preserved the fail-closed assignment/export behavior when shared authority was unavailable; no local cache was promoted to server truth.

### Why This Is Durable

Both repairs remove an invented or stale authority instead of adding timing delays. Saved-state wording now derives from the same in-memory record on every surface. Flowmingo recovery now creates a new output identity and must complete the existing snapshot handshake, so focusing an unresponsive handle cannot look like recovery. The additional contracts pin those ownership boundaries, and the integrated run confirms the local lifecycle still executes commands exactly once after exit/re-entry.

### Regression Risk

- A legitimate long-running `saving` state is now visibly connecting rather than optimistically synchronized; this is intentionally more conservative.
- Forced Flowmingo recovery closes a stale handle. Any browser that refuses scripted close/open will remain visibly recovering instead of silently reusing it.
- Outrangutan assets are device-local. New profiles need an explicit seed/preflight step before media acceptance, independent of Firestore session data.
- Safari, popup placement on a physical second display, and real Stream Deck LCD output remain external acceptance dependencies.

### Tests Performed

- JavaScript syntax: 31/31 files passed.
- Repository tests: 12/12 suites and 130/130 assertions passed.
- Entitlements: 21/21 assertions passed; combined total 151/151.
- DOM/handler contracts: 4 pages, 767 ID references, 652 handler references, and 9 allowlisted entries passed.
- Cache dry run: all 17 managed references current.
- `git diff --check`: passed.
- Chromium operator run: 20 deliberate cue activations, Flowmingo pause/resume and replacement, Script Operator synchronization, Live exit/re-entry, one-command/one-action check, Stream Deck simulator proof, fail-closed assignment/export paths, and a measured 30-minute output dwell with final 0/0/0 browser diagnostic entries.

### Result

**Partial; environment-blocked.** The available Chromium operator path passes the documented local lifecycle, show-control, cue-ledger, Flowmingo, Script Operator, Stream Deck simulator, and fail-closed authority cases. The project Definition of Done cannot be reported as a full pass: server-confirmed assignment/student/export behavior requires a reachable owner-deployed Firestore/rules target; media playback requires the missing device-local assets in this exact profile; Safari, physical external-display behavior, and physical Stream Deck LCD output were unavailable. No deployment, commit, or push was performed, and the preview remains running for review.
