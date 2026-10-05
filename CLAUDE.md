# Working on Cueola

Cueola is a classroom TV-production app built by Jon, an instructor. Students use it to build a rundown, run a show live, read a prompter, play clips and drive it all from a Stream Deck. Everything here is written so a student can understand it. Work the same way.

## How to talk to Jon

- Plain words. Say what changed the way you would say it to a student, not to a developer. "The clock now counts 29.97 drop-frame" is fine; "refactored the formatter" is not.
- Short messages. Lead with the result. One idea per sentence.
- No jargon unless it is TV vocabulary (take, standby, roll, cue, lower third, drop-frame). No code names, function names, file paths or commit hashes in a reply unless Jon has to go there.
- When a change could go two ways, show a screenshot and ask one clear question. Do not build the big version and hope.
- If something cannot be done, say so in one sentence and offer the nearest thing.

## What must never change without Jon saying so

- The rundown is a table: rows across, one cell per department (Video, Audio, Playback, GFX, Lighting, Script), each cell with its two lines (READY and TAKE, or the department's own words). Simplify inside the cells, never the table.
- Live keeps the same table with the same columns plus State and Time.
- The "Who worked on what" log in Planda Bear stays.
- The frame-rate setting stays. The house standard is 1080i at 29.97, so the clocks count 29.97 drop-frame by default.
- Lesson text is read aloud by recorded narration. Do not change lesson words; the recordings are made from them on Jon's machine.
- An empty time or date box shows dashes (--:--), never a time. Safari on a Mac paints "12:30 PM" (or today's date) into an empty box by itself. Chrome does not, and the preview pane and the smoke tests are Chrome, so a check there proves nothing. `cueola-blank-time.js` covers it on every page that has a time box. A new page with a time or date box must load that file. Do not use a combined date-and-time box: Safari paints into those too and the file does not cover them. To see what Safari shows, run `BLANK_TIME_SHOTS=/tmp/shots node scripts/tests/blank-time-safari.browser.mjs` on a Mac and look at the pictures. Not on a Mac? Tell Jon; do not call a time-box change done.

## How the app is built

- Plain HTML, CSS and JavaScript. No build step. `index.html` holds the markup and all the styling; `cueola-app.js` holds the app; smaller pieces sit beside them (live state, cue model, prompter, playback, Stream Deck, planner sync).
- The show lives in one shared document in the cloud. Every open window reads the same one.
- The live position is one shared record with a sequence number. Only the director's TAKE moves it.

## Before anything goes live

Run all of these and fix what fails. Do not push with a red check.

```
node scripts/check-contracts.mjs        # every button and id resolves
for f in scripts/tests/*.test.mjs; do node "$f"; done
node scripts/tests/live-smoke.browser.mjs
node scripts/tests/cue-editor-smoke.browser.mjs
node scripts/tests/join-smoke.browser.mjs   # a signed-in join by code, the path the demo never takes
node scripts/tests/blank-time-safari.browser.mjs   # Mac only: empty time boxes in Safari's own engine
node scripts/bump-cache.mjs              # after any change to a script file
```

Take a screenshot of anything you changed on screen and look at it before you say it is done.

## Git

- `main` is where Jon works and what the live site serves.
- Commit locally as you go. Push only when Jon says push. Never force-push `main`.
- One change per commit, with a message a student could read.

## Where things are written down

- `CHANGELOG.md`: what each release changed, in plain language.
- `docs/v3-glossary.md`: the one word for each thing.
- `docs/v3-debloat-plan.md`: what was trimmed and what still waits on Jon.
- `docs/INSTRUCTOR_QUICK_START.md`: how Jon sets up a show.
