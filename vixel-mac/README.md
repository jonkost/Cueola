# Vixel for Mac

The projection mapping app, built for the Mac. It sends a picture to a
projector and fits it onto real shapes on the wall: each shape is a
surface, and you drag its four corners onto the real corners. The plan
lives in `docs/vixel/` (BRIEF.md for everything, STEP_1.md for this first
build).

## Build it

In Terminal, from this folder:

```
./build-app.sh
```

The app lands in `build/Vixel.app`. Double-click it to open it, or drag it
to Applications. It needs macOS 14 (Sonoma) or newer.

The script uses Xcode when its license has been agreed to. Xcode asks
again after every update (`sudo xcodebuild -license accept` in Terminal);
until then the script uses the smaller command line tools, which build
Vixel just as well.

## Put it on the other Mac

After building, make a disk image to carry across:

```
./package-app.sh
```

The image lands in `build/Vixel.dmg`. AirDrop it or copy it on a stick,
open it on the other Mac, and drag Vixel into Applications. The first time
it opens, the Mac may say it cannot check the app for malware: open System
Settings, Privacy & Security, scroll down, click "Open Anyway" next to
Vixel, and open it again.

## Set up the projector

1. Plug the projector into the Mac. In System Settings, Displays, make
   sure it is a separate screen, not a mirror of the Mac's own screen.
   (A mirror counts as one screen, so Vixel can only open a window.)
2. Turn off the projector's own keystone and its auto picture modes (AI
   enhancement, dynamic contrast). Vixel does the warping, and the
   projector should show exactly what Vixel sends.
3. Open Vixel. The output fills the projector by itself. To pick another
   screen, use **Screen** at the top of the Inspector.

## Use it

- **Add Surface** (the + in the toolbar, or Shift-Command-N) puts a new
  surface in the middle of the output, showing the grid. Edit turns on.
- **Edit** (toolbar, or Command-E): while it is on, the output shows every
  surface's outline, corners and name, so you can watch the wall as you
  drag. Turn it off for the show and the wall is clean.
- Drag a corner in the picture in the middle of the window. Click a
  corner, or pick one under **Corners** in the Inspector, and the arrow
  keys move it 1 pixel at a time, or 10 with Shift. Escape lets go of it.
- **Shows** in the Inspector picks what a surface shows: Grid, Crosshair,
  Color Bars, Solid Color or Video. A video loops, with no sound for now.
  Drag a video file onto a surface in the picture, or onto its name in the
  list, or click **Choose Video**.
- **Grid on All** (toolbar, or Command-G) puts the grid on every surface
  at once, for lining up. Turn it off and each one goes back to its own
  picture.
- Rename a surface in the Inspector. Delete it with the Delete key, the
  right-click menu or **Delete Surface**; Vixel asks first.
- The ⓘ beside a word says what it means and why it matters in a show.
  **Learn Mode** in the View menu (Shift-Command-L) shows or hides them.
- **Show Output** in the Window menu (Command-0) opens the output again if
  its window was closed.

With only one screen, the output opens as a normal window, so you can
work at your desk. It draws at the screen's real pixel size (the classroom
projector is 1920 × 1200), and everywhere outside a surface is black.

Vixel saves by itself after every change, and opens with every surface
where you left it. The setup is a plain text file you can read:
`~/Library/Application Support/Vixel/setup.json`.

| Key | What it does |
|---|---|
| Arrow keys | Move the picked corner 1 pixel (Edit must be on) |
| Shift and an arrow | Move it 10 pixels |
| Escape | Let go of the picked corner |
| Shift-Command-N | Add Surface |
| Command-E | Edit on or off |
| Command-G | Grid on All |
| Shift-Command-L | Learn Mode |

## Check it

```
./test.sh
```

runs the checks in `Tests/VixelTests` (it is `swift test` with the right
settings for this Mac): the warp lands each corner exactly where it was
dragged, the middle of the picture lands where the diagonals cross, and a
saved setup reads back the same.

Test mode opens the app in the background, adds a surface, drags its
corners, presses the arrow keys, shows the grid, plays a video, saves
pictures of the control window and the output into a folder, writes what
happened to `test-log.txt`, and quits. It keeps its own setup in that
folder and its own settings, so it never touches yours:

```
mkdir -p /tmp/vixel-test
VIXEL_SNAPSHOT=/tmp/vixel-test build/Vixel.app/Contents/MacOS/Vixel
```

The log ends with ALL PASS when every check passed. Its window pictures
cannot draw Apple's glass (the sidebar and the Inspector come out blank or
odd); the `-output-pixels` pictures are the real output, pixel for pixel.

Add `VIXEL_HOLD=6` to bring the real app to the front instead, stepping
through four states six seconds apart (empty, two surfaces with a corner
picked, the video surface picked, the show with Edit off), so the real
windows can be photographed with `screencapture -l`.

## What is inside

| File | What it holds |
|---|---|
| `VixelApp.swift` | Starts the app, the menus, the arrow keys |
| `Stage.swift` | What is on stage: the setup, what is picked, Edit, Grid on All, saving |
| `ControlView.swift` | The control window: the surface list, the preview, the toolbar |
| `InspectorView.swift` | The Inspector: the output, the picked surface and its corners |
| `EditMarks.swift` | Outlines, names and corner handles over the picture; dragging corners |
| `InfoButton.swift` | The ⓘ and what it opens |
| `OutputWindow.swift` | The output: which screen, full screen or a window, hiding the pointer |
| `MapView.swift` | The picture views, drawn by the graphics card every frame |
| `Renderer.swift` | Drawing the surfaces with Metal |
| `Shaders.swift` | The graphics card's side: the warp and the test patterns |
| `Video.swift` | Video files playing on a loop into the picture |
| `Buttons.swift` | The push buttons, the same as Outrangutan's |
| `TestSnapshot.swift` | Test mode |

The rules sit in their own piece, `VixelCore`, with no screen in it, so
`./test.sh` can check each one:

| File | What it holds |
|---|---|
| `Geometry.swift` | The true perspective warp and the shape math (inside, folded, grid cells) |
| `Setup.swift` | Corners, surfaces and the setup, and the changes made to them |
| `SetupFile.swift` | Reading and writing the setup file |
| `Terms.swift` | The words behind every ⓘ |

### How it is built for the later steps

- A corner has its own id, and a surface lists the ids of its corners. Two
  surfaces that meet (step 2) will just list the same corner.
- A surface keeps two shapes: where it lands on the wall (`output`) and
  which part of the picture it shows (`input`). For now the input is the
  whole picture; groups (step 3) change only the input.
- Everything in the picture is drawn with Metal, one surface at a time, so
  masks, mesh warp and shaders slot in later. The editing marks on top are
  drawn by SwiftUI and are never part of the picture.
- The setup file has a version number, so later steps can add to it.

The app icon is a placeholder until Jon draws the real one.
