# Outrangutan for Mac: the plan

Outrangutan is becoming a real Mac app. Everything that plays picture and
sound runs on the Mac, with no browser in the way. The show keeps playing
with the Wi-Fi off.

Two things still ride the internet, because the rest of Cueola lives in the
cloud:

- The director's TAKE on the rundown firing a clip.
- Stream Deck keys pressed on another Mac.

## The one rule: speak the same language as the web Outrangutan

Today the rundown and KeyWi Bird send Outrangutan commands through the
show's shared record in the cloud (GO, stop, pause, fade, panic, fire a cue,
fire a pad, stand by a cue, master volume). Outrangutan answers with what is
on air, the clock, and "got it" for every command.

The Mac app will read and write exactly the same fields in exactly the same
shape. That means:

- The rundown's TAKE works with no change.
- KeyWi Bird keys, the playback strip, the key lights and the "not linked"
  warning all work with no change.
- The Go Live preflight rows work with no change.
- The web Outrangutan and the Mac app can take turns on the same show while
  we test. Only run one of them at a time on a show.

## One Stream Deck for both apps

Only one program at a time can hold a Stream Deck. That stays KeyWi Bird,
in the browser, the way it works now. KeyWi keeps running the rundown,
prompter, talkback and OBS keys, and its playback keys reach the Mac app.

- **Deck on a different Mac from the playback Mac** (the Pro + Air rig):
  keys go through the shared record, like today.
- **Deck on the same Mac as the playback Mac:** later we add a direct lane
  inside the Mac, so playback keys land at once and keep working with the
  internet down. This needs a small addition to KeyWi Bird. Everything else
  in KeyWi stays the same.

## Every tool, and what gets better

| Web tool | On the Mac | What gets better |
|---|---|---|
| Cue list: video, sound, stills | Built (step 1) | Plays ProRes, HEVC, video with see-through backgrounds, any sound file. No converting. |
| Count-out clock, 29.97 drop-frame | Built (step 1) | Counts from the player itself, 30 times a second. |
| GO, Pause, Stop, All Stop | Built (step 1) | macOS is told a show is running, so it never slows the app down. |
| Autosave | Built (step 1) | Saved on this Mac after every change. |
| Output window | Built (step 1), one screen | Fills its own screen edge to edge, above the menu bar. |
| Fade and Stop All | Built (step 5, for the deck's Fade key) | One second, picture and sound together. |
| Fades with curves, crossfades | Built (step 2) | A true dissolve: the new picture fades up over the old one, no dip to black. Fade out now works (the web app keeps the setting but never uses it). |
| Pre-wait, continue modes, end actions, still timers | Built (step 2) | Same rules as the web version, including its still rules. Pause also holds a pre-wait and a still's timer. |
| Trim in and out, loop, volume, fit, scale, position | Built (step 2) | Trim stops on the exact frame. |
| Solid color mattes | Built (step 2) | |
| Program preview in the control window | Built (step 7) | The same layers as the output. |
| Sound effect pads: banks, emoji, colors, hotkeys, retrigger, loop | Built (step 3) | Sounds load into memory before the show, so a pad fires with no delay. Four copies per pad for Layer. |
| A pad tied to a cue | Built (step 3) | |
| Pads from the rundown and the deck | Built (step 3) | |
| Pad search | Later | |
| Sound chain: gain, 3-band EQ, compressor, master volume | Built for pads (step 3) | The same EQ points and compressor as the web app. |
| Pad meter, pads on any channel pair of an audio interface | Built (step 4) | |
| Cue sound device, a sound device per output | Built (step 4) | Cue sound plays on a device's first two channels. |
| Cue sound meter, cue sound on any channel pair | Later | Needs cue sound to move onto the same audio engine as the pads. |
| Record a sound effect | Step 3 | |
| Multiple outputs, identify, pick a screen and audio device per output | Built (step 4) | Up to four outputs. A cue picks its output, or every output. Replaces the kiosk Chrome windows. |
| Apple design pass | Built (step 4) | Toolbar, native Inspector with icon tabs (the house inspector standard), Settings window, Playback menu, SF Pro and SF Mono, standard empty screens, app icon from the brand art, the Mac's light or dark look. Needs macOS 14. |
| Join a show by code, sign in, publish cues and what is on air | Built (step 5) | The rule above: same fields, same shape. |
| Command queue, "got it" replies, panic lane, master volume from the deck | Built (step 5) | Every rule has its own test. |
| Fix requests from the rundown, preflight report | Built (step 5) | Needs no clicks on the Mac: sound and outputs are always ready. |
| KeyWi Bird playback keys and strip | Built (step 5 through the cloud, step 6 direct on the same Mac) | |
| Show file save and open (.ogshow, opens in the web app too), crash recovery | Built (step 6) | Opened media is copied to Movies, Outrangutan. |
| Show log, print cue sheet | Built (step 6) | Each day's log is also a text file. |
| Keyboard shortcuts you can change, lock, wall clock | Built (step 6) | |
| MIDI | Built (step 6) | Uses the Mac's own MIDI system. |
| Waveform and vectorscope | Built (step 7) | Rec. 709, 15 times a second, only while showing. |
| Keying: chroma, luma, alpha | Built (step 7) | Keys on the graphics card, full resolution, live on air. Show files carry it both ways. |
| OBS control | Built (step 7) | The same protocol as the web (obs-websocket 5): scene, record and stream actions per cue, and scene triggers. |
| Dropbox folder sync | Built (step 7) as Watch a Folder | The Dropbox app syncs the folder; Outrangutan watches it. No token to paste. |
| Convert on upload | Not needed | The Mac plays the pro formats as they are. |
| Kiosk helper and kiosk windows | Not needed | Native outputs replace them. |
| Not possible on the web | Step 8 | SDI out through a Blackmagic card, NDI to the switcher, key and fill. |

## How we test each step

1. `swift test` checks the clock and the rules.
2. The app's test mode (see README.md) presses the buttons by itself, saves
   pictures of both windows and writes what happened.
3. Jon runs it on the real rig before we call a step done.

## Still to decide

- **Signing in (built in step 5):** the Mac app signs in the same two ways
  as the web front door. It talks to the cloud with plain web requests, so
  it needs no Firebase setup and no Apple developer signing. It checks the
  show about four times a second instead of getting a push, which adds
  about a tenth of a second to a fire from another Mac. Step 6's direct
  lane covers a deck on the same Mac.
- **Handing the app to other Macs:** the free Apple sign-in covers Jon's
  own machines. Giving it to anyone else without a warning needs the paid
  Apple Developer account.
