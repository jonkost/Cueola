# Stage Plot — Owner Design Consult (prepared 2026-07-21)

Phase 8 opens with this consult (your directive, 2026-07-16). Nothing is
built; every visual/behavioral call below is yours at zero sunk cost. The
**engineering baseline is already verified** and isn't on the table unless
you want it to be: vanilla SVG editor (no canvas, no libraries), one
`prePro.stagePlots` array key on legacy whole-key sync with advisory
single-editor presence, vector print with 2x PNG rasterization inside PDF
exports, and registration as a numbered section in the export builder.
Full technical detail: design note D4 (docs/v2_1-design-notes.md §D4).

Answer the seven questions — one line each is enough — and the build starts.

## 1 · What is a "plot" to your students?

The baseline treats it as **real paperwork**: feet-based coordinates, stage
outline with dimension labels, grid snap, a scale badge, letter-landscape
print with a title block (production / venue / date / scale).
**Question:** professional-drafting feel (recommended — matches the rest of
the package) or a looser sketch-board feel (faster to doodle, reads less
like paperwork)?

## 2 · The glyph set (~10 shipped in v1)

Baseline list: camera, mic, light, speaker, monitor, person, riser/set
piece, table, door, text label — drawn in the SF-Symbol line style so plots
match the app.
**Question:** what's missing or wrong for YOUR shows? (e.g. anchor desk,
green screen, tripod vs ped camera distinction, cable ramp, curtain line?)
Name up to ~4 swaps/adds; more than ~14 total pushes past the 1.5-day box.

## 3 · How many plots per session?

Baseline: an array of named plots ("Studio A — talk", "Studio A — band"),
minimum one, with a dropdown + "+ Add Plot" exactly like call sheets.
**Question:** is multi-plot right, or is one-plot-per-session simpler for a
class? (Multi-plot costs nothing extra — the call-sheet pattern exists.)

## 4 · Who edits?

Baseline: anyone in the workspace can edit, ONE at a time (advisory "X is
editing this plot" chip — same trust model as the rest of the paperwork; in
grouped sessions each group has its own plots).
**Question:** keep student-editable (recommended — it's coursework), or
instructor-only like the roster?

## 5 · Where does it show up in the export?

Baseline: its own numbered section in the PDF package, included whenever the
sheet is enabled; Intro-preset sessions have it OFF (decision 10) so it only
appears for Full-production courses.
**Question:** confirm Intro=off/Full=on, and whether the plot should also
appear on the call sheet (small thumbnail) or stay its own page only
(recommended: own page only for v1).

## 6 · The inspector (right panel, per selected element)

Baseline fields: label, color (department colors), rotation, scale/size,
z-order (front/back), delete.
**Question:** anything else per-element for v1 — e.g. a "channel/input #"
field on mics, a "circuit" field on lights? (Each extra field is cheap; a
whole numbering system is not v1.)

## 7 · The v1 cutline (already parked to 3.0 unless you disagree)

Walls/rooms drawing, image/photo backgrounds, align-and-distribute tools,
cable runs, live multi-cursor editing. Zoom/pan, grid snap, undo, touch
support are IN v1.
**Question:** anything on the parked list you consider essential for launch,
or anything in v1 you'd cut to buy schedule?

---

### Timing reminder (decision 15 is automatic)

Stage Plot is deliberately last: if the runway is gone, it slips to a
fast-follow point release and nothing else depends on it. The consult answers
keep — they don't expire with the slip.
