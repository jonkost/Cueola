# Planda Bear — Google-Docs-grade collaboration (deep build)

> Owner ask (2026-07-15): "the google like real doc system" — two users in a call
> sheet see each other's work live, everything auto-updates for everyone, no
> lost edits. Autosave + status chip + presence landed earlier; this build
> removes the last-writer-wins clobber at the section/array level.

## Problem

`persistPreProData` diffs at the **top-level `prePro.*` key**. Scalars are fine,
but `safety`, `productionSchedule` (incl. `checklist[]`), `people`,
`callSheets[]`, and `videoPatchRows`/`audioPatchRows`/`commsPatchRows` are each
ONE key — every save rewrites the whole object/array. Two users editing
different fields of the same section race on the array/object blob; the
650ms-debounce + pre-save merge shrinks but does not close the window.

## Design: leaf-granular sync engine

New file **`cueola-prepro-sync.js`** (classic script exposing
`window.CueolaPreProSync`, pure functions, node-testable like
cueola-export-model.js):

1. **Rows become ordered maps.** Arrays (`people`, `checklist`, `*PatchRows`,
   `callSheets`) convert to `{ r_<uid>: {…fields, ord:<float>} }` on write.
   `ord` uses fractional indexing (midpoint between neighbors) so reorders
   touch one row. Readers accept BOTH shapes (legacy array | map) via
   `rowsToList()` — sorted by `ord`, falling back to array order. Nested:
   `callSheets.s_x.people.r_y`.
2. **Leaf diffs → masked Firestore updates.** `diffLeaves(prev, next)` walks
   known section shapes and emits `{ 'prePro.safety.hospital': v, … }` +
   parallel stamps `{ 'prePro._stamps.safety.hospital': ts }`. Keys sanitized
   to `[A-Za-z_][A-Za-z0-9_]*` (pbSeenKey rules); row ids generated safe.
3. **Leaf merge.** `mergeLeaves(local, server, localStamps, serverStamps,
   pendingPaths)` — per-leaf newest-stamp-wins; leaves with in-flight local
   writes (pending paths) keep local; unknown/extra keys pass through.
4. **Deletions = tombstones.** Row delete writes `deleteField()` on the row +
   stamp `{at:ts, del:true}` under `_stamps`. Merge treats a newer tombstone as
   authoritative over a stale concurrent edit (anti-resurrection, same idea as
   the notes `_pbEverInSub` guard). Tombstones GC after 7 days on write.
5. **Back-compat / migration.** Wire may contain legacy arrays + legacy
   `_fieldUpdatedAt` (section-level). Merge treats a legacy section-level stamp
   as the stamp for EVERY leaf under it. First write from an upgraded client
   persists map shape. All clients ship from the same page, so mixed-version
   windows are minutes, not weeks. PDF/print/export consumers keep receiving
   arrays via `rowsToList` accessors — export wire format unchanged.

## Integration points (cueola-app.js)

- `persistPreProData` → engine diff (leaf updates), localStorage keeps the
  merged doc, `syncPreProToFirestore` sends the masked update map it is given
  instead of rebuilding `prePro.<key>` per top-level key.
- `mergePreProFromCloud` → engine merge; `_pbPendingCloudKeys` stores **leaf
  paths** (unchanged Set semantics, finer keys).
- Row widgets (crew grid, checklist, patch rows) keep rendering from arrays via
  `rowsToList`; their collect functions attach stable row ids (generate on
  first collect; DOM rows carry `data-row-id`).
- Save-status chip, presence, autosave listeners: unchanged.

## Test plan (scripts/tests/prepro-sync.test.mjs)

- two writers, different scalar fields, same section → both survive
- two writers, different rows of the same grid → both survive
- same leaf, different stamps → newer wins (either direction)
- row delete vs concurrent stale edit → tombstone wins
- reorder touches only `ord`; concurrent edits to moved row survive
- legacy array + section stamp interop (upgrade path both directions)
- pending-path protection (local in-flight write never reverted)
- sanitizer: hostile keys, id collisions

## Rollout order

1. Engine + node tests (pure, zero UI risk) ✅ when merged
2. Safety Plan (scalar-only section — smallest blast radius)
3. Production Schedule + checklist rows
4. Call Sheet scalars + crew grid + callSheets map + patch rows
5. Two-client browser sim + full test suite + hash/schema bumps

Status: SHIPPED (uncommitted) 2026-07-15. Engine (`cueola-prepro-sync.js`) + 13
contract tests green; spine integrated (`persistPreProData` → leaf diff →
`syncPreProLeavesToFirestore` masked updates; `mergePreProFromCloud` →
`mergeDocs` with leaf-path pending protection + recovery re-push; legacy
fallbacks kept). Row identity: stored arrays carry id/ord; crew grid rows carry
`data-row-id`, checklist + patch rows carry hidden id cells; position adoption
(`pbAdoptRowIdentity`) bridges id-less collector output; call sheets reuse
their existing ids (map keys are sanitized twins, original ids preserved).
Idle-refresh comparisons use `pbRowsRenderEqual` (ignores id/ord, catches
reorders). Browser-verified: same-row different-field concurrent edits both
survive. Same-FIELD simultaneous typing remains last-writer-wins (no OT) —
presence chips make that visible; character-level merge is a possible future
phase.
