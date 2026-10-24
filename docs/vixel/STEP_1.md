# Vixel step 1: light on the wall

The first working Vixel for Mac: one output, four-corner surfaces, test patterns and video. This is step 1 of the build order in [BRIEF.md](BRIEF.md). Read BRIEF.md and the repo's CLAUDE.md before you start.

## Done looks like this

On the classroom projector, in under a minute, Jon can:

1. Open Vixel and pick the projector as the output.
2. Add a surface and drag its four corners onto a shape on the wall.
3. Put a grid on it to line it up, then play a video on it.
4. Quit, reopen, and find every surface where he left it.

## Where it goes

Make a new folder, `vixel-mac/`, set up the same way as `outrangutan-mac/`:

- A Swift package for macOS 14 or newer (`Package.swift`).
- `VixelCore`: the warp math and the saved setup, with no screen in it, so `swift test` can check every rule. Same idea as `OutrangutanCore`.
- `Vixel`: the app. SwiftUI for the controls, AppKit for the output window, Metal for the picture.
- `VixelTests`.
- `build-app.sh`, `package-app.sh`, `Info.plist` (bundle id `live.cueola.vixel`) and a `.gitignore` for `.build/` and `build/`.
- `README.md` in plain words: how to build it, how to use it, and a table of what each file holds, like the Outrangutan one.
- A placeholder app icon. Jon designs the suite's icons himself.

Read `outrangutan-mac/` first and reuse what fits. `OutputWindow.swift` already puts an output edge to edge on a chosen screen, and `TestSnapshot.swift` is the test mode to copy.

Add a short Vixel section to `CLAUDE.md`: the "Apple's kit decides the design" rule covers `vixel-mac/` too, and the plan lives in `docs/vixel/`.

## What to build

### The output

- Pick the output screen from a list of screens, by name. The output fills that screen edge to edge, with no title bar, menu bar or pointer.
- With only one screen, the output opens as a normal window, so Jon can work at his desk.
- Draw at the screen's real pixel size. Never assume 1920 × 1080. The classroom projector (Sony VPL-FHZ55) is 1920 × 1200, and a home projector is likely 1920 × 1080.
- Everywhere outside a surface is black.

### Surfaces

- A surface has four corners. Add, select, rename and delete surfaces.
- Drag corners in a preview of the output inside the control window. While editing, the output shows the same corner handles, plus each surface's outline and name, so Jon can watch the wall as he drags.
- The arrow keys nudge the selected corner by 1 pixel, or by 10 with Shift.
- Warp the picture with true perspective (a homography). Two triangles are not enough: they bend the picture along the diagonal.

### What a surface shows

- Test patterns: grid, crosshair, color bars and a solid color.
- A video file, dragged on or picked. It loops, with no sound for now. Play it with AVFoundation into a Metal texture (`AVPlayerItemVideoOutput`).
- One button puts the grid on every surface at once, for lining up.

### Remember the setup

- Save automatically, and restore everything on launch.
- Use a readable file (JSON) with a version number in it, so later steps can add to it.

### Info icons from day one

- Every new term on screen gets an ⓘ: output, surface, corner, test pattern, keystone and perspective. Each one is a plain sentence, then why it matters in a real show.
- Learn mode, in the View menu, shows or hides the ⓘ icons.
- The surface ⓘ says to turn off the projector's own keystone and its auto picture modes (AI enhancement, dynamic contrast). Vixel does the warping, and the projector should show exactly what Vixel sends.

## Build it so later steps fit

- Corners are shared points with their own ids, and a surface lists its point ids. Then step 2's shared corners are just two surfaces using the same point, with nothing to rewrite.
- A surface keeps two shapes: where it lands on the wall (output) and which part of the picture it shows (input). In step 1 the input is the whole picture. Step 3's groups only change the input.
- Draw everything with Metal, so masks, mesh warp and shaders slot in later.

## Not in step 1

Multi-point shapes, shared corners, snapping, groups, masks, mesh warp, more than one output, DMX, the Stream Deck, the links to Cueola and Outrangutan, and the iPad, iPhone and web apps. They come later, in the order in BRIEF.md.

A note for when you reach the Cueola link (step 7): the rundown table must not change without Jon's OK (CLAUDE.md). Ask him where a Vixel scene lives in the rundown before adding anything.

## Words

- The window title is Vixel. Everywhere else, use plain words. Brand names are window titles only (`docs/v3-glossary.md`).
- List Vixel's new words (surface, corner, output, test pattern) in `docs/vixel/WORDS.md`, one line each. Jon approves them before they go into `docs/v3-glossary.md`.

## How to check it

The web checks in CLAUDE.md do not cover `vixel-mac/`. These do:

1. `swift test`: the warp lands each corner exactly where it was dragged, and a saved setup reads back the same.
2. Test mode, like Outrangutan's (`VIXEL_SNAPSHOT=/path/to/folder`): it opens the app, adds a surface, shows the grid, saves pictures of the control window and the output, and writes what happened.
3. Look at the pictures yourself before calling it done.
4. Jon tries it on the real projector.

## Working with Jon

- Follow CLAUDE.md: plain words, short messages, lead with the result.
- Design comes from Apple's macOS kit, as CLAUDE.md says. Do not ask Jon to pick colors or layouts.
- Commit as you go, one change per commit. Do not push until Jon says push.
- When step 1 works, send Jon a screenshot and three short lines: how to build it, how to open it on the projector, and what to try first.
