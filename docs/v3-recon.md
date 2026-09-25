# Cueola 3.0 recon (§7.1)

Read-only survey of the code as it is on `main` at the start of 3.0 (commit 2bda83d, 2026-09-15). Every claim below was checked against the code, not the older docs in `docs/` (several of those are stale; the differences are noted). Line numbers are for that commit.

The report is in ten parts: module map · live position model · the playback call · timers and clocks · listeners and Live lifecycle · Firestore writes and the session document · security rules and required-field checks · controllers · Planner (Planda Bear) sync · dead code and duplicates. Bug root causes (P0-1, P0-2, P0-3, P0-4, P1-1, P1-2) are gathered at the end.

## 1. Module map

No build step. The repo root is the site (GitHub Pages, `cueola.live`). Every script is a plain global-scope file or an IIFE that hangs one namespace on `window`.

| File | Lines | What it is |
|---|---|---|
| `index.html` | 7,651 | Every screen's markup plus all app CSS in one `<style>`; Firebase bootstrap at the bottom (exposes `window._db`, `_doc`, `_updateDoc`, `_setDoc`, `_onSnapshot`, `_serverTimestamp`, `_writeBatch`, `_runTransaction` ...). Script tags at 7528-7551 give the load order. |
| `cueola-app.js` | 31,945 | The app: rundown builder, Live screen, Planner (Planda Bear, `pb*`), prompter (Flowmingo, `pt*` / `flowOp*`), Script Op, session/presence/sync, exports, stage plot, preflight, control bus, Stream Deck bridge. One global scope; ~1,720 top-level functions. |
| `cueola-live-session.js` | 699 | `CueolaLiveSession`: the Live lifecycle controller (builder → entering-live → live → leaving-live), `activeCueIndex` vs `selectedCueIndex`, the run ledger (upcoming/completed/skipped/failed/disabled), the cleanup registry, and the pure caller predicate `resolveCallerState`. |
| `cueola-live-state.js` | new in 3.0 | `CueolaLiveState`: the shared `live` record (idx, seq, cueStartedAt, showStartedAt, directorId), sequence-gated adoption, server clock, take gate, duration math. Unwired at the time of this report. |
| `cueola-streamdeck.js` + `cueola-streamdeck-device.js` | 5,079 + ~600 | KeyWi Bird: Stream Deck pages, key editor, WebHID transport, ownership (Web Locks + localStorage beat), the same-tab dispatch into `window.cueolaSurfaceBridge`. |
| `outrangutan/outrangutan.js` (+ `output-protocol.js`, `output-command-queue.js`, `kiosk-transport.js`, `stream-deck-label.js`) | 6,591 | Outrangutan playback: IndexedDB media, A/B decks, the session command consumer (`outrangutan.command` / `commandQueue` / `cmdAck`), output windows. |
| `cueola-prepro-sync.js` | 462 | Planner leaf-sync helpers (dark-launched behind `CUEOLA_PB_LEAF_SYNC`). |
| `cueola-identity.js`, `cueola-pin.js`, `cueola-admin-auth.js` | 2,317 / ~200 / ~450 | Student profiles + PIN sign-in (Cloud Function), instructor Firebase Auth. |
| `cueola-export-model.js`, `cueola-assignment-model.js`, `cueola-session-clone.js`, `cueola-link-state.js`, `cueola-keymap.js`, `cueola-prompter-session.js`, `cueola-script-operator-protocol.js`, `cueola-scriptop-prefs.js`, `cueola-obs.js`, `cueola-avatar-profile.js` | small | Pure models and protocols, each with a node test under `scripts/tests/`. |
| `script-operator.html/js/css` | ~1,200 | The pop-out prompter controls window. |
| `dashboard.html` | 4,356 | Instructor dashboard (sessions, roster, class keys), self-contained. |
| `break-room-show.js` | ~1,500 | The demo show fixture (uses every cue field, so it doubles as a schema witness). |
| `sw.js` | 342 | Offline shell; `WORKER_SCHEMA = '50'` forces a reload on deploy. |
| `firestore.rules` | 600 | Rules; the session document has type checks per field but **no field allowlist** (`validSessionDocument`, rules 126-161), so new top-level fields such as `live` are accepted. |
| `scripts/tests/*.test.mjs` (25 suites), `scripts/check-contracts.mjs` | | Zero-dependency node tests plus a DOM-id/handler contract lint. All green on this branch. |

Screens in `index.html`: `#entry` (front door), `#rundown` (build, 5413), `#liveshow` (5504), `#promptypus` (talent prompter, 5672), `#flowOp` (prompter remote), `#outrangutan`, the Planner hub and pages (`#paperworkHubModal`, 6100-6500), the add-row wizard (`#addRowOv` 5907), row editor (`#editOv` 5989), cue editor (`#cueConfigModal` 6002), Live overlays (`#lsGrantOv`, `#lsRowPreviewOv`, `#lsStartChoiceOv`, `#exitLiveOv`).

Suite hooks that 3.0 must not break: Flowmingo/prompter (`prompter.*` doc fields, BroadcastChannel `promptypus` / `prompt_up_the_jam`, storage keys `promptypus_msg`/`promptypus_ping` and the legacy pair, `?scriptop=` pop-out), Outrangutan (`outCueId`/`outCueName`/`outAuto` on playback cells; `outrangutan.command`, `commandQueue`, `cmdAck`, `live`, `gain` doc fields; `?output=N` windows), the Stream Deck plugin under `talkback/`, OBS (`cueola-obs.js`), the `.cueola`/`.ogshow` file handlers in `manifest.webmanifest`. SwitchUp Studio has no hook in this repo beyond the launcher entry in `.claude/launch.json`.

## 2. Live position model (as built)

Two numbers per device, both owned by `liveSessionController` (`cueola-live-session.js`): `activeCueIndex` (the room's ON AIR cue as this device believes it) and `selectedCueIndex` (this device's cursor). `lsIdx` is a compatibility projection of the cursor (`cueola-app.js:133, 360, 370, 12084`).

On the session document the ON AIR cue is the bare integer `activeIdx`; each device's cursor is `presence.{id}.idx`. A director GO writes both in one `updateDoc` (`syncLiveIdx`, 6486-6504), guarded by `isShowCaller()` and by `_sessionActiveIdxAdopted` (a window must have read one complete snapshot before it may publish `activeIdx`).

**There is no sequence number, timestamp or director id on `activeIdx`.** Adoption (snapshot handler 6143-6157 → `adoptLiveActiveCue(idx, {select:false})`) sets `activeCueIndex` to the document value unconditionally, even backwards (`cueola-live-session.js` `setActiveCue` has no monotonic check). Fields that *do* carry ordering: `showClock` (writer + seq), `controlBus` (id + arrival gap), `liveCall` (stageAt), `busExecutor` (arrival clock), `prompter.controlQueue` (ids).

Followers do not primarily mirror `activeIdx`. A student with no explicit follow target mirrors the **grant holder's `presence.idx`**, else the **newest-`lastSeen` instructor's `presence.idx`**, and only falls back to `activeIdx` when no such entry exists (`resolveFollowedIdx` 13909-13934, applied 6165-6176). Two sources that legitimately disagree.

One GO press (keyboard → `keymapDispatch` 6883 → `lsNext` 13851): gates (lifecycle live, `isShowCaller`, next playable, not failed) → `setOperatorLiveCue` (local state, ledger marks previous done) → `updatePrompterOnAdvance` (script push + 150 ms seek) → `fireOutrangutanAutoForBeat` (starts the playback call if the row is auto-linked) → `maybeArmNextPlayout` → `renderLive()` (full `innerHTML` rebuild of the grid) → `syncLiveIdx()` (one fire-and-forget `updateDoc`, errors swallowed at 6503). No debounce, no in-flight guard; two presses 50 ms apart are two advances and two writes.

Entry points into `lsNext`: the GO button (`index.html:5664`), ArrowRight/ArrowDown (KEYMAP 6808), the Stream Deck NEXT key via the control bus (`cueola-streamdeck.js:124-130` → `cueolaControlBus('rundown','go')` 10393 → 10350), a deck on another machine via the `controlBus` doc field (10538-10568, executed only by the `busExecutor` claim holder), Outrangutan's `rundown_go` (`outrangutan.js:2148`). The deck dial TAKE (`liveSelect(i, true)`, 7079-7086) bypasses all of it: it moves active+selected locally with no gates, no outputs and no `syncLiveIdx`.

Findings that drive the 3.0 design:

1. No ordering on `activeIdx`; a second admin device (two admins pass `isShowCaller` when no grant is out) or a stale tab can move the room backwards, and the director's next GO then re-advances a row already done.
2. Followers mirror presence, chosen by `lastSeen` order, which alternates when a second instructor device browses: the follower's cursor yo-yos between two rows on successive snapshots. This is a plausible "extra beat" on a follower screen.
3. A director who presses GO before the first complete snapshot publishes only `presence.idx`; the later echo pulls `activeCueIndex` back to the older doc value.
4. Row advance is gated by `isShowCaller` (client-resolved), the show clock by `holdsBusExecutorClaim` (12663): two authorities for one seat.
5. Every Go Live wipes the run ledger (`goLive` 12072 passes no `preserveRunLedger`); done/skipped history is local-only and never on the document.
6. The Flowmingo talent screen adopts `activeIdx` changes (6198-6222) and Outrangutan ignores `activeIdx` entirely; only the app's own windows read it.

Docs that contradict the code: `docs/ARCHITECTURE.md:58` ("students mirror activeIdx"), `:26,57` ("live position is lsIdx"), stale line references.

## 3. The playback call (READY · TRACK · ROLL · TAKE)

The four stages are cosmetic. `beginPlayoutCall` (10230) and `stepPlayoutCall` (10246) only write the `liveCall` doc field (one write per stage) and paint the banner; **no Outrangutan command is sent at READY, TRACK or ROLL.** The clip's standby was sent earlier by the previous advance (the delayed 1.2 s `arm` write, 10647) or rode the previous TAKE (`armCueId`, 10276-10283). Only `takePlayoutCall` (10260) reaches the Air: one write of `outrangutan.command` + `commandQueue` with `{action:'cue', cueId, armCueId?, pads?, origId, expiresAt}` through the confirmed-delivery machinery (9782-9901: retries every 2.5 s, up to 2, then a toast).

"Manual TAKE" (`rtrtManual` doc field, 10109-10178) just stops the timer at READY so TAKE must be pressed. The info popover, lesson text and the "See the call" demo describe READY as "the clip goes on standby", which is not what it does.

What each input does during a running call: G / deck playout-GO / banner TAKE fire now; a rundown GO **supersedes** (aborts) the call and starts a new one for the next row, so a fast double GO silently skips a clip; BACK and "Cue here" do not touch the call, so the count keeps running and fires the old row's clip. A second G within a second of a TAKE falls through to a plain Outrangutan `go` and fires the *next* armed clip (9965-9975). Followers see the banner from `liveCall` (never their row); their row moved at READY because `syncLiveIdx` runs right after the call starts (13871), so the room advances ~3 s before the clip plays, and an abort leaves it advanced.

Writes during one automatic call: `liveCall` ×4 (ready/track/roll/take), `activeIdx`+`presence.idx` ×1, `outrangutan.command`+`commandQueue` ×1, `cmdAck` ×1 from the Air. Five or six full-document fan-outs per call; only one moves the row.

What a single TAKE with a per-cue `preRoll` needs: one worker timer (`steadyTimeout`) of `preRoll` seconds, then the **same single write** `fireOutrangutanCommand('cue', cueId, {armCueId, pads})`. No new command actions; nothing changes in `outrangutan/outrangutan.js`. Deletable: `RTRT_STAGES`, `stepPlayoutCall`, TRACK/ROLL stages and CSS, the whole manual-arm subsystem (`_rtrtManualDoc`, `liveCallManualArm`, `setLiveCallManualArm`, `adoptRtrtManual`, `resumeParkedPlayoutCall`, `resumePlayoutCallAuto`, the checkbox, the AUTO button), `runCueCallDemo` and its markup, the Ready/Roll chips and Roll/Out tabs in the cue editor, PREP/OUT helper-row generation, and every string that teaches four stages (list in docs/v3-copy-audit.md). Outrangutan's own per-cue `preWait` stays on the Air and must not be mapped onto `preRoll`, or the two stack.

## 4. Timers and clocks

Every recurring timer that can run while Live is open was inventoried (`cueola-app.js`, `cueola-streamdeck.js`, `outrangutan/outrangutan.js`). **None stacks on Live re-entry**: each is handle-guarded or cleared before creation, and `liveSessionController.enter()` early-returns when already live and runs a `before-enter` cleanup.

| Timer | Where | Period | Stops when |
|---|---|---|---|
| Show clock tick | `startTimer` 20905-20923 | 1000/min(frameRate,30) ms ≈ 33 ms, writes DOM every tick; 1 Hz work gated by `elapsedSecs !== lastTickSec` | Live exit cleanup 12112 (the clock itself keeps running for the room) |
| Wall clock | 20941-20949 | 1 s | Live exit |
| Playout countdown ladder | `syncOutCountdownTicker` 9570-9575 | 500 ms | self-stops when playout idle |
| Link-state ticker | `ensureLiveLinkTicker` 797 | 1 s | guarded, cleared on exit |
| Prompter ping | `_prompterPingInterval` 14884 | | guarded |
| Bus executor heartbeat | `_ensureBusExecutorHeartbeat` 10510-10518 (worker-backed) | 5 s | **never** (page lifetime; ticks self-gate on `liveRuntimeOn()`) |
| Presence beat | 6532-6538 (worker-backed) | 30 s | leave session |
| Flowmingo Op clock preview | 19657 | 500 ms, rebuilds innerHTML | cannot self-stop once its element is gone |
| KeyWi paint / anim / gif / deck beat / OBS | `cueola-streamdeck.js:2403, 2574, 2535, 894, 2798` | 200 / 130 / 100 / 2500 / 250 ms (5 workers) | page lifetime |
| Outrangutan meter rAF, output watchdog | `outrangutan.js:4413, 1333` | frame / interval | no stop path |

Elapsed time is already wall-clock math (`Date.now() - start`, 20896-20907; remote clocks re-anchor from `anchorMs`, 20852-20854), so a backgrounded iPad resumes with the right value and no catch-up burst. **There is no server-time offset anywhere** (`serverTimestamp` is used only for `createdAt`), so show clock, playout countdowns and talent countdowns differ between machines by their clock skew. `steadyTimeout` (10093-10107) allocates a Worker per call and is used for 100 ms slider throttles as well as the call stages. Tick callbacks patch text only; `renderLive()` (full `#lsBody` innerHTML) is event-driven, not timer-driven, but it does run on every snapshot that moves a row or follows a person. `liveLinkState.tick()` ages links by wall time, so a 60 s background flips links to "lost" on the first tick back.

Duration and time formatting is implemented about sixty times across seven files: five copies of seconds → m:ss (`fmtSecs` 2137, `rundownFmtTotal` 26651, `outrangutanFmtDur` 9616, KeyWi 314/1733, Outrangutan 163), three of h:mm AM/PM (`clock` 2195, `paperTime` 29526, `fmtClockFromISO` 28909), two inconsistent 12h → 24h parsers in the same file (`normalizeTimeValue` 2157 vs `timeTo24` 22066). `cueola-live-state.js` now holds the one intended home.

## 5. Listeners and the Live lifecycle

Firestore `onSnapshot` registrations: 10 in total. The session document listener is single-instance (unsubscribe-before-resubscribe at 6026; only caller `enterRundown` 5551; unsubscribed at 2095, 4903, 6067). Others: the Planner group sub-document (21289, `_pbGroupUnsub`), the notes collection (23402, guarded and reset on code change), the Flowmingo Op and talent listeners (20052, 20391, guarded), Outrangutan's session listener (`outrangutan.js:2831`, guarded), the dashboard sessions listener. DOM: the two global `keydown`/`keyup` handlers are registered once (6938-6939); Live rows use inline handlers, so `renderLive` adds no listeners. The prompter bridge (two BroadcastChannels + `storage`) and the talent receiver are guarded and torn down.

The Live cleanup registry is a keyed Map (`cueola-live-session.js:424-432`); `enter()` runs `cleanup('before-enter')` first and `commitLeave` runs `onLeave` then the cleanups. Opening and closing Live five times, then GO, dispatches once.

Lifecycle bugs found instead:

- **A session move while Live** (`followSessionMove` 4901-4919) calls `enterRundown` then `goLive`; the controller early-returns because it is still `live`, so the Build screen shows while `liveRuntimeOn()` is true and deck/bus commands still execute.
- A reload-resumed Script Op pop-out can be closed by the delayed `goLive`'s stale cleanup (registration at 15872-15886 from the snapshot handler races the +300 ms `goLive` at 5579).
- `_pbGroupUnsub` is never cleared on session leave (2085-2115): a previous session's group paperwork keeps merging into local state on the front page.
- `_busExecutorTimer` has no stop path (by design; self-gated).
- The deck Web Lock claimed on Live enter (12151) is released only by `pagehide`/`freeze`.

## 6. Firestore writes and the session document

`sessions/{CODE}` is one hot document carrying the rundown, the Planner package, presence, prompter, playout and control-bus state. Every write is a masked `updateDoc` (field paths) except the rundown, which commits in a read-modify-write transaction.

| Path | Writer | Trigger and cost |
|---|---|---|
| `beats` (whole array) + `rundownAliases` + `rundownBatchId` | `flushRundownSyncQueue` 5947-5972 | every discrete rundown action (21 callers: Save buttons, reorder, delete; no keystroke path). One batch = one transaction, serialized but **not debounced**. A beat averages 620 B; the Break Room show (29 beats) is 18 kB per edit, fanned to every listener. Echo suppression by `rundownBatchId` against `rundownLocalBatchIds` (cap 100). |
| `showName`, `startTime`, `freeMode` | same batch (`showPatch`) | with the rundown |
| `activeIdx`, `presence.{id}.idx`, `presence.{id}.lastSeen` | `syncLiveIdx` 6495-6503 | every caller move; fire-and-forget |
| `presence.{id}` (whole entry) | `joinPresence` 6523 | join; `lastSeen` every 30 s; `participants` via a transaction |
| `controlGrant`, `busExecutor` | 497-526, 10490-10498 | admin grant/revoke; claim heartbeat every 5 s while live and caller |
| `controlBus` | 10393-10409 | deck press that cannot run locally |
| `liveCall`, `rtrtManual`, `showClock`, `forceCmd`, `fixRequests` | see §2-§3, 20811, 14210, 11009 | per call stage; per clock toggle; per admin command |
| `prompter.*` (text, version, `control`, 24-deep `controlQueue`, `controlAck`, `talentHeartbeat`, `talentState`) | 15165-15182, 16039-16043, 16834-16847, 19039-19043 | script push; controls up to ~10/s during a dial scrub; talent heartbeat every 2 s |
| `outrangutan.command`, `commandQueue`, `cmdAck`, `live`, `gain`, `panic` | 9766-9768, 10663; Air `outrangutan.js:3070, 3474` | fire/arm; ack; live packet ~1.4/s while playing, every 3 s idle |
| `prePro.<section>` + `_fieldUpdatedAt.<section>` + `updatedAt` (whole section value) | `persistPreProDataLegacy` 21621-21692 (group sub-document when grouped) | Planner autosave, 650 ms debounce; the leaf engine in `cueola-prepro-sync.js` is dark (`CUEOLA_PB_LEAF_SYNC = false`, 21586) |
| `preProNotes`, `preProActivity` (capped 200), `preProComments` (uncapped) | notes and comments paths | per post |
| `kicked`, `movedTo`, `participants`, `customSources`, `groups*`, `hidden*` | admin and setup paths | rare |

Document outline (types as written): `code, showName, startTime ('' or 'HH:MM'), freeMode, createdBy, createdAt (serverTimestamp or number: both exist), ownerUid, requireLoginCode, status, beats[] {id, style, info, notes, min, sec, done, color, helperFor, helperRole, _createdAt, _createdBy, cues{video|audio|playback|gfx|lighting|script: {on, off, notes, ...type extras, outCueId, outAuto, outCueName, outPadId, outPadAuto, outPadName}}}, rundownAliases{}, rundownBatchId, activeIdx, presence{id: {name, role, profileId, username, avatar, build, lastSeen, following, followingId, idx, groupId}}, participants[], controlGrant{}, busExecutor{}, controlBus{}, liveCall{}, rtrtManual{}, showClock{}, forceCmd{}, fixRequests{}, prompter{text, version, updatedAt, control, controlQueue[], controlAck, talentHeartbeat, talentState, sessionId...}, outrangutan{cues{}, pads{}, live{}, command{}, commandQueue[], cmdAck{}, gain, panic}, prePro{callSheets[], safety{ppe[], ...}, schedule{}, roleAssignments[], positionsCustom[], positionsRemoved[], paperworkEnabled{}, plotBank, plots[], _fieldUpdatedAt{}, updatedAt}, preProNotes, preProActivity[], preProComments[], groups[], groupsLocked, kicked{}, movedTo{}, customSources{}`. Sub-collections: `notes`, `files`, `groups/{id}`, `assignments`, `snapshots`.

## 7. Security rules and required-field checks

`validSessionDocument` (`firestore.rules:126-161`) has **no field allowlist**, only optional type checks (`beats is list`, `presence is map`, `prePro is map` ...). A new top-level `live` map, new `prePro` keys, and `prePro.safety.ppe` as a string array are all accepted. Any Cueola principal (student PIN token or instructor) may write any session field; rundown and director authority are client-side only. Sub-collections (`notes`, `files`, `snapshots`, `assignments`) and `profiles` are closed with `hasOnly`. `optionalShortString` rejects empty strings, so an empty `showName` or `createdBy` fails the rule and the rundown batch retries every 1.5 s forever (5993). Student clients issue `deleteDoc` on notes and files that rules deny to non-admins (23332, 24137), leaving orphans.

Required-field checks in the app: the paperwork export gate requires ≥3 real PPE items when the safety plan is enabled (`validSafetyPpe` 29018-29034, gate 31434-31438; "None"/"N/A" rejected by design at 29021); the assignment save refuses the whole draft if any row lacks a profile or position (4631-4634); the preflight rows (10858-11747) warn but never block ("Continue Anyway").

## 8. Controllers (keyboard, Stream Deck, control bus)

Surfaces: keyboard (`KEYMAP` 6807-6845, two document listeners attached at parse time; scope = `live` when `#liveshow.on`), Stream Deck via `cueola-streamdeck.js` (WebHID; ownership by Web Lock election + a localStorage beat; NEXT/PREV/TAKE/ABORT are bus verbs into `cueolaControlBus`, playout keys go through `cueolaSurfaceBridge.playoutTransport`), a cross-machine control bus (`controlBus` doc field, executed by the `busExecutor` claim holder), and Outrangutan's own `rundown_go`. No gamepad, clicker or presenter-remote support exists.

Why controls "didn't respond at first" on a cold reload into Live (stacking causes, all verified):

1. The instructor is not the caller until `adminSession` restores asynchronously (Firebase Auth plus an `admins/{uid}` read; `resolveCallerState` needs `hasAdminSession` or the grant from the first snapshot). Until then NEXT/PREV only browse, with the wrong toast "The instructor is calling the show", GO is disabled, and every deck bus key is dimmed.
2. GOs pressed before the first session snapshot are never published (`_sessionActiveIdxAdopted`, 6502) and the first snapshot reverts them, silently.
3. `keymapDispatch` swallows every live hotkey while the lifecycle is not `live` (6897-6902, no notify) and while focus sits on any button, overlay or the sidebar (6917-6922); nothing blurs the GO button after a click, so ArrowRight after a mouse GO is dead.
4. The auto Go Live on reload fires 300 ms after `enterRundown` with draft beats; an empty draft gives "End of rundown".
5. The deck fails closed without a `CueolaIdentity.identity()` (`cueola-streamdeck.js:4907-4919`); the election/steal (785-802, 917-946) and the standby-loser paths log to the console only; replug recovery can wait for the 20 s election timer.

Status today: deck status lives only on the Build-screen Systems chip, the preflight row, the KeyWi chip and the grant banner; the Live status rail has no controller or director row. The deck dial "take that row" on a follower selects only and reports success.

## 9. Planner (Planda Bear) sync

The Planner's inbound sync (`mergePreProFromCloud` and `pbApplyRemoteCollab`) lives inside the session-document `onSnapshot` that only `setupFirestore()` installs (6034, 6122-6130, 6340), and `setupFirestore()` is called from exactly one place: the rundown entry path (5551). **Devices that enter through "Open Planda Bear" (`joinPreProSession` 5337-5405) never attach it**: they get one `getDoc` merge at join and one per hub open, then nothing. No field refresh, no presence strip (`currentPresence` is only set in that handler), and `sessionGroups()` is blind because `sessionSnapshotLatestDoc` is set only there, so grouped classes joined this way write to the parent document. Devices that entered via the rundown do sync, section-granular, last-writer-wins: every 650 ms autosave rewrites the whole `prePro.<section>` value stamped with raw client `Date.now()` (21652-21674); the stamp compare `serverAt >= localAt` (21823-21826) has no skew guard, so a device with a slow clock silently drops remote edits; a remote clobber of a just-typed field becomes a visible revert after the 10 s `pbFieldRecentlyEdited` hold. Save feedback exists (chip states 21489-21512) but is rendered only in the form-page nav slots, clears optimistically, and models outbound writes only. The on-screen name is "Planda Bear"; no "Plan to bear" string exists. `PB_COLLAB_PLAN.md` says the leaf engine shipped; the code says it is dark.

## 10. Dead code, duplicates and the baseline numbers

Baseline (before 3.0): `cueola-app.js` 1,638,487 B / 31,946 lines / 460,659 B gzipped; `index.html` 704,574 B of which CSS is 498,690 B (71 %), markup 200,315 B; `dashboard.html` 284,992 B; first-party served total 4,244,984 B over 71,617 lines (vendor libraries another 2.71 MB). Scripts to re-measure: scratch `baseline.mjs`, `deadcode.mjs`, `css.mjs`.

There is almost no dead JavaScript: 9 of 1,720 top-level functions in `cueola-app.js` have zero references (`renderLiveNext`, `openLocalPlandaBear`, `outrangutanRowSummary`, `setRundownExportColumns`, `ptLoadFromCueola`, `dockScriptOpPopout`, `plandaBearAssignmentOptions`, `ptCurrentPlainText`, `savedTalentScreenIdentity`), no duplicated top-level names, no commented-out blocks, no TODO markers. The mass is elsewhere:

- CSS: 3,719 rules, 200 `!important`, 222 classes never referenced anywhere, 292 fully orphan rules (30 kB), 103 selectors declared two to four times in layers (`.ls-operator-drawer` ×4, `.pb-modal-body` ×4). `.live-row-next` / `.live-row-done` (index.html 483-506) are dead: the runtime emits `live-row-upcoming|completed|failed|skipped|disabled`. 21 unused custom properties. Theme tokens are copy-pasted into `dashboard.html` (56 shared selectors).
- Duplicate bodies: `normalizeTimeValue` (app ≡ dashboard), `initializeCueolaAppCheck` (index ≡ dashboard), `steadyInterval` (obs ≡ streamdeck), `pbAgo` ≡ `fmtAgo`, `scriptOpNextCueIndex` ≡ `scriptOperatorNextCueIndex` (same file), `finite()` ×5 modules; three protocol modules share ~25 function names and several byte-identical bodies; `outrangutan/output.html` re-implements `runFade`, `openDB`, `makeKeyer`.
- Dark paths: the Planner leaf engine (`cueola-prepro-sync.js` + the `syncPreProLeavesToFirestore` branch); the `prompt_up_the_jam` compatibility channel and double-written storage messages (14491-14492, 16671-16672); `setRundownExportColumns` dead so `cueola_rundown_export_columns` is a constant.
- Legacy shapes on the hot path: `migrateBeat`/`migrateOldCue` (4968-5014) run over every beat on every snapshot for fields (`cueData`, `clipName`, `gfxType`, `fixture`, `transition`) that appear nowhere else; `getCueOn/Off` treat `ready/take` as the legacy fallback while two live writers still mint `{ready:'', take:''}` cells (13739, 19340).
- 21 of 49 `window.X =` exports in `cueola-app.js` are consumed by no other file.
- The contract lint `scripts/check-contracts.mjs` omits about eleven modules that `index.html` loads (`PAGE_CONFIG` 160-165).

## 11. Bug root causes

**P0-1 PPE cannot be added → export blocked.** A render bug, not sync or rules. `renderSafetyPpeList` (29041-29045) runs the list through `normalizeSafetyPpe`, which drops blanks, before rendering; so the `''` that `addSafetyPpeRow` (29070-29077) pushes never appears, every other untyped row is deleted at the same moment, and focus targets a row that does not exist. A student who types one item and taps "Add PPE item" is left with one row and can never reach three, so `validSafetyPpe` stays false and the package export refuses with a toast that neither opens the plan nor scrolls to the field (31434-31438). Autosave for PPE inputs does work (delegated modal listener 22284-22310 → 650 ms → `saveSafetyPlan` 29660), the remote-refresh guard (22026-22034) is adequate, and rules only require `prePro is map`. Introduced in `fedafde` (2026-08-30), the commit that added the PPE block. "None"/"N/A" rejection is explicit policy (29021, 31437).

**P0-2 Planner live sync dead.** See §9: hub-only joins never attach the session listener; the rest is whole-section last-writer-wins with client clocks.

**P0-3 Extra beat / glitchy live cues.** Ranked causes: (1) on the 9/4 build the deck's playout GO had no armed-call check, so a deck GO during the READY count fired the standby immediately and the automatic TAKE fired the same clip again ~3 s later (`git show 231eb34^:cueola-app.js` 6958-6962; fixed 9/13, but the single-verb TAKE removes the class). (2) Followers mirror a person's presence cursor chosen by newest `lastSeen`, which alternates when a second instructor device browses (§2). (3) `activeIdx` has no ordering: a second admin device or a director who pressed GO before the first snapshot moves the room backwards, and the next GO re-advances a done row (§2). (4) The grant/presence rule can make the admin and the granted student simultaneous callers after a 90 s presence lapse (no tie-break). (5) `claimForLive` deck hand-over has a window in which a second Pro window republishes a NEXT already run. (6) `maybeArmNextPlayout` still uses the pre-9/13 local-instance guard (10631-10639), so during a 12 s Air-heartbeat gap the standby arms the Pro's hidden Outrangutan instead of the Air. (7) A timed still with continue=Follow auto-fires the list-next cue on the Air, then the caller's TAKE fires the row's cue explicitly. No path was found where one physical press reaches `lsNext` twice on one machine; timers do not stack; elapsed is not a counter.

**P0-4 Controllers slow to respond.** See §8: async caller truth, pre-snapshot GO loss, silent hotkey swallowing on focused buttons, and no status row.

**P1-1 Positions created from a note don't save.** There is no note-to-position feature in the code. The closest: note to-do → Production Schedule checklist (`pushTodoToProductionSchedule` 25013-25035, which has a real bug: `.map(normalizeProductionChecklistRow)` passes the index, so blank rows get default text stamped), note → rundown row (`pnAddAsNewRow` 25980), and roster-chip draft assignment rows (4349-4365) that persist only after "Save assignments" and are rejected wholesale if any row lacks a position (4631-4634). Custom positions come from `window.prompt()` (4099), which is a no-op in an iPad home-screen app. Needs Jon's answer to §8 question 9 to pick the right target.

**P1-2 Time field defaults to 12:30.** "12:30" appears nowhere in the tree, any branch's history, or seed data, and every hydrate path writes `''` for unset. The most likely origin is by design: new and fill-from-roster crew rows on the call sheet inherit the sheet's Call Time into their per-person time cell (31297-31307, 31329, 31342); the schedule's Doors auto-links from the call sheet (29771, 29794, 22049); and iPadOS commits a native time picker's initial value on first touch. Fix direction: never copy a time into a new row, store `null`, show a placeholder, and add a regression test that every new show, cue, call-sheet and schedule entry hydrates blank.

