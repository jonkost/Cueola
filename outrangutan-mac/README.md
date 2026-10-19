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

If the build stops with "You have not agreed to the Xcode license
agreements" (it does after an Xcode update), either agree in Terminal with
`sudo xcodebuild -license accept`, or build with the command line tools
instead: `DEVELOPER_DIR=/Library/Developer/CommandLineTools ./build-app.sh`.
The app builds either way; `swift test` needs the full Xcode.

## Put it on the other Mac

After building, make a disk image to carry across:

```
./package-app.sh
```

The image lands in `build/Outrangutan.dmg`. AirDrop it or copy it on a
stick, open it on the other Mac, and drag Outrangutan into Applications.
The first time it opens, the Mac may say it cannot check the app for
malware: open System Settings, Privacy & Security, scroll down, click
"Open Anyway" next to Outrangutan, and open it again. The app is signed
for your own Macs, not through Apple's notary (that needs the paid
developer account). A "Read me first" file in the image says the same.

## Use it

**Help, Outrangutan Help** (Command-?) explains all of this in plain words,
for students running the show.

- The toolbar holds the everyday tools: **Cues / Pads**, **Add Media**,
  **Add Matte** (a solid color picture), **Outputs**, the connection light,
  and the **Inspector** button.
- Drag videos, sounds or stills into the window, or click **Add Media**.
  Dropped between two rows of the list, they land there. Media dropped on
  the Dock icon joins the list too. (While editing is locked, a drop says so
  under the clock instead of doing nothing.)
- Click a cue to stand it by. Drag cues to reorder them.
- The cue standing by is loaded ahead of its GO: the file is open, the
  first frames are decoded and the picture path is warm, so GO shows its
  first frame in about a tenth of a second and the first seconds play
  clean. A still standing by is read from disk ahead too.
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
    A still gets the Alpha key too: a see-through PNG (a lower third) shows
    over the background color, which fills the screen behind it. Pick
    Chroma green or Chroma blue from the Background menu for a key
    downstream; the color well takes any other color.
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
- **Stream Deck:** plug an Elgato Stream Deck into this Mac and the app
  drives it itself, no browser and no Elgato software (quit the Elgato
  Stream Deck app first). The first keys are GO, Pause, Stop, Fade and All
  Stop, with their keyboard keys printed on them; then the cues, with their
  numbers, red while on air and green while standing by (the XL shows
  sixteen at a time, the page the standby is on; the 15-key decks five);
  then the pads of the current bank, with their emoji. The XL also gets
  VOL −, VOL + and MUTE keys. A Stream Deck + puts the volume on dial 1
  (press it to mute), the standby on dial 2 (press it for GO), and shows
  the volume, what stands by, what is on air and the clock on its strip.
  **Settings, Stream Deck** has the on-off switch and the brightness. A
  deck on another Mac keeps working through KeyWi Bird in the browser
  there. Works on Jon's deck on the playback Mac (Oct 16). The Mini and
  the 2017 deck use the older bitmap pictures and have not been tried.
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
  named for the show. Opening the same show again uses that folder: a file
  already there at the right size is not copied twice, so a show opened at
  every class meeting keeps one copy of its media.
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

The cloud sends the show to the Mac the moment it changes (a live line,
opened when the Mac joins), and the Mac also reads the show every two
seconds as the safety net, or five times a second while the live line is
down. A fire from the rundown or a deck on another Mac lands here as fast
as the cloud can carry it. Everything plays on this Mac; the internet only
carries the commands and the answers. One Wi-Fi hiccup is not reported:
reads must fail for five seconds, or three in a row, before the log says
so. What is on air is written at most every two seconds while playing (the
rundown and the deck count down on their own from the clip's start time),
and everything one GO produces goes out as one write: the show record is
one document everyone writes to, and the cloud refuses writes past about
one a second. When it does, the Mac waits a little longer each time and
sends the newest values when it can.

Run only one Outrangutan on a show at a time: this app or the web one.

Pads work from the rundown and the deck too: a pad key, a TAKE-linked sound
effect, or a rundown row's sound effect hits the pad on this Mac.

## Watch a folder

**File, Watch a Folder** (or Settings, General) picks a folder. New videos,
sounds and stills that land in it join the show on their own: point it at a
shared Dropbox or Google Drive folder and the crew can send clips from
anywhere. A file joins only once it has finished arriving (the same size
and written-at time three looks in a row, and it really opens). A file that
will not open is said in the Show Log and tried again when it changes, and
now and then meanwhile, since a cloud file can finish downloading without
changing. A file written over after it joined is a new file: it joins again,
beside the old cue. Sounds can become pads instead; with every pad in the
bank taken, a sound becomes a cue, and the log says so. While editing is locked, new files wait until it unlocks.

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
- `multiview`: the Multiview window with bars on air and a still on
  standby, the preview following the standby down the list, a preview
  roll between trim points, and a picture of the window.
- `duck`: a video's sound dipping 12 dB while a pad sounds, coming back
  after, staying put with ducking off, and dipping when it is switched on
  mid-pad.
- `cuekeys`: a cue's hotkey fires it from anywhere, a pad with the same
  key wins, a show key wins over both, the key rides in a show file, and
  Go to Cue finds cues by number and by words.
- `strip`: pictures of the monitor row, the control window in all three
  layouts (Cues, Both side by side, Both stacked without the transport)
  and the Go to Cue sheet.
- `gallery`: a picture of every other screen (SFX board and its
  Inspector, each Settings tab, Connect, Show Check, Show Log, Help, the
  cue Inspector), for looking at the design. Test pictures cannot draw
  Liquid Glass; that needs eyes on the real app.
- `padsearch`: pictures of the pad search, with matches and with none.
- `watch`: a watched folder: a half-copied clip waits, a finished one joins
  (one half copied before the pick too), a sound becomes a pad, the lock
  holds new files, a file at its final size before its bytes are real is set
  aside and joins when the bytes land (with a new time, or unchanged after a
  few looks), a sound with every pad taken becomes a cue, a clip written
  over joins again.
- `obs`: a pretend OBS checks the password proof (against openssl), takes a
  cue's scene switch and a start recording, and fires a cue with its own
  scene change.
- `key`: color bars with the green bar keyed out, then a luma key switched
  on while on air; reads the real frames.
- `stillkey`: a see-through PNG (a lower third drawn by the test) standing
  over a chroma green background, then the key switched off on air; reads
  the real output pixels.
- `preload`: the cue standing by, loaded ahead: three GOs on a cue loaded
  ahead and three on one that was not, each timed from GO to the first
  frame on screen and to the picture moving, with the frames handed over
  each quarter second; then a sound loaded ahead, a still read ahead, and
  files dropped between rows.
- `stream`: the live line against the pretend cloud: a fire runs the moment
  it is written, one GO makes one write, and a busy cloud is waited out.
- `deck`: a pretend Stream Deck XL, then a pretend Stream Deck +: every
  key's picture put back together from the reports and laid out as a
  sheet (deck-xl.png, deck-plus.png, deck-plus-strip.png), GO, a cue key,
  a pad key, the volume keys, the cue page turning with the standby, the
  dials and the strip.
- `idle`: four cues and nothing else for about twenty seconds, with each
  row's place on the screen written to rows.txt, so a script can drag a
  real row with the mouse and the log shows the order after.
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
  came back the same, opens a file shaped like the web app's, picks up
  after a pretend crash, saves a media file that grows mid-save, opens the
  same show twice into Movies (one folder, nothing copied the second time)
  and opens a broken file (no half-made folder left). Everything is written
  inside the test folder, its own Movies included.

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
| `SoundTap.swift` | Listens to cue sound on the cue sound engine's channel pairs |
| `SoundEnvelope.swift` | Each clip's level over time, read ahead, for the cue meter |
| `Thumbnails.swift` | The small pictures in the cue list |
| `ShowCheck.swift` | Show Check: the before-the-show checklist |
| `Recorder.swift` | Recording a sound effect onto a pad |
| `TrimView.swift` | The trim bar: frames, sound wave, In and Out handles |
| `Keyer.swift` | Chroma, luma and alpha keys on the graphics card |
| `Scopes.swift` | The program preview strip, waveform and vectorscope |
| `DirectLink.swift` | The direct link from Cueola on this Mac |
| `Midi.swift` | MIDI boxes and Settings, MIDI |
| `StreamDeck.swift` | A Stream Deck on this Mac: key pictures, what each key does, USB, and Settings, Stream Deck |
| `TestDeck.swift` | The pretend Stream Deck for test mode |
| `HelpView.swift` | Outrangutan Help, in plain words |
| `Keys.swift` | The show keys and Settings, Keys |
| `ShowLog.swift` | The show log and its window |
| `Printer.swift` | Printing the cue sheet and the log |
| `ShowFiles.swift` | New, Open and Save: show files the web app shares |
| `ShowLink.swift` | The link to a show: reading commands, answering, telling the rundown what is on air |
| `CloudClient.swift` | Signing in, reading and writing the show record, and the live line |
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
| `StreamDeckProtocol.swift` | Every byte to and from a Stream Deck: the models, key states, dials, pictures cut into reports |
| `ListenStream.swift` | The live line's request, and its messages read as they arrive |
