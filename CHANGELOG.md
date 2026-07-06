# Changelog

## v1.0.0 — Production-readiness build (2026-07-05)

The complete `CUEOLA MASTER PLAN` run (phases 0–8), hardening the app after the
AVT Lab live run. One operator, one machine, keyboard-first, nothing hangs the
live view.

### Phase 0 — Discovery & architecture audit
- `docs/ARCHITECTURE.md`: four surfaces (rundown, Script Op, Outrangutan, Flowmingo),
  show-state model, media pipeline, test inventory, top-5 live-failure risk list.

### Phase 1 — Branding refresh
- New brand SVGs (`assets/Brand/`) everywhere: front page, dashboard sprite,
  favicons (incl. the Outrangutan output window), zero stale artwork.

### Phase 2 — Outrangutan media engine core
- Import-time probe v2: undecodable/damaged files **rejected at import**; duration,
  dimensions, aspect stored; 8 s stall guard.
- Stills first-class (hold-until-advanced or timed); pause → GO resumes from the
  pause point (offset persisted; survives reload).
- Graceful failure: mid-show decode death cuts to **black slate**, toast, cue
  flagged ⚠, show stays advanceable. Cue-ahead preload on the idle deck.
- `scripts/make-test-media.sh` generates the 16:9/4:3/9:16 + stills + SFX +
  broken-file test set.

### Phase 3 — Rundown stability & sync hardening
- The "Questions"-segment blanking fixed: fingerprint-gated snapshot renders
  (key-sorted stableStringify), in-place badge patching, scroll preserved —
  a playout write storm now causes **zero** table rebuilds.
- Versioned updates (ts + seq) drop stale packets; ~1 Hz continuous playout;
  explicit **SYNC RECONNECTING** chip for followers.

### Phase 4 — SFX system
- Rundown playback/audio cells link Outrangutan SFX pads: manual green **SFX**
  button + per-cell auto-fire-on-advance. Same-tab local fast path ≈ 3 ms
  trigger-to-start. Stable pad/bank ids (renames never break links). Followers
  see a transient "SFX · name" chip.

### Phase 5 — Single-operator control
- Central keymap registry drives dispatch **and** the `?` reference. Arrows always
  drive the rundown — including with Script Op open. Space/J/K/L prompter
  transport; G/P/S playout; Shift+S fade; Shift+Esc PANIC.
- `/` jog-wheel scrub across the whole script — local until Enter commits.

### Phase 6 — Control & inspector redesign
- Shared UI kit (cards, segmented controls, steppers, toggles, context pills);
  Outrangutan inspector rebuilt; 3×3 visual theme grids; one global Overlay-size
  stepper; duplicate buttons removed; shared click-outside/Esc dismissal;
  Message Center + Planda Bear polish; <920 px Outrangutan overlap fixed.

### Phase 7 — Production hardening
- **Show preflight**: validates script/talent/cloud, every rundown→playout link,
  the media library (present + decodable + known dimensions), SFX banks, a timed
  cloud write→ack round-trip, and theme assets — with jump-to-row links. Runs on
  Go Live and from Settings ▸ Production.
- **Error containment**: window-level handlers + guards around every live-critical
  render/dispatch path; an exception logs, toasts once, and the show keeps running.
- **Crash recovery** (resume banner): one click rejoins the session, returns to the
  same screen at the same live row with Script Op restored; intentional leaves
  never offer it.
- **Structured show log**: per-session timestamped record of advances, GOs,
  pause/resume offsets, SFX fires, sync drops, and errors; live viewer + .txt export.
- **Branded show files**: `.cueola` / `.ogshow` with named picker types and
  Cmd/Ctrl+S save-in-place (download fallback; legacy `.json` still opens).
- Script Op drawer cleanup: theme controls restored to the 3×3 tile grid;
  full-width control sections.

### Phase 8 — Dress rehearsal & release
- `docs/REHEARSAL_CHECKLIST.md` (scripted AVT-Lab-shaped rehearsal) and
  `docs/OPERATOR_CARD.md` (keymap-derived shortcut card + 10-line go-live list).
- Rehearsal executed end-to-end; punch list closed at zero P0/P1. Fixes landed:
  - Legacy cue migration preserved Outrangutan link fields (`outCueId` etc.).
  - `enterRundown` records its screen — the resume banner can no longer claim a
    stale "live" state.
  - `Outrangutan.preflight()` reads the joined session's show record directly
    from IndexedDB (was: loaded the standalone show and mutated module state).
  - The resume heartbeat is gated on a session screen being up — a deliberate
    leave can no longer resurrect the resume banner.

### Post-rehearsal polish (same release, operator-requested)
- New Planda Bear and Outrangutan brand icons propagated into the inline sprites
  (index + dashboard); favicons pick the new source SVGs up automatically.
- Planda Bear writing pass: page-card descriptions, hub intro, notes-board copy,
  and empty states rewritten in plain language; the tripled "no comments" state
  collapsed to one line; export buttons reduced to a single primary
  ("Export PDF Package") with clear secondaries; "Save Progress"/"Preview"
  removed from the notes board where they had nothing to act on.
- Consistency sweep: dashboard sign-in standardized on "admin code" (was three
  different names), stray emoji replaced with SF Symbols per the design
  guidelines, sessions empty-state copy rewritten.
- Theme pickers unified on the **circle swatches** (the entry-page/Settings
  look) across every surface — Script Op drawer and Flowmingo Op overlay
  included; the rectangle tiles are gone.
- The live **Cue scrubber mirrors its position into the Script Op editor** —
  the operator sees the script fly by while dragging, not just a percentage.
- Script Op panel gained its own **× close** (the topbar toggle can be covered
  when the panel overlaps it); hidden inside the dedicated pop-out window.
- Build rundown: the sticky #/name columns no longer let the scrolled table
  show through — hover/edit dimming moved off the sticky cells onto the drag
  icon itself, and both rundown tables switched from `border-collapse:collapse`
  to `separate` (collapsed borders paint on the table grid, not the cells, so
  scrolling strokes slid straight through the pinned columns).

### Inspector redesign (operator-requested, Keynote-style)
- The Script Op drawer's stacked accordion of bordered boxes is gone: **icon
  tabs** at the top pick one control group (Prompter / Cue & On Air / Clocks &
  Alerts / Formatting) shown as a single flat page — bold text headers,
  hairline separators, controls directly on the panel. Active tab remembered.
- All dead accordion CSS removed; the pattern is codified in
  `DESIGN_GUIDELINES.md` ("The inspector standard") as the template for
  de-boxing the remaining panels.

### Known deferrals (unchanged by this release)
- Hardened Firestore rules exist in-repo but are **not deployed**; App Check and
  admin-code rotation still owed (owner deploys).
- Entitlement gating intentionally off (`GATING_ENABLED=false`).
- PWA manifest / `file_handlers` icon (Tier 3, optional).
- Native Mac engine scope: hardware video outs, pro codecs, key+fill, genlock.
