# Outrangutan for Mac

The playback app, built for the Mac. It plays video, sound and stills to an
output screen, driven by GO. See PLAN.md for where it is going.

## Build it

In Terminal, from this folder:

```
./build-app.sh
```

The app lands in `build/Outrangutan.app`. Double-click it to open it, or drag
it to Applications.

Xcode must be installed. You do not need to switch Xcode on first, because
the build script points at it for you. The app needs macOS 14 (Sonoma) or newer.

## Use it

**Help, Outrangutan Help** (Command-?) explains all of this in plain words,
for students running the show.

- The toolbar holds the everyday tools: **Cues / Pads**, **Add Media**,
  **Add Matte** (a solid color picture), **Outputs**, the connection light,
  and the **Inspector** button.
- Drag videos, sounds or stills into the window, or click **Add Media**.
- Click a cue to stand it by. Drag cues to reorder them.
- **Edit, Undo** (Command-Z) and **Redo** (Shift-Command-Z) take back any
  change to the cues or pads: adding, removing, moving, Inspector changes (a
  slider drag is one step) and pad edits. Opening or starting a show clears
  the list, like any Mac app. While editing is locked, Undo waits.
- **Edit, Duplicate Cue** (Command-D) copies the cue standing by, right
  after it.
- Shift-click or Command-click to pick several cues. Right-click them to
  Skip or Fire on GO, color, duplicate or remove them all at once (one Undo
  step). Delete removes the picked cues.
- The **Inspector** on the right (Command-I) holds every setting for the
  cue standing by. Its icon tabs show one group at a time:
  - **Cue:** name, notes, a color (a stripe on its row, the web app's six
    cue colors), Fire on GO, a pad that comes with the cue, and OBS.
  - **Timing:** pre-wait, what happens after it starts (Manual, Continue,
    Follow), how long a still stays up, and what happens at the end.
  - **Trim and Sound:** a picture of the clip (frames and its sound wave)
    with yellow In and Out handles to drag, or type start at and stop at;
    loop; volume. Pads have the same trim bar.
  - **Fades:** fade in, fade out, dissolve in, and the fade's curve.
  - **Picture:** which output it shows on, framing, size and position, or a
    matte's color. Videos also get a **Key**: Chroma (take out a color, like
    a green screen), Luma (take out the dark parts, for graphics on black)
    or Alpha (the file's own see-through parts), filled with a background
    color. It runs on the graphics card at full size and changes on air.
- **Outputs** in the toolbar opens or closes every output. Its menu opens
  one at a time and has **Identify**, which puts each output's number on its
  screen for three seconds.
- **Settings** (Command-comma) holds the look (match the Mac, dark or light),
  the outputs (name, screen, and a sound device for each one's video), and
  where sound goes (cue sound, and the pads' device and channel pair).
- The **Playback** menu lists every show control with its key.
- **Open Output** puts the picture on the second screen. With one screen it
  opens as a normal window.
- If a program screen's cable gets bumped, its output turns into a normal
  window on the control screen (never on top of GO), and goes back full
  screen when the screen returns. The show keeps playing through it.

| Key | What it does |
|---|---|
| Space | GO: fire the standby cue, stand by the next one |
| P | Pause, press again to carry on |
| S | Stop what fired last (picture or sound) |
| F | Fade: picture and sound fade out over one second, then stop |
| Esc | All Stop: everything off, output to black |

- Change any show key in **Settings, Keys**: click the key, press the new
  one. Holding a key down never fires it twice.
- **Lock Editing** (the lock in the toolbar, or Shift-Command-L) keeps a
  stray click from changing the show: nothing can be added, removed, moved
  or edited. GO, the show keys, pads, the rundown and the deck still work.
- **MIDI:** plug in any MIDI box (pad controller, fader box, keyboard). In
  **Settings, MIDI**, click **Learn a Control**, touch a button or fader,
  then pick what it does: GO, Pause, Stop, Fade, All Stop, a cue, a pad, or
  (for a fader) the master level. The touch that teaches a control never
  fires anything.
- The time of day sits under the big clock. Click it for a 12-hour or
  24-hour clock.

- **Up and Down arrows** move the standby. **Command-1** and **Command-2**
  switch between Cues and Pads.
- Click the big clock to count **up** (time played, green) or **down** (time
  left). The small arrow beside it shows which.
- **Standby text** (Settings, Outputs): words every output shows while
  nothing is on air, like the show's name or "We'll be right back".

Sounds play on their own lane, so a sound effect never knocks the picture
off air. A still holds until the next picture cue, or counts down when it has
a time. While paused, GO carries on, like the web app.

The show saves itself after every change, to
`~/Library/Application Support/Outrangutan/show.json`.

## Show Check

Before class, click **Show Check** in the toolbar (or Playback, Show Check).
It checks everything that can bite mid-show and lists it in red, orange or
green, each with a button to fix it where it can: missing media, pads that
won't load, closed outputs, an unplugged program screen or sound device,
battery power, Low Power Mode, a nearly full disk, the show link, OBS, and
whether editing is locked.

## Show files

The **File** menu makes a show file to carry to another Mac or to the web
app: **Save Show** (Command-S), **Save Show As** (Shift-Command-S), **Open
Show** (Command-O) and **New Show** (Command-N).

- A show file (`.ogshow`) is the same file the web Outrangutan saves: the
  cues, the pads and every media file, in one file up to 4 GB.
- A show saved in the browser opens here, and one saved here opens in the
  browser. Cues keep their ids, so rundown rows linked to them stay linked.
- Opening a show copies its media to **Movies, Outrangutan**, in a folder
  named for the show.
- Saving runs in the background, with a progress bar in the toolbar. The
  show keeps running while it saves.
- The window is named for the show file. Double-clicking a show file in
  Finder opens it here.

## Show log and printing

- **Show Log** (Window menu, Command-L) lists every GO, stop, pause, pad hit,
  output opened or closed, command from the show and problem, with the time
  and who asked for it ("This Mac", or the person in Cueola). Search it,
  pick what it shows, export it as text or print it.
- Every day's log is also saved to
  `~/Library/Application Support/Outrangutan/Logs`, a line at a time, so a
  crash never loses it.
- **Print Cue Sheet** (File menu, Command-P) prints the cue list and the pad
  map for the booth. The print window can also save a PDF.

If Outrangutan closes during a show (a crash, a force quit, a pulled plug),
it says what was on air when it opens again. **Stand By** puts that cue on
standby, and its next GO picks up where it stopped.

## Sound effect pads

Find a pad by name, emoji or key with the search field in the toolbar
(Pads view). It looks through every bank.

**Record** (in the pad bar, or right-click an empty pad) records a sound
effect from the Mac's sound input onto a pad. macOS asks once to allow the
microphone. Recordings are kept in Music, Outrangutan Recordings.

Switch to **Pads** above the list.

- Drop sounds on the board (or on one pad), or click an empty pad to pick one.
- Click a pad, or press its hotkey, to hit it. The bar on the pad shows how
  far along it is.
- Banks are pages of pads. Right-click a bank to rename or remove it.
- **Several at once** off: hitting a pad stops every other pad.
- The Inspector holds each pad's name, emoji, color, hotkey, volume, what a
  second hit does (Restart, Layer, Toggle), loop, fades, trim, a three-band
  EQ and a compressor.
- A cue can bring a pad with it: pick it under "Sound effect with this cue".
  It fires when the cue starts (after an optional wait) and fades out when
  the cue leaves air.

Stop (S) stops cues but lets pads ring. Fade (F) fades pads too. All Stop
(Esc) stops everything.

## Connect it to a show

Click the light in the bottom bar, or press Command-K.

1. Pick **Student** or **Instructor**.
2. Type the username, and the PIN or password. These are the same ones you
   use on the Cueola front door.
3. Type the show code and click **Connect**.

The light turns green: "Connected to" and the code. From then on:

- The director's TAKE on the rundown fires cues here.
- The KeyWi Bird playback keys (GO, Pause, Stop, Fade, PANIC, cue keys and
  the volume dial) work this Mac. No change is needed in KeyWi Bird.
- The rundown cell, the deck's playback strip and the Go Live checks show
  what is on air here.

The Mac checks the show about four times a second. Everything plays on this
Mac first, so if the internet drops, the show keeps going and only the link
waits. The sign-in lasts until the app quits; the PIN or password is never
saved.

Run only one Outrangutan on a show at a time: this app or the web one.

Pads work from the rundown and the deck too: a pad key, a TAKE-linked sound
effect, or a rundown row's sound effect hits the pad on this Mac.

## Watch a folder

**File, Watch a Folder** (or Settings, General) picks a folder. New videos,
sounds and stills that land in it join the show on their own: point it at a
shared Dropbox or Google Drive folder and the crew can send clips from
anywhere. A file joins only once it has finished arriving (the same size
three looks in a row, and it really opens). Sounds can become pads instead.
While editing is locked, new files wait until it unlocks.

## OBS

In **Settings, OBS**, enter OBS's address (localhost for OBS on this Mac),
port and password from OBS's Tools, WebSocket Server Settings, and click
Connect. Then in a cue's Inspector (Cue tab, OBS):

- **When it starts:** switch OBS to a scene, or start or stop recording or
  streaming, as the cue starts.
- **Fire when OBS shows:** the cue stands by and fires when OBS switches to
  that scene. A cue's own scene switch never fires it again.

The password stays on this Mac, in the app's settings.

## Program preview and scopes

Under the transport sits a strip with the **program preview** (a live copy
of Output 1, or pick another output), the **waveform** (how bright each part
of the picture is, 0 to 100) and the **vectorscope** (its colors: a boxed
target for each color bar). Hide the strip with View, Program Preview
(Option-Command-P), or just the scopes with the button under the preview
(Option-Command-S). The scopes read the picture 15 times a second only
while they show. The **SOUND** meter under the preview shows how loud the cues are
(videos and sound cues, at their volume); pads keep their own meter.

## The direct link (same Mac)

When Cueola runs in Chrome on the same Mac as this app, turn on **Outrangutan
for Mac** in KeyWi Bird's Deck settings. Its playback keys then come straight
here over a private connection on this Mac (port 47810), in about a
hundredth of a second, even with the internet down. A lightning bolt next to
the connection light shows it is on. The cloud still carries every command
as the backup, and each command plays once. Only Cueola's own pages, for
the show this Mac is on, are let in.

## Check it

```
swift test
```

Test mode is silent: videos are muted and the pads play to a silent output
(the pad meter still moves). It opens the app in the background, presses GO, Pause and All Stop by
itself, saves pictures of both windows into a folder and writes what happened
to `test-log.txt`:

```
OUTRANGUTAN_SNAPSHOT=/path/to/folder build/Outrangutan.app/Contents/MacOS/Outrangutan
```

It plays whatever is in the saved show, so load a few cues first. It never
saves changes to your show.

Pick another test with `OUTRANGUTAN_SCENARIO`:

- `transport` (the default): GO, Pause, All Stop pressed on this Mac.
- `link`: a pretend show record plays the rundown's part and sends the same
  commands the rundown and KeyWi Bird send. No internet is used.
- `pads`: loading pads, Restart, Layer and Toggle, a hit from the rundown, a
  pad tied to a cue, Stop letting pads ring, PANIC, and hotkeys.
- `outputs`: two outputs, a cue on each and one on every output, what the
  rundown hears, Identify, sound devices, pad routing and the pad meter.
- `timing`: pre-wait, a still timer that follows into a dissolve, a trimmed
  video that holds, Continue, a matte, a trimmed loop, Pause and Fade.
- `connect`: saves a picture of the Connect window.
- `direct`: a pretend Cueola page using the direct link, a page from another
  website turned away, and a direct GO's cloud copy not playing twice. Run
  it with `OUTRANGUTAN_DIRECT_PORT=47819` so it never meets the real app.
- `fixes`: a still landing mid-dissolve, a pad added while a bed plays, an
  output whose screen is missing, the crash note after opening a show, and
  standby words in a show file.
- `multi`: skip, color, duplicate and remove two cues at once, each undone
  in one step.
- `help`: a picture of the Help window.
- `extras`: standby words on an empty output, the arrow keys moving the
  standby, and the numbers behind the count-up clock.
- `screens`: a pretend projector connects and is unplugged while a video
  plays; the video keeps playing and the output lands as a window.
- `check`: Show Check with planted problems (a missing file, closed
  outputs, an unplugged sound device, OBS off), then two fixes pressed.
- `record`: a pretend microphone records onto a pad; a second take with
  the same name gets its own file.
- `trim`: pictures of the trim bar for a video cue and a pad.
- `undo`: Undo and Redo for adding, a slider drag, removing, moving,
  duplicating and a pad change, the lock holding an undo back, and opening a
  show clearing the history.
- `meter`: the cue sound meter at full and quarter volume, a dozen fast cue
  swaps, and the meter falling after All Stop.
- `cuepair`: cue sound on channels 3 and 4, by way of the cue sound engine:
  a 44.1 kHz mono file, a 48 kHz stereo one and a video, each measured
  against the player's own clock, a pause that hands out nothing, All Stop,
  and back to channels 1 and 2 straight from the player.
- `padsearch`: pictures of the pad search, with matches and with none.
- `watch`: a watched folder: a half-copied clip waits, a finished one joins,
  a sound becomes a pad, and the lock holds new files.
- `obs`: a pretend OBS checks the password proof (against openssl), takes a
  cue's scene switch and a start recording, and fires a cue with its own
  scene change.
- `key`: color bars with the green bar keyed out, then a luma key switched
  on while on air; reads the real frames.
- `scopes`: color bars, a still and a red matte through the preview and the
  scopes; saves each scope and the frame it read.
- `listen`: joins show WEBTEST and waits a minute, for trying the direct
  link from a real browser.
- `midi`: learning a button and a fader and using them, then a message from
  a pretend MIDI box through the Mac's own MIDI system.
- `keys`: moved show keys, a held key, two keys swapping, the lock, and the
  time of day. Its key presses are pretend ones, sent to the app only.
- `log`: a short show from this Mac and from the rundown, then a picture of
  the Show Log and the cue sheet and log printed to PDF.
- `files`: saves a show file, opens it again and checks every cue and pad
  came back the same, opens a file shaped like the web app's, and picks up
  after a pretend crash. Everything is written inside the test folder.

## What is inside

| File | What it holds |
|---|---|
| `OutrangutanApp.swift` | Starts the app, the show keys, keeps macOS from slowing it down |
| `Engine.swift` | The cue list, what is on air, GO, Pause, Stop, All Stop, the clock |
| `ControlView.swift` | The control window and its toolbar |
| `InspectorKit.swift` | Inspector parts: icon tabs, flat sections, rows |
| `SettingsView.swift` | Settings: look, outputs, sound |
| `Outputs.swift` | What an output and the sound settings remember |
| `AudioDevices.swift` | The Mac's sound outputs |
| `InspectorView.swift` | Every setting for the cue standing by |
| `Fader.swift` | Every fade, from one steady clock |
| `Pads.swift` | The sound effect board and its sound paths |
| `PadBoardView.swift` | The pad board and the pad Inspector |
| `OutputWindow.swift` | The output screen |
| `Cue.swift` | What a cue is, saving the show, and the crash note |
| `WatchFolder.swift` | Watching a folder (Dropbox, Google Drive) for new media |
| `Obs.swift` | OBS Studio control and Settings, OBS |
| `SoundTap.swift` | Listens to cue sound for the meter, without changing it |
| `Thumbnails.swift` | The small pictures in the cue list |
| `ShowCheck.swift` | Show Check: the before-the-show checklist |
| `Recorder.swift` | Recording a sound effect onto a pad |
| `TrimView.swift` | The trim bar: frames, sound wave, In and Out handles |
| `Keyer.swift` | Chroma, luma and alpha keys on the graphics card |
| `Scopes.swift` | The program preview strip, waveform and vectorscope |
| `DirectLink.swift` | The direct link from Cueola on this Mac |
| `Midi.swift` | MIDI boxes and Settings, MIDI |
| `HelpView.swift` | Outrangutan Help, in plain words |
| `Keys.swift` | The show keys and Settings, Keys |
| `ShowLog.swift` | The show log and its window |
| `Printer.swift` | Printing the cue sheet and the log |
| `ShowFiles.swift` | New, Open and Save: show files the web app shares |
| `ShowLink.swift` | The link to a show: reading commands, answering, telling the rundown what is on air |
| `CloudClient.swift` | Signing in and reading and writing the show record |
| `ConnectView.swift` | The Connect window and the light in the bottom bar |
| `TestSnapshot.swift` | Test mode |

The rules for talking to the rundown sit in their own piece, `OutrangutanCore`,
so `swift test` can check each one:

| File | What it holds |
|---|---|
| `CommandInbox.swift` | Which commands run, which are old, retries, a stop beating older fires |
| `LivePacket.swift` | What is on air, in the rundown's words |
| `FirestoreValue.swift` | The cloud's written form of values |
| `FadeCurve.swift` | The three fade shapes, the same as the web app |
| `Timecode.swift` | 29.97 drop-frame clock text, the same as the web clock |
| `MidiRouter.swift` | What a MIDI message does, the same rules as the web app |
| `ScopeMath.swift` | The waveform and vectorscope math (Rec. 709) |
| `ShowArchive.swift` | The show file's zip: writing and reading it in slices, and its checksum |
