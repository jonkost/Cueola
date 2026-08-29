# Pre-Show Fix Plan: audit results + rounds 1, 2, and 3

2026-08-18. Companion to the owner's "Cueola Pre-Show Fix Plan" (Thursday show). This file records what the full-codebase audit found for each plan area, what each round built, and what remains. All audit claims below were verified against the code with file and line evidence during the audit passes.

## Round 3: the capability switch, jump to line, and the deck gaps

### Rundown-operator capability switch (plan item 1, built)

Control is now a capability, not a job title. The session doc carries a `controlGrant` field ({ username, displayName, grantedBy, ts } or null); an admin hands the wheel to any signed-in student by tapping the CALLER badge on the Live screen, which opens a picker of everyone active in the session with a profile (people assigned Director or TD positions sort first and are tagged "suggested": positions carry sensible defaults, the instructor always chooses). Take back is one tap on the same picker. What the grant does:

- The predicate: `resolveCallerState` treats a device whose signed-in PROFILE USERNAME matches the grant as privileged, exactly like an admin session. Identity is the profile username, never the display name (spoofable presence text) and never a role flip (roles carry instructor-wide powers the grant must not). Every `isShowCaller()` gate follows automatically: GO, jumps, playback calls, the control bus, the busExecutor claim, the shared clock, prompter session mint and reclaim.
- The granted student is a STANDARD caller: sequential advances plus the confirmed "Cue here" jump rail, never the admin-anywhere powers. The admin keeps full control alongside them.
- Followers re-route: undecided students mirror the grant holder instead of the first instructor, and the CALLER badge names the holder for the whole room. The grant adopts before follower routing in the snapshot handler, so the very snapshot that moves control also re-routes. A holder whose device drops shows as "CALLER · name (offline)" with a take-back nudge, matching where followers actually rerouted (the instructor). The holder never mirrors their own stale presence echo.
- Toasts on the holder's device on gain and loss, with a regrant saying who control moved to. The GO tooltip for locked students names the current holder.
- Enforcement is client-honored, the same level as the existing instructor block (Firestore rules cannot tell roles apart on session-doc writes; documented and accepted since the PIN round).

### Jump to line (plan item 3, built)

A Find box in the Script Op Cue section (inline desk, prompt-op overlay, AND the pop-out): type a few words, Enter or Find, and the talent display GLIDES the first matching script line to the read line. The search runs forward from the current read position and wraps, so repeating the find walks through repeated phrases. It is pure repositioning: never pauses, never resumes, never changes the live-row context, re-baselines hold boundaries at landing. Rides the existing collaborative control channel (`seek_text` with the query as payload), so it works cross-machine and same-machine alike. Known niceties not built: a no-match currently reports as a generic "applied" on the operator side, and a phrase in the last half-viewport of the script lands as close as max scroll allows (same as row cues).

### Pop-out Script Op de-drift (plan item 3, built)

The pop-out's [CHAT] Paste and Paste-Push buttons are GONE, matching the in-app removal from D12.6 (they appended clipboard text into the rolling script and re-pushed the whole thing mid-read, the exact show-day hazard). Audience copy rides the Question lane, which the pop-out already has. The pop-out also gained the same Find control as the desk.

### Stream Deck gaps (plan item 4, built)

- Clock keys now ride the control bus: a deck on a host tab that cannot drive the clock publishes the verb and the claim-holding caller machine executes it, instead of dead-ending with a local toast. Verbs already satisfied by the current state stay quiet no-ops; local refusals route silently.
- Machine-local actions (talkback, all OBS keys, Go Live) are labeled: a "this machine only" suffix in key tooltips and an orange THIS MACHINE chip in the key editor, so a multi-machine rig cannot be laid out with keys that silently act on the wrong computer. The master-volume and OBS-program dials remain local by nature (dial editor labeling is a follow-up).

### Round 3 hardening

The round went through the same adversarial review in three passes (interrupted twice by rate limits and server load, then completed in full: three lenses, every finding adversarially verified). Nine distinct confirmed findings, all fixed:

- A Find landing mid-advance could strand the auto-resume flag: talent parked with no hold state now, ghost auto-start on a later advance. Repositioning (find or scrub) now cancels pending resume intent, and a stale flag can never leak across unrelated advances while the rapid double-advance carry still works.
- Grant adoption ran after follower routing in the snapshot handler, so the very snapshot that moved control routed followers with the OLD grant. Adoption now runs first.
- The badge kept naming an offline grant holder while followers had rerouted to the instructor; it now shows "(offline)" with a take-back nudge.
- A granted student's surface could capture the busExecutor claim and lock the returning instructor's own clock buttons behind it; the claim now records whether its holder is an admin surface, and an admin outranks a non-admin claim on return.
- Deck clock verbs on a non-claim caller surface were swallowed instead of riding the bus (the toggle now reports refusal honestly and the bus falls back), and a solo or demo operator with Live closed got a completely silent dead key (now a toast, per the no-silent-refusals rule).
- A regrant toasted "back to the instructor" on the old holder's device instead of naming who control moved to.
- The grant holder could be yanked by their own stale presence echo (self-follow guard, both the grant route and the student activeIdx fallback).
- Find only searched paragraph lines, so DOCX-imported Word headings and list items were silently unfindable; the search now covers every block-level line the sanitizer can emit.
- A find that matched nothing acked as a success ("seek_text applied", raw action id and all); a miss now reports "No script line matches that text" and the control has a human label everywhere.

The full contract suite runs green (31 test files, including the Script Operator parity suite extended to cover the find channel and to pin the Paste-Push removal). Browser-verified end to end: the predicate matrix (student locked, granted student drives, grant-while-following stays locked, admin and solo unchanged), find forward and wrapping with exact read-line landings, the stranded-resume fix, and the double-advance resume carry.

### Round 3 release levers

`sw.js`: `WORKER_SCHEMA = '39'`. Content hashes bumped for every module this pass touched: `cueola-app.js?v=7b85188b08`, `cueola-live-session.js?v=531f7b74bc`, `cueola-admin-auth.js?v=5a8797d226`, `cueola-streamdeck.js?v=57a816014a`, `script-operator.js?v=ffeaeb8cdf` (in `index.html`, `sw.js`, `script-operator.html`, and `dashboard.html` as applicable). No Firestore rules changes: the grant field rides the existing session-doc write floor, client-honored like the instructor block.

## Round 2: sign-in speed + Planda Bear roster, call sheet, and paperwork manager

Owner asks this round: assign positions AND paperwork from the roster in Planda Bear, roster populates the call sheet, one place to reference and edit it all, and see plus select/deselect the paperwork required for a show code from inside Planda Bear. Plus the admin sign-in slowness. Everything below went through its own 18-agent adversarial review (14 confirmed findings, all fixed) and was verified in the browser, including a live end-to-end run of the dashboard against production data.

### Admin dashboard sign-in (fixed)

- The duplicated `admins/{uid}` authorization read is gone: `resolveSession` keeps one in-flight resolve per uid, so the interactive sign-in and the auth-state echo share a single token check and a single Firestore read. This also kills a race that could flash "not an authorized admin" at a real admin.
- The 60-second full-collection poll is gone. Ambient updates ride a snapshot listener: after the initial emission Firestore sends only CHANGED documents, so joins, presence, and status flips appear in seconds while the recurring whole-project download disappears. Emissions are throttled to one card-surface rebuild per 5s (live shows write about 1.4x per second), parked while the tab is hidden, a modal is open, or Accounts is up, and flushed when the coast clears. A listener error does a guarded one-off load and retries in 30 seconds. A render-only 60s tick ages out stale presence chips (they used to depend on the poll).
- The sign-in button is enabled from first paint; `loginAdmin` waits for the Firebase bootstrap itself, and a login-in-flight flag keeps the auth module's ready() settle from clobbering the button mid-sign-in.
- Explicit flows (Refresh, create, delete, restore, next episode, test show) still use their awaited one-off loads, unchanged.

### Planda Bear crew roster (built)

The Position Assignments card on the hub now carries an "In this session" roster strip: everyone in the session (participants plus live presence) shown as chips. Assigned people show a check. A joined-but-unassigned person with a saved profile is a one-tap "+ Name" button that appends a prefilled assignment row (profile preselected, cursor lands on the position picker). People without a profile are named with a tooltip saying they need one (the save requires a profile). The strip refreshes with every draft change so it never offers a duplicate add.

### Per-person paperwork picker (fixed + extended)

- Stage Plot is now assignable per person (it was missing from the picker entirely).
- The picker honors the show's paperwork config: items turned off for the show are not offered for NEW assignment, while already-saved selections always render checked (by stored id or label) and round-trip losslessly through drafts, disables, and re-enables. Previously a disable could silently uncheck saved selections and the next save stripped them permanently.
- Deleting a call sheet now strips its per-person assignment ids and labels together (they pair positionally; the old label-only strip mis-paired ids onto surviving deliverables), and legacy id-less rows keep their legacy shape.

### Call sheet: populate from roster (reworked)

The Fill from roster button (which already existed) now: aggregates multiple positions per person into one row ("Director / TD"), UPDATES an existing row's position when the roster changed (keeping any typed email, phone, and call time), adds missing people, never touches manually added rows, and saves immediately (it used to sit unsaved until the next keystroke, so fill-then-close lost it). The toast reports added and updated counts.

### Paperwork manager in Planda Bear (built)

A "Paperwork for this show" card on the hub, visible to instructors (same gate as other structural edits, disabled while grouped): one toggle chip per paperwork item showing on/off for this show code, tap to flip at any point. Off means hidden for the whole crew (cards, nav, deep links) and skipped in the package export; saved work is kept and returns on re-enable; Production Notes stays always-on by design. Writes go directly to the parent session doc (masked patch, same idiom as the dashboard editor, never diff-gated) plus the local mirror, with optimistic UI. Remote toggles (dashboard or another instructor) re-render an open hub live via a config fingerprint on the session listener. A LOCAL or demo workspace reads and edits its own local config, never a previously joined show's.

### Round 2 release levers

- `sw.js`: `WORKER_SCHEMA = '38'`; `cueola-app.js?v=06a99a9a70` in both `index.html` and `sw.js`.
- No Firestore rules changes. The dashboard and auth module have no service worker involvement; a normal hosting deploy carries them.

## Round 1: built and verified in this pass

### 1. The two reported prompter bugs are FIXED (one shared root cause)

The audit confirmed both "jumping back and forth" and the "random talent display change" came from the same mechanism: every script push and every rundown advance sent a complete state snapshot carrying the operator's mirrors of the talent's scroll position (stale by up to one 2s heartbeat) and the operator's local display settings (size, theme, align, mirror). The talent hard-applied all of it. A reloaded operator window (size back to 52, its own theme) silently restyled the talent on the next push; every GO rewound the talent to a position 0 to 2 seconds old.

Fix: snapshots now carry a scope.

- `seed` scope (talent READY handshake, explicit init): full snapshot, restores script, look, position, play state. A freshly booted talent window still inherits everything.
- `sync` scope (routine pushes, advances, silence recoveries, session reclaims): script and identity only. Display and position/running/speed are stripped from the message, so even a talent running older code falls back to its own live values through the protocol's normalize chain. The talent side also gates on the scope as a second layer.

Supporting hardening: talent heartbeats now carry the talent's display truth (size, align, theme, mirror), so operator mirrors converge every 2 seconds instead of only on control acks. `ptFontSize` and `ptAlign` now persist in localStorage like the theme. The operator's talent-position follow scroll is smooth instead of snapping per heartbeat.

### 2. Rundown as the source of truth (supersedes old directive D11.2)

- Advance, back, and confirmed jumps now push copy and then cue the prompter to the landed row (`updatePrompterOnAdvance` sends `seek_row_N`).
- Row seeks GLIDE: `ptGlideToOffset` animates with ease-in-out, duration scaled to distance (550 to 2200 ms). The scrub dial and slider stay instant on purpose (they track the hand). Pause freezes a glide in place. A script push mid-glide rescales the travel so it still lands on the same copy.
- The prompter holds at the next cue: during free-run, when the header of a row BEYOND the live row reaches the read line, the talent pauses and waits (`ptCheckRowHold`). The next advance glides through it and auto-resumes. Manual pauses are respected: the auto-resume fires only when the pause came from the hold itself. Scripts without `[N]` headers (hand-pasted) behave exactly as before: no holds, no seeks.
- The talent learns the live row from row seeks and from `activeIdx` on the session doc, so a talent that missed a command still holds in the right place. The desk's talent rail shows "holding at row N".

Browser-verified end to end this pass: free-run held at row 2, an advance glide released it, playback resumed, and it held again at row 3.

### 3. Advance arms the next playout

New `arm` verb in the `outrangutan.command` vocabulary: select + preload, never fire. On every advance/back/jump the next auto-linked playback cue IN RUNDOWN ORDER goes on standby on the playout machine (Outrangutan's own cue-ahead staging follows its internal list order, which can diverge from the running order; the rundown arm now outranks it in `go()` and `preloadNext`).

Race safety: `outrangutan.command` is a single slot, so on a TAKE the arm rides the SAME write as the fire (`armCueId` field). Standalone arms (advances that fire nothing) are delayed 1.2s and deduped so they can never overwrite an unconsumed fire. Old playout shells ignore both additions harmlessly.

### 4. Per-segment contextual add rows

Each segment block ends with its own "+ Add Row · <segment>" that inserts INSIDE the block (reuses `addRowAt`/`_insertIdx`; the wizard is unchanged, so a new segment can still be created from any of them). A leading unsegmented block gets one too. Hidden while a block is collapsed. With no segments, the classic single bottom button remains. Sync-safe: only render markup and an insert index changed; the beats array rides the existing transactional sync.

### 5. Cue-type colours are semantic across all 9 themes

New `--cue-video / --cue-audio / --cue-lighting / --cue-playback / --cue-gfx / --cue-script` tokens defined once at `:root`. Only the white theme remaps them, to darker variants of the SAME hues (hue is the identity; luminance adapts to the light background). `CT`, `COL_META`, type badges, and row accents all switched over. Previously `--video` equalled each theme's accent, so a video cue was yellow in warm and prepbear (colliding with GFX), red in white (colliding with PLAYBACK), green in green (colliding with AUDIO), and gray in panda. Verified in-browser: identical resolved colours across all eight dark themes, darker same-hue set in white, real department colours now visible in panda and koala.

Legibility bump: cell tints raised (rundown 14 to 24 percent, live grid 15 to 24, focus 11 to 18, builder 17 to 26), rundown cue icons 14 to 16 px, live grid headers 9 to 10 px. The coloured left borders stay blanked (v2.2.1 stroke round owner decision). Paper exports keep their pinned print-safe hexes.

Not switched (deliberate, small follow-ups): the stage plot layer palette (`PLOT_ITEM_COLORS`) and the `u-c-video` utility class still ride the old theme tokens.

### Round 1 hardening (25-agent adversarial review, 18 confirmed findings, all fixed and re-verified)

The build above then went through a four-lens review (correctness, sync races, live regressions, show UX) with every finding adversarially verified against the code. All 18 confirmed findings were fixed in the same pass:

- Arm standby race: a delayed standalone `arm` write could overwrite an unconsumed fire, pad, or PANIC in the single `outrangutan.command` slot (the dedupe early-return preserved a stale timer). Now every real command write cancels the pending arm, the timer re-defers behind the latest activity, and its payload is revalidated at fire time.
- Arm lifecycle: the standby is one-shot (consumed by `go()`), an empty arm CLEARS it when the rundown moves on with nothing auto-linked downstream (a skipped clip can no longer hijack the playout op's GO chain), the memo resets on every take so BACK plus retake re-arms the last clip, and `preloadNext` follows the actual standby selection.
- Holds engage only when the show actually moves: `activeIdx` is adopted change-gated, so linking a talent to an idle session (every doc carries `activeIdx: 0` from creation) no longer locks a rehearsal read-through to row 1, and an unchanged doc value can no longer drag the live row backwards under a Cue Next (which self-cancelled the cue by holding at the row the talent was just sent to).
- Explicit pause wins: `ptStopPlay` clears hold provenance, so a pause or slate over a held talent is never auto-resumed by the next advance. The auto-resume intent itself now survives a rapid double-advance (module flag consumed by whichever glide lands last).
- Scrub vs holds: the seen-boundary set is REBUILT from geometry on every reposition, so a forward scrub while playing never insta-holds and a scrub-back automatically re-arms passed boundaries.
- Hold visibility: the transient toast is gone; the talent display carries a persistent pulsing `HOLDING · ROW N` chip inside `#pt-stage` (mirrors with the copy, survives fullscreen), and the desk's prompter status line says "Holding at row N" instead of a bare "Talent paused".
- Cross-device talent reload: the doc's `prompter.stateMessage` keeps the FULL state again (the BroadcastChannel copy stays stripped); a freshly booted talent treats its first apply as a seed, so a mid-show reload restores position and play state, while a live talent still ignores sync-scope mirrors.
- Two operator surfaces: command writes now carry OTHER writers' recent `controlQueue` entries forward (merged by ts) instead of evicting them, so a lagging talent can no longer lose the desk's seek to a Flowmingo Op write.
- Header desync: advances rebuild rundown-assembled scripts before pushing, so a co-editor inserting or deleting rows mid-show cannot leave every later seek one row off. Hand-pushed scripts are never overwritten.
- Collapsed segments keep their contextual add button (expand-then-add), so a fully collapsed rundown never loses every add-row entry point.

Residual known risks after the fixes: seeks are positional (`[N]`), so a concurrent structural edit landing in the same instant as an advance can still target the old numbering for that one advance (self-heals on the next advance now that scripts rebuild); and the pre-existing cue-then-pad back-to-back writes in `takePlayoutCall` remain as before.

### Release levers (already flipped in this pass)

- `index.html`: `cueola-app.js?v=f36cdf257a`, `outrangutan/outrangutan.js?v=fb6cbbcdda` (content hashes).
- `sw.js`: same two precache entries, `WORKER_SCHEMA = '37'`.
- No Firestore rules changes needed for anything in round 1.
- Mixed-version note: until an open tab reloads past schema 37, old talents simply keep their own position/display on new sync snapshots (the strip does the work), and old playout shells ignore `arm`. Nothing breaks; the fixes just are not active until reload.

## Audit verdicts for the remaining plan areas

### Plan item 1: roles and permissions (the spine)

- Position assignments are a finished, revision-fenced three-tier store (canonical `sessions/{code}/assignments` subcollection plus three mirrors, saved in one transaction) with two persistent instructor views (Planda Bear hub card, dashboard session inspector). They grant ZERO capability today: no permission predicate reads them.
- Live control is exactly one pure predicate: `CueolaLiveSession.resolveCallerState` (cueola-live-session.js ~648). In a joined session only a real admin login (`hasAdminSession`) drives. Students are blocked at about a dozen client gate points that ALL delegate to `isShowCaller()`.
- A who-is-driving concept exists (busExecutor claim + CALLER badge), but the badge and student auto-follow identify the caller by the spoofable presence role string.
- The capability switch the plan asks for is architecturally cheap at the core: add a `hasControlGrant` input to `_callerStateInputs()` (cueola-app.js ~334) and OR it into `privileged` in `resolveCallerState`; every `isShowCaller()` gate follows automatically. The parts that will NOT auto-follow, all mapped in the audit: `isStandardShowCaller`/`isAdminShowCaller` qualifiers (~9327), follower routing `resolveFollowedIdx` (~10749) and the CALLER badge (~10800) which assume the caller is an instructor, `canDriveShowClock`, and the grant plumbing itself (a session-doc field adopted in the main snapshot handler, granted from the hub card or dashboard). It must be a dedicated flag, never a role or adminSession flip (those carry instructor-wide and admin-wide powers). Positions can carry defaults by mapping positionId to the grant at assignment time.
- Enforcement caveat: Firestore rules cannot distinguish instructor from student on session-doc field writes, so the grant is client-honored, same level as today's instructor block.

### Plan item 2 leftovers

- Clip time remaining broadcast: ALREADY DONE AND WORKING. `outrangutan.playingStart` (one write per clip start) plus `outrangutan.live.remaining` (about 1 Hz) feed `playoutNow()`'s three-tier ladder and the always-on `#lsPlayoutStrip` on every client. Big readable numbers are a styling decision on the existing strip if wanted.
- Panic: already three layers (armed-call abort, S/Shift+S/Shift+Escape transports cross-machine, Outrangutan `panic()` which kills fades and pads). Plain Escape only panics inside Outrangutan; on Live it is Shift+Escape.
- RTRT auto-continue: exists (1s per stage, auto TAKE, manual-arm per-device flag `cueola_rtrt_manual`). Note: manual-arm being per-device means a caller machine swap silently reverts to automatic.

### Plan item 3 leftovers (Flowmingo)

- Pop-out vs inline Script Op: NOT two engines (all commands execute host-side through the shared protocol file), but the pop-out UI has drifted: it still ships the Paste/Paste-Push `[CHAT]` path that D12.6 deliberately removed in-app (script-operator.html ~271, script-operator.js ~684), and it lacks the talent rail, Manual TAKE, and most Live keybindings. Recommended: kill Paste-Push in the pop-out (replace with the question lane), then port the rail. The bigger triplication risk is the third surface, Flowmingo Op, with fully parallel mirrors.
- Quick jump to line: still missing (no find-in-script, no numeric go-to-row; only row cueing, percent scrub, top). Natural build: a search box in the Script Op panel that finds text and sends the existing seek machinery to the match, plus click-a-line-to-cue in the editor.
- Live copy input: already 2 actions (type, Cmd+Enter push); the question lane handles audience copy. Probably fine as is.

### Plan item 4: Stream Deck as session master

- KeyWi's advertised cloud mode is an orphaned stub (`dispatchCloud` returns false, mode never leaves 'local'), BUT the bridge already routes the show-critical bands over the session doc: rundown next/back/take/abort (controlBus + busExecutor claim), all playout transports and cue/pad fires (outrangutan.command), every prompter control (prompter.controlQueue). Those work cross-machine today.
- Silent local-only gaps to fix: the clock keys/dial refuse locally with no doc fallback when the host tab is not the clock driver; the rundownSelect dial has no controlBus fallback; the master volume dial and playback monitor read same-tab `window.Outrangutan` only (silently dead on a multi-machine rig); nothing in the layout editor marks which keys are machine-local (OBS, talkback, master volume).
- The pattern to follow already exists with a second writer: Outrangutan's `fireControlBusAction` (its deck keys and Web MIDI already write controlBus cross-machine). Filling `dispatchCloud` plus a clock-over-controlBus verb and a local-only badge in the key editor completes the item.

### Plan item 5: workspace launcher

Nothing exists (no saved layout, no multi-window opener). All four pop-outs are individually mature. A one-click "instructor show setup" needs: a launcher function calling the existing openers in one user gesture (popup-blocker strategy required: browsers allow one un-permitted popup per gesture), a new boot param for Outrangutan-in-session (none exists; `autoJoinFromDashboard` handles only scriptop/flowop/flowmingo/code), a solution for Script Op's hard dependency on a live in-tab host, and a small layout store. Note: opening Outrangutan in a second window forks it away from the tab where Live reads `window.Outrangutan` directly; the same-machine rig may prefer a "open these four in order" guided flow.

### Plan item 6: smaller items

- Admin sign-in slowness, measured: sequential chain of SDK fetch, auth round trip, a DUPLICATED `admins/{uid}` getDoc (signIn and onAuthStateChanged both resolve), then `loadSessions()` downloading EVERY session document in full (whole rundowns and prePro), repeated wholesale every 60 seconds by polling. Fixes in order of value: kill the duplicate admins read, replace the full-collection download with a lean projection (denormalized session index doc or subcollection of summaries), swap the 60s poll for a listener, drop the up-to-8s disabled login button failsafe.
- Class code per device: does not exist at all (codes are validated per action and deliberately wiped between attempts). Needs a new kiosk-style device flag; flagged as a design decision for the owner (it trades against the server-side auth work from 2026-08-11).
- Pre-flight: the 11-row preflight panel is real and wired (Go Live + Settings) and Outrangutan health IS visible from Live including cross-machine and the ARMED verdict. BUILT 2026-08-29: OBS, Talkback, and Stream Deck rows in the preflight (each appears only once its system has been seen on this machine; the deck verdict combines this window's connection, the ownership beat from another window, and the granted-HID probe so it never lies about a deck owned by /keywibird), plus a compact systems chip in the rundown topbar (dim while healthy, amber on a sustained drop, two-tick damping, click opens the preflight). New KeyWi exports: `talkbackStatus()`, `deckStatus()`, `grantedDecks()`. The admin sign-in speed pass from this item is still open.
- Segments: contextual adds DONE this round. A per-segment duration sum on the header badge is a small follow-up (only a show-level total exists today; the plan said roll-up was handled, which is true only of the collapsed-offset math).
- Stage plot: complete wired v1, committed (e542904). Owner still owes data drops only: final icon art into `PLOT_ELEMENT_TYPES`, real FS4E-123 room feet, drape panel width. No code work pending.

## Suggested order for round 2

1. Rundown-operator capability switch (plan item 1): one predicate input + grant plumbing + the mapped badge/follower fixes.
2. Stream Deck completion (item 4): clock/rundownSelect doc fallbacks, `dispatchCloud`, local-only badges.
3. Pop-out Script Op de-drift + jump-to-line (item 3).
4. Preflight OBS/talkback/deck rows + systems chip; admin sign-in speed pass (item 6).
5. Workspace launcher (item 5), after the owner picks same-machine vs multi-machine as the primary rig.

## Known risks and accepted trade-offs this round

- The auto-advance seek reverses documented directive D11.2; the owner's new plan explicitly asks for it, and the old behavior survives automatically for scripts without row headers.
- `outrangutan.command` cue-then-pad back-to-back writes on a TAKE were already racy pre-existing (single slot); the new arm never adds a write between a fire and its consumption.
- The hold indicator on the talent display is the pulsing `HOLDING · ROW N` chip (`#pt-hold-chip`); if the talent screen should stay completely chrome-free, hide it with one CSS rule.
- Prompter scroll during a hidden/backgrounded talent tab does not process seeks until visible (rAF); true before this round too.
