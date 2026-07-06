# Cueola — Operator Card

One page. Print it, tape it to the desk. Extracted from the app's keymap registry
(v1.0.0) — press **?** in the app any time for the live version (it is generated
from the same registry and includes any of your own rebinds; override keys via
`localStorage.cueola_keymap`). Typing in any text field suppresses all shortcuts.

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

## Everywhere

| Key | Action |
|---|---|
| Cmd/Ctrl+S | Save the open surface's show file in place (`.cueola` / `.ogshow`) |

---

## Going live — the 10-line checklist

1. Open the session on the operator machine; **Outrangutan same tab, Session mode, same code**.
2. Output window to the program display, fullscreen; **Identify** to confirm which screen.
3. Talent opens Flowmingo with the code — wait for **Connected**.
4. **Settings ▸ Production ▸ Preflight** — fix anything red via its "Row →" jump; rerun until green.
5. Save the show: **Cmd+S** (`.cueola`), Outrangutan **Save Show** (`.ogshow`) — your walk-away backups.
6. **Go Live** (the button runs preflight again — it should already be green).
7. `C` to cue the prompter to row 1; confirm the follower mirrors you.
8. Drive with **arrows**; `G/P/S` for playout; pads for SFX. Keyboard first, mouse never required.
9. If anything breaks mid-show: it cuts to **black + a toast, the show keeps running** — advance and keep going. **Shift+Esc** is the big red button.
10. After: **Settings ▸ Production ▸ Show Log ▸ Export** — attach it to any issue report.
