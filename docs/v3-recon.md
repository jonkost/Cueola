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

<!-- sections 4-10 and the bug root causes are appended as the remaining recon lanes report -->
