/* ============================================================================
 * break-room-show.js: "The Break Room" advanced demo show.
 *
 * Classic global script (same idiom as cueola-session-clone.js). Attaches:
 *   window.CueolaBreakRoom     the authored show data, byte-faithful to the
 *                              content author file (adapted from ESM to a
 *                              browser global, nothing else changed)
 *   window.CueolaBreakRoomKit  pure builders shared by the offline demo
 *                              loader (cueola-app.js loadDemo) and the
 *                              dashboard admin "Create Test Show" seeder.
 *                              DOM-free and Firestore-free on purpose.
 * ==========================================================================*/
(function (root) {
'use strict';

// ============================================================================
// THE BREAK ROOM · advanced demo show content for Cueola full-system testing
// ============================================================================
// WIRING CONTRACT (read before touching):
//   This file is CONTENT ONLY. It ships zero behavior. A later wiring phase
//   imports or inlines this data into the app's demo loader (see loadDemo()
//   and DEMO_BEATS in cueola-app.js) and into an Outrangutan .ogshow build.
//   Nothing here runs, registers, or mutates anything.
//
// FIELD-SHAPE SOURCES (verified against the repo on 2026-07-27):
//   rows[]                  = exact DEMO_BEATS beat shape (cueola-app.js ~21890):
//                             { id, style:'timed'|'flex'|'segment', info, notes,
//                               min, sec, done:false, cues:{...} }
//                             Segment markers come from buildAddRowBeat with
//                             style:'segment' and empty cues (~6323).
//   cues.video/audio/gfx/lighting/playback = { on, off, notes?, ...extras }
//                             per saveCueConfig (~7152). Playback extras:
//                             clip/trtMin/trtSec/smpte. GFX extras: gfxContent/
//                             isFixed/isAnimated.
//   cues.script             = { on, off, scriptType, speaker, text, scriptTags,
//                               dialogueNote? } per saveCueConfig 'script' branch.
//                             scriptTags come from the fixed tag list at ~6832.
//   Sources vocabulary      = SESSION_SOURCE_DEFAULTS (~2914): video CAM 1..4/
//                             CPU/PLBK/GFX/ME 1; audio Host/Guest 1/Guest 2/
//                             CPU/PLBK/VOU/SFX/Music/Mains; scriptWho Host/
//                             Guest 1/Guest 2/VOU.
//   crew[].position         = exact ROLE_POSITION_OPTIONS strings (~3116).
//   paperwork.callSheet     = normalizeCallSheet field set (~19580); people rows
//                             { name, position, email, phone, call } (~19576).
//   paperwork.productionSchedule = getProductionScheduleData shape (~20404);
//                             checklist rows { area, item, hint, done } per
//                             normalizeProductionChecklistRow (~20253).
//   paperwork.safety        = getSafetyPlanData field set (~20178).
//   paperwork.videoPatchRows / audioPatchRows = { label, destination, source,
//                             cabling, notes }; commsPatchRows = { position,
//                             out, gear, notes } per defaultPatchRows (~20462).
//                             Row ids are OMITTED on purpose; the leaf-sync
//                             engine assigns them on first save.
//   playback.cues           = content projection of Outrangutan makeCue
//                             (outrangutan/outrangutan.js ~593): continueMode is
//                             'manual' | 'auto_continue' (UI "Continue") |
//                             'auto_follow' (UI "Follow"); trims in seconds.
//                             `file` names a real file in test-media/; the wiring
//                             phase imports media and swaps file -> mediaId.
//   playback.pads           = content projection of makePad (~631); hotkeys are
//                             the first eight PAD_KEYS ('1'..'8').
//   playback.rundownLinks   = which rundown cells get outCueId/outAuto/outPadId
//                             once cue and pad ids exist (saveCueConfig ~7200).
//   deck.pages[].keys       = action ids from the KeyWi catalog in
//                             cueola-streamdeck.js (km:*, pad:N, cue:N, talk.*,
//                             obs.*, clock, golive, fx.hype, layout.next).
//
// REGRESSION FIXTURES BAKED IN (all labeled inline):
//   1. Row 1 is a SEGMENT MARKER. The rundown must load, render, and go live
//      with a segment at index 0 (the TH2607 activeIdx crash).
//   2. Segment 3 is "Questions" with a playback cell linked AUTO to a 16:9 cue.
//      Entering that row must auto-fire the cue (the AVT Lab blanking bug,
//      docs/REHEARSAL_CHECKLIST.md section 0 and 2).
//   3. One Outrangutan cue points at corrupt-truncated.mp4 ON PURPOSE. Expected
//      behavior is documented on the cue itself.
//
// HOUSE RULES: no em or en dashes anywhere in this file (owner ban). No real
// student names; every person in here is invented for the demo.
// ============================================================================

const DEMO_SHOW_ADVANCED = {

  // ──────────────────────────────────────────────────────────────────────────
  // 1 · META
  // ──────────────────────────────────────────────────────────────────────────
  meta: {
    title: 'The Break Room',
    brand: 'The Break Room with Finn Voss',
    tagline: 'Late night from the last working microwave on campus.',
    sessionNameSuggestion: 'The Break Room: Demo Show',
    isDemo: true,
    format: [
      'Late night campus talk show, single set: desk, two guest chairs, espresso cart stage right.',
      'Four segments: Cold Open and Monologue, The Guests, Questions, The Wrap.',
      'Question segment runs on the Flowmingo question lane: producer pastes a card, Enter pushes it to talent, Esc clears it.',
      'Modeled on the owner\'s P2607 (AVT Podcast) crew and paperwork scale and the TH2607 July 20 talk show rundown style.',
    ],
    showStart: '21:30',
    targetRuntimeSec: 1440,          // 24:00 target
    plannedRuntimeSec: 1435,         // rows below sum to 23:55
    host: 'Finn Voss',
    guests: [
      { name: 'Dr. Imogen Rey', role: 'Guest 1', bio: 'Sleep science researcher. Runs the campus nap study. Professionally unimpressed by all-nighters.' },
      { name: 'Tomás Aguilar', role: 'Guest 2', bio: 'Campus barista champion. Out-poured nineteen rivals for the golden portafilter.' },
    ],
    announcer: { name: 'VOU', role: 'VOU', bio: 'Voice of the Universe. Booth announcer. Never seen, always heard.' },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 2 + 3 · RUNDOWN ROWS (exact DEMO_BEATS shape) with script text
  //   29 rows. Segment markers at 1, 9, 19, 25 (leading marker = fixture 1).
  //   Timed durations sum to 23:55. Flex rows carry their planned target.
  // ──────────────────────────────────────────────────────────────────────────
  rows: [

    // ═══ SEGMENT 1 ═══
    { id: 1, style: 'segment', info: 'SEGMENT 1 · COLD OPEN AND MONOLOGUE',
      notes: 'REGRESSION FIXTURE: leading segment marker. Rundown must load and go live with a segment at row 1.',
      min: 0, sec: 0, done: false, cues: {} },

    { id: 2, style: 'timed', info: 'Countdown Slate', notes: 'Roll to air at :30. Confirm record before this row.', min: 0, sec: 30, done: false, cues: {
      gfx:      { on: 'Ready Countdown', off: 'Take Countdown', gfxContent: 'Countdown clock full screen', isFixed: true, isAnimated: false },
      audio:    { on: 'Ready Mains', off: 'Mains Up' },
      lighting: { on: 'Ready Cue 1 · Desk Preset', off: 'Go Cue 1', lightingGoCue: '1', lightingDetail: 'Cue 1: desk warm key, house at 20 percent' },
    }},

    { id: 3, style: 'timed', info: 'Cold Open: Finn at the Desk', notes: 'Tight single, no bug yet. Straight into the open VT.', min: 1, sec: 0, done: false, cues: {
      video:  { on: 'Ready CAM 2 · CU', off: 'Take CAM 2' },
      audio:  { on: 'Ready Host Mic', off: 'Open Mic · Host' },
      script: { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: ['Cold Open'],
        text: `It is 11:07 on a Wednesday night. The library just switched to motion sensor lighting, which means somewhere on the third floor a grad student is waving their arms like they are landing a plane.

**Stay seated.** You have found The Break Room. We keep the lights on so you do not have to.` },
    }},

    { id: 4, style: 'timed', info: 'Show Open (VT)', notes: 'Outrangutan cue: SHOW OPEN 16x9. Theme under the VOU read.', min: 0, sec: 30, done: false, cues: {
      video:    { on: 'Set PLBK', off: 'Take PLBK' },
      playback: { on: 'Ready SHOW OPEN', off: 'Roll SHOW OPEN', clip: 'SHOW_OPEN_16x9', trtMin: '0', trtSec: '20', smpte: '00:00:20:00' },
      audio:    { on: 'Ready Music + VOU', off: 'Play Theme · Open VOU' },
      script:   { on: 'Standby VOU', off: 'Cue VOU', scriptType: 'Script', speaker: 'VOU', scriptTags: ['Show Open', 'VO'],
        text: `From the last working microwave on the garden level, it is The Break Room. Tonight: sleep scientist Dr. Imogen Rey, campus barista champion Tomás Aguilar, and your questions from the chat.

And now, a man who has never once used a coaster: **Finn Voss.**` },
    }},

    { id: 5, style: 'timed', info: 'Monologue', notes: 'Bug on from here. Topical joke slot updates day of show.', min: 2, sec: 0, done: false, cues: {
      video:  { on: 'Ready CAM 1 · Wide', off: 'Take CAM 1' },
      gfx:    { on: 'Set Bug', off: 'Take Bug', gfxContent: 'Show bug, lower right', isFixed: true, isAnimated: false },
      audio:  { on: 'Ready Host Mic', off: 'Open Mic · Host' },
      script: { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: [],
        text: `Thank you, thank you. Please, save it for the guests.

Big week on campus. [UPDATE] Producer note: drop tonight's topical joke here after the afternoon news sweep.

The dining hall introduced a "chef's choice" station, which is the culinary version of your professor saying the exam will be "straightforward."

And the shuttle app now shows the buses in real time. So we can all watch the 9:40 not come. Together. As a community.

We have a great show tonight, so let's get into it.` },
    }},

    { id: 6, style: 'timed', info: 'Desk Bit: Syllabus or Cereal', notes: 'Five GFX full screens. DING pad on each reveal.', min: 1, sec: 30, done: false, cues: {
      video:  { on: 'Ready GFX · Full Screen', off: 'Take GFX' },
      gfx:    { on: 'Ready Full Screen · Round 1', off: 'Take Full Screen', gfxContent: 'Game cards, five rounds, quote only then source reveal', isFixed: false, isAnimated: true },
      audio:  { on: 'Ready SFX', off: 'Fire SFX · Ding' },
      script: { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: [],
        text: `Time for Syllabus or Cereal: I read a real phrase, you tell me if it came from a course syllabus or the side of a cereal box.

Round one: **"Part of a balanced morning."** Syllabus or cereal? That is the wellness elective. I checked twice.

Round two: "No substitutions after week two." Sounds like cereal. It is both, and honestly that explains a lot about both.` },
    }},

    { id: 7, style: 'timed', info: 'Tease: Tonight\'s Guests', notes: '', min: 0, sec: 30, done: false, cues: {
      video:  { on: 'Ready CAM 3 · Medium', off: 'Take CAM 3' },
      gfx:    { on: 'Ready Lower 3rd · Coming Up', off: 'Take L3', gfxContent: 'Coming up: Dr. Imogen Rey / Tomás Aguilar / Your questions' },
      script: { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: ['Tease'],
        text: `Coming up: Dr. Imogen Rey on why your all-nighter is lying to you, and Tomás Aguilar, who just out-poured nineteen baristas to become campus champion. Later, your questions from the chat. Stick around.` },
    }},

    { id: 8, style: 'timed', info: 'Throw to Break 1', notes: 'Bumper is the 9:16 vertical, pillarboxed on purpose. Slate follows it automatically.', min: 0, sec: 20, done: false, cues: {
      playback: { on: 'Ready BUMPER VERT', off: 'Roll BUMPER VERT', clip: 'BUMPER_VERT_9x16', trtMin: '0', trtSec: '10' },
      audio:    { on: 'Ready Music', off: 'Music Up · Mics Out' },
      lighting: { on: 'Ready Cue 8 · Break Wash', off: 'Go Cue 8', lightingGoCue: '8', lightingDetail: 'Cue 8: cool wash, desk key out' },
      script:   { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: ['Throw to Break'],
        text: `We have to pay for the microwave somehow. Two minutes. Do not go anywhere.

[BREAK - AUTO PAUSE]` },
    }},

    // ═══ SEGMENT 2 ═══
    { id: 9, style: 'segment', info: 'SEGMENT 2 · THE GUESTS',
      notes: 'Two guest blocks with a package and a live shot between them.',
      min: 0, sec: 0, done: false, cues: {} },

    { id: 10, style: 'timed', info: 'Back from Break · Guest Intro: Dr. Imogen Rey', notes: 'Applause pad on her entrance.', min: 0, sec: 40, done: false, cues: {
      video:  { on: 'Set 2-SHOT · CAM 3', off: 'Dissolve 2-SHOT' },
      audio:  { on: 'Ready Guest 1 Mic', off: 'Open Mic · Guest 1' },
      gfx:    { on: 'Ready Lower 3rd · Dr. Imogen Rey', off: 'Take L3', gfxContent: 'Dr. Imogen Rey · Sleep Science Lab' },
      script: { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: ['Guest Intro'],
        text: `Welcome back. My first guest runs the sleep science lab upstairs, which means she has professional opinions about every decision this audience made last night. Please welcome **Dr. Imogen Rey.**` },
    }},

    { id: 11, style: 'flex', info: 'Interview: Dr. Imogen Rey', notes: 'Target 3:00. Wrap on the floor manager\'s circle signal.', min: 3, sec: 0, done: false, cues: {
      video:  { on: 'Ready CAM 3 · OTS', off: 'Take CAM 3' },
      audio:  { on: 'Ready Host + Guest 1', off: 'Mics Open · Host + Guest 1' },
      script: { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: ['Open Conversation'],
        text: `Open conversation. Planned beats in order, ad-lib between them:

FINN: Start with the nap study. What did students actually do when your lab paid them to nap?

DR. REY: The headline finding: a 20 minute nap beats a fourth coffee. Has that held up?

FINN: The all-nighter question. Get her to say the sentence "sleep is not a savings account."

DR. REY: One change a student could actually make this week.

Toss to the Nap Map package when the floor manager circles.` },
    }},

    { id: 12, style: 'timed', info: 'PKG Intro: The Nap Map', notes: '', min: 0, sec: 20, done: false, cues: {
      video:  { on: 'Ready CAM 1 · Wide', off: 'Take CAM 1' },
      script: { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: ['PKG Intro'],
        text: `Dr. Rey's team spent a semester logging every public nap on this campus. We turned their data into a documentary. It is ninety seconds long and it has a villain. Roll it.` },
    }},

    { id: 13, style: 'timed', info: 'PKG: The Nap Map', notes: 'Archive look, 4:3 pillarbox is intentional. Back to CAM 3 on the out cue.', min: 1, sec: 30, done: false, cues: {
      video:    { on: 'Set PLBK', off: 'Take PLBK' },
      playback: { on: 'Ready NAP MAP', off: 'Roll NAP MAP', clip: 'PKG_NAPMAP_4x3', trtMin: '1', trtSec: '30', smpte: '00:01:30:00' },
      audio:    { on: 'Ready PKG Audio', off: 'Take PKG SOT · PLBK' },
    }},

    { id: 14, style: 'timed', info: 'Back from PKG · Toss to Live Shot', notes: '', min: 0, sec: 30, done: false, cues: {
      video:  { on: 'Ready CAM 3 · 2-shot', off: 'Take CAM 3' },
      audio:  { on: 'Ready Host + Guest 1', off: 'Open Mics · Host + Guest 1' },
      script: { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: ['Toss'],
        text: `The villain was the ficus. It is always the ficus.

All right. Before my next guest walks over from the espresso cart, let's go to him live. Standing by across the quad, the reigning campus latte art champion. Tomás, can you hear us?` },
    }},

    { id: 15, style: 'timed', info: 'LIVE: The Espresso Cart', notes: 'Remote frame rides the CPU return. IFB to Finn only.', min: 1, sec: 0, done: false, cues: {
      video:  { on: 'Ready CPU · Live Frame', off: 'Take CPU' },
      audio:  { on: 'Ready CPU Return', off: 'Open CPU · IFB Host' },
      gfx:    { on: 'Ready Lower 3rd · LIVE: North Quad', off: 'Take L3', gfxContent: 'LIVE · North Quad Espresso Cart' },
      script: { on: 'Standby Remote', off: 'Cue Remote', scriptType: 'Script', speaker: 'TOMÁS AGUILAR', scriptTags: ['Live Shot'],
        text: `TOMÁS: Loud and clear, Finn. It is closing rush at the cart. I have four drinks working and one of them is decaf, and no, I will not say which.

FINN: Show us the championship pour, then get in here.

TOMÁS: One rosetta, coming up. For the people.` },
    }},

    { id: 16, style: 'timed', info: 'Guest Intro: Tomás Aguilar', notes: 'Applause pad. He enters with the drink tray.', min: 0, sec: 40, done: false, cues: {
      video:  { on: 'Ready CAM 4 · Medium', off: 'Take CAM 4' },
      audio:  { on: 'Ready Guest 2 Mic', off: 'Open Mic · Guest 2' },
      gfx:    { on: 'Ready Lower 3rd · Tomás Aguilar', off: 'Take L3', gfxContent: 'Tomás Aguilar · Campus Barista Champion' },
      script: { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: ['Guest Intro'],
        text: `He got here fast. He always gets here fast. Nineteen baristas entered. One walked out with the golden portafilter. Please welcome **Tomás Aguilar.**` },
    }},

    { id: 17, style: 'flex', info: 'Latte Art Showdown', notes: 'Target 2:30. Overhead rig on CAM 4. Dr. Rey judges. DING pad per score, AIRHORN only if the crowd earns it.', min: 2, sec: 30, done: false, cues: {
      video:  { on: 'Ready CAM 4 · ECU Overhead', off: 'Take CAM 4' },
      audio:  { on: 'Ready All Mics + SFX', off: 'Open All Mics' },
      gfx:    { on: 'Ready Scorebug', off: 'Take Scorebug', gfxContent: 'Showdown scorebug: FINN vs TOMÁS', isFixed: true, isAnimated: true },
      script: { on: 'Standby Panel', off: 'Cue Panel', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: [],
        text: `FINN: The rules are simple. Tomás pours, I pour, Dr. Rey judges, and we all agree not to ask how old this steamed milk is.

TOMÁS: Respect the milk and the milk respects you.

DR. REY: I want the record to show I am an unpaid judge.

FINN: Noted and ignored. Pour one: the rosetta.

[STOP HERE] Unscripted pours. Prompter holds until the scores are in.` },
    }},

    { id: 18, style: 'timed', info: 'Tease Questions · Throw to Break 2', notes: 'Second vertical bumper. Slate follows automatically again.', min: 0, sec: 30, done: false, cues: {
      video:    { on: 'Ready CAM 1 · Wide', off: 'Take CAM 1' },
      playback: { on: 'Ready BUMPER VERT', off: 'Roll BUMPER VERT', clip: 'BUMPER_VERT_9x16', trtMin: '0', trtSec: '10' },
      audio:    { on: 'Ready Music', off: 'Music Up · Mics Out' },
      script:   { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: ['Tease', 'Throw to Break'],
        text: `When we come back, the chat gets its turn. Your questions, their answers, my microwave. Two minutes.

[BREAK - AUTO PAUSE]` },
    }},

    // ═══ SEGMENT 3 ═══
    { id: 19, style: 'segment', info: 'SEGMENT 3 · QUESTIONS',
      notes: 'Question lane workflow: producer pastes each card from the moderated queue, Enter pushes it to talent, Esc clears. Cards live in questionLane below, NOT in row scripts.',
      min: 0, sec: 0, done: false, cues: {} },

    { id: 20, style: 'timed', info: 'Questions Open', notes: 'REGRESSION FIXTURE: playback cell links AUTO to the 16:9 Q STINGER cue. Entering this row must auto-fire it (AUTO badge, ON AIR in the cell). This is the AVT Lab segment 3 case.', min: 0, sec: 30, done: false, cues: {
      video:    { on: 'Set ME 1 · Split Box', off: 'Take ME 1' },
      playback: { on: 'Ready Q STINGER', off: 'Auto · Rolls on Advance', clip: 'Q_STINGER_16x9', trtMin: '0', trtSec: '8' },
      audio:    { on: 'Ready Music Sting', off: 'Sting and Out' },
      script:   { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: [],
        text: `It is time for Questions: the segment where the chat asks, the desk answers, and nobody is allowed to say "great question" as a stall.

The lane is open. Producer, hit me.` },
    }},

    { id: 21, style: 'timed', info: 'Questions Block 1', notes: 'Queue order: Q1 (Tomás), Q2 (Dr. Rey).', min: 1, sec: 20, done: false, cues: {
      video:  { on: 'Ready CAM 3 · 2-shot', off: 'Take CAM 3' },
      audio:  { on: 'All Mics Open', off: 'Hold All Open' },
      gfx:    { on: 'Ready Lower 3rd · Asker Handle', off: 'Take L3', gfxContent: 'Chat handle of the current asker' },
      script: { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: [],
        text: `Question cards ride the lane, not this script. Finn reads each card off the talent display, then throws to the named guest.

Block 1 queue: Q1 latte capybara (Tomás), Q2 all-nighter before a final (Dr. Rey).` },
    }},

    { id: 22, style: 'timed', info: 'Questions Block 2', notes: 'Queue order: Q3 (Finn), Q4 (Dr. Rey).', min: 1, sec: 20, done: false, cues: {
      video:  { on: 'Ready CAM 2 · Medium', off: 'Take CAM 2' },
      audio:  { on: 'All Mics Open', off: 'Hold All Open' },
      script: { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: [],
        text: `Block 2 queue: Q3 the cereal bit (Finn answers, keep it under thirty seconds), Q4 are naps a scam (Dr. Rey).

Producer: Esc between cards. Never leave a stale question on the talent display.` },
    }},

    { id: 23, style: 'timed', info: 'Questions Block 3', notes: 'Queue order: Q5 (Tomás), Q6 (both). Last card gets both guests.', min: 1, sec: 20, done: false, cues: {
      video:  { on: 'Ready CAM 3 · Wide', off: 'Take CAM 3' },
      audio:  { on: 'All Mics Open', off: 'Hold All Open' },
      script: { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: [],
        text: `Block 3 queue: Q5 espresso before bed (Tomás), Q6 dream guest (both, Finn breaks ties).

Finn closes the lane: thank the chat by name, Esc clears the final card everywhere.` },
    }},

    { id: 24, style: 'timed', info: 'VO: Next Week Promo', notes: 'Promo card is the 4:3 still. VOU reads over it.', min: 0, sec: 20, done: false, cues: {
      video:    { on: 'Set PLBK', off: 'Take PLBK' },
      playback: { on: 'Ready PROMO CARD', off: 'Take PROMO CARD', clip: 'PROMO_4x3' },
      audio:    { on: 'Ready VOU', off: 'Open VOU' },
      script:   { on: 'Standby VOU', off: 'Cue VOU', scriptType: 'Script', speaker: 'VOU', scriptTags: ['VO'],
        text: `Next week on The Break Room: the facilities crew that names the campus snowplows, live in the studio. Plus whatever Finn finds in the lost and found. Thursdays at eleven, wherever the stream is legal.` },
    }},

    // ═══ SEGMENT 4 ═══
    { id: 25, style: 'segment', info: 'SEGMENT 4 · THE WRAP',
      notes: '',
      min: 0, sec: 0, done: false, cues: {} },

    { id: 26, style: 'timed', info: 'Thanks and Plugs', notes: '', min: 0, sec: 40, done: false, cues: {
      video:  { on: 'Ready CAM 3 · Wide', off: 'Take CAM 3' },
      audio:  { on: 'All Mics Open', off: 'Hold All Open' },
      gfx:    { on: 'Ready Lower 3rd · Socials', off: 'Take L3', gfxContent: 'Follow the show · @breakroomdemo' },
      script: { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: [],
        text: `My thanks to Dr. Imogen Rey, whose lab is hiring nappers, which is a real thing you can apply for, and to Tomás Aguilar, the people's champion. The cart is open until midnight during finals. He does not sleep. Doctor, talk to him.` },
    }},

    { id: 27, style: 'timed', info: 'Signoff', notes: '', min: 0, sec: 40, done: false, cues: {
      video:  { on: 'Ready CAM 2 · CU', off: 'Take CAM 2' },
      audio:  { on: 'Ready Host Mic', off: 'Open Mic · Host' },
      script: { on: 'Standby Host', off: 'Cue Host', scriptType: 'Script', speaker: 'FINN VOSS', scriptTags: ['Signoff'],
        text: `That is our show. The Break Room is produced by students who have class in the morning and did this anyway.

Be kind to your night shift workers, drink some water, and if you are still in the library: the third floor lights are motion activated. **Wave.**

Good night.

[STOP HERE]` },
    }},

    { id: 28, style: 'timed', info: 'Credits and Show Close', notes: '', min: 0, sec: 30, done: false, cues: {
      gfx:      { on: 'Ready Credits', off: 'Roll Credits', gfxContent: 'Full crew credit roll', isAnimated: true },
      playback: { on: 'Ready SHOW CLOSE', off: 'Roll SHOW CLOSE', clip: 'CLOSE_16x9', trtMin: '0', trtSec: '15' },
      audio:    { on: 'Ready Theme Out', off: 'Theme Up Full' },
      lighting: { on: 'Ready Cue 20 · House Up', off: 'Go Cue 20', lightingGoCue: '20', lightingDetail: 'Cue 20: house to full over 5 counts' },
    }},

    { id: 29, style: 'timed', info: 'Post: Off Air Slate', notes: 'BREAK SLATE holds on program until record stop.', min: 0, sec: 15, done: false, cues: {
      video:    { on: 'Ready Black', off: 'Fade to Black' },
      playback: { on: 'Ready BREAK SLATE', off: 'Take Slate · Hold' },
      audio:    { on: 'Ready Mains Out', off: 'Mains Out · All Out' },
    }},
  ],

  // ──────────────────────────────────────────────────────────────────────────
  // 3b · QUESTION LANE (segment 3 workflow content)
  //   These are the six cards the producer pastes into the question lane one at
  //   a time (Enter pushes to talent, Esc clears; see docs/OPERATOR_CARD.md and
  //   docs/REHEARSAL_CHECKLIST.md section 4). pasteLine is the exact single
  //   line to paste. All handles are invented.
  // ──────────────────────────────────────────────────────────────────────────
  questionLane: [
    { id: 'Q1', source: 'YouTube chat', author: '@latte_lord_kev', target: 'Tomás',
      text: 'What is the most requested latte art on campus, and can you do a capybara?',
      pasteLine: '@latte_lord_kev (YouTube): What is the most requested latte art on campus, and can you do a capybara?' },
    { id: 'Q2', source: 'YouTube chat', author: '@sleepless_in_stacks', target: 'Dr. Rey',
      text: 'Is an all-nighter ever worth it before an 8 am final?',
      pasteLine: '@sleepless_in_stacks (YouTube): Is an all-nighter ever worth it before an 8 am final?' },
    { id: 'Q3', source: 'YouTube chat', author: '@quadcat_official', target: 'Finn',
      text: 'When is the cereal bit coming back? Asking for the whole quad.',
      pasteLine: '@quadcat_official (YouTube): When is the cereal bit coming back? Asking for the whole quad.' },
    { id: 'Q4', source: 'YouTube chat', author: '@midnightmegabyte', target: 'Dr. Rey',
      text: 'Do naps actually count as sleep or is that a scam?',
      pasteLine: '@midnightmegabyte (YouTube): Do naps actually count as sleep or is that a scam?' },
    { id: 'Q5', source: 'YouTube chat', author: '@froth_and_theory', target: 'Tomás',
      text: 'Espresso after 9 pm: crime or lifestyle?',
      pasteLine: '@froth_and_theory (YouTube): Espresso after 9 pm: crime or lifestyle?' },
    { id: 'Q6', source: 'YouTube chat', author: '@dorm_room_dj', target: 'Both guests',
      text: 'For both guests: who is your dream guest for this show?',
      pasteLine: '@dorm_room_dj (YouTube): For both guests: who is your dream guest for this show?' },
  ],

  // ──────────────────────────────────────────────────────────────────────────
  // 4 · PLAYBACK (Outrangutan show content)
  //   Files below are the ACTUAL contents of test-media/ (verified):
  //     bars-16x9.mp4, bars-4x3.mp4, bars-9x16.mp4, corrupt-truncated.mp4,
  //     unplayable-prores.mov, sfx-ding.wav, still-16x9.png, still-4x3.jpg
  //   Wiring phase: import each file, swap `file` for the resulting mediaId,
  //   and let makeCue fill the remaining defaults (eq, fades, key, obs, fit).
  // ──────────────────────────────────────────────────────────────────────────
  playback: {
    showName: 'The Break Room · Demo Playout',
    cues: [
      { order: 1, name: 'SHOW OPEN 16x9', type: 'video', file: 'bars-16x9.mp4',
        trimIn: 0.5, trimOut: null, continueMode: 'auto_continue', volume: 1, loop: false,
        notes: 'Show open stand-in. Continue mode fires cue 2 (THEME STAB) at the same moment, the classic picture-plus-sting pair.' },
      { order: 2, name: 'THEME STAB', type: 'audio', file: 'sfx-ding.wav',
        trimIn: 0, trimOut: null, continueMode: 'manual', volume: 0.9, loop: false,
        notes: 'Audio sting under the open. Fired by cue 1 via Continue.' },
      { order: 3, name: 'BUMPER VERT 9x16', type: 'video', file: 'bars-9x16.mp4',
        trimIn: 0, trimOut: 10, continueMode: 'auto_follow', volume: 1, loop: false,
        notes: 'Break bumper, vertical on purpose: verifies 9:16 pillarboxing. Follow mode rolls straight into cue 4 (BREAK SLATE) when it ends. Used at both breaks (rows 8 and 18).' },
      { order: 4, name: 'BREAK SLATE', type: 'image', file: 'still-16x9.png',
        trimIn: 0, trimOut: null, continueMode: 'manual', volume: 1, loop: false, endAction: 'hold',
        notes: 'Holds on program through the break and again after signoff (row 29).' },
      { order: 5, name: 'PKG NAPMAP 4x3', type: 'video', file: 'bars-4x3.mp4',
        trimIn: 1.0, trimOut: 91.0, continueMode: 'manual', volume: 1, loop: false,
        notes: 'The Nap Map package stand-in. 4:3, verifies pillarbox left and right. Trimmed to 1:30 TRT.' },
      { order: 6, name: 'Q STINGER 16x9', type: 'video', file: 'bars-16x9.mp4',
        trimIn: 0, trimOut: 8, continueMode: 'manual', volume: 1, loop: false,
        notes: 'REGRESSION FIXTURE: this is the 16:9 cue the segment 3 Questions row (row 20) links with AUTO on advance. Entering the row must fire it (AVT Lab case, REHEARSAL_CHECKLIST section 0 and 2). Same media as cue 1, second cue on one mediaId is intentional.' },
      { order: 7, name: 'PROMO CARD 4x3', type: 'image', file: 'still-4x3.jpg',
        trimIn: 0, trimOut: null, continueMode: 'manual', volume: 1, loop: false,
        notes: 'Next week promo still under the VOU read (row 24). 4:3 still, verifies image pillarbox.' },
      { order: 8, name: 'SHOW CLOSE 16x9', type: 'video', file: 'bars-16x9.mp4',
        trimIn: 45.0, trimOut: 60.0, continueMode: 'manual', volume: 1, loop: false,
        notes: 'Credits bed (row 28). Deliberately trimmed from deep in the file to exercise a nonzero trimIn seek.' },
      { order: 9, name: 'BROKEN CUE (INTENTIONAL)', type: 'video', file: 'corrupt-truncated.mp4',
        trimIn: 0, trimOut: null, continueMode: 'manual', volume: 1, loop: false, armed: false,
        notes: 'INTENTIONAL REGRESSION FIXTURE, keep armed:false and NEVER in the show path. Expected per REHEARSAL_CHECKLIST section 0: import REJECTS this file with a clear toast and it never becomes a cue. If a build lets it through, firing it must cut to black slate, not hang. Do not "fix" this row.' },
    ],
    // Second broken file: reserved for the import-reject drill only, never a cue.
    importRejectDrillFiles: ['corrupt-truncated.mp4', 'unplayable-prores.mov'],

    // SFX pad board: one bank, 8 pads. Hotkeys are the first eight PAD_KEYS.
    // All files live in test-media/ (gitignored, local): sfx-ding.wav ships
    // with the repo history, the four demo-*.wav files are synthesized by
    // scripts/make-demo-sfx.mjs (run it once per machine before the drill).
    pads: [
      { slot: 1, name: 'DESK STINGER', emoji: '⚡', key: '1', file: 'sfx-ding.wav', trimIn: 0,   gain: 1.0, retrigger: 'restart', fileNeeded: false,
        notes: 'Punchline button. Stand-in: the ding with no trim.' },
      { slot: 2, name: 'APPLAUSE', emoji: '👏', key: '2', file: 'demo-applause.wav', trimIn: 0, gain: 1.0, retrigger: 'restart', fileNeeded: false,
        notes: 'Guest entrances (rows 10 and 16). Synthesized crowd, 2.5s.' },
      { slot: 3, name: 'AWW', emoji: '❤️', key: '3', file: 'demo-aww.wav', trimIn: 0, gain: 1.0, retrigger: 'restart', fileNeeded: false,
        notes: 'For the capybara latte question. Synthesized swell, 1.5s.' },
      { slot: 4, name: 'DING', emoji: '🔔', key: '4', file: 'sfx-ding.wav', trimIn: 0, gain: 1.0, retrigger: 'restart', fileNeeded: false,
        notes: 'The real ding. Syllabus or Cereal reveals (row 6) and Showdown scores (row 17).' },
      { slot: 5, name: 'RIMSHOT', emoji: '🥁', key: '5', file: 'demo-rimshot.wav', trimIn: 0, gain: 1.0, retrigger: 'restart', fileNeeded: false,
        notes: 'Emergency joke rescue. Synthesized ba-dum-tss, 0.4s.' },
      { slot: 6, name: 'BREAK STING', emoji: '🎵', key: '6', file: 'sfx-ding.wav', trimIn: 0.2, gain: 0.8, retrigger: 'restart', fileNeeded: false,
        notes: 'Throw-to-break button. Stand-in: the ding, trimmed and quieter so it reads as a different pad in testing.' },
      { slot: 7, name: 'THEME STAB', emoji: '🎺', key: '7', file: 'sfx-ding.wav', trimIn: 0.4, gain: 0.9, retrigger: 'restart', fileNeeded: false,
        notes: 'Manual twin of playout cue 2 for ad-lib moments.' },
      { slot: 8, name: 'AIRHORN', emoji: '📣', key: '8', file: 'demo-airhorn.wav', trimIn: 0, gain: 0.7, retrigger: 'restart', fileNeeded: false,
        notes: 'The HYPE gag, used ONCE: crowning the Latte Art Showdown winner (row 17), and only if the room earns it. Pairs with the deck HYPE key. Synthesized and rounded off; keep the gain low.' },
    ],

    // Rundown cell links to create at wiring time, once cue and pad ids exist
    // (saveCueConfig stores outCueId/outAuto on playback cells and outPadId/
    // outPadAuto on playback or audio cells).
    rundownLinks: [
      { rowId: 4,  cell: 'playback', cueName: 'SHOW OPEN 16x9',  auto: false },
      { rowId: 8,  cell: 'playback', cueName: 'BUMPER VERT 9x16', auto: false },
      { rowId: 13, cell: 'playback', cueName: 'PKG NAPMAP 4x3',  auto: false },
      { rowId: 18, cell: 'playback', cueName: 'BUMPER VERT 9x16', auto: false },
      { rowId: 20, cell: 'playback', cueName: 'Q STINGER 16x9',  auto: true,
        note: 'REGRESSION FIXTURE: must be AUTO so entering the Questions row fires the cue.' },
      { rowId: 24, cell: 'playback', cueName: 'PROMO CARD 4x3',  auto: false },
      { rowId: 28, cell: 'playback', cueName: 'SHOW CLOSE 16x9', auto: false },
      { rowId: 29, cell: 'playback', cueName: 'BREAK SLATE',     auto: false },
      { rowId: 6,  cell: 'audio',    padName: 'DING',            auto: false },
      { rowId: 17, cell: 'audio',    padName: 'DING',            auto: false },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 5 · CREW (7 people, matching the P2607 AVT Podcast scale)
  //   position strings are EXACT ROLE_POSITION_OPTIONS values. Every name and
  //   username is invented for the demo; none belong to real students.
  // ──────────────────────────────────────────────────────────────────────────
  crew: [
    { person: 'Marlo Quist',    username: 'demo.marlo',   position: 'Show Caller',
      notes: 'Calls the show and runs the rundown. Owns the deck.' },
    { person: 'Devery Okonta',  username: 'demo.devery',  position: 'Technical Director',
      notes: 'Switcher. Owns ME 1 and the split box.' },
    { person: 'Saskia Brandt',  username: 'demo.saskia',  position: 'Audio Lead',
      notes: 'UR44 mix, mics, SFX returns, Micochondria buses.' },
    { person: 'Juniper Wilde',  username: 'demo.juniper', position: 'Playback Operator',
      notes: 'Outrangutan cues and pad board. Runs the broken-media drill in rehearsal.' },
    { person: 'Callum Frost',   username: 'demo.callum',  position: 'Graphics Operator',
      notes: 'Lower thirds, full screens, scorebug, credits.' },
    { person: 'Priya Demoulin', username: 'demo.priya',   position: 'Camera 1',
      notes: 'Swing camera. CAM 3 and CAM 4 are locked-off, CAM 4 overhead rig preset for the Showdown.' },
    { person: 'Ozzie Vantage',  username: 'demo.ozzie',   position: 'Flowmingo Operator',
      notes: 'Prompter and the question lane. Pastes cards from the moderated queue only.' },
  ],

  // ──────────────────────────────────────────────────────────────────────────
  // 6 · PAPERWORK PACKAGE
  // ──────────────────────────────────────────────────────────────────────────
  paperwork: {

    // Call sheet: normalizeCallSheet field set. Times are 24h HH:MM.
    callSheet: {
      label: 'The Break Room · Show Day',
      production: 'The Break Room',
      date: '2026-08-06',
      call: '19:30',
      showStart: '21:30',
      wrap: '23:00',
      doors: '21:00',
      location: 'Studio B, Merrick Media Center (demo location)',
      address: '400 Campus Loop, Demoville, PA 19999',
      venue: 'indoors',
      parking: 'Lot 7 after 18:00 with a crew pass. Do not park in the loading dock, facilities will tow mid-show and enjoy it.',
      entrance: 'Stage door on the north side, code from the Show Caller. Doors lock at 21:15.',
      late: 'Text the Show Caller before call time. Fifteen minutes unheard from and your position gets reassigned for the night.',
      stream: 'YouTube Live: The Break Room (demo channel). Encoder feeds from switcher PGM.',
      dress: 'Crew in show blacks. Talent business casual, no fine stripes or small checks on camera.',
      meals: 'Pizza in the green room. Crew eats in shifts, playback last (sorry, Juniper).',
      mealTime: '20:00',
      notes: 'This is the full-system demo show. Every department runs its real workflow: paperwork, patching, rehearsal blocks, live calls, playback, prompter, question lane, and the deck.',
      people: [
        { name: 'Marlo Quist',    position: 'Show Caller',        email: 'demo.marlo@example.edu',   phone: '555-0101', call: '19:30' },
        { name: 'Devery Okonta',  position: 'Technical Director', email: 'demo.devery@example.edu',  phone: '555-0102', call: '19:30' },
        { name: 'Saskia Brandt',  position: 'Audio Lead',         email: 'demo.saskia@example.edu',  phone: '555-0103', call: '19:30' },
        { name: 'Juniper Wilde',  position: 'Playback Operator',  email: 'demo.juniper@example.edu', phone: '555-0104', call: '19:30' },
        { name: 'Callum Frost',   position: 'Graphics Operator',  email: 'demo.callum@example.edu',  phone: '555-0105', call: '19:30' },
        { name: 'Priya Demoulin', position: 'Camera 1',           email: 'demo.priya@example.edu',   phone: '555-0106', call: '19:30' },
        { name: 'Ozzie Vantage',  position: 'Flowmingo Operator', email: 'demo.ozzie@example.edu',   phone: '555-0107', call: '19:30' },
        { name: 'Finn Voss',      position: 'Host',               email: 'demo.finn@example.edu',    phone: '555-0110', call: '20:30' },
        { name: 'Dr. Imogen Rey', position: 'Guest',              email: 'demo.imogen@example.edu',  phone: '555-0111', call: '20:30' },
        { name: 'Tomás Aguilar',  position: 'Guest',              email: 'demo.tomas@example.edu',   phone: '555-0112', call: '20:45' },
      ],
    },

    // Production schedule: getProductionScheduleData shape. Rehearsal blocks
    // live in setupNotes as the hour-by-hour plan (one block per line).
    productionSchedule: {
      setupNA: false,
      date: '2026-08-06',
      showDate: '2026-08-06',
      setup: '18:30',
      call: '19:30',
      show: '21:30',
      wrap: '23:00',
      doors: '21:00',
      location: 'Studio B, Merrick Media Center (demo location)',
      address: '400 Campus Loop, Demoville, PA 19999',
      setupNotes: [
        '18:30 Power up, patch per the video and audio sheets, hang the CAM 4 overhead rig',
        '19:00 Camera chain and UR44 line check (48k, loopback OFF for checks)',
        '19:30 Crew call, comms check on Channel A, deck page check',
        '19:45 Outrangutan preflight: all cues green, then run the broken-file import drill (both bad files must be rejected)',
        '20:00 Meal in shifts',
        '20:30 Talent mic checks: Finn, then Dr. Rey, then Tomás',
        '20:45 Full dress: cold open through the segment 1 break, with bumper and slate',
        '21:10 Notes and reset, question lane dry run with all six cards',
        '21:25 Places, countdown slate standing by',
      ].join('\n'),
      showNotes: [
        'Segment 3 entry must auto-fire the Q STINGER (watch for the AUTO badge). If it does not, that is a P0, stop and log it.',
        'Question lane: paste from the moderated queue only, Esc between cards.',
        'Breaks run the vertical bumper into the held slate, playback confirms the Follow chain in rehearsal.',
      ].join('\n'),
      checklist: [
        { area: 'Setup complete',        item: 'Studio reset, overhead rig safe, cables dressed and taped.', hint: 'Confirm the room is show-ready before crew call ends.', done: false },
        { area: 'Record path',           item: 'Recorder armed, media space for 90 minutes, format confirmed.', hint: 'Confirm record destination, inputs, media space, format, and expected runtime.', done: false },
        { area: 'Camera and video',      item: 'CAM 1 through 4, CPU, PLBK, and GFX all confirmed on the multiview.', hint: 'Confirm cameras, video sources, routing, and multiview.', done: false },
        { area: 'Audio',                 item: 'All four mics, PLBK return, VOU booth, mains, and monitors checked at level.', hint: 'Confirm microphones, playback audio, program audio, and monitors.', done: false },
        { area: 'Playback and graphics', item: 'Outrangutan preflight green, broken-file drill passed, all GFX loaded.', hint: 'Confirm playback, graphics, keys, lower thirds, and roll tests.', done: false },
        { area: 'Crew comms',            item: 'Channel A checked with every position, Micochondria TKB and VofU verified.', hint: 'Confirm headsets, channels, hand signals, and show-caller expectations.', done: false },
        { area: 'Flowmingo',             item: 'Prompter connected, auto-pause marks verified at both breaks, question lane dry run done.', hint: 'Confirm session, script, speed, size, theme, mirror, and remote control.', done: false },
        { area: 'Final go/no-go',        item: 'Every department reports ready to the Show Caller before the countdown slate.', hint: 'The show caller has confirmed every department is ready.', done: false },
      ],
    },

    // Safety plan: getSafetyPlanData field set. Demo content, invented numbers.
    safety: {
      hospital: 'Demoville General Hospital (demo entry)',
      hospitalAddress: '1200 Health Sciences Drive, Demoville, PA 19999',
      hospitalPhone: '555-0199',
      weather: '',   // empty = stays live with the call sheet auto weather
      firstAid: 'Wall mount inside the studio B control room door, second kit at the stage door.',
      fire: 'Extinguishers at both studio exits and beside the dimmer rack. Know which exit is behind you.',
      emergency: 'Campus emergency 555-0911, then the Show Caller.',
      nonemergency: 'Campus security desk 555-0155. Facilities after hours 555-0156.',
      security: 'Building staffed until midnight. Stage door locks at 21:15, late arrivals ring the Show Caller.',
      late: 'Anyone not heard from 15 minutes after call: Show Caller phones, then texts the class thread, then flags the instructor.',
      equipment: 'CAM 4 overhead rig is a two-person lift with a safety cable, check the cable at setup and at strike. Hot beverage handling during the Showdown: cart mats down, cables routed clear of the pour zone, towels at the desk.',
      notes: 'This is a demo safety plan for system testing. Real shows replace every contact and location above before doors.',
    },

    // Video patch sheet: 12 rows of { label, destination, source, cabling, notes }.
    videoPatchRows: [
      { label: 'CAM 1',            destination: 'Switcher SDI In 1', source: 'Studio cam A, pedestal, swing',        cabling: '50ft SDI floor run',            notes: 'Priya operates, wide and monologue' },
      { label: 'CAM 2',            destination: 'Switcher SDI In 2', source: 'Studio cam B, desk CU',                cabling: '50ft SDI floor run',            notes: 'Locked framing, cold open and signoff' },
      { label: 'CAM 3',            destination: 'Switcher SDI In 3', source: 'Studio cam C, guest 2-shot',           cabling: '75ft SDI wall panel',           notes: 'Locked-off' },
      { label: 'CAM 4',            destination: 'Switcher SDI In 4', source: 'Overhead rig cam, latte table',        cabling: '75ft SDI ceiling run',          notes: 'Locked-off, safety cable checked at setup' },
      { label: 'CPU',              destination: 'Switcher SDI In 5', source: 'Live shot laptop return (quad feed)',  cabling: 'HDMI to SDI converter at rack', notes: 'Remote frame for the espresso cart hit' },
      { label: 'PLBK',             destination: 'Switcher SDI In 6', source: 'Outrangutan output display',           cabling: 'HDMI to SDI converter at rack', notes: 'All VT, stills, bumpers, slate' },
      { label: 'GFX',              destination: 'Switcher SDI In 7', source: 'Graphics computer',                    cabling: 'HDMI to SDI converter at rack', notes: 'Full screens, game cards, credits' },
      { label: 'PGM to record',    destination: 'Recorder SDI In',   source: 'Switcher PGM out',                     cabling: '6ft SDI at rack',               notes: 'Record confirm before the countdown slate' },
      { label: 'PGM to stream',    destination: 'Encoder SDI In',    source: 'Switcher PGM out 2',                   cabling: '6ft SDI at rack',               notes: 'YouTube Live demo channel' },
      { label: 'Multiview',        destination: 'Control room wall', source: 'Switcher multiview out',               cabling: 'HDMI 25ft',                     notes: 'All sources plus PGM and PVW' },
      { label: 'Floor confidence', destination: 'Studio floor monitor', source: 'Switcher AUX 1 (PGM)',              cabling: 'HDMI 50ft',                     notes: 'Talent-visible, kill during the Showdown reveal' },
      { label: 'ME 1 split box',   destination: 'ME 1 key',          source: 'CAM 3 + Q STINGER loop',               cabling: 'Internal routing',              notes: 'Questions segment split, TD builds at rehearsal' },
    ],

    // Audio patch sheet: 16 rows, UR44-flavored to match the owner's rig
    // (Steinberg UR44: mic ins 1-4 with D-PRE, line ins 5-6, main outs L/R,
    // line outs 1-4, phones). Micochondria talkback rides outs 1-2 (TKB) and
    // 3-4 (VofU), matching the talkbackd wire contract.
    audioPatchRows: [
      { label: 'Host mic',           destination: 'UR44 In 1 (D-PRE)',  source: 'Dynamic broadcast mic on desk arm', cabling: 'XLR 25ft',                 notes: 'Finn. Pad off, low cut on' },
      { label: 'Guest 1 mic',        destination: 'UR44 In 2 (D-PRE)',  source: 'Dynamic on chair 1 boom',           cabling: 'XLR 25ft',                 notes: 'Dr. Rey' },
      { label: 'Guest 2 mic',        destination: 'UR44 In 3 (D-PRE)',  source: 'Dynamic on chair 2 boom',           cabling: 'XLR 25ft',                 notes: 'Tomás, arrives row 16, check early' },
      { label: 'VOU booth mic',      destination: 'UR44 In 4 (D-PRE)',  source: 'Condenser in announce booth',       cabling: 'XLR 50ft wall panel',      notes: 'Phantom ON for input 4 only' },
      { label: 'PLBK return L',      destination: 'UR44 In 5 (line)',   source: 'Outrangutan machine headphone out L', cabling: '3.5mm to dual 1/4 split', notes: 'All VT and pad audio' },
      { label: 'PLBK return R',      destination: 'UR44 In 6 (line)',   source: 'Outrangutan machine headphone out R', cabling: '3.5mm to dual 1/4 split', notes: 'Pair with In 5' },
      { label: 'Mains L',            destination: 'PA left',            source: 'UR44 Main Out L',                   cabling: 'TRS to XLR 30ft',          notes: 'Room level set at rehearsal, taped' },
      { label: 'Mains R',            destination: 'PA right',           source: 'UR44 Main Out R',                   cabling: 'TRS to XLR 30ft',          notes: 'Pair with Main Out L' },
      { label: 'TKB feed 1',         destination: 'Crew headset amp A', source: 'UR44 Line Out 1',                   cabling: 'TRS 15ft at rack',         notes: 'Micochondria bus A (Talkback), outs 1-2' },
      { label: 'TKB feed 2',         destination: 'Crew headset amp B', source: 'UR44 Line Out 2',                   cabling: 'TRS 15ft at rack',         notes: 'Pair with Line Out 1' },
      { label: 'VofU feed 1',        destination: 'Studio speaker L',   source: 'UR44 Line Out 3',                   cabling: 'TRS 30ft',                 notes: 'Micochondria bus B (Voice of the Universe), outs 3-4' },
      { label: 'VofU feed 2',        destination: 'Studio speaker R',   source: 'UR44 Line Out 4',                   cabling: 'TRS 30ft',                 notes: 'Pair with Line Out 3' },
      { label: 'Show Caller phones', destination: 'Caller headphones',  source: 'UR44 Phones 1',                     cabling: '1/4 extension 10ft',       notes: 'PGM mix plus talkback sidetone' },
      { label: 'Backup lav (Host)',  destination: 'Spare, coiled at desk', source: 'Wireless lav kit, ch 2',         cabling: 'Receiver XLR to snake spare', notes: 'Swap plan: kill In 1, repatch In 1 to receiver' },
      { label: 'Live shot return',   destination: 'CPU capture mix',    source: 'Quad laptop over network',          cabling: 'None (network audio)',     notes: 'Stays inside CPU; UR44 ins 5-6 carry PLBK only' },
      { label: 'Program to encoder', destination: 'Encoder audio in',   source: 'UR44 USB loopback mix',             cabling: 'USB',                      notes: 'Loopback OFF during mic checks, ON for air' },
    ],

    // Comms patch sheet: 1 row, matching P2607's single-channel setup.
    commsPatchRows: [
      { position: 'Show Caller', out: 'Channel A (all call)', gear: 'Wired beltpack 1, single muff headset',
        notes: 'Whole crew on A. Micochondria TKB doubles the caller onto UR44 outs 1-2 when the deck holds the TKB key.' },
    ],

    // Tech checklist: show-specific checks in the { area, item, hint, done }
    // row shape used by the production schedule checklist.
    techChecklist: [
      { area: 'Record path',        item: 'Recorder armed, confirm light on the countdown slate row, 90 minutes of media free.', hint: 'Confirm record destination, inputs, media space, format, and expected runtime.', done: false },
      { area: 'Camera chain',       item: 'CAM 1 swing marks set, CAM 3 and CAM 4 locked and safetied, overhead framing approved by the TD.', hint: 'Confirm cameras, lenses, white balance, shade, framing, and return paths.', done: false },
      { area: 'Audio chain',        item: 'UR44 at 48k, phantom only on In 4, loopback OFF for checks and ON for air, backup lav swap plan rehearsed.', hint: 'Confirm mics, program audio, playback audio, monitors, and backup routing.', done: false },
      { area: 'Playback and GFX',   item: 'All nine cues green in preflight, BROKEN CUE stays unarmed, both bad files rejected at the import drill, pads 1 through 8 fire from the board and the deck.', hint: 'Confirm media, graphics, keys, lower thirds, and roll tests.', done: false },
      { area: 'Switcher and routing', item: 'ME 1 split box built and saved, both PGM outs confirmed at the recorder and encoder.', hint: 'Confirm sources, destinations, multiview, stream, and record routes.', done: false },
      { area: 'Lighting look',      item: 'Cues 1, 8, and 20 stepped through, house preset verified.', hint: 'Confirm focus, color, cue looks, house lights, and fixture safety.', done: false },
      { area: 'Stage and talent',   item: 'Desk props set, cart mats down, water for three, IFB checked with Finn for the live shot.', hint: 'Confirm marks, chairs, props, IFB, scripts, water, and talent positions.', done: false },
      { area: 'Crew comms',         item: 'Channel A roll call, TKB and VofU each verified with a hold-and-release test, ALL TALK OFF tested.', hint: 'Confirm headsets, channels, hand signals, and show-caller expectations.', done: false },
      { area: 'Flowmingo',          item: 'Both [BREAK - AUTO PAUSE] marks pause the prompter, [STOP HERE] holds at the Showdown and the signoff, question lane dry run with all six cards.', hint: 'Confirm session code, script, theme, mirror, speed, size, and auto-pause marks.', done: false },
      { area: 'Final go/no-go',     item: 'Every department answers ready by name before the slate rolls.', hint: 'Confirm every department is ready before the show starts.', done: false },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 7 · DECK (KeyWi page layouts + Micochondria labels)
  //   Action ids match the KeyWi catalog in cueola-streamdeck.js. Layout is a
  //   15-key deck (5 wide, 3 tall), rows follow the app-band idiom: playback,
  //   then Cueola, then prompter plus Micochondria. keys[] reads left to right,
  //   top to bottom.
  // ──────────────────────────────────────────────────────────────────────────
  deck: {
    device: '15-key Stream Deck (5 wide, 3 tall)',
    pages: [
      {
        name: 'Break Room · Show',
        note: 'The whole-show page. Lives on the deck from the countdown slate to credits.',
        keys: [
          // Row 1: Outrangutan transport
          'km:playout.go', 'km:playout.pause', 'km:playout.stop', 'km:playout.panic', 'pad:4',
          // Row 2: Cueola
          'km:rundown.back', 'km:rundown.next', 'golive', 'clock', 'obs.record',
          // Row 3: Flowmingo + Micochondria
          'km:prompter.playpause', 'km:prompter.cue.current', 'talk.a', 'talk.b', 'talk.off',
        ],
        keyNotes: {
          'pad:4': 'DING, the most-used pad, promoted to the transport row.',
          'obs.record': 'Record lamp doubles as the record-confirm check on row 2 of the rundown.',
        },
      },
      {
        name: 'Break Room · Questions',
        note: 'Swap to this page at the segment 3 marker. layout.next on the Show page or a PAGE key gets here.',
        keys: [
          // Row 1: pads for the Q&A plus the stinger
          'cue:6', 'pad:2', 'pad:3', 'pad:4', 'pad:8',
          // Row 2: transport stays reachable
          'km:rundown.back', 'km:rundown.next', 'km:playout.go', 'km:playout.fade', 'fx.hype',
          // Row 3: prompter nudges for the card reads + Micochondria
          'km:prompter.nudge.back', 'km:prompter.nudge.fwd', 'talk.a', 'talk.b', 'layout.next',
        ],
        keyNotes: {
          'cue:6': 'Q STINGER by slot, the manual re-fire if the AUTO link ever fails on air.',
          'pad:8': 'AIRHORN. One press per season. See the pad notes.',
          'fx.hype': 'The rainbow burst for the Showdown crowning. Tasteful means once.',
        },
      },
    ],
    micochondria: {
      busA:  { key: 'TKB',  label: 'Talkback',              route: 'UR44 outs 1-2 to crew headsets',    use: 'Hold to talk to the crew. Release cuts the mic.' },
      busB:  { key: 'VofU', label: 'Voice of the Universe', route: 'UR44 outs 3-4 to studio speakers',  use: 'Hold to address the room. Countdown warnings and "quiet in the studio" only.' },
      panic: { key: 'ALL TALK OFF', label: 'Cut both mics', use: 'The off-air safety. Tested at every rehearsal.' },
      stripZones: ['TKB', 'VofU', 'PLBK vol'],
      panelNote: 'Meters and faders appear when talkbackd reports levels. Pop the panel out beside the multiview for the Audio Lead.',
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// KIT: pure builders over the data above. Both consumers (offline demo and
// cloud seeder) must produce the same rundown/paperwork, so the shaping lives
// here once instead of twice.
// ────────────────────────────────────────────────────────────────────────────
function deepCopy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// Rundown beats in the exact DEMO_BEATS shape, with the authored playback
// links applied BY NAME (outCueName/outPadName): an offline demo cannot know
// the ids Outrangutan assigns at import time, so the app resolves names to
// ids on first use (see resolveOutrangutanNameLinks in cueola-app.js).
function buildBeats() {
  const rows = deepCopy(DEMO_SHOW_ADVANCED.rows);
  const byId = {};
  rows.forEach(row => { byId[String(row.id)] = row; });
  (DEMO_SHOW_ADVANCED.playback.rundownLinks || []).forEach(link => {
    const row = byId[String(link.rowId)];
    if (!row) return;
    if (!row.cues) row.cues = {};
    const cell = row.cues[link.cell] || (row.cues[link.cell] = {});
    if (link.cueName) { cell.outCueName = link.cueName; cell.outAuto = !!link.auto; }
    if (link.padName) { cell.outPadName = link.padName; cell.outPadAuto = !!link.auto; }
  });
  return rows;
}

// Decision 1: fold the authored techChecklist into productionSchedule.checklist
// (same row shape). Where a techChecklist area exactly matches a schedule row,
// the show-specific techChecklist row REPLACES it (its hint text matches, its
// item text is the show-specific version); everything else appends verbatim.
function mergedChecklist() {
  const base = deepCopy(DEMO_SHOW_ADVANCED.paperwork.productionSchedule.checklist || []);
  const tech = deepCopy(DEMO_SHOW_ADVANCED.paperwork.techChecklist || []);
  const techByArea = {};
  tech.forEach(row => { techByArea[String(row.area).toLowerCase()] = row; });
  const used = {};
  const out = base.map(row => {
    const key = String(row.area).toLowerCase();
    if (techByArea[key]) { used[key] = true; return techByArea[key]; }
    return row;
  });
  tech.forEach(row => { if (!used[String(row.area).toLowerCase()]) out.push(row); });
  return out;
}

// prePro map in the legacy persist shape (per-field stamps + updatedAt), the
// same shape persistPreProDataLegacy writes: mergePreProFromCloud on any
// client accepts it without a sync-engine dependency. Row ids are omitted on
// purpose; the app assigns them on first save.
function buildPrePro(now) {
  const stamp = Number(now) || Date.now();
  const paper = DEMO_SHOW_ADVANCED.paperwork;
  const prePro = {
    production: paper.callSheet.production,
    callSheets: [Object.assign({ id: 'call_sheet_1' }, deepCopy(paper.callSheet))],
    productionSchedule: Object.assign(deepCopy(paper.productionSchedule), { checklist: mergedChecklist() }),
    safety: deepCopy(paper.safety),
    videoPatchRows: deepCopy(paper.videoPatchRows),
    audioPatchRows: deepCopy(paper.audioPatchRows),
    commsPatchRows: deepCopy(paper.commsPatchRows),
    roleAssignments: DEMO_SHOW_ADVANCED.crew.map(member => ({
      person: member.person,
      username: member.username,
      position: member.position,
      paperwork: [],
      status: 'assigned',
    })),
  };
  const stamps = {};
  Object.keys(prePro).forEach(key => { stamps[key] = stamp; });
  prePro._fieldUpdatedAt = stamps;
  prePro.updatedAt = stamp;
  return prePro;
}

// The six question cards as ready-to-push paste lines for the question lane.
function questionPasteLines() {
  return (DEMO_SHOW_ADVANCED.questionLane || []).map(card => card.pasteLine).filter(Boolean);
}

// Full sessions/{code} document for the admin cloud seeder. Mirrors the field
// set of CueolaSessionClone.buildEpisodeSeed plus the show content: rundown
// rows with cues, question lane cards, show clock defaults, and the prePro
// paperwork package (with the legacy top-level call sheet re-spread and the
// top-level roleAssignments compatibility copy old clients read).
function buildSessionDocSeed(opts) {
  const options = opts || {};
  const now = Number(options.now) || Date.now();
  const meta = DEMO_SHOW_ADVANCED.meta;
  const seed = {
    code: String(options.code || '').toUpperCase(),
    showName: String(options.name || meta.sessionNameSuggestion),
    startTime: meta.showStart,
    createdBy: String(options.createdBy || ''),
    createdAt: now,
    activeIdx: 0,
    status: 'idle',
    // Marker the app reads on join: a session minted from this seed also
    // stages the authored KeyWi deck layouts on the joiner's device.
    testShow: 'break-room',
    freeMode: false,
    participants: [],
    beats: buildBeats(),
    cues: [],
    questionLane: deepCopy(DEMO_SHOW_ADVANCED.questionLane || []),
    showClock: { running: false, anchorMs: 0, elapsedSecs: 0, by: '', senderId: '', senderClient: '', seq: 0, ts: now },
    prePro: buildPrePro(now),
  };
  if (options.ownerUid) seed.ownerUid = String(options.ownerUid);
  const firstSheet = seed.prePro.callSheets[0];
  ['label', 'production', 'date', 'call', 'showStart', 'wrap', 'doors', 'location', 'address',
    'venue', 'parking', 'entrance', 'late', 'stream', 'dress', 'meals', 'mealTime', 'notes']
    .forEach(key => { if (firstSheet[key] !== undefined) seed[key] = deepCopy(firstSheet[key]); });
  seed.roleAssignments = deepCopy(seed.prePro.roleAssignments);
  return seed;
}

// KeyWi layout seeds: the two authored deck pages as named profiles. The deck
// module adds each once per device (by name) and never changes the operator
// current or default layout selection.
function deckProfileSeeds() {
  return (DEMO_SHOW_ADVANCED.deck.pages || []).map(page => ({
    name: 'The ' + page.name,
    keys: (page.keys || []).slice(),
  }));
}

const kit = {
  buildBeats,
  mergedChecklist,
  buildPrePro,
  questionPasteLines,
  buildSessionDocSeed,
  deckProfileSeeds,
  deepCopy,
};

root.CueolaBreakRoom = DEMO_SHOW_ADVANCED;
root.CueolaBreakRoomKit = kit;
if (typeof module !== 'undefined' && module.exports) module.exports = { DEMO_SHOW_ADVANCED, kit };
})(typeof globalThis !== 'undefined' ? globalThis : this);
