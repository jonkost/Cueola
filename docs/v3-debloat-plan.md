# Cueola 3.0 de-bloat plan (every screen)

Audited 2026-09-26 on `main` at 0d4e11e, six lanes: rundown chrome, Live chrome, Planda Bear, Flowmingo, playback/deck/doors/dashboard, code. The rundown table, its cells and the Live table are out of scope by decision and stay as they are.

Two lists. **SAFE** cuts remove a duplicate, a dead control, hover-only information or developer wording; they are applied without asking. **DESIGN CALL** cuts remove or hide a real feature; each needs Jon's tick.

## Headline numbers

| Where | Count today |
|---|---|
| Places that ask a student for a show code | 9 |
| Places on the front page that offer sign-in | 4 (plus one that can never be reached) |
| Times the prompter control set is built | 4 (Script Op panel, Flowmingo Op mode, standalone Flowmingo Op, pop-out page) |
| Rundown toolbar controls | 12, five of them repeated inside Settings |
| Places Planda Bear can be opened from | 5 |
| Copies of the paperwork export buttons | 4 |
| Words for the person in control | 3 (DIRECTOR, CALLER, INST) |
| Themes offered | 9 in Cueola, 9 in Planda Bear, 8 in the dashboard |
| Duplicate helper functions across files | 16 groups (about 4 KB) |
| Legacy compatibility code | about 11 KB |

## SAFE cuts (applied in rounds, this release)

Rundown chrome: Settings "Apps" section (repeats the toolbar) · duplicate Planda Bear buttons in the Admin panel · sync state shown as words, not a tooltip · the disabled always-checked "Rundown, in this tab" box in Show setup · the settings marketing card · a leftover comment · the one-sentence Accounts section · text labels on the admin tabs · bottom bar NOW/NEXT renamed to On air/Standby to match Live.

Live chrome: the four link chips in the top bar (the status rail already says it) · the "Time left" card (same number as Remaining) · speed/size −/+ buttons (the sliders stay) · A−/A+ (the Panel Text zoom stays) · plain-English preflight rows · the localStorage sentence in the shortcut list · keyless rows in the shortcut list · "NTSC Bars" → "Color bars" · "Playout does not auto-fire" → plain words · the transient sync chip · pop-out button gets its own icon · recovery-button tooltips that repeat the label · the static "Live Rundown" label.

Planda Bear: hub footer export row + Close (the gear and "‹ Cueola" cover them) · footer "Planda Bear" back button in editors · the in-body Export Call Sheet PDF (4th copy) · empty Instructor Comments card hidden · composer draft Export PDF · composer formatting hint line · package-preview notes toggle (dup of the hub box) · jargon in the roster ("canonically", "Firestore", raw ids) · profile ids off the printed register · dev-facing preview/error copy · hidden checklist fields and their repair arrays · dead notes nav slot · disabled size inputs → text · "From rundown" label · text labels on plot inspector tabs · "Your Name" hidden when signed in · plain words for generator/CSV/Object Bank.

Flowmingo: Panel Text section (A−/A+ exist) · Screen tab's Talent button · the separate Screen tab · talent panel "Script" button (Link a show does it) · plain-word status copy in the pop-out · rename NTSC Bars / Transport / Scrub / Hide UI / Full / Punch · tab names under icons · captions under Push card / Into script · one hotkey list from the keymap · link-chip state as text.

Doors, playback, deck, dashboard: Name field off the three join modals (the profile name is used anyway) · identity-strip session chips (dup) · the unreachable "Use my username" strip · Planda Bear and Outrangutan join cards merged into the one Join modal · "Show code required" pill · Notes bell hidden until a show is open · settings-panel Sign in (dup) · support link fixed · Hide tooltip fixed · Outrangutan footer tech line · one master level · plain output-window errors · second "Connect deck" button · Diagnostics out of the deck cold start · orientation-proof buttons · portal jargon · one term for the class key · dashboard: nav Accounts and "+ New Session" duplicates, summary rows that repeat inputs, theme click saves at once, "Total Cues" stat.

Code: one shared copy of pad/normalizeTimeValue/fmtAgo/App Check bootstrap across index and dashboard · duplicate scriptOpNextCueIndex · duplicate protocol utils · console leftovers · old-code localStorage copies removed after copying · the legacy prompter channel (double writes) · remaining unused CSS.

## DESIGN CALLS (Jon ticks)

1. Instructor menu: Admin, Show setup and the DIRECTOR chip fold into one menu, hidden without an instructor sign-in.
2. One word for the person in control (proposal: Director) and one for the class key.
3. Themes: 9 → 3 in Cueola; Planda Bear and the dashboard follow the Cueola theme.
4. Drop the frame-rate setting; clocks read HH:MM:SS.
5. Flowmingo: drop the in-Live "Flowmingo Op" mode and the standalone Remote Op page (both duplicate the Script Op panel and the pop-out); simple tier by default (Play, Speed, Size, Cue Now/Next, Push, Question) with the rest behind More; Wrap 10/5/Send → one field; Question toggle merged into Push card; favourites/Arrange hidden.
6. Live: keep one of the caller badge / director banner; drop "Theme & brand assets" and Build rows from the preflight; drop the scrub nudge buttons; drop the K and T duplicate keys.
7. Planda Bear: "Who worked on what" log gone (each card says "Last by"); 7 weather inputs → one line from the forecast; schedule fields copied from the call sheet become read-only; three phone fields → one; plot ±45° buttons gone; floor-plan picker hidden while there is one room; code-format button gone.
8. Outrangutan: card becomes one Open; its Stream Deck sheet points at KeyWi Bird; Integrations (Dropbox token, transcode) and the dead OBS panel removed; kiosk card only when the helper is detected.
9. KeyWi Bird: rim customization → on/off; three layout-sharing paths → one Save.
10. Front door: Blank Slate's "Work locally only" path; "Rows" count in the show strip; version line only in the Guide; Edit toggle hidden (drag always on).
11. Code: retire the notes legacy mode and the whole-key paperwork sync fallback once the rules are confirmed deployed; stop mirroring activeIdx; split setupFirestore and the preflight into named pieces.

The full lane reports with file:line for every item are kept with the session; this file carries the decisions.
