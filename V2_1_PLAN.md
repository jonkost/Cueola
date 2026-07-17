# Cueola v2.1 — Master Plan

**Written:** 2026-07-16, adversarially reviewed same day · **Revised 2026-07-16 (evening):** owner set the delivery window and added the paperwork/export overhaul + platform/UI scope.
**Execution window:** Tuesday **July 21** → Sunday **August 2, 2026** (hard deadline, full completion). Show days before the window: Friday July 17 and Monday July 20 — no planned code changes until the window opens.
**Goal:** v2.1 ships rock solid and 100% professional, needing only basic fixes until 3.0.
**Companion:** [docs/v2_1-design-notes.md](docs/v2_1-design-notes.md) — architecture decisions **D1–D10** with file:line implementation sketches (D8 = standing engineering rules). Read the design note before starting its phase. Never copy a line number or WORKER_SCHEMA value from a note into code — re-verify against the live file.
**UI references:** [docs/design/2.1_design_reference.md](docs/design/2.1_design_reference.md) + [docs/design/hig-component-kit.md](docs/design/hig-component-kit.md) — references, not hard rules; Cueola's color themes stay.

---

## The pace, stated honestly

The original plan estimated this scope at 6–8 weeks; the window is **13 days**. That works only
because Claude does the heavy coding in long daily sessions (including both weekends) while the
owner reviews, decides, and commits. The calendar below is the realistic center line, phases will
share days, and the **cut order in decision 15** is the pressure valve — it protects the
paperwork/export overhaul and groups (the classroom-critical items) and slips Stage Plot first.
Training-video *recording* is an owner errand that may trail past Aug 2; everything else lands in
the window.

## Build dark, release deliberately

The entire window is built **without touching the live product**. cueola.live changes only on a
deliberate publish, so:

- **All work lands on a `v2.1` branch** (owner sign-off pending — decision 16). Claude prepares
  commits per work item as usual; the owner commits to the branch and pushes it. A branch push
  publishes nothing (Pages serves main) but gives offsite backup — 13 days of work never sits
  uncommitted on one machine. **main stays frozen as the known-good show build** until release.
- **Shared-infrastructure touches before release are limited to provably inert ones:** console
  toggles (Email/Password provider — no live client has auth code; App Check monitor mode —
  enforces nothing), bootstrap `admins/{uid}` docs (invisible under current rules + current JS).
  Production Firestore **rules do not move until release day** — all rules work is developed and
  tested against the emulator (rules PUT). QA against live Firestore uses throwaway session codes
  (the 2607T pattern); there is no staging project.
- **Release day (Phase 12) is one deliberate sequence:** additive rules blocks (/groups,
  /snapshots, admins) → merge `v2.1` → main + push → ?v= / WORKER_SCHEMA levers roll the fleet →
  tightening rules last (admin gating, scoped lists), each with dated rollback copies in docs/.
  Rollback: revert main, redeploy the rollback rules — main never stopped being a working product.
- Phases whose D-notes describe mid-window prod deploys (e.g. D1's "hosting first, then rules")
  execute that ordering **within the release-day sequence** instead; the emulator stands in for
  prod during the build.

**Decision 16 — confirm the `v2.1` branch workflow** (a deliberate exception to the usual
straight-to-main habit, for this window only).

## How this plan works

- **One phase per work session (or few).** Each phase lists goal, dependencies, work, verification. Don't reorder without checking the "depends on" line.
- **Rebuild, not patch.** Show-day observations (Jul 17 / Jul 20) go into the Phase 0 intake table and get rebuilt inside the phase that owns that area — the paperwork/export overhaul (Phase 3) is expected to absorb most of them.
- **Standing engineering rules** are design note **D8** and apply to every phase (wire-shape freezes, whitelist-carry, additive-vs-tightening rules deploys, restore re-stamping per document, two-browser QA with a stale client, doc-size budgets, WORKER_SCHEMA discipline, no PII in repo or web root).
- **Commits:** the owner commits; Claude prepares. Every completed work item ends with a ready-to-paste GitHub commit block — **Title:** `v2.1 <area>: <summary>` (≤72 chars); **Description:** what changed · why · how verified · rollback lever.
- **Definition of done, per phase:** browser-verified in the preview (screenshots for visual work), **verified in Safari AND Chrome** (new this revision — Safari is ~90% of real usage), two-browser collab QA wherever sync/presence/paperwork is touched, contract tests green, HIG-kit compliance for any UI, docs updated in Phase 11, prepared commit text delivered.

---

## Decisions needed from you

Several earlier decisions are now settled by your 2026-07-16 direction: the deadline is Aug 2
(supersedes decision 0's scheduling role), **decision 13 is resolved — the leaf-sync re-light is
formally deferred to 3.0** (no time for a safe soak), and the de-branding / `--:--` / Chrome-prompt
/ info-button / industry-fields items are **directives, not questions** — they're specced in D9/D10.
Still useful: the actual term start date (App Check enforcement and class-key rotation want to sit
right before it).

Answer the rest as their phase approaches. Recommendations are marked.

**Admin accounts (D1) — blocks Phase 2**
1. Console errand: can you flip on the **Email/Password sign-in provider** for project `cueola`, and in the same visit **register App Check in monitor mode**? Everything else is scriptable.
2. Confirm the university rule prohibits passwords **for students** — instructor/staff accounts with passwords are permitted.
3. Password reset for admins: "owner runs a local reset script" (recommended — zero exposure), or self-serve email reset — which requires storing a **real email** on the Auth account (synthetic addresses can't receive reset mail; see D1).
4. The 'full' admin level gates nothing — **drop it** (recommended) or give it meaning?

**Groups (D2) — blocks Phase 6**
5. Confirm: rundown/Live stays **shared per class** — per-group rundowns are out of scope for 2.1. (Recommended: yes.)
6. Group mechanics: students self-switch until an instructor locks (recommended — built into the design); shared class-wide production notes for v1 (recommended); per-group crew lists live inside group paperwork rather than adding groupId to canonical assignments (recommended for v1).

**Cloud snapshots (D3) — blocks Phase 7**
7. Snapshot reads/writes are **admin-gated in rules from day one** (no PII window on the new collection). Remaining calls: instructor/admin-only capture (recommended) or every device? Time-based expiry (~30 days) on top of the 20-cap + Delete Forever + term rotation (recommended: yes)?

**Stage Plot (D4) — answered at the Phase 8 design consult (owner directive: plot paperwork is built last, owner advises its look/behavior then)**
8. Deferred to the phase-start consult: plot count model, export inclusion, student assignability, and the v1 cutline. D4's technical baseline (SVG editor, sync, print path) holds regardless of the visual direction chosen.

**Start Next Episode (D5) — blocks Phase 6**
9. Defaults to confirm: call/show/wrap **times carry** (only date + weather blank); **cues carry**; **crew grid carries**; naming auto-increments ("Ep 12" → "Ep 13"); a **grouped** source carries each group's paperwork structure into fresh group docs (recommended). Crew/assignments carry-over deferred to a later opt-in.

**Paperwork config (D6, ships inside Phase 3) — blocks Phase 3**
10. Preset contents: **Intro course** = Call Sheet + Safety + Rendered Rundown (schedule + patch sheets off, **Stage Plot off** once it exists); **Full production** = everything. Production Notes exempt from the config (recommended). Config editing dashboard-side only (recommended). Call-sheet delete gate: any instructor/admin in the session (recommended) or dashboard-owners only? Disabled types with existing student assignments: hide-but-retain (recommended) or strip?

**Avatars (D7) — blocks Phase 5**
11. Brand animals stay alongside the icon set (recommended: yes)? Launch set size (recommended: ~24)? Close out: custom photo-upload retention, and avatars beyond PB notes (presence bar / rundown badges — recommended: yes, as the Phase 5 stretch).

**Identity scope — blocks Phase 5**
12. How far does "users must create their profile" go? (a) **recommended** — required by default everywhere (new sessions default to class-key entry, every door routes key-holders through the sign-up wizard), with the per-session toggle surviving for deliberate guest sessions; or (b) mandatory app-wide, toggle removed. Either way a class key never grants anonymous entry.

**Leaf-granular sync**
13. **Resolved 2026-07-16: deferred to 3.0.** The gate stays dark; PB_COLLAB_PLAN.md records the state; nothing in 2.1 depends on it.

**Training material (Phase 11)**
14. Where do training videos live — unlisted YouTube links inside lessons (recommended), school LMS, or self-hosted? Lessons and the Quick Start get "Watch the video" slots either way; recording may trail past Aug 2.

**Contingency**
15. Cut order under deadline pressure (confirm): Stage Plot (Phase 8) slips first, to a post-2.1 point release → Phase 5's presence-avatar stretch drops → groups (Phase 6) slips ONLY to the following between-terms window, never mid-term (if it slips, Phase 10 still lands the inert /groups rules block and docs mark groups "coming soon"). **Never cut:** Phases 1, 2, 3 (paperwork/export), 4, 10, 11, 12 — they are the "rock solid + professional + teachable" promise. The paperwork/export overhaul is explicitly not cuttable.

---

## Phase 0 — Show-week intake (Friday July 17 & Monday July 20 · no planned code changes)

Run both shows on the current build. Log every friction point, bug, or "I wish it did X" —
during or right after the show, one line each. Your export experience ("52 pages", truncation,
branding) is already captured in D9 — add anything new you hit.

**Exception:** a show-blocking defect found July 17 may get a minimal hotfix before July 20 — still
logged below, still properly rebuilt in its owning phase.

**Triage session — Monday July 20 evening or Tuesday July 21 morning, before Phase 1:** every row
gets an owning phase, severity, size. Anything too large for its phase forces the decision-15 cut
order — there is no slack buffer at this pace.

| # | Show date | What happened / what was clunky | Area | Severity | Size | Triaged into |
|---|-----------|--------------------------------|------|----------|------|--------------|
| 1 |           |                                |      |          |      |              |
| 2 |           |                                |      |          |      |              |

---

## Phase 1 — Foundations: repo hygiene, naming, hosting privacy — **Tue Jul 21**

**Depends on:** Phase 0 closed. **Size:** 1 day.

1. **PII/private artifacts out of the deployable web root (first job of the window):** move `P2607-prepro-backup-2026-07-15.json`, `p2607-snapshot-restore.json`, `restore-p2607.html` to the local-only recovery folder + belt-and-suspenders hosting.ignore globs (`*p2607*`, `P2607*`); review `test-media/`. (Verified 2026-07-16: all three 404 on cueola.live today — this closes the *future* Firebase-Hosting deploy risk.) Add internal docs to hosting.ignore: `CHANGELOG.md`, `CUEOLA MASTER PLAN.md`, `PB_COLLAB_PLAN.md`, `PROGRESS.md`, `V2_PLAN.md`.
2. **Vendor the cdnjs libraries** (pdf.js — consolidate its two pinned versions — mammoth, jszip) same-origin; add to sw.js precache; drop cdnjs from CSP.
3. **`docs/NAMING.md`** + the safe sweep (grep-verify every rule first — identifiers are `outrangutan`/`og`): localStorage `cueola_*` standard with read-old/write-new shims for `promptypus_*`/stray `og_*`; window-global conventions + dedupe (`cueolaPlatform` vs `CUEOLA_PLATFORM`, dashboard's double `initialsOf`); CSS prefix contract documented, renames opportunistic only.
4. **Session-doc hygiene:** preProActivity cap (~200) in both writers; purge-cascade gaps (/notes, /assignments; /snapshots + /groups join later). Later phases only verify this.

**Verify:** deploy-preview diff clean; app loads zero-console-error in Safari + Chrome; import works from vendored copies; legacy-key migration proven.
**Prepared commits:** one per item.

---

## Phase 2 — Admin accounts: username + password, app-wide (design D1) — **Wed Jul 22 – Thu Jul 23**

**Depends on:** Phase 1; decisions 1–4. **Size:** 2 days.

Console errand (Email/Password + App Check monitor registration, one visit) → bootstrap + reset scripts (local-only) → shared `cueola-admin-auth.js` → dashboard login rewired (named-function kill list; `adminSession` shape and post-login UI survive) → cueola-app.js parallel admin system deleted (incl. `OWNER_BOOTSTRAP_HASH`), **in-app `openAdminLogin()` rewired** so Live-surface admin actions never dead-end → `ownerUid` stamping → rules: `isAdmin()`/`isSuperAdmin()`, gated code minting + session delete, `admins/global` frozen read-only.

**Ship sequence (tightening — D8 rule 3):** hosting first → fleet refresh → instructors minted with temp passwords → THEN rules tighten (REST script + dated rollback copy).

**Verify:** dashboard sign-in carries across every surface without re-login; signed-out index.html admin actions raise the new sign-in modal; non-admin denied on session delete/code mint; student joins byte-identical.
**Prepared commits:** `v2.1 admin-auth: Firebase Auth admin accounts (module + dashboard)` · `v2.1 admin-auth: retire legacy admin system in app` · `v2.1 rules: admin-gated writes + admins/{uid}`.

---

## Phase 3 — Paperwork & Export overhaul (designs D9 + D6) — **Thu Jul 23 – Sun Jul 26**

**The owner-priority phase.** Solid generation, professional de-branded output, modern
student-friendly look, and the per-session paperwork config + call-sheet delete that share the same
refactor. **Depends on:** Phase 1 (vendored pdf libs); decision 10. **Size:** ~3 days.

1. **"52 pages" root-cause fix (D9.1):** near-duplicate call-sheet collapse in the sanitizer (heals corrupted docs on every save) + an export-time **sheet picker** with honest counts — corruption can never again silently print 52 pages.
2. **Numbered-section export builder (D6):** one ordered builder = the single source of section numbers for the package AND per-item previews; per-session paperwork config ('Intro course' / 'Full production' presets, session-level map, hidden everywhere when disabled); **call-sheet delete** with per-workspace tombstones, min-1 guard, selection hardening.
3. **De-branding (D9.3):** production-title-led headers ("Page N of M"), small revision-stamp footer only — no Cueola wordmark, session code, export timestamps, watermark bands, or jsPDF branding metadata; **Outrangutan column removed from print**.
4. **Pagination that flows (D9.4):** sections continue onto "(cont.)" pages with repeated headers; 9px font floor; the shrink-to-5px character-fragmenting path and the "could not preserve content" abort are deleted.
5. **Rundown fit (D9.5):** 10 → proportional columns with `<colgroup>`, reduced-column broadcast preset as default, running-total column + total-runtime footer, READY/TAKE legend, segment numbering.
6. **`--:--` times (D9.6):** paperTime choke point renders `--:--` for every empty time on print (forms already show it natively); prod-schedule "Doors Open" text→time input fix.
7. **Industry fields + pass-through (D9.7):** day-of-days, key-contacts block, hospital box on the call sheet (single-sourced with Safety Plan), meal times, department-grouped crew grid, talent/crew split; **"Fill from roster" one-tap** on the crew grid; wrap estimate from rundown duration; late/lost-contact single-sourced.
8. **Color + modern layout (D9.8):** per-section accent identities from the existing dept-token family, tinted headers, chips over grid walls (hex/rgb only — html2canvas constraint); **export progress sheet (D9.2):** determinate "Rendering page 4 of 12" + layout stage + cancel.
9. **Form UX (D9.9):** real placeholders everywhere, position datalist from the catalog, grouped HIG fieldsets — first application of the D10 component kit.

**Verify:** per D9's verify list — healthy export, 2607T corruption-replica export, flow-not-truncate, Safari (PDF path) + Chrome, two-browser editor QA.
**Prepared commits:** `v2.1 export: de-branded package, flowing pagination, progress UI` · `v2.1 paperwork: industry call sheet fields + roster fill` · `v2.1 paperwork: per-session selection + presets` · `v2.1 paperwork: call sheet delete with convergent tombstones` · `v2.1 export: near-duplicate sheet collapse + sheet picker`.

---

## Phase 4 — Dashboard redesign for instructors — **Sun Jul 26 – Mon Jul 27**

**Depends on:** Phase 2. **Size:** 1.5–2 days. As previously specced, now styled with the D10 kit:
one vocabulary (**sign-in / class key / show code**) with glossary tooltips; session creation as a
wizard (entry requirement surfaced; paperwork step filled by Phase 3's fieldset; groups step ships
hidden until Phase 6); the 1080px Session Setup modal split into instructor tasks; plain-language
status copy replacing engineering jargon; real modals over prompt()/confirm(); term grouping of
session cards; accounts page in top-level nav; the known seams fixed (draft-discarding re-hydration,
two-phase-save honesty, ownership by uid).

**Verify:** fresh-instructor walkthrough with zero jargon encounters; screenshots; Safari + Chrome; assignments-transaction + purge regression.

---

## Phase 5 — Student identity: profiles required + fun avatars (design D7) — **Mon Jul 27 – Tue Jul 28**

**Depends on:** Phase 2; decisions 11–12. **Size:** 1.5 days.
Profiles required per decision 12 (class-key fallback always routes through the sign-up wizard);
**side entrances closed** via one shared entry-gate helper (Outrangutan join, `#flowop`,
`#flowmingo`, script-operator `?code=`, dashboard auto-join) — each show-critical door gets its own
two-browser verification. **Icon avatars:** `{type:'icon'}` + frozen manifest + theme-tinted
SF-style masks; portal + wizard grids; ship early with a WORKER_SCHEMA bump (mixed-fleet hazard in
D7). Stretch (first to drop): avatars on presence surfaces.

**Verify:** every door gated + key-fallback-to-wizard; icons legible across all nine themes; contract tests green; old-client simulation.

---

## Phase 6 — Groups + Start Next Episode (designs D2 + D5) — **Tue Jul 28 – Wed Jul 29**

**Depends on:** Phases 2–4 (admin gating + wizard slots); Phase 3's config handshake; decisions 5–6, 9. **Size:** 2 days.
**Groups:** one term session, 4–5 group workspaces (per-group subdocs), shared rundown/Live; picker
chips at join (self-switch until locked); instructor group switcher + per-group export; the
**additive /groups rules block deploys BEFORE the JS** (D8 rule 3). Re-verify Phase 3's config
visibility + tombstones inside a grouped session; split-brain stale-client QA (D2 step 9).
**Start Next Episode:** whitelist-carry clone incl. groups + paperworkEnabled config, group-aware
(fresh group docs from each group's structure); genCode standardized on the 24-letter two-letter
format (576 codes/month) in both copies.

**Verify:** group isolation under simultaneous typing; split-brain case; per-group export headers; grouped + ungrouped clone with source untouched; wizard walkthrough re-run.
**Prepared commits:** `v2.1 groups: per-group workspaces in one session` · `v2.1 sessions: Start Next Episode cloning`.

---

## Phase 7 — Cloud snapshots (design D3) — **Thu Jul 30**

**Depends on:** Phase 2 (isAdmin rules) + Phase 6 (group-aware capture). **Size:** 1 day.
Group-aware, content-hash-deduped, gzip-chunked `/snapshots` subcollection (admin-gated read/create/
delete from day one); merged local+cloud History modal; single shared restore body with per-group
re-stamps; purge cascade + retention. **Additive rules deploy BEFORE JS**; verification confirms a
capture doc actually appears (fire-and-forget writes fail silently otherwise).

**Verify:** grouped round-trip restore beats a live stale client; dedupe; chunked restore; non-admin refused; Delete Forever wipes.
**Prepared commit:** `v2.1 restore: cloud snapshot trail + merged history`.

---

## Phase 8 — Stage Plot (design D4) — **built LAST: Sat Aug 1 – Sun Aug 2** *(owner directive 2026-07-16)*

**The plot paperwork is deliberately the final build item, and the phase OPENS with an owner design
consult** — you advise how it should look and work then; D4 is a technically-verified baseline
(SVG editor, sync strategy, print path), not a locked design. Expect direction changes at zero
sunk cost since nothing is built yet.
**Depends on:** Phase 3 (numbered-section builder + config fieldset; Intro preset sets it off);
owner design direction at phase start. **Size:** 1.5 days.
Being last also makes the decision-15 cut order automatic: if the runway is gone by Aug 1, Stage
Plot is the natural slip to a fast-follow point release — nothing else depends on it.

**Verify:** touch + mouse; two-browser advisory lock; vector print; PDF export on school hardware; nine themes; Intro-preset session hides it.

---

## Phase 9 — Platform & UI tightening (design D10) — **continuous + dedicated Fri Jul 31**

**Depends on:** applied continuously from Phase 3; the dedicated day sweeps what's left. **Size:** 1 day dedicated.

1. **CueolaCaps** capability helper; **Outrangutan one-time Chrome sheet** ("MIDI controllers, Stream Deck, and automatic multi-display placement need Chrome or Edge; playback, cues, outputs, and show files all work here"), shown only when capabilities are missing; fix the wrong WebGL toast.
2. **Safari optimization** (90% of usage): `navigator.storage.persist()` at boot in BOTH apps (today Safari can silently evict Outrangutan's entire media library after 7 days unused); webm/ogg import warning via canPlayType; PDF export labeled as the Safari path (named @page rules don't work there); popup-blocked guidance on script-op/Flowmingo windows; -webkit-backdrop-filter sweep; output-window autoplay fallback.
3. **File icons, honestly (D10.3):** proper PNG icon set + apple-touch-icon (fixes the ugly installed icon on iPad/mac today); manifest `file_handlers` associating .cueola → Cueola icon and .ogshow → Outrangutan icon with a launchQueue importer — **works for installed-Chrome users; macOS Finder document icons are not web-controllable, so system-wide file icons are 3.0 native-wrapper territory.**
4. **HIG kit sweep + info buttons (D10.4):** capsule buttons, 44px targets, 8px grid, sheet/alert anatomy, reduced-motion — in Cueola's existing themes; **ⓘ buttons** on exports, saves/loads, restore/history, and join surfaces, opening plain-language popovers with "Learn more" into the matching lesson; **DESIGN_GUIDELINES.md updated** with the kit + an explicit mac/iPad-app steer.

**Verify:** per D10's verify list, in Safari and Chrome, both themes.
**Prepared commits:** `v2.1 platform: Safari optimization + capability helper` · `v2.1 ui: HIG component sweep + info buttons` · `v2.1 pwa: icons + file handlers`.

---

## Phase 10 — Security close-out: App Check enforcement + rules round 2 — **Sat Aug 1 (morning)**

**Depends on:** Phases 2–7 landed; App Check monitoring since Phase 2. **Size:** 0.5 day.
Review monitor data across all five surfaces → **enforce**; kill open `list` on accessCodes, scope
sessions/profiles lists to admin clients; land any slipped inert rules blocks; write the
term-boundary rotation runbook (class keys, cloud-snapshot wipe, session archive). If the term
starts much later than Aug 2, enforcement may deliberately wait for a final pre-term flip — owner's
call with the term date.

**Verify:** rules suite green; every surface works enforced; unregistered client refused.

---

## Phase 11 — Guides, lessons, training material — **Sat Aug 1**

**Depends on:** feature phases final; decision 14. **Size:** 1 day (+ owner recording, may trail).
New "Your Profile & Portal" lesson; PB lesson updates (config, groups, Stage Plot); Start Next
Episode in the build lesson; cloud restore in the support lesson + OPERATOR_CARD Recovery; ⓘ-button
"Learn more" targets wired; dual-authoring killed (content-reference.md generated from
LESSONS + contract assertion); one Kokoro narration batch; Instructor Quick Start + Admin crib
sheet (new vocabulary, video slots); per-video scripts + click-paths delivered — **recording is an
owner errand and may trail past Aug 2**; REHEARSAL_CHECKLIST 2.1 section; version stamps.

---

## Phase 12 — Release: QA matrix, hardening pass, v2.1.0 — **Sun Aug 2**

**Depends on:** everything. **Size:** 1 day.
Full regression matrix (both browsers + stale-client sims): every door × gated/ungated; grouped +
ungrouped; intro/full/per-group exports **including the corruption-replica export**; clone → run →
clone; local + cloud restore against a live stale client; admin sign-in everywhere;
Outrangutan/Flowmingo/script-op smoke; MIDI hardware smoke (owner errand). Fresh-eyes hardening
review of the whole diff. Final ?v= sweep + WORKER_SCHEMA bump, staged deploys per D8 rule 3,
rollback kit inventory, CHANGELOG, version 2.1.0, release notes.

---

## Owner errand runway

| Errand | Target | Blocks |
|---|---|---|
| Term start date (for App Check/rotation timing) | when known | Phase 10 timing |
| Console: Email/Password + App Check monitor registration | Jul 22 | Phases 2, 10 |
| Mint your admin account (bootstrap script, together) | Jul 22 | Phase 2 |
| Answer decisions 5–12, 14 as phases approach | rolling | each phase |
| Real-hardware MIDI smoke | by Aug 2 | Phase 12 |
| Record training videos from delivered scripts | may trail Aug 2 | Phase 11 links |
| Commit each prepared block | rolling | clean history |

## Sequencing at a glance

```
Fri Jul 17 · Mon Jul 20   Phase 0   shows run · intake only · triage Mon evening
Tue Jul 21                Phase 1   foundations (PII, vendoring, naming)
Wed 22 – Thu 23           Phase 2   admin accounts + rules (App Check monitor on)
Thu 23 – Sun 26           Phase 3   PAPERWORK & EXPORT OVERHAUL (+ config + delete)
Sun 26 – Mon 27           Phase 4   dashboard redesign
Mon 27 – Tue 28           Phase 5   identity + avatars
Tue 28 – Wed 29           Phase 6   groups + Start Next Episode
Thu Jul 30                Phase 7   cloud snapshots
Thu 30 – Fri 31           Phase 9   platform & UI sweep (continuous before this)
Fri 31 – Sat Aug 1        Phase 10  security close-out  ·  Phase 11 docs & training
Sat 1 – Sun 2             Phase 8   Stage Plot — LAST · opens with owner design consult
Sun Aug 2                 Phase 12  QA + v2.1.0
```

## Out of scope (3.0 parking lot)

Leaf-granular sync re-light (resolved: deferred) · per-group rundowns/Live · group-scoped notes ·
crew carry-over on clone · Stage Plot advanced tools (walls, image backgrounds, align, cable runs,
live cursors) · native wrapper for system-wide .cueola/.ogshow Finder icons · student anonymous
Firebase Auth · pricing/IAP · avatar photo-library raster track.
