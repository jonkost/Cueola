# Changelog

## Unreleased: Sign-in gate, student PINs and admin passwords (built 2026-08-11)

Closes the impersonation gap where a username alone let anyone sign in as
someone else. Students now unlock with a 4 digit PIN, admins with their real
password, and instructor powers ride real sign-in, not a role label.

### What is honest about this
A student browser has no server-checked secret (the university prohibits
student passwords), so the PIN is verified in the browser against a salted hash
on the profile. That makes it a strong deterrent against a classmate typing
your username, but NOT cryptographic authentication: profiles are readable, so
a 4 digit hash is guessable by someone with developer tools and database
access. Firebase App Check and the Firestore rules stay the real perimeter.

### Student PIN
- New `cueola-pin.js`: a 4 digit PIN helper (salted SHA-256, one way) shared by
  the front door and the dashboard. Weak PINs are refused: repeats (1111),
  runs (1234, 4321), fewer than three distinct digits (1212, 1122), and a
  blocklist of well-worn PINs.
- The front door and the identity modal now gate sign-in. A stored login on a
  device is LOCKED (reads as signed out everywhere) until the person clears the
  gate: a student enters their PIN, an admin enters their password. Every
  currently signed-in student is forced through the gate the first time this
  ships, since no device is unlocked yet.
- The create-profile wizard gained a student PIN step (set and confirm, weak
  PINs refused). Admins skip it: they sign in with a password.
- Super admins can reset a student PIN from the dashboard Class Roster (they
  set a new one and share it; they can never read the current one). Renaming a
  student carries their PIN forward.

### Admin password everywhere, instructor powers on real auth
- An admin-role profile must enter its Firebase password at the front door, not
  only in the instructor dashboard. A live admin session (persisted, or from
  the dashboard on the same origin) stands in so nobody is asked twice.
- Instructor standing now requires a real admin auth session, not a profile
  whose role merely reads "admin". Joining by code lands as a student unless an
  admin session is live, and the show-caller predicate
  (`resolveCallerState`) grants control only to a live admin session or a solo
  workspace (demo, expert, or an unsynced local copy). This closes both the
  impersonation path and the forgeable dashboard-launch localStorage path.

### Rules and cache
- `profiles/{username}` may carry optional `pinSalt`, `pinHash`, `pinSetAt`,
  `pinSetBy` (shape-validated, salt+hash always paired). Shipped as an ADDITIVE
  staged ruleset, `docs/rules-additive-2026-08-11-pin.rules`, which must deploy
  BEFORE the hosting that carries the PIN code, or profile writes fail closed.
  Rollback copy: `docs/rules-rollback-2026-08-11-pre-pin.rules`.
- `WORKER_SCHEMA` rolls so the gate reaches installed clients; the new
  `cueola-pin.js` is precached.

## Unreleased: Position assignments move to Planda Bear (built 2026-08-11)

Position assignments now live where the paperwork lives. The Admin panel's
Crew tab is retired; the hub's assignments card is the app's editor (the
instructor dashboard's session inspector keeps its own). WORKER_SCHEMA 30.

- The Planda Bear hub's Crew Assignments card becomes the Position
  Assignments editor for signed-in admins: positions list, per-person
  profile/position/paperwork rows, the save-state pill, and Save
  assignments, all on the hub. Everyone else keeps the read-only roster
  card. Admins can do this at any point: sign in as admin, open Planda Bear
  with the show code, and the card is ready to edit.
- The editor keeps the canonical save flow untouched (revision-guarded
  transaction, conflict states, draft preservation). Remote updates and
  group switches never rebuild the card over an unsaved draft or under the
  operator's cursor, and a draft survives closing the hub.
- The Planda Bear gear menu grows an Admin sign-in row (shown only while
  signed out), so entering PB first and signing in second also works. After
  a sign-in inside Planda Bear the card lights up in place instead of the
  Admin panel opening behind the workspace.
- The Admin panel keeps Session, People, and Sources; People gains a pointer
  to the new home. Admin panel and hub opens no longer reload assignments
  over an in-progress draft.
- Group workspaces: assignments and position options are whole-class data,
  and now always read and write the parent session doc and the ungrouped
  local mirror, even while a group workspace is active. The read-only card
  in a grouped hub now shows the whole-class roster instead of nothing.

## Unreleased: Stage Plot (built 2026-08-11)

The parked Phase 8 paperwork page ships as a working skeleton. Planda Bear
gains a birdseye drag-and-drop Stage Plot for the intro courses: the Keynote
replacement the class currently uses to place gear in the room.

### Stage Plot editor (Planda Bear page 7)
- Three-column editor: an Object Bank on the left (camera, microphone,
  projector, pipe and drape, video switcher, monitor, speaker, light, table,
  person, riser, door, text label), the gridded stage in the middle, and a
  Keynote-style inspector on the right. Bank glyphs are placeholder line art
  in one swappable registry, ready for the owner's final icon designs.
- Objects come out of the bank as many times as needed: click adds at center,
  or drag one straight onto the stage. Every placed object auto-labels itself
  (Camera 1, Camera 2) and the label stays editable in the inspector, along
  with color, rotation, size in feet, front/back order, and delete.
- The stage is a real floor plan: feet-based coordinates, a 1 ft grid with
  half-foot snap (toggleable), editable space size, dimension labels, a
  FRONT / AUDIENCE edge, and a scale badge. Arrow keys nudge, Delete clears,
  Esc deselects, Cmd+Z undoes.
- Multiple named plots per session with a dropdown and Add Plot, exactly like
  call sheets (min one, instructor-gated add/delete, delete tombstones), so
  each learning environment keeps its own saved layout.
- Live collab rides the standard Planda Bear spine: 650ms autosave, the save
  chip, advisory "X is editing" presence on the canvas, and mid-drag guards
  so remote refreshes never fight the pointer.
- Session snapshots and restores carry plots automatically; Start Next
  Episode clones them via the clone whitelist.

### Paperwork package and export
- Stage Plot registers as its own numbered section: one landscape sheet per
  plot with a production/venue/date/scale title block. Preview is vector SVG;
  PDF export embeds a pre-rasterized 2x PNG keyed to the snapshot
  fingerprint, since html2canvas mangles complex inline SVG.
- Standalone preview and Export Stage Plot PDF from the editor's step nav,
  same flow as the call sheet.
- Show-code setup and Session Setup both grow a Stage Plot checkbox in the
  paperwork config. Decision 10 amended by the owner: the Intro preset now
  INCLUDES Stage Plot (it is built for the intro courses), and missing =
  enabled lights it in existing sessions.
- WORKER_SCHEMA 29; paper export contract suite pins the new section's
  registration, landscape wrapper, and raster path.

### Review hardening (same day)
An adversarial review pass confirmed seven issues; all are fixed:
- Saves are merge-splices now: only locally-edited plots replace their stored
  versions over a fresh read, so two people editing different plots of the
  same session no longer clobber each other's whole array, and exit saves
  cannot push a stale working copy over remote edits.
- Esc closing the editor inside the 650ms autosave window no longer drops
  the last canvas edit; the save dispatcher rescues the pending working copy.
- Undo frames invalidate when remote state is adopted, so Cmd+Z can no
  longer resurrect pre-merge state over a collaborator's work.
- Oversized spaces back off the raster scale and validate the PNG result
  (Safari's canvas limit fails silently), falling back to inline SVG instead
  of exporting a blank sheet.
- The min-1 fallback plot walks past tombstoned ids, so a session whose
  original first plot was deleted cannot strand edits on a ghost plot.
- The dashboard's read-only Stage Plot summary coerces plot dimensions to
  numbers before rendering; raw wire strings could otherwise reach
  innerHTML in the admin dashboard (stored XSS).

## v2.2.1: Stroke pass, Planda Bear header, new brand art (built 2026-08-07)

A look round: the app sheds its hairlines, the Planda Bear header stops
colliding with its own icon, and the Cueola and Flowmingo marks are replaced.

### Strokes removed app-wide
- Aggressive stroke pass across index.html, dashboard.html,
  script-operator.css and outrangutan.css: decorative borders are gone and
  separation now comes from fills and glass, not hairlines. Inputs and table
  grids are included, per the owner's call.
- Every blanked stroke keeps its original width as `transparent`, so nothing
  reflows: the line disappears, the box does not move.
- `--btn-hairline` is retired to `1px solid transparent` at its definitions,
  which clears the button hairline everywhere at once without touching the
  hundreds of `border:var(--btn-hairline)` call sites.
- Kept on purpose: every `:focus` / `:focus-visible` ring (keyboard focus
  visibility is not part of this pass), state strokes that are a state's only
  signal, glass inset highlights (lighting, not strokes), and the print and
  PDF paperwork rules, which need real borders on paper.

### Planda Bear
- Header lockup spacing fixed. The 74px brand icon was sitting in a 58px box,
  so it overflowed 16px right and down instead of centring: the title text
  landed 2px *inside* the artwork and the icon hung into the header's bottom
  edge. Box and artwork are now the same size with an honest 16px gap.
- Production Notes is a full-width card above the paperwork grid. It was a
  page-wide banner, then briefly a compact header button; it now sits as the
  same card body as the six numbered pages in a row of its own, leading the
  workspace with the note count as a pill in its title. A major part of the
  production process reads like one.
- The gear menu grew up into Planda Bear Settings: alongside the theme picker
  it now carries Export PDF Package, Preview Package, and Export Call Sheet
  Only, the same actions as the row at the bottom of the hub.

### Owner punch list (2026-08-11)
- Flowmingo Op's Hotkeys panel is key-first rows again (key chip leading, dim
  description trailing, like the talent screen's hint card), replacing the
  prose paragraph, and now lists every binding including F, R, H, M, and ESC.
- Theme picker swatches fill their circles. The background shorthand was
  sizing the two-tone gradient to the disc minus its 1px rim and wrapping the
  leading colour into the border zone, which read as a dark gap ring inside
  the rim on all nine swatches; the swatch table now pins the gradient to
  border-box so the fill reaches the rim on every picker surface.
- The front page profile button fills its circle: signed out the
  person-in-circle glyph is the full button face, signed in the avatar chip
  covers it edge to edge.

### Brand
- New Cueola and Flowmingo icons, re-inlined into the index.html and
  dashboard.html sprites from `assets/Brand/`.
- Second Cueola icon revision (2026-08-11): the koala now hangs onto the green
  play triangle. Propagated to the page sprites, all seven PWA and touch PNGs
  in `assets/icons/app/`, and the avatar picker's paired background colour.
  The Illustrator export embedded a 230KB raster of the background squircle;
  it is replaced with a 10-stop vector gradient (icon 326KB -> 19KB, verified
  pixel-identical), keeping both pages at their normal size.
- `WORKER_SCHEMA` 25 -> 28 across this release: brand art, icon PNGs, and
  page HTML are all shell-cached, so installed clients only pick up the new
  artwork and markup when the cache name rolls.

## v2.2.0: Overhaul round (built 2026-07-27; live on cueola.live since the 2026-08-03 push)

One round between terms: the whole app on one visual language, a control
surface that answers back, a security pass, and a show built for drilling.
The owner console errands carried from v2.1 §1 stay open and gate release QA.

### Liquid glass restyle
- The whole app moved to the liquid glass look: no glows or drop shadows
  anywhere in chrome; depth comes from layered translucency, not lighting
  effects.
- Tooltips are instant glass chips on hover (the shared data-tip engine);
  status lamps are sharp solid dots.
- KeyWi Bird gained a sixth deck theme, "Liquid Glass", matching the app.

### Reactive Stream Deck keys & customization (KeyWi Bird)
- Keys are reactive: playing SFX/playback keys sweep a duration wipe behind
  the icon, pre-roll shows a thin bottom bar, loop pads carry a corner marker
  (a loop has no end to count down to), and every press flashes for 150 ms.
- Per-key appearance overrides in the key editor: accent color swatches plus
  custom hex, searchable SF Symbol picker (85 symbols), label override and
  Hide label, progress style (Wipe / Ring / Bottom bar), Press flash and
  Reactive animation toggles, one-click Reset appearance.
- Five-step setup wizard (intro, connect deck, Micochondria, OBS, theme);
  brightness slider with auto-dim to 20% after 5 idle minutes, any input
  restores it instantly.
- Micochondria: pop-out window (glass look), split TKB/VofU strip zone,
  PLBK vol dial, All talk off; meters and faders appear when talkbackd
  reports levels.
- Profiles and pages persist every override.

### Security round
- XSS escaping fixes across render paths.
- talkbackd WebSocket origin gate: browser origins outside cueola.live /
  localhost / 127.0.0.1 are rejected; native clients (no Origin header)
  still connect.
- Session-code keyspace widened: new codes are YYMM + 4 letters (e.g.
  2607KWXR); old YYMM + 2 letter codes remain valid.
- Staged Firestore rules updated for the round (deploy is an owner errand,
  see deferrals below).

### Sign-in consistency (the front door)
- Identity-first entry card replaces type-a-code as the way in: sign in with
  a username right on the card, and your assigned sessions are one tap away
  through the same join guards. The typed session code survives as a quiet
  "Have a session code?" fallback link for guests and remote operators.
- Admin sign-in rides real Firebase Auth (synthetic
  `<username>@admins.cueola.app` accounts minted from the dashboard);
  @jonkost is the owner admin profile.
- firebaseReady re-render fixes a boot race that could strand a signed-in
  card on the offline message.
- Signed-in users get the same one-tap assigned-session pickers inside the
  join doors of Planda Bear, Flowmingo Remote Op, Outrangutan, and the
  typed-code modal; the typed code demotes to a "Have a different code?"
  fallback beneath the list.
- Front page redesigned around the new door: the identity card is the hero,
  the app cards line up beneath it, and Demo and Blank Slate become compact
  cards with inline actions, all in the liquid glass treatment (no glows, no
  drop shadows).
- The app cards share a hero-aligned anatomy: icon plus title header, a
  one-line description, and actions pinned to the card bottom, with Demo and
  Blank Slate as a quieter half-width pair.

### The Break Room test show
- The Break Room (advanced, 29 rows) is the full-system drill: a complete
  late-night talk show with segments, scripts, the question lane, complete
  paperwork (call sheet, production schedule with tech checklist, safety
  plan, 12-row video patch, 16+1 audio/comms patch), a KeyWi profile named
  "The Break Room", and an Outrangutan pad board.
- Its only path is the dashboard "Create Test Show" button, which mints a
  real session code the admin hands out; everyone who joins that code gets
  the whole drill, seeded KeyWi layouts included. It does not appear on the
  front page. The front-page Demo card stays Campus News (10 rows), no
  login.

### Junk sweep & guides
- 132 MB of untracked artifacts swept out of the working tree.
- Guides refreshed for the round; three new video click-path scripts (sign in
  and join, KeyWi Bird setup and custom keys, The Break Room drill night) in
  docs/video-scripts.md.

### Known deferrals (owner errands)
- Firestore rules: the ADDITIVE block deployed 2026-08-03 (admin sign-in +
  groups + snapshots live). The round-2 tightening from the security round is
  in-repo and still **not deployed** (owner deploys after instructors are
  minted, gated on the emulator suite).
- App Check rollout still owed (owner).
- Hardware pass still owed: real-deck Connect-and-Learn and the UR44 meter
  verify (owner).

*(The release-day levers all landed by 2026-08-03: CUEOLA_VERSION is 2.2.0,
caches bumped, WORKER_SCHEMA well past 15.)*

## v2.1.0: Term-boundary build (live on cueola.live 2026-07-21; owner QA in progress)

The `V2_1_PLAN` window between terms: accounts and identity hardening, live
reliability, cloud recovery, and platform polish. Phases 1-7, 9-11, 13 + 1.5
code-complete; Phase 8 (Stage Plot) extends past the window by decision 17.
Version flip to 2.1.0 done 2026-07-21. Owner QA (docs/V2_1_CHECKOUT.md) and
the Firebase console errands in its §1 are still open.

### Foundations & security (Phases 1, 2, 10)
- PII/private artifacts out of the web root; internal docs hosting-ignored;
  cdnjs vendored same-origin (jspdf, html2canvas, pdf.js, mammoth, jszip).
- Admin accounts on Firebase Auth (synthetic emails, uid-keyed `admins/`);
  admin-gated accessCodes minting + session delete; dashboard Accounts panel.
- Rules round 2: admin-gated `list` on `sessions` + `accessCodes` (profiles
  list stays open; student exports need it, a documented residual).
- `docs/term-boundary-runbook.md`: key rotation, snapshot wipe, session
  archive/purge, App Check enforcement flip.
- Session-doc hygiene: preProActivity cap, purge cascade over all five
  subcollections.

### Identity, dashboard, groups (Phases 3-6)
- Profiles + portal (class login codes, no passwords), avatars, entry gate.
- Instructor dashboard: session browser, Class Keys, paperwork presets
  (Intro course / Full production), Entry Requirement, soft-delete/restore.
- Groups: per-group paperwork workspaces, group picker, Reviewing picker,
  lock; exports follow the group. Start Next Episode session clone
  ("Ep 12" → "Ep 13", ↳ From lineage).
- Paperwork/export overhaul: per-group packages, verified stamps, preview.

### Live reliability & show controls (Phases 1.5, 13)
- Link strip (CLOUD · TALENT · PLAYOUT · SCRIPT), CALLER/FOLLOWING/VIEWER
  badge, System status rail with per-subsystem Recover buttons, rival-operator
  takeover honesty, ARMED first-GO proof + preflight row.
- RTRT automatic call (READY·TRACK·ROLL·TAKE, S aborts) with Manual TAKE
  (decision 18); question lane (paste → Enter pushes QUESTION card, Esc
  clears); bounded talent overlay band; printed operator cheat card from the
  keymap registry; live drag-reorder.
- Runtime slimmed: perf budgets recorded, timers owned, leak tests extended.

### Cloud snapshots (Phase 7)
- `sessions/{code}/snapshots` cloud trail: gzip-chunked, content-hash-deduped,
  admin-gated; Session History merges local + cloud rows; restore re-stamps
  through the one restore body; purge sweeps the trail.

### Platform & UI (Phase 9)
- CueolaCaps capability helper (no UA sniffing); Outrangutan one-time
  non-Chromium sheet; WebGL toast honesty.
- Safari: `storage.persist()` at boot in both apps; webm/ogg/opus import
  warnings via canPlayType; PDF export labeled as the Safari print path;
  popup-blocked guidance; -webkit-backdrop-filter sweep; output-window
  mute-first autoplay fallback with a hardened tap-to-unmute lifecycle.
- PWA: full PNG icon set + apple-touch-icons, manifest `file_handlers` for
  .cueola/.ogshow with launchQueue import (installed Chromium),
  WORKER_SCHEMA 8.
- HIG kit: capsule primaries, coarse-pointer 44px targets, motion tokens +
  reduced-motion, ⓘ info popovers with Learn-more lesson deep links;
  DESIGN_GUIDELINES.md updated with the kit + mac/iPad steer.
- Vendor libs defer to first use on show surfaces (intake 25).

### Guides & training (Phase 11)
- New "Your Profile & Portal" lesson (9 lessons); build/live/PB/support
  lessons updated to v2.1; per-section lesson anchors.
- Dual-authoring killed: `content-reference.md` generated from
  LEARNING_LESSONS (+ contract suite); full Kokoro narration set (9/9).
- OPERATOR_CARD V2.1, REHEARSAL_CHECKLIST v2.1 drills, Instructor Quick
  Start, Admin Crib Sheet, 10 video click-path scripts.

*(Release-day: flip CUEOLA_VERSION to 2.1.0, final ?v= sweep, staged deploys
per D8 rule 3; see docs/V2_1_CHECKOUT.md.)*

## v2.0.0: Identity & collaboration build (2026-07-14) *(entry written retroactively 2026-07-21)*

The `V2_PLAN` run (phases 1-5) plus the pre-launch ship sweep. Shipped to
cueola.live 2026-07-14; this entry was reconstructed afterward: v2.0.0
originally went out without a changelog entry.

- **Data safety & deploy gap:** staged shape-validating Firestore rules
  (deployed 2026-07-15), vendored CDN libraries, offline shell service worker
  with the WORKER_SCHEMA release lever, session-history snapshots with
  re-stamping restore discipline.
- **Show-day armor:** import-time media probing, black-slate graceful failure,
  resume-after-crash, show log, preflight panel.
- **Profiles & login-code identity:** passwordless student profiles minted by
  class login codes (university no-password rule enforced structurally),
  avatars, per-session portals.
- **Collaboration backbone:** per-note subcollection migration (dual-mode with
  self-retiring legacy fallback), mentions, checklists with per-item owners,
  read receipts, attachments, who-owes-what instructor view.
- **Playout depth:** .ogshow STORE-zip show container (raw media blobs),
  waveform trim editors, Web MIDI learn-mode + Stream Deck (WebHID), show-pack
  print, rundown Outrangutan column; QLab integration removed entirely (owner
  decision).
- **Ship sweep:** collab-refresh clobber fixes, paper polish, cross-app seam
  fixes, 8-lesson Learning Hub with Kokoro narration, OPERATOR_CARD.

## v1.0.0: Production-readiness build (2026-07-05)

The complete `CUEOLA MASTER PLAN` run (phases 0-8), hardening the app after the
AVT Lab live run. One operator, one machine, keyboard-first, nothing hangs the
live view.

### Phase 0: Discovery & architecture audit
- `docs/ARCHITECTURE.md`: four surfaces (rundown, Script Op, Outrangutan, Flowmingo),
  show-state model, media pipeline, test inventory, top-5 live-failure risk list.

### Phase 1: Branding refresh
- New brand SVGs (`assets/Brand/`) everywhere: front page, dashboard sprite,
  favicons (incl. the Outrangutan output window), zero stale artwork.

### Phase 2: Outrangutan media engine core
- Import-time probe v2: undecodable/damaged files **rejected at import**; duration,
  dimensions, aspect stored; 8 s stall guard.
- Stills first-class (hold-until-advanced or timed); pause → GO resumes from the
  pause point (offset persisted; survives reload).
- Graceful failure: mid-show decode death cuts to **black slate**, toast, cue
  flagged ⚠, show stays advanceable. Cue-ahead preload on the idle deck.
- `scripts/make-test-media.sh` generates the 16:9/4:3/9:16 + stills + SFX +
  broken-file test set.

### Phase 3: Rundown stability & sync hardening
- The "Questions"-segment blanking fixed: fingerprint-gated snapshot renders
  (key-sorted stableStringify), in-place badge patching, scroll preserved:
  a playout write storm now causes **zero** table rebuilds.
- Versioned updates (ts + seq) drop stale packets; ~1 Hz continuous playout;
  explicit **SYNC RECONNECTING** chip for followers.

### Phase 4: SFX system
- Rundown playback/audio cells link Outrangutan SFX pads: manual green **SFX**
  button + per-cell auto-fire-on-advance. Same-tab local fast path ≈ 3 ms
  trigger-to-start. Stable pad/bank ids (renames never break links). Followers
  see a transient "SFX · name" chip.

### Phase 5: Single-operator control
- Central keymap registry drives dispatch **and** the `?` reference. Arrows always
  drive the rundown, including with Script Op open. Space/J/K/L prompter
  transport; G/P/S playout; Shift+S fade; Shift+Esc PANIC.
- `/` jog-wheel scrub across the whole script, local until Enter commits.

### Phase 6: Control & inspector redesign
- Shared UI kit (cards, segmented controls, steppers, toggles, context pills);
  Outrangutan inspector rebuilt; 3×3 visual theme grids; one global Overlay-size
  stepper; duplicate buttons removed; shared click-outside/Esc dismissal;
  Message Center + Planda Bear polish; <920 px Outrangutan overlap fixed.

### Phase 7: Production hardening
- **Show preflight**: validates script/talent/cloud, every rundown→playout link,
  the media library (present + decodable + known dimensions), SFX banks, a timed
  cloud write→ack round-trip, and theme assets, with jump-to-row links. Runs on
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

### Phase 8: Dress rehearsal & release
- `docs/REHEARSAL_CHECKLIST.md` (scripted AVT-Lab-shaped rehearsal) and
  `docs/OPERATOR_CARD.md` (keymap-derived shortcut card + 10-line go-live list).
- Rehearsal executed end-to-end; punch list closed at zero P0/P1. Fixes landed:
  - Legacy cue migration preserved Outrangutan link fields (`outCueId` etc.).
  - `enterRundown` records its screen, so the resume banner can no longer claim a
    stale "live" state.
  - `Outrangutan.preflight()` reads the joined session's show record directly
    from IndexedDB (was: loaded the standalone show and mutated module state).
  - The resume heartbeat is gated on a session screen being up, so a deliberate
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
  look) across every surface, Script Op drawer and Flowmingo Op overlay
  included; the rectangle tiles are gone.
- The live **Cue scrubber mirrors its position into the Script Op editor**:
  the operator sees the script fly by while dragging, not just a percentage.
- Script Op panel gained its own **× close** (the topbar toggle can be covered
  when the panel overlaps it); hidden inside the dedicated pop-out window.
- Build rundown: the sticky #/name columns no longer let the scrolled table
  show through: hover/edit dimming moved off the sticky cells onto the drag
  icon itself, and both rundown tables switched from `border-collapse:collapse`
  to `separate` (collapsed borders paint on the table grid, not the cells, so
  scrolling strokes slid straight through the pinned columns).

### Inspector redesign (operator-requested, Keynote-style)
- The Script Op drawer's stacked accordion of bordered boxes is gone: **icon
  tabs** at the top pick one control group (Prompter / Cue & On Air / Clocks &
  Alerts / Formatting) shown as a single flat page: bold text headers,
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
