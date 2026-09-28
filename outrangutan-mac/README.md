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
the build script points at it for you.

## Use it

- Drag videos, sounds or stills into the window, or click **Add Media**.
  **Add Matte** adds a solid color picture.
- Click a cue to stand it by. Drag cues to reorder them.
- The **Inspector** on the right (Command-I) holds every setting for the
  cue standing by:
  - **Timing:** pre-wait, what happens after it starts (Manual, Continue,
    Follow), how long a still stays up, and what happens at the end.
  - **Trim and sound:** start at, stop at, loop, volume.
  - **Fades:** fade in, fade out, dissolve in, and the fade's curve.
  - **Picture:** framing, size and position, or a matte's color.
  - **Fire on GO:** turn it off and GO skips the cue.
- **Open Output** puts the picture on the second screen. With one screen it
  opens as a normal window.

| Key | What it does |
|---|---|
| Space | GO: fire the standby cue, stand by the next one |
| P | Pause, press again to carry on |
| S | Stop what fired last (picture or sound) |
| F | Fade: picture and sound fade out over one second, then stop |
| Esc | All Stop: everything off, output to black |

Sounds play on their own lane, so a sound effect never knocks the picture
off air. A still holds until the next picture cue, or counts down when it has
a time. While paused, GO carries on, like the web app.

The show saves itself after every change, to
`~/Library/Application Support/Outrangutan/show.json`.

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

## Check it

```
swift test
```

Test mode opens the app in the background, presses GO, Pause and All Stop by
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
- `timing`: pre-wait, a still timer that follows into a dissolve, a trimmed
  video that holds, Continue, a matte, a trimmed loop, Pause and Fade.
- `connect`: saves a picture of the Connect window.

## What is inside

| File | What it holds |
|---|---|
| `OutrangutanApp.swift` | Starts the app, the show keys, keeps macOS from slowing it down |
| `Engine.swift` | The cue list, what is on air, GO, Pause, Stop, All Stop, the clock |
| `ControlView.swift` | The control window |
| `InspectorView.swift` | Every setting for the cue standing by |
| `Fader.swift` | Every fade, from one steady clock |
| `Pads.swift` | The sound effect board and its sound paths |
| `PadBoardView.swift` | The pad board and the pad Inspector |
| `OutputWindow.swift` | The output screen |
| `Cue.swift` | What a cue is, and saving the show |
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
