# Vixel — Concept Brief

*Vixen + pixel. Projection mapping and multi-display output for the Cueola family.* 🦊

> Copied from Jon's Vixel concept brief on October 24, 2026. Claude Code builds from this copy. The first build is in [STEP_1.md](STEP_1.md).

## Overview

Vixel is the suite's projection mapping and pixel mapping app: a simple, Apple-style tool for projectors, LED walls and multi-display output. It handles the room itself: projector surfaces, walls, objects and screens. It also works with the rest of the suite, so playback, cueing and control can all reach it.

It started from an hour of experimenting with an old projector and Lazy Lighting. The goal is a tool that's easier, fits Jon's workflow, and costs less than a $60/year subscription.

**The family**

- **Cueola**: cue + koala. Rundowns and show calling
- **Planda Bear**: plan + panda bear. Planning and paperwork
- **KeyWi Bird**: Stream Deck controller
- **Outrangutan**: out + orangutan. Playback
- **Flowmingo**: flow + flamingo. Prompter
- **Vixel**: vixen + pixel. Projection mapping and multi-display. This is the suite's first canine.

*Parked for a future tool: Chromeleon (chroma + chameleon).*

## Platforms

- **Native Mac app**: built in Claude Code, the same way as Outrangutan. It can drive several displays at once.
- **iPad app**: aimed at iPad Pro. It renders a dedicated output to an external display or projector over USB-C, separate from the control screen.
- **Lightweight web app**: for quick mapping and preview. WebGL handles warping and masking, and Chromium's Window Management API can place output windows on extra screens on desktop. Safari on iPad only mirrors, so the native iPad app is the real iPad experience.
- **iPhone**: included in version 1 for small, simple setups, sharing the iPad codebase.

## The core problem to solve

In Lazy Lighting, an odd-shaped wall (a rectangle with a sloped rhombus below it) needed two shapes. Those shapes behaved like two separate screens:

1. Content didn't flow from one shape into the other
2. The corners where the shapes met never lined up perfectly, leaving sloppy seams

Vixel fixes both with the next three features.

### Shared canvas (groups)

Shapes can be grouped onto one shared content canvas. Each shape is a window that cuts out its own slice of the same source, so a video flows across the seam as if it were one surface. In pro tools this is called input and output mapping.

### Multi-point shapes

A shape isn't limited to four corners. The rectangle and the slope can be one six-point shape, with no seam at all.

### Shared corners

When two shapes meet, they use the exact same point. Dragging it moves both edges together, so a gap can never open.

### Snapping

- Corners snap to other corners and to edges
- Toggle on or off in preferences
- Hold a modifier key to bypass snapping for a moment

## Mapping features

- **Effortless surface placement**: drag corners directly on the projected image, with a magnifier for fine control
- **Curved edges and mesh warp**: for columns, curved walls and surfaces that aren't flat
- **Masks**: black out switches, windows, plants and anything else you don't want lit, with feathered edges
- **Test patterns**: grid, crosshair and color bars on every surface while aligning
- **Global nudge**: move, scale or corner-pin the whole mapping at once when the projector gets bumped
- **Per-surface controls**: brightness, opacity and color
- **Save and recall**: store a full setup per room or venue

## Content workflow (After Effects, Illustrator, Photoshop)

The content side is built for a motion designer.

- **After Effects template export**: a comp at the projector's exact resolution, with each surface as a guide layer or mask. Ideally a script (.jsx) builds the whole comp automatically. You design inside the shapes, render, and drop the result back into Vixel.
- **Illustrator export**: the surface layout as an SVG
- **Photoshop export**: the layout as a layered PSD or PNG overlay
- **Projector-view photo**: take a photo from the projector's position and use it as a backdrop, so you're designing on the real wall
- **Alpha video**: play ProRes 4444 and HEVC with transparency, so renders can layer over a base color
- **Built-in generators**: quick looks that know each shape's edges, with no rendering needed. Examples:
  - Outline trace
  - Color wash and sweeps
  - Gradient wipes
  - Chases across grouped surfaces

### Two content paths

- **Built-in visuals and simple clips** play directly in Vixel
- **Other video content** comes in from Outrangutan, which feeds a Vixel surface or group

## Multi-display output

This works like Keynote's presenter output, but for more screens.

- Drive several outputs from the Mac
- Support hardware splitters (such as Datapath Fx4 or Matrox TripleHead2Go). Vixel renders one wide canvas and the splitter divides it into up to four outputs.
- Each output can hold mapped surfaces or a straight full-frame feed

## LED walls and pixel mapping

Vixel drives LED walls of any size and shape, as well as projectors. Each wall, banner or strip gets its own slice of the content.

- **Wall builder**: define a wall by its panel size and pixel pitch (for example, 500 mm panels at 2.6 mm pitch). You then build the shape from tiles, including irregular layouts.
- **Banners and ribbons**: long, thin walls can each get their own feed, or share one canvas so content runs across all of them
- **Rotation and orientation**: set rotation per wall for banners hung sideways or upside down
- **Pixel-accurate canvas**: content maps 1:1 to LED pixels with no scaling, so graphics stay sharp
- **LED processor output**: send the pixel map over HDMI or DisplayPort to processors such as Novastar or Brompton
- **Pixel map template export**: an After Effects comp and an Illustrator/PSD layout with every wall placed at its true pixel size
- **Panel test patterns**: per-panel numbering, grids and color checks to confirm each tile's position and orientation
- **LED strips and pixel fixtures**: drive them directly over Art-Net or sACN, with universe and channel patching
- **Mixed rigs**: projectors and LED walls can sit in the same show, fed from the same scenes

## Scenes

- Save a look (content, surfaces, brightness) as a scene
- Step through scenes manually, with simple fades between them
- Scenes are the unit the rest of the suite triggers

## Suite handshakes

The aim is as much connection between the existing tools and Vixel as possible.

- **Cueola**: adds a visual cue type next to lighting cues, so calling a cue fires a Vixel scene
- **KeyWi Bird**: Vixel connects to the classroom Stream Deck and syncs online through KeyWi Bird, so button layouts stay the same on every device. Buttons fire scenes, step to the next or previous scene, and handle blackout, tap tempo, test patterns and show lock. Button faces update live with each scene's name and thumbnail.
- **Outrangutan**: sends video into a Vixel surface or group. Vixel acts as one of Outrangutan's outputs.
- **Shared language**: use the same glossary words across the suite (cue, scene, take and so on)

## Classroom rig: ETC ColorSource

The classroom ETC ColorSource console has to control Vixel in version 1. This rig is the professional showcase: students run lights and visuals from the same desk.

**Classroom console:** a standard ColorSource 20, the base model, with one DMX out and no network port. Vixel needs a DMX interface to join the chain.

### Hardware

- **ENTTEC DMX USB Pro** (the pick for this rig): DMX input straight into the Mac over USB. No network or IP setup is needed, and the classroom rig is Mac only.
- **DMXking eDMX1 Pro** (alternative): DMX to sACN or Art-Net over Ethernet, if the rig ever needs an iPad or a network
- **Future upgrade**: a ColorSource AV model has Ethernet built in (sACN, Art-Net and OSC), so it would need no interface

### Wiring

1. Console DMX out to the lighting fixtures, daisy-chained as usual
2. The last fixture's DMX out goes to the interface's DMX in, so Vixel sits at the end of the chain
3. Confirm termination: the interface terminates the line, or add a DMX terminator
4. Connect the interface to the Mac or iPad by Ethernet or USB

### Patching

Vixel is patched on the ColorSource as a custom fixture with a small, simple channel footprint. This is a starting point:

| Channel | Controls |
| --- | --- |
| 1 | Master intensity |
| 2 | Scene select |
| 3 | Red tint |
| 4 | Green tint |
| 5 | Blue tint |
| 6 | Effect speed |
| 7 | Blackout |

- Set Vixel's start address to free channels after the lights
- Map one fader to Vixel's master and others to favorite scenes
- Vixel shows incoming DMX values live, so students can see the desk talking to it

### Setup guide: adding the DMX interface

This takes the classroom from console-only to console plus Vixel. It uses one ENTTEC DMX USB Pro plugged into the Mac. Check each step against the ENTTEC and ETC manuals for your exact model and software version.

**You need**

- ENTTEC DMX USB Pro
- A 5-pin DMX cable long enough to reach from the last fixture to the interface
- A USB cable, plus a USB-C adapter if the Mac only has USB-C ports
- A DMX terminator for the end of the line

**1. Set up the interface (once)**

1. Plug the ENTTEC DMX USB Pro into the Mac
2. Confirm the Mac sees it. Vixel lists it in DMX settings when it's connected.
3. If it doesn't appear, install ENTTEC's driver for macOS

**2. Wire it into the chain**

1. Leave the console's DMX out going to the first fixture, as now
2. Remove the terminator from the last fixture, if there is one
3. Run a DMX cable from the last fixture's DMX out to the interface's DMX in
4. Terminate the line at the interface

**3. Patch Vixel on the ColorSource**

1. Choose a start address in the free range above the lights (they currently use roughly 1 to 80 of 512)
2. Open the Patch screen and add a new device at that address
3. Patch it as a custom fixture with Vixel's 7 channels if your software supports custom fixtures. Otherwise, patch 7 generic dimmers in a row starting at that address.
4. Label it "Vixel" so students can find it
5. Assign it to a free fader

**4. Connect Vixel**

1. In Vixel, open DMX settings and choose **ENTTEC DMX USB Pro** as the input
2. Enter the same start address used on the console
3. Move the Vixel fader on the ColorSource and check the live DMX readout in Vixel

**If nothing moves**

- Check that the ENTTEC shows up in Vixel's DMX settings
- Try a different USB cable or port
- Confirm the start address matches on the console and in Vixel
- Make sure the chain is terminated only once, at the very end

## Design principles

- Apple-style: clean, simple, nothing difficult
- Few buttons on screen, with detail available on demand
- Touch-first on iPad, with no hover-only behavior
- One obvious action per screen
- Fast from zero to light on the wall: plug in, drag four corners, play

## Education: info icons

Vixel teaches the terms as students use them. It is part of the education side of the Cueola suite.

- Every technical term gets an info icon beside it. Tap to open it on iPad, tap outside to close, with no hover-only behavior.
- Each explainer gives a one-sentence plain definition, then why it matters in a real show
- Terms come from the shared suite glossary, so the same word means the same thing in every app
- A **Learn mode** toggle shows or hides the icons, so pros get a clean screen
- A feature isn't finished until its info text is written

**Starter terms:** projection mapping, surface, mask, keystone, mesh warp, edge blending, throw ratio, lumens, pixel pitch, LED processor, DMX, universe, address, termination, sACN, Art-Net, OSC, MIDI, PJLink, SMPTE timecode, LTC, NDI, Syphon, ISF shader, alpha channel, ProRes 4444, structured light, LiDAR

## Advanced features

All of these ship in version 1.

### Calibration and scanning

- **Camera auto-calibration**: the projector flashes structured-light stripe patterns while the iPad camera or a Mac webcam watches. Vixel then finds the surfaces and corners automatically.
- **LiDAR room scan**: the iPad Pro's LiDAR scanner captures the room in 3D, so surfaces come from the real geometry.
- **3D object mapping**: load a 3D model (OBJ or USDZ) and match a few points to the real object. Content then wraps around it correctly.
- **Virtual preview**: plan a show on a photo or 3D model of the venue before you arrive.

### Content and effects

- **ISF shaders**: support for the Interactive Shader Format, the open format used by VJ apps like VDMX. Thousands of free generators and effects work out of the box, and writing your own is a great way to learn.
- **Live inputs**: camera feeds, plus Syphon and NDI from other apps, mapped live onto surfaces
- **Tap tempo and BPM sync**: effects pulse in time with the music
- **Audio reactivity**: visuals respond to sound from a mic or audio input

### Show control

- **OSC, MIDI and Art-Net**: standard show-control protocols, so lighting desks and other apps can fire scenes and control parameters. This is also the simplest route for the suite handshakes.
- **Show lock**: a locked mode that stops accidental edits to corners or surfaces mid-show

### Projector setup

- **Edge blending**: soft overlaps between multiple projectors
- **Per-projector color correction**: brightness, gamma and color for each output, so projectors match
- **Rear-projection flip**: mirror horizontally or vertically for rear-projection or ceiling-mounted projectors

### Pro show integration

These features are aimed at professional lighting and video crews.

- **Fixture mode**: Vixel appears on lighting desks such as grandMA and ETC Eos as a patchable fixture, over sACN or Art-Net. The lighting designer controls scenes, brightness and effects from their own faders, the way media servers like disguise and Hippotizer work.
- **Timecode sync**: chase SMPTE timecode (LTC or MIDI timecode), so visuals land on the exact frame with lights and audio
- **PJLink projector control**: power, shutter and lamp hours from inside Vixel
- **Failsafes**:
  - A big blackout button
  - Hold the last frame if a source drops
  - Recover from a crash right where it left off
- **Health readout**: frame rate, dropped frames and device temperature on screen

## Open questions

1. What is the first real project, or test wall, for Vixel?
2. How will Outrangutan connect: direct app-to-app on the same Mac, or over the network?
3. What are the naming conventions for surfaces, groups and scenes, so they match the suite glossary?
4. Which comes first: Mac, iPad or web?
5. Which generators should ship in version 1?

## Version 1 build order

Everything in this brief ships in version 1. Build it in this order:

1. Mac app: one output, four-corner surfaces, test patterns and video playback
2. Multi-point shapes, shared corners and snapping
3. Groups with a shared canvas
4. Masks, mesh warp, global nudge, show lock, and save and recall
5. Generators, ISF shaders, alpha video, tap tempo and audio reactivity
6. After Effects, SVG and PSD template export, plus virtual preview
7. Scenes, OSC, MIDI and Art-Net, the ColorSource classroom rig, Stream Deck through KeyWi Bird, plus the Cueola and Outrangutan handshakes. Info icons are written alongside every feature from step 1.
8. Multi-display, splitter support, edge blending, color correction and flip, plus LED walls, banners and pixel mapping
9. Live inputs (camera, Syphon and NDI), then fixture mode, timecode, PJLink, failsafes and the health readout
10. iPad and iPhone apps, with camera auto-calibration, LiDAR scanning and 3D object mapping
11. Web app
