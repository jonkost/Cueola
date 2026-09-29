# Cueola Dress Rehearsal Checklist

A scripted end-to-end rehearsal that reproduces the **AVT Lab** show conditions:
the exact situations that failed in the live run this build was hardened against.
Run it start to finish before any real show. Every step lists its **expected**
result; anything else goes on the punch list (P0 blocks release · P1 fix now ·
P2 defer).

**Environment:** Chrome or Edge on the operator machine (full feature set).
One extra device (phone/laptop) for the Flowmingo follower.

---

## 0 · Setup (10 min)

- [ ] Generate the test media set if `test-media/` is missing: `scripts/make-test-media.sh`
      → 16:9 / 4:3 / 9:16 bars, two stills, an SFX tone, plus two deliberately broken files.
- [ ] Create a real (non-demo) session; note the code. Build a rundown with **≥ 3 segments**,
      segment 3 titled **“Questions”**; ≥ 6 rows total with script text on most rows.
- [ ] Open **Outrangutan** (same tab, Session mode, same code). Import `bars-16x9.mp4`,
      `bars-4x3.mp4`, `bars-9x16.mp4`, `still-16x9.png`. **Expected:** all import with
      correct durations/dimensions in the Inspector.
- [ ] Import `corrupt-truncated.mp4` and `unplayable-prores.mov`. **Expected:** both
      **rejected at import** with a clear toast. They must never become cues.
- [ ] Drop `sfx-ding.wav` on an SFX pad; name it. Link rundown cells: segment-3 playback
      cell → the 16:9 cue (tick **Roll this clip on TAKE**); one audio cell → the SFX pad.
- [ ] Open the **output window**, drag to the second display, fullscreen.
- [ ] On the second device, open Flowmingo with the show code. **Expected:** script
      loads; talent heartbeat shows **Connected** in Cueola.

## 1 · Preflight (2 min)

- [ ] Settings ▸ Production ▸ **Preflight**. **Expected:** every row green:
      script, talent prompter, cloud sync, playout links, playout media
      (decodable + dimensions known), SFX banks, cloud round-trip (< ~1 s), theme assets.
- [ ] **Failure drill part 1:** in Outrangutan, delete the 4:3 cue’s media from the
      library (or link a cell to a since-deleted cue), rerun preflight.
      **Expected:** a red fail row naming the cue, with a **Row N →** jump that lands
      on and flashes the right rundown row. Undo the damage; preflight green again.

## 2 · Full run (15 min)

- [ ] **Go Live** (via the preflight panel: the button should read “Go Live”, all green).
- [ ] TAKE start → finish with the **arrow keys only** (Script Op panel open the whole
      time, the AVT “second computer” fix). **Expected:** follower mirrors every
      TAKE within ~1 s; no blanking, flashing, or scroll jumps anywhere; each media
      cue letterboxes/pillarboxes correctly (16:9, 4:3, 9:16, still).
- [ ] Entering the segment-3 “Questions” row: **Expected:** the linked 16:9 cue
      **rolls on TAKE** (the cell's TAKE chip; a pre-roll count shows first if set),
      ON AIR shows in the cell, count-out clock runs.
- [ ] Fire the **SFX** button on the live row. **Expected:** effectively instant sound
      (same tab); follower shows the transient green “SFX · name” chip.
- [ ] **Pause/resume mid-video:** `P` mid-clip, wait 5 s, `G`. **Expected:** playback
      resumes from the pause point (not the top). Playout keys `G/P/S`, `Shift+S`
      fade, `Shift+Esc` PANIC all work from the Cueola live screen.
- [ ] **Scrub-and-recover:** press `/`, scrub far away with the wheel, **Esc**.
      **Expected:** talent screen never moved. Press `/` again, scrub to a specific
      row, **Enter**. **Expected:** talent screen cues exactly there; `C` re-cues to
      the current row and the show continues cleanly.
- [ ] **Failure drill part 2 (pull a media file):** while a clip is ON AIR, delete its
      media from the Outrangutan library (or fire a cue whose media you removed).
      **Expected:** program cuts to **black slate** (never a frozen frame or hang),
      one non-blocking toast, cue marked ⚠, the **next GO fires normally**, and the
      failure appears in the show log with a timestamp.
- [ ] Mid-run, force-quit the browser (⌘Q / kill). Reopen Cueola. **Expected:** the
      entry page offers **Resume**: one click returns to the live screen at the same
      row with Script Op reopened; Outrangutan re-enters with its recovery bar
      (“Standby at m:ss”) and GO resumes from the persisted offset.

## 3 · Post-show (3 min)

- [ ] Settings ▸ Production ▸ **Show Log**. **Expected:** a coherent timestamped
      story of the run: TAKEs, GOs, the pause/resume with offsets, SFX fires,
      the failure drill error, the resume event. **Export .txt** produces a
      readable file.
- [ ] Save the rundown (**Cmd+S**) → `ShowName.cueola`; edit a row; **Cmd+S** again.
      **Expected:** same file updated in place, no duplicate downloads. Save the
      Outrangutan show → `.ogshow`. Reopen both from disk; everything intact
      (including pad → bank links).
- [ ] Leave the session deliberately (Exit → front page). Reopen the app.
      **Expected:** **no** resume banner (intentional leave never offers recovery).

## 4 · Show drills (10 min, updated for 3.0)

- [ ] **Status rail death + recovery.** Close the talent window mid-run.
      **Expected:** within seconds the **System status** rail opens and its
      Flowmingo row turns red and says why; **Recover Flowmingo** opens a
      fresh talent window and the rail closes once it connects.
- [ ] **Roll on TAKE.** Link a clip with **Roll this clip on TAKE** ticked and
      a 3 second **Pre-roll**, then TAKE onto that cue (TAKE button or right
      arrow). **Expected:** the banner counts **ROLLING IN 3, 2, 1** and the
      clip rolls. Run it again and press **S** during the count: nothing rolls
      and the banner says **CANCELLED**. Once more and press **G**: it rolls
      at once.
- [ ] **Manual clip.** Untick **Roll this clip on TAKE** on a linked cue.
      **Expected:** the cell shows **MANUAL**, a TAKE onto it rolls nothing,
      and the **GO** button on its card in **Focus** view fires it.
- [ ] **First clip ready.** Fresh session, media linked, before any TAKE.
      **Expected:** preflight's **Playout first GO** row says whether the
      first clip is ready (press **Arm again** if it offers it); the first TAKE
      then rolls the clip with sound, no second press.
- [ ] **Director hand-off.** On the rundown bar, tap the **DIRECTOR** chip and
      pick a signed-in student. **Expected:** the student sees "You are the
      director." and a **Go Live** button. While the student is connected,
      your TAKE is off; **Take back** returns it to you.
- [ ] **Question lane.** Paste a line from a real chat, **Enter**.
      **Expected:** talent shows the QUESTION card inside the bounded band
      (script still readable); **Esc** clears it everywhere.
- [ ] **Overlay toggles, both directions.** **Tech Difficulty** / **Color bars**
      → "Back on air", a pushed Question card, and the clock chips, from Script
      Op, the pop-out and Flowmingo Op. **Expected:** every on/off lands on
      talent, script readable throughout.
- [ ] **Rival operator.** Open a second operator window and take the prompter.
      **Expected:** the first window toasts "Another operator window took the
      prompter" and follows it. No silent split-brain.
- [ ] **Cloud restore vs a stale client.** Leave one browser on an old rundown
      state (offline), restore a cloud snapshot from Session History on the
      other. **Expected:** restore wins everywhere when the stale client
      reconnects: re-stamped, never reverted; a recovery copy of the
      pre-restore state appears in History.
- [ ] **Instructor Sign In.** Admin tools locked until sign-in; wrong password
      refused; signed-in dashboard lists sessions and codes.
- [ ] **Groups.** Break into groups on the dashboard; student picks at the
      door; instructor's Reviewing picker flips paperwork + exports; **Lock
      groups** removes the student's Switch group option.
- [ ] **Start Next Episode.** Clone a finished session from the dashboard.
      **Expected:** name auto-increments ("Ep 12" → "Ep 13"), rundown +
      paperwork carried, "↳ From" chip present, crew joins fresh with the new
      code.

## Pass bar

All boxes checked with expected results, **zero console errors**, and the punch
list free of P0/P1 items. Then the build is production-ready.
