# Stage Plot Layers: the System Plot Plan generator (planned 2026-08-13)

> **BUILT 2026-08-13, same day, all six phases.** Browser-verified phase by
> phase, 30 suites + contract check green, WORKER_SCHEMA 35, uncommitted.
> See CHANGELOG "Unreleased: Stage Plot layers". Owner inputs at the bottom
> remain open (icon art, real FS4E-123 feet, panel width, slide recolor).

The Stage Plot grows into the tool students use for the three System Plot
Plan assignments (Audio, Video, Lighting), replacing the Keynote workflow.
Students place their lab room's real gear on a plot, draw directional
signal flow, and export each system as its own layer or any combination,
straight from Planda Bear.

This is a paperwork generator only. **Non-goals, per owner directive:**
no grading, no rubric hooks, no peer-to-peer feedback. Instructor feedback
stays the existing Planda Bear comments, unchanged. Submission itself stays
on the discussion board (students download an image and post it there).

## Owner decisions locked 2026-08-13

1. **Ownership:** one shared plot set per show code, exactly as today.
   Lab groups each get their own show code. (Instructor-assigned per-group
   plots inside one session are a possible later round; parked.)
2. **Signal flow:** anchored connectors. Click source gear, click
   destination gear; the arrow attaches to both and follows them.
3. **Floor:** traced FS4E-123 room template joins the blank rectangle;
   each plot picks its floor. More rooms can drop in later.
4. **Layer colors:** Cueola department tokens (audio green, video blue,
   lighting purple), not the slide colors. Course slides get updated to
   match since the workflow moves in-app.
5. **Submissions are PDFs** (2026-08-13 follow-up): students turn in a
   PDF of each layer or a combination, so PDF is the export path that
   matters; no separate image download. Students keep full edit rights
   across all three checkpoints so earlier layers can be fixed as the
   plot grows; only plot add/delete stays instructor-only, as today.

Copy note: the owner describes the workflow as create, adapt, improve.
That is the owner's shorthand, not the course's phrasing; app copy stays
neutral and does not adopt it.

## Round 2 owner notes (2026-08-13), folded into the design below

- **Flows are cables.** Every flow carries a required connector type
  (XLR, BNC, DMX 5-pin ship first; registry-driven so more drop in).
  The type defaults by layer so students are never nagged, and is
  editable per flow. Direction reads out of the source, into the
  destination.
- **Crossing cables draw a "bump over" hop** so the plot reads like a
  real schematic instead of a tangle.
- **Admins and instructors curate the bank.** The full registry is the
  superset; a Manage Bank panel enables and disables types for the
  session's students.
- **Glyphs keep their proportions.** No more stretching: gear resizes
  uniformly, and pipe and drape sizes by panel count instead of feet.
- **Floor plans are assigned by instructors/admins** for their learning
  space; students do not pick the floor.
- **The editor foundation feeds a future patching exercise** for larger
  equipment. The item + labeled-cable model stays generic on purpose so
  that round reuses it rather than forking it.

## What the assignment slides require (source: System Plot Plan.zip)

- Three checkpoints, one per system, each **building on the last** (the
  Keynote flow literally copies the previous slide forward). Layers make
  the copy-forward step disappear: one plot, three assignments.
- **Audio bank:** Sq6 sound console, wired SM58, wireless SM58, wireless
  Rx, laptop, stage box, PA speakers, foldback monitor, K181 subs, video
  flypack, AJA media recorder, pipe and drape.
- **Video bank:** displays, camera, SDI-to-HDMI converters, projector,
  projection screen.
- **Lighting bank:** crank stands, ERS Source Fours (unit numbers),
  Fresnels, LED pars, parcans, dimmers, ColorSource console; text notes
  for dimmer addresses (D3) and positions (Key, Fill, Back). Free-text
  item labels already cover the text notes.
- Directional arrows per system, colored by system.
- Export for submission. The slides say an image file; the owner
  supersedes that: students submit a PDF of each layer or a combination.
- Title block (name, date, lab group): covered by the existing export
  meta table; a Layers cell is added (see Exports).

## Design

### 1 · Data model (still one key, `prePro.stagePlots`)

Everything new rides inside each plot object, so the merge-splice save,
tombstones, undo (whole-plot JSON frames), refresh guard, and presence all
work untouched.

```
plot = {
  id, label,
  stage: { w_ft, h_ft },
  floor: 'blank' | 'fs4e-123',          // NEW, whitelisted, default 'blank'
  items: [ { id, type, x_ft, y_ft, rot, w_ft, h_ft, label, color,
             layer?, panels? } ],        // layer + panels NEW, optional
  flows: [ { id, from, to, layer, conn } ],  // NEW anchored labeled cables
  userCreated,
}
```

One new session-wide key, `prePro.plotBank` (`{ disabled: [typeKeys] }`),
holds the admin bank curation. It rides the same whole-key sync as the
rest of the paperwork and joins the clone whitelist.

- **Layers are fixed:** `room`, `audio`, `video`, `lighting`.
- **An item's layer defaults to its type's layer** (`layerOf(item) =
  item.layer || typeDef.layer || 'room'`). Legacy plots migrate for free:
  old `speaker` items become audio, `camera` video, `light` lighting,
  furniture stays room. The optional `item.layer` is an override set from
  the inspector (moves gear between assignments, fixes mistakes).
- **Item color `''` (Ink) now resolves to the layer's department color**
  (room stays ink). The manual color chips still win when set. Print
  hexes already exist in `PLOT_ITEM_COLORS`; legacy all-ink plots simply
  colorize by department, which matches the assignment's intent.
- **Flows** are directed edges between item ids on the same plot.
  Normalizer drops flows whose endpoints don't resolve, forbids
  `from === to`, dedupes exact `(from,to,layer)` repeats (same pair on
  different layers is legal: laptop to flypack can carry audio AND
  video). Deleting an item cascades its flows (delete path + normalizer
  backstop).
- **`flow.conn` is the required connector type**, a key into a new
  `PLOT_CONN_TYPES` registry (`xlr`, `bnc`, `dmx5` at launch, each with
  a label and print styling). The normalizer fills a missing or unknown
  value with the layer's default (audio XLR, video BNC, lighting DMX
  5-pin), so "required" holds without ever blocking a save.
- **`item.panels`** exists only for panel-counted types (pipe and
  drape): an integer 1 to 20; width derives from panels times the
  standard panel width instead of a free `w_ft`.
- `normalizeStagePlot` must include `floor` and `flows` so the
  stringify-equality checks in `pbRefreshStagePlot`/`saveStagePlot` stay
  truthful.

### 2 · Layer bar and visibility

- A chip row above the canvas: **Room, Audio, Video, Lighting.** Each
  chip carries an eye toggle (visibility) and clicking the chip body
  makes it the **active layer** (auto-shows it). Active layer only
  governs new flows; new items take their palette group's layer.
- Visibility is **device-local** (localStorage, like the snap toggle),
  never synced, never saved in the plot. Any combination is viewable,
  which is the per-assignment view requirement.
- Hidden layers don't render at all (items and flows), so hit-testing is
  free. Hiding the selected item's layer deselects. All-hidden shows a
  canvas hint.
- Inspector element pane gains a Layer control (segmented, 4 options).

### 3 · Signal flow connectors

- **Draw Flow mode:** toolbar button (and `F` key) arms it. Click source
  item (ring highlight), click destination, arrow lands on the active
  layer, mode stays armed for chaining. Esc or empty-canvas click backs
  out. Crosshair cursor. Touch works because it's click-click, not drag.
- **Rendering:** straight segment between item centers, trimmed at each
  item's unrotated footprint box with a small gap, arrowhead marker at
  the destination, stroked in the layer color (theme token on screen,
  print hex on paper), `vector-effect: non-scaling-stroke`. Flows draw
  under items. Editor adds a fat transparent hit stroke for selection.
- **Connector label:** a small pill at the cable's midpoint reads the
  connector type ("XLR", "BNC", "DMX 5-pin"), colored with the layer.
  Renders on screen and on paper; it is how the assignment's "show
  connects" requirement is met.
- **Bump-over hops:** where two visible cables cross, the
  later-in-array cable draws a small semicircular hop over the other.
  Straight segments make this cheap (pairwise intersection tests, then
  the segment renders as a path with arcs at its crossing points).
  Hops recompute on every render, including hidden-layer changes, and
  apply in print too.
- **Selection:** a flow and an item can't both be selected
  (`plotSelectedFlowId` alongside `plotSelectedItemId`). Flow inspector
  pane: connector type select, layer control, Reverse Direction (the
  out end becomes the in end), Delete. Delete/Backspace keys work. Undo
  frames wrap flow adds/deletes like every other action.

### 4 · Floor templates

- `PLOT_FLOOR_TEMPLATES` registry, same drop-in idiom as
  `PLOT_ELEMENT_TYPES`: `{ id, label, sym (path markup in a normalized
  viewBox), suggested w_ft/h_ft }`. Ships with `blank` (current rect)
  and `fs4e-123` (wall outline traced from the assignment slides:
  chamfered upstage corners, two door swings, the curved house-right
  wall). Owner-supplied final trace drops into `sym` later without
  touching the editor.
- Render: the template path replaces the plain outline; the foot grid
  still fills the stage rect underneath; items still clamp to the stage
  rect (matches the slides, where gear sits inside the walls).
- Inspector Space tab gains a Floor select, **visible to instructors and
  admins only** (same gate as plot add/delete): instructors assign the
  floor plan for their learning space, students work inside it. Picking
  FS4E-123 applies its suggested dimensions (owner to confirm the room's
  real feet; dimensions stay editable through the same gate).

### 5 · Equipment bank

- `PLOT_ELEMENT_TYPES` entries gain `layer`; the palette renders grouped
  under Room / Audio / Video / Lighting headers.
- **Every existing type id stays valid** (legacy plots keep rendering):
  camera and projector and monitor go video, mic and speaker go audio,
  light goes lighting, pipe-drape, table, person, riser, door, label stay
  room. Labels adjust where the lab names differ (mic becomes "Wired Mic
  SM58", speaker becomes "PA Speaker", monitor becomes "Display").
- **New lab-specific types** (placeholder birdseye line art now, owner
  art drops into `sym` per type, same as before), per the owner's bank
  list:
  - Audio: `sound-console` (audio console, Sq6), `stage-box`, `pa-sub`
    (K181), `foldback` (wedge), `mic-wireless` (Wireless SM58),
    `wireless-rx` (receiver), `laptop` (computer source).
  - Video: `flypack` (the case; the video switch and AJA media recorder
    ride in it), `video-switch`, `media-recorder` (AJA), `sdi-hdmi`,
    `projection-screen`.
  - Lighting: `crank-stand`, `source-four`, `fresnel`, `led-par`,
    `parcan`, `dimmer`, `lighting-console` (ColorSource).
- **Admin bank curation:** a Manage Bank control on the palette rail
  (instructors/admins only) lists every registry type grouped by layer
  with on/off toggles, stored in `prePro.plotBank.disabled`. Students
  see only the enabled set; disabling a type never deletes placed items
  of that type, it just leaves the palette.
- **Proportion fix (existing-skeleton bug):** glyphs currently render
  with `preserveAspectRatio="none"` and stretch to their footprint. New
  behavior: gear glyphs keep their aspect (`xMidYMid meet` inside the
  footprint box), and each type's default footprint matches its art's
  aspect so nothing letterboxes on day one.
- **Sizing model:** equipment types resize uniformly (one Size control
  scales the locked-aspect footprint). Only generic room shapes (table,
  riser) keep free Wide/Deep fields. Pipe and drape swaps size fields
  for a **Panels stepper**: the user picks how many panels, width
  derives from the count, and the drape art tiles per panel instead of
  stretching.
- Auto-mint labels keep working ("Source Four 1"); students type unit
  numbers, dimmer addresses, Key/Fill/Back into the label field.

### 6 · Exports (a PDF per layer or any combination)

The submission artifact is a PDF (decision 5), so the export path
centers on the existing PDF pipeline made layer-aware.

- `stagePlotSheetSVG(plot, { print, layers })` filters items and flows by
  a layer set. The editor passes the visible set; print passes whatever
  the export asks for.
- The meta table gains a **Layers** cell ("Audio", "Audio + Video",
  "All layers") so a submitted PDF says what it contains.
- **Preview toolbar gains layer checkboxes** that re-render the sheet.
  The existing Export Stage Plot PDF button honors them and the file
  name carries the selection (`<plot> - Audio.pdf`,
  `<plot> - Audio + Video.pdf`). Toggle, export, submit: that is one
  checkpoint done.
- **Export Layer Set:** one click builds a multi-page landscape PDF:
  Audio page, Video page, Lighting page, combined page (each a full
  sheet with title block). Covers "each layer individually and combined"
  in a single file for print/archive.
- The Planda Bear package export keeps rendering the combined plot (all
  layers). `prepareStagePlotRasters` cache keys grow the layer set next
  to the snapshot fingerprint (the 2x PNG raster stays what it is today:
  an internal step inside the PDF, not a download).

### 7 · Forward compatibility: the patching exercise

The owner plans a later patching exercise for larger equipment built on
this same layout. That is why connector types live in their own registry
(`PLOT_CONN_TYPES`), flows carry out-to-in direction, and nothing in the
cable model is named after the stage plot specifically. The patching
round should be able to reuse items + labeled cables wholesale (likely
adding per-item ports); nothing is built for it now beyond not painting
it into a corner.

### 8 · What deliberately does not change

Merge-splice saves, dirty-id tracking, tombstones, the 650ms shared
debounce, presence, the multi-plot switcher, instructor-only add/delete
of plots, comments, and the modal itself. No new modal means no new
CSS id-list joins in index.html; all new styles are new classes.

## Build phases (each lands verifiable on its own)

1. **Layers foundation** (M): registry layers, `item.layer` override +
   normalizer, layer bar with visibility + active state, grouped palette,
   inspector layer control, layer-aware editor render, layer-default
   item colors.
2. **Signal flow** (L): flows model + connector-type registry +
   normalizer + cascade deletes, draw mode, rendering with arrowheads,
   trimming, midpoint connector pills, bump-over hops, selection + flow
   inspector, undo coverage.
3. **Floor templates** (S): registry, FS4E-123 trace, instructor-gated
   Space-tab picker, render path.
4. **Bank build-out** (M): 19 new types with placeholder art, glyph
   proportion fix + uniform sizing model, pipe and drape panels, Manage
   Bank curation for admins, label and copy updates (modal sub, hub card
   sub, info popover text mention layers and flows).
5. **Exports** (M): layer parameter through print SVG, Layers meta cell,
   preview layer toggles, layer-aware PDF naming, Export Layer Set PDF,
   connector pills and hops on paper, raster cache keying, package
   behavior confirmed.
6. **Release pass** (S): all suites (paper-export contract already pins
   the section), WORKER_SCHEMA bump, `?v=` cache-bust in index.html,
   browser QA via `openLocalPlandaBear`, CHANGELOG entry.

## Known gotchas that apply (from the Phase 8 build)

- A hidden Browser pane starves rAF: front the preview tab before
  building paper previews or they hang at "Building fixed-page preview".
- Paper pagination treats figures as unbreakable; the plot figure cap
  (5.35in) already handles it, multi-page layer-set export reuses the
  same sheet markup per page.
- Safari canvas silently no-ops past ~16.7M px; the existing raster
  back-off and `toDataURL` validation stay in the PNG path.
- QA layout with geometry/screenshots, not timings.

## Owner inputs owed (none block the build)

- Final icon art for the ~19 new gear types, plus the requested updates
  to the existing lighting and mic glyphs (drop into `sym` per type).
- Real FS4E-123 dimensions in feet (build ships with a traced shape and
  estimated dims; both editable).
- The standard pipe-and-drape panel width in feet (build assumes 4 ft
  per panel until corrected; one constant).
- Slide deck color update to the department tokens, whenever convenient.
- Stage plot lesson/guide text (already owed from Phase 11) will need a
  layers rewrite once this ships; out of scope here.
