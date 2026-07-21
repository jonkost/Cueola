# Admin Crib Sheet (v2.1, 2026-07)

The one-pager for anyone holding an admin account. Bold terms are exact UI
labels. Deeper procedures: [admin-accounts-runbook.md](admin-accounts-runbook.md) ·
[term-boundary-runbook.md](term-boundary-runbook.md) ·
[app-check-rollout.md](app-check-rollout.md).

## The vocabulary (what's new in v2.1)

| Term | What it is | Where |
|---|---|---|
| **Class Key** / **Class login code** | Term-long code students use to create a profile and pass entry gates. Two names, one thing: dashboard says "Class Keys", the apps say "Class login code". | Dashboard **Class Keys** panel |
| **Profile / username** | A student's identity everywhere — created once with a class key, **no password**. | Front-page profile button |
| **Portal** | The student's home: session cards, their position, open to-dos, unseen notes. | Inside **Your Cueola profile** |
| **Entry Requirement** | Per-session door policy — show code only, or **show code + class key**. | Dashboard session settings |
| **Groups** | Per-group paperwork inside one session. **Break into groups**, **Lock groups**; instructor **Reviewing** picker drives view + exports. | Dashboard + in-app group bar |
| **Start Next Episode →** | Clone a finished session — rundown + paperwork carry, name auto-increments, **↳ From** chip links back. | Dashboard **Next Episode** panel |
| **Session History** | Snapshot trail, local + cloud. Restore replaces the rundown for everyone (re-stamped; recovery copy saved first). | **Settings ▸ File ▸ History** |
| **Instructor Sign In** | Firebase-backed admin sign-in inside the apps; accounts are minted, not self-registered. | In-app admin panel / dashboard |
| **Account Management** | Super-admins mint/disable instructor accounts (temp password on first sign-in). | Dashboard → **Manage Accounts** |

## Admin account facts

- Two levels: **super** (can mint/remove accounts) and **standard**.
- Nobody can delete their own account (lockout guard).
- Session **delete** and class-key **minting** are admin-only at the rules
  layer; students never see those controls.

## The four errands only admins can run

1. **Mint class keys** each term; **revoke** them at term end
   (term-boundary-runbook A3/B1).
2. **Purge sessions with student data** when a production wraps for good —
   Delete Forever sweeps paperwork, notes, assignments, groups, AND cloud
   snapshots (the PII wipe).
3. **Cloud restore** during a crisis: Session History → pick the snapshot →
   Restore (everyone gets it; recovery copy saved first).
4. **App Check / rules deploys** at term boundaries — follow the runbooks;
   never deploy rules ahead of the hosting sequence.

## When a student says "it won't let me in"

1. Which door? Show code (session exists? spelled right?) vs class key
   (revoked? wrong term's key?).
2. Profile locked to a username they forgot → look them up on the dashboard
   roster; usernames are visible to admins.
3. Session requires sign-in (**Entry Requirement**) but they skipped the
   profile step → have them create the profile with this term's class key.
