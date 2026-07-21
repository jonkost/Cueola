# Cueola — Dress Rehearsal Checklist

A scripted end-to-end rehearsal that reproduces the **AVT Lab** show conditions —
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
      **rejected at import** with a clear toast — they must never become cues.
- [ ] Drop `sfx-ding.wav` on an SFX pad; name it. Link rundown cells: segment-3 playback
      cell → the 16:9 cue (AUTO on advance); one audio cell → the SFX pad.
- [ ] Open the **output window**, drag to the second display, fullscreen.
- [ ] On the second device, open Flowmingo with the session code. **Expected:** script
      loads; talent heartbeat shows **Connected** in Cueola.

## 1 · Preflight (2 min)

- [ ] Settings ▸ Production ▸ **Preflight**. **Expected:** every row green —
      script, talent prompter, cloud sync, playout links, playout media
      (decodable + dimensions known), SFX banks, cloud round-trip (< ~1 s), theme assets.
- [ ] **Failure drill part 1:** in Outrangutan, delete the 4:3 cue’s media from the
      library (or link a cell to a since-deleted cue), rerun preflight.
      **Expected:** a red fail row naming the cue, with a **Row N →** jump that lands
      on and flashes the right rundown row. Undo the damage; preflight green again.

## 2 · Full run (15 min)

- [ ] **Go Live** (via the preflight panel — button should read “Go Live”, all green).
- [ ] Advance start → finish with **arrow keys only** (Script Op panel open the whole
      time — the AVT “second computer” fix). **Expected:** follower mirrors every
      advance within ~1 s; no blanking, flashing, or scroll jumps anywhere; each media
      cue letterboxes/pillarboxes correctly (16:9, 4:3, 9:16, still).
- [ ] Entering the segment-3 “Questions” row: **Expected:** the linked 16:9 cue
      **auto-fires** (AUTO badge), ON AIR shows in the cell, count-out clock runs.
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
      entry page offers **Resume** — one click returns to the live screen at the same
      row with Script Op reopened; Outrangutan re-enters with its recovery bar
      (“Standby at m:ss”) and GO resumes from the persisted offset.

## 3 · Post-show (3 min)

- [ ] Settings ▸ Production ▸ **Show Log**. **Expected:** a coherent timestamped
      story of the run — advances, GOs, the pause/resume with offsets, SFX fires,
      the failure drill error, the resume event. **Export .txt** produces a
      readable file.
- [ ] Save the rundown (**Cmd+S**) → `ShowName.cueola`; edit a row; **Cmd+S** again.
      **Expected:** same file updated in place, no duplicate downloads. Save the
      Outrangutan show → `.ogshow`. Reopen both from disk; everything intact
      (including pad → bank links).
- [ ] Leave the session deliberately (Exit → front page). Reopen the app.
      **Expected:** **no** resume banner (intentional leave never offers recovery).

## 4 · v2.1 drills (10 min) — *(added Phase 11, 2026-07)*

- [ ] **Link strip death + recovery.** Close the talent window mid-run.
      **Expected:** TALENT goes dark within seconds; System status shows the
      failure truthfully; **Recover Flowmingo** opens a fresh talent window and
      the strip returns within seconds of it connecting.
- [ ] **Automatic call.** GO on a row with linked media. **Expected:** the call
      banner runs **READY → TRACK → ROLL → TAKE** and the clip fires; run it
      again and press **S** mid-call — nothing fires, banner clears.
- [ ] **Manual TAKE.** Toggle **Manual TAKE (armed call)**. **Expected:** GO
      arms the clip (banner holds at READY), **TAKE · G** fires it.
- [ ] **Playout ARMED proof.** Fresh session, media linked, before any GO.
      **Expected:** PLAYOUT reads **· NOT ARMED** and preflight's "Playout
      first GO" row explains why; after arming, first GO fires media (sound
      included) with no second press.
- [ ] **Question lane.** Paste a line from a real chat, **Enter**.
      **Expected:** talent shows the QUESTION card inside the bounded band
      (script still readable); **Esc** clears it everywhere.
- [ ] **Overlay toggles, both directions.** Question / **NTSC Bars** → "Back on
      air" / clock chips from BOTH operator surfaces. **Expected:** every
      on/off lands on talent, script readable throughout.
- [ ] **Rival operator.** Open a second operator window and take the prompter.
      **Expected:** first window toasts the takeover, badge flips to
      FOLLOWING — no silent split-brain.
- [ ] **Cloud restore vs a stale client.** Leave one browser on an old rundown
      state (offline), restore a cloud snapshot from Session History on the
      other. **Expected:** restore wins everywhere when the stale client
      reconnects — re-stamped, never reverted; a recovery copy of the
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
