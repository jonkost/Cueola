# September 4 mock show round (built 2026-09-03)

Intake: the 3-device demo on 9/3 (MacBook Pro = rundown + Script Op + Stream Deck; MacBook Air = Outrangutan playout + the Flowmingo talent display joined by typed code) and the owner's transcript debrief the same afternoon. Fourteen investigation lanes plus an adversarial refute pass mapped every symptom to a mechanism before anything was built. This file is the owner's copy: what was wrong, what changed, and exactly what to do before doors tomorrow.

## What was actually wrong (short version)

1. **Script Op and the deck could not drive the talent display on the other Mac.** The operator pinned itself to the first talent window it ever heard and never re-bound. Every reload of the talent page mints a new window id, so its heartbeats were dropped, play/pause/speed queued forever behind a handshake that could never finish, and seeks and overlays went out addressed to the dead id, which the live talent rejected. The deck's "talent connected" lamp also read a variable that did not exist.
2. **The talent door had no idea which shows were yours.** No assigned-show list, a dead end when signed out, and on a device that had linked once before it booted showing yesterday's script under a green "Script loaded" pill. That is the "didn't fully load" look.
3. **Rundown follow had four ways to snap the talent backward:** a talent linked mid-show had no live-row context until the first change, every advance glided to the row top even when the talent was already inside the row, a lost seek left it stuck on HOLDING, and arrow keys in any follower window (including the owner's while a student directs) re-cued the talent and could arm a playout call.
4. **Student director:** the grant logic was sound, but opening KeyWi Bird from the student's Live window turned Live off in that window, so rundown presses from both decks black-holed until the student got back to Live. The 6-key default also handed the student GO, STOP and PANIC for the owner's playback.
5. **The 5 second clock on the still** is stored on that cue on the Air (Duration or Pre-wait = 5), not a default. Separately, a held still read "0:00" on the strip and deck instead of HOLD.
6. **Overlays:** the tech slate was invisible on the white theme, overlays were not theme-aware or mirror-aware, the drawn read line sat 24px below where the code thought it was, and the wrap banner clipped at the largest size. Size steps grew the box more than the digits because of pixel ceilings in the font formulas.
7. **OBS:** no liveness check (a hung OBS kept keys lit), refused requests gave no feedback, a changed password caused a silent reconnect loop.
8. **Leaving Live:** "Stop outputs and return" failed into the emergency "recovering" panel on every exit after the first because the Pro's vestigial local Outrangutan was left detached; a closed talent window cost a 5 second stall first; the show clock silently split (students kept running, the caller froze). Browser Back was a second, different exit that ended the whole session.
9. **Pre-live grant:** the only way to hand a student control was the 9px CALLER badge on the Live screen, after the preflight.
10. **Preflight:** the card could not scroll (Continue and Cancel off screen at 768px), rows reported but never fixed, and nothing could push a fix to the Air or the talent laptop.
11. **GIF keys:** every frame was re-drawn, re-encoded and re-written over USB on a 5 Hz tick that judders by construction, and the frames delayed every state key behind them. The Giphy key lived per device. Layouts with a GIF were too big to save to a profile, and nothing ever loaded profile layouts back anyway.
12. **Row numbers:** the Build screen skipped segment rows, everything else counted them.

## Before doors tomorrow (numbered, each step names the surface)

### Tonight, on the Air (playout Mac)
1. **Outrangutan window:** click the still cue, open the Inspector, read **Duration (s)** and **Pre-wait (s)**. Either one at 5 is the clock you saw. Set it to 0 (the field badge now reads HOLD) and save the show.
2. **Outrangutan window:** stay signed in and joined to the show code so the Air can answer fix requests from the rundown Mac. The mode badge must not read NOT LISTENING.

### Tonight, on the student director's laptop (Chrome)
1. **Elgato Stream Deck app:** quit it. It holds the USB device.
2. **Browser:** open cueola.live, sign in with the student username and PIN, Join a scratch session, press Go Live. On your Mac you should see their presence bubble. If Join fails with "Could not load session", stop and tell me: nothing else will work for that student.
3. **Same Chrome window:** open KeyWi Bird from the front page card, Connect, pick the Mini. A deck that has never been set up on that browser gets the Director layout automatically for a student login (BACK, NEXT, TAKE, ROW, CLOCK, ABORT, no playout keys). A deck that already has a layout on that browser: Pages, the + button, choose Director, then Set home.
4. **Same window:** get back to the Live screen (Esc out of KeyWi, then re-enter Live if the front page shows). The deck keeps working with KeyWi closed. Rundown keys light only while they are the caller; a dimmed key means no session or not the caller.
5. Keep that laptop awake, lid open. While the student holds control, their window executes the rundown for both decks, and the automatic playback call originates there.

### Show day, on your Mac
1. **Build screen, toolbar:** the new **CALLER** chip. Tap it, pick the student (or "Give control to the Director"). Your GO goes grey by design while they hold control; the same chip takes it back. Do this only once the student's presence is active, a grant to someone who is not connected leaves you in control.
2. **Talent display on any other machine:** sign in there, open cueola.live/flowmingo, tap the show in "Your shows" (or use the copyable link in Show setup). No typing.
3. **Go Live:** the check panel is grouped by machine and scrolls. A red row shows a fix verb. Press it: local fixes run at once; Air and talent fixes are pushed over the session and the row reads "Fix sent, waiting" until the other machine answers, then "Fixed" only once the evidence arrives.
4. **Leaving Live:** one sheet, "Leave the live show?", with the consequences listed. Stay live or Leave live. No recovery mode.

### Deploy ritual (unchanged)
1. **Terminal:** commit and push (cueola.live is GitHub Pages; the push is the deploy).
2. **Every Cueola window on every machine:** reload (the worker schema bump forces it on the next visit). Relaunch Outrangutan on the Air so it publishes the new HOLD packets and answers fix requests.
3. **Firebase console, Rules tab:** paste docs/rules-additive-2026-09-03-hiddensessions.rules (it now also carries the shared Giphy key document and the fixRequests type check). Until it is published, hidden sessions and the shared Giphy key are the only things that stay off; everything else in this round works on the current ruleset.
4. **KeyWi Bird, any key editor, GIPHY box:** signed in with your admin password, paste your GIPHY key once with "Use for the whole class" checked. Students then see the search box with no key of their own (after the rules deploy in step 3).

## What changed (filled in from the build reports)

### Cross-device prompter control (cueola-app.js, cueola-prompter-session.js, script-operator.js)
- Transport (play, pause, speed, brake, boost, size) rides the session document immediately whenever a show code exists. The in-memory readiness queue survives only for a code-less, same-browser setup.
- The operator re-binds to a replacement talent window on evidence: the pinned talent went silent, or the new window echoes the operator's current snapshot id. Never on a newer timestamp, so two talents cannot flap.
- Doc-delivered controls are accepted by production and prompter session, no longer by window id. The in-app talent listener gained the same gate it never had.
- A snapshot delivered over the document never starts playback; a seed applied to a talent that is already rolling changes script and look only.
- The talent writes prompter.talentApplied so readiness turns in one hop; the handshake timer re-sends the snapshot three times before flagging.
- Only a window that actually runs the Live prompter mints a prompter session id; the same-machine sibling guard that stranded a KeyWi window is gone.
- Stale mirrors clear when the talent link is lost, so a recovery snapshot can never carry an old running flag. The deck's talent lamp and play/pause verb read talent truth.
- Status copy tells the truth: "Talent connected, row 4, rolling, seen just now"; the pop-out says "Sent to the session".

### Rundown follow (cueola-app.js, script-operator.js)
- One rule per advance: glide forward to the row top; if the talent is already inside that row, release the hold in place; if it is past the row, never move backward (the rail and the deck ROW key say AHEAD). Explicit cues (Cue Now, C, jog, Previous) keep the unconditional glide.
- A doc activeIdx change releases a stuck hold on its own after 600ms if the seek never arrived.
- A talent linked while a caller is live adopts the live row at once, so the first GO cannot yank it backward.
- Follower windows browse only: arrows move their own selection and toast "Browsing. <caller> is calling the show." They never push the script, seek the talent, or arm playout.
- The talent screen shows NEXT (next row name, dimmed) and HOLDING names the held row.
- The rundown executor gates on the live lifecycle, not on which screen is on top, so a student parked on the KeyWi screen still executes; a press that would go nowhere flashes red on the deck.

### Talent door and scroll engine (cueola-app.js, index.html)
- The Connect card lists your assigned shows (one tap), offers Resume <code>, and when signed out says so with a Sign in button; a code typed while signed out completes the link after sign-in.
- A script restored from yesterday boots as "Local script, not linked" behind the Connect card with a Keep this script option; the bar button reads "Link a show".
- Show setup carries a copyable talent link for another machine.
- Size changes and live pushes are anchor-preserving; the crawl delta is clamped so an occluded window never leaps; speed eases instead of stepping; resize and fullscreen re-anchor; listener errors reconnect instead of slating.
- Overlay size buckets now change the digits (pixel ceilings removed, wrap no longer resets the size), overlays live inside the mirrored stage, and the size persists on the talent and rides the seed.

### Leaving Live, pre-live grant, preflight (cueola-app.js, cueola-live-session.js, index.html)
- One sheet: "Leave the live show?" with the consequence list, optional Pause the show clock and Stop playout on the Air toggles, Stay live and Leave live. Output warnings are inline with Leave anyway. Outputs stop before the snapshot. The clock keeps running for everyone by default and the caller re-adopts it on re-entry. Browser Back on Live opens the sheet.
- The Build toolbar CALLER chip and the caller banner: hand control before Go Live; the roster unions presence, participants and Planda Bear assignments; "Give control to the Director" when an assignment matches. A grant to a student who is not present leaves you as caller until they show up.
- The Go Live check is grouped by machine (This Mac, Talent display, Playout Air, Cloud), collapses green groups, scrolls inside a bounded card, and every warn or fail row carries a fix verb. Remote fixes ride sessions/<code>.fixRequests with acks from the Air and the talent display; rows flip to Fixed only on evidence.

### Stream Deck (cueola-streamdeck.js, cueola-streamdeck-device.js)
- Key rims: On/Off, Thin/Regular/Bold plus a 1 to 12 slider, per-app colors with Reset, per deck. Untouched decks paint exactly as before.
- Director layouts for 6, 8 and 15 keys (BACK, NEXT, TAKE, ABORT, ROW, CLOCK; no playout keys) picked automatically for a student login and available as a template for any deck.
- Secondary decks animate; local rundown keys dim when this window is not the caller; refused presses flash red; playback reads HOLD for a held still; the ROW key shows the talent's row.
- GIF keys run on their own 10 fps cadence with an encoded-frame cache and a state-first write queue; Giphy picks are stored as references so a deck of GIFs saves to a profile; My layouts loads profile layouts on another laptop; the class Giphy key lives in config/giphy (rules deploy owed).
- OBS keys: refused requests toast with OBS's reason and flash red; STARTING pulses; the strip monitor loop survives a hidden tab.

### OBS client (cueola-obs.js)
- Keepalive every 5s with a dead-socket detach after two misses; request failures propagate; a wrong password stops the reconnect loop with a clear message; stale state resets on close; socket capture guards; 14 unit tests with a fake WebSocket.

### Outrangutan (outrangutan/outrangutan.js)
- A held still publishes hold with no remaining time; the clock reads HOLD; a timed still parks on its last frame instead of cutting to black; Inspector badges say HOLD, auto: Ns or pre-wait: Ns and a first nonzero value toasts what will happen.
- Fix requests from the rundown Mac: ack, card in the bar, auto-run for rejoin, republish, media check and media sync; Do it for output open and arm.
- A detached vestigial instance answers a stop with nothing open as OK, so leaving Live no longer fails.

### Row numbers
- Segments never count: Live table, NOW and NEXT badges, Row N of M, focus view, cue toasts, prompter headers, seek commands, the deck ROW key and dial readout, the Build header Rows count, and the collapsed-segment editor bug.

## Review round (same evening)

An adversarial review of the whole diff (seven lenses, every finding re-verified by a second reader, then a completeness critic) confirmed 32 defects and 7 scope gaps; all were fixed and pinned by contract tests. The ones that change what you will see:

- A student who opens Flowmingo on their own laptop can no longer steal the desk's talent binding; only a reload of the same talent machine re-binds instantly.
- A talent that links mid-show never replays yesterday's play or brake command; it lands positioned and paused, and one press of Play resumes it.
- Previous (and a backward Cue here) glide the talent backward again; only forward advances refuse to travel backward.
- Escape on the leave sheet equals Stay live. Stay live during the short wait really stays. A follower's exit never holds the talent under the caller.
- After you grant control from the Build chip, your deck's rundown keys dim until the student's window is on Live and holding the claim; that hand-off is now immediate when you leave Live.
- The Go Live check gains "Playout first GO" for the Air (warns until someone has tapped Outrangutan there, with an "Arm on the Air" fix), and the OBS row names the real reason (rejected password, stopped answering).
- The talent URL now carries the show code once linked, so a reload or the director's "Reload talent display" fix re-links on its own.
- Outrangutan: a still fired after a timed still no longer inherits the old timer; a parked still ignores a Duration edit until it plays again.
- GIF keys: uploaded GIFs no longer flatten megabytes of cache keys; Retina mirrors are sharp again (decoded GIF memory returns to roughly 17 MB per source); a Mini that attached before the student joined switches to the Director page on its own if its page was untouched.

Cache bump run and WORKER_SCHEMA is 48: every window on every machine reloads on the next visit after the push.

## Output window went dead after the deploy (fixed 9/3 night)

Symptom: Outrangutan plays in its own program area, but the external output window feeding the switcher shows nothing.

Two causes, both now handled.

1. **Reloading the Outrangutan page orphans an already-open output window.** The window binds to the controller identity baked into its URL when it opens, and it announces itself exactly once. Reloading the Outrangutan page (step 2 of the deploy ritual) mints a new controller identity, so the page and the window reject each other in silence: the window keeps painting its last frame and never plays again, while the Outputs panel says "Output window closed". This is pre-existing behavior that the deploy reload triggers.
   - **What to do right now:** close the external output window, then press Open in the Outputs panel. It comes straight back.
   - **Order that avoids it:** reload the Outrangutan page FIRST, then open the output window.
   - The Outputs panel and the preflight now say so instead of reporting the window closed: "An output window from an earlier page load is still open and cannot hear this page. Close that window, then press Open."

2. **After leaving Live, the local playout runtime stayed detached.** Leaving Live detaches the runtime on purpose and deliberately leaves the output windows open. Before this round every Live entry reattached it; this round narrowed that so a rundown Mac cannot publish as a second playout machine. On a one-machine rig that left the runtime detached, so a cue fired from the rundown or a deck key played into nothing while the app reported success. Every same-tab fire now reclaims the runtime first, and if it still cannot deliver, the command is written to the session so a real playout machine can run it.

Deploy note: the first reload after a push can still serve the previous JavaScript from the service worker cache. If a window looks unchanged, reload it once more.

3. **A stray tap on the Air could close the output window outright.** Opening Outrangutan from the hub tile, the Live rail's playback recovery, or the new preflight "Open playout controls" all ask for standalone mode whenever the rundown has no show code, which is the Air's normal state. That dropped the joined show code, which changes the output channel identity, which closes the live output window and drops the Air out of the session. A joined show is now kept in every one of those paths, so a stray tap can no longer tear down a playout machine mid-show.

Also hardened: the transport keys (G, P, S and the deck transport keys) now run the same delivery check as a cue fire, so they can never report success while playing into a detached runtime.
