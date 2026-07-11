# Cueola V2 Plan — draft for discussion

*Drafted 2026-07-11 from a 5-lens planning pass (show-day operator, student collaboration, reliability, playback/integrations, polish/platform) over the current codebase. Updated same day with owner direction: three UX corrections and the Profiles / login-code identity layer (now Phase 3). Predecessor work: the deep bug-fix sweep and Production Notes v2 (mentions, checklists, avatars, question tag, audio→SFX bridge).*

**Constraints honored throughout:** no accounts/pricing/gating for money, **no formal username+password (prohibited by the university)**, vanilla-JS no-build architecture, Apple HIG design language (DESIGN_GUIDELINES.md).

---

## Owner corrections — small, do early (can ride along with any phase)

1. ✅ **Collapse lives on the posts, not the toolbar.** *(Done 2026-07-11.)* Toolbar "Collapse" button and `pbToggleCollapseAll` removed; the per-post chevron is the one collapse affordance — now 30×30 (34×34 on phones) with a visible border + tinted background at rest, no hover needed. `.pb-note-head` right padding widened to clear it. Verified live: post → collapse → gist row → expand, desktop + 375px mobile, zero console errors.
2. ✅ **Front-page notes button goes straight to Production Notes.** *(Done 2026-07-11.)* The shared prepro join modal is now mode-aware (`openPreProJoinModal('notes'|'hub')`): the notes button shows Production Notes copy and a successful join lands directly on the board (offline fallback included); the Planda Bear card/hub path resets to hub copy and still lands in the hub. Bonus fix: `joinPresence()` now runs before the landing opener — it SETs the whole presence entry and used to clobber the `pbPage` announce, so first-land presence never showed a page (both paths). Verified live: notes-mode copy + prefill, direct board landing, note posts sync, presence shows `production-notes`, hub path unregressed, zero console errors. *(Supersedes when Phase 3 ships: the button routes through the username flow instead.)*
   *Learnings for later phases:* PB-modal joins never start the `setupFirestore()` session listener (only `enterRundown` does) — hub/notes-only users get **no live push**; the board self-heals because every note action re-fetches (`loadPlandaBearNotes`) before writing. The Phase 4 per-note migration should add a notes listener for these users. Also: the owner's in-flight `cueola-avatar-profile.js` module (`CueolaAvatarProfile`) is now the avatar model — Phase 3's profile work should build on it.
3. ✅ **Thinner, crisper SF Symbols everywhere.** *(Done 2026-07-11 — Light shipped.)* `import_sf_symbols.py` gained `--weight` (masters used directly; intermediate weights linearly interpolate path coordinates between the point-compatible Ultralight/Regular/Black masters — verified: interpolated Light bar stroke 5.72 matches UL+⅔(R−UL) exactly). Whole set re-extracted at **Light** into `runtime/light-small/`; catalog + `sf-symbols.css` regenerated; hardcoded `regular-small` paths fixed (index.html chip rule, liquid-glass demo, README); `?v=20260711e` on both index.html and dashboard.html. Side-by-side audit at 11/13/16/24px: Light is crisper and fully legible; **Ultralight shimmers/fades at 11–13px — rejected**, as predicted.
   *Learnings that change later items:* **13 catalog symbols are "runtime-only"** (hand-added Regular outlines, no Apple template — includes the collapse chevrons, action.profile, play/stop.fill, timer). The import used to silently drop them on re-import; it now carries their bytes + catalog entries through (`carriedThrough: true`). The 7 solid `.fill` glyphs are weight-invariant so carrying is correct; the 4 simple stroked ones (chevron.down/right, circle, line.3.horizontal) are now rebuilt at the target weight by the new `scripts/synthesize_runtime_symbols.py` (analytic outlines; stroke widths scale by Apple's measured bar-stroke ratios 2.19/7.50/16.60 for UL/R/Black; validated by canvas scanline sampling to ±0.02 units). **`timer` alone remains at Regular** — its stopwatch geometry is too complex to synthesize; export a real template from the SF Symbols app to finish it. Pre-existing, unrelated: 5 semantic names used in index.html have no sf-symbols.css rule (action.export, action.lock, media.forward, media.backward/forward.circle) — flagged as a separate task. Full pipeline for future re-weights: import (--weight) → synthesize_runtime_symbols → build_sf_symbol_css → bump ?v=.

## Phase 1 — Data safety and the deploy gap
*Make the data that already exists safe before adding surface area. Every item startable today.*

1. ✅ **Firestore offline persistence + write-failure semantics audit** (small, high) *(Done 2026-07-11.)*
   Both pages now use `initializeFirestore` + `persistentLocalCache({tabManager: persistentMultipleTabManager()})` with a memory-cache fallback. Semantics audit: the main session listener passes `includeMetadataChanges: true` (without it, an idle reconnect is metadata-only and the RECONNECTING chip never clears) and only claims "connected" on a server snapshot (`!fromCache`); `hasPendingWrites`/queued batches show as saving. `reportCloudWriteFailure` treats `unavailable`/`deadline-exceeded`/`!navigator.onLine` as the quiet reconnecting state — logged once, no error dot, no toast; real failures (rules, invalid data) still toast. Drill hooks `window._disableNetwork()`/`_enableNetwork()` added for console rehearsals. Verified in the preview, all four layers: plain writes queue offline (REST-confirmed invisible on the server) and flush on restore; the rundown-transaction path under an `unavailable` outage produces zero toasts, saving dot, one log line, and the queue drains to the server on restore; a reload boots the show from IndexedDB (first snapshot `fromCache:true` with full data); app + dashboard tabs coexist with zero persistence errors.
   *Learnings:* **`disableNetwork()` does not gate `runTransaction` in SDK 10.12.0** — commits still reach the server while snapshots/plain writes go offline, so the console drill is only faithful for plain writes; the transaction path was verified against a stubbed `unavailable` rejection (the documented real-Wi-Fi-loss behavior), and the owner's physical Wi-Fi drill remains worth one pass. Minor pre-existing quirk: a cached snapshot carrying only your own pending write logs "Cloud sync restored" while still offline (the dot still shows saving, so the operator signal stays truthful). Notes writes stay transaction-only (fail-quiet offline, local copy kept, re-synced on the next online action) — deliberate, since queuing a blind `preProNotes` overwrite would clobber collaborators; the Phase 4 per-note migration resolves this properly. No new collections → firestore.rules untouched (item 2 owns the rules work). Phase 2 item 5's dependency on persistence is now met.

2. ✅ **Verify and stage hardened firestore.rules + wire App Check** (medium, high) *(Done 2026-07-11.)*
   Rules now deny unknown collections, validate session/file/note/profile/access-code paths and bounded shapes, preserve current Cueola/dashboard/Flowmingo/Outrangutan/QLab/Prompt-Up session patterns, keep entitlements read-only, and stage the future `files`, `notes`, `profiles`, and `accessCodes` blocks. Dependency-free `scripts/test-rules.mjs` exercises current and future allow/deny contracts against the real Firestore emulator; all cases pass. App Check in both entry points now has an explicit `APP_CHECK_ENABLED` gate separate from the public reCAPTCHA key, retains localhost debug-token support, and defaults off. `docs/app-check-rollout.md` is the owner deploy/enforcement/rollback runbook; nothing was deployed. Preview verification: front page → instructor dashboard → front page, both App Check-disabled boot messages present, no warning/error console entries.
   *Learnings for later phases:* Firestore Rules cannot iterate the existing admin roster list to type-check every nested admin entry, so `admins/global` can only enforce the top-level `{list}` shape and 200-entry bound until the roster becomes per-document or real auth exists. The staged future collection schemas are intentionally strict but provisional—Phase 1 item 3, Phase 3, and Phase 4 must update their matching rule validators in the same change if their final fields differ. App Check is an abuse perimeter, not identity or authorization; the owner must register every browser/bridge client and observe verified metrics before enforcement. The standalone Firebase CLI shadows `node` inside `emulators:exec`, so the runbook/test invocation should use a normal system Node (or an explicit Node path in constrained environments).

3. **Move note attachments out of the sessions collection + deleteSession cascade** (medium, high)
   `pbfile_*` base64 chunks are sibling docs in `sessions`, so the dashboard downloads every attachment byte just to list sessions, and deleteSession orphans them forever. Move writes to `sessions/{code}/files/{fileId}` with a legacy read fallback; deleteSession batch-deletes the subcollection. Establishes the migration+rules pattern Phases 3–4 reuse.

4. **Dashboard safety: ownership gate, soft-delete with restore window, Mine/All filter** (medium, high)
   Gate delete on super-admin or session owner; soft-delete (`{deletedAt, deletedBy}`) with a 30-day "Recently deleted" restore section; Mine/All filter defaulting standard instructors to Mine. Turns "a student's whole show vanished" into a recoverable event. *Note: client-side honor system until the rules deploy — prevents accidents, not attacks.*

5. **Contract-check lint + auto cache-busting preship script** (small, medium)
   `scripts/check-contracts.mjs`: every `getElementById`/`querySelector` literal and inline onclick handler must resolve — directly targets the b3c1a6a merge failure mode. `scripts/bump-cache.mjs`: content-hash the JS/CSS and rewrite all `?v=` strings in one shot. Prerequisite for the Phase 2 service worker and the Phase 4 notes migration.

## Phase 2 — Show-day armor
*A frozen output announces itself, a fat-fingered delete is undoable, a clobbered session doc is restorable, a reload on dead venue Wi-Fi still boots the show.*

1. **Output-window watchdog heartbeat with auto-recover + preflight row** (small, high)
   Today a crashed output looks alive (`isOutputAlive` only checks `win.closed`; the open-time ping never repeats). ~2s ping interval; two missed beats = red dot + one toast + show-log entry; pong-after-dead auto-heals via the existing `resendActiveToOutput` + keyer re-push. Output emits an unsolicited heartbeat from its rAF loop so a frozen renderer is caught.

2. **Undo/redo for rundown edits (Cmd/Ctrl+Z)** (medium, high)
   `buildRundownBatch` already computes structured diffs against `rundownShadowBeats`; derive the inverse at commit time, push `{forward, inverse, label}` onto a ~50-entry stack, replay through the normal batch pipeline so collaborators converge. Drop stack entries when a remote batch touches the same beat ids. Needs a two-client QA recipe.

3. **Session snapshot history in IndexedDB with one-click restore** (medium, high)
   Throttled compressed copies of the session doc (~1 per 2 min + go-live/leave, cap ~20) using Outrangutan's IDB pattern; a history panel with diff summaries, Restore through the normal save path, and Export. The coarse-grained companion to per-edit undo — the b3c1a6a class of incident becomes recoverable.

4. **Fingerprint-gate the Flowmingo Op panel** (small, high)
   Stop the ~1 Hz full innerHTML rebuilds that stomp focus and mid-drag sliders: fingerprint only rendered fields, patch always-changing bits in place, never rebuild while focus is inside the panel.

5. **Service worker offline shell + PWA manifest** (medium, high)
   Hand-written `sw.js` (no build): precache the explicit shell list, cache-first for same-origin assets, never intercept gstatic/Firestore. Cache name derives from `?v=` so the bump script doubles as SW invalidation. Depends on Phase 1 persistence. *Risk: a bad SW pins users to a stale shell — the update path needs testing as rigorous as the offline path.*

## Phase 3 — Profiles & the login-code identity layer *(owner priority)*
*One identity per person, admin-managed via codes — not passwords. Stops the same student entering sessions under different names, gives admins one place to manage users, and gives every user a personal portal. Explicitly NOT formal auth (university constraint): it's identity consistency + convenience, enforced socially and by rules-shape, not cryptographically.*

### The flows (owner's spec)
- **First visit:** user hits cueola.live, taps the **profile button on the front page** (or taps any app that needs a session). If they have no username yet, they choose "Create profile" → enter the **login code** the admin gave the class → enter **full name** → pick a **username**, **profile image** (reuse the avatar portal: initials / brand animals / upload), and **theme** (changeable later) → enter the **session codes** they've been given.
- **Every visit after:** entering any app asks for their **username** → prompts them to **select which session** from their saved list (new session codes addable inline). No password.
- **Admins:** an **admin code** works the same way — logging in with it registers the profile as an admin, so admins are consistently identified and can attach session codes as they're given. (This aligns with the existing `admins/global` roster + codeHash system in dashboard.html — the admin code becomes a special login code.)
- **The profile portal shows:** assigned position(s) per session, paperwork they need to do, notes they need to see (unseen count), To-Dos/checklist items assigned to them, and other action items. *(This absorbs the "My Tasks view" item — it lives in the portal.)*

### Decision — MADE (owner, 2026-07-11)
- **Ship Option A as the default with B as a per-session admin toggle:** entering an app = type username → pick session from the profile's saved list; admins can flip "require login code on entry" per session for extra friction. Session codes remain the fallback path for guests/one-off crew.
- **Hard requirement: easy backend management.** The admin experience is a first-class deliverable, not an afterthought: one dashboard panel to mint/revoke login codes, see who registered on which code, rename/merge/deactivate users, and bulk-attach sessions to a class roster. Every schema choice below should be judged by "can the owner administer this in one screen".

### Already in place (2026-07-11)
- The **front-page profile button** exists now — `person.crop.circle.fill` icon (owner-supplied), sitting between the Production Notes button and the theme gear. It currently opens the local avatar portal; when this phase ships, the same button becomes the login-code / username entry point.

### Backend sketch (needs rules work — coordinate with Phase 1 item 2)
- `accessCodes/{code}`: `{ role: 'student'|'admin', label: 'Fall 2026 TV Production', active, createdBy, createdAt }` — created/revoked by admins from the dashboard.
- `profiles/{usernameLower}`: `{ username, fullName, role, avatar, theme, sessions: [codes], codeUsed, createdAt, lastSeen }` — doc id = normalized username gives uniqueness for free.
- Rules: profile create requires the referenced access code doc to exist and be active (rules `get()`); writes shape-validated; no self-role-elevation (role copied from the code doc, not client-supplied). Honest limitation: with no auth, a determined user can still read/write more than they should until App Check + rules land — this layer is about *consistency*, not secrecy.
- App integration: join flows (`joinSession`, Planda Bear join, Flowmingo, Outrangutan session) get a username-first path; `session.userName` becomes the profile's fullName/username so presence, notes, mentions, roleAssignments, and seen-by all key off one canonical name. Migrate the local `cueola_profile` avatar into the cloud profile.
- Portal aggregation: position from `roleAssignments`, open items from notes checklists/assignees (cheap after the Phase 4 per-note migration; workable before it), unseen notes from the seen-by data.
- Dashboard: admin UI to mint/revoke login codes, see who registered with which code, and manage a class roster (rename, merge duplicate identities, attach sessions to users in bulk).

### Why this phase sits here
It needs Phase 1's rules/emulator groundwork (new collections must be in the same rules change), and Phase 4's collaboration features all get simpler once identity is canonical (mentions pool, assignees, seen-by, role chips all key off profiles instead of ad-hoc names).

## Phase 4 — Collaboration backbone
*The notes board becomes structurally sound, then socially sticky — now on top of real identities.*

1. **Migrate Production Notes to a per-note Firestore subcollection** (large, high)
   Every like/checkbox tick currently rewrites the whole `preProNotes` array; the board shares the session doc's 1 MiB ceiling. New `sessions/{code}/notes/{noteId}` with per-note writes, likes as arrayUnion, lazy idempotent migration, one-release read-both window. Retires `pbReconcileNotes`. *Risk: mixed-version clients forking the board — land the auto cache-bust script first.*

2. **Assignable checklist items, aggregated in the profile portal** (medium, high)
   Checklist items get owners (picker reuses the mention autocomplete, fed by profiles); open items roll up into each user's portal (Phase 3) and a per-session "who owes what" view for instructors.

3. **Seen-by read tracking on the notes board** (small, medium)
   Per-person read timestamps keyed by profile; "Seen by N" with names on hover; instructors' pinned notes show who *hasn't* seen them. Feeds the portal's "notes you need to see".

4. **Position chips: crew roles on notes, mentions, presence** (small, medium)
   Roles exist in `roleAssignments`; render muted role chips beside authors, in mention rows (disambiguates two Sams), and presence tooltips.

5. **Dashboard live presence strip + read-only rundown peek** (medium, medium)
   Green-dot avatar strip on session cards, live-now count, read-only rundown preview with the current row highlighted. Sequenced after the Phase 1 attachments move makes `loadSessions` cheap.

## Phase 5 — Playout depth and discoverability

1. **QLab cue picker over OSC + preflight verification of every QLab link** (medium, high)
   The bridge gains a receive path (QLab replies over UDP): poll cue lists into the session doc; `qlabCueFields` becomes a picker; preflight verifies agent-online and every rundown `qlabCue` resolves. Land in `bridge.py` (the launched path) and explicitly retire/freeze `agent.js` in the same change.
2. **.ogshow export as a streamed zip** (medium, medium) — raw media blobs instead of base64-in-JSON; fixes the V8 string ceiling that silently breaks big-show exports; legacy JSON import fallback.
3. **Waveform peaks in the Outrangutan trim editors** (medium, medium) — pads from live AudioBuffers, clips via one-time OfflineAudioContext decode cached in IDB.
4. **Web MIDI control surfaces with learn-mode mapping** (medium, medium) — any $30 pad/fader box fires pads/GO/advance through the same action switch as Stream Deck.
5. **Printable show-day pack** (small, medium) — Outrangutan cue sheet + pad map through the existing print pipeline; rundown print gains QLab/Outrangutan columns.
6. **Guide catch-up** (small, medium) — new Outrangutan lesson, Planda Bear lesson rewritten for Notes v2 + profiles, OPERATOR_CARD.md refresh. Deliberately last so it documents everything V2 shipped.

## Cut (with reasons)
- **Rundown row → OBS scene switching** — already reachable by attaching an Outrangutan cue with a per-cue OBS action; new surface for a niche path until someone asks.
- **Show-day crew check-in ritual** — mostly covered by presence strip + seen-by + the profile portal; revisit if instructors still ask.

## Key risks (short list)
1. Firestore persistence changes write-failure semantics — the audit in Phase 1 item 1 *is* the item.
2. Rules/migration ordering — every new collection (files, **profiles, accessCodes**, notes) edits `firestore.rules` + emulator tests in the same commit; the owner deploy runbook keys off it.
3. **Identity layer is not auth** — with open rules and no passwords (university constraint), usernames are spoofable by a determined user until App Check + hardened rules deploy; login codes can leak and need cheap revocation (deactivate the code doc, existing profiles keep working). Present it as consistency + convenience, never as security.
4. **Username collisions & renames** — doc-id-as-username makes uniqueness easy but renames hard; decide early whether rename = new doc + tombstone pointer, and how mentions/assignments follow a rename.
5. Mixed-version clients during the notes migration — cache-bust script first, idempotent backfill, read-both window.
6. Service-worker staleness foot-gun on GitHub Pages — mechanical cache naming + tested update path.
7. Undo/redo vs. concurrent collaborators — inverse batches must ride the alias-resolving pipeline; two-client QA.
8. Two QLab bridges exist (`bridge.py` + `agent.js`) — pick one, retire the other.
9. Thin symbol weights can shimmer at small sizes/low DPI — pick Light vs Ultralight by eye at 11–13px before committing the whole set.
10. No-build rule under pressure (zip writer, SW, MIDI, identity flows) — stay dependency-free.
