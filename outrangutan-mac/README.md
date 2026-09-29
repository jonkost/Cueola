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

- The toolbar holds the everyday tools: **Cues / Pads**, **Add Media**,
  **Add Matte** (a solid color picture), **Outputs**, the connection light,
  and the **Inspector** button.
- Drag videos, sounds or stills into the window, or click **Add Media**.
- Click a cue to stand it by. Drag cues to reorder them.
- The **Inspector** on the right (Command-I) holds every setting for the
  cue standing by. Its icon tabs show one group at a time:
  - **Cue:** name, notes, Fire on GO, and a pad that comes with the cue.
  - **Timing:** pre-wait, what happens after it starts (Manual, Continue,
    Follow), how long a still stays up, and what happens at the end.
  - **Trim and Sound:** start at, stop at, loop, volume.
  - **Fades:** fade in, fade out, dissolve in, and the fade's curve.
  - **Picture:** which output it shows on, framing, size and position, or a
    matte's color.
- **Outputs** in the toolbar opens or closes every output. Its menu opens
  one at a time and has **Identify**, which puts each output's number on its
  screen for three seconds.
- **Settings** (Command-comma) holds the look (match the Mac, dark or light),
  the outputs (name, screen, and a sound device for each one's video), and
  where sound goes (cue sound, and the pads' device and channel pair).
- The **Playback** menu lists every show control with its key.
- **Open Output** puts the picture on the second screen. With one screen it
  opens as a normal window.

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

Sounds play on their own lane, so a sound effect never knocks the picture
off air. A still holds until the next picture cue, or counts down when it has
a time. While paused, GO carries on, like the web app.

The show saves itself after every change, to
`~/Library/Application Support/Outrangutan/show.json`.

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

## Program preview and scopes

Under the transport sits a strip with the **program preview** (a live copy
of Output 1, or pick another output), the **waveform** (how bright each part
of the picture is, 0 to 100) and the **vectorscope** (its colors: a boxed
target for each color bar). Hide the strip with View, Program Preview
(Option-Command-P), or just the scopes with the button under the preview
(Option-Command-S). The scopes read the picture 15 times a second only
while they show.

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
| `Scopes.swift` | The program preview strip, waveform and vectorscope |
| `DirectLink.swift` | The direct link from Cueola on this Mac |
| `Midi.swift` | MIDI boxes and Settings, MIDI |
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
