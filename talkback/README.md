# Cueola Talkback A/B

One mic, two push-to-talk destinations. Hold the Talk A button on the Stream Deck and the mic flows out the interface's physical outputs 1-2; hold Talk B and it flows out outputs 3-4. Release and it stops. Built per the Talkback A/B build spec (Option 1: custom Stream Deck plugin with true keyDown/keyUp momentary behavior).

## Layout

- `daemon/` Swift package for `talkbackd`, the standalone audio daemon. CoreAudio AUHAL engine plus the local WebSocket API. This is the module's only public surface; the Stream Deck plugin and the production suite are both just clients.
- `streamdeck/com.cueola.talkback.sdPlugin/` custom Stream Deck plugin. Two actions (Talk A, Talk B), keyDown sends `on`, keyUp sends `off`, and the buttons light up from the daemon's state pushes.

## Status vs. the spec milestones

| Milestone | Status |
|-----------|--------|
| 0. Hardware verification | **Owner errand, see checklist below** |
| 1. Audio passthrough | Code complete, needs UR44 to verify |
| 2. Channel map to both pairs | Code complete (client buses 0-3 mapped to physical outs 1-4), needs UR44 to verify 3-4 independence |
| 3. Gating + ramps | Code complete (8 ms linear ramp, sample accurate, in the render callback) |
| 4. Local WebSocket API | **Done and tested live** (protocol round-trip verified against a stand-in 8ch device) |
| 5. Stream Deck plugin | Code complete, needs Stream Deck app to verify |
| 6. Suite integration | API is ready; suite-side client not started |

## Milestone 0 checklist (do this first, with the UR44 plugged in)

1. Flip the rear switch to CC mode, connect USB, no Steinberg driver installed.
2. Open Audio MIDI Setup and confirm the UR44 shows **4 discrete output channels** and a working input, driverless. If only 2 outputs appear, stop: the whole plan depends on this.
3. Run `daemon/.build/release/talkbackd --list-devices` and confirm the UR44 line reports `out: 4ch` (or more) and `in:` at least 1.
4. Start the daemon (below), hold A and B in turn, and confirm outs 1-2 and 3-4 are truly independent, and that 3-4 is not the duplicated main/line pair. On the UR44 the main L/R and one line pair carry the same signal in hardware; A and B here deliberately use channels 1-2 and 3-4.

## Build and run the daemon

```sh
cd talkback/daemon
swift build -c release
.build/release/talkbackd                # defaults: --device UR44, port 17844, 48 kHz, mic input 1, 8 ms ramp
.build/release/talkbackd --help         # all flags
```

First launch will trigger the macOS microphone permission prompt; grant it or the outputs stay silent.

Startup logs the matched device, channel counts, and sample rate, then `WebSocket API listening on ws://127.0.0.1:17844`. It exits with a clear error if the device is missing or exposes fewer than 4 outputs.

## WebSocket API

`ws://127.0.0.1:17844` (loopback only). Text frames.

- Commands: `A on`, `A off`, `B on`, `B off`, `state?`
- Pushes: `{"type":"state","talkA":bool,"talkB":bool}` sent to every client on connect and on any change (this is what lights the Stream Deck buttons)
- Unknown input: `{"type":"error","message":"unknown command"}`

The production suite should speak this same protocol; keep the daemon as a standalone service.

## Install the Stream Deck plugin

```sh
ln -s "$(pwd)/talkback/streamdeck/com.cueola.talkback.sdPlugin" \
  "$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/com.cueola.talkback.sdPlugin"
```

Then quit and relaunch the Stream Deck app. Drag "Talk A (outs 1-2)" and "Talk B (outs 3-4)" from the Cueola Talkback category onto keys. Green/blue means the route is live; if the daemon is not running, pressing a key shows the warning triangle. The plugin reconnects to the daemon every 2 seconds, so start order does not matter.

## Design notes

- AUHAL (`kAudioUnitSubType_HALOutput`) bound to the UR44 by name match, never the system default. Plain AVAudioEngine cannot address outputs 3-4, which is why it is not used.
- One audio unit handles both directions (input element 1, output element 0) since the UR44 is a single CoreAudio device, so input and output share a clock and no aggregate device is needed. If Milestone 1 testing shows otherwise, build an aggregate with drift correction.
- Gain gating happens per sample in the render callback with a linear ramp (default 8 ms, `--ramp-ms` to tune within the 5-10 ms band). The API layer only flips flags.
- A channel map pins client channels 0-3 onto physical outputs 1-4 and leaves any remaining device outputs undriven.

## Open questions from the spec, and what the code assumes

- PTT mode: Option 1 (custom plugin) built. No toggle fallback.
- Sample rate: defaults to 48 kHz, `--rate` to override. The daemon asks the device for the rate and follows whatever the device actually reports.
- One device vs. aggregate: single device assumed (see design notes).
- Button-state feedback: included in v1 (two-state actions driven by daemon pushes).
- What A and B physically feed: still to document once decided; nothing in code depends on it.
