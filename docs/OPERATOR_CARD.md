# Cueola Operator Card

One page. Print it, tape it to the desk. Extracted from the app's keymap registry
(3.0, 2026-09). Press **?** in the app any time for the live version (it is generated
from the same registry and includes any of your own rebinds; override keys via
`localStorage.cueola_keymap`). Typing in any text field suppresses all shortcuts.

## Build screen (Cueola)

| Key | Action |
|---|---|
| Cmd/Ctrl+Z | Undo rundown edit *(syncs to collaborators)* |
| Cmd/Ctrl+Shift+Z | Redo |

## Live screen (Cueola)

**Rundown**
| Key | Action |
|---|---|
| → / ↓ | TAKE: the standby cue goes on air *(director only; works even with Script Op open)* |
| ← / ↑ | Back one cue *(director only)* |

*Not the director? The arrows only browse cues on your own screen. **Back to on
air** brings you back.*

**Prompter (Flowmingo)**
| Key | Action |
|---|---|
| Space | Play / pause |
| K | Play / pause (JKL style) |
| J *(hold)* | Brake |
| L *(hold)* | Boost |
| − / = | Text smaller / bigger |
| [ / ] | Speed down / up |
| , / . | Nudge back / forward |
| C | Cue prompter to current row |
| T | Prompter to top |
| F / R / H / M | Talent fullscreen / stop and back to top / hide UI / mirror |
| E | Edit current row script |
| Alt+↑ / Alt+↓ | Direction forward / reverse |

**Playback (Outrangutan, from Live)**
| Key | Action |
|---|---|
| G | GO: plays the clip on standby in playback right away |
| G *(during a pre-roll count)* | Roll the clip now |
| S *(during a pre-roll count)* | Cancel: nothing rolls |
| P | Pause / resume |
| S | Stop |
| Shift+S | Fade-stop |
| **Shift+Esc** | **PANIC: all stop** |

*A playback cell linked with **Roll this clip on TAKE** rolls its clip when the
director takes that cue (the cell shows a **TAKE** chip). If the cue has a
pre-roll, a **ROLLING IN** count shows first. Untick it and the cell shows
**MANUAL**: once that cue is on air, fire the clip with the **GO** button on
its card in **Focus** view.*

**Questions lane (Script Op ▸ Clocks)**
| Key | Action |
|---|---|
| Enter *(in the lane)* | Push the pasted question to talent as a QUESTION card |
| Esc | Clear the question card |

**Scrub & reference**
| Key | Action |
|---|---|
| / | Jog-wheel scrub: local until **Enter** cues the talent there; **Esc** abandons |
| ? | Shortcut reference (live + build screens) |

## Outrangutan screen (module focused)

| Key | Action |
|---|---|
| Space | GO (doubles as RESUME while paused) |
| P | Pause / resume |
| S | Stop |
| F | Fade & stop |
| **Esc** | **PANIC** |
| *Pad hotkeys* | Fire SFX pads (set per pad) |

**Control surfaces:** Stream Deck (WebHID) and any MIDI box (Settings ▸
Controllers ▸ MIDI ▸ **Connect MIDI**, then **+ Learn a control**: touch it,
pick its action; a CC fader can ride Master level). Rehearse mappings without hardware:
`Outrangutan.midiInject(0x90, 60, 127)` in the console.

## Everywhere

| Key | Action |
|---|---|
| Cmd/Ctrl+S | Save the open surface's show file in place (`.cueola` / `.ogshow`) |

**Sign in:** the front page opens on the **Your sessions** card. Type your
**username**, press **Sign in**, then type your 4 digit **PIN** (there is no
password). Every session assigned to you is one tap away. Only have a code?
Use the **Have a show code?** link under the card. New crew: **New here?
Create your profile**, with the class key. New show codes look like
`2607KWXR` (year, month, four letters); older short codes still work. Your portal shows your position, open
to-dos, and unseen notes per session. The join doors in Planda Bear,
Flowmingo Remote Op, and Outrangutan lead with the same one-tap list of your
assigned sessions once you are signed in; typing a code is the fallback
everywhere.

**If you use a Stream Deck:** sign in first, then open the front-page
**KeyWi Bird** card (it stays locked until you do). Any Stream Deck works,
6-key Mini through the 36-key + XL, in Chrome or Edge. First time on a deck, run the
**Setup wizard**. Keys are live: playing keys wipe with the clip, pre-roll
shows a thin bottom bar, presses flash.

**Practice:** the front-page **Demo** card loads Campus News (10 rows) with
no login. Drill this whole card there before a real show.

**Recovery. Read this row before panicking:**

- **Director badge** (on the Live bar): **DIRECTOR · You** means your TAKE
  moves the show, **DIRECTOR · a name** means someone else is directing, and
  **FOLLOWING** means nobody is directing yet.
- **Prompter takeover:** if another operator window takes the prompter, this
  one says so and follows it.
- **System status** rail (above the Live rundown): it stays hidden until
  something needs you. Then it opens with one row each for Flowmingo,
  Playback, Script Operator, Saved, Director and Controls. A row in trouble
  gets its repair button: Recover Flowmingo · Recover Playback · Recover
  Script Operator · Retry cloud sync (or Open Flowmingo / Open Playback /
  Open Script Operator when that window is only closed). Use it the moment the rail opens.
- **Session History** (Settings ▸ File ▸ **History**): timestamped snapshots
  from **this device, plus the cloud trail on an admin-signed-in machine**
  (students see the local rows only; badged "Cloud" / "This device";
  saved on join, every two minutes while things change, on go-live, and on
  leave). **Restore replaces the rundown for everyone**: it re-stamps as the
  newest change so an offline machine can't undo it, and a recovery copy of
  the current state is saved first. Export any snapshot for a file copy.
- Notes, likes, and checklist ticks sync per-note; a reload on dead Wi-Fi
  still boots the show from the local cache.

---

## Going live: the 10-line checklist

1. Open the session on the operator machine; **Outrangutan same tab, Session mode, same code**.
2. Output window to the program display, fullscreen; **Identify** to confirm which screen. The watchdog flags a frozen output and re-syncs it when it returns.
3. Talent opens Flowmingo with the code; wait for **Connected**.
4. **Settings ▸ Production ▸ Preflight**: fix anything red via its "Row →" jump; rerun until green.
5. Save the show: **Cmd+S** (`.cueola`), Outrangutan **Save Show** (`.ogshow`). These are your walk-away backups. Print the **show pack** (Outrangutan Settings ▸ Show ▸ **Print**: cue sheet + pad map) and the rundown PDF (**Settings ▸ File ▸ Export PDF**).
6. The director presses **Go Live** (the button runs preflight again; it should already be green). Everyone else presses **Watch live**.
7. `C` to cue the prompter to row 1; confirm the follower mirrors you.
8. Drive with **TAKE** (or the right arrow); `G/P/S` for playback; pads, your deck, or your MIDI box for SFX. Keyboard first, mouse never required.
9. If anything breaks mid-show: it cuts to **black + a toast, the show keeps running**. TAKE the next cue and keep going. **Shift+Esc** is the big red button.
10. After: **Settings ▸ Production ▸ Show Log ▸ Export .txt**, attached to any issue report. Pinned wrap-notes show who still hasn't read them.
