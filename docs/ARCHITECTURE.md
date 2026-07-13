# Cueola Architecture (Phase 0 audit — 2026-07-04)

Read-only findings grounding the CUEOLA MASTER PLAN phases. Line refs are to the
files as of this audit.

## 1. Repo map

| Aspect | Finding |
|---|---|
| Language / framework | Vanilla JavaScript + HTML/CSS. **No framework, no build step, no bundler, no transpile.** |
| App shell | `index.html` (~4.2k lines: all app CSS inline + markup for every screen) |
| App logic | `cueola-app.js` (~13.2k lines, global scope) + `cueola-entitlements.js` (capability layer, gating currently disabled) |
| Playout module | `outrangutan/outrangutan.js` (~2.2k-line IIFE, injects its own DOM) + `outrangutan.css` + `outrangutan/output.html` (chrome-free output window) |
| Instructor dashboard | `dashboard.html` (self-contained page, own CSS/JS/sprite copy) |
| Backend | Firebase **Firestore only** (project `cueola`, shared with Prompt-Up-The-Jam). No auth; open rules in `firestore.rules`; App Check not configured. |
| Hosting | Firebase Hosting site `cueola` → **cueola.live**. SPA rewrites (`/flowmingo`, `/outrangutan`, `/dashboard`, `**` → index.html), strict security headers + CSP, `max-age=31536000,immutable` on assets. |
| Cache busting | Manual `?v=YYYYMMDDx` query strings on `<script>`/`<link>` tags in index.html. |
| Run (dev) | Any static server. Repo convention: `python3 -m http.server 3001` (see `.claude/launch.json`). No console errors expected at boot beyond known entitlement/App Check notices. |
| Deploy | `firebase deploy` (hosting + rules). No build artifacts — the repo root *is* the site. |
| Target platform | Desktop browser (Chrome/Edge recommended for Outrangutan). No Electron/native shell. |

## 2. The four surfaces

| Surface | Entry | Module | Notes |
|---|---|---|---|
| Rundown (build) + Live show-caller | `#rundown`, `#liveshow` screens | cueola-app.js | Rundown rows are "beats"; live position is `lsIdx`. Live bar hosts Start Show / Script Op / Flowmingo Op / fullscreen / Exit. |
| Script Op | `.ls-sidebar` inside `#liveshow`; real-window pop-out via `?scriptop=<code>` | cueola-app.js (`renderLivePrompterControls`, `pushToPrompter`) | Edits live script, pushes to Flowmingo, hosts transport/clock/wrap/alert controls. |
| Flowmingo | Talent display `#promptypus`; standalone remote `#flowOp`; joins by session code | cueola-app.js (`pt*` and `flowOp*` namespaces) | **Works well today — do not regress** (plan §2). Heartbeats prove talent liveness cross-device. |
| Outrangutan playout | `#outrangutan` screen; output windows via `?output=N` | outrangutan/outrangutan.js | Local-first: cues/settings in IndexedDB; session mode links to the rundown. |

## 3. Show-state model

**Authoritative state = one Firestore document `sessions/{CODE}`.** Every
collaborating client holds a single `onSnapshot` on that doc (main app
cueola-app.js:2562; Flowmingo Op :7831; talent screen :8094) and writes with
`updateDoc` field paths. Serialization is plain JSON fields — no schema layer.

Key fields on the session doc:
- `beats` — the rundown; `activeIdx` — show caller's live row.
- `presence.{presenceId}` — `{name, role, lastSeen, following, followingId, idx}`; heartbeat interval refreshes `lastSeen`; each client broadcasts its own `idx` (cueola-app.js:2696).
- `prompter.*` — script text + `version`/`updatedAt`, `control` (remote transport commands), `controlAck`, `talentHeartbeat`, sender/client ids, current/next row metadata.
- `showClock` — shared show start/pause clock. `outrangutan.live` — playout status snapshot (status/cue/remaining) republished ~continuously while playing.
- Planda Bear: `prePro`, `preProNotes`, plus presence page/field sync.

**Ordering/dedup:** there are **no monotonic sequence numbers**. Staleness is
handled ad hoc: `controlId` dedup (`applyRemoteControlOnce`), self-sender
filters (`FLOWMINGO_ENDPOINT_ID`), timestamp freshness windows (talent
heartbeat < 20 s), a 5 s `flowmingoRemoteOverrideUntil` window arbitrating
Script Op vs remote Flowmingo Op, and control-acks with retry/fail timers.

**Same-device transport:** BroadcastChannel/postMessage — prompter messages to
a same-machine talent window, and Outrangutan control→output messaging (one
addressed channel; messages `play/xfade/stop/black/holdLast/fit/key/audio/ping/identify`,
outrangutan.js:450–520). Cross-device sync is Firestore only.

**Follower model:** followers resolve the followed presence's `idx`
(`resolveFollowedIdx`, applied at cueola-app.js:2601) and mirror it into their
own `lsIdx`; students with no explicit target mirror `activeIdx`. There is no
reconnect/resync protocol beyond Firestore's own listener recovery, and no
explicit "reconnecting" UI state (Phase 3 targets).

**Constraint to respect in Phase 3:** a single hot document is both the
strength (one listener) and the bottleneck — every field write re-fires every
client's snapshot, and Firestore sustains only ~1 write/sec/doc, so continuous
playhead broadcast at 4–10 Hz **cannot ride this document as-is**.

## 4. Media pipeline (Outrangutan)

- **Import:** file picker / drag-drop, `accept="video/*,audio/*"` — **no still-image support** (Phase 2 gap). `storeFile` (outrangutan.js:317) puts the raw blob in IndexedDB store `media`; `probeMedia` (:262) captures **duration + a thumbnail only** — no codec, dimension, or decodability validation; unsupported media currently fails at showtime, not import (Phase 2 gap).
- **Playback:** HTML5 `<video>` A/B decks + one `<audio>` deck fed by object URLs from IndexedDB; per-deck Web Audio chain (3-band EQ, compressor, gains, meters, master); crossfades via gain/opacity ramps; trim in/out (currentTime + `ontimeupdate` guard); loop, pre-wait, auto-continue; end actions `hold`/`black`; WebGL chroma/luma/alpha keyer; waveform/vectorscope scopes.
- **Fit policy:** per-cue `fit` — `contain` (default) / `cover` / `fill`, plus scale/posX/posY (:353, :1119, :1387). Contain-by-default already true; Phase 2 confirms + extends to stills.
- **Pause/resume:** `pauseResume()` toggles the active deck in place. **GO always (re)fires the selected cue from its trim-in** — the AVT "trigger resumes from top" complaint maps to GO-after-pause; playhead offset is not persisted to show state or synced (Phase 2 item 5).
- **Failure path:** missing IndexedDB media → toast + status idle; a decode failure mid-play has **no slate/fallback behavior** (Phase 2 item 6).
- **Outputs:** `?output=N` windows self-fetch blobs from IndexedDB by `mediaId` and obey addressed BroadcastChannel messages. Same-machine only by design.
- **SFX:** pad board with banks, per-pad hotkeys, colors/emoji, search; Web Audio buffer voices; master gain. Bank rename exists; **stable-ID discipline needs verification in Phase 4**.
- **Persistence/recovery:** cues/settings/banks autosave to IndexedDB store `show` (`scheduleSave`); recovery banner offers restore; show export/import to file. Cueola rundown ⇄ Outrangutan link: cue badges, GO-from-rundown, `outrangutan.live` status.

## 5. Test & CI inventory

- **Tests:** one script — `scripts/test-entitlements.mjs` (node, entitlement resolver). No runner, no framework, no coverage anywhere else.
- **CI:** none (`.github/` absent). No lint config. Deploys are manual.
- **Gap + proposal:** for pure logic (state resolution, keymap, sequence handling) a zero-dependency `node:test` suite under `scripts/tests/` is cheap since files are framework-free; UI verification stays manual via the preview-browser workflow. Every phase appends to the manual QA checklist in `PROGRESS.md` (plan rule 7 minimum).

## 6. Answers to the §6 questions

- **"Time up" display:** the talent-screen clock overlay (`pt-clock-overlay`, cueola-app.js:7299–7330). Modes: `timeofday` (wall clock), `duration` (counts **down** a set duration), `countdown` ("To Time" — counts down to a wall-clock target), `wrap`. All counting modes show **remaining** time (`targetTs − now`); at zero the overlay flips to an `expired` (red) state. Outrangutan's separate count-out clock defaults to **remaining** with click-to-toggle elapsed.
- **"Wrap" element:** a red wrap-up banner pinned to the talent screen's lower area, fired from Script Op / Flowmingo Op ("Wrap 10", "Wrap 5", custom minutes → `applyClockActionToState` mode `wrap`). It counts down the minutes until talent must wrap; expiry highlights. It rides the same clock-state sync as the other overlays.
- **Themes:** **9** — `cool, warm, white, green, koala, panda, flamingo, outrangutan, prepbear` (`CUEOLA_THEMES`, cueola-app.js:102). Implementation: `data-theme` attribute + CSS custom-property token sets in index.html; Flowmingo has a parallel `PT_THEMES` bg map + `data-pt-theme`; Outrangutan reuses the global tokens (`THEME_ORDER`, outrangutan.js:55).
- **Keyboard input:** fragmented, per-surface document-level `keydown` listeners with manual guards — dialog focus trap (:497), live-screen arrows + remote keys (:2862), Script Op editor ⌘B/⌘I/⌘Enter, Flowmingo Op hold-keys, talent-screen handler (:8263), Outrangutan rebindable shortcuts (`DEFAULT_SHORTCUTS`: Space=GO, S=Stop, P=Pause, F=Fade-Stop, Esc=PANIC, persisted in settings; per-pad SFX hotkeys; Tab toggles SFX board). Text-field suppression via `isTextEditingTarget`, applied inconsistently. **No central registry, scopes, or priority rules** — Phase 5 builds that.

## 7. Risk list — five most likely live-show failure causes

1. **Single hot session doc with no sequencing.** Every write re-fires every client's snapshot; ordering is timestamp/ad-hoc; ~1 write/sec/doc sustained limit. High-frequency updates (playout status, presence) fanning out through the same doc that renders the rundown is the prime suspect class for the "Questions" segment blanking/flash loop (Phase 3).
2. **Zero media validation before showtime.** Import accepts anything the OS calls video/audio; codec/dimension support is never probed; no import-time rejection, no failure slate, no still support — decode failures surface live (Phase 2).
3. **No error containment or show log.** 13k lines of global-scope JS; one exception in a live render path can stop the live screen; nothing records cue/media/sync events for post-mortem (Phase 7).
4. **Fragmented keyboard control.** No scoped registry; behavior depends on focus/overlay state; the operator cannot reliably drive rundown + script + playout from one keyboard (Phase 5) — the exact AVT failure that forced a second computer.
5. **Open Firestore rules on a shared project, no App Check.** Any client can write any session doc mid-show — stability and security risk in one (hardened rules exist in-repo but are **not deployed**). Also: manual `?v=` cache busting + immutable CDN caching risks serving a stale JS against a new index.html mid-rollout.
