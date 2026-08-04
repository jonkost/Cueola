# KeyWi Bird (Cueola control surface for any Stream Deck)

Any Stream Deck, from the 6 key Mini up to the 36 key + XL, drives the whole
rig: playback and SFX (Outrangutan), the rundown, the Flowmingo prompter, the
Micochondria mics, and OBS Studio. It is reached from the front page under
**KeyWi Bird** and requires a normal user sign in.

## Quick start (your first show)

1. Open Cueola in **Chrome or Edge** and sign in. The KeyWi Bird card only
   opens for a signed in user; without one it asks you to sign in first.
2. If the Elgato Stream Deck app is installed, **quit it**. It holds the USB
   device and blocks the browser.
3. Click the **KeyWi Bird** card. The first open runs a five step setup
   wizard: a welcome, **Connect your deck**, **Micochondria** (optional),
   **OBS Studio** (optional), and **Make it yours** (pick a theme). The
   optional steps skip cleanly; only the deck step matters.
4. On the deck step click **Connect deck**, pick your deck from the browser's
   device list, and allow it once. The deck plays a quick rainbow light show
   as a pixel test, then settles into a layout built for its size.
5. No deck yet? Click **See it on screen** (in the wizard, **No deck? Preview
   on screen**). Preview mode gives you the full virtual deck with nothing
   plugged in, so you can learn it, lay it out, and pick a theme any time.
6. Press keys and turn dials. Every key does what its label says, and the on
   screen deck mirrors the hardware exactly. Click any key on screen to read
   a plain description of what it does, or to change it.

The wizard never volunteers itself twice. Reopen it any time from **Setup
wizard** in the toolbar.

## How it works

The deck talks to the browser directly over **WebHID**. There is no Elgato
software, no plugin to install, and no separate daemon for the deck itself. The
operator signs in, clicks **Connect deck**, grants the one time HID permission,
and KeyWi Bird self configures from the device.

Everything runs in the operator's own Cueola tab (Phase 1, same machine). A key
press runs the same code the keyboard shortcut runs, so it inherits every guard
the app already has: Live single authority, session checks, the cross device
writes that reach the projector and the talent prompter. Dials send relative
ticks into continuous controls. Micochondria and OBS both speak local loopback
WebSockets directly (talkbackd on `17844`, obs-websocket on `4455`).

Requirements: **Chrome or Edge** (WebHID is Chromium only), and the **Elgato
Stream Deck app must be quit** because it claims the USB device exclusively.

## Sign in first (the gate)

The front page card says it plainly: sign in, then connect. The gate is fail
closed: once Firebase is up, KeyWi Bird does not open without a signed in
identity, even if the identity module is slow to load. An unsigned click gets
the sign in screen and the toast "Sign in to open KeyWi Bird." Local only
development with no Firebase at all still opens, so the module can be worked
on offline.

## Any Stream Deck, organized by app

KeyWi Bird works with any Stream Deck: Mini (6), Stream Deck + (8), classic/MK.2 (15),
XL (32), and the + XL (36 keys, 6 dials, touch strip). Each size gets its own
curated default layout, **organized by app like channel strips on a console**:
each app owns a contiguous band of columns. On the + XL: columns 1-3 are
Outrangutan (GO, PAUSE, STOP, FADE, PANIC, PAD 1-4, CUE 1-3), columns 4-5 are
Cueola (NEXT, PREV, GO LIVE, the CLOCK widget, HYPE), columns 6-7 are Flowmingo
(SCROLL, CUE ROW, TOP, MIRROR, BRAKE, BOOST, EDIT, SCRUB), column 8 is
Micochondria (TKB, VofU, ALL TALK OFF), column 9 is OBS (STREAM, REC, SCN 1)
plus PAGE. The action catalog in the key editor groups the same way, so
finding an action means thinking of the app, not a category.

Redundancy rule: a deck with dials gets **no keys for what its dials already
do**: text size, prompter speed, and the separate clock verbs are dial work on
the + XL, so those keys are gone from its default (the dial-less XL keeps its
SPD keys). The freed keys went to the app bands; a few deliberate blanks keep
the bands readable. Everything trimmed is still in the catalog to bind by hand.

Default dials, each card stating what turning and pressing does: PLBK vol
(press: mute), Prompter speed (press: play/pause), Text size (press: reset),
Prompter scrub (press: cue to live row), Rundown row (press: take that row),
Show clock (a live clock face; press: start/pause). Three more live in the
catalog to assign by hand: the **OBS program** dial (a live program monitor on
the strip; turn rides the OBS stream audio volume, pick which input in the OBS
row, press starts or stops the stream), the **Micochondria** split strip (see
below), and **Deck light** (turn: the physical backlight, press: back to 80%).

The touch strip is a glanceable dashboard: one zone per dial with an accent bar,
the live value in tabular digits, a progress bar, and a running dot. Tap a zone
to fire that dial's press action; flick along it for a big turn.

Toggles (pause, scroll, mirror, stream, rec, mutes) wear an ON/OFF badge on
screen and light their ring on the deck while active. The show clock has
explicit Start, Pause, and Resume keys plus a one-key toggle; a verb that
matches the current state is a quiet no-op, so a nervous double-press never
double-fires.

## Look and feel (streamer deck)

Every key is an illustrated keycap, not flat text: a gradient face, a crisp
icon, a toggle pip when it is on, and live mini-graphics. Per the app's liquid
glass doctrine the art is crisp edges and layered translucency, no glows and
no shadows (the Neon theme's glowing edges are the one deliberate exception).

Key icons come from the repo's **SF Symbol library**
(`design-system/apple/symbols/runtime/`): play/pause/stop, a fader for FADE, an
exclamation triangle for PANIC, a hare and a tortoise for speed up/down,
waveforms for SFX pads, scene frames for OBS scenes, microphones for talkback,
and so on. Symbols are fetched once and drawn as native canvas paths (crisp at
any size, tinted to the key ink), with a built-in vector fallback so a key is
never blank while a symbol loads. To use a symbol KeyWi Bird does not map yet, add
the SVG under the runtime folder and point the action at it in `symbolFor()`.

Pick a **theme** to reskin the whole deck. Seven ship: Broadcast (clean,
category colors), Neon (glowing edges on black), Synthwave (sunset grids),
Terminal (green-on-black with scanlines), Aurora, **RGB Flow** (an animated
hue wave rolling diagonally across every key, the mood-lighting option), and
**Liquid Glass** (smoked glass keycaps that match the app chrome). Themes are
one-click chips in the toolbar and in the wizard's last step, and apply to the
physical keys and the on-screen preview alike.

The **on-screen grid is exactly what the hardware shows**: the same canvas art
drives both, so you can lay out and theme the deck and see the real result. The
on-screen deck sits in a hardware-style dark shell, and on strip decks the
**touch strip renders live on screen too**, showing the same pixels the panel shows.
**Preview mode** (See it on screen) gives you a full virtual + XL with no
hardware plugged in, so you can build layouts and try themes any time, then hit
**Connect real deck** to drive the real one.

There is a **HYPE** key too (under Fun, and on the + XL default layout): a
rainbow ripple parties across the whole deck and settles back. Because a big
panel of buttons should be fun.

## Reactive keys

Keys animate with the show, on the hardware and on screen alike:

- **Duration wipe.** A playing SFX pad or playout key fills with a translucent
  wipe that tracks the clip, with a sharp leading edge, so time remaining is
  readable at a glance.
- **Pre-roll bar.** A cue in pre-wait shows a thin bar along the bottom edge,
  deliberately different from the playing wipe, so an armed cue reads
  differently from a rolling one.
- **Loop marker.** A looping pad carries a small static corner square instead
  of a wipe: a loop has no end to count down to.
- **Press flash.** Every key press flashes a brief white overlay (150 ms), so
  the deck confirms the touch.
- **Pulse lamps.** STREAM, REC, GO LIVE and the TALK keys breathe while
  active; the clock keys show a running ON AIR time.

All of it can be tuned or turned off per key in the key editor (below).

## Make any key yours (per-key appearance)

Click any key on screen (or use Live learn and press it on the deck) to open
the key editor. Beyond picking the action, every key takes appearance
overrides, stored with the layout:

- **Label**: replace the printed label, or check **Hide label** for an
  icon-only key.
- **Accent color**: an Auto chip, twelve swatches, or any **Custom color
  (hex)**.
- **Key art**: an emoji palette, a typed emoji, or the **symbol picker**: 85
  SF Symbols drawn live on little canvases, filtered as you type in **Search
  symbols**. A picked symbol wins over emoji; clearing both restores the
  action's own icon.
- **Custom image**: upload any PNG, JPEG, or WebP and it fills the whole key
  face, square-cropped and stored at 256 px (at least 2x the largest key's
  hardware resolution, so it stays sharp on the deck). **Animated GIFs work
  too** (up to 300 KB): the frames play on the on-screen key AND stream to the
  hardware through the same paint queue. **Show trigger overlays on the
  image** keeps the label, progress, pips, and pulse lamps riding on top;
  uncheck it for pure art. The label sits on a soft bottom scrim over an
  image so it stays readable.
- **GIPHY search**: search GIPHY without leaving the key editor and tap a
  result to put it on the key. Needs your own free API key (developers.giphy.com,
  Create an App, choose API), pasted once into the editor's GIPHY row; it is
  stored on that device only, like the OBS password. Results are capped at
  PG-13, and a pick is downloaded and stored like an upload (300 KB cap), so
  the layout stays portable and works offline afterward. Remove key forgets it.
- **Art packs**: a bucket of one-click key art in packs. **Podcast** ships
  in-repo (original badges tuned for an 18-35 crew: CLIP THAT, HOT TAKE,
  MIC DROP, NO CAP, REAL, BANGER, COOKED, LOCKED IN, AURA, RENT FREE, W, L,
  GOAT, LETS GO) and **Fun** is the same vendored CC-BY Twemoji art the
  profile avatars use. Add your own meme/GIF bank by dropping files you have
  rights to into `assets/keywi-art/<pack-name>/` and running
  `node scripts/build-keywi-art-manifest.mjs` then
  `node scripts/bump-cache.mjs`; the folder becomes a pack in the editor. The
  repo deliberately ships no third-party meme images (licensing).
- **Progress style**: how a playing key shows time. **Wipe** (the default),
  **Ring** (a hairline track circle with a sharp accent arc from 12 o'clock),
  or **Bottom bar**.
- **Press flash** and **Reactive animation** checkboxes, per key.
- **Reset appearance** clears every override (image included) and returns the
  key to the theme's default look.

**Drag one key onto another to swap them**, straight on the on-screen grid.
After any edit a floating **Done** capsule appears; it asks where the layout
should live: **Keep on this device** (localStorage, as always), **Download
.keywi** (a standalone file, see below), or **Save to my profile** (signed-in
users; the layout follows the login to any machine once the keywiLayouts
rules round is deployed).

Old saved profiles need no migration: absent overrides mean the defaults every
existing layout already had.

## Brightness and auto-dim

With hardware connected the toolbar grows a **Brightness** slider with a live
percentage. The optional **Deck light** dial does the same from the deck
itself (press resets to 80%).

After **5 idle minutes** the physical deck dims itself to **20%**. Any key,
dial, or touch input restores full brightness instantly and re-arms the
timer. The stored brightness preference is untouched; the dim is a screensaver,
not a setting.

## Micochondria (the mic panel)

Micochondria is the talkback pair: hold **TKB** to talk to the crew (outs 1-2),
hold **VofU** (the Voice of the Universe) to speak to the room (outs 3-4).
Beyond the deck keys, KeyWi Bird has a small **Micochondria panel**: a
green/off dot that plainly says **Connected** or **Not running**, and one strip
per mic with a hold-to-talk button, an ON AIR lamp, a live meter, and a volume
fader. The meter shows the mic input while idle (proof the mic is alive before
the show) and the bus output while keyed. Meters and faders appear only when
the running talkbackd speaks the levels protocol (`talkback/README.md`); an
older daemon still gets the honest connected/off panel. An **All talk off**
button in the toolbar and the panel cuts both mics instantly.

**Pop out** (in the panel header) opens Micochondria in its own little window:
the connected dot, both mics with lamp and meter, hold-to-talk, and the all-off
panic, sized to sit in a corner of a second display. It closes with the tab,
and a hold started there releases the moment the window loses focus, same as
everywhere else.

There is also a **Micochondria strip option** for the dials: assign a dial to
Micochondria and its touch-strip zone becomes one block split in half, TKB on
the left, VofU on the right, each half lit green while that mic is live (with
small meters when the daemon speaks levels). Tapping the zone cuts both mics.

The talkbackd daemon only accepts browser connections from cueola.live or
localhost origins, so a random webpage cannot key the mic; details in
`talkback/README.md`.

## Deck Studio (the setup screen)

Everything is customizable, live:

- **Saved profiles.** Keep several named layouts (Rehearsal, Live, OBS heavy).
  New / Duplicate / Rename / Delete / Set default, and switch instantly. Mappings
  are stored per device in the browser.
- **Per-key look and feel.** The full appearance kit above, per key: label,
  color, art, progress style, flash, reactive. Every binding shows a
  plain-language description of what it does, and TOGGLE/HOLD chips where they
  apply. SFX pads get a waveform icon automatically.
- **Bind by name.** The key editor's "This show" and "This OBS" sections list the
  loaded show's cues and pads and OBS's scenes and audio inputs, so a key can fire
  a specific cue or switch to a specific scene by name.
- **Live learn.** Click **Live learn**, then press a key or turn a dial on the
  deck and its editor opens. Tactile mapping, no hunting on screen.
- **Import / export.** Export a layout as a **`.keywi` file** (JSON inside,
  versioned, custom key images included) to back it up or hand it to another
  operator machine, and import it back. Old `.json` exports import forever.
- **Layouts as pages.** Bind PAGE keys (next layout, or jump to one by name) so
  the deck itself flips between rehearsal, live, and OBS-heavy pages.
- **Multiple decks, one computer.** Connect a second Stream Deck with **Add
  deck** and a deck-tab row appears; each deck runs its own layouts live, the
  tabs pick which one the editor configures, and one brightness slider drives
  them all. PAGE keys page the deck they sit on. On separate computers each
  operator's browser keeps its own decks and layouts, and a signed-in profile
  (or a `.keywi` file) carries a layout between machines.
- **Setup wizard.** The five step first-run tour lives behind **Setup wizard**
  in the toolbar, with live status dots for the deck, Micochondria, and OBS.
  The screen follows the active Cueola theme.

## OBS control

OBS Studio 28+ ships obs-websocket. In OBS: Tools, WebSocket Server Settings,
enable the server (default port `4455`), and copy the password if one is set.
In KeyWi Bird, enter `ws://localhost:4455` and the password in the OBS row (or
the wizard's OBS step) and click **Connect OBS**. KeyWi Bird reconnects
automatically next time.

Available OBS actions (all remappable): STREAM (start/stop), REC (start/stop),
REC pause, V-CAM (virtual camera), CLIP (save replay buffer), OBS TAKE (studio
transition), scene by slot (SCN 1-6, the first scenes in the list), scene by name,
and mute by name. Keys light up live: the STREAM and REC keys pulse while
active, the current scene's key lights its ring, and a **LIVE** / **REC**
badge shows in the header. The **OBS program** dial adds a live program
monitor on the touch strip, stream audio volume on the turn, and stream
start/stop on the press.

## Hardware bring-up (owner errand, with a real deck plugged in)

Geometry is pinned per model from Elgato's published HID documentation, so
there is no calibration UI: connect and it should simply be right. What still
needs a pass on real hardware:

1. **Connect and learn.** Quit the Elgato app, plug in, sign in, open KeyWi
   Bird, **Connect deck**, pick the device. Confirm the light show, the
   default layout, and that **Live learn** opens the right editor for every
   key, dial, and touch zone.
2. **Test pattern.** Click **Test pattern**: each key shows its number, right
   way up, 1 to N left to right, top to bottom. If anything reads wrong,
   `CueolaStreamDeck.diagnose()` in the console dumps everything the driver
   knows (model profile, rotation, the report sizes the hardware advertises)
   for a fix in the model table.
3. **Wipe legibility.** Play a clip and confirm the duration wipe, pre-roll
   bar, and ring style all read at arm's length on 72 px keys (classic and
   MK.2, the smallest key pixels).
4. **Brightness.** Confirm the slider and the Deck light dial move the
   physical backlight, and that auto-dim drops to 20% after 5 idle minutes
   and snaps back on the first touch.
5. **Strip.** Confirm the touch strip shows the dial readouts. The strip
   image path follows the shipping Stream Deck + protocol; if the strip stays
   black on a + XL it is the one part most likely to need a firmware specific
   tweak. Keys and dials keep working regardless.
6. **UR44 meters.** With the interface attached, start talkbackd and confirm
   the Micochondria meters move with the real mic and buses
   (`talkback/README.md`, Milestone 0).

For Micochondria, start the daemon first (see `talkback/README.md`):

```sh
cd talkback/daemon && swift build -c release && .build/release/talkbackd
```

## Architecture (for maintainers)

- `cueola-streamdeck-device.js`: pure WebHID protocol (no DOM, no app). Input
  parsing (keys/dials/touch), key and strip image packetization, feature reports,
  per model profiles, Get Unit Information parser. Node testable:
  `node scripts/streamdeck-device.test.cjs` (46 assertions).
- `cueola-streamdeck.js`: the browser controller and Deck Studio UI. Device
  lifecycle, action catalog, profiles/mapping, per-key appearance overrides on
  the slot, the `fireSlot()` dispatch seam, the setup wizard, the Micochondria
  panel and pop-out, the paint loop (reactive specs, themes, auto-dim), and
  OBS integration.
- `cueola-obs.js`: an obs-websocket v5 client (Hello/Identify with SHA-256 auth
  via crypto.subtle, request/response, event mirroring). Attaches window.CueolaOBS.
- `outrangutan/stream-deck-label.js`: key image renderer, extended with
  `registerModel()` so a probed deck profile can be injected at runtime.
- `window.cueolaSurfaceBridge` (in `cueola-app.js`): the single seam into the
  running show (KEYMAP action table, prompter/playout/clock dispatchers, and a
  flat paint snapshot).

Same machine now; the `fireSlot()` dispatch has a `mode` of `local` with a
`dispatchCloud()` seam for a future Phase 2 (deck on one machine driving a show on
another via the Firestore controlBus).

Loopback sockets are allowed in `firebase.json` via `connect-src`:
`ws://127.0.0.1:17844` and `ws://localhost:17844` (talkback),
`ws://127.0.0.1:4455` and `ws://localhost:4455` (OBS). WebHID needs no CSP change.
Chrome permits a loopback `ws://` from an HTTPS page.
