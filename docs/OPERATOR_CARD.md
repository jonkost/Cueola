# Cueola — Operator Card

One page. Print it, tape it to the desk. Extracted from the app's keymap registry
(V2, 2026-07) — press **?** in the app any time for the live version (it is generated
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
| → / ↓ | Next row *(always — even with Script Op open)* |
| ← / ↑ | Previous row |

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
| F / R / H / M | Talent fullscreen / reset / hide UI / mirror |
| E | Edit current row script |
| Alt+↑ / Alt+↓ | Direction forward / reverse |

**Playout (Outrangutan — from the Cueola live screen)**
| Key | Action |
|---|---|
| G | GO |
| P | Pause / resume |
| S | Stop |
| Shift+S | Fade-stop |
| **Shift+Esc** | **PANIC — all stop** |

**Scrub & reference**
| Key | Action |
|---|---|
| / | Jog-wheel scrub — local until **Enter** cues the talent there; **Esc** abandons |
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

**Control surfaces:** Stream Deck (WebHID) and any MIDI box (toolbar ▸ MIDI ▸
Connect, then **+ Learn a control** — touch it, pick its action; a CC fader can
ride Master level). Rehearse mappings without hardware:
`Outrangutan.midiInject(0x90, 60, 127)` in the console.

## Everywhere

| Key | Action |
|---|---|
| Cmd/Ctrl+S | Save the open surface's show file in place (`.cueola` / `.ogshow`) |

**Identity:** enter with your **username** via the front-page profile button —
no passwords; profiles come from the class **login code**. Your portal shows
your position, open to-dos, and unseen notes per session.

**Recovery:** Settings ▸ File ▸ **History** holds timestamped session snapshots
with one-click restore. Notes, likes, and checklist ticks sync per-note — a
reload on dead Wi-Fi still boots the show from the local cache.

---

## Going live — the 10-line checklist

1. Open the session on the operator machine; **Outrangutan same tab, Session mode, same code**.
2. Output window to the program display, fullscreen; **Identify** to confirm which screen. The watchdog flags a frozen output and re-syncs it when it returns.
3. Talent opens Flowmingo with the code — wait for **Connected**.
4. **Settings ▸ Production ▸ Preflight** — fix anything red via its "Row →" jump; rerun until green.
5. Save the show: **Cmd+S** (`.cueola`), Outrangutan **Save Show** (`.ogshow`) — your walk-away backups. Print the **show pack** (cue sheet + pad map) and the rundown (its Outrangutan column shows every linked cue).
6. **Go Live** (the button runs preflight again — it should already be green).
7. `C` to cue the prompter to row 1; confirm the follower mirrors you.
8. Drive with **arrows**; `G/P/S` for playout; pads or your MIDI box for SFX. Keyboard first, mouse never required.
9. If anything breaks mid-show: it cuts to **black + a toast, the show keeps running** — advance and keep going. **Shift+Esc** is the big red button.
10. After: **Settings ▸ Production ▸ Show Log ▸ Export** — attach it to any issue report. Pinned wrap-notes show who still hasn't read them.
