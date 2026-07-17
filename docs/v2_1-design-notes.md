# Cueola v2.1 — Design Decisions (companion to V2_1_PLAN.md)

Researched 2026-07-16 against the live codebase (15-agent recon + design pass), then adversarially
reviewed (3-lens critique); this revision folds in every accepted finding — notably: group-aware
snapshots and cloning, the session-level vs per-workspace split for paperwork config, admin-gated
snapshot reads from day one, the additive-vs-tightening rules deploy rule, and the stale-client
story for grouped sessions.

Revised again 2026-07-16 evening: added **D9 (Paperwork & Export overhaul)** and **D10 (Platform &
UI tightening)** from owner direction plus a 3-agent recon of the export pipeline, Safari/Chrome
compatibility, and paperwork field standards. The delivery window is Jul 21 – Aug 2; plan phases
were renumbered, so this file refers to phases by descriptive name rather than number.

Each section is a settled architecture decision with its implementation sketch.
File:line references were verified on 2026-07-16 and will drift as work lands — **re-verify before
editing; never copy a line number or a schema number from this note into code without checking the
live file first.**

**This file must never deploy publicly** — it lives in `docs/`, which `firebase.json` hosting.ignore already excludes.

---

## D1. Admin accounts — Firebase Auth (username + password, admins only)

**Decision:** Use Firebase Authentication (Email/Password provider) for admins only, with usernames
mapped to deterministic synthetic emails (`<username>@admins.cueola.app`) so sign-in is literally
username + password. Authorization comes from a new uid-keyed `admins/{uid}` collection
(`{username, name, level}` — level enum is `'super'|'standard'` *pending plan decision 4; add a
third level only if the owner gives 'full' meaning*) that firestore.rules checks via
`isAdmin() = request.auth != null && exists(admins/$(request.auth.uid))`. Students never touch
Auth — codes + profiles stay exactly as shipped (university no-password rule respected structurally).

**Why:** Firebase Auth is the only option that produces `request.auth` in rules — and rules
enforcement is the point. Today `admins/global` is world-writable, the codeHash is a brute-forceable
32-bit non-crypto hash verified client-side, and `OWNER_BOOTSTRAP_HASH` is committed in source.
Any hardened variant of the doc-based scheme is still client-side theater. Auth gives: real
server-verified identity with zero servers to run, rules that can finally gate session delete /
code minting / admin roster writes, free app-wide persistent sessions (Auth SDK IndexedDB
persistence spans index.html, dashboard.html, Outrangutan, Flowmingo — the "always an admin app
wide" requirement for free), and full App Check compatibility. CSP already allows
identitytoolkit/securetoken (firebase.json line 77); the app already imports Firebase 10.12.0
modular from gstatic.

**Password reset:** default is owner-run local script (zero exposure). Note for plan decision 3: the
"self-serve email reset" option is NOT free under synthetic emails — Firebase reset mail can't reach
`@admins.cueola.app`. Choosing it means storing a real email as the Auth account email (sign-in then
maps username → email via the admins/{uid} doc), a deliberate departure to be designed only if picked.

**Key implementation steps:**
1. Console errand (owner, ~5 min): enable Email/Password provider for project `cueola`; turn on email enumeration protection. **Do the App Check registration (register apps, monitor mode ON, no enforcement) in the same console visit** — the security close-out phase then flips enforcement on days of accumulated soak data instead of soaking cold against the deadline.
2. `scripts/bootstrap-admin.mjs` (service-account REST, same pattern as the rules deploy): creates the owner's Auth user + `admins/{uid}` super doc, bypassing rules for first-admin bootstrap. Also `scripts/reset-admin-password.mjs` for lockouts. Both local-only.
3. New `cueola-admin-auth.js` (IIFE, modeled on cueola-identity.js): `usernameToEmail()`, `signIn()`, `onAuthStateChanged → getDoc admins/{uid} → publish adminSession {id: uid, name, level}`, `signOut()`, `changePassword()` (reauthenticate + updatePassword). Loaded in both index.html and dashboard.html bootstraps.
4. dashboard.html — a named-function kill list, NOT a range delete: remove `hashStr` (:1028), `doLoginAdmin` (:1119), `createSuperAdmin` (:1139), `restoreSavedAdminSession` (:1153), `checkFirstTime` (:1265), the `ADMIN_KEY`/`ADMIN_SESSION_KEY` constants (:1020–1021) and their `cueola_admins_v2`/`cueola_admin_sess` localStorage mirrors. **Rewire, don't delete:** `let adminSession` (:1171) stays; the login modal handlers (:1215–1243) become CueolaAdminAuth.signIn call sites; the post-login UI rendering (:1281–1304, hero greeting/badge/name) survives fed by the auth-state callback. KEEP the `adminSession` variable shape so every downstream gate (1312, 1342, 1673, 1689, 2676, 2705, 2831, 3102, 3135) is untouched. Accounts page instructor panel rewires from admins/global list-doc to per-uid docs; Create Instructor mints via a secondary `initializeApp(config,'adminMint')` instance + `createUserWithEmailAndPassword`, then the signed-in super writes `admins/{newUid}`.
5. cueola-app.js: delete the parallel admin system (~2261–2600 incl. OWNER_BOOTSTRAP_HASH '045515f2', OWNER_ADMIN_ID, loginAdmin, ensureOwnerSuperAdmin); replace with a thin adapter setting the existing `adminSession` global from CueolaAdminAuth so the ~15 consumers (2421, 2510, 3407, 4038, 4935, 4956, 7491, 7496, 9020, 12986 script lock, 14011, 19961 entitlements, 20069, 2779 assignmentActor) work unchanged. **The in-app sign-in door must survive:** `openAdminLogin()` (reached from :2510 when `!adminSession`) is rewired to a username+password modal calling CueolaAdminAuth.signIn — without this, script lock, session info, and presence-inspect dead-end on the Live surface with no sign-in path. Note: entitlements accountId (:19961) changes from legacy `adm_*` ids to Firebase uids — inert while GATING_ENABLED=false, but old `accounts/{adm_*}` docs orphan (harmless; document it).
6. Session ownership: `createNewSession()` stamps `ownerUid: adminSession.id`; `canManageSession` matches ownerUid first, legacy createdBy-name fallback for old sessions; super-only owner reassignment becomes a picker over admins docs.
7. firestore.rules: `isAdmin()`/`isSuperAdmin()` helpers; `match admins/{uid}` (read: signed-in; write: super); `accessCodes create/update: isAdmin()` (kills public admin-code minting); `sessions delete: isAdmin()`; freeze legacy `admins/global` to read-only. Student paths untouched. Rollback copy in docs/ per house pattern.
8. Ship sequence is safety-critical and this one is a TIGHTENING deploy (D8 rule 3): hosting (JS with ?v= + WORKER_SCHEMA bumps) first, fleet refreshes, existing instructors get minted accounts with temp passwords, THEN rules tighten via the REST script with a dated rollback copy.
9. Cleanup: remove admins/global after one clean release. Verify: dashboard sign-in carries into index.html/Live/PB without re-login; **from index.html while signed out, trigger script lock and session info → the in-app sign-in modal appears and works, then re-test signed in**; a non-admin client gets permission-denied on session delete + code mint; student joins byte-identical.

**Migration/rollback:** codeHash is not recoverable — every admin gets fresh credentials (that's the
point). Old clients keep honor-system working until the rules deploy, then fail closed on admin
writes only. Rollback: revert JS via ?v=/WORKER_SCHEMA, redeploy rules-rollback copy; admins/global
(kept read-only one release) resumes; Auth accounts + admins/{uid} docs are inert under old rules.

Scope: **L** (3–4 focused days + QA). Open questions: plan decisions 1–4.

---

## D2. Groups inside one session

**Decision:** Optional `groups: [{id:'g1', name:'Group 1'}, …]` list on the session doc (plus a
`groupsLocked` boolean, see step 5), and one subdocument per group at `sessions/{code}/groups/{gid}`
whose shape is exactly today's paperwork fields (`{prePro, preProActivity, updatedAt}`). When a
group is active, the existing legacy sync spine reads/writes the group doc instead of the session
doc — same masked `prePro.<key>` paths, same `_fieldUpdatedAt` newest-wins merge, localStorage
mirror key gains a `__<gid>` suffix. Students pick their group at join (chips in the join modal,
remembered per device) and may re-open the picker to switch until an instructor locks groups;
instructors get a group-switcher dropdown in the Planda Bear hub. **Rundown and Live stay shared**
on the parent doc — paperwork-per-group, show-per-class. Config = one toggle + group names
(requireLoginCode pattern end to end).

**Session-level vs per-workspace (handshake with D6):** `paperworkEnabled` is SESSION-LEVEL — grouped
clients read it from the parent doc even while `preProDocRef()` points at a group doc, and the
dashboard always writes it to the parent. `callSheetTombstones` is PER-WORKSPACE — it lives in
whatever doc holds the callSheets array it filters (the group doc when grouped), resolved through
`preProDocRef()` like the sheets themselves.

**Why:** the only shape satisfying all three hard constraints: (1) leaf-sync is dark so paperwork
saves are whole-key last-writer-wins — five groups in one shared prePro map would clobber each other
constantly; separate docs make cross-group collision structurally impossible; (2) P2607's doc hit
82KB with ONE group (71KB = untrimmed preProActivity) — per-group docs give each group its own 1MB
budget and stop fanning every keystroke to the whole class; (3) the sync spine funnels through
verified choke points (preProKey :13075, syncPreProToFirestore :13289, hydratePreProFromFirestore
:13449), so "point paperwork at a different doc" is a parameterization, not a rewrite. Rejected:
paperwork nested in the session doc (fatal LWW clobber), linked child sessions (recreates the
4–5-session sprawl; genCode yields only 24 codes/month today).

**Key implementation steps:**
1. Rules (ADDITIVE — deploys BEFORE the JS per D8 rule 3): add a `match /groups/{groupId}` block copying the /notes block (:252–256; validate groupId `^[A-Za-z_][A-Za-z0-9_]*$` and `prePro is map`). Also add hygiene type checks to validSessionDocument for `groups` (list) and `groupsLocked` (bool) — **verified 2026-07-16: validSessionDocument has NO field allowlist (if-present type checks only), so unlisted keys already pass; these checks are hygiene, not gates.** REST deploy + rollback copy.
2. Group context: module-level `activeGroupId` with `cueola_group_<code>` persistence (activeCallSheetKey pattern :13079); helpers `sessionGroups()` and `preProDocRef()` (session doc when ungrouped, group subdoc when grouped); suffix preProKey/activeCallSheetKey with `__<gid>` when grouped.
3. Sync spine: swap inline session refs for `preProDocRef()` in syncPreProToFirestore (:13289, incl. preProActivity arrayUnion :13313), syncPreProLeavesToFirestore (:13335 — keeps the dark engine group-compatible), hydratePreProFromFirestore (:13449), and export server reads (:17317/:17322/:17367). First save to a missing group doc = setDoc merge.
4. Inbound: per-group onSnapshot feeding mergePreProFromCloud like the main listener's prePro branch (:4661); main listener's prePro branch skipped while grouped. mergePreProFromCloudLegacy needs zero changes.
5. Join flow + switching: group-picker chips after entrySatisfied passes in joinSession/joinPreProSession; students can re-open the picker from the hub to switch groups **unless `groupsLocked`** (instructor toggle beside the group names); a switch re-stamps `groupId` on the presence entry (joinPresence :4852), swaps activeGroupId, re-hydrates, re-renders. pbRenderPagePresence/pbRenderFieldPresence filter to same group.
6. Instructor surfaces: "Break into groups" toggle + editable name list + lock toggle in dashboard session detail AND in-app settings; group-switcher dropdown in openPaperworkHub (:13919) for instructor/admin → per-group review and per-group export.
7. Export: thread {groupId, groupName} into CueolaExportModel.normalizeOptions/createSnapshot so the group is INSIDE the snapshot fingerprint (else preview-reuse guards :19783–19785 can export the wrong group); stamp group name into package header + callSheetTitle.
8. Hygiene handshake: **verify Phase 1's preProActivity cap and purge-cascade fixes are live** (they land in Phase 1, not here — do not re-implement); extend purgeSessionDocs with `/groups` in this phase.
9. **Stale-client story (the split-brain fix):** when groups are enabled, the parent-doc prePro is stamped with a marker (e.g. `prePro._groupsActive = true`) and kept as a frozen master copy. A CURRENT client with no group selected shows the picker. A STALE cached client (doesn't know about groups) would otherwise see and EDIT the master copy — edits invisible to every grouped client. Mitigations, layered: the WORKER_SCHEMA bump flushes the fleet at next load; and the first grouped save from any current client re-stamps the marker so post-enable master-copy edits are detectably stale (surfaced in the instructor hub as "an out-of-date device edited old paperwork — review"). Two-browser QA MUST include: stale client edits master copy while groups active → no grouped data lost, warning surfaces.
10. Release: ?v= bumps + **increment WORKER_SCHEMA from its current value in sw.js at execution time** (join-modal markup changed) — never copy a schema number from this note.

**Migration/rollback:** purely additive; ungrouped sessions take today's code paths bit-for-bit.
Enabling groups on a session that already has paperwork prompts the instructor once: "Copy current
paperwork into Group 1?" (parent prePro stays as the frozen master copy). **Rollback runbook — not
"instant":** before removing the `groups` field, capture/export each group doc (Session History +
the cloud-snapshots phase cover this), merge the wanted content back into the parent prePro, then
remove the field; clients fall back to the parent doc. Group subdocs are untouched by rollback and
re-enable losslessly only if the master copy wasn't edited meanwhile — hence the runbook order.
Scope: **L** (3–4 days + two-browser QA incl. the split-brain case).

Open questions: plan decisions 5–6 (shared rundown confirm; self-switch default; group-scoped notes
deferred — shared class notes in v1; whether /assignments rows gain a groupId now or per-group
roleAssignments inside each group doc suffice for v1 — recommended: the latter).

---

## D3. Cloud snapshots (restore rework) — group-aware

**Decision:** Client-written `sessions/{code}/snapshots/{snapId}` subcollection mirroring the local
capture funnel: gzip+base64 payloads chunked on the deployed validFileDocument pattern (≤800,000
chars/doc, ≤8 chunks), deterministic content-hash ids (`snap_{sha256(fingerprint)[:16]}`) for
idempotent dedupe, cloud writes from instructor/admin clients only, 20-record prune matching
sessionHistoryPut, and a merged local+cloud History modal that routes EVERY restore through the
single existing restoreSessionSnapshot body — so the P2607 re-stamp and SESSION_RESTORABLE_FIELDS
whitelist can never fork. Local IndexedDB history stays as the per-device offline authority.

**Snapshots are group-aware from day one (collision fix vs D2):** a capture of a grouped session
serializes the session doc PLUS every `/groups/{gid}` subdoc PLUS the per-note subcollection into
one payload; the dedupe fingerprint incorporates each group doc's content (else group-only edits
compute the same fpHash and the trail silently stops advancing exactly when groups are in use);
restore recreates each group doc through the same re-stamp discipline (fresh per-doc
`_fieldUpdatedAt`) that the session doc gets. Size math re-checked for groups: 5 groups × worst-case
~180KB compressed ≈ 0.9MB → still inside the 8-chunk (6.4MB) ceiling with wide margin; typical
grouped snapshots stay one or two chunks.

**Reads are admin-gated from day one (PII fix):** snapshots are the one collection with zero
student-read requirement — capture is instructor-only, restore is admin-gated. Rules:
`allow read, create, delete: if isAdmin()` (D1 lands first). This removes the "anyone with the
session code can read snapshot PII" window entirely; App Check (security close-out phase) becomes
defense-in-depth for this collection, not the sole perimeter.

**Why:** pure-client fits the no-toolchain machine (in-app CompressionStream gzip already exists,
encodeSessionSnapshot :607); content-hash ids make N concurrent identical writes converge to one
doc; sharing restoreSessionSnapshot means cloud restores get the re-stamp + recreate paths for free.
Rejected: Cloud Functions (needs npm toolchain + fires continuously off presence heartbeats),
event-log replay (the app is LWW-with-stamps, not ops; unbounded logs are the proven 1MB hazard),
every-client mirroring (N× writes for no recovery value), embedded history array (instantly fatal
to doc size).

**Deploy order (ADDITIVE rules — D8 rule 3):** the /snapshots rules block deploys BEFORE the JS.
cloudSnapshotPut is deliberately fire-and-forget; shipping JS first would produce silently-failing
cloud captures — the worst possible failure for a safety feature. Verification must confirm a
capture doc actually appears in Firestore, not just that no error is thrown.

**Key implementation steps:**
1. Add fpHash (crypto.subtle SHA-256 → 16 hex chars) over session doc + group docs + notes; add base64 legs to encode/decodeSessionSnapshot with new encoding tags 'gzip-b64'/'json-b64' — decode must accept all four encodings forever.
2. captureSessionSnapshot (:638): serialize session doc + /groups subdocs + per-note subcollection (the notes inclusion is SETTLED — it closes a real under-capture gap in both trails). After local put succeeds, gate the cloud mirror on `(session.role === 'instructor' || Boolean(adminSession)) && session.code` — an instructorOrAdmin-style check like :14011. (Do NOT copy the :687 canRestoreLocal expression — its `rundownSyncBlockedMissing` term fires only during doc-loss emergencies.) Fire-and-forget with console.warn on failure — cloud must never block local capture. Store fpHash only, never the raw fingerprint.
3. cloudSnapshotPut: setDoc `snap_{fpHash}` {kind:'sessionSnapshot', session, createdAt, reason, summary, fpHash, encoding, bytes, chunkCount, data} sliced at PB_FILE_CHUNK_CHARS (:14270), continuation docs `snap_{fpHash}_c{n}` (pbSaveNoteFile pattern :15262–15294). Then prune beyond SESSION_HISTORY_LIMIT=20 (rows + chunk docs).
4. openSessionHistory + modal: merge cloud list with local rows, dedupe by fpHash, origin badges ('This device' / 'Cloud'); Export All covers both.
5. restoreSessionSnapshot (:788): generalize record resolution to fetch base doc + chunks → base64 → Blob → existing decode path, sharing the re-stamp block (:797–807), the restoreMissingSessionDocument recreate path (:4236 and its payload-builder helpers), and the SESSION_RESTORABLE_FIELDS updateDoc (:842–847) verbatim — extended with a per-group-doc equivalent: each captured group doc is written back with its own fresh `_fieldUpdatedAt` stamps. Gate cloud restore by admin/instructor + existing confirm; label restoredBy in the follow-up 'restored' capture.
6. Clear the cached cloud list on session change (:4583–4585).
7. Rules (deploys first): `match /snapshots/{snapId}` — id pattern `^snap_[a-f0-9]{16}(_c[1-7])?$`, shape checks per the files block precedent (:245–249), and `allow read, create, delete: if isAdmin()`. Delete stays allowed (PII retention path — snapshots embed student data and MUST be purgeable).
8. dashboard purgeSessionDocs: add /snapshots to the Delete Forever cascade.

**Verify:** a capture visibly lands in Firestore (not merely no-error); capture-dedupe under two
simultaneous instructor clients; chunked restore of an oversized session; **grouped-session
capture → restore round-trip recovers every group's paperwork with re-stamps winning against a live
stale client**; group-only edit advances the trail (fpHash changes); non-admin client is refused
snapshot reads; Delete Forever wipes cloud snapshots.

**Migration/rollback:** purely additive; old clients ignore the subcollection; rollback = redeploy
prior rules + revert JS; orphaned snapshot docs are inert and purgeable. Retention: 20-cap prune +
Delete Forever cascade + cloud-snapshot wipe in the term-rotation checklist (PII).
Scope: **M** (2–3 days). Open questions: plan decision 7 (capture breadth, time-based expiry).

---

## D4. Stage Plot — drag-and-drop plot diagram (Planda Bear)

> **Status (owner directive 2026-07-16): built LAST in the window, and the phase opens with an
> owner design consult — the owner advises how the plot paperwork should look and behave at that
> point.** Everything below is a technically-verified BASELINE (editor technology, data shape,
> sync strategy, print path), not a locked visual design; the plot-count model, export inclusion,
> assignability, and v1 cutline are all decided at the consult.

**Decision:** "Stage Plot" as a vanilla SVG-element editor page (no library, no canvas): a new
PAPERWORK_ITEMS page whose data is ONE new identifier-safe top-level key `prePro.stagePlots` — an
ARRAY of named plots (min-1), each `{id, items:[{id, type, x_ft, y_ft, rot, scale, w_ft, h_ft,
label, color, z}]}` in feet-based stage coordinates — riding legacy whole-key sync (per-workspace:
in a grouped session it lives in the group doc like all other paperwork) with advisory single-editor
presence ("X is editing this plot") instead of any per-node wire format while leaf-sync is dark.
Glyphs: curated inline-SVG `<symbol>` library (~10 types: camera, mic, light, speaker, monitor,
person, riser/set piece, table, door, text label) in SF-Symbol line style. Print: inline SVG
(vector-crisp) for screen/window.print; pre-rasterized 2x PNG when forExport=true so html2canvas
PDF export stays fast. Registers as a section in D6's numbered-section export builder.

**Paperwork-config handshake:** Stage Plot is a configurable type under D6. Because missing=enabled
would make it sprout in already-configured Intro sessions the moment it ships, the Intro preset
explicitly sets `paperworkEnabled.stage_plot:false` and the shared fieldset gains its checkbox in
this phase (plan decision 10 covers preset membership).

**Why:** SVG gives per-element hit-testing, setPointerCapture drag (mouse+touch in one path), real
text labels, theme-token styling, and vector print — with no redraw loop for a solo maintainer.
Array-on-wire single blob is non-negotiable post-P2607 (map-shaped collections are the incident
mechanism; legacy sync diffs whole top-level keys). Feet-based coordinates + stage outline + grid
snap + scale badge are what make output read as real paperwork. Zoom/pan/selection are device-local
view state, never synced. Rejected: canvas (hand-rolled hit-testing, raster print), per-node sync
now (P2607 failure mode), vendored diagram libs (no npm; 100–300KB sw.js bloat; fights the design
system), subcollection-per-plot (breaks the single-doc export snapshot), pixel freeform (reads as a
sketch, fails the professional bar).

**Key implementation steps:**
1. PLOT_ELEMENT_TYPES with inline-SVG symbols — copy path data from design-system/apple/symbols/runtime/light-small/ where glyphs exist; hand-draw video-camera/fresnel/riser/door in matching ~1.5px-stroke style. normalizeStagePlot()/getStagePlots() boundary functions beside getCallSheets (:17751): array-on-wire, min-1, blank scrub, id minting.
2. #stagePlotModal markup beside patchSheetModal (index.html ~4950): presence strip, plot dropdown + '+ Add Plot' (mirror #pp-call-sheet-select), left palette rail, SVG stage (touch-action:none), right inspector per the DESIGN_GUIDELINES inspector standard. `#pbNavPlot` nav slot mirroring #pbNavPatch.
3. Interactions: Pointer Events + setPointerCapture; 0.5 ft grid snap default-on; stage outline + dimension labels + scale badge; zoom presets + drag-pan; local undo stack (~50); Esc-to-hub parity.
4. Registry wiring — the 8 dispatch points: PAPERWORK_ITEMS entry order 7 (production-notes → 8) (:13011–13019); openPaperworkItem case (:17129); PB_PAGE_LABELS (:13465); PB_SECTION_FOR_ITEM (:13982); pbOpenPageId/currentPaperworkItemId/hidePaperworkEditors/modal lists (:13474/:13842/:13851/:17502/:17519); renderPaperworkNav slotMap (:13878); preview/save cases (:13856/:13866/:17147).
5. Sync: queueStagePlotAutosave → pbNoteLocalEdit + 650ms debounce (:13817) → persistPreProData — zero sync-spine changes; _pbPendingCloudKeys + save chip free. pbRefreshStagePlot in pbRefreshOpenPaperworkFields (:13757): JSON-compare, skip re-render while pointer captured or within the 10s _pbRecentLocalEdits hold. pbSetPresenceField('pp-plot-canvas') on first interaction → advisory chip. Do NOT touch cueola-prepro-sync.js ROW_COLLECTIONS.
6. Print/export: stagePlotPreviewHTML(plot, forExport) letter-landscape sheet with title block (production/venue/date/scale); **register stagePlots as an ordered entry in D6's numbered-section builder — the single source of section numbers for package AND per-item previews** (the pre-D6 "append after Audio & Comms to dodge hard-coded numbering" workaround is obsolete; do not bypass the builder). forExport rasterizes SVG → 2x PNG dataURL inside preparePaperworkExportSnapshot (:17450) so the image rides the fingerprinted snapshot.
7. Tests (getStagePlots round-trip/sanitizer via the firepit node runtime) + two-browser QA (no mid-drag re-render, presence chip, LWW) + ?v= bump + increment WORKER_SCHEMA from its current sw.js value.

**Migration/rollback:** no migration; old clients round-trip the unknown key safely (verified: legacy
diff only writes changed keys, loadPreProData round-trips unknown keys). Restore re-stamps it
generically. Rollback: remove registry entries; orphaned data inert. When leaf-sync re-lights,
stagePlots.items is the safest first ROW_COLLECTIONS pilot. Scope: **L** (~1,000–1,400 lines, 2–4 days).

Open questions: plan decision 8 (multi-plot vs fixed two; export default-in; whether plots enter
plandaBearAssignmentCatalog for student ownership; deferred-list confirm).

---

## D5. "Start Next Episode" — session templates (group-aware)

**Decision:** One-shot **Start Next Episode** button in the dashboard Session Setup modal, backed by
a new shared module `cueola-session-clone.js` (`window.CueolaSessionClone`) that WHITELIST-copies
structure and strips everything else. No saved-template system — the most recent episode IS the
living template.

- **Carries:** beats[] (full rundown skeleton, timings, nested cues, Outrangutan trigger columns — beat ids verified per-doc-scoped), top-level cues[], rundownAliases, customSources, freeMode, startTime, requireLoginCode, `groups` + `groupsLocked` config, `paperworkEnabled`, and a prePro structural whitelist — callSheets (per sheet: id blanked → re-minted, date+weather blanked, venue/times/crew-grid kept), productionSchedule, safety, videoPatchRows, 'audio-commsPatchRows'; active sheet re-spread onto legacy top-level fields with fresh stamps.
- **Grouped sources (collision fix vs D2):** cloning is NOT single-doc for grouped sessions. `buildEpisodeSeed` stays a pure single-doc function; a wrapper `cloneEpisode(sourceCode, opts)` becomes async and, when the source has groups, applies the same CLONE_PREPRO_FIELDS whitelist **to each group subdoc** and writes fresh group docs onto the new session — so each group's living call-sheet/patch structure carries, not the stale pre-group master copy. The legacy top-level re-spread on the new parent doc seeds from the master copy (it's structural anyway). 'Clone a grouped session' is a mandatory verify case.
- **Fresh:** code (genCode retry via create-if-missing transaction), createdAt, createdBy/ownerUid, activeIdx:0, status:'idle', participants:[], clonedFrom:<source>.
- **Stripped:** presence, kicked, movedTo/From, forceCmd, showClock, prompter (full script text — topic-specific), outrangutan live state, preProNotes/Comments/Activity (the 71KB doc-size bomb), roleAssignments + projections + assignmentRevision, _stamps, _pbEverInSub, deletedAt/By, rundownBatch*. Subcollections /notes, /files, /assignments NOT copied (groups is the deliberate exception above). Per-code localStorage caches NOT copied.

**genCode widening (specified precisely — the two copies differ today):** cueola-app.js :3717 uses a
24-letter no-I/O alphabet with random pick; dashboard.html :3297 uses full A–Z with a first-unused
scan and a `Date.now()` numeric fallback. Standardize BOTH on: YY + MM + **two letters from the
24-letter no-I/O alphabet** (576 codes/month), random pick, collisions handled solely by the
create-if-missing transaction retry; **delete** the dashboard's first-unused scan and Date.now()
fallback rather than widening around them.

**Rules:** no rules change REQUIRED — verified 2026-07-16: validSessionDocument has no field
allowlist, so `clonedFrom` passes as-is (like movedFrom does today). D2's rules touch adds the
optional hygiene type checks; if executing the clone before the groups phase for any reason, add
the `clonedFrom` string type check there instead.

**Why:** saved templates need a new collection + rules + CRUD UI and go stale; cloning the latest
episode inherits every mid-season structural improvement automatically. moveSessionToNewCode (:3488)
already proves the copy-strip-recreate recipe but is a *move* (movedTo makes every client abandon the
source) — this is a fork. Whitelist-carry is the P2607 lesson encoded (SESSION_RESTORABLE_FIELDS
precedent). People strip entirely because paperworkIds reference re-minted sheet ids (copied
assignment rows would dangle or fuzzy-match students to the wrong sheet); call-sheet crew rows carry
because they're paper, not identity — edit one host row instead of retyping fifteen.

**Key implementation steps:** new pure module (CLONE_TOP_FIELDS + CLONE_PREPRO_FIELDS hard-coded,
JSON round-trip deep copy, sheet scrub mirroring addAnotherCallSheet :18203 but keeping times,
nextEpisodeName trailing-number increment) + async cloneEpisode wrapper for the multi-doc grouped
case; dashboard button (super/owner-gated, above Danger Zone) → confirm modal prefilled with next
name → genCode candidates through a _runTransaction create-if-missing (pattern :4226) →
modal-created + loadSessions(); 'From {clonedFrom}' lineage chip. Verify: ungrouped clone joins
cleanly with carried structure + blanked dates, notes/assignments empty, prompter blank; grouped
clone carries each group's paperwork structure into fresh group docs; source untouched either way.

**Migration/rollback:** purely additive; clones are ordinary session docs handled by every existing
surface; rollback = remove button, clones remain valid sessions. Scope: **M→L with the grouped path**
(1–2 days + browser QA). Open questions: plan decision 9.

---

## D6. Per-session paperwork config + call-sheet delete

**Decision:** Sparse override map `paperworkEnabled` ({call_sheet:false, …} — underscore keys,
**missing = enabled**) — **SESSION-LEVEL config living on the parent session doc's prePro**, read
from the parent even when a grouped client's `preProDocRef()` points at a group doc, and always
written to the parent (dashboard fieldset + in-app settings). Presets ('Intro course' /
'Full production') are UI-only chips filling one shared fieldset rendered in BOTH the dashboard New
Session modal and Session Setup detail modal — no preset name is ever persisted. Disabled types are
hidden entirely for everyone (hub grid, step nav, deep links, comment sections, assignment pickers,
portal roll-ups, and the exported package via dynamic section numbering threaded through the
snapshot fingerprint). Disabling hides but never deletes — re-enable restores everything.

Call-sheet delete: instructor/admin-gated `deleteCallSheet(index)` beside addAnotherCallSheet —
confirm dialog naming affected assignees, hard **min-1 guard** (never delete the last sheet — avoids
the legacy-field ghost), hard-delete splice PLUS a lightweight `callSheetTombstones`
{sheetId: deletedAtMs} map that getCallSheets/sanitizeCallSheets filter on every read.
**Tombstones are PER-WORKSPACE:** they live in whatever doc holds the callSheets array they filter —
the group doc when grouped — resolved through `preProDocRef()`. This makes deletion **convergent**
under whole-array LWW: a stale client that resurrects a deleted sheet is healed by the next save
from any current client. Role-assignment rows referencing `paperwork_${sheet.id}` stripped at delete
time with a toast naming the students. Session History remains the undo of last resort.

**Why:** identifier-safe sparse keys pass the masked-write regex today AND pbLeafPathSafe if leaf
sync re-lights; missing=enabled means future paperwork types appear by default in old sessions with
zero migration (with the one deliberate exception in D4: Intro preset opts Stage Plot out); explicit
map (not preset name) prevents preset-definition drift across app versions. PAPERWORK_ITEMS (:13011)
is already the single registry feeding hub/pills/nav/labels — one `enabledPaperworkItems()` helper
filters all of them. The export config MUST live inside snapshot.options (fingerprinted) or the
preview-reuse guards (:19783–19785) silently export the wrong section set. In-array tombstones
rejected (fight the P2607 sanitizer); separate map field rides per-field LWW cleanly.
plandaBearAssignmentCatalog stays COMPLETE (only offered pickers filter) so the fuzzy matcher never
reassigns saved labels — disable stays reversible because nothing is rewritten.

**Export renumbering — one builder, ALL paths:** the hard-coded section numbers live in TWO builder
families today: inside preProPackageHTML itself ('5.' :18952, '6.' :18959, '7.' :18964, register '4.'
:18912) AND in the per-item preview/export HTML ('6.' :18863, '7.' :18869, rendered via the
previewPaperworkItem :13856 / savePaperworkItem :13866 family). The ordered [{id, title, render}]
numbered-section builder must become the single source of section numbers for BOTH — otherwise a
single-sheet preview and the package disagree the moment a type is disabled. Verify: disabled type →
preview and package show identical renumbering.

**Key implementation steps:** model helpers beside PAPERWORK_ITEMS (paperworkTypeEnabled reads the
PARENT doc's config in grouped sessions); consume in openPaperworkHub grid (:13934, sequential
numbering), renderPaperworkNav (:13875 'Step N of X'), openPaperworkRelative (:13909),
openPaperworkItem guard (:17129 — deep links/presence opens), comment sections, instructor hub
footnote; extend CueolaExportModel.normalizeOptions (:719) with options.paperwork inside the
fingerprint (:758/:817); the numbered-section builder refactor across both render families;
readiness issues for disabled sections skipped; shared renderPaperworkConfigFieldset in dashboard
modal-new (seed parent prePro at create) + modal-detail (masked parent update), canManageSession-
gated; deleteCallSheet with tombstone convergence at the sanitizer boundary (:17734/:17751), 30-day/
~20-entry tombstone prune, re-creation clears colliding tombstone; **selection hardening**:
activeCallSheetIndex storage (:13079–13090) becomes {id, index} so a remote delete can't silently
swap another sheet into an open form (resolve at clamp sites :13654/:17636/:18248/:19582); dashboard
read-only PB accordion filters both. NO rules change (prePro rides deployed session-update rules).

**Config→groups handoff (mandatory):** the groups phase must re-verify, inside a grouped session:
config visibility (parent-doc read wins), tombstone convergence per group workspace, and the wizard
flow end-to-end. D6 ships in the same phase as D9 (paperwork & export overhaul) — the
numbered-section builder is one shared refactor.

**Migration/rollback:** zero-backfill by construction (absent fields = today's behavior); old clients
show the unfiltered hub (cosmetic) and tombstones converge deletions; rollback = revert JS bundle,
both new fields become inert. Scope: **M** (1–2 days; the risky chunk is the two-family renumbering
refactor, bounded by the fingerprint guards). Open questions: plan decision 10.

---

## D7. Fun avatar icons (supporting design, from avatars recon)

**Decision:** New `{type:'icon', value:'<manifest id>'}` avatar shape backed by a frozen in-repo
manifest of theme-tintable single-color SVG icons, rendered via the proven SF-Symbols
mask+currentColor pipeline (assets/sf-symbols.css, scripts/build_sf_symbol_css.py) — NOT the
72-photo WebP raster track in docs/avatar-library-plan.md (that plan's manifest/ID/fallback
architecture is adopted; its Pillow/licensing asset pipeline is not).

**Key facts from recon:**
- Data side is cheap: normalizeAvatar (cueola-avatar-profile.js) gains one branch; pbAvatarInner/pbAvatarBg (:14789/:14796) gain the icon case; portal grid (:14807–14866) + identity wizard grid (cueola-identity.js :659) render the library. Rules already accept any avatar map — NO rules change.
- Icon id is ~20 bytes on every stamped note/reply (vs 60KB data-URL uploads) — keeps per-note docs small. Never store SVG markup in the avatar value; manifest-lookup-only (no untrusted id → path concatenation).
- pbAvatarBg's hashed 8-color palette doubles as the icon chip background — stable personal color per user.
- Tinted icons must stay legible on all nine themes incl. koala/panda grayscale overrides and against the palette backgrounds — QA across themes.
- Manifest must be exposed as a global readable by BOTH cueola-app.js and cueola-identity.js (identity reads PB_AVATAR_ANIMALS as a bare lexical global — match that load-order pattern).
- Extending avatars to the initials-only surfaces (Live presence bar :4936, rundown badges :13515, PB collab badges :13537) = optional additive presence field; every presence writer must preserve it so heartbeats don't erase it. High-visibility win, second step.
- Mixed-client hazard (top note for the plan): an OLD cached client that opens its portal and saves will normalize the new type away and overwrite the cloud profile avatar back to a legacy shape — ship early in a phase with a WORKER_SCHEMA bump and let the fleet refresh before promoting the feature.
- Contract tests exist and are pure-Node (scripts/tests/avatar-profile.test.mjs) — add icon cases same-day.
- Owner sign-offs needed (plan decision 11): brand-animal fate, launch icon-set size, and the avatar-library-plan section-15 items (custom-upload retention, display scope).

Scope: **M** (icon set authoring is the long pole; 1–2 days code).

---

## D9. Paperwork & Export overhaul (owner directive 2026-07-16, recon-verified same day)

**Goal:** paperwork generation is solid, printed output looks professional and modern (color-coded,
student-friendly — not a spreadsheet wall), exports are de-branded working documents, and the
export experience has progress feedback. Ships in ONE phase together with D6 (per-session config +
call-sheet delete) — the numbered-section builder is one shared refactor.

**How export works today (recon 2026-07-16):** three stages — snapshot read
(preparePaperworkExportSnapshot :17450), HTML template builders (preProPackageHTML :18920,
callSheetPreviewHTML :18277, rundownPreviewTableHTML :17590, safetyPlanHTML :18380,
productionScheduleHTML :18607, patchTableHTML :18847), then **JS fixed-height slicing** (NOT CSS
print flow): buildPaperExportDocument :19250 → paperExportTokens :19012 → renderTokens :19283
appends clones into 8.5×11in `.paper-export-page` grids (index.html:1863) testing overflow per
node, splitting tables row-by-row with recloned theads (:19223). printPaperHTML :19400 =
window.print fallback; exportPaperHTMLAsPDF :19439 rasterizes each page via vendored html2canvas →
jsPDF (one JPEG/page, 15s/page timeout at :19460).

### D9.1 The "52 pages" root cause + fix
Verified: the package renders **one page-broken section per call sheet** (:18923–18928) and the
export path DOES sanitize — but sanitizeCallSheets dedupes only EXACT content-key matches
(callSheetContentKey :17721–17732 includes label, every schedule field, weather line, every person
row). P2607-style NEAR-duplicates (one weather refetch, one crew tweak, custom label) each survive
→ ~40 sheets × ~1.3 pages ≈ 52 pages. No second multiplying loop exists.
Fix, two layers: (1) **strengthen the sanitizer** with near-duplicate collapse (similarity on
people-set + schedule fields; keep contentful-first, newest-stamp wins) so corrupted docs heal on
every save; (2) **export-time sheet picker**: the export options sheet lists call sheets with
checkboxes (all on by default) and a plain warning when N is unusual ("This package includes 38
call sheets"). Layer 2 protects even against future unknown corruption shapes.

### D9.2 Progress UI
The per-page loop (:19456–19469) already knows `index` and `pages.length` — emit determinate
progress ("Rendering page 4 of 12") through a HIG progress sheet, plus an indeterminate "Laying
out pages…" stage during renderTokens (:19283, synchronous and slow for big tables; runs twice on
relayout :19373). Cancel button aborts between pages. Same component feeds showPaperPreview's
existing placeholder (:17524).

### D9.3 De-branding (owner directive: lose session code, system info, Cueola branding, Outrangutan row)
Emit sites, all verified: kicker 'Cueola production paperwork' (:19040); header meta 'Production
{sessionCode} · Exported {ts}' (:19043); source/draft watermark band (:19045–19048); footer
'{name} · {code}' (:19051); register line with session code (:18913); jsPDF metadata (:19449–19455);
'Cueola Rundown' fallback title (:18953); rundown Outrangutan column (:17624/:17627 + summary
:17580). New header standard: **production-title-led** — production name, sheet title, date,
"Page N of M"; footer carries only a small revision stamp ("Rev r{n} · {date}") since revision
integrity still matters for classrooms; no wordmark, no session code, no export timestamps, no
authority bands on the printed body (the fingerprint/authority system stays INTERNAL — it still
gates what gets exported, it just stops printing itself on every page). Outrangutan column removed
from print (stays in-app).

### D9.4 Pagination: flow, never shrink-to-unreadable
Keep the slicing engine, change its degradation ladder: today an oversize block goes 8px font →
plain-text flattening (:19348, :19067) and an oversize row goes 7px → character-level 5–6px
fragments (:19188, :19112), and the final guard THROWS 'could not preserve all content' (:19378).
New ladder: blocks and table rows **flow to the next page at normal size** (the row-splitting
machinery already exists — make it the first resort, not the last), the font floor is 9px, the
character-fragmenting path is deleted, and the throw becomes impossible by construction for
well-formed sections. A call sheet that outgrows its page continues on "Call Sheet (cont.)" with
repeated table headers.

### D9.5 Rundown fit + student-friendly layout
Today: 11 equal fixed-width columns (table-layout:fixed, index.html:1891) on landscape ≈ 0.86in
each — '#'/'Dur' waste width while cue cells wrap hard. Fix: drop the Outrangutan column (→10),
add a `<colgroup>` with proportional widths, merge weak columns, add a **running-total column and
total-runtime footer** (offset math already exists :17594–17607), segment/page numbering, a
READY/TAKE legend, and a **reduced-column preset** (6–7 broadcast-style columns) as the default
with "all columns" as the option. Segments render as colored divider rows (already do — keep).

### D9.6 Times: `--:--` everywhere a time is empty
Forms already show native `--:--` (inputs are type=time, index.html:4802–4805; normalizeTimeValue
:1275). Print: **paperTime (:18266) is the single choke point** — return '--:--' for empty
(passes 'N/A' through). Verify productionScheduleHTML uses the same helper; fix the type mismatch
where prod-schedule 'Doors Open' is type=text (index.html:4934) vs the call sheet's type=time
(:4805) — migrate to type=time with a text-fallback read. Rundown Start column already prints '—'
via clock() (:1313) — leave.

### D9.7 Industry-standard fields (add/alter) + pass-through
Gaps verified against a standard film/TV call sheet. ADD: day-of-days ("Day 2 of 5"); key-contacts
block (Producer / Director / TD / Instructor with phones); **nearest-hospital box on the call
sheet** (address + phone — single-sourced with the Safety Plan's sp-hospital, which today is a
disconnected name-only field); meal TIMES (replace the Yes/No select at index.html:4849 with
optional time fields + note); department column + department-grouped crew grid print (flat
Name/Position/Email/Phone/Call today, :19708); talent split from crew (one combined grid today);
optional next-day preview; revision number on the sheet body. FIX the confusions: 'Late / Lost
Contact' exists twice with no pass-through (pp-late :4808 vs sp-late :4890 seeding from legacy
data — single-source it); 'Stream Information' gets hint text or folds into a broadcast block.
PASS-THROUGH (the app already knows it — stop making students retype): **"Fill from roster"
one-tap on the crew grid** (prePro.roleAssignments has person+position+username, rendered on the
same hub :13955 — yet every crew row is typed by hand today); estimated wrap computed from rundown
total duration; per-person calls default from sheet call time (already works :19730 — keep);
schedule strip on the call sheet fed from productionSchedule. Every field addition is a one-line
removal if the owner dislikes it in practice.

### D9.8 Color-coded, modern, student-friendly
The export path is NOT monochrome — html2canvas rasterizes full CSS color (:19468) and a
per-department color token system already exists scoped to the export page (index.html:1870,
:1899–1905 map cue-video/audio/playback/gfx/lighting/script → colored left borders;
-webkit-print-color-adjust:exact already set). Extend: per-SECTION accent classes on the emitted
sections (call sheet / schedule / safety / patch / register each get an identity color from the
existing token family), tinted section headers + summary chips instead of wall-to-wall grids,
generous whitespace per the HIG reference. **Constraint: html2canvas 1.4.1 cannot parse
oklch/color-mix — export CSS sticks to hex/rgb** like the existing tokens.

### D9.9 Form UX (the editors, not just the print)
Placeholders on every input (verified missing on pp-production, pp-location, pp-address, pp-late,
pp-parking, pp-entrance, pp-stream, pp-dress, all sp-* safety fields; patch placeholders are
meaningless key-echoes via patchInput :18653 — give real examples like "CAM 2 → TX1 · SDI");
Position becomes a datalist fed by the existing position catalog (positionIdFor :2899 — free text
today at :19719); grouped fieldsets with HIG section headers; the D10 component kit styles the
controls. Scope: **L for the whole of D9** (2.5–3 focused days including the D6 work it absorbs).

**Verify (D9):** export a healthy session → professional de-branded package, correct page counts,
progress sheet shows determinate progress; export the 2607T corruption replica → sanitizer
collapses near-dupes and the sheet picker shows an honest count; long call sheet flows to
"(cont.)" page at 9px+ fonts; rundown prints ≤ target width with running totals; empty times print
'--:--'; two-browser QA on the editor changes (they ride the same prePro sync).

---

## D10. Platform & UI tightening — Safari/Chrome, HIG kit, info buttons (owner directive 2026-07-16)

**Context (recon-verified):** the codebase already follows "build for Chromium, degrade gracefully"
(stated at outrangutan.js:24), uses zero userAgent sniffing, and gates every Chromium-only API
behind ad-hoc feature checks. The truly Safari-dead features are all Outrangutan (Web MIDI, WebHID
Stream Deck, Window Management auto-placement) plus OBS-from-https (Safari blocks ws://localhost
from a secure page; Chromium exempts loopback). Effective Safari floor is already ~16.4
(CompressionStream + color-mix + container queries).

### D10.1 Capability helper + Outrangutan Chrome prompt
Add a tiny central `CueolaCaps` object (feature checks only, no UA sniffing) and route the ~10
ad-hoc checks through it. In enterOutrangutan (outrangutan.js:4443–4453), when caps are missing,
show a **one-time dismissible HIG sheet** gated on localStorage `og_chrome_prompt_dismissed`
(pattern precedent :178): "MIDI controllers, Stream Deck, and automatic multi-display placement
need Chrome or Edge; playback, cues, outputs, and show files all work here." Fix the wrong toast
at :2334 (keying works fine on Safari — WebGL1).

### D10.2 Safari optimization (90% of app usage)
Priority order: (1) **`navigator.storage.persist()` at boot in BOTH apps** — called nowhere today,
and Safari's 7-day ITP eviction can silently wipe Outrangutan's entire IndexedDB media library and
Cueola's snapshot history; pair with Add-to-Dock/Home-Screen guidance in the docs phase. (2)
Safari-side **import warning for webm/ogg/opus media** via canPlayType (no check exists — a cue
imports fine then won't decode). (3) Print path: named @page rules (index.html:2096–2109) are
unsupported in Safari, so window.print loses forced letter/landscape — make the **PDF export the
labeled Safari path** and keep print as secondary. (4) Adopt Outrangutan's popup-blocked null-check
(:1039) in the script-operator (:10086) and Flowmingo talent (:10292) window.open sites, with
"allow pop-ups for this site" guidance. (5) Add the missing -webkit-backdrop-filter twin at
index.html:244; sweep for others. (6) Note output-window autoplay policy (command-driven play
without local gesture can be refused un-muted) — mute-first fallback + tap-to-unmute affordance.

### D10.3 File icons & PWA reality (.cueola / .ogshow)
Honest constraints, stated once: **macOS Finder document icons are not controllable from the web
on any browser**, and manifest `file_handlers` works only in installed Chromium PWAs. What ships
in 2.1: (a) proper **PNG icon set + apple-touch-icon** (today the manifest has one SVG icon Safari
ignores — the installed icon on iPad/mac is a page screenshot); (b) manifest `file_handlers` for
.cueola (Cueola icon) and .ogshow (Outrangutan icon) + a launchQueue consumer wired to the
existing import functions — installed-Chrome users get real double-click-to-open with branded
icons; (c) Safari/Finder-wide document icons go to the 3.0 parking lot as "native wrapper" work.

### D10.4 HIG component kit + info buttons
References (not hard rules): [docs/design/2.1_design_reference.md](design/2.1_design_reference.md)
and [docs/design/hig-component-kit.md](design/hig-component-kit.md) — **keep Cueola's existing
color themes**; adopt the kit's component patterns: capsule primary buttons, 44px minimum targets,
8px grid spacing tokens, sheet/alert anatomy (grabber, Done/Cancel placement, ≤3 alert actions with
verb labels), grouped-list styling, standard easing/duration tokens, prefers-reduced-motion.
Apply continuously from the paperwork phase onward; one dedicated sweep pass near the end covers
buttons/sliders/selects app-wide. **Info (ⓘ) buttons** (HIG list-item info pattern, 22px circle,
opens a popover/sheet — never navigation) on: export options ("what's in the package, what
'verified' means"), .cueola/.ogshow save/load ("what the file contains, where it opens"),
Session History restore ("what restore replaces, how re-stamping wins"), and the join surfaces.
Copy is short plain language with "Learn more" deep-linking into the matching Learning Hub lesson
(single source of truth). **DESIGN_GUIDELINES.md gets updated** to fold in the kit tokens/patterns
and an explicit "steer toward a mac/iPad app feel" section — grep-verify every rule against the
live repo before writing it (Phase-1 lesson).

Scope: D10.1–.3 ≈ 1 day; D10.4 is continuous + a 1-day sweep. **Verify:** Outrangutan prompt shows
once on Safari and never on Chrome; storage.persist() confirmed granted/denied in both browsers'
consoles; PDF export from Safari on iPad produces correct letter-size output; installed-PWA
double-click of a .cueola file opens the importer (Chrome); info popovers read correctly in both
themes; kit-styled controls pass 44px target + contrast checks.

---

## D8. Standing engineering rules for all 2.1 work (P2607 lessons, encoded)

1. **Never change the wire shape of a field deployed clients consume.** New capability = new field/new doc, old shape keeps working. Map-shaped collections where arrays are expected was the incident mechanism.
2. **Whitelist-carry, never blacklist-strip** when copying/restoring session state (SESSION_RESTORABLE_FIELDS precedent).
3. **Rules deploy order depends on direction.** ADDITIVE rules (new collections/fields being whitelisted — e.g. /groups, /snapshots) deploy BEFORE the JS that writes them, or fire-and-forget writes fail silently. TIGHTENING rules (removing access — e.g. admin gating) deploy only AFTER hosting has shipped and the fleet has refreshed. Both directions keep a dated rollback copy in docs/ and deploy via the REST script.
4. **Every restore path re-stamps** `_fieldUpdatedAt` to now — per document restored, including group subdocs — and any future sync engine must honor that contract or restores get silently reverted.
5. **Two-browser QA** (cueola_client_id override for same-browser two-operator) for anything touching sync, presence, or paperwork; always simulate the stale second client.
6. **preProActivity and any append log gets a cap.** Unbounded logs are the #1 path to the 1MB doc limit.
7. **Doc-size budget check** before adding session-doc fields; heavyweight/multi-writer data goes in subcollections.
8. **WORKER_SCHEMA discipline:** page-HTML-only changes need a schema bump; JS changes need ?v= bumps in index.html (and sw.js precache list). **Never copy a schema number from a design note or plan — read the current value from sw.js at execution time and increment it.**
9. **No student PII in the repo or the web root, ever.** Recovery tooling and recovery data stay local-only, outside deployable directories.
10. **User commits; Claude prepares.** Every completed work item hands over a ready-to-paste GitHub commit title + description. No commits or pushes unless explicitly asked.
