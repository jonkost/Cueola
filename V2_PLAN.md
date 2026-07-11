# Cueola V2 Plan — draft for discussion

*Drafted 2026-07-11 from a 5-lens planning pass (show-day operator, student collaboration, reliability, playback/integrations, polish/platform) over the current codebase. Updated same day with owner direction: three UX corrections and the Profiles / login-code identity layer (now Phase 3). Predecessor work: the deep bug-fix sweep and Production Notes v2 (mentions, checklists, avatars, question tag, audio→SFX bridge).*

**Constraints honored throughout:** no accounts/pricing/gating for money, **no formal username+password (prohibited by the university)**, vanilla-JS no-build architecture, Apple HIG design language (DESIGN_GUIDELINES.md).

---

## Owner corrections — small, do early (can ride along with any phase)

1. **Collapse lives on the posts, not the toolbar.** Remove the toolbar "Collapse" button; the per-post chevron (top-right of each note) is the one collapse affordance — make it more prominent so it can't be missed (slightly larger hit area, visible on mobile without hover).
2. **Front-page notes button goes straight to Production Notes.** Today the sessionless path opens the "Open Planda Bear" join modal and lands in the Planda Bear hub. The button must join and land **directly on the notes board**, with the join modal copy saying Production Notes (session code + name → notes, skip the hub entirely). *(Supersedes when Phase 3 ships: the button routes through the username flow instead.)*
3. **Thinner, crisper SF Symbols everywhere.** The runtime symbol set is extracted at Regular weight; regenerate at a lighter weight for a crisper look. Concretely: extend `scripts/import_sf_symbols.py` with a `--weight` option (templates already contain Ultralight→Black rows), re-extract the whole runtime set at **Light** (test Ultralight, but thin strokes can shimmer below ~14px — pick by eye), regenerate catalog + `sf-symbols.css`, and visually audit the worst cases (11–13px toolbar icons, mask rendering on low-DPI).

## Phase 1 — Data safety and the deploy gap
*Make the data that already exists safe before adding surface area. Every item startable today.*

1. **Firestore offline persistence + write-failure semantics audit** (small, high)
   Replace plain `getFirestore(app)` (index.html, dashboard.html) with `initializeFirestore` + `persistentLocalCache` + `persistentMultipleTabManager` (Outrangutan/output/dashboard tabs coexist). Then re-key `reportCloudWriteFailure` and the SYNC RECONNECTING chip off snapshot metadata (`fromCache`/`hasPendingWrites`) — with a persistent cache, offline writes queue instead of rejecting, so today's failure toasts go quiet. Verify with the rehearsal drill: kill Wi-Fi mid-show, advance, reload, restore.

2. **Verify and stage hardened firestore.rules + wire App Check** (medium, high)
   Emulator test script (`scripts/test-rules.mjs`) covering every real access pattern (all three apps + Prompt-Up). App Check (reCAPTCHA v3) init behind a config flag with debug-token support so the preview keeps working. One-page owner runbook — the deploy itself stays with the owner. Must include match blocks for the new subcollections from item 3, Phase 3 (profiles/accessCodes), and Phase 4 (notes) so the hardened deploy doesn't break them.

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
