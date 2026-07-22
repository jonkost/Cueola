# Cueola Control Surface (Stream Deck + XL)

One Stream Deck + XL (36 keys, 6 dials, 6 touch zones) drives the whole rig:
playback and SFX (Outrangutan), the rundown, the Flowmingo prompter, and
Talkback A/B. It is reached from the front page under **Control Surface**, gated
behind a normal user sign in.

## How it works

The deck talks to the browser directly over **WebHID**. There is no Elgato
software, no plugin to install, and no separate daemon for the deck itself. The
operator signs in, clicks **Connect deck**, grants the one time HID permission,
and the surface self configures from the device.

Everything runs in the operator's own Cueola tab (Phase 1, same machine). A key
press runs the exact same code the keyboard shortcut runs, so it inherits every
guard the app already has: Live single authority, session checks, the cross
device writes that reach the projector and the talent prompter. Dials send
relative ticks into continuous controls. Talkback A/B open the `talkbackd`
loopback socket (`ws://127.0.0.1:17844`) directly and are momentary (hold to
talk, release to stop), with an all off safety net on release, blur, tab hide,
and page unload.

Requirements: **Chrome or Edge** (WebHID is Chromium only), and the **Elgato
Stream Deck app must be quit** because it claims the USB device exclusively.

## Default layout

Keys (9 x 4), colour coded by band:

| Band | Keys |
|------|------|
| Transport + Live | GO, PAUSE, STOP, FADE, PANIC, NEXT, PREV, GO LIVE, CUE ROW |
| Prompter | SCROLL (play/pause), TOP, A+, A-, SPD+, SPD-, FWD, REV, FULL |
| Prompter more | HIDE UI, MIRROR, BRAKE (hold), BOOST (hold), NUDGE-, NUDGE+, EDIT, HELP, SCRUB |
| SFX + comms | PAD 1-4, TALK A, TALK B, ALL TALK OFF, CLOCK |

Dials (press action in brackets):

1. Program volume (mute)
2. Prompter speed (play/pause)
3. Prompter text size (reset)
4. Prompter jog/scrub (cue to current row)
5. Rundown select (take the selected row)
6. Deck brightness (reset)

Touch strip: one readout per dial (value + tap hint). Tapping a zone fires that
dial's press action. Every key and dial is remappable in the setup screen: click
a tile, pick a new action. Mappings are saved per device in the browser, and
**Reset layout** restores the defaults.

## Connect and Learn (owner bring-up, one time, with the deck plugged in)

The Stream Deck + XL is new enough that its exact USB profile (product id, key
pixel size, touch strip dimensions, image rotation) is confirmed from your real
unit rather than assumed. Do this once:

1. Quit the Elgato Stream Deck app. Plug the deck in. Open Cueola in Chrome or
   Edge, sign in, open **Control Surface**, click **Connect deck**, pick the
   device.
2. The surface reads the device's own descriptor (HID **Get Unit Information**,
   feature report `0x08`) for geometry, and remembers the product id so it
   reconnects automatically next time.
3. Click **Test pattern**. Each key should show its number, right way up.
   - If the numbers are upside down, open **Connect & Learn** and tick **Key
     images upside down (flip 180)**, then **Apply and repaint**.
   - If the grid shape is wrong, set the correct **Columns** there.
4. Turn each dial and confirm the on screen readout moves the right way; press
   each dial and the touch zones and confirm the paired action fires.
5. Confirm the touch strip shows the six readouts. The strip image path follows
   the shipping Stream Deck + protocol (report `0x02` / command `0x0C`); if the
   strip stays black on this exact hardware it is the one part most likely to
   need a firmware specific tweak. Keys and dials keep working regardless.

For Talkback A/B, start the daemon first (see `talkback/README.md`):

```sh
cd talkback/daemon && swift build -c release && .build/release/talkbackd
```

The surface shows **Talkback: Daemon connected** once it is up. Without it, the
TALK keys warn instead of silently failing.

## Architecture (for maintainers)

- `cueola-streamdeck-device.js`: pure WebHID protocol (no DOM, no app). Input
  report parsing (keys/dials/touch), key and strip image packetization, feature
  reports, per model profiles, and the Get Unit Information parser. Node testable:
  `node scripts/streamdeck-device.test.cjs` (46 assertions).
- `cueola-streamdeck.js`: the browser controller: device lifecycle, action
  catalog, profile/mapping, the `dispatch()` seam, the talkback WebSocket client,
  the paint loop, and the login gated setup UI.
- `outrangutan/stream-deck-label.js`: key image renderer, extended with
  `registerModel()` so a probed + XL profile can be injected at runtime.
- `window.cueolaSurfaceBridge` (in `cueola-app.js`): the single seam into the
  running show: the KEYMAP action table, prompter/playout/clock dispatchers, and
  one flat state snapshot for painting lamps and dial readouts.

The dispatch layer has a `mode` of `local` (Phase 1, same machine) with a
`dispatchCloud()` seam already in place. Phase 2 (deck on one machine driving a
show on another) lands there by fanning a binding out to the Firestore
`controlBus` field, with no change to the catalog, profile, or UI.

WebHID needs no CSP change (it is a device API). The talkback loopback socket is
allowed in `firebase.json` via `connect-src ws://127.0.0.1:17844
ws://localhost:17844`. Chrome permits a loopback `ws://` from an HTTPS page.
