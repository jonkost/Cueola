# Live Control Rebuild — 2026-08-24 show debrief

Intake: the 8/24 production. Owner: prompter was the only thing under control (and not smooth), playouts would not trigger from the rundown, Stream Deck failures hurt the show, external keyboard glitched while typing, too many windows, setup too slow. Owner's direction: "Don't just patch, rebuild is the solution."

Schema 42 was already deployed, so these were real architecture failures, not a stale deploy. Root causes were mapped end to end before any code changed; every item below names the mechanism.

## What failed and why (diagnosis)

1. Playout calls parked or fired minutes late. The READY·TRACK·ROLL·TAKE chain ran on raw setTimeout. Chrome clamps a hidden tab's timers to once a MINUTE after ~5 idle minutes, and during a show the Cueola tab IS hidden (operator lives in OBS). Same class of bug as the 8/20 frozen deck clock, but the fix was never applied to the call chain, the delayed arm write, the bus-executor heartbeat, or the rundown-to-prompter seek.
2. Fires swallowed by the hidden local Outrangutan. index.html loads outrangutan.js into every window; once that instance had EVER joined the session, exiting the screen left mode/sessionCode set, so the same-tab fast path in fireOutrangutanCommand played every fire into a hidden, output-less local instance and never touched Firestore. The playout Air heard nothing. PANIC was swallowed the same way.
3. Fires lost in the single command slot. outrangutan.command is one field: TAKE wrote cue + up to two pads in one tick (later writes clobber earlier ones before the Air's snapshot lands), and the Air's post-subscribe baseline deliberately eats whatever the slot holds — a GO racing a reconnect was consumed unexecuted, in total silence.
4. The Air could be deaf while looking joined. An auth-expired/signed-out playout Mac gets permission-denied on the session listener; the badge still said "Session · CODE".
5. Name-linked rows fired nothing, silently. A row linked by cue NAME with no resolved outCueId got no call, no banner, no log.
6. Deck keys lied. Lamps read THIS window's local state while presses dispatch to a remote executor; refused presses returned false silently in at least three gates; keys ignored playout freshness; a frozen owner tab kept the Web Lock AND the HID handle, leaving the deck fully lit and fully dead.
7. Prompter stutter. The talent scroll loop forced style+layout (innerText) over every paragraph EVERY FRAME; a dial scrub drove ~10 command writes + ~10 ack writes per second at one Firestore doc; seek_line was misclassified as "loud" (20 live timers + status-line churn per second); in-app sliders wrote per input event; the talent heartbeat was a throttleable setInterval; glides had no hidden-window watchdog; the speed ease was frame-rate dependent.
8. Keyboard glitches. IME/dead-key composition was never filtered, so composing keystrokes could reach the live scope's single-letter hotkeys (R = reset prompter, S = stop playout) and get eaten; main-thread saturation from item 7 dropped keystrokes exactly while driving the prompter.
9. Window sprawl. /plandabear and /outrangutan threw away the ?code= the launcher handed them; ?prepro=1 was dropped on the join-modal path; launcher-opened app windows raced the Live window for the HID deck; only the talent window was placeable on a display; the launcher hid behind one small front-door text link; Esc out of KeyWi dumped the operator on the front page.

## What was rebuilt (all built 2026-08-24, this round)

Playout delivery is now CONFIRMED, not assumed:

- `steadyTimeout()` (worker-backed one-shot) drives the RTRT stages, the parked-call resume, the 1.2s arm write, and the 150ms rundown-to-prompter seek. The bus-executor heartbeat rides `createSteadyInterval`. None of these can be throttled by a hidden tab again.
- Command protocol v2: every command carries `origId`; the Air writes `outrangutan.cmdAck` after executing (and stamps `live.proto = 2`). The sender keeps a pending list; unconfirmed commands are re-written after 2.5s (new commandId, same origId — the Air executes an origId at most once), twice, then the operator gets a loud "Playout did NOT confirm the last command" toast + show-log line. A newer non-pad command supersedes older pending ones so a stale cue retry can never fire after a STOP.
- TAKE-linked pads ride the SAME write as the cue fire (`command.pads`), killing the three-writes-one-slot race. Both the doc path and the local fast path fire them.
- `remoteAirDriving()` — a different Outrangutan instance freshly publishing into the show (live.sender vs our own _sender()) forces the wire path everywhere the same-tab fast path existed (commands, transport, arm, deck bridge, master gain), and makes `playoutIsRemote()` true so every status probe/preflight follows the real machine.
- `remotePlayoutFresh()` now judges by arrival clock (_ogLiveSeenAt), never the sender's wall clock.
- A name-linked row with no resolved cue id now screams (toast + show-log error) instead of doing nothing.
- The Air's mode badge turns red "NOT LISTENING · CODE" whenever its session listener is dead.

The deck tells the truth:

- Frozen-owner watchdog: the owner stamps a localStorage beat from a worker timer (worker timers stop cold when a tab is frozen — exactly the tell); a standby window that sees the beat go stale steals the deck (jittered re-check so two standbys can't ping-pong). `pagehide`/`freeze` release the lock and close HID handles for instant handover; `resume` re-elects.
- Honest keys: a key whose press would be refused right now renders DIMMED (bus/clock keys with no exec or publish path, playout keys with no way to send, OBS/talkback keys with no connection); a playout key whose command would go to a show no machine has checked in on carries an amber doubt dot; PANIC is never dimmed. A press that reaches the app and gets refused flashes the key RED (fireSlot now reports refusals; bridge gained `busAvailable()`; state gained `playout.local` / `playout.sendable`).
- App-color rims are ~2x thicker (max(3, z*0.045), near-opaque idle, full + wider when active) so they read on the physical hardware, not just the enlarged on-screen mirror.
- Drag and drop: a collapsible Action tray under the deck mirror lists every assignable action as a chip (rimmed in its app color); drag a chip onto any key to assign it. Key-onto-key swap unchanged. Ref-configured actions (specific cue/scene/layout) still go through the key editor.
- Esc out of KeyWi returns to the screen the operator came from, not the front page.

Prompter smoothness + keyboard safety:

- The scroll loop's pause-marker and row-hold scans use node lists cached per script render (textContent, no layout) — per-frame work is one or two getBoundingClientRect calls instead of O(script) forced reflows. Progress/scrubber sync throttled to ~10Hz.
- seek_line_ and the speed/size steppers are "quiet" controls (no per-command wait/fail timers). In-app slider previews are 100ms leading+trailing throttled (matching the pop-out). Talent control-acks to Firestore are 300ms trailing-batched (BroadcastChannel ack stays immediate). The talent heartbeat rides a worker timer.
- Glides got the same visibility-gated watchdog scrubs had (a hidden talent window lands the travel instead of stalling forever). The speed ease is dt-normalized (~270ms time constant on every display).
- keymapDispatch drops `isComposing` / keyCode 229 events, so IME/dead-key composition can never fire single-letter show commands.

Windows and setup:

- All three per-app doors consume the launcher's ?code=: /keywibird and /plandabear join through a shared helper (Planda Bear opens the hub after joining), /outrangutan seeds its join sheet with the code. The dropped ?prepro=1-through-the-join-modal path is fixed.
- AUX_OUTPUT_BOOT covers ?app=outrangutan / ?app=plandabear / ?prepro=1 windows, so launcher windows never race for the HID deck.
- The launcher places EVERY window: per-window screen pickers (talent, Planda Bear, Outrangutan, KeyWi) stored as stable display identities; windows open with position features on their chosen display.
- "Show setup" is now a rundown-toolbar button (was only a small front-door link).

Script Op questions:

- The push control is a real target: the two actions sit on their own full-width row (44px in the pop-out, 40px in-app).
- New "Into script" action beside "Push card" (both surfaces): inserts the question into the script copy of the row the talent is on RIGHT NOW (talentCurrentRowNum(): held row → reported percent → live row), then pushes; the R2 anchor-preserving push keeps the talent's read line steady. The pop-out sends `question_insert`, handled host-side before the control grammar.

## Tests

All suites green (22 suites incl. 47 Live UI contract tests). New/updated contracts: RTRT rides steadyTimeout (not setTimeout); the full confirmed-delivery protocol (origId, ack, retry, pads-on-cue, remoteAirDriving guards, NOT LISTENING badge); every per-app door consumes ?code=. check-contracts passes (948 id refs / 771 handlers).

WORKER_SCHEMA bumped 42 → 43 (bump-cache).

## Deploy notes (owner)

- Deploy = git push (cueola.live is GitHub Pages now; the firebase.json rewrites are NOT active there — the 404.html redirect covers the per-app URLs, and it works in real browsers even though curl shows a 404 status).
- BOTH machines must reload every Cueola window after deploy (schema 43 forces it on next visit). The Air must reload Outrangutan to start acking (proto 2); against an un-reloaded Air the sender simply never retries (old behavior, no regression).
- The old cloud branch `claude/codebase-status-report-u2bd25` holds 5 unmerged commits (deck diagnostics panel, KeyWi OBS failure reason, DEPLOY.md) — cherry-pick when convenient. The GitHub Desktop stash from 8/24 holds junk " 2"-suffixed duplicate files; safe to drop.

## Show-day QA checklist (rig test)

1. Rundown Mac + Air on one session. Background the Cueola tab behind OBS for 6+ minutes, then GO onto a linked row from the deck: the call must run READY·TRACK·ROLL·TAKE on cadence and the clip must fire on the Air.
2. Open Outrangutan on the rundown Mac, join the session, EXIT the screen. GO again: the clip must still fire on the Air (was: swallowed), and the show log should show the command + no unconfirmed warnings.
3. Kill the Air's network mid-GO: within ~8s the rundown Mac must toast "Playout did NOT confirm"; restore network: the retry must land the fire (or be superseded by your next command).
4. Sign the Air out (or expire auth): its badge must read NOT LISTENING · CODE in red.
5. Freeze test: on the machine with two Cueola windows, kill the deck-owning window via Chrome's task manager (or close it): the other window must take the deck over within ~10s with a toast.
6. Deck truth: close the Live screen — rundown/prompter/clock keys must dim; disconnect OBS — OBS keys dim; a press on a dimmed key that still refuses must flash red.
7. Scrub the prompter dial hard while typing in a text field on the same machine: typing must stay clean; the talent scroll must stay smooth on a full-length script.
8. Show setup from the rundown toolbar: pick displays for talent + KeyWi + Outrangutan windows; every window must open placed, joined (or prefilled), with no deck fight.
9. Question lane: type a question, "Into script" — it must appear in the talent's flow near the read line without moving their read position; "Push card" still shows the overlay.
