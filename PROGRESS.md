# PROGRESS — Cueola Production-Readiness Build

Tracks execution of `CUEOLA MASTER PLAN.md`. Every session: read the plan, then this file.

## Phase status

- [x] **Phase 0 — Discovery & architecture audit** *(complete — awaiting gate approval)*
  - [x] Repo map (language, framework, build, platform, run/deploy commands)
  - [x] Four surfaces located (rundown, script op, Outrangutan, Flowmingo) + communication paths
  - [x] Show-state model documented (Firestore session doc, snapshot fan-out, dedup, follower model)
  - [x] Media pipeline documented (import/probe/IndexedDB, decks, Web Audio, fit, outputs)
  - [x] Test/CI inventory (1 script, no CI/framework) + lightweight-harness proposal
  - [x] `docs/ARCHITECTURE.md` written; §6 questions answered (time-up, wrap, themes, keyboard)
  - [x] Risk list (5 items) posted
- [x] **Phase 1 — Branding refresh** *(complete — awaiting gate approval)*
  - [x] New SVGs located: `assets/Brand/` (Cueola_Icon, Planda Bear, Flowmingo_Icon, Outrangutan_icon — all 2026-07-02, 1024×1024)
  - [x] Artwork-usage inventory shown to operator; **approved: all replacements + Outrangutan icon on the output-window tab** (2026-07-04)
  - [x] dashboard.html sprite replaced with real exports (lockstep with index.html sprite)
  - [x] Favicons replaced in index.html / dashboard.html / outrangutan/output.html — now reference the source SVGs directly (`assets/Brand/…`) instead of stale data-URIs; output window uses the Outrangutan icon. *(Deviation from the announced "data-URI" mechanism: file refs keep one source of truth per plan rule 3 — no duplicated copies to drift; ~4 KB/page saved.)*
  - [x] Verified: entry page (visual), Outrangutan title bar (visual), dashboard sprite + favicon (DOM + 200 on `assets/Brand/Cueola_Icon.svg`), Flowmingo setup logo (`#ic-flowmingo` resolves from the same verified sprite; setup screen itself skipped because a script was already linked)
  - [x] Stale-artwork sweep: zero hits for old data-URI koala or removed gradient ids across all HTML/JS; PDFs inherit the sprite (html2canvas render path — no embedded logo assets)
  - [x] No `?v=` bump needed (only HTML changed; HTML is not immutable-cached)
- [x] **Phase 2 — Outrangutan media engine core** *(complete — awaiting gate approval)*
  - [x] §4 test-media generator added: `scripts/make-test-media.sh` → `test-media/` (gitignored): 16:9/4:3/9:16 H.264, stills, SFX tone, ProRes + truncated broken files
  - [x] Item 1 diagnosed & reproduced (root causes below) — aspect ratio ruled out (fit uses CSS `object-fit`, no fixed canvases)
  - [x] Import-time probe v2: duration + dimensions + aspect stored; undecodable/damaged files **rejected at import** with a clear toast (ProRes + truncated MP4 verified rejected); 8 s stall guard; dims shown in Inspector ("640×360 · 16:9")
  - [x] Stills first-class: `image/*` import (PNG/JPEG/WebP/SVG/GIF via Image decode), yellow cue type, control `<img>` deck + output-window layer, contain fit + scale/pos, fades, hold-until-advanced or optional duration (Decisions #3) with auto-continue/follow honored
  - [x] Pause/resume: GO doubles as RESUME while paused (button relabels); resumes from offset (verified 1.49 s → 2.2 s continuous); offset persisted on pause + every 10 s during play; recovery banner offers "Standby at 0:02" and GO resumes there after a full reload (verified 2.28 s → 2.43 s)
  - [x] Graceful failure: deck `error` handled on control + outputs → **black slate** (Decisions #4), non-blocking toast, cue flagged ⚠ (self-clears on next successful play), show stays advanceable (verified via injected decode error); `play()` rejections now distinguish autoplay-block vs decode death; outputs report `error` back to the controller
  - [x] Cue-ahead preload (scoped per plan item 7: control-side decks; outputs load on demand): next armed cue staged on the idle deck — verified readyState 4 before GO; skips broken cues; invalidated on reorder/delete/stop/panic

**Phase 2 verification (2026-07-04, preview browser):** import rejects both broken files while 16:9/4:3/9:16/stills import with correct dims; all three aspects fire ON AIR with `object-fit:contain`; still holds (HOLD clock) then auto-follows after its 2 s duration; simulated mid-show decode death → IDLE + black deck + ⚠ badge + next GO fires the following cue; reload-recovery resumes at the persisted offset; zero console errors throughout.

**Phase 2 root causes (reproduced 2026-07-04 in preview):**
1. *Silent import of unplayable media* — `probeMedia` resolves `{duration:0}` on `error` instead of rejecting, and `storeFile` accepts anything the OS labels video/audio with no decode check; broken/unsupported files become normal-looking 0:00 cues whose failure only surfaces at showtime. (`webPlayable()` exists but only gates the optional, default-off transcode path.)
2. *Unhandled deck errors at fire time* — `beginMedia` never listens for the deck `error` event and mislabels `play()` rejections as "Playback blocked"; firing a ProRes .mov leaves the UI showing **ON AIR** over a black program (`DEMUXER_ERROR_NO_SUPPORTED_STREAMS`), no alert, no fallback. The output window (`output.html doPlay`) has the same two gaps with rejections swallowed entirely.
- [x] **Phase 3 — Rundown stability & sync hardening** *(complete — awaiting gate approval; gate 2→3 passed 2026-07-04)*
  - [x] Bug reproduced & measured: 20 simulated playout writes (700 ms cadence) → **21 full rundown-table rebuilds** (once per snapshot, even with the screen hidden); after the fix the identical storm produces **0 renders / 0 DOM mutations**
  - [x] Root cause fixed: `renderRundown()` ran unconditionally on every snapshot; `renderLive()` full-innerHTML rebuilds reset scroll (the visible flash); playout status flaps triggered full live re-renders for state the live grid doesn't even display
  - [x] Fingerprint-gated snapshot renders + deferred dirty-render flush when the rundown screen next shows (verified: 1 flush render)
  - [x] Live-status changes patch rundown badges **in place** (`data-outbadge`), never rebuild tables; renderLive preserves reader scroll unless the live position moved
  - [x] Versioned updates: publisher stamps `ts` (+ monotonic `seq` tiebreak); receivers drop stale out-of-order packets (verified: 60 s-old packet dropped)
  - [x] Throttling per Decisions #5: continuous playout state stays ~1 Hz; discrete cue/status events broadcast immediately; presence heartbeat already 30 s
  - [x] Follower resilience: explicit **SYNC RECONNECTING** chip in the live overview (shows on offline event/cached snapshots, clears on the next server snapshot — verified both ways); Firestore resyncs full state on reconnect; follower mirror verified (activeIdx 3 → lsIdx 3, exactly one render)

**Phase 3 root causes (reproduced + measured 2026-07-04):**
1. Every Firestore snapshot ran an unconditional `renderRundown()` (full `#rdBody` innerHTML rebuild) and any live-view trigger ran full-innerHTML `renderLive()` — so Outrangutan's ~1.4 Hz playout publishing (plus presence/clock writes) rebuilt tables continuously, resetting scroll and flooding the main thread; on one machine running rundown + script op + playout simultaneously (the AVT setup), that manifests as the segment blanking/flash while followers starve.
2. Found while verifying the fix: Firestore serializes **map keys in a different order on local-echo vs server snapshots**, so any plain `JSON.stringify` equality gate flaps between data-identical snapshots (measured: ~1 render per own-write echo/server pair, 254 rebuilds in a 105 s soak). All snapshot-diff gates now use a key-sorted `stableStringify`. Post-fix: 0 renders under the same storm on both the rundown and live screens.
- [ ] Phase 4 — SFX system
  - [x] *(pulled forward 2026-07-04, operator request)* Bank renaming verified end-to-end: double-click **or new ✎ button on the active tab** opens inline rename; Enter commits, Esc cancels; names persist across reload; cues/pads reference banks by stable id, so renames never break links (pad stayed in its bank through two renames + reload).
- [ ] Phase 5 — Single-operator control
- [ ] Phase 6 — Control & inspector redesign
  - **Operator scope additions (2026-07-04):**
    - Planda Bear: tighten the whole surface — cleaner interface, less chrome, denser where it helps (falls under the Phase 6 inventory + card/row proposal step; show layouts before implementing, per plan).
    - Messaging: the messaging system (Message Center + Planda Bear notes/threads) must **look and function well** — treat as an explicit Phase 6 acceptance criterion.
    - Builder settings menu: consolidate file-level actions (Export PDF, Save File, Open File, etc.) into the settings menu to declutter the topbar. *(Pulled forward — implemented 2026-07-04, see below.)*
- [ ] Phase 7 — Production hardening
- [ ] Phase 8 — Dress rehearsal & release

## Decisions Log (⚠️ answers — never re-ask)

| # | Phase | Question | Answer | Date |
|---|---|---|---|---|
| — | — | *(none recorded yet)* | | |

**Gate 0→1 passed 2026-07-04** ("Proceed to Phase 1"). The two gate questions went unanswered; defaults adopted until overridden:
1. *Commits:* Claude does **not** commit — standing repo practice wins over plan rule 6 until the operator says otherwise. Work is left staged-in-tree for operator commits; gate tags deferred likewise.
2. *Pre-plan changes:* remain uncommitted in the tree; Phase 1 builds on them.

| # | Phase | Question | Answer | Date |
|---|---|---|---|---|
| 1 | 1 | "Make a new run" meaning — does a run/template concept embed branding? | **Finding from code:** no run/show-template embeds artwork (shows store no imagery; PDF exports render live HTML and inherit the sprite automatically). Reading confirmed as "refresh brand assets + rebuild." | 2026-07-04 |
| 2 | 2 | Default fit policy | **Contain** (letterbox/pillarbox); cover/fill stay selectable per cue | 2026-07-04 |
| 3 | 2 | Stills with fixed duration? | **Yes, optional** — default hold-until-advanced; per-cue duration arms auto-advance | 2026-07-04 |
| 4 | 2 | Failure slate | **Black slate** + non-blocking operator alert | 2026-07-04 |
| 5 | 3 | Continuous playhead on followers? | **~1 Hz coarse** — cue/status changes exact + immediate; remaining-time ticks at ~1 s granularity (fits the one-doc Firestore write budget) | 2026-07-04 |

## Known state / pre-plan work already in the tree (uncommitted)

Done earlier in this session, before the master plan was adopted:
- Ops surfaces modernized: Script Op sidebar, Flowmingo Op overlay + standalone panel (Transport-first ordering, responsive grid, theme-swatch row), Outrangutan scopes rebuilt (DPR-crisp, graticules, vectorscope targets) + count-clock now scales with pane width **and** height.
- Sweep: `.DS_Store` untracked + ignored; dead CSS rules removed; cache-busting `?v=` bumped.
- **Branding (Phase 1 overlap):** new brand SVGs live in `assets/Brand/` (Cueola, Planda Bear, Flowmingo, Outrangutan). index.html sprite (`#ic-*` symbols) rebuilt from the real exports (class styles → fill attributes, blend modes precomputed). Front page restyled: icons sit beside their titles (hero row + card grid). `.brand-ico` now clips (fur bleeds past viewBox) with 22.5% radius.
- **Front page verified (post-gate touch-up, operator-requested):** all six entry cards share the icon-beside-text layout; Demo/Blank Slate glyphs got the same rounded-tile treatment as the brand icons; their pills moved to a full-width row (was ~2px from overflowing the half-width cards — now 51px slack). Zero console errors.
- **Phase 1 leftovers:** dashboard.html sprite still carries interim hand-drawn versions (needs the real exports); other derived assets (favicon, PWA/touch icons, docs imagery) not yet audited; in-app icon sites beyond the front page (Flowmingo setup logo, Outrangutan title bar, rundown cue badges) render the new sprite but haven't been visually re-verified.

## Deferred items

- Hardened Firestore rules exist in-repo but are **not deployed**; App Check unconfigured; admin-code rotation owed (pre-plan security audit). Likely lands with Phase 7 hardening unless prioritized sooner.
- Entitlement gating intentionally disabled (`GATING_ENABLED=false`) — full-function web, by prior owner decision.

## Known issues (from audit; to be reproduced per plan rule 3 in their phases)

- ~~No import-time media validation; no still-image support; GO after pause restarts from trim-in; no failure slate~~ **fixed in Phase 2** (2026-07-04).
- ~~"Questions"-segment blanking; no sequence numbers on sync~~ **reproduced, root-caused, and fixed in Phase 3** (2026-07-04). Continuous playhead stays ~1 Hz by design (Decisions #5).
- No central keymap; shortcuts fragmented per surface (Phase 5).
- No error boundaries, no show log, no preflight (Phase 7).
- Console noise at boot: entitlement `permission-denied` retries + App Check warning (known, by design pre-hardening).
- Outrangutan narrow layout (<920px): count-clock and inspector text overlap in the stacked column view (pre-existing; observed 2026-07-04 during Phase 1 verification). Live ops run at desktop widths; queue for Phase 6 panel rework.

## Manual QA checklist (grows every phase)

**Smoke test (§4 of plan)** — run at every gate once media features exist:
1. Session with ≥3 segments, segment 3 "Questions" with active playout; media set 16:9 + 4:3 + 9:16 + still; ≥1 SFX cue (post-Phase 4); one Flowmingo follower connected.
2. Advance start→finish: no blanking/flashing; follower mirrors throughout; media fits correctly; pause→trigger resumes at pause point; zero console errors/crashes.

**Phase 0 additions:** none (read-only phase). Baseline boot check: app loads at dev server with no console errors beyond the two known notices.

**Phase 2 additions (Outrangutan):**
1. Run `scripts/make-test-media.sh`; import all of `test-media/` — the two `unplayable-*`/`corrupt-*` files must be rejected with toasts; the rest import with correct durations/dims.
2. Fire 16:9, 4:3, 9:16 in sequence — each letterboxes/pillarboxes (never distorts); stills hold with HOLD clock; a still with a duration auto-advances.
3. Play → Pause (button reads RESUME) → GO — playback continues from the pause point.
4. Pause mid-clip → reload the page → recovery banner shows "Standby at m:ss" → GO resumes there.
5. With a cue playing, check the idle deck is preloaded (instant next GO).
6. Failure drill: fire a cue and kill its media (or use a corrupt file smuggled past import) — program cuts to black, toast appears, cue gets ⚠, next GO works.

**Phase 3 additions (sync/stability):**
1. With a follower connected and playout running in segment 3, watch the live view for ≥5 min — no blanking, no flashing, no scroll jumps while reading elsewhere in the rundown.
2. Kill the network on a follower (Wi-Fi off) — the yellow **SYNC RECONNECTING…** chip appears in the live overview; restore network — chip clears within one heartbeat and the position resyncs.
3. Show caller advances rows rapidly — followers mirror each advance within ~1 s, one render per advance.
4. Rundown edits made by a collaborator mid-show appear once (no repeated rebuild churn); the build screen refreshes when you switch back to it.
