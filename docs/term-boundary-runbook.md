# Term-Boundary Rotation Runbook (v2.1 Phase 10)

What to run at the END of a term and again just BEFORE the next one starts.
Everything here is an owner action — nothing runs automatically. Time cost is
roughly 20 minutes end-of-term + 10 minutes pre-term.

Companion docs: [app-check-rollout.md](app-check-rollout.md) (rules deploy +
App Check console steps) · [admin-accounts-runbook.md](admin-accounts-runbook.md)
(admin account minting).

---

## A. End of term — retire the class

Order matters: archive before wiping, wipe before revoking (students may still
open the portal until their code dies).

### A1. Session archive / purge decision

For each session on the dashboard, decide: **keep**, **archive**, or **purge**.

- **Keep** — active or reference productions. No action.
- **Archive** — worth keeping but done: export the paperwork package
  (Export PDF Package) and save a `.cueola` rundown file to local storage,
  then soft-delete on the dashboard (sessions carry `deletedAt`/`deletedBy`;
  restore removes both). Soft-deleted sessions stay in Firestore.
- **Purge (Delete Forever)** — the dashboard's hard delete sweeps the session
  doc **plus all five subcollections** (`files`, `notes`, `assignments`,
  `groups`, `snapshots`). This is the PII-retention path — snapshots embed
  student names in paperwork, so any session with real student data that
  won't be needed next term should be purged, not archived.

If a subcollection sweep logs `denied by deployed rules`, the deployed rules
predate the staged ones — deploy the current `firestore.rules` first
(app-check-rollout.md section 2) and re-run the delete.

### A2. Cloud-snapshot wipe for KEPT sessions

Purged sessions lose their snapshots with the purge. For sessions you keep
across the boundary, prune the cloud trail: Session History → cloud rows →
delete old captures (each shows reason + timestamp). Snapshots are the one
place old rosters linger invisibly — an April snapshot restored in November
resurrects April's student names. Keep at most the latest known-good capture.

### A3. Revoke the term's class keys

Dashboard → class-code panel → revoke every code minted for the ending term
(`active:false`, stamped `revokedAt`/`revokedBy` — revoked codes stay for
audit; rules forbid deleting them). Revoking kills new profile creation and
the entry gate for those codes immediately. Student profiles created under a
revoked code continue to exist (they're history, not access).

### A4. Admin account review

`admins/` collection: remove accounts for anyone who should not carry admin
into the new term (super-admin action; you cannot delete your own doc —
lockout guard). Email/Password users are disabled in the Firebase Console
separately (Authentication → Users).

---

## B. Before the new term — fresh keys, fresh perimeter

### B1. Mint the new term's class keys

Dashboard → mint new codes (student + admin roles as needed, labeled with the
term, e.g. `FALL26-STUDIO-A`). Minting is admin-gated by the deployed rules.
Hand codes out through the class channel, not the repo or any public page.

### B2. Rules deploy — release-day sequence (D8 rule 3)

If `firestore.rules` in the repo is ahead of the deployed ruleset (it is at
Phase 10: admin-gated `list` on `sessions` and `accessCodes`), deploy in this
order only:

1. Hosting deploy (clients that understand the tightened rules).
2. Fleet refresh (every show machine reloads — WORKER_SCHEMA bump covers it).
3. Instructor/admin accounts confirmed working (sign-in on the dashboard).
4. Rules deploy (REST API path documented in app-check-rollout.md §2).
5. Smoke: student join + export still work; dashboard code panel still lists;
   a signed-OUT browser can no longer enumerate `sessions` or `accessCodes`
   from the console.

Rollback copies live at `docs/rules-rollback-*.rules` — snapshot the live
ruleset text into a new dated file BEFORE deploying.

Known residual, on purpose: `profiles` list stays open — student crew exports
and roster hydration read it without Auth (university no-student-passwords
rule). Perimeter is App Check. Don't tighten it without moving roster
resolution server-side first (3.0).

### B3. App Check enforcement flip

Precondition: the monitor has run across **all five surfaces** (Cueola,
dashboard, script-operator, Flowmingo talent window, Outrangutan output
window) with real traffic and shows ~100% verified requests.

1. Console → App Check → Firestore → **Enforce**.
2. Immediately smoke every surface: join, sync, notes, export, talent window,
   output window, script-op popout, dashboard.
3. Negative check: an unregistered client (curl / clean browser profile with
   App Check debug token absent) gets `permission-denied`.
4. If anything breaks: un-enforce (monitor mode), diagnose, re-flip. The flip
   is instant both directions and loses no data.

If the term starts well after Aug 2, enforcement may deliberately wait for
this pre-term flip — that call needs the term date (decision 0).

---

## C. Quick checklist

End of term:
- [ ] Export/archive or purge every session (purge = PII wipe incl. snapshots)
- [ ] Prune cloud snapshots on kept sessions
- [ ] Revoke all term class keys
- [ ] Review admins/ + Console Auth users

Pre-term:
- [ ] Mint labeled new-term codes
- [ ] Deploy any staged rules in the D8 sequence (rollback copy first)
- [ ] App Check: monitor data reviewed → enforce → five-surface smoke +
      negative check
