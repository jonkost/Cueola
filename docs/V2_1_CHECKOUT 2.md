# V2.1 Checkout List (2026-07-21)

> **LIVE since 2026-07-21 14:25 (commit 7362f3a):** cueola.live serves the
> full v2.1 build (verified: matching hashes, WORKER_SCHEMA 9, zero console
> errors, PWA manifest/icons/narration serving, avatar fix live). The version
> string stays 2.0.0 until §7. Machines that used the old site get the
> "Cueola update ready → Reload" toast on next visit — take it before testing.
> Because hosting shipped while no admin account could exist, the §1 additive
> rules deploy is re-pinned: it must land **before your first admin sign-in**
> (that's when cloud captures first become possible), not before hosting.

Everything left between "code-complete" and "shipped" — every owed QA item,
console errand, drill, and release step across the whole v2.1 window, grouped
by the kind of session it takes. Work through a section when you have that
setup available; fix-requests from any failure come back as a punch list.

Companion docs: [term-boundary-runbook.md](term-boundary-runbook.md) ·
[app-check-rollout.md](app-check-rollout.md) ·
[admin-accounts-runbook.md](admin-accounts-runbook.md) ·
[REHEARSAL_CHECKLIST.md](REHEARSAL_CHECKLIST.md) (§4 = the v2.1 drills).

---

## 1 · Console errands (~30 min, blocks the most)

- [ ] **Firebase Console: enable Email/Password** provider (blocks all admin
      sign-in QA).
- [ ] **App Check: register + monitor** all five surfaces (index, dashboard,
      script-operator, Flowmingo talent, Outrangutan output). Enforcement
      waits for monitor data + term date.
- [ ] **Mint your admin account** (bootstrap script — run together with me).
- [ ] **Deploy the ADDITIVE Phase 7 rules block BEFORE your first admin
      sign-in** (hosting already shipped 7/21 while no admin could exist, so
      this now gates the sign-in instead) — then watch a capture doc appear
      in `sessions/{code}/snapshots` on join.
- [ ] **Decision 0:** term start date → sets App Check enforce timing + rules
      round-2 deploy day.
- [ ] **Decision 14:** where training videos live (unlisted YouTube
      recommended) → fills the `video:` slots in lessons.

## 2 · Solo browser QA (~45 min, any Chrome)

> **Re-testing a fix on a machine that already saw the bug?** The offline
> shell serves the OLD page until the update applies — take the "Cueola
> update ready → Reload" toast (or unregister the SW + clear caches in
> DevTools) BEFORE judging a fix. This bit us on the avatar-modal fix
> (WORKER_SCHEMA is now 9 for exactly this reason).

- [ ] **Avatar screens (fixed 2026-07-21):** notes-board chip → portal and
      Create-profile step 3 — grid scrolls inside the modal, Save/Cancel and
      Continue/Back always visible; upload rejects a >15 MB image politely.
- [ ] **Big-board open:** on a session with a large notes board, opening
      Production Notes then the avatar chip stays responsive (read receipts
      now batch; renders coalesce).

- [ ] Admin sign-in everywhere: dashboard, in-app **Instructor Sign In**,
      Accounts panel (mint a standard account, temp-password flow).
- [ ] Entry gate: Entry Requirement on → student without profile blocked;
      class key creates profile; username-only re-entry.
- [ ] Paperwork presets: Intro course hides scheduler/patch sheets; Full
      production shows all.
- [ ] Cloud snapshots (after §1 rules deploy): capture on join; Session
      History shows Cloud rows; restore replaces + re-stamps; recovery copy
      appears; **Delete on a cloud row removes it (chunked snapshots too)**;
      non-admin gets no cloud rows.
- [ ] Phase 9 spot checks: ⓘ popovers in both themes (open one inside
      Settings, scroll — it should dismiss), Learning Hub → new **Your
      Profile And Portal** lesson + voice-over plays for all 9 lessons
      (Outrangutan narration is new).
- [ ] Export PDF Package per group; verified stamp; corruption-replica export.

## 3 · Two-browser / two-machine drills (~1.5 h)

- [ ] **REHEARSAL_CHECKLIST §0–3** (the V2 pass) + **§4 v2.1 drills** (link
      strip death/recovery, RTRT + abort + Manual TAKE, ARMED proof, question
      lane from a real chat, overlays both directions, rival-operator
      takeover, cloud restore vs stale client, groups pick/lock/review,
      Start Next Episode).
- [ ] Group split-brain: two browsers in different groups edit paperwork
      simultaneously; Reviewing picker flips cleanly; exports follow.
- [ ] Jul 20 drill items still owed: rejoin-by-code + advance; talent-window
      kill/reopen (status truthful, rebind in seconds); fresh-session first
      GO fires media WITH sound.
- [ ] Perf budgets re-measured on show-class hardware (boot-to-interactive,
      live-screen long tasks) — record beside the Phase 1.5 numbers.

## 4 · Safari / iPad hardware pass (~45 min)

- [ ] App + dashboard load **zero console errors** in Safari (Phase 1
      re-check).
- [ ] `navigator.storage.persist()` logged granted/denied at boot (both
      apps) — advisory, but confirm no error.
- [ ] Outrangutan entry shows the **About this browser** sheet ONCE (and
      lists only what's actually missing); never on Chrome.
- [ ] Import a .webm/.ogg/.opus file → Safari-specific warning (try one with
      no MIME type, e.g. .opus off AirDrop).
- [ ] PDF export from Safari on iPad = correct letter-size output; the print
      fallback toast shows the Safari tip for its full duration.
- [ ] Output window on Safari: first un-muted play shows the tap-for-sound
      chip; tapping restores sound; STOP/black clears the chip; Esc on the
      chip re-arms instead of killing sound.
- [ ] iPad (pointer:coarse): 44px targets landed — settings File rows, marker
      chips, topbar icon circles are CIRCLES (not ovals), ⓘ buttons
      comfortably tappable.

## 5 · Installed-PWA checks (Chrome, ~20 min)

- [ ] Install the app → icon is the koala PNG (not a page screenshot);
      check the maskable icon on Android/Chrome OS if available.
- [ ] Double-click a `.cueola` in Finder → app focuses, toast queues it at
      the entry gate, imports after joining (confirm shows correct row
      counts), **Cmd+S saves back into the file**.
- [ ] Same while in a session already → replace-confirm shows CURRENT counts.
- [ ] Double-click a `.ogshow` → Outrangutan standalone opens + imports;
      repeat while og is session-joined → refused with the leave-session
      toast (session untouched, outputs stay up).
- [ ] Double-launch two files quickly → last one wins, no interleave.

## 6 · Hardware / recording errands (owner, may trail)

- [ ] Real-MIDI smoke: connect the box, **+ Learn a control**, map a pad +
      a fader to Master level, fire both.
- [ ] Stream Deck connect + label render.
- [ ] Record the 10 training videos from
      [video-scripts.md](video-scripts.md); paste URLs into each lesson's
      `video:` field (decision 14 first).

## 7 · Release day (after everything above is green)

Run in order — details in [term-boundary-runbook.md](term-boundary-runbook.md) §B:

1. [ ] Fix round: anything the sections above surfaced (bring me the list).
2. [x] Version flip — THREE spots: `CUEOLA_VERSION` → `'2.1.0'`
       (cueola-app.js:4) **plus the two hardcoded "v2.0.0" strings in
       index.html** (the Settings-sheet `.settings-version` and the
       entry-screen version line — nothing reads the JS const, these are what
       users see). Finalize the CHANGELOG draft header (remove DRAFT). The
       index.html edit makes step 3's WORKER_SCHEMA bump apply.
       **DONE 2026-07-21 (pulled ahead of the QA sections because hosting was
       already live and showing v2.0.0; CHANGELOG finalized in the same pass —
       see docs/V2_1_SUMMARY.md §5 for the whole fix round).**
3. [ ] `node scripts/bump-cache.mjs` final ?v= sweep; WORKER_SCHEMA is
       already 8 — bump to 9 ONLY if page-HTML/manifest/icon files changed
       during the fix round.
4. [ ] Rollback kit check: snapshot the LIVE ruleset text to
       `docs/rules-rollback-<date>.rules`; confirm `.cueola`/`.ogshow`
       backups of any real production; note the current deployed ?v= set.
5. [ ] Emulator rules suite green on a Java-capable machine:
       `firebase emulators:exec --only firestore "node scripts/test-rules.mjs"`
       (the suite now covers the Phase 10 list tightening; do not deploy
       rules without its PASS).
6. [ ] Hosting deploy → fleet refresh → instructors minted → **rules round 2
       deploy** (tightened lists) → five-surface smoke incl. the dashboard
       session browser + Class Keys panel (both are signed-in list
       dependents).
7. [ ] App Check **Enforce** (if the term date says now) + negative check.
8. [ ] Tag/commit v2.1.0 (your commits, per prepared blocks in the plan).

## Parked / known

- **Phase 8 Stage Plot** — waits on your design consult (decision 17 keeps
  it; natural slip to a point release). **The consult brief is ready:
  [stage-plot-consult.md](stage-plot-consult.md) — seven one-line answers
  and the build starts.** Its lesson text + PB sheet slot are ready to take it.
- **profiles `list` stays open** — documented residual (student exports need
  it); 3.0 = server-resolved roster.
- **paper-export-contract.test.mjs** — broken pre-existing (chip filed).
- ~~CHANGELOG has no v2.0.0 entry~~ — retroactive entry written 2026-07-21.
- **OBS integration** — UI dark behind `OBS_UI=false`; its Safari
  loopback-block toast is misleading but unreachable (3.0).
