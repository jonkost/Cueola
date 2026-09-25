# Cueola 3.0 setup flow audit (§2.5)

How a show gets set up and how more computers join it today, step by step, with a shorter proposal. Line numbers are for `main` at 2bda83d. Everything that makes multi-computer connection work is listed in §4 and is kept.

## 1. Today, screen by screen

### Front door (`#entry`, index.html 5278-5408)

Seven equal cards, a resume banner, a guide link, a theme gear, and a footer. No single primary action.

| Card | Copy | Action |
|---|---|---|
| Your sessions | "Sign in with your username and the sessions assigned to you are one tap away. No password." (a PIN is in fact required next) | username → Sign in → PIN → session rows |
| Planda Bear | "View and build the paperwork package for your session." pill "Show code required" | separate join modal |
| Flowmingo | "Open the script display for talent, or run a remote operator without going live in Cueola." | Talent Display / Remote Op |
| Outrangutan | "Cue and play video & sound effects for a live show. Best in Chrome or Edge." | Session / Standalone |
| KeyWi Bird | "... Sign in, then connect." pill "Any Stream Deck" | deck setup |
| Demo | "Load a pre-built example rundown. No login needed." | Enter demo |
| Blank Slate | "Make your own code and work in it together." pill "Free text setup" | local or shared free-text show |
| footer | "Are you an instructor?" | Open Instructor Dashboard |

The subtitle leads with four brand names. A signed-out visitor who taps "Have a show code?" is sent to the profile portal after signing in, not back to the join (`openJoinSession` passes no `returnTo`, cueola-app.js 5218-5223).

### Instructor: dashboard (dashboard.html)

1. Sign in (username + password) — modal ships open.
2. "Create a New Session" → a 3-step wizard: Show name (required), code (optional), start time; "Who can join" (code only / code + class key, default class key); paperwork presets. Next → ×3.
3. "Session Ready": big code, share URL, Copy, "Open Rundown →". The copy says "Anyone with the code can return" while the default requires a class key.
4. Rundown opens in a new tab with `?code=` (the `cueola_session` handoff).

### Student: join

Sign-in is two stages everywhere (username, then PIN / set PIN with class key / instructor password). There is **no role picker**: role is `instructor` only with a live admin auth session, otherwise `student` (5312). "TD", "Director" and the rest exist only as Planner roster positions (3764-3790) set by the instructor; they bias the director picker's suggestion.

Five separate screens ask for the same show code: `#modal-stud` "Join a Session", `#modal-prepro-join` "Open Planda Bear", Outrangutan's `#og-join`, the Flowmingo Connect card and "Link a show" overlay, and the Flowmingo Op code bar; plus the Show setup select and Blank Slate. Each re-implements "Your sessions / Have a different code?".

### Rundown screen

Go Live is the clear primary, among twelve toolbar controls, and it is shown to students too: a student must press Go Live and sit through the operator's preflight ("Ready to go live?" → "Continue Anyway") just to watch.

### Director seat

The `controlGrant` doc field, granted and revoked only by an instructor from the CALLER chip / Live badge → "Hand rundown control" picker (index.html 6053-6060). Copy: "The chosen student drives GO, playback calls, and the prompter for everyone, with the same sequential safety rail instructors get..." The grant only demotes the instructor while the holder is present.

### Go Live

Preflight (four groups, ~14 rows, fix verbs) then, once per device, a second confirmation "Ready Before Show", then Live.

### Show setup launcher (`#modal-workspace`)

Picks the show, copies a talent link, opens the prompter / Script Op / Planner / playback / KeyWi windows on chosen displays, and joins this tab. Silently does nothing for an instructor signed in only through the dashboard (no profile), 16417-16418.

### Other doors

`/plandabear`, `/outrangutan`, `/keywibird`, `/flowmingo`, `?app=`, `?prepro=1`, `?prompter=1`, `?scriptop=`, `#flowop`, `#promptypus`, `?operator`: nine URL spellings that all resolve through `autoJoinFromDashboard` (31680-31864) and the one entry gate (31641-31665).

## 2. Tap counts today

| Flow | Taps | Typed inputs |
|---|---|---|
| Instructor creates a show and goes live (cold dashboard) | 9 | 3 |
| Same with a remembered instructor session | 7 | 1 |
| Student with an assigned show joins on a second laptop and sees Live following the director | 5 | 2 (username, PIN) |
| Same, show not yet assigned | 7 | 3 |
| First-time student (profile wizard first) | 11 | 7 |
| Talent iPad from the copied link, already signed in | 0 | 0 |
| Talent iPad from the front page | 4 | 2 |

Of the instructor's nine taps, two are wizard steps that add nothing for a quick show and two are the preflight plus the second confirmation.

## 3. Proposed flow

One primary action per screen, plain words, fewer steps. Words follow docs/v3-glossary.md.

**Front door.** One card: "Sign in" (username, then PIN). Under it, one line: "Have a show code? Join show". Signed in: your shows as rows, each with one button "Open"; "New show" for instructors. Brand cards move to a small "Tools" row (Prompter, Playback, Planner, Stream Deck, Demo) that opens the same show. The subtitle becomes one sentence without brand names.

**Instructor: new show.** One screen: Show name, Start time (optional, blank by default), "Students must sign in" (on). Create. The code appears on the rundown header with a Copy button and the join link; no separate "Session Ready" screen. 3 taps, 1 input.

**Student: join.** One join screen for every door: "Join show: show code" then "Join". If the device is signed in it lists your shows first. Every tool (Prompter, Playback, Planner, Stream Deck) opens this same screen with its own title, never its own copy of it. After joining, a student lands on the rundown in **follow mode** with one button: "Watch live" (no preflight, no checklist). 3 taps, 1 input; 1 tap when the show is already on the profile.

**Director seat.** Instructor's rundown header shows "Director: You" with one button "Make someone director"; the picker lists connected people with their position; the Director position is offered first. The student sees "You are the director" and a TAKE button. The instructor keeps "Take back". Same grant field, same rules.

**Go Live.** For the director: "Open Live" opens Live at once; the preflight becomes a status strip on Live (green / amber rows with the same fix buttons) rather than a gate. "Ready Before Show" folds into the planner checklist page and is never a second dialog.

**Show setup.** Keep the launcher (it is the multi-computer feature) but rename it "Open windows", drop the show picker when a show is already open, and keep the talent link with one Copy button. Fix the no-profile no-op.

**URLs.** Keep `?code=`, `?prompter=1`, `?prepro=1`, `?app=` and the `/plandabear` `/outrangutan` `/keywibird` `/flowmingo` doors. Retire `#promptypus`, `?promptypus`, `#flowop`, `?operator` (keep `?scriptop=` as a redirect since older links exist).

Proposed counts: instructor create-and-go-live 5 taps / 1 input; student join and watch 2-3 taps / 1 input; talent link 0.

## 4. Kept as is (multi-computer plumbing)

Presence entry, 30 s heartbeat and the 90 s activity window; `participants`; `controlGrant` and its held-elsewhere rule; the entry gate and class-key check on every door; `noteJoin` attaching codes to profiles; the dashboard `cueola_session` handoff; `?code=` in every window's URL so reload = rejoin; `cueola_last_code` shared across apps; the launcher's window names, display placement and Script Op arming; the talent joining the doc's prompter `sessionId`; the `fixRequests` lane; the resume record; the leave path; `kicked` / `movedTo`; the link strip model.

## 5. Copy to fix on the way (from docs/v3-copy-audit.md)

"session" → show everywhere in this flow; "Class Keys" / "class key" / "Class login code" / "Login code" → class key; "Join Session" → Join show; "Connect" / "Load" / "Link a show" → Join show; "CALLER" / "VIEWER" / "INST" / "STU" badges → Director / Following; "the Air" → the playback computer; "No password" → "No password. Your PIN is next."; `docs/INSTRUCTOR_QUICK_START.md` is stale on the PIN step.

## 6. Open questions for Jon

- Should students land straight in Live (following) after joining, or on the rundown with "Watch live"?
- Should the "Students must sign in" default stay on?
- Is the standalone Blank Slate mode still needed, or is it a "free text" toggle on any show?

## 7. Shipped in 3.0

From section 3: the one-screen New show dialog (dashboard) and Watch live for everyone but the director (the preflight and the Ready Before Show prompt are the director's only). Not yet done, pending the open questions and the copy approval: the single join screen for every door, the front-door rework, the Director seat wording, the preflight-as-status-strip, the launcher rename, and retiring the old URL spellings.
