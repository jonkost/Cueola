# The teleprompter today: what exists and where it fumbles

Written Nov 23, 2026, before the redesign. Plain list. The mockups in this folder are the answer to it.

## The screens that exist today

1. **Talent screen** (Flowmingo). Top bar, the script, a control panel, a Settings sheet, a "Link a show" sheet.
2. **Script Op inside Live.** A side panel with a text box, a Push button and four tabs (Playback, On air, Clocks, Display).
3. **Script Op pop-out.** The same four tabs in its own window. It only works on the same computer as the Live window. Close Live and every control goes dead.
4. **Flowmingo Op** (Remote Op). A third operator screen. This is the only one that works from another computer.
5. **Stream Deck** (KeyWi Bird). About 28 prompter keys and four dials.
6. **Script cue** in the rundown's Script column, with its own small formatting bar.

So there are three operator screens, and each one was built separately.

## The same control, different on each screen

| Control | Talent screen | Script Op | Flowmingo Op | Stream Deck |
| --- | --- | --- | --- | --- |
| Play | "Play" | "Play" | "Play", different icon code | "SCROLL" |
| Speed | minus, slider, plus, number | slider only | slider only | "SPD+" "SPD-", no number on the key |
| Size | minus, slider, plus, number | slider only | slider only | "A+" "A-" |
| Reverse | one "Reverse" toggle | "Reverse" and "Forward", hidden under More | same | "REV" "FWD" |
| Brake, Boost | no button, keys only | hidden under More | hidden under More | "BRAKE" "BOOST" |
| Go to the row on air | none | "Cue Now" | "Cue Now" | "CUE ROW" |
| Clock | none | Time, Duration, Count to, Hide | same | "TIME" "DUR" "TO TIME" |
| Hide controls | "Hide controls" | "Hide controls" | same | "HIDE UI" |
| Row chips | "Row info chips (NEXT and HOLDING)" | "Row info on talent" | same | none |
| Overlay size | "Clock and question size" | "Overlay size" | same | none |

Other mismatches:

- Formatting buttons differ by screen. The cue editor has Bold, Break, Stop, Update. Script Op has Bold, Italic, Update, Break, Stop, Paragraph, in another order. Flowmingo Op has none.
- "Into script" (add a question to the row) is on Script Op only.
- The keyboard list has 18 rows on the talent screen and 10 on Flowmingo Op, with different wording.
- These panel controls have no Stream Deck key at all: Cue Next, Find, Tech difficulties, Color bars, hide the clock, custom wrap time, a typed question, align, read line, width, theme, row info.
- The "Link" button turns into "Load" after any error.
- Buttons are different sizes and some are outlined, some filled, one is a green capsule ("Push to prompter").

## Where it fumbles live

- **The script is one long text.** The rundown rows are glued into one text and pushed. Whatever was typed by hand in Live wins until the next TAKE rebuilds it. This is the root of the "talent kept reading old words" problems.
- **A script loaded on a linked talent screen only changes that screen.** The next push from an operator silently replaces it.
- **Opening the Link sheet or Flowmingo Op stops the roll.**
- **If Flowmingo Op loses its link it disables its controls and does not try again.** The talent screen does retry.
- **The pop-out depends on the Live window.** Not on the show.
- **The same four problems keep coming back in the changelog:** operators locking each other out (Sep 28, Sep 29, Nov 23), a jump on TAKE or scroll (Oct 16, Nov 23), stale script (Oct 16, Nov 12), link and heartbeat (Sep 29, Oct 16).

## Formatting problems seen in the demo show

- **Crew notes are shown to the talent.** "Roll to air", "Nat sound up full" and "Name / Title" appear on the talent screen in big italic letters.
- **Rows with no script leave big empty gaps** the talent has to roll through (Back to Anchor, Sports Highlight).
- **Italic does not work.** The Italic button types stars, and the talent screen shows the stars.
- **"HOST:" only counts as a speaker in capitals.** "Host:" is read as script.
- **[UPDATE] means nothing.** It is drawn as a dim note.
- **The editor is a plain text box of symbols** with no picture of what the talent will see.
- **Word and Pages files keep bold but lose italic.**
- Two rows with the same number collide and one can fail to redraw.

## What the new design does about each

| Problem | Answer | Mockup page |
| --- | --- | --- |
| Three operator screens | One operator panel, in Live and in its own window, linked by show code | 3, 4 |
| Different names, icons, sizes | Fifteen controls, defined once | 1 |
| Stream Deck does not match | The deck is the same fifteen, key for key | 8 |
| One long pushed text | The script lives in each row. No Push button | 7, 9 |
| Crew notes on the talent screen | Only script cell words go to the talent | 2, 7 |
| Typed symbols | Five formatting buttons, live preview | 7 |
| Link drops | Talent screen holds the whole script and keeps rolling | 2, 10 |
| Not sure a press landed | Controls light only when the talent screen confirms | 4, 8 |
| Show codes | One picker with your shows, shared shows, and a code box | 5 |
