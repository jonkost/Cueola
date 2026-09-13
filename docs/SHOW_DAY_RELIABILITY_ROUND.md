# Show day reliability round (built 2026-09-13)

Intake: the owner's 9/8 ask after three shows with control failures: the Stream Deck must drive the prompter, the playout and the rundown every time, with no troubleshooting, and the rig must never look broken while it is working. Scope was set by the owner before the build: the Pro + Air rig as on 9/3, reliability only, no screen or layout changes, the owner's saved deck layout untouched, and the owner's deck must work with or without a student director.

A sixteen-lane read of the whole control chain came first (every window, every gate, every timer, every session field), then a triage and verification pass. This file is the owner's copy: what was wrong, what changed, and the show-day steps as they are now.

## What was actually wrong (short version)

1. **The deck could belong to the wrong window.** Whichever Cueola window loaded first took the Stream Deck, even a launcher window or a second tab. If that window was not the Live window, rundown keys refused or went nowhere, and nothing on the deck said which window had it.
2. **A refused press could look like a good press.** Prompter keys never flashed red. Playout keys skipped the Live gate the keyboard obeys, so a GO pressed during the READY count fired twice. Most refusals were a toast in the Cueola tab, which is hidden behind OBS by design.
3. **The Pro could play into itself.** Every Cueola window carries a hidden copy of Outrangutan. Once it had ever joined the show, it could swallow a GO or keep the deck's "playout alive" dot green while the Air was dead.
4. **One command slot.** A pad, a retry or a reconnect could overwrite a GO before the Air read it, and the Air acknowledged commands it could not actually play (unknown cue, missing media, locked audio).
5. **A reload dropped the show.** Reloading the Pro landed on the front page with a Resume banner; the deck lit up dimmed. Reloading Outrangutan on the Air orphaned the output window.
6. **Nobody knew which build each Mac ran.** The first reload after a push serves the old code. A Pro on the new build and an Air on the old one degrade silently.
7. **Timers and roles.** The presence beat that decides who is the caller ran on a timer Chrome throttles in a hidden tab. The bus claim keyed on an id shared by every window of the same Chrome profile.

## What changed

### The deck follows the Live window (cueola-streamdeck.js, cueola-app.js)
- Going Live takes the Stream Deck into that window, silently, whichever window had it before. The same happens when the Live window comes back from a sleep or is brought to the front. The owner's layout is untouched: it re-attaches the granted deck with no light show and paints the page you set as home.
- A window that is live marks its ownership beat as live, so a second window on the same Mac does not steal the deck from it unless the live window has truly stopped for 30 seconds.
- Disconnect in the deck screen now really parks the deck; the watchdog no longer undoes it ten seconds later.
- The deck no longer dims itself while you are live. The first press after a dim (off Live) restores the brightness before it fires so you see the flash.
- Learn mode ends by itself after 20 seconds and a press it consumes flashes red. The Diagnostics dial check logs turns and holds them back from the show, and flashes the zone red so a held turn never reads as a dead deck.

### Every refused press shows on the hardware (both files)
- Any key whose action refuses flashes red, prompter keys included. Dial turns, dial presses and strip taps that refuse paint a short red bar on that strip zone.
- GO, cue and pad keys dim when a fire would be refused (not on Live, or nowhere to send). Pause, stop, fade and PANIC never dim.
- Press flashes and refused flashes jump ahead of strip and animation writes, so a flash always paints within one pass even when the strip is busy.
- A playout command the Air could not play (unknown cue, missing media, audio locked, output detached) comes back as a refused acknowledgement: the matching key flashes red and the Cueola tab toasts "Playout did not play <name>: <reason>". While a command is waiting for its acknowledgement the amber doubt dot shows on the playout keys.

### Deck transport obeys the same rules as the keyboard (cueola-app.js)
- GO from the deck during the READY, TRACK, ROLL count is TAKE, exactly like the G key. It no longer fires a second clip.
- GO, cues and pads from the deck need the Live screen (or a solo, demo or same-window Outrangutan setup). Pause, stop, fade and PANIC work any time.

### The Pro never plays into its own hidden Outrangutan (cueola-app.js)
- A same-window Outrangutan handles a fire only when it is the designated playout: its screen is open in that window, or it has an output window open, or the rig is a single Mac with no other playout ever heard. Otherwise the command goes to the Air over the session.
- The deck's playout doubt dot and the "no Outrangutan has checked in" warning now read only real Air packets, never the Pro's own echo.

### Playout commands ride a queue with honest answers (cueola-app.js, outrangutan/outrangutan.js)
- Every command is written to a short queue on the session as well as the old single slot. The Air on this build reads the queue, so a pad, a retry or a reconnect can no longer overwrite a GO before the Air sees it. A reconnect executes only commands from the last ten seconds instead of eating whatever sat in the slot.
- Each command carries an expiry. If the Pro is offline for more than eight seconds the retries stop with the "did NOT confirm" warning instead of firing a cue minutes later when the connection returns. The Air ignores expired entries.
- The Air acknowledges with ok or a plain reason. Older Airs still work through the slot; older Pros still work with the new Air.

### Reload rejoins the show (cueola-app.js)
- Joining a show puts the code in the Pro's address bar. A reload rejoins and, if you were live, returns to the Live screen without the Resume banner.
- A resume never publishes a stored row over the room's row: the doc's row wins, and a window never writes its own row until it has read the session once.
- The Resume banner path follows the same rule.

### The output window survives an Outrangutan reload (outrangutan/)
- The Outrangutan page keeps its controller identity across reloads in that tab. After a reload it adopts the output window that is still open and re-syncs it, paused. The output window re-announces itself every five seconds until adopted.
- A second Outrangutan window on the same Mac for the same show is told that another window is already driving, instead of both fighting for the output.
- The Cueola back chevron on the Air parks the runtime while joined to a show; it no longer closes the program window.
- "Tap or press a key for sound" no longer renders over program. If the browser refuses unmuted playback, the output keeps rolling muted and flags it; the next tap on the Outrangutan page unlocks the audio and resends play.

### Both Macs know which build they run (both files, sw.js)
- Every window publishes its build hash (presence on the Pro, the live packet on the Air, the heartbeat on the talent display).
- The Go Live check gains a Build row for the Air and for the talent display. Amber means an older build; the fix button reloads that machine from the Pro, and the Air's output window survives it.
- A window that is not live and not joined applies a waiting update by itself at page load. A live window still shows the update box and waits for you. A sibling window whose update box used to be dead now reloads when pressed.

### Roles and timers (cueola-app.js)
- The bus claim (who executes deck presses for the show) is per window, not per Chrome profile, so a launcher window on the Pro no longer shadows the Live window. A released claim is honored at once instead of after 15 seconds.
- Granting a student releases the claim immediately, so your deck keys switch to publishing as soon as the grant lands.
- Only an instructor or the grant holder can publish rundown presses; a student's Mini without the grant gets a red flash instead of advancing the show.
- A local refusal (end of the rundown, for example) is no longer published as if it succeeded.
- Manual TAKE follows the session; a stale setting on this Mac cannot park a joined show.
- The presence beat rides a worker timer, so a hidden tab behind OBS can no longer lapse and flip the caller role.
- The talent display keeps scrolling from a worker timer when its window is covered, and its heartbeat reports a real stall; the deck's prompter lamp goes off when the talent is stalled.

## Review round (same day)

Three independent reviewers read the whole diff against the intent and tried to break it. Twenty-two findings survived and all were fixed:

- An older Pro (a window still on the previous build) writing only the single slot was deaf to a new Air; the Air now reads the slot for any command the queue does not carry. The standby "arm the next cue" write rides the queue too.
- A stop or PANIC arriving in the same update as an older GO no longer lets the GO play afterwards.
- A second Outrangutan window for the same show stops listening instead of driving alongside the first.
- Leaving the Outrangutan screen keeps the runtime and the listener when that Mac has an output window open (single-Mac rigs kept playing); a hidden copy with no outputs goes quiet.
- The Air learns the Pro's clock from the commands it receives, so a drifted clock cannot make every fire read as expired; a skipped command now toasts on the Air.
- A reloaded Live window recognizes its own previous claim, so deck presses from a second window are not black-holed for 15 seconds after a reload.
- The automatic update at page load never fires during a rejoin or a live reload.
- The scrub dial flashes its zone red when the prompter is held by Flowmingo Op; a fade refused by the Air flashes the FADE key; the doubt dot marks only the key whose command is waiting; a queued prompter command (talent not linked yet) counts as landed, not refused.
- Disconnect in the deck screen stays disconnected until you connect again or re-enter Live; a live window takes the deck back if the Elgato app held it at go-live and was quit later.
- Smaller: a late acknowledgement of a retried command carries the real outcome; the reload fix cannot loop; the audio unlock is throttled; transport refusals read "Playout refused PAUSE" rather than "did not play".

## Show day, in order (each step names the machine and the window)

### Air (playout Mac)
1. **Chrome:** open cueola.live and sign in if the front page asks. If a "Cueola update ready" box appears, press its Reload.
2. **Same Chrome, new window:** open cueola.live/outrangutan. The join sheet opens with the show prefilled. Press Join. The badge must read "Session · CODE". Red "NOT LISTENING" means sign in on this Mac and press Join again.
3. **Outrangutan, Outputs:** press Open for Output 1, drag it to the program display, make it fullscreen. Wait for "Output 1 is ready." From now on a reload of this page keeps that window.
4. **Outrangutan page:** click once anywhere in the page so the audio engine can start. The Pro's check panel shows "Playout first GO" green once you have.
5. **Same Chrome, another window:** open cueola.live/flowmingo and tap the show under "Your shows". The pill reads "READY · CODE". Put it on the talent display and press F for fullscreen.

### Pro (your Mac)
6. **Dock:** quit the Elgato Stream Deck app. It holds the USB device.
7. **Chrome:** open cueola.live. If the update box appears, press Reload. Sign in if asked.
8. **Front page:** tap the show row. The rundown opens. Check the systems chip in the toolbar shows DECK. If it does not, open KeyWi Bird from the front page, press Connect deck, pick the + XL, then Esc back.
9. **Rundown toolbar:** press Go Live. The check panel groups by machine. Every row has a fix button; the new Build rows tell you if the Air or the talent display is on an older build and can reload them from here. Press Go Live.
10. **Live screen:** the deck now belongs to this window no matter which window had it before. Bring OBS to the front. Run the show from the deck. A red flash on a key means that press was refused or the Air could not play it; a lit key with no flash means it landed.

### If something happens mid-show
- **Pro reloaded by accident:** it rejoins the show and returns to Live on its own. The deck follows.
- **Air Outrangutan reloaded:** it rejoins and the output window keeps playing.
- **Deck went dark:** it no longer dims itself while you are live. A dark deck means the USB lead or the Elgato app.
- **Student director:** grant from the CALLER chip once their presence bubble shows. Your keys go to "publish" at once. Take back from the same chip.

## Deploy ritual
1. **Terminal, repo root:** `node scripts/check-contracts.mjs`, then commit and push (cueola.live is GitHub Pages; the push is the deploy).
2. **Every Cueola window on both Macs:** reload once. A window that is not live applies the update by itself now. A live window shows the update box; press its Reload when the show allows.
3. **Air:** the output window survives the Outrangutan reload. If it does not come back, close it and press Open.
