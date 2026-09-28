# Cueola

A classroom tool for running a TV show. Students build a rundown, run it live, read from a prompter, roll clips and sound effects, and drive it from a Stream Deck. Everyone in the class sees the same show on their own screen.

## What is in it

- **Rundown**: the show, row by row. Each row has a name, a length, and one cue per department: camera, audio, playback, graphic, lighting, script.
- **Live**: the show on air. One button, TAKE, moves everyone to the next cue. Everyone sees the same ON AIR and STANDBY.
- **Flowmingo**: the prompter the talent reads, and the panel the operator controls it from.
- **Outrangutan**: video clips and sound effects, played to a 1920×1080 output window.
- **KeyWi Bird**: the Stream Deck that drives all of it.
- **Planda Bear**: the paperwork: call sheet, production schedule, safety plan, patch sheets, stage plot, production notes.

## Running it

It is a plain web page. Open `index.html` from any web server (the live site is served from `main`). There is nothing to install or build.

## Checking it

```
node scripts/check-contracts.mjs
for f in scripts/tests/*.test.mjs; do node "$f"; done
node scripts/tests/live-smoke.browser.mjs
node scripts/tests/cue-editor-smoke.browser.mjs
node scripts/tests/join-smoke.browser.mjs
```

## Reading more

- `CHANGELOG.md` says what each release changed.
- `docs/INSTRUCTOR_QUICK_START.md` is the instructor's setup guide.
- `docs/v3-glossary.md` is the word list.
- `CLAUDE.md` is the working agreement for anyone (or anything) editing the code.
