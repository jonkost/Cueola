# Admin Crib Sheet (v2.2, 2026-07)

The one-pager for anyone holding an admin account. Bold terms are exact UI
labels. Deeper procedures: [admin-accounts-runbook.md](admin-accounts-runbook.md) ·
[term-boundary-runbook.md](term-boundary-runbook.md) ·
[app-check-rollout.md](app-check-rollout.md).

## The vocabulary

| Term | What it is | Where |
|---|---|---|
| **Your sessions** card | The front door. Students sign in by username (no password) and their assigned sessions are one tap away; typing a code lives behind the **Have a session code?** link. | Front page |
| **Class Key** / class login code | Term-long code students use to create a profile and pass entry gates. Two names, one thing: dashboard says "Class Keys", the apps say class login code. | Dashboard **Class Keys** panel |
| **Profile / username** | A student's identity everywhere. Created once with a class key, **no password**. | Front-page **Your sessions** card |
| Session code | The per-show code the crew shares. New codes are year + month + four letters (e.g. `2607KWXR`); older short codes still work. | Dashboard / **Blank Slate** |
| **Portal** | The student's home: session cards, their position, open to-dos, unseen notes. | Inside **Your Cueola profile** |
| **Entry Requirement** | Per-session door policy: show code only, or show code + class key (profile sign-in required). | Dashboard session settings |
| **Groups** | Per-group paperwork inside one session. **Break into groups**, **Lock groups**; instructor **Reviewing** picker drives view + exports. | Dashboard + in-app group bar |
| **Start Next Episode →** | Clone a finished session. Rundown + paperwork carry, name auto-increments, **↳ From** chip links back. | Dashboard **Next Episode** panel |
| **Session History** | Snapshot trail, local + cloud. Restore replaces the rundown for everyone (re-stamped; recovery copy saved first). | **Settings ▸ File ▸ History** |
| **Instructor Sign In** | Firebase-backed sign-in with your instructor account (username + password); accounts are minted, not self-registered. | In-app admin panel / dashboard |
| **Account Management** | Super admins mint/disable instructor accounts (temp password on first sign-in). | Dashboard ▸ **Manage Accounts** |

## Admin account facts

- Two levels: **super** (can mint/remove accounts) and **standard**.
- Nobody can delete their own account (lockout guard).
- Session **delete** and class-key **minting** are admin-only at the rules
  layer; students never see those controls.
- Need a sandbox? The front-page **Demo** card loads Campus News with no
  login. The Break Room (the full advanced show) appears on that card only
  once you sign in as an instructor. The dashboard's Create Test Show button
  seeds a real cloud session to poke at.

## The four errands only admins can run

1. **Mint class keys** each term; **revoke** them at term end
   (term-boundary-runbook A3/B1).
2. **Purge sessions with student data** when a production wraps for good.
   Delete Forever sweeps paperwork, notes, assignments, groups, AND cloud
   snapshots (the PII wipe).
3. **Cloud restore** during a crisis: Session History ▸ pick the snapshot ▸
   Restore (everyone gets it; recovery copy saved first).
4. **App Check / rules deploys** at term boundaries; follow the runbooks.
   The order depends on the change: ADDITIVE rules blocks (new collections)
   deploy **before** hosting; TIGHTENING changes deploy **after** the fleet
   is refreshed and signed in (term-boundary-runbook §B2 has the sequence).

## When a student says "it won't let me in"

1. Signed in at all? The front page's **Your sessions** card is the way in:
   username, **Sign in**, tap the session. If a session isn't on their card,
   it isn't assigned to their profile; they can still enter through
   **Have a session code?** with the code.
2. Which door is refusing? Show code (session exists? spelled right? new
   codes are 8 characters, like `2607KWXR`) vs class key (revoked? wrong
   term's key?).
3. Forgot their username? Look them up on the dashboard roster; usernames
   are visible to admins.
4. Session requires sign-in (**Entry Requirement**) but they never made a
   profile? Have them tap **New here? Create your profile** with this
   term's class key.
