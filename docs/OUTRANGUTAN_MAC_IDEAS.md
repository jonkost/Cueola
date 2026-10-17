# Outrangutan for Mac: ideas for the next round

This is the list of what to build next in Outrangutan for Mac, after the Oct 16 show round. Forty-eight ideas were scored by three judges on value, fit with how the app is built, and risk; each judge also read the app to check the idea is not already built. Read "The next five" first, then skim the rest to see what waits and what was set aside.

Effort: S is a short session, M is a day or two, L is a week or more.

## The next five

These five make one round: nothing goes to black by accident, and the operator sees what comes next right where they are looking. All five are small, all five live in the live moment of a show, and none of them touches the sign-in, the rundown's side of the link, or the show file.

### 1. Ask before anything that would black the program

Today one click can end the show. The red close button on the control window quits the app. The Outputs button in the toolbar closes every output at once, and it sits right next to the Inspector button. With something on air, each of these asks first: "Weather is on air. Close the output anyway?" with Cancel as the safe default. With nothing on air, nothing asks.

Why it matters: a nervous hand reaching for the Inspector hits Outputs instead, or closes the window to tidy up, and the program goes to black mid-show. The ask makes that mistake impossible.

Effort: S.

Where it lives: a standard alert sheet on the control window, Apple's button order with Cancel as the default. It covers Quit, the window's close button, the Outputs toolbar button and its menu, Playback, Close All Outputs, and the close button of a windowed output.

Judges' notes: all three confirmed the app quits when its last window closes and nothing asks. The show-file sheets already use Apple's alert pattern, so the look is settled. The sheet must never appear when nothing is on air, and test mode (which quits itself) must skip it, or the tests hang.

### 2. One GO at a time: a double tap fires one cue

A second GO within half a second of the first is ignored, from any source: the Space bar, the deck, a MIDI box or the rundown. A line under the clock says "GO pressed twice. The second was ignored." so it is never silent.

Why it matters: a nervous double tap on Space, or Space and the deck key together, fires two cues and the second one knocks the first off air before anyone sees it. This is the most common first-show mistake and the hardest to recover from.

Effort: S.

Where it lives: inside GO itself in the playback engine, so every key, deck, MIDI box and rundown fire gets the same guard. The notice uses the orange line under the clock where "Editing is locked" already shows.

Judges' notes: holding a key down is already ignored, but a true double tap is not. GO is one funnel for every source, so the guard sits in one place. Continue and Follow chains do not go through GO, so they are not slowed. A TAKE from the rundown that lands inside the half second must still get its "got it" reply, or the rundown retries.

### 3. "Then what" beside the clock, and a warning when a clip will end into black

Two ideas built as one readout. A small line under the big clock reads "then holds last frame", "then cuts to black", "then Follow: 4. Anchor VO" or "loops". When a cue on air has ten seconds left, it is set to Manual, and nothing is standing by (or the standby's file is missing), the clock turns orange and the Multiview and the Stream Deck's GO key say NOTHING NEXT. Standing by any cue clears it. When the standby cue cannot fire (its file is missing, or it is set to Skip), the Standby line turns orange and says why, before GO is pressed.

Why it matters: the most common student mistake on air is the clip running out into black while the director yells. And the ten-second panic is not knowing whether the picture will hold or go to black. Today a student learns a file is missing only after pressing GO.

Effort: S.

Where it lives: the control window header, a caption under the big clock beside Left and Played, and the Standby line itself in orange with the reason; the clock in the transport row (orange instead of green); the Multiview's clock or preview caption; the GO key face on every Stream Deck model. One flag in the engine drives all of it.

Judges' notes: everything it needs is already on the cue and in the engine (end action, continue mode, loop, skip, whether the file is there, time left). The Multiview has no status box today, so the words land by its clock. The readout must match the engine's real end rules exactly, including that a still never cuts to black on its own, or it lies at the worst moment. It stays quiet on the last cue of the show and when the end action is Hold last frame.

### 4. The next cue where the hand is: notes and the GO key

A cue's notes ("wait for Anna to say 'and now'") live only in the Inspector's Cue tab today. They show on one line right under "Standby: 3. Weather" in the header, and in the Multiview's NEXT list. On a Stream Deck, the GO key names the standby cue in its small top line ("#3 Weather") instead of only the key name.

Why it matters: the operator's eyes are on the clock and the GO button, not the Inspector. The cue they are about to fire, and the note about when to fire it, sit exactly where they are looking.

Effort: S.

Where it lives: the control window header, a secondary line under the Standby line; the first row of the Multiview's NEXT list; the GO key's top line on every Stream Deck model.

Judges' notes: all three confirmed notes exist on the cue and show only in the Inspector and the printed cue sheet. The header has a line slot, the Multiview NEXT list exists, and the deck's GO key already has a top line (it prints the key name today). All three are text changes. A long note gets one line cut with dots and the whole note on hover; the deck key has room for about three words. Ideas 31 and 45 were the same idea.

### 5. Link light on the Multiview and the deck

Only the control window's subtitle says "Not hearing show". The director across the room finds out when a TAKE does nothing. This puts the link state where people look: a chip by the Multiview clock (green, amber for "cloud busy, writing less", red for "no link"), the same words on a Stream Deck + strip zone, a thin red rim on the deck's GO key while fires from the rundown cannot arrive, and a line under the clock saying "Fire from this Mac".

Why it matters: when the Wi-Fi drops or the cloud refuses writes, everyone knows in one glance who has to press GO, instead of two people guessing on air. This is aimed straight at what went wrong on Oct 16.

Effort: S.

Where it lives: the Multiview window (a chip beside the count-out clock), the Stream Deck + strip and the GO key face, and the notice row under the big clock in the control window.

Judges' notes: the link already knows its three states (open, busy and backing off, down) and already follows the five-second rule before calling a blip a problem, so this only shows what it knows. The deck's key faces have a rim field and the strip has spare room. It must follow the same five-second rule, or a flashing light on every two-second blip would cry wolf.

## The rest, in order

- Find a missing file, nothing else lost (S). Next in line after the five: a Find the File button in the Inspector and Show Check re-points a cue at its moved file and keeps its name, trim, fades, key and pad, with a sweep of the same folder for the other missing cues; check the trim against the new length.
- Who is at this Mac: the playback op's name (S). The student's name from the Connect sheet replaces "This Mac" in every log line and tells the rundown who is on playback; a handover is a re-connect, so no second name box is needed.
- Stutter watch: dropped frames and heat in the log (S). After each cue leaves air the engine reads the player's own count of dropped frames and stalls and writes it to the Show Log, with a DROPPED chip under the clock and a "This Mac is hot" row in Show Check; read after the first second so trim jumps do not count.
- Media check: will every file actually play? (M). Show Check opens every cue and pad in the background, flags files that will not open, 4K or 60p clips, silent videos and files on a stick or an undownloaded cloud folder, with a "Copy to this Mac" fix; never runs on a cue that is on air.
- Cue listen in headphones (M). The Multiview's silent preview roll gets a headphone device and channel pair in Settings, Sound, so a student hears the standby cue or a pad before GO; it must refuse the cue and pad devices and stop the instant that cue goes to air.
- Lock playback editing from the rundown (S). The Mac reports its lock through the show link and the Go Live checklist gets a row with a "Lock on the Air" button, the same pattern as the other fix buttons; the Mac's toolbar lock stays in charge.
- Save a Report: logs and link stats in one file (S). The link counts reads, writes, refusals and backoffs, and one button packs the day's log, the crash note, the show list, the settings and the last Show Check into one file to AirDrop to Jon, with the password and sign-in token left out.
- Next up on the rundown (S). The Mac tells the rundown which cue stands by, which output it goes to and what happens at its end, as a second line in the Live screen's playout strip; it rides the on-air write and only goes out on change, and the web strip needs the second line.
- A note from the director to the playback Mac (S). The director types a short line in the playout strip and it shows under the big clock and on the deck's strip until cleared; it needs its own field in the show record, never the command slot, and may need a rules update.
- Show Report: how the playback op did (M). One button reads the day's log and prints a plain-words report of every fire, dead air, wrong standbys, All Stops and problems; the judges advise keeping a small structured event list as the show runs rather than re-reading the flat log, and saying "could not tell" rather than guessing.
- A practice show that ships inside the app (M). File, Open the Practice Show loads a small built-in show (bars, a countdown, a lower third over chroma green, a looping bed, a matte, two pads) that the app draws itself on first open; shares its bars and tone with the Bars and tone cue below.
- Preview beside Program in the strip (S). A PREVIEW box with a green tally and a Roll button to the right of PROGRAM under the transport, reusing the Multiview's preview; it must give way to the load-ahead and stop rolling the instant the cue goes to air.
- File, Open Recent (S). The last ten show files under Open Show, plus the Dock menu's recent list, with moved files dropping out quietly; the app is not document-based, so the menu is built by hand.
- Reset for the next class, in one sheet (S). One sheet with checkboxes (save, clear cues and pads, close outputs, leave the show, unlock, volume to 100, clear the crash note and the log) that refuses while anything is on air, with Cancel as default; every piece already exists.
- Bars and tone cue (S, closer to M). A drawn cue of SMPTE bars with a 1 kHz tone at -20 dB on the cue sound device, placed inside the Add Matte menu; it must land on the scopes' own targets, and the show file must still open in the web app, so save it as a picture plus a sound file.
- Restore an earlier version of the show (S). Timed copies of the cue list and pads (never media), thinned over time, under Apple's own File, Revert To wording; the undo snapshot is the exact thing to keep.
- Show Check reaches the Go Live checklist (M). The Mac sends its Show Check rows (battery, Low Power Mode, disk, screen, sound device, pads, outputs) to the director's checklist with fix buttons; send on request and on a slow timer, never every tick.
- Go to a cue at the end (S). A fourth end action with a cue picker, so three clips can loop as a pre-show wall; a manual GO must break the loop, and the web app must keep an unknown end action without breaking.
- Silent clip warning (M). An amber "No sound" line under the clock and a chip in the rundown's playout strip when a clip with sound is on air but the volume is at zero, the device is unplugged or the output is muted; the false alarms (silent b-roll, a fade in) are the whole job.
- Take Back the last GO (M). One press puts the cue that just left air back at the point it left, under a short dissolve; needs a sixth show key on every deck model and a clean refusal mid-dissolve or with a missing file.
- The Dock icon says ON AIR (S). A red ON AIR badge on the Dock icon and the on-air and standby names in its menu; the judges say drop the GO and All Stop buttons from the Dock menu, since a misclick there is a hazard.
- Fix a wrong clip from the rundown (M). Restart, Back 10 s and Go to Next in the Mac's Playback menu and in the rundown's Playback cell; the Mac half is easy, but they are new commands on the wire, so the web app and the web Outrangutan must learn them too.
- Ask before GO on a marked cue (S). A per-cue "Ask before GO" switch with a sheet at GO; the judges rank it low because a sheet mid-show can hold GO hostage and a director's TAKE has to bypass it anyway.
- Clip frames on the Stream Deck's cue keys (M). Each cue key shows a small frame of the clip under its number, and the on-air key shows the time left; the thumbnails exist, but a picture with a number over it can get busy on a 72-pixel key.
- Who has the deck: find and fix the conflict (S, the KeyWi half is bigger). When the deck will not open, name the holder (the Elgato app, or KeyWi Bird in a browser), offer to quit it or take the deck, and retry every five seconds; taking it from KeyWi Bird needs a new park message and web-side code.
- Rehearsal mode (M). Run the whole show for real with every output black and a REHEARSAL word in the corner; the judges say build it with one gate that also holds back cloud writes, OBS and acks (idea 25 said it that way), or it is not a rehearsal.

## Left out

Duplicates, folded into the idea they repeat:

- Listen in headphones before air: the same as Cue listen in headphones.
- Rehearsal mode: practice without touching the show: the same as Rehearsal mode, and the better wording of it.
- The standby cue's note, where the op is looking: the same as idea 4 above.
- The operator's note where the operator looks: the same as idea 4 above.
- Color bars and tone in the Add Matte menu: the same as the Bars and tone cue, and the better placement.

Scored under 7:

- Last ten seconds warning (6.3): half built already; the control window clock turns yellow at 30 s and red at 10 s. What is left is the Multiview clock and the deck strip, and the tick is risky because the Mac's default output is often the cue sound device.
- Comes back on its own after a crash (6.3): a relaunch helper is a second program outside the app, and keeping the sign-in in the Keychain touches the sign-in path Jon said to leave alone.
- Count-out beeps in the operator's headphones (6.3): overlaps the tick above and needs the headphone device from Cue listen; if that lands, this is a small add later.
- Lessons that watch what the student does (5.7): a large build, and the web app already carries the narrated lessons; nothing for the student on show day.
- Stop markers inside one clip (5.3): touches the heart of GO with frame-exact holds mid-file, and Duplicate Cue plus trim plus Follow already gives a package in three parts.
- Pictures of on air and next on the rundown (5.3): two pictures on every cue change into the one document the cloud already refused writes to on Oct 16 is the wrong direction; the names from Next up on the rundown cover most of it.
- Fire at a time of day (5.0): runs against how these shows work (the director's TAKE calls the start), and a stale armed time from last week firing in rehearsal is a real hazard.
- Multiview for the director's Mac (4.7): a new server on the Mac that is playing the show, sending frames over campus Wi-Fi that often blocks Mac-to-Mac traffic; big for a page that may not load in class.
- Key output on a second screen (4.0): two HDMI screens are not frame-locked, so the key can run a frame behind the fill; this belongs with the SDI card step, where key and fill are already planned.
- Relay over the room's network when the internet drops (3.3): a third app role that strains the one-Outrangutan-per-show rule and needs a two-Mac test; the direct link and the Oct 16 backoff already cover most of the failure.
- Spare Mac that follows the show (2.7): fights the one-Outrangutan-per-show rule the command inbox is built on, and a class rarely has a second playback Mac and switcher input.
