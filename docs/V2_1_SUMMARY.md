# Cueola 2.1: What Changed and Where Things Stand

Written 2026-07-21 for the owner. Plain language, organized by what you see and
do. The technical release record is CHANGELOG.md; the remaining QA work is
docs/V2_1_CHECKOUT.md.

---

## 1. What kind of release 2.1 is

2.1 is mostly a reliability, accounts, and recovery release. Most of its work
is deliberately invisible: sign-in infrastructure, cloud snapshots, live-link
recovery, Safari and iPad compatibility, and training material. The visual
system (the capsule button style, 44px touch targets, info popovers) landed in
Phase 9, but as a kit applied to the primary buttons, not as a top-to-bottom
restyle of every surface. Two visual decisions also carried over from earlier
direction: the Live screen keeps its original V2 look (your call, after the
Phase 8 restyle was rejected), and the Stage Plot redesign is parked for your
design consult. So if you walked the app expecting every screen to look new,
what you saw was accurate: most screens were not supposed to look different.
Section 5 covers what we changed today to close the gap between that plan and
what you actually wanted.

## 2. What is new in 2.1, by area

**Accounts and sign-in (the biggest piece).**
Instructors and admins now have real accounts: username and password, built on
Firebase Auth. Students still use class login codes and profiles, never
passwords. The dashboard gets an Accounts panel where a super admin creates
instructor accounts with temporary passwords. Access-code minting and session
deletion are admin-gated. None of this is usable yet; see section 4.

**Cloud snapshots.**
Every join of a session by a signed-in admin captures a compressed snapshot of
the show to the cloud. Session History shows local and cloud rows together,
restore goes through the one safe restore path, and purge cleans the whole
trail. This is the "a machine died and we lost the show" insurance. Also
blocked behind section 4.

**Live reliability.**
The link strip (CLOUD, TALENT, PLAYOUT, SCRIPT) with per-subsystem Recover
buttons, the CALLER/FOLLOWING/VIEWER badge, honest rival-operator takeover, the
ARMED first-GO proof, the automatic RTRT call (READY, TRACK, ROLL, TAKE, with S
to abort and Manual TAKE), the question lane, and live drag-reorder. These are
the answers to the July show failures.

**Identity, groups, paperwork.**
Student profiles with avatars and a portal, the entry gate with class keys,
per-group paperwork workspaces with exports that follow the group, paperwork
presets (Intro course vs Full production), verified export stamps, and Start
Next Episode cloning.

**Platform.**
Safari and iPad support work (storage persistence, import warnings, PDF print
path, tap-to-unmute on outputs, 44px touch targets), a full PWA icon set, and
double-click-to-open for .cueola and .ogshow files in the installed app.

**Training.**
Nine narrated Learning Hub lessons, the instructor Quick Start, the admin crib
sheet, the operator card, rehearsal drills, and ten video scripts waiting to be
recorded.

## 3. What 2.1 did not change, on purpose

- The Live screen skin. Your decision from the Phase 8 review: new functions go
  under the original V2 look.
- The Script Operator pop-out page. 2.1 added keyboard shortcuts there but no
  visual changes at all. Your impression that it looked untouched was correct.
- Stage Plot. Parked for your design consult (docs/stage-plot-consult.md has
  the seven questions; answer them and the build starts).
- The dashboard's overall look, beyond the Accounts panel and capsule primaries.

## 4. Why you cannot sign in to create accounts, and the exact fix

The account system shipped dark. Three one-time setup steps have never been
done, and each one blocks the next. Until they happen, sign-in fails on
purpose, with the message "Sign-in is not enabled yet (console errand
pending)." This is the single blocker behind "I can't log in to create things
for new users." The steps, in order (full detail in
docs/admin-accounts-runbook.md and docs/V2_1_CHECKOUT.md section 1):

1. **Firebase console, about 5 minutes.** Project `cueola`: Authentication,
   Sign-in method, enable Email/Password. Also turn on email enumeration
   protection, and generate a service-account key (Project settings, Service
   accounts) saved into ~/Documents/Cueola-recovery-local/.
2. **Deploy the rules.** The full 428-line firestore.rules in the repo is
   staged and tested; production still runs the pre-account rules, which is why
   the app cannot even read who is an admin. Deploy with the local REST tooling
   in ~/Documents/Cueola-recovery-local/ (same as the 2026-07-15 deploy). Do
   this before your first sign-in.
3. **Mint your super admin.** Run the local bootstrap script:
   `node ~/Documents/Cueola-recovery-local/cueola-bootstrap-admin.mjs <key.json> <username> "<Full Name>" '<password>' super`
4. Sign in on the dashboard, open Accounts, and create instructor accounts.

I can drive steps 2 and 3 with you in one sitting; step 1 has to be you in the
console.

## 5. Fixed today (2026-07-21, this session)

- **Version now reads 2.1.0** in all three places (entry screen, Settings,
  the JS constant). It said 2.0.0 because the flip was a release-day checklist
  step that never ran when hosting shipped early.
- **Call sheets: more than one now works.** Adding a second sheet used to
  silently collapse back into the first within seconds. Cause: the
  anti-corruption dedup added after the P2607 incident could not tell an
  intentional new day (same crew, blank schedule) from a corruption duplicate.
  User-added sheets are now explicitly marked and never folded, and a new sheet
  starts dated the day after its source.
- **Live and Script Op text size.** New A / A buttons in the Script Op panel
  head scale the panel, the NOW/NEXT cue preview cards, the follower cue strip,
  and the Flowmingo op overlay together (85% to 150%, remembered per machine).
  The pop-out Script Operator page has the same control under Formatting,
  "Panel Text." Buttons scale with the text, not just the type inside them.
- **The info "i" lost its circle.** Bare accent-colored glyph now, everywhere.
- **Button and field shapes unified.** One radius token for utility buttons and
  every text field and text area; capsules for the confirming filled buttons
  (empty-rundown, admin add, field Go, paperwork primary); pills for the entry
  card badges. This closes the "every button a different shape" gap between the
  entry page's updated buttons and the rest of the app.
- **Em dashes removed from user-facing copy** across the app, dashboard,
  Outrangutan, identity, sign-in, exports, and all nine guide lessons (about
  330 occurrences). Empty-value dashes in tables and clocks stay; those are
  data, not prose.
- **Changelog finalized** for 2.1.0 (no longer a draft).
- Full test run: 17 suites, the DOM contract check, and entitlements all pass.
  The one failing suite (paper-export-contract) was broken before 2.1 and is
  already chipped.

## 6. Found while auditing, not yet acted on

- Two branches hold unmerged work: whole-show Stream Deck control (built
  2026-07-21, tests included) and a Planda Bear build-side notes panel plus a
  "time elements not saving" fix (from June, may be stale or already fixed
  another way). Both need a decision: merge, rebuild, or drop.
- The dashboard beyond the Accounts panel has not had the shape-token sweep;
  same for some deep Outrangutan inspector controls. Cosmetic, listed so it is
  not forgotten.

## 7. Still owed before 2.1 is truly done (docs/V2_1_CHECKOUT.md)

Section 1 console errands (blocks the most), section 2 solo browser QA,
section 3 two-machine drills, section 4 Safari/iPad hardware pass, section 5
installed-PWA checks, section 6 hardware and video recording errands. Your
planned full-show screen recording with timecode fits section 3 exactly and is
the single most useful thing you can hand me.
