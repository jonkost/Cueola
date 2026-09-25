# Cueola 3.0 cue audit (§2.2)

What a cue stores today, what is actually read, and the minimal field set per type for 3.0. Line numbers are for `main` at 2bda83d. The full field-by-field evidence (every writer and reader) is in the recon lane report; this file keeps the verdicts.

## 1. The model today

A rundown row is a "beat" (`beats[]`). There is no schema: the shape is whatever the add-row wizard (8063-8070), the row editor (10782-10795) and the cue-config dialog (8919-8993) write, filtered on sync by a whitelist (5740) with department cells replaced whole. A beat has `style` (`timed` / `flex` / `segment`), `info` (the name), `notes`, `min`, `sec`, `color`, `done`, `cues`, plus helper-row markers (`helperFor`, `helperRole`) and `_createdAt` / `_createdBy`. `cues` holds up to six department cells (`video`, `audio`, `playback`, `gfx`, `lighting`, `script`), each essentially two strings, `on` (labelled READY in the editor and Live) and `off` (labelled TAKE), plus the Outrangutan link fields.

"Timed" vs "flex" has no runtime meaning beyond the pill label; both carry `min`/`sec` and the clocks ignore the style.

## 2. Field verdicts

| Type | Field | Written | Read anywhere? | Verdict |
|---|---|---|---|---|
| beat | `id`, `style`, `info`, `notes`, `min`, `sec`, `color`, `cues` | yes | yes | keep |
| beat | `done` | false at every creation | never | delete |
| beat | `helperFor`, `helperRole` | PREP/OUT generator | Live tag, cascade delete | keep for old rows; stop generating |
| beat | `disabled`, `executionState`, `rowKey` | never | Live path reads them | no writer; a "cut cue" needs one |
| beat | `type`, `cueData` | never (pre-2.0) | migration only | migrate then drop |
| every cell | `on`, `off` | editor | rundown, Live, prompter guidance, export | keep as the derived call line |
| every cell | `notes` | editor | only echoed back into the dialog | delete (fold into cue notes) |
| every cell | `ready`, `take` (legacy) | migration + two live writers (13739, 19340) | via fallbacks only | migrate, stop writing |
| every cell | `qlab*` | deleted on save | never | dead |
| video | `customSrc` | editor | echo only | delete (becomes `camera`) |
| audio | `customSrc`, `outPadId`, `outPadAuto`, `outPadName` | editor | pad link used | keep pad link; `customSrc` → `source` |
| playback | `clip`, `trtMin`, `trtSec`, `smpte` | editor | helper-row generation only | `clip` keep; TRT → cue duration; `smpte` → notes |
| playback | `outCueId`, `outAuto`, `outCueName` | editor, name resolver | call, badge, preflight, export | keep (`outAuto` becomes implicit: a linked clip always fires on TAKE) |
| gfx | `customType`, `gfxContent`, `isFixed`, `isAnimated` | editor | echo only | `customType` → `name`; `gfxContent` → `text`; motion flags delete |
| gfx | Source chips | collected | ignored (8768-8776) | delete |
| lighting | `lightingDetail`, `intensity`, `color`, `gobo`, `lightingGoFeature`, `lightingGoCue`, `lightingOffGoFeature`, `lightingOffGoCue` | editor | echo only | one `look` field; the rest into notes on migration |
| script | `text`, `dialogueNote`, `scriptType`, `speaker`, `customSrc` | editor, live edit, question append | prompter, Live, exports | keep `text`, `speaker`; Dialogue becomes a note prefix |
| script | `scriptTags` | editor | echo only | delete |
| script | `off` | dialog writes '' | fixtures only | drop |

Net: of the ~30 department-cell fields the editor writes, the ones consumed outside the dialog are `on`, `off`, `text`, `dialogueNote`, `scriptType`, `speaker`, the playback `clip`/TRT (helper rows only) and the six Outrangutan link fields. Chip selections are never stored, so a reopened cell shows no chips selected.

## 3. The editor today

| Type | Controls in the dialog | Chip vocabularies |
|---|---|---|
| Video | 47 | source (8 + custom), action Ready/Standby/Set/Set with Media Wipe, shot (8), destination (9 + custom), transition (4 + custom) |
| Audio | 47 | source (9 + custom), cue type (4 + custom), out source (10 + custom), out cue (8) |
| Playback | 38 | action Ready/Roll, TRT, SMPTE, return-to (9, hard-coded), how it ends (5), guided PREP/OUT boxes (default on), Outrangutan cue + call + SFX + demo + fire buttons |
| Graphic | 31 | type (3 + custom), source (6, ignored), transition (2), Fixed/Animated, content, out type (4), take out (3) |
| Lighting | 56 | fixture (6 + Go to Feature + Go to Cue), action (4), intensity presets (5), colour (8), gobo, detail, out fixture, lighting out (7) |
| Script | 34 | Script/Dialogue, tags (11), speaker (6 + custom), copy with 4 markers, upload |

Taps from "+ Add Row" to a usable cue: **6** for a video cue (Add Row → Choose Cue Type → VIDEO → Open Cue Builder → a source chip → Save); **6 plus typing** for a playback cue, which also silently inserts a PREP row and an OUT row; **9** to make playback actually fire. The row is inserted and synced before the dialog opens, so Cancel leaves an empty row.

## 4. The 3.0 model

**A cue has one type.** `type` is a new beat field: `camera`, `audio`, `graphic`, `playback`, `lighting`, `script`; a segment has `style: 'segment'` and no type. The type badge is what a student learns first, and the per-type fields are the only fields shown.

**Shared spine on every cue:** number (derived) · type · name (`info`) · duration (`min`/`sec`; blank means no fixed time and replaces "flex") · notes.

**Per-type fields** (always visible / behind expand):

| Type | Always visible | Behind expand | Call line shown in the rundown and Live |
|---|---|---|---|
| Camera | `camera` (CAM 1..4, custom), `shot` (Wide, Medium, CU, ECU, 2-shot, OTS, POV) | notes | "CAM 2 · Medium" |
| Audio | `source` (mic or music), `action` (on / off / under / up) | `level`, notes | "Host mic on" |
| Graphic | `name` (Lower third, Full screen, Bug, custom), `text` (on-screen text) | `hold` (seconds on screen), notes | "Lower third: Jane Doe" |
| Playback | `clip` (linked playback cue or a typed name), duration (the cue's duration) | `in`, `out`, `preRoll` (seconds), `audioFromClip`, `autoAdvance` (at end), notes | "Roll OPEN.mp4 · 1:30" |
| Lighting | `look` (look or state name, or a board cue number) | notes | "Warm wash" |
| Script | `text` (what the talent reads) | `speaker`, notes | first line of the script |
| Segment | title | — | — |

Extra department calls on one cue (a camera cue that also opens a mic) stay possible: the expanded editor offers "Also on this cue: + Audio + Graphic ...", each with the same minimal fields, and the collapsed row shows small department icons after the call line. The data stays in `cues.{dept}` so exports, the prompter and the Stream Deck keep working; `on` is rewritten as the derived call line so older readers still show something sensible, and `off` is dropped.

**Building a cue:** Add cue → pick type → name → duration → done. Three taps plus two short inputs. Type-specific fields have sensible defaults and are addable later; nothing is inserted until "Add" is pressed. No guided helper rows.

**Playback:** the READY · TRACK · ROLL · TAKE call goes away. TAKE on a playback cue sends the one fire command playback already understands; `preRoll` seconds (default 0) is a countdown before the fire, visible on every device, and it replaces "Manual TAKE" and the four stages. `autoAdvance` at clip end is stored now and wired only if Jon confirms it (open question 2 on HOLD).

## 5. Migration (no student work lost)

Runs once per beat on read (`migrateBeat`), and the rewritten shape is written back on the next save.

1. `type`: explicit if present; else by content priority playback → camera (video) → graphic → audio → lighting → script; a beat with no cells becomes `script` if it has notes, else `camera`. `style` `timed`/`flex` → duration kept; `flex` with no duration stays blank.
2. Camera: `on` matching `^(Ready|Standby|Set|Set with Media Wipe)\s+(.+?)(?: · (.+))?$` → `camera`, `shot`; otherwise `camera` = the `on` text. `off` (the transition or destination) → notes as "Then: …" unless it is the default "Take <camera>".
3. Audio: `on` "Open Mic · Host" → `source` Host, `action` on; "Track PLBK" → under; "Fade In"/"Play" → up; `off` → notes "Then: …".
4. Graphic: `name` = `customType` or the type parsed from `on`; `text` = `gfxContent` or the parenthesised content; `isFixed`/`isAnimated`, `off` → notes.
5. Playback: `clip` = `clip` || `outCueName` || parsed from `on` ("Roll X · m:ss TRT"); TRT → cue duration when the cue has none; `smpte`, `off` → notes; `preRoll` = 3 when `outAuto` was on (the old call took three seconds), else 0; links kept.
6. Lighting: `look` = Go-to-Feature/Go-to-Cue text, else the `on` text; the eight extras → notes when non-empty.
7. Script: `text` kept; `speaker` = `speaker` || `customSrc` || parsed from `on` ("Host · Begin"); Dialogue → `text` = "(unscripted) " + `dialogueNote`; `scriptTags` → notes "Tags: …".
8. Every cell's `notes` (never shown today) is appended to the cue's notes. `done`, `qlab*`, `ready`/`take` are dropped. PREP/OUT helper rows stay as ordinary cues (they are student-visible rows) but are no longer generated.
9. Anything the parser cannot place goes into notes verbatim, prefixed with its old label ("Ready: …", "Take: …").

## 6. Open questions for Jon (from §8 of the brief)

- Is the type list complete (camera, audio, graphic, playback, lighting, script, segment)? Anything to add, merge, or retire?
- Should extra department calls on one cue stay (a director's "take 2, mic 1 up" moment), or is one call per cue enough for class?
- Do clips need pre-roll at all (question 3)? If not, `preRoll` stays 0 and hidden.
- Should the old TRT (m:ss) and SMPTE fields survive as playback expand fields, or is the cue duration enough?
