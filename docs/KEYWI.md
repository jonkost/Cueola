# KeyWi Bird (Cueola control surface for the Stream Deck + XL)

One Stream Deck + XL (36 keys, 6 dials, 6 touch zones) drives the whole rig:
playback and SFX (Outrangutan), the rundown, the Flowmingo prompter, Talkback
A/B, and OBS Studio. It is reached from the front page under **KeyWi Bird**, gated
behind a normal user sign in.

## How it works

The deck talks to the browser directly over **WebHID**. There is no Elgato
software, no plugin to install, and no separate daemon for the deck itself. The
operator signs in, clicks **Connect deck**, grants the one time HID permission,
and KeyWi Bird self configures from the device.

Everything runs in the operator's own Cueola tab (Phase 1, same machine). A key
press runs the same code the keyboard shortcut runs, so it inherits every guard
the app already has: Live single authority, session checks, the cross device
writes that reach the projector and the talent prompter. Dials send relative
ticks into continuous controls. Talkback A/B and OBS both speak local loopback
WebSockets directly (talkbackd on `17844`, obs-websocket on `4455`).

Requirements: **Chrome or Edge** (WebHID is Chromium only), and the **Elgato
Stream Deck app must be quit** because it claims the USB device exclusively.

## Any Stream Deck, sensible out of the box

KeyWi Bird works with any Stream Deck: Mini (6), Stream Deck + (8), classic/MK.2 (15),
XL (32), and the + XL (36 keys, 6 dials, touch strip). Each size gets its own
curated default layout: the Mini gets the survival kit (GO, STOP, PANIC, NEXT,
TALK A, CLOCK), the + XL gets the full spread. On connect the deck plays a quick
rainbow light show as a full pixel test, then settles into the layout.

Default + XL bands: transport and Live (GO, PAUSE, STOP, FADE, PANIC, NEXT,
PREV, GO LIVE, CUE ROW); prompter (SCROLL, TOP, sizes, speeds, FWD, REV,
MIRROR); SFX and OBS scenes (PAD 1-4 with 🔊 art, BRAKE, BOOST, SCN 1-3); comms
and clock (TALK A, TALK B, ALL TALK OFF, CLOCK GO, CLOCK ❚❚, CLOCK ▶, STREAM,
REC, PAGE →).

Default dials, each card stating what turning and pressing does: Program vol
(press: mute), Prompter speed (press: play/pause), Text size (press: reset),
Prompter scrub (press: cue to live row), Rundown row (press: take that row),
Show clock (a live clock face; press: start/pause).

The touch strip is a glanceable dashboard: one zone per dial with an accent bar,
the live value in tabular digits, a progress bar, and a running dot. Tap a zone
to fire that dial's press action; flick along it for a big turn.

Toggles (pause, scroll, mirror, stream, rec, mutes) wear an ON/OFF badge on
screen and glow on the deck while active. The show clock has explicit Start,
Pause, and Resume keys plus a one-key toggle; a verb that matches the current
state is a quiet no-op, so a nervous double-press never double-fires.

## Look and feel (streamer deck)

Every key is an illustrated keycap, not flat text: a gradient face, a crisp
icon, a soft glow, a toggle pip when it is on, and live mini-graphics. GO shows
a progress bar as a clip plays; the clock keys show a running ON AIR time;
STREAM, REC, GO LIVE and the TALK keys breathe while active.

Key icons come from the repo's **SF Symbol library**
(`design-system/apple/symbols/runtime/`): play/pause/stop, a fader for FADE, an
exclamation triangle for PANIC, a hare and a tortoise for speed up/down,
waveforms for SFX pads, scene frames for OBS scenes, microphones for talkback,
and so on. Symbols are fetched once and drawn as native canvas paths (crisp at
any size, tinted to the key ink), with a built-in vector fallback so a key is
never blank while a symbol loads. To use a symbol KeyWi Bird does not map yet, add
the SVG under the runtime folder and point the action at it in `symbolFor()`.

Pick a **theme** from the top of the setup panel to reskin the whole deck:
Broadcast (clean, category colours), Neon (glowing edges on black), Synthwave
(sunset grids), Terminal (green-on-black with scanlines), or Aurora. The theme
applies to the physical keys and the on-screen preview alike.

The **on-screen grid is exactly what the hardware shows**: the same canvas art
drives both, so you can lay out and theme the deck and see the real result. And
**Preview mode** (See it on screen) gives you a full virtual + XL with no
hardware plugged in, so you can build layouts and try themes any time, then hit
Connect to drive the real deck.

There is a **HYPE** key too (under Fun): a rainbow ripple parties across the
whole deck and settles back. Because a big panel of buttons should be fun.

## Deck Studio (the setup screen)

Everything is customisable, live:

- **Saved profiles.** Keep several named layouts (Rehearsal, Live, OBS heavy).
  New / Duplicate / Rename / Delete / Set default, and switch instantly. Mappings
  are stored per device in the browser.
- **Per-key custom look.** Click a key to set its action, a custom label, one of
  twelve colours (or Auto), and key art from the emoji palette (or type your
  own). SFX pads get a waveform icon automatically; every binding shows a plain-language
  description of what it does, and TOGGLE/HOLD chips where they apply.
- **Bind by name.** The key editor's "This show" and "This OBS" sections list the
  loaded show's cues and pads and OBS's scenes and audio inputs, so a key can fire
  a specific cue or switch to a specific scene by name.
- **Live learn.** Click **Live learn**, then press a key or turn a dial on the
  deck and its editor opens. Tactile mapping, no hunting on screen.
- **Import / export.** Export a layout to a `.json` file to back it up or copy it
  to another operator machine, and import it back.
- **Layouts as pages.** Bind PAGE keys (next layout, or jump to one by name) so
  the deck itself flips between rehearsal, live, and OBS-heavy pages.
- **Guided setup.** First run shows a three-step setup card (deck, talkback,
  OBS) with live status dots. The screen follows the active Cueola theme.

## OBS control

OBS Studio 28+ ships obs-websocket. In OBS: Tools, WebSocket Server Settings,
enable the server (default port `4455`), and copy the password if one is set.
In KeyWi Bird, open the **OBS** row at the top of the setup panel, enter
`ws://localhost:4455` and the password, and click **Connect OBS**. KeyWi Bird
reconnects automatically next time.

Available OBS actions (all remappable): STREAM (start/stop), REC (start/stop),
REC pause, V-CAM (virtual camera), CLIP (save replay buffer), OBS TAKE (studio
transition), scene by slot (SCN 1-6, the first scenes in the list), scene by name,
and mute by name. Keys light up live: the STREAM and REC keys glow while active,
the current scene's key glows, and a **LIVE** / **REC** badge shows in the header.

## Connect and Learn (owner bring-up, one time, with the deck plugged in)

The Stream Deck + XL is new enough that its exact USB profile (product id, key
pixel size, touch strip dimensions, image rotation) is confirmed from your real
unit rather than assumed. Do this once:

1. Quit the Elgato Stream Deck app. Plug the deck in. Open Cueola in Chrome or
   Edge, sign in, open **KeyWi Bird**, click **Connect deck**, pick the device.
2. KeyWi Bird reads the device's own descriptor (HID Get Unit Information, feature
   report `0x08`) for geometry, and remembers the product id.
3. Click **Test pattern**. Each key should show its number, right way up. If it
   reads sideways or upside down, open **Connect & Learn** and tap the Key
   rotation buttons (0/90/180/270) until it is upright. If the grid shape is
   wrong, set the correct Columns there.
4. Turn each dial and press the touch zones, confirm the paired action fires.
5. Confirm the touch strip shows the six readouts. The strip image path follows
   the shipping Stream Deck + protocol (report `0x02` / command `0x0C`); if the
   strip stays black on this hardware it is the one part most likely to need a
   firmware specific tweak. Keys and dials keep working regardless.

For Talkback A/B, start the daemon first (see `talkback/README.md`):

```sh
cd talkback/daemon && swift build -c release && .build/release/talkbackd
```

## Architecture (for maintainers)

- `cueola-streamdeck-device.js`: pure WebHID protocol (no DOM, no app). Input
  parsing (keys/dials/touch), key and strip image packetization, feature reports,
  per model profiles, Get Unit Information parser. Node testable:
  `node scripts/streamdeck-device.test.cjs` (46 assertions).
- `cueola-streamdeck.js`: the browser controller and Deck Studio UI. Device
  lifecycle, action catalog, profiles/mapping, the `fireSlot()` dispatch seam,
  the talkback client, the paint loop, and OBS integration.
- `cueola-obs.js`: an obs-websocket v5 client (Hello/Identify with SHA-256 auth
  via crypto.subtle, request/response, event mirroring). Attaches window.CueolaOBS.
- `outrangutan/stream-deck-label.js`: key image renderer, extended with
  `registerModel()` so a probed + XL profile can be injected at runtime.
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
