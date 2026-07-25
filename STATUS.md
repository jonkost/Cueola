# Cueola — Status Report

*Written 2026-07-25, from a full read of the code itself (not the planning documents).
Cueola is a live-production toolkit for a classroom/studio setting: a rundown builder
and live show caller ("Cueola"), a teleprompter ("Flowmingo"), a media playback engine
("Outrangutan"), a paperwork and collaboration suite ("Planda Bear"), a Stream Deck
control surface ("KeyWi Bird"), a talkback audio tool, and an instructor dashboard.*

A note on the overall state before the lists: the code is unusually clean for its size —
almost no leftover "to do" markers, and every button on the main app screens is wired to
real working logic. The biggest caveat running through everything below is that the
project is **mid-release**: a hardened set of online-database access rules and several
one-time setup steps exist in the repo but, per the project's own checklist, had not yet
been carried out. Several features are written to quietly limp along until that happens.

---

## Works

Everything here is complete in code, reachable from the interface, and has no stubs or
placeholders that I could find.

**Getting into a show**
- Join a session by show code and name, including a per-session entry requirement that
  can demand a class login code before letting someone in.
- "Blank Slate" mode (start your own show with a fresh code, free-text cues), "work
  locally only" mode with no cloud at all, and a built-in demo show.
- A resume banner after a crash or accidental close: one click rejoins the same session,
  on the same screen, at the same live row.
- Opening a show directly from a dashboard link or a shared link.

**Student profiles and portal**
- Students create a profile using a class login code (deliberately no passwords — a
  stated university rule), pick an avatar (brand animals, an icon library, or an
  uploaded picture), and get a personal portal listing their sessions, assignments, and
  paperwork status. Renames and merged accounts carry history along correctly.

**Building a rundown**
- Full rundown editor: add-row wizard, six cue departments (video, audio, playback,
  graphics, lighting, script), segment headers that collapse, drag to reorder rows and
  columns, edit/duplicate/insert/delete, undo/redo, and per-row "someone else is
  editing this" presence dots when collaborating.
- Script cues accept uploaded scripts (plain text, Markdown, PDF).
- A production-notes side panel in the build view, with one-click "push this note into a
  row / into the script / as a new row."

**Running a show live**
- A preflight check before going live that validates the script, prompter, cloud
  connection, every playback link, the media library, sound-effect banks, output
  windows, and a timed round-trip to the cloud — with jump-to-the-problem links.
- Three live views (full grid, big "now/next" focus view, and a prompter-operator view),
  keyboard-first control, a row-state ledger (on air, next, done, skipped, failed —
  with per-row recovery), and a "show caller" system where others can follow the
  caller's position or an admin can force control.
- The READY–TRACK–ROLL–TAKE calling sequence for playback, including a manual-TAKE
  arming mode and an abort key.
- A connection strip (cloud / talent / playout / script operator) with per-subsystem
  recover buttons, honest "someone else took over" messaging, a shared show clock,
  live script editing pushed to the talent, a whole-script scrub wheel, and a
  structured show log you can review and export.
- Leaving live mode cleanly distinguishes "stop the show" from "detach and leave it
  running," with a recovery path if anything goes wrong mid-exit.

**Flowmingo (teleprompter)**
- A full talent display: smooth scroll with speed, brake/boost, reverse, mirror, text
  size and theme controls; auto-pause markers in the script; import from PDF, Word,
  Pages, or text; export to text or PDF.
- On-screen extras for the talent: time-of-day clock, countdowns, wrap-up warnings, a
  "question from the audience" card the operator can push live, a technical-difficulty
  slate, and broadcast color bars.
- A separate remote-control screen so a second person can drive the prompter from
  another device, with sensible arbitration when two people send commands.
- Robust recovery: if the talent window is lost or duplicated, the system detects it
  and re-adopts a single authoritative window.

**Outrangutan (media playback)**
- Import video, audio, and stills with up-front validation (damaged files are rejected
  at import, not during the show); cue list with drag ordering; seamless A/B playback
  decks; pause-and-resume from the same spot; timed or held stills.
- A sound-effects board with banks of pads, per-pad trim/EQ/volume editing with a
  waveform editor, hotkeys, and search.
- A clip editor with a filmstrip timeline and draggable in/out points.
- Multiple output windows with screen placement, per-output audio-device routing, an
  "identify" flasher, health monitoring, and per-output recovery.
- If a clip dies mid-show it cuts to black, flags the cue, and the show stays
  advanceable. Fade and panic buttons; crash recovery that resumes at the paused spot.
- Show files that embed the actual media (plus a legacy format), save-in-place, and
  double-click-to-open when the app is installed; a printable show pack.
- MIDI controllers and Stream Decks can be mapped to pads and transport inside this
  tool, with a learn mode.

**Planda Bear (paperwork and collaboration)**
- Call sheets (multiple per session, crew grid with drag ordering, fill-from-roster,
  automatic weather lookup for the venue, wrap-time estimate from the rundown),
  safety plan (with weather carry-over), production schedule with a ready-before-show
  checklist and sign-off, and video/audio/comms patch sheets with spreadsheet import.
- Everything autosaves with a visible save-status chip; page and field-level presence
  shows who is working where; instructor comments per section with a mark-reviewed
  flow; an activity log shows who worked on what.
- Group workspaces: each group gets its own copy of the paperwork, with a group picker
  and an instructor lock.
- "Start Next Episode": clones a session into a fresh code, carrying the structure and
  dropping the per-show data, with automatic "Ep 12 → Ep 13" naming.

**Production notes board**
- Threaded notes with replies, tags, to-dos with assignees, multi-item checklists with
  per-item owners, @mentions with autocomplete, likes, pins, inline editing,
  attachments (images, audio, documents), read receipts, browser notifications, search
  and filters, a "who owes what" instructor view, and a one-click hand-off of an audio
  attachment into the sound-effects board.

**Exports**
- PDF export of the full paperwork package (with preview and a call-sheet picker),
  individual call sheets, the rendered rundown (with a print-column preset), the notes
  log, single notes, an operator cheat card generated from the actual keyboard
  shortcuts, and the show log as text. Exports are stamped with whether they came from
  the saved cloud copy or unsaved local work.

**Session history and files**
- Automatic snapshots of the session every couple of minutes on the device, with a
  history browser, restore, and export. Restores are re-stamped so they can't
  masquerade as someone else's newer work.
- Save/open branded show files, including save-in-place and opening files by
  double-click when installed as an app.

**Admin tools inside the main app**
- Admin sign-in, per-session people management (remove a person, move the whole
  session to a new code), the crew-position catalog, role and paperwork assignments
  with conflict detection when two admins edit at once, and force-live controls.

**Instructor dashboard (most of it)**
- Sign-in/sign-out, a session browser grouped by term with a mine/all filter, live
  presence peeking into any session's rundown, a session setup panel (title, time,
  status, entry requirement, owner, groups, paperwork configuration with two presets),
  people and role management with conflict detection, class login-key minting and
  revocation, a class roster with rename/merge/deactivate/bulk-attach, instructor
  account management, and soft-delete with restore and a 30-day purge.
  *(One important exception — creating a new session — is broken; see below.)*

**Learning hub**
- Nine narrated lessons with progress tracking, knowledge checks, "try it now" deep
  links into the real interface, and info buttons throughout the app that deep-link to
  the right lesson section. The narration audio files are present and load locally.

**KeyWi Bird (Stream Deck control surface)**
- Connect any Stream Deck model directly from the browser; each size gets a curated
  default layout. Full setup studio: saved profiles, per-key relabeling/colors/art,
  bind keys to specific cues, pads, or OBS scenes by name, live-learn mapping,
  import/export of layouts, deck themes, layouts-as-pages, and a full on-screen
  preview mode that works with no hardware plugged in.
- Dials drive volume, prompter speed, text size, scrub, rundown row, and the show
  clock; the touch strip shows live readouts. Whether the touch-strip display works on
  the physical newest-model deck is **unclear** — the code follows the documented
  protocol but the project's own notes say only real hardware can confirm it.
- OBS Studio control from the deck: streaming, recording, virtual camera, replay,
  scene switching (by slot or name), and mutes, with live glow feedback on the keys.

---

## Partly built

Each item ends with the single most important thing that's missing.

- **Creating a new session from the dashboard.** The three-step "New Session" wizard is
  fully designed and wired, but partway through it calls an internal helper that was
  deleted in an earlier change and never replaced — the button gets stuck on
  "Creating…" and no session is created. *Missing: restoring that one deleted internal
  step (the same missing step can also break the accounts page if it's opened very
  early after load).*

- **Instructor sign-in, end to end.** The sign-in code on both pages is complete, and
  the app knowingly runs in a compatibility mode until launch steps happen. *Missing:
  the one-time console-side setup — enabling the sign-in method, creating the first
  admin account, and deploying the new access rules — which the project's own
  checklist shows as still open, so as of this reading nobody can actually sign in.*

- **Cloud backup trail of sessions.** Session snapshots to the cloud (deduplicated,
  admin-gated, merged into the history view with restore and delete) are fully coded.
  *Missing: they depend on the same undeployed access rules, and until those are
  deployed every cloud save fails silently and only the on-device history works.*

- **Conflict-proof simultaneous paperwork editing.** Today two people can edit
  paperwork at once with autosave and presence, which works well when they're in
  different sections. A much finer-grained merge engine — built precisely so two
  people editing the *same* section can't overwrite each other — is finished, tested,
  and wired in. *Missing: it ships switched off (deliberately, until every user's
  browser has the new code), so the same-section overwrite window still exists.*

- **Accounts and paid plans.** A complete account/entitlement model runs on every
  launch: tiers, offline grace, per-platform capability tables, and a mechanism to
  hide features by plan. It is deliberately inert — everyone gets everything, which
  matches the owner's "full-function web app now, no pricing" direction. *Missing:
  beyond the switch being off, there is no server component anywhere that could ever
  grant a paid plan, and no interface element actually uses the hiding mechanism.*

- **OBS Studio control inside the playback tool.** A complete OBS integration exists
  inside Outrangutan (per-cue scene changes, connection settings, status), but a
  switch in the code hides all of its interface. *Missing: turning that switch on —
  until then OBS control is only reachable through the separate KeyWi Bird deck
  screen, while the planning documents still describe the playback-tool version as
  shipped.*

- **Offline support.** The app installs and works offline for the main surfaces, with
  a disciplined update-and-reload flow. *Missing: because of a mismatch between the
  site's short web addresses and the offline lookup logic, opening the dashboard (or
  the operator window) by its short address while offline serves the wrong page; also
  only some of the icon set is pre-cached, and a request for a missing file can get a
  wrong page permanently cached in its place.*

- **Second-operator script window.** A standalone pop-out control desk for a dedicated
  script operator — transport, formatting, slates, clocks, themes — is complete and
  carefully engineered. *Missing: the styling for its keyboard-shortcut help overlay
  was never copied over from the main app, so pressing "?" there dumps unstyled text
  at the bottom of the window instead of showing the shortcut card.*

- **Talkback (the two-channel push-to-talk audio tool).** Both halves — the small
  native audio program for the Mac and the Stream Deck side — are complete, coherent,
  click-free by design, and integrated into KeyWi Bird. *Missing: by the project's own
  milestone table it has never been verified against the actual audio interface it was
  written for, and its instructions describe an older naming and claim a part is
  "not started" that is in fact built.*

- **Extra request-verification security layer.** A second security perimeter (verifying
  that requests come from the real app) is fully staged in both pages with a rollout
  runbook. *Missing: it ships disabled with an empty key, pending the documented
  rollout steps.*

---

## Not built

- **Stage Plot** (the stage-layout paperwork item). Heavily planned — it has its own
  design-consultation document and a scheduled build window — but there is zero code
  for it anywhere. The paperwork presets even anticipate switching it off "once it
  exists."
- **Any way to pay.** No purchase flow, no store hookup, no way to grant a paid plan.
  (Deliberately deferred by the owner.)
- **Any server-side component.** The product is a static site plus a cloud database;
  there are no server functions at all. Everything that assumes one (plan grants, a
  more private student roster) is future work.
- **Training videos.** The lessons have a "watch the video" slot built into their
  layout, but no lesson has a video, and the project decision on where videos will be
  hosted is still open.
- **Driving a show on another machine from the deck.** The deck code contains a
  placeholder for a future "cloud" mode, but the switch for it can never currently be
  reached.
- **Changing an instructor's password from the interface.** A change-password function
  exists in code but nothing calls it; the documented reset path is a script kept
  outside this repository.
- **The native Mac / iPad / iPhone apps.** The capability system is written to
  anticipate them (including a hard "no playback engine on iPad/iPhone" rule), but no
  native app code exists here.

---

## Things I found that worry me

1. **The dashboard's "New Session" button is broken by a deleted helper.** A previous
   change removed an internal function but left two places still calling it. This is
   the clearest regression in the codebase and it sits on a primary instructor flow.

2. **The release is frozen mid-deploy, and the app is built to fail quietly about it.**
   The hardened access rules, the sign-in enablement, the first admin account, and the
   security-perimeter rollout are all staged but (per the project's own checklist)
   not done. Many features detect the "rules not deployed yet" condition and silently
   degrade — cloud snapshots, admin reads, group/assignment reads. That's thoughtful
   engineering, but it also means broken cloud behavior produces no visible error, so
   it's hard to tell from the outside which of these paths has ever worked in
   production.

3. **Old and new systems are running in parallel in at least six places.** Notes
   storage (new per-note records with a live fallback to the old single-list format),
   note attachments (two storage layouts, both read and swept), role assignments (a
   new canonical record system plus three legacy shapes that are still written on
   every save), the paperwork sync engine (new engine dark, old engine live), the
   prompter's messaging (every message is sent twice, once on a modern channel and
   once on a legacy channel with no sunset plan), and the admin identity (the new
   sign-in system deliberately keeps feeding the retired one so old code keeps
   working). Each is a managed migration, but together they are a lot of standing
   complexity, and none has a written end date.

4. **Dozens of accidental duplicate files are committed.** Roughly 35 files whose
   names end in " 2" / " 3" / " 4" (a byproduct of Mac file copying) are checked in —
   including duplicated code, tests, documentation, icons, and audio. They are
   byte-identical to their originals and referenced by nothing. A few of them are also
   deployed to the live site.

5. **140 MB of machine-generated build output is committed** under the talkback tool —
   about 1,700 files including a compiled program, debug symbols, lock files, and a
   cache tied to one specific machine. The ignore list has no entry to prevent it, so
   it will keep happening.

6. **A finished, styled session-creation flow in the main app is unreachable.** The
   "Create a Session" window, its success screen, and their logic all exist, but
   nothing anywhere opens them — session creation moved to the dashboard (where it is
   currently broken; see item 1). Either dead weight to delete or an abandoned
   migration to finish.

7. **A meaningful amount of orphaned code.** About two dozen functions with no callers,
   including two complete live-view renderers from a previous design, an entire
   per-department cue-sheet preview that never got a button, and several superseded
   helpers. None of it runs, but it will confuse future work.

8. **The documentation disagrees with the code in both directions.** The talkback
   instructions describe features as "not started" that are built, and old names for
   things that were renamed; the playback tool's notes describe resizable panels that
   were removed; the plans describe its OBS integration as shipped when it's hidden;
   one referenced recovery page doesn't exist in the repository at all.

9. **The safety net has holes.** The internal consistency checker doesn't know about
   seven of the files the main page actually loads (and thinks the dashboard loads
   none); there is no automated test-runner configuration, so the substantial test
   suite only runs if someone remembers to run each file by hand; and the two largest
   untested modules are the deck controller and the OBS client.

10. **A latent crash in the output-window messaging.** If a playback output window
    keeps sending its heartbeat while the main window is rebuilding its bookkeeping
    (which happens during cleanup), an unguarded message handler can throw an error.
    Narrow timing, but it's in the live path.

11. **Two access rules are broader than they look.** The student directory can be
    listed by anyone without signing in (a documented, deliberate residual that the
    rules file itself warns not to "clean up" casually), and any signed-in account —
    not just admins — can list the instructor directory.

12. **Small dashboard leaks.** The "Recently Deleted" section stays visible when you
    switch to the Accounts page, and the dashboard is excluded from the installable
    app entirely (no offline registration, no update prompt), even though the offline
    system pre-caches it.

---

## Design consistency

Checked against the 2.1 design reference document. One important framing fact first:
a recorded owner decision explicitly demoted that document to "reference, not hard
rules," specifically to keep Cueola's own color themes instead of the reference's
palette — so the app's different colors are a choice, not drift. The structural rules,
however, were adopted, and there the picture is mixed.

**Where the app genuinely follows it:** semantic color tokens with per-theme overrides
almost everywhere; motion is fully disabled for reduced-motion users on every animated
page; the frosted-glass treatment is confined to toolbars, panels, and overlays (never
content), as the guidelines require; the standard icon system is used across the main
app; primary buttons follow the capsule shape rule; screen-edge safe areas and visible
keyboard-focus outlines are in place.

**Where it plainly doesn't:**

- **Text sizing ignores the reference wholesale.** The reference calls for scalable
  text sizes and a 17-point body; the app uses fixed pixel sizes everywhere (about
  1,100 of them, zero scalable), a 14-pixel body, and roughly 160 text sizes *smaller*
  than the smallest step the reference allows. A user's system font-size preference
  has no effect anywhere.
- **Spacing is mostly off-grid.** The reference specifies an 8-pixel grid with
  4-pixel subdivisions; about two-thirds of the actual spacing values (odd 5/6/7/9/10/
  11/14-pixel paddings) don't sit on it.
- **Corner rounding is ad-hoc:** fourteen different corner radii are in use against a
  three-value token set, and the main dialog doesn't use the token that the
  guidelines say dialogs must use.
- **No automatic light/dark mode.** The reference says to honor the system's
  light/dark setting from the start; the app never checks it. Theming is a manual
  picker, eight of nine themes are dark, and someone whose computer is in light mode
  gets a dark app. The one light theme also flashes dark on every page load, because
  the theme is applied by the very last script.
- **Contrast falls short on the third-level text tone.** The dimmest text color —
  used hundreds of times for hints and metadata at small sizes — fails the
  reference's required contrast ratio in eight of the ten palettes, and the
  higher-contrast accessibility preference doesn't correct it.
- **The 44-pixel touch-target rule (called "non-negotiable" in the reference) is met
  unevenly.** The main app lifts its controls to 44 pixels on touch screens, but the
  dashboard's rename button is 24 pixels with no touch adjustment, its main
  session-card buttons stay small, and the second-operator window — built to be used
  on a second screen or tablet — has no touch sizing at all.
- **"Never hardcode colors" is broken at scale — and between the app's own pages.**
  There are five separately hand-copied versions of the nine theme palettes (main
  app, dashboard, operator window, prompter, and the staged design-system files),
  and they disagree: the dashboard's version of the default theme is measurably
  different colors from the main app's version of the same theme; the dashboard's
  theme picker previews swatches from the *prompter's* palette, which neither page
  actually renders; and the dashboard offers the Outrangutan theme without having
  any styling for it, so choosing it silently does nothing.
- **The dashboard is a full design generation behind the main app.** It uses emoji
  where the icon-system sweep replaced them everywhere else, opaque dialogs where the
  main app moved to glass, drop shadows the main app formally retired, and none of
  the newer design tokens (materials, radii, spacing, durations) at all.
- **The staged design-token files in the repository are labeled reference-only and
  are not loaded by any page** — which is documented and fine — but the main app's
  own hand-copied version of those tokens has since drifted from the staged ones
  (different radii, blur, control heights, and animation timings), so whenever that
  migration resumes it will inherit a fork.
