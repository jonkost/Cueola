# DEPLOY.md — Launch errands, click by click

*Written 2026-07-26 for the owner. Everything here is done in a web browser
except one step (creating the first admin account), which needs one Terminal
command. Sources: `docs/V2_1_CHECKOUT.md` §1, `docs/admin-accounts-runbook.md`,
`docs/app-check-rollout.md`, the header of `firestore.rules`, and the project
config (`.firebaserc` / `firebase.json`). Anything I could not verify from
those files is flagged, not guessed.*

**The project:** Firebase project ID **`cueola`**, serving the live site
**cueola.live**. The console for it is:

> https://console.firebase.google.com/project/cueola

Sign in with the Google account that owns the Firebase project.

**Do the steps in this order.** The order matters: the access rules must be
published **before** you sign in as an admin for the first time, because your
first sign-in starts writing cloud session backups, and without the rules those
backups fail silently (the project's own checklist re-pinned this on 2026-07-21).

---

## Step 1 — Turn on the sign-in method (~3 minutes)

1. Open https://console.firebase.google.com/project/cueola
2. In the left sidebar, under **Build**, click **Authentication**.
3. Click the **Sign-in method** tab.
4. In the providers list, click **Email/Password** (use **Add new provider**
   if the list is empty), switch **Enable** on, and click **Save**.
5. Still in Authentication, open the **Settings** tab, find **User actions**,
   and turn **ON** "Email enumeration protection". (The admin runbook asks for
   this specifically.)

**What you should see when it worked:** back on the Sign-in method tab, the
Email/Password row shows a green/enabled status. Nothing changes on the live
site yet — no admin account exists until Step 3.

*Why this is safe:* students never get passwords — that stays code-based by
design. This only enables the machinery for **admin** accounts, which use
invisible internal addresses ending in `@admins.cueola.app`.

---

## Step 2 — Publish the access rules (~5 minutes) — DO THIS BEFORE FIRST SIGN-IN

**Can this be done from the web console?** Yes. No command-line tool is needed.
(The previous rules publish on 2026-07-15 used a workaround only because the
command-line tool wasn't installed on that machine — the console editor does
the same job.)

1. In the left sidebar under **Build**, click **Firestore Database**.
2. Click the **Rules** tab. You'll see a text editor with the currently
   live rules.
3. **Safety copy first:** click in the editor, select all the existing text
   (Ctrl/Cmd-A), copy it, and paste it into a note or empty document saved as
   something like `rules-live-before-2026-07-26.txt`. This is your rollback.
4. Now replace the editor's contents with the staged rules. **The exact text
   to paste is the entire contents of the file `firestore.rules` in the
   project folder** (also viewable on GitHub: jonkost/Cueola →
   `firestore.rules` → the "Raw" button makes select-all easy). Open it,
   select all, copy, then in the console editor select all and paste over.
   - I deliberately did **not** duplicate the 428 lines into this document:
     two copies of security rules always drift apart, and the file in the
     repo is the reviewed, authoritative version.
   - Sanity check you got the right thing: the first line must be
     `rules_version = '2';` and near the top there's a comment block starting
     "v2.1 (D1): STUDENTS still have no username/password authentication".
5. The editor checks the text as you paste — if there's a red error marker,
   stop and don't publish (that means an incomplete copy/paste).
6. Click **Publish**.

**What you should see when it worked:** the console shows the new ruleset as
the active one with today's timestamp (a "Rules published" confirmation, and
the Rules tab's version history gains a new entry at the top). Then verify the
live site still behaves: open cueola.live in a private/incognito window,
join or create a throwaway session, type in a rundown row — everything should
work exactly as before. (Students and shows are unaffected by these rules;
what changed is admin-only powers and the new backup/groups areas.)

**Two flags on this step, honestly:**

- **The project's older runbook describes a two-stage rules rollout** (an
  "additive" partial publish first, the full tightened rules only after all
  instructor accounts are created). That two-stage plan was written for a
  world where the old website code was still live. The new site code shipped
  on 2026-07-21 and **no admin account exists yet**, so there is no one the
  tightened rules can lock out — publishing the full staged file in one go is
  the simpler path and, as far as I can verify from the code, safe. But the
  intermediate "additive" text also doesn't exist as a paste-able file in the
  repo, so the two-stage path isn't executable by a non-programmer anyway.
  If you'd rather follow the two-stage order to the letter, that needs a
  developer to compose the intermediate file first — ask and it can be
  generated.
- **The project's own rule-test suite was not run before this.** It requires
  a local emulator plus Java, which this environment doesn't have. The staged
  rules are the reviewed file the docs point at, unchanged — but the "run the
  suite before deploying" step in `docs/app-check-rollout.md` is being
  skipped, and you should know that.

---

## Step 3 — Create the first admin account (~10 minutes, one Terminal command)

This can't be done from the website alone, by design: the very first "super"
admin is created by a small local script that talks to Firebase directly. The
script lives **outside this repository** (deliberately, because it uses a
secret key) at `~/Documents/Cueola-recovery-local/` on the owner's machine.

**Part A — download the secret key (in the console):**

1. Click the **gear icon** next to "Project Overview" (top of the left
   sidebar) → **Project settings**.
2. Click the **Service accounts** tab.
3. Click **Generate new private key**, confirm, and a `.json` file downloads.
4. Move that file into `~/Documents/Cueola-recovery-local/` (your Documents
   folder → Cueola-recovery-local). **Never** put it in the project folder,
   in Dropbox/iCloud shares, or email — it is a master key to the project.

**Part B — run the bootstrap script (in Terminal):**

```
node ~/Documents/Cueola-recovery-local/cueola-bootstrap-admin.mjs \
  ~/Documents/Cueola-recovery-local/<the-downloaded-key-file>.json \
  <username> "<Your Full Name>" '<a-strong-password>' super
```

Replace `<username>` with a short login name (letters/numbers), the name in
quotes, and the password in single quotes. The word `super` at the end makes
this the top-level account that can create all the others.

**What you should see when it worked:**

- The script prints a success message.
- In the console: **Authentication → Users** now shows one user whose email
  is `<username>@admins.cueola.app`.
- In **Firestore Database → Data**: a collection called `admins` with one
  document, containing your username, name, and `level: "super"`.

**Flags:** I can verify the script's name, location, and usage from the
runbook, but the script itself is not in this repository, so I could not
confirm it exists on your machine or test it. Also, running it requires
Node.js to be installed; the runbook shows it was previously run on your
machine through a locally-installed copy. If the command says "node: command
not found" or the script is missing, stop there and ask — don't improvise.

---

## Step 4 — Sign in and verify the whole chain (~5 minutes)

1. Open **cueola.live/dashboard** in Chrome.
2. Click sign in, enter the username and password from Step 3.
3. You should land on the instructor dashboard with your name shown and the
   sessions area loading (it may be empty — that's fine).
4. Create a test session with the **New Session** button (this flow was broken
   until 2026-07-26 — it's fixed in the code, but the fix must be deployed to
   the live site; if the button hangs on "Creating…", the site is serving the
   older code and needs the latest deploy first).
5. Open that session in the main app (its **Rundown →** link), then in the
   console go to **Firestore Database → Data → sessions → (your test code) →
   snapshots**.

**What you should see when it worked:** within a couple of minutes of being
in the session, at least one document appears under that `snapshots`
subcollection. That is the cloud backup trail working — the whole point of
doing the rules before the sign-in. The checklist is explicit: verify by
**seeing the document appear**, not by an absence of errors.

Afterwards, every additional instructor is created from **Dashboard →
Accounts** (visible to your super account): fill name, username, and a
temporary password, and hand those over. No more Terminal needed.

---

## Step 5 — The request-verification layer (App Check): register now, ENFORCE NOTHING

**Recommendation: leave it OFF for now — but do the free half today.**

The project's own runbook splits this into three stages: register (harmless,
collects data), staged-in-code (a developer step), and enforce (the risky
switch). Only the first belongs in this errand run:

1. In the left sidebar under **Build** (or "Security" depending on console
   version), click **App Check**.
2. Register the Cueola web app with the **reCAPTCHA v3** provider. The
   console walks you through creating/entering a reCAPTCHA site key —
   allow the domains **cueola.live** (and **www.cueola.live** if you use it).
3. Make sure it is in **monitor mode** — do **not** click anything named
   "Enforce" on Cloud Firestore.

**What you should see when it worked:** App Check shows the web app as
registered, and over the following days its metrics page starts showing
request counts (verified vs. unverified). That soak data is exactly what the
plan wants before anyone flips enforcement.

**Why not turn it on now:** the website code currently ships with its App
Check bootstrap switched off (an empty key and an off flag in both pages), so
enforcing today would reject the app's own traffic and break the live site.
Turning it on is a deliberate later phase: a developer puts the site key into
the code and flips the code flag, hosting redeploys, the metrics confirm every
real surface shows up as verified, and only then is enforcement enabled — with
the term start date factored in (the checklist's "Decision 0", which is yours
to make). Leave it off until that's done.

**Flag:** the exact console flow for creating the reCAPTCHA v3 key changes
from time to time (it may bounce you to Google's reCAPTCHA admin page to make
the key, then back). The runbook's constants are what matter: reCAPTCHA v3,
monitor mode, cueola.live domain, no enforcement.

---

## Quick recap, in order

| # | Where | What | Proof it worked |
|---|---|---|---|
| 1 | Console → Authentication | Enable Email/Password + enumeration protection | Provider row shows Enabled |
| 2 | Console → Firestore → Rules | Paste full `firestore.rules`, Publish (rollback copy saved first) | New ruleset active with today's date; live site still works |
| 3 | Console → Project settings + Terminal | Download service key, run bootstrap script | User appears in Authentication; `admins` doc in Firestore |
| 4 | cueola.live/dashboard | Sign in, make a test session, open it | Snapshot doc appears under `sessions/<code>/snapshots` |
| 5 | Console → App Check | Register web app, reCAPTCHA v3, monitor mode | Registered; metrics accumulate; nothing enforced |

## Things I am not sure about (deliberately not guessed)

- Whether `cueola-bootstrap-admin.mjs` and a working Node.js actually exist on
  your machine — the runbook says they do, but they live outside this repo.
- Exact wording/placement of console menu items — Google renames and moves
  them; the sequence and the target (provider, rules editor, service
  accounts, App Check registration) are the stable part.
- The two-stage vs. one-stage rules publish (see the flag in Step 2) — I've
  recommended one-stage with reasons, but it deviates from the letter of the
  older runbook.
- The rules test suite was not run in this environment (needs emulator +
  Java); the pasted rules are the repo's reviewed file, unmodified.
- Whether `www.cueola.live` is actually in use — include it in App Check
  domains only if it is.
