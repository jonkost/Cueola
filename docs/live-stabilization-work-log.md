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
