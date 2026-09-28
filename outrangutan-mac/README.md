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
- Click a cue to stand it by. Drag cues to reorder them.
- **Open Output** puts the picture on the second screen. With one screen it
  opens as a normal window.

| Key | What it does |
|---|---|
| Space | GO: fire the standby cue, stand by the next one |
| P | Pause, press again to carry on |
| S | Stop what fired last (picture or sound) |
| Esc | All Stop: everything off, output to black |

Sounds play on their own lane, so a sound effect never knocks the picture
off air. A still holds until the next picture cue. A video that reaches its
end cuts to black.

The show saves itself after every change, to
`~/Library/Application Support/Outrangutan/show.json`.

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

It plays whatever is in the saved show, so load a few cues first.

## What is inside

| File | What it holds |
|---|---|
| `OutrangutanApp.swift` | Starts the app, the show keys, keeps macOS from slowing it down |
| `Engine.swift` | The cue list, what is on air, GO, Pause, Stop, All Stop, the clock |
| `ControlView.swift` | The control window |
| `OutputWindow.swift` | The output screen |
| `Cue.swift` | What a cue is, and saving the show |
| `Timecode.swift` | 29.97 drop-frame clock text, the same as the web clock |
| `TestSnapshot.swift` | Test mode |
