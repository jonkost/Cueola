# Cueola 3.0 copy audit (§3)

Inventory of every user-facing string in the app, with a proposed rewrite. **Jon approves the glossary (docs/v3-glossary.md) and this rewrite table before anything is applied.** Nothing here has been changed in the code yet.

## How it was made

1. A script (scratch `copy-extract.mjs`) pulled every visible label, button, heading, placeholder, tooltip (`data-tip`), aria-label, toast, confirm, empty state and status string from index.html, dashboard.html, script-operator.html, cueola-app.js, cueola-streamdeck.js, cueola-identity.js, outrangutan/ and the other first-party scripts, with file and line.
2. Every string was reviewed against the 3.0 design standard (§1) and the rewrite rules (§3): short verbs on buttons, errors that say what happened and what to do, one sentence of helper text or an ⓘ, no developer jargon, one name per concept, no hover-only information.
3. Flags: **synonym** (a concept called by a different name elsewhere), **jargon** (developer words), **long**, **unclear**, **duplicate**, **tooltip-only** (important text only in a hover tip), **brand-for-concept** (a product name where the plain word belongs), **state-as-action** (a button that sets a state the app already knows).

## Numbers

| | Count |
|---|---|
| Strings inventoried | 2756 |
| User-facing (reviewed) | 2504 |
| Developer-only (log lines, error labels, template fragments; not rewritten) | 252 |
| Flagged for change | 906 |
| Proposed rewrites | 1003 |
| Move behind an ⓘ | 99 |
| Delete | 62 |

Flags (a string can carry more than one):

| Flag | Count |
|---|---|
| synonym | 410 |
| jargon | 182 |
| long | 180 |
| tooltip-only | 130 |
| unclear | 125 |
| brand-for-concept | 106 |
| duplicate | 61 |
| state-as-action | 11 |

Per file:

| File | Strings | Flagged |
|---|---|---|
| cueola-app.js | 766 | 348 |
| index.html | 705 | 199 |
| outrangutan/outrangutan.js | 315 | 108 |
| cueola-streamdeck.js | 293 | 100 |
| dashboard.html | 262 | 100 |
| script-operator.html | 79 | 14 |
| cueola-identity.js | 75 | 34 |
| outrangutan/output.html | 5 | 2 |
| cueola-scriptop-prefs.js | 3 | 0 |
| script-operator.js | 1 | 1 |

## The five things that matter most

1. **The same concept has several names.** 410 strings. The worst: session / show / production / workspace; row / beat / cue; GO / Next / Advance / Take; show caller / caller / rundown control / operator / director; Flowmingo / prompter / talent screen / Script Op / Script Operator / Flowmingo Op; cloud sync / saved state / synced / local-only. The glossary fixes each to one word.
2. **Developer words on student screens.** 182 strings: sync, snapshot, cloud, subsystem, runtime, render, protocol, heartbeat, ack, WebHID, IndexedDB, field, payload, "did not confirm".
3. **Brand names standing in for the plain word.** 106 strings: Flowmingo for prompter, Outrangutan for playback, Planda Bear for planner, KeyWi for Stream Deck. Brand names stay as screen titles; instructions and buttons use the plain word.
4. **Information that only exists on hover.** 130 strings. Nothing on an iPad can be hovered. Each becomes visible text, an ⓘ, or is deleted when it only repeats the label.
5. **Sentences where a button should be.** 180 long strings; 99 move behind an ⓘ. The READY · TRACK · ROLL lesson text is deleted with the feature.

## Rewrite table

Columns: Current | Proposed | Where | Moved to ⓘ? · Flags. A blank Proposed means keep as is. "delete" means the string goes away (usually a tooltip that repeats its button, or copy for a removed feature).

| Current | Proposed | Where | Moved to ⓘ? | Flags |
|---|---|---|---|---|
| You have rundown control. GO advances the show for everyone. | You are the director. Take moves everyone to the next cue. | cueola-app.js:477 |  | jargon, synonym — GO and 'rundown control' are renamed |
| Only a signed-in admin can hand out rundown control. | Only a signed-in instructor can make someone the director. | cueola-app.js:498 |  | synonym — 'admin' and 'rundown control' are not the one name |
| … now has rundown control. | … is now the director. | cueola-app.js:514 |  | synonym |
| Rundown control is back with the instructors. | The instructor is the director again. | cueola-app.js:523 |  | synonym |
| Take back | Make me director | cueola-app.js:596 |  | synonym, unclear — 'Take back' collides with the live verb TAKE |
| No one with a signed-in profile is in this session yet. Assign positions in Planda Bear or have students sign in and join. | No signed-in students here yet. Have them sign in and join. | cueola-app.js:605 |  | long, brand-for-concept — two sentences; Planda Bear stands in for planner |
| While a student holds control, your GO is off. Take back to drive. | While a student is director, your Take is off. | cueola-app.js:606 | yes | jargon, synonym — GO and 'control' renamed; explanatory, behind info |
| Loading recovery snapshots… | Loading backups… | cueola-app.js:1440 |  | jargon — snapshot is developer vocabulary |
| Export |  | cueola-app.js:1453 |  |  |
| No snapshots yet. Cueola saves one when you join, every two minutes while the session changes, when you go live, and when you leave. | No backups yet. | cueola-app.js:1454 | yes | long, jargon — when-it-saves explanation belongs behind info; 'snapshot' and 'session' renamed |
| Delete the … cloud snapshot?\n\nThis removes it from the cloud trail for every admin. Local copies on any device are not touched. | Delete this backup for every instructor? Copies on this device are kept. | cueola-app.js:1475 |  | jargon, long — cloud/snapshot are developer words |
| Cloud snapshot deleted. | Backup deleted. | cueola-app.js:1488 |  | jargon |
| Could not delete the cloud snapshot. | Could not delete the backup. Try again. | cueola-app.js:1491 |  | jargon |
| Snapshot not found. | Backup not found. | cueola-app.js:1519, cueola-app.js:1616 |  | jargon |
| Snapshot exported. | Backup exported. | cueola-app.js:1522 |  | jargon |
| Session history exported. | Show history exported. | cueola-app.js:1539 |  | synonym — session -> show |
| Restore the current local copy of … to the cloud?\n\nThis will recreate a missing or incomplete session with … rundown row… and locally saved Planda Bear content. Live presence, clocks, commands, and device heartbeats are never restored. | Restore … from this device's copy? This rebuilds the show from the rundown and planner content saved here. | cueola-app.js:1569 |  | long, jargon, brand-for-concept — heartbeats/commands/presence are developer words; Planda Bear -> planner |
| A complete server copy now exists. Reload it before choosing what to keep. | A full copy of this show is now saved. Reload to see it. | cueola-app.js:1577 |  | jargon, unclear — 'server copy' and 'choosing what to keep' unclear to a student |
| Cloud session restored · … | Saved | cueola-app.js:1587, cueola-app.js:1654 |  | jargon, synonym — saving indicator collapses to Saved / Saving… / Not saved |
| Restored … from this browser's local copy. | Restored … from this device's copy. | cueola-app.js:1591 |  | jargon — 'browser's local copy' -> this device |
| Restore the … snapshot…?\n\nCurrent rundown content will be replaced through normal cloud sync. A recovery copy of the current session will be saved first. | Restore this backup? The current rundown will be replaced. A backup of the current show is saved first. | cueola-app.js:1618 |  | long, jargon — 'cloud sync' and 'snapshot' are developer words |
| Restored snapshot from ……. | Restored backup from …. | cueola-app.js:1694 |  | jargon |
| Add a row before saving the rundown. | Add a cue before saving the rundown. | cueola-app.js:1716 |  | synonym — row -> cue |
| Saved: |  | cueola-app.js:1730, outrangutan/outrangutan.js:5578 |  |  |
| Rundown saved: | Rundown downloaded: | cueola-app.js:1745 |  | duplicate — same wording as 'Saved:' toast for a different action (download) |
| Could not save the rundown file. |  | cueola-app.js:1746 |  |  |
| Exit demo mode before opening a rundown file. |  | cueola-app.js:1763 |  |  |
| That file isn’t a valid rundown file. | That isn't a Cueola rundown file. | cueola-app.js:1765 |  | duplicate — two near-identical errors for the same user situation; keep one |
| That isn’t a Cueola rundown file. |  | cueola-app.js:1766 |  |  |
| Replace the current | Replace the current … cues with … from this file? | cueola-app.js:1767 |  | synonym — row -> cue |
| Rundown opened: |  | cueola-app.js:1776 |  |  |
| Could not open the rundown file. |  | cueola-app.js:1778 |  |  |
| Nothing logged yet. Cue fires, media events, sync changes, and errors will appear here. | Nothing logged yet. Takes, playback, saving, and errors show up here. | cueola-app.js:1849 |  | jargon, long — 'sync changes' and 'cue fires' are developer phrasing |
| The show log is empty. |  | cueola-app.js:1857 |  |  |
| Show log exported: |  | cueola-app.js:1866 |  |  |
| Clear the show log for |  | cueola-app.js:1869 |  |  |
| Demo mode: “ | Demo mode: “…” will open when you enter a show. | cueola-app.js:2334 |  | synonym — session -> show |
| This session hasn’t finished syncing. Re-open “ | This show is still loading. Open “…” again in a moment. | cueola-app.js:2344 |  | jargon, synonym — 'syncing' is a developer word |
| Outrangutan is joined to session | Playback joined this show. | cueola-app.js:2363 |  | brand-for-concept, synonym — Outrangutan stands in for playback; session -> show |
| … failed. Local draft kept; retrying when possible. | Not saved. Retrying… | cueola-app.js:2605 |  | jargon, synonym — 'local draft' is developer phrasing; use the one saving indicator |
| … failed. Local copy kept. | Not saved. Your changes are kept on this device. | cueola-app.js:2609 |  | jargon |
| Where To Go |  | cueola-app.js:3191 |  |  |
| Do This |  | cueola-app.js:3203 |  |  |
| Know This |  | cueola-app.js:3214 |  |  |
| Check Yourself |  | cueola-app.js:3220 |  |  |
| Try it now → |  | cueola-app.js:3232 |  |  |
| Enter your username and password. |  | cueola-app.js:3426 |  |  |
| Signing in… |  | cueola-app.js:3432 |  |  |
| Welcome, … |  | cueola-app.js:3437 |  |  |
| Admin controls | Instructor controls | cueola-app.js:3512 |  | synonym — admin -> instructor |
| Sign out of admin | Sign out | cueola-app.js:3522 |  | synonym — 'of admin' is redundant |
| Invite |  | cueola-app.js:3533 |  |  |
| Copy the show code | (delete) | cueola-app.js:3535 |  | tooltip-only, duplicate — tooltip repeats the button label |
| Copy a join link | (delete) | cueola-app.js:3536 |  | tooltip-only, duplicate — tooltip repeats the button label |
| Copy link |  | cueola-app.js:3536 |  |  |
| Share a join invite | (delete) | cueola-app.js:3537 |  | tooltip-only, duplicate — tooltip repeats the button label |
| Share invite |  | cueola-app.js:3537 |  |  |
| Open the Planda Bear paperwork hub | (delete) | cueola-app.js:3538 |  | tooltip-only, brand-for-concept — tooltip repeats the button; 'paperwork hub' is a second name for the planner |
| Dashboard accounts page |  | cueola-app.js:3547 |  |  |
| Show clock |  | cueola-app.js:3553 |  |  |
| Reset the elapsed clock to 0:00 and jump back to the first row. Take the show from the top. | Reset the clock and go back to the first cue. | cueola-app.js:3554 |  | long, synonym — row -> cue; second sentence repeats the first |
| Live control |  | cueola-app.js:3562 |  |  |
| Send every connected device to the live screen, all following one operator. | Send everyone to the live screen following the director. | cueola-app.js:3563 |  | synonym — operator -> director |
| No users online | No one online | cueola-app.js:3566 |  | synonym — 'users' is not classroom English |
| Force everyone live | Send everyone live | cueola-app.js:3568 |  | unclear — 'Force' reads as hostile; verb button |
| Session rescue | New show code | cueola-app.js:3574 |  | synonym, unclear — 'Session rescue' does not say what the control does |
| Current code: | Show code: | cueola-app.js:3575 |  | synonym |
| . If there's a problem with this session (a leaked code, stale data, or someone who keeps rejoining), move the whole show (rundown, Planda Bear, notes) to a fresh code. Everyone connected follows automatically; anyone joining later needs the new code. | Move the whole show to a fresh show code. Everyone connected follows; anyone joining later needs the new code. | cueola-app.js:3575 | yes | long, jargon, brand-for-concept — 'stale data', 'leaked code' and Planda Bear; explanation goes behind info |
| Move to a new code | Move to a new show code | cueola-app.js:3576 |  | synonym |
| No session is open on this device. Join or start a session and its controls appear here. | No show open. Join or start a show to see its controls. | cueola-app.js:3582 |  | synonym, long — session -> show |
| In this session | In this show | cueola-app.js:3608, cueola-app.js:4397 |  | synonym |
| YOU |  | cueola-app.js:3623 |  |  |
| No one has joined this session yet. | No one has joined this show yet. | cueola-app.js:3627 |  | synonym |
| Remove disconnects that person's device and takes them off the session roster. They can rejoin with the code. Move the session to a new code to keep them out. | Remove disconnects them from this show. They can rejoin with the show code. | cueola-app.js:3628 | yes | long, synonym — three sentences; session/code renamed |
| Assigned profiles |  | cueola-app.js:3631 |  |  |
| These profiles carry this session on their sign-in page, one tap to enter. Unassign removes that tile from the profile; it does not disconnect a device and it does not touch crew assignments. | These profiles see this show on their sign-in page. Unassign hides it; it does not disconnect anyone. | cueola-app.js:3632 | yes | long, synonym — two long sentences of explanation |
| @username |  | cueola-app.js:3635 |  |  |
| Assign |  | cueola-app.js:3637 |  |  |
| Position assignments |  | cueola-app.js:3641 |  |  |
| Positions and required paperwork are set on the Planda Bear hub now. Open Planda Bear with the show code and the assignments card is ready to edit. | Positions and paperwork are set in the planner. Open it with the show code. | cueola-app.js:3642 |  | brand-for-concept, long — Planda Bear used twice for the planner |
| Session sources | Show sources | cueola-app.js:3650 |  | synonym |
| (this session only) | (this show only) | cueola-app.js:3650 |  | synonym |
| Loading saved profiles… |  | cueola-app.js:3669 |  |  |
| Profiles could not be loaded. |  | cueola-app.js:3671 |  |  |
| Retry |  | cueola-app.js:3671, cueola-app.js:3862 (+4) |  |  |
| No profiles carry this session yet. | No profiles assigned to this show yet. | cueola-app.js:3675 |  | synonym, unclear — 'carry' is odd; session -> show |
| Unassign |  | cueola-app.js:3682 |  |  |
| A cloud session is required to assign profiles. | Profiles can only be assigned in a saved show. | cueola-app.js:3715 |  | jargon — 'cloud session' is developer vocabulary |
| This session is not in the cloud, so it cannot be assigned. | Profiles can only be assigned in a saved show. | cueola-app.js:3720 |  | jargon, duplicate — same situation as 0-105 with different wording |
| No profile named @…. |  | cueola-app.js:3723, cueola-app.js:3750 |  |  |
| @… moved to @…. Assign that profile instead. |  | cueola-app.js:3725 |  |  |
| @… was deactivated by an instructor. Reactivate the profile on the dashboard first. |  | cueola-app.js:3726 |  |  |
| @… already has this session. | @… already has this show. | cueola-app.js:3728 |  | synonym |
| @… is at the 100-session limit. Unassign an old session first. | @… is at the 100-show limit. Unassign an old show first. | cueola-app.js:3729 |  | synonym |
| … assigned to …. |  | cueola-app.js:3736 |  |  |
| Remove … from @…? |  | cueola-app.js:3745 |  |  |
| @… moved to @…. Manage sessions on that profile instead. | @… moved to @…. Manage shows on that profile instead. | cueola-app.js:3752 |  | synonym |
| Retry connection | Retry | cueola-app.js:3861 |  | synonym — 'Retry' and 'Retry connection' are two names for the same button in the same spot |
| Revert draft | Discard changes | cueola-app.js:3862 |  | unclear — 'draft' is not a concept students see elsewhere |
| Load server copy | Load saved copy | cueola-app.js:3864 |  | jargon — server is a developer word |
| Select saved profile |  | cueola-app.js:3895 |  |  |
| That position is already in the list. |  | cueola-app.js:4108 |  |  |
| Position "…" added. |  | cueola-app.js:4114 |  |  |
| Position "…" removed. Anyone already assigned to it keeps it. |  | cueola-app.js:4129 |  |  |
| Select position |  | cueola-app.js:4191 |  |  |
| Student profile |  | cueola-app.js:4238, cueola-app.js:30336 |  |  |
| Position |  | cueola-app.js:4240, cueola-app.js:4241 (+6) |  |  |
| Add another position for this student |  | cueola-app.js:4241, cueola-app.js:4241 |  |  |
| Remove this position row | Remove this position | cueola-app.js:4242, cueola-app.js:4242 |  | synonym — 'row' is being reserved for nothing; cue is the rundown word |
| Assigned. Tap to add another position for … | (delete) | cueola-app.js:4391 |  | tooltip-only — hover-only; the assigned state should be visible, the action is the + button |
| Has an assignment row | (delete) | cueola-app.js:4392 |  | tooltip-only — hover-only state; 'assignment row' is internal phrasing |
| Add an assignment row for … | Assign a position to … | cueola-app.js:4393 |  | tooltip-only, unclear — use as aria-label; 'assignment row' is internal phrasing |
| Assignments saved to Firestore. | Saved. | cueola-app.js:4728 |  | jargon — Firestore is a developer word |
| Load the server assignment copy and discard this local draft? | Load the saved assignments and discard your changes? | cueola-app.js:4762 |  | jargon — server/local draft are developer words |
| A cloud session is required to remove people. | People can only be removed from a saved show. | cueola-app.js:4835 |  | jargon — 'cloud session' |
| Remove "…" from this session? | Remove "…" from this show? | cueola-app.js:4836 |  | synonym |
| … removed from …. |  | cueola-app.js:4850 |  |  |
| Could not remove. Check the connection and try again. |  | cueola-app.js:4853 |  |  |
| A cloud session is required to move codes. | Only a saved show can move to a new show code. | cueola-app.js:4860 |  | jargon, synonym |
| Move this session to a new code? | Move this show to a new show code? | cueola-app.js:4861 |  | synonym |
| Could not find a free code. Try again. |  | cueola-app.js:4871 |  |  |
| Could not move the session. Check the connection and try again. | Could not move the show. Check the connection and try again. | cueola-app.js:4895 |  | synonym |
| Session moved. New code … copied. Share it with anyone joining later. | Show moved. New show code … copied. Share it with anyone joining later. | cueola-app.js:4915 |  | synonym |
| This session moved to a new code: … | This show moved to a new show code: … | cueola-app.js:4917 |  | synonym |
| Opened local copy. Shared sync is unavailable while offline. | Opened the copy on this device. Changes are not shared until you are back online. | cueola-app.js:5101 |  | jargon — 'shared sync' and 'local' are developer words |
| Opened local Production Notes. Shared sync is unavailable while offline. | Opened the notes on this device. Changes are not shared until you are back online. | cueola-app.js:5117 |  | jargon |
| Opened local Planda Bear copy. Shared sync is unavailable while offline. | Opened the planner on this device. Changes are not shared until you are back online. | cueola-app.js:5120 |  | jargon, brand-for-concept — Planda Bear stands in for planner |
| Checking your sessions… | Checking your shows… | cueola-app.js:5167, cueola-identity.js:1588 (+1) |  | synonym |
| Sign in to …. You can still explore the demo and a local blank slate. | Sign in to …. You can still try the demo or a blank slate. | cueola-app.js:5217 |  | jargon — 'local' is a developer word |
| Code and name required. | Enter the show code and your name. | cueola-app.js:5277, cueola-app.js:5344 |  | unclear, synonym — say what to do; code -> show code |
| Checking... | Checking… | cueola-app.js:5280, cueola-identity.js:338 |  | duplicate — same text as 0-152 with three dots instead of an ellipsis |
| Cueola cloud did not finish loading. Check the connection, then try again. | Cueola did not finish loading. Check the connection and try again. | cueola-app.js:5283, cueola-app.js:5376 |  | jargon — 'cloud' |
| Session not found. Check the code and try again. | Show not found. Check the show code and try again. | cueola-app.js:5292, cueola-app.js:5385 |  | synonym |
| …. Check the connection and try again. |  | cueola-app.js:5330, cueola-app.js:5400 |  |  |
| Checking… |  | cueola-app.js:5347 |  |  |
| Please enter your name. |  | cueola-app.js:5440 |  |  |
| Creating... | Creating… | cueola-app.js:5441 |  | duplicate — three dots; match the ellipsis used elsewhere |
| Working locally on this device. Sign in to share a workspace with your crew. | Working on this device only. Sign in to share a show with your crew. | cueola-app.js:5453 |  | jargon, synonym — 'locally' and 'workspace' |
| That workspace code already exists. Pick another code or join it from the front page. | That show code is taken. Pick another or join it from the home screen. | cueola-app.js:5474 |  | synonym — workspace -> show; front page -> home screen (0-159) |
| Blank Slate … created. |  | cueola-app.js:5489 |  |  |
| Could not create the workspace. Try another code. | Could not create the show. Try another show code. | cueola-app.js:5491 |  | synonym |
| Go back to the home screen? You can rejoin or reload your session. | Go back to the home screen? You can rejoin your show. | cueola-app.js:5524 |  | synonym |
| No shared show code. | Not saved | cueola-app.js:5570 |  | jargon, synonym — saving indicator collapses to Saved / Saving… / Not saved |
| Cloud sync connected · … | Saved | cueola-app.js:5704, cueola-app.js:6053 |  | jargon |
| Undo history updated after a collaborator edited the same row. | Someone else edited that cue, so undo was reset. | cueola-app.js:5828 |  | jargon, synonym — 'collaborator', 'undo history', row -> cue |
| Nothing to undo. |  | cueola-app.js:5845 |  |  |
| Undid: … |  | cueola-app.js:5848 |  |  |
| Nothing to redo. |  | cueola-app.js:5853 |  |  |
| Redid: … |  | cueola-app.js:5856 |  |  |
| Cloud sync saved · … | Saved | cueola-app.js:5983 |  | jargon |
| Cloud sync saving changes... | Saving… | cueola-app.js:6052, cueola-app.js:6482 |  | jargon |
| An instructor removed you from this session. | An instructor removed you from this show. | cueola-app.js:6070 |  | synonym |
| Now following: … |  | cueola-app.js:6325 |  |  |
| Forced live, following … | Sent live, following … | cueola-app.js:6332 |  | unclear — 'Forced' reads as hostile |
| Cloud sync reconnecting. Showing last known state… | Not saved. Reconnecting… | cueola-app.js:6444 |  | jargon — 'cloud sync' and 'last known state' |
| IN SESSION | IN THIS SHOW | cueola-app.js:6660 |  | synonym |
| Log in as admin to view session info. | Sign in as an instructor to see show info. | cueola-app.js:6671 |  | synonym — admin -> instructor; session -> show |
| Right now |  | cueola-app.js:6711 |  |  |
| Assignment |  | cueola-app.js:6712 |  |  |
| Session work | Show work | cueola-app.js:6718, cueola-app.js:6757 |  | synonym |
| Loading… |  | cueola-app.js:6718 |  |  |
| Remove from Session | Remove from show | cueola-app.js:6720 |  | synonym |
| Replies |  | cueola-app.js:6760 |  |  |
| To-Dos done |  | cueola-app.js:6761 |  |  |
| PB saves | Paperwork saves | cueola-app.js:6762 |  | brand-for-concept, unclear — 'PB' abbreviates Planda Bear; students will not decode it |
| Open to-dos assigned to them: |  | cueola-app.js:6764 |  |  |
| Paperwork touched | Paperwork edited | cueola-app.js:6765 |  | unclear — 'touched' is vague |
| Last contribution |  | cueola-app.js:6766 |  |  |
| Live commands are paused while Cueola returns to the rundown. | Controls are paused while Cueola returns to the rundown. | cueola-app.js:6866 |  | unclear — 'live commands' is internal phrasing |
| Cueola is not on the Live screen. Press GO LIVE first. | Open the Live screen first. | cueola-app.js:6870 |  | jargon — drop the shouted GO LIVE; say the action |
| Live commands are paused. The show screen is still settling. | Controls are paused while the Live screen loads. | cueola-app.js:6873 |  | unclear — 'settling' is vague |
| Set the target time first: Live screen, clock panel, count down to a time. | Set a countdown time first (Live screen, clock panel). | cueola-app.js:6983 |  | long, unclear — colon list reads like a path |
| Open the Live screen to drive the show clock. |  | cueola-app.js:7074 |  |  |
| KeyWi Bird needs Chrome or Edge, and did not load. | Stream Deck needs Chrome or Edge and did not load. | cueola-app.js:7207 |  | brand-for-concept — KeyWi Bird stands in for Stream Deck |
| No script loaded to scrub. |  | cueola-app.js:7267 |  |  |
| Scrub script |  | cueola-app.js:7312 |  |  |
| Drag to scrub | (delete) | cueola-app.js:7314 |  | tooltip-only, duplicate — already stated in the visible note (0-201) |
| Wheel or drag to scrub · Shift = faster · ↑ ↓ jump rows · ← → fine · | Wheel or drag to scrub · Enter cues the prompter · Esc cancels | cueola-app.js:7315 | yes | long, synonym — keyboard modifiers go behind info; rows -> cues |
| Enter cues the prompter here |  | cueola-app.js:7315 |  |  |
| · Esc cancels |  | cueola-app.js:7315 |  |  |
| Cue here (Enter) |  | cueola-app.js:7316 |  |  |
| Prompter cued to row …${seg.label && seg.label !== 'Row ' + seg.row ? | Prompter cued to … | cueola-app.js:7327 |  | synonym — row -> cue |
| Prompter cued to |  | cueola-app.js:7331 |  |  |
| Run the playback call | Play the clip on Take | cueola-app.js:7414 |  | unclear — 'the playback call' means the READY/TRACK/ROLL sequence that 3.0 removes |
| . In Live, when GO advances onto this row, Cueola calls it like a director: | When you Take this cue, the clip plays. | cueola-app.js:7414 |  | long, jargon, synonym — GO/row renamed; READY/TRACK/ROLL sequence removed in 3.0 |
| (the clip goes on standby), | (delete) | cueola-app.js:7414 |  | state-as-action — part of the removed READY/TRACK/ROLL explanation |
| TRACK | (delete) | cueola-app.js:7414 |  | state-as-action — TRACK is removed in 3.0 |
| (audio up), | (delete) | cueola-app.js:7414 |  | state-as-action — part of the removed sequence |
| ROLL | (delete) | cueola-app.js:7414, cueola-app.js:26724 |  | state-as-action — ROLL is removed in 3.0 (also a label at 26724) |
| (about to fire), then | (delete) | cueola-app.js:7414 |  | state-as-action — part of the removed sequence |
| TAKE | Take | cueola-app.js:7414, cueola-app.js:9697 (+2) |  |  |
| plays the clip. Each step is one second. Press | (delete) | cueola-app.js:7414 |  | long — one-second step timing goes with the removed sequence |
| to abort before it fires; | (delete) | cueola-app.js:7414 |  | long — abort key belongs with the removed sequence |
| Drag to reorder |  | cueola-app.js:7620, cueola-app.js:31277 (+1) |  |  |
| Drag rows to reorder | (delete) | cueola-app.js:7624 |  | tooltip-only, duplicate, synonym — repeats 0-217; rows -> cues |
| Start with your first row | Start with your first cue | cueola-app.js:7683 |  | synonym |
| Add First Row | Add cue | cueola-app.js:7685 |  | synonym — row -> cue; short verb |
| Move up |  | cueola-app.js:7727, cueola-app.js:7756 |  |  |
| Move down |  | cueola-app.js:7728, cueola-app.js:7757 |  |  |
| Remove row | Remove cue | cueola-app.js:7729, cueola-app.js:7759 (+3) |  | synonym |
| Add row before | Add cue before | cueola-app.js:7758 |  | tooltip-only, synonym — row -> cue; tooltip explains '+ Before' |
| + Before |  | cueola-app.js:7758 |  | unclear — needs the tooltip to be understood; consider 'Add cue before' if space allows |
| Add row after | Add cue after | cueola-app.js:7760 |  | tooltip-only, synonym |
| + After |  | cueola-app.js:7760 |  | unclear — needs the tooltip to be understood |
| Click row to edit | Tap a cue to edit | cueola-app.js:7770 |  | synonym |
| + Add Row | Add cue | cueola-app.js:7816 |  | synonym |
| Add … cue |  | cueola-app.js:7838 |  |  |
| NOW → |  | cueola-app.js:7877 |  |  |
| No highlight |  | cueola-app.js:7951 |  |  |
| Highlight |  | cueola-app.js:7952 |  |  |
| … highlight |  | cueola-app.js:7953 |  |  |
| Color a row any way your crew reads it. The tint shows in the rundown, Live, and the exported rundown. | Color the cue so your crew can spot it. | cueola-app.js:7954 |  | long, synonym — row -> cue; two sentences |
| Remove …? |  | cueola-app.js:7958, cueola-app.js:10800 |  |  |
| Row added. Configure the cue. | Cue added. | cueola-app.js:8089 |  | synonym — row -> cue; second sentence is not needed |
| A short trigger note. On the prompter it shows only as dimmed guidance the talent does not read. | A short crew note; the talent will not read it on the prompter. | cueola-app.js:8177 | yes | long, duplicate — same hint as 0-319 |
| Take (go) | Take | cueola-app.js:8180 |  | synonym — '(go)' is the old name |
| Type anything... | Type anything… | cueola-app.js:8181 |  |  |
| Speaker name |  | cueola-app.js:8184 |  |  |
| e.g. Host, Anchor, Narrator |  | cueola-app.js:8185 |  |  |
| Script Copy (what the talent reads) |  | cueola-app.js:8188 |  |  |
| Type or paste the words the talent reads aloud. THIS is what appears big on the prompter. | The words the talent reads aloud. | cueola-app.js:8189 |  | long — two sentences with shouting |
| Anything the team needs to know. |  | cueola-app.js:8193 |  |  |
| Type custom source name… |  | cueola-app.js:8207 |  |  |
| Source |  | cueola-app.js:8248, cueola-app.js:8304 (+3) |  |  |
| + Custom |  | cueola-app.js:8251, cueola-app.js:8280 (+6) |  |  |
| Action |  | cueola-app.js:8257, cueola-app.js:8359 (+2) |  |  |
| Shot type |  | cueola-app.js:8263 |  |  |
| e.g. Set CAM 1 · Wide |  | cueola-app.js:8271 |  |  |
| Destination |  | cueola-app.js:8277, cueola-app.js:30212 |  |  |
| Type custom destination… |  | cueola-app.js:8282 |  |  |
| Transition |  | cueola-app.js:8286, cueola-app.js:8429 |  |  |
| Type custom transition… |  | cueola-app.js:8291 |  |  |
| e.g. Dissolve to Black |  | cueola-app.js:8296 |  |  |
| Cue type |  | cueola-app.js:8313 |  |  |
| Type custom cue type… |  | cueola-app.js:8318 |  |  |
| e.g. Open Mic · Host |  | cueola-app.js:8323 |  |  |
| Type custom source… |  | cueola-app.js:8334 |  |  |
| e.g. Close Mic · Host |  | cueola-app.js:8346 |  |  |
| Clip name |  | cueola-app.js:8354 |  |  |
| e.g. SC_042 or HOFL_122_Open |  | cueola-app.js:8355 |  |  |
| Duration (TRT) |  | cueola-app.js:8365 |  |  |
| SMPTE Timecode |  | cueola-app.js:8378 |  |  |
| (HH:MM:SS:FF) |  | cueola-app.js:8378 |  |  |
| (how the playback starts) |  | cueola-app.js:8384 |  |  |
| e.g. Roll SC_042 · 0:45 TRT |  | cueola-app.js:8385 |  |  |
| Return to |  | cueola-app.js:8391 |  |  |
| How it ends |  | cueola-app.js:8398 |  |  |
| (the plan for getting out) |  | cueola-app.js:8405 |  |  |
| e.g. Cut PLBK · Take CAM 1 |  | cueola-app.js:8406 |  |  |
| Graphic type |  | cueola-app.js:8414, cueola-app.js:8454 |  |  |
| Type custom graphic type… |  | cueola-app.js:8419 |  |  |
| Motion type |  | cueola-app.js:8435 |  |  |
| Fixed |  | cueola-app.js:8437 |  |  |
| Animated |  | cueola-app.js:8438 |  |  |
| Content |  | cueola-app.js:8442 |  |  |
| (what it reads / shows) |  | cueola-app.js:8442 |  |  |
| e.g. Host lower third, sponsor bug, intro card |  | cueola-app.js:8443 |  |  |
| e.g. Auto On · Lower 3rd GFX |  | cueola-app.js:8448 |  |  |
| Take it out | Lose it | cueola-app.js:8461 |  | synonym — 'Take it out' reuses the live verb Take for a different action |
| e.g. Lost It · Lower 3rd |  | cueola-app.js:8469 |  |  |
| Fixture / Area |  | cueola-app.js:8477, cueola-app.js:8530 |  |  |
| Go to Feature | Board feature | cueola-app.js:8480, cueola-app.js:8533 |  | synonym — 'Go to' echoes the retired GO verb |
| Go to Cue | Board cue | cueola-app.js:8481, cueola-app.js:8534 |  | synonym — 'Go to Cue' echoes GO and collides with rundown cue |
| Feature name / details |  | cueola-app.js:8485, cueola-app.js:8538 |  |  |
| e.g. Front wash warm, interview key |  | cueola-app.js:8486 |  |  |
| Board cue number / label |  | cueola-app.js:8489, cueola-app.js:8542 |  |  |
| e.g. Cue 14.5 |  | cueola-app.js:8490 |  |  |
| Intensity |  | cueola-app.js:8500 |  |  |
| Color |  | cueola-app.js:8507, cueola-app.js:28264 |  |  |
| e.g. Lee 201 Full CT Blue |  | cueola-app.js:8511 |  |  |
| Gobo |  | cueola-app.js:8514 |  |  |
| e.g. Gobo 3 · Breakup pattern |  | cueola-app.js:8515 |  |  |
| Lighting notes |  | cueola-app.js:8518 |  |  |
| (cue numbers, focus, wash details) |  | cueola-app.js:8518 |  |  |
| e.g. Cue 14.5: Key light focus on anchor, remove fill |  | cueola-app.js:8519 |  |  |
| e.g. Key · Cue On |  | cueola-app.js:8524 |  |  |
| e.g. House lights up full |  | cueola-app.js:8539 |  |  |
| e.g. Cue 20 |  | cueola-app.js:8543 |  |  |
| Lighting out |  | cueola-app.js:8547 |  |  |
| e.g. Key · Fade Out |  | cueola-app.js:8555 |  |  |
| Script type |  | cueola-app.js:8564 |  |  |
| Dialogue |  | cueola-app.js:8567 |  |  |
| Tags |  | cueola-app.js:8571 |  |  |
| Source / Speaker |  | cueola-app.js:8577 |  |  |
| Speaker name for Flowmingo headers… | Speaker name shown on the prompter… | cueola-app.js:8583 |  | brand-for-concept — Flowmingo stands in for prompter |
| Script copy |  | cueola-app.js:8588 |  |  |
| (feeds Flowmingo) | (shown on the prompter) | cueola-app.js:8588 |  | brand-for-concept |
| Write the copy here, word for word. |  | cueola-app.js:8589 |  |  |
| Upload script |  | cueola-app.js:8598 |  |  |
| (.txt or .pdf) |  | cueola-app.js:8598 |  |  |
| Dialogue note |  | cueola-app.js:8604 |  |  |
| (brief description only) |  | cueola-app.js:8604 |  |  |
| e.g. Host and guest discuss the segment topic (unscripted) |  | cueola-app.js:8605 |  |  |
| (short label, not the script) |  | cueola-app.js:8610 |  |  |
| e.g. Host · Begin |  | cueola-app.js:8611 |  |  |
| A trigger note for the crew. The prompter shows it only as dimmed guidance; the words the talent reads go in Script Copy above. | A crew note; the talent will not read it on the prompter. | cueola-app.js:8612 | yes | long, duplicate — same hint as 0-238; keep one |
| (for your crew) |  | cueola-app.js:8634 |  |  |
| Add context, reminders, or crew instructions… |  | cueola-app.js:8635 |  |  |
| Guided rows | Helper cues | cueola-app.js:8652 |  | synonym — row -> cue |
| Add a PREP row before this cue (ready the playback, track the audio) | Add a PREP cue before this one | cueola-app.js:8654 |  | long, synonym — row -> cue; parenthetical belongs in the hint |
| Add an OUT row after this cue (where the show goes next) | Add an OUT cue after this one | cueola-app.js:8655 |  | long, synonym |
| PREP readies the clip before the call; OUT is where the show goes after it ends. Guided rows are real rundown rows. Students can edit or delete them. | PREP readies the clip; OUT is where the show goes next. Both are normal cues you can edit or delete. | cueola-app.js:8657 | yes | long, synonym — three sentences; rows -> cues |
| Remove … from …? |  | cueola-app.js:9122 |  |  |
| Cue removed. |  | cueola-app.js:9126 |  |  |
| …SFX · … |  | cueola-app.js:9598 |  |  |
| Linked cue (offline) | Linked clip (offline) | cueola-app.js:9627 |  | synonym — 'cue' here is a playback clip; 'cue' is reserved for the rundown item |
| Linked pad (offline) |  | cueola-app.js:9643 |  |  |
| Link to an Outrangutan cue | Link a playback clip | cueola-app.js:9690 |  | brand-for-concept, synonym — Outrangutan stands in for playback; clip not cue |
| Open Outrangutan in this session to list its cues. | Open playback on this show to list its clips. | cueola-app.js:9692 |  | brand-for-concept, synonym — session -> show; brand name for concept |
| Run the playback call when this row goes live | Play the clip automatically on TAKE | cueola-app.js:9695 |  | synonym, jargon — 'goes live' / row -> TAKE / cue; checkbox label |
| The call: when GO lands on this row, READY · TRACK · ROLL · TAKE tick one second apart and the clip plays itself. The count IS the abort window (S key or the ABORT button). Unchecked, the clip only fires from its row GO button and the row shows a MANUAL chip. | On TAKE the clip counts down and plays itself. Press S or Abort during the count to stop it. Unchecked, the clip plays only when you press Fire. | cueola-app.js:9696 | yes | long, jargon — READY/TRACK/ROLL and GO are being removed; paragraph belongs behind an info icon |
| GO onto this row in Live runs | TAKE counts down and plays the clip. S aborts. | cueola-app.js:9697 | yes | long, jargon, duplicate — fragments 1-6..1-11 form one sentence that repeats 1-5; merge into 1-5's info |
| READY · TRACK · ROLL | (delete) | cueola-app.js:9697 |  | jargon, duplicate — READY · TRACK · ROLL is removed in 3.0; fragment of 1-6 |
| , then | (delete) | cueola-app.js:9697 |  | duplicate — fragment of 1-6 |
| fires the clip. S aborts. Watch it: | (delete) | cueola-app.js:9697 |  | duplicate, jargon — fragment of 1-6 ('fires', 'watch it') |
| See the call | (delete) | cueola-app.js:9697 |  | duplicate — fragment of 1-6 |
| below. | (delete) | cueola-app.js:9697 |  | duplicate — fragment of 1-6 |
| SFX pad |  | cueola-app.js:9701 |  |  |
| Assign pads on Outrangutan's SFX board to list them here. | Set up pads on the playback SFX board to list them here. | cueola-app.js:9703 |  | brand-for-concept — brand name for playback |
| Auto-fire SFX when this row advances live | Fire SFX on TAKE | cueola-app.js:9706 |  | synonym, jargon — 'advances live' / row -> TAKE |
| How the playback call works | How playback works | cueola-app.js:9709 |  |  |
| A safe on-screen demo of the READY · TRACK · ROLL · TAKE call. Fires nothing. | Practice the count on screen. Nothing plays. | cueola-app.js:9713 |  | tooltip-only, jargon — hover-only; READY/TRACK/ROLL removed; make it visible helper text |
| Really plays the cue in Outrangutan right now, skipping the call | Plays the clip on playback right now. | cueola-app.js:9714 |  | tooltip-only, brand-for-concept — hover-only explanation of a real action; the button label should carry it |
| Fire in Outrangutan now | Fire clip now | cueola-app.js:9714 |  | brand-for-concept — brand name for playback |
| Fire SFX now |  | cueola-app.js:9715 |  |  |
| Outrangutan needs a live (non-demo) session. | Playback needs a real show, not the demo. | cueola-app.js:9742 |  | brand-for-concept, synonym, unclear — '(non-demo) session' is unclear; session -> show |
| Sent, but no Outrangutan has checked in on this show. On the playout Mac: open Outrangutan, sign in, and Join Session with code | Sent, but playback hasn't checked in. On the playback Mac, open Outrangutan and join with show code … | cueola-app.js:9778 |  | long, brand-for-concept, synonym — 'Join Session' -> show code; keep to two sentences |
| Playout did NOT confirm the last command. Check Outrangutan on the playback Mac. | Playback did not confirm the last command. Check Outrangutan on the playback Mac. | cueola-app.js:9848, cueola-app.js:9854 |  | synonym — Playout vs Playback: one word |
| Link an Outrangutan cue first. | Link a playback clip first. | cueola-app.js:9945 |  | brand-for-concept, synonym — brand name for playback; clip not cue |
| Link an SFX pad first. |  | cueola-app.js:9951 |  |  |
| Playout: …. | Playback: …. | cueola-app.js:9972 |  | synonym — Playout -> Playback |
| Fire the linked SFX pad | Fire SFX | cueola-app.js:10054 |  | tooltip-only — hover-only on an action; use as the visible button label |
| Outrangutan: GO sent. | Playback: clip sent. | cueola-app.js:10066 |  | brand-for-concept, synonym — GO is removed; brand name for playback |
| Fire the linked Outrangutan cue | Fire clip | cueola-app.js:10072 |  | tooltip-only, brand-for-concept — hover-only on an action; use as visible label |
| Playback call aborted (…). Nothing fired. | Playback aborted. Nothing played. | cueola-app.js:10309 |  |  |
| Playback cue “…” isn’t in the loaded Outrangutan show, so nothing fired for this row. Load the right show on the playout Mac or re-link the row. | Clip “…” isn't in the show loaded on playback, so nothing played. Load the right show on the playback Mac or re-link this cue. | cueola-app.js:10585 |  | long, brand-for-concept, synonym — row -> cue; Outrangutan/playout -> playback |
| GO onto this row in Live runs the playback call: READY · TRACK · ROLL · TAKE | Plays automatically on TAKE. | cueola-app.js:10686 |  | tooltip-only, jargon — hover-only; GO/READY/TRACK/ROLL removed |
| CALL | AUTO | cueola-app.js:10686, cueola-app.js:29588 (+1) |  | unclear, jargon — 'CALL' chip only makes sense with the removed call; pair AUTO with MANUAL |
| Linked but NOT on the call: this clip only fires from its row GO button. Tick 'Run the playback call' in the row editor to automate it. | Plays only when you press Fire. Turn on auto-play in the cue editor. | cueola-app.js:10687 |  | tooltip-only, long, jargon — hover-only; row/GO removed |
| MANUAL |  | cueola-app.js:10687 |  |  |
| PDF support could not load. | PDF import could not load. Reload and try again. | cueola-app.js:10698 |  | unclear — says what happened, not what to do |
| PDF read failed. Try a .txt file | Could not read that PDF. Try a .txt file. | cueola-app.js:10716 |  |  |
| e.g. Act 1, Opening Block, Break |  | cueola-app.js:10738 |  |  |
| Section Label | Segment name | cueola-app.js:10738 |  | synonym — section -> segment |
| Saved. |  | cueola-app.js:10794 |  |  |
| Fix requests need a live show code. | Fix requests need a show code. | cueola-app.js:11042 |  |  |
| Too many fixes waiting for an answer. Give the other machine a moment. |  | cueola-app.js:11043 |  |  |
| In KeyWi Bird, open Setup and go to the Micochondria step. It shows the talkbackd command to run in Terminal on this Mac. | In the Stream Deck app, open Setup → Micochondria for the Terminal command to run on this Mac. | cueola-app.js:11805 |  | long, brand-for-concept — KeyWi Bird stands in for Stream Deck; two sentences into one |
| Open the program output from the Playback controls, then run the check again. |  | cueola-app.js:11821 |  |  |
| Return to the rundown before jumping to a preflight row. | Go back to the rundown first. | cueola-app.js:12009 |  | synonym — row -> cue; simpler |
| Row not found. It may have been deleted. | Cue not found. It may have been deleted. | cueola-app.js:12015 |  | synonym — row -> cue |
| This review shows once per session. Sign items off any time in the Production Schedule. | This review shows once per show. Sign items off any time in the Production Schedule. | cueola-app.js:12056 |  | synonym — session -> show |
| Back to Rundown |  | cueola-app.js:12058 |  |  |
| Cueola could not finish leaving: … | Could not leave Live: … | cueola-app.js:12406 |  | unclear — 'finish leaving' is odd |
| Holding the talent screen and checking playout… | Holding the prompter and checking playback… | cueola-app.js:12548 |  | synonym — talent screen -> prompter; playout -> playback |
| Saving the show… |  | cueola-app.js:12557 |  |  |
| Left the live show. The Air did not confirm the stop; check Outrangutan. | Left Live. Playback did not confirm the stop. Check Outrangutan on the playback Mac. | cueola-app.js:12596 |  | jargon, unclear — 'The Air' is undefined |
| Saving the show and closing Live controls… | Saving and leaving Live… | cueola-app.js:12617 |  |  |
| Back on the rundown · … |  | cueola-app.js:12634 |  |  |
| The show caller controls the clock for everyone. | The director controls the clock for everyone. | cueola-app.js:12673, cueola-app.js:12697 |  | synonym — show caller -> director |
| Row … · … | Cue … · … | cueola-app.js:12704 |  | synonym — row -> cue |
| Row … | Cue … | cueola-app.js:12706, cueola-app.js:12708 |  | synonym — row -> cue |
| Show started from the top (Row …). | Show started from the top (cue …). | cueola-app.js:12732 |  | synonym — row -> cue |
| Restart the show clock for this session? | Restart the show clock? | cueola-app.js:12745 |  | synonym — session -> show; shorter |
| Show restarted: clock at 0:00, back to the top. |  | cueola-app.js:12764 |  |  |
| Scheduled |  | cueola-app.js:13185 |  |  |
| Show Left | Remaining | cueola-app.js:13187 |  | unclear — 'Show Left' reads like 'left the show' |
| No cues configured for this row. | Nothing linked to this cue. | cueola-app.js:13243 |  | synonym, unclear — 'cues' here means linked actions, which collides with cue = rundown item |
| Cue to Row … | Jump to cue … | cueola-app.js:13262 |  | synonym — 'Cue to Row' uses cue as a verb and row for cue |
| Cued to Row … · … | Jumped to cue … · … | cueola-app.js:13271 |  | synonym — match 1-86 |
| Add script |  | cueola-app.js:13285 |  | tooltip-only — hover-only on an action; make it the visible label |
| Open full script | Open script | cueola-app.js:13299 |  | tooltip-only — hover-only on an action; make it the visible label |
| Tap to open script |  | cueola-app.js:13303 |  |  |
| No cues on this row | Nothing linked to this cue. | cueola-app.js:13336 |  | duplicate, synonym — same meaning as 1-85 |
| Recover row … | Recover cue … | cueola-app.js:13390 |  | tooltip-only, synonym — row -> cue; 1-94 already shows 'Recover' |
| Recover failed row … | Recover failed cue … | cueola-app.js:13390 |  | synonym — row -> cue |
| Recover |  | cueola-app.js:13390 |  |  |
| Current row state | Current cue state | cueola-app.js:13449 |  | synonym — row -> cue |
| Last row (show ends after this) | Last cue (show ends after this) | cueola-app.js:13460 |  | synonym — row -> cue |
| Coming up | Standby | cueola-app.js:13466 |  | synonym — the next cue is STANDBY in 3.0 |
| Select row …; … | Select cue …; … | cueola-app.js:13472 |  | synonym — row -> cue |
| No cues in rundown |  | cueola-app.js:13500, cueola-app.js:20774 |  |  |
| Build rows in the Rundown tab, then run the show from here. | Add cues in the Rundown tab, then call the show from here. | cueola-app.js:13500, cueola-app.js:20774 |  | synonym — rows -> cues |
| State |  | cueola-app.js:13530 |  |  |
| Row | Cue | cueola-app.js:13531, cueola-app.js:25875 (+2) |  | synonym — row -> cue (column header) |
| Activate row … | Take cue … | cueola-app.js:13565 |  | tooltip-only, synonym — 'Activate row' vs 'GO row' for the same action; TAKE is the one verb |
| GO row … | Take cue … | cueola-app.js:13565 |  | synonym, jargon — GO -> TAKE, row -> cue |
| Row …, …, ……… | Cue …, …, ……… | cueola-app.js:13567 |  | synonym — row -> cue |
| Script • ${b.info\|\| |  | cueola-app.js:13605 |  |  |
| Script saved & pushed · row …${b.info ? | Script saved and sent to the prompter · cue … | cueola-app.js:13750 |  | synonym — pushed -> sent; row -> cue |
| Row … is disabled and cannot go active. | Cue … is disabled and can't be taken. | cueola-app.js:13762 |  | synonym, jargon — row -> cue; 'go active' -> taken |
| Recover failed row … before making it active. | Recover cue … before taking it. | cueola-app.js:13766 |  | synonym — row -> cue |
| That row no longer exists. | That cue no longer exists. | cueola-app.js:13810 |  | synonym — row -> cue |
| Segment headers organize the rundown. They can\'t go on air. | Segments group cues and can't be taken. | cueola-app.js:13811 |  | synonym — 'segment headers' -> segments; 'go on air' -> taken |
| Row … is disabled. Enable it in the rundown to make it active. | Cue … is disabled. Enable it in the rundown first. | cueola-app.js:13812 |  | duplicate, synonym — near-duplicate of 1-108 |
| Browsing. … is calling the show. | Browsing. … is the director. | cueola-app.js:13846 |  | synonym — calling the show -> director |
| End of rundown. There is no next row. | End of rundown. No next cue. | cueola-app.js:13858 |  | synonym — row -> cue |
| Recover failed row … before GO. | Recover cue … before taking it. | cueola-app.js:13860 |  | duplicate, synonym, jargon — duplicate of 1-109; GO removed |
| … is calling the show… | … is the director | cueola-app.js:13993 |  | tooltip-only, synonym — title attr only; make visible |
| … gets rundown control when they connect. Until then you are calling the show. | … becomes director when they connect. Until then, you are the director. | cueola-app.js:13999 |  | tooltip-only, long, synonym — title attr; rundown control / calling -> director |
| Mirroring …'s position | Following … | cueola-app.js:14006 |  | tooltip-only, synonym — mirroring vs following: one word |
| … is calling the show (granted by …)… | … is the director (set by …) | cueola-app.js:14018 |  | tooltip-only, synonym — 'granted' is developer wording |
| … holds rundown control but is not connected. Followers mirror the instructor meanwhile. An admin can take control back here. | … is the director but not connected. Everyone follows the instructor for now. An admin can take back control here. | cueola-app.js:14022 | yes | tooltip-only, long, synonym — three sentences in a title attr; rundown control -> director |
| CALLER | DIRECTOR | cueola-app.js:14090 |  | synonym — CALLER -> DIRECTOR |
| Following … |  | cueola-app.js:14159 |  |  |
| Make everyone follow your live position? | Make everyone follow you? | cueola-app.js:14209 |  |  |
| Forcing all users to follow you. | Everyone is following you. | cueola-app.js:14213 |  | unclear — 'Forcing all users' is developer tone |
| No live users to follow. |  | cueola-app.js:14219 |  |  |
| Force everyone live following …? | Send everyone to Live, following …? | cueola-app.js:14220 |  | unclear — 'Force everyone live following' is hard to parse |
| Forcing everyone live, following …. | Everyone is in Live, following …. | cueola-app.js:14224 |  | unclear — match 1-131 |
| Another operator window took the prompter. This window joined their session. | Another operator window took the prompter. This window joined it. | cueola-app.js:14719 |  | jargon, synonym — 'session' -> drop; operator surface wording |
| Talent · ……%… | Prompter · ……%… | cueola-app.js:15121 |  | synonym — Talent (display) -> prompter |
| Script Op pop-out needs a live (non-demo) session. | The prompter operator window needs a real show, not the demo. | cueola-app.js:15819 |  | jargon, synonym, unclear — Script Op / Script Operator: one name; '(non-demo) session' |
| Start the live prompter session before opening Script Op. | Start the prompter before opening the operator window. | cueola-app.js:15832 |  | synonym — session; Script Op |
| Script Operator could not start. | The prompter operator window could not open. Try again. | cueola-app.js:15838 |  | synonym — Script Operator naming; add what to do |
| Pop-out blocked. Allow pop-ups for Cueola. |  | cueola-app.js:15855 |  |  |
| Script Op opened in a new window. Drag it to another monitor. | Prompter operator opened in a new window. Drag it to another monitor. | cueola-app.js:15863 |  | synonym — Script Op naming |
| Live panel text …% | Prompter text …% | cueola-app.js:15953 |  | unclear — 'Live panel text' is not a student term |
| Pushed to Flowmingo | Sent to prompter | cueola-app.js:15974 |  | brand-for-concept — Flowmingo stands in for prompter; pushed -> sent |
| Clear Flowmingo text? | Clear the prompter text? | cueola-app.js:15990 |  | brand-for-concept — brand name for prompter |
| Window placement needs Chrome or Edge. Drag windows to displays by hand for now. |  | cueola-app.js:16161 |  |  |
| Display access denied. Allow "Window management" for this site. |  | cueola-app.js:16178 |  |  |
| Allow pop-ups to open Flowmingo in a new window. | Allow pop-ups to open the prompter in a new window. | cueola-app.js:16286 |  | brand-for-concept — brand name for prompter |
| Type a code… | Type a show code… | cueola-app.js:16320, cueola-app.js:16326 |  | synonym — code -> show code |
| Talent link copied. Sign in on that device first. | Prompter link copied. Sign in on that device first. | cueola-app.js:16358 |  | synonym — talent link = prompter link |
| Copy did not work here. Select the link and copy it. |  | cueola-app.js:16362 |  |  |
| Browser decides | Any display | cueola-app.js:16370 |  | unclear — 'Browser decides' does not tell a student what happens |
| Detect displays… |  | cueola-app.js:16373 |  |  |
| Some windows were blocked. Allow pop-ups for this site, then use the toolbar buttons. |  | cueola-app.js:16415 |  |  |
| Flowmingo auto-paused at break. | Prompter paused at break. | cueola-app.js:17042 |  | brand-for-concept — brand name for prompter |
| Align left |  | cueola-app.js:17315, cueola-app.js:19856 |  |  |
| Align center |  | cueola-app.js:17316, cueola-app.js:19857 |  |  |
| Align right |  | cueola-app.js:17317, cueola-app.js:19858 |  |  |
| Formatting and markers |  | cueola-app.js:17368 |  |  |
| Make the selected text bold (Cmd+B) | Bold (Cmd+B) | cueola-app.js:17369 |  |  |
| Make the selected text italic (Cmd+I) | Italic (Cmd+I) | cueola-app.js:17370 |  |  |
| Start a new paragraph | (delete) | cueola-app.js:17375 |  | tooltip-only, unclear — button says 'Line' but tooltip says paragraph; fix the label (1-177) and drop the tip |
| Line | Paragraph | cueola-app.js:17375 |  | unclear — inserts a paragraph break, not a line |
| Zoom |  | cueola-app.js:17381 |  |  |
| Operator control groups | Prompter controls | cueola-app.js:17409 |  | synonym — operator vs prompter naming; see 1-232 |
| Holding … |  | cueola-app.js:17482 |  |  |
| Next … |  | cueola-app.js:17499 |  |  |
| Cue Flowmingo to the current rundown row | Prompter to current cue | cueola-app.js:18187 |  | tooltip-only, brand-for-concept, synonym — Flowmingo for prompter; row -> cue; hover-only on an action |
| Cue Flowmingo to the next rundown row | Prompter to next cue | cueola-app.js:18188 |  | tooltip-only, brand-for-concept, synonym — as 1-182 |
| Find in script… |  | cueola-app.js:18191 |  |  |
| Cue Flowmingo to the next line containing this text (repeat to walk through matches) | Jump prompter to the next match | cueola-app.js:18192 |  | tooltip-only, long, brand-for-concept — hover-only; parenthetical belongs in an info icon if kept |
| GO readies the linked clip. Only an explicit TAKE fires it. | (delete) | cueola-app.js:18200 |  | tooltip-only, jargon, state-as-action — Manual TAKE / armed call is removed in 3.0 |
| Manual TAKE (armed call) | (delete) | cueola-app.js:18200 |  | jargon, state-as-action — Manual TAKE (armed call) is removed in 3.0 |
| Show a Technical Difficulties stand-by cover on Flowmingo | Technical Difficulties slate | cueola-app.js:18202 |  | tooltip-only, brand-for-concept, synonym — 'stand-by' collides with STANDBY; Flowmingo for prompter; make visible label |
| Toggle technical difficulties cover | Technical Difficulties slate | cueola-app.js:18202 |  |  |
| Generate NTSC color bars on Flowmingo | Color bars | cueola-app.js:18203 |  | tooltip-only, brand-for-concept — Flowmingo for prompter; hover-only on an action |
| Toggle NTSC color bars | Color bars | cueola-app.js:18203 |  |  |
| Cue back | Prompter back | cueola-app.js:18210 |  | tooltip-only, synonym — 'Cue' as a verb collides with cue the item; hover-only |
| Cue forward | Prompter forward | cueola-app.js:18212 |  | tooltip-only, synonym — as 1-192 |
| Punch in from this script position | Start prompter here | cueola-app.js:18213, cueola-app.js:18213 |  | unclear, jargon — 'Punch in' needs explaining |
| Type a few words from the script first. |  | cueola-app.js:18224 |  |  |
| Use at least three characters so the match is meaningful. | Type at least three characters. | cueola-app.js:18225 |  | duplicate, long — same moment as 1-195; drop the justification |
| Link this show again | (delete) | cueola-app.js:18881 |  | tooltip-only — button already says Resume with the code and 'Linked last time' |
| ' + esc(code) + ' |  | cueola-app.js:18882 |  |  |
| Linked last time on this device |  | cueola-app.js:18882 |  |  |
| Sign in on this device to see your shows |  | cueola-app.js:18910 |  |  |
| Your shows |  | cueola-app.js:18925 |  |  |
| Admin sign-in: type the show code below |  | cueola-app.js:18929 |  |  |
| Enter the show code first. |  | cueola-app.js:18975 |  |  |
| Connecting to |  | cueola-app.js:18979 |  |  |
| Cloud write refused: sign in again on this device | Not saved. Sign in again on this device. | cueola-app.js:19061 |  | jargon — 'Cloud write refused' -> the one saving indicator wording |
| Question added to the script · row …${b.info ? | Question added to the script · cue … | cueola-app.js:19348 |  | synonym — row -> cue |
| Clipboard access is not available in this browser. |  | cueola-app.js:19362 |  |  |
| Clipboard is empty. Copy the chat question first. |  | cueola-app.js:19366 |  |  |
| Clipboard blocked. Click into this tab and allow clipboard access, then press again. |  | cueola-app.js:19367 |  |  |
| Overlays stashed. Press again to restore. | Overlays hidden. Press again to bring them back. | cueola-app.js:19389 |  | unclear — 'stashed' is not plain |
| No overlays on, nothing stashed. | No overlays are on. | cueola-app.js:19393 |  | unclear — 'stashed' |
| Overlays restored. |  | cueola-app.js:19405 |  |  |
| Duration minutes |  | cueola-app.js:19784 |  |  |
| Countdown target time |  | cueola-app.js:19785 |  |  |
| Custom wrap minutes |  | cueola-app.js:19795 |  |  |
| Overlay smaller |  | cueola-app.js:19814 |  |  |
| Overlay bigger |  | cueola-app.js:19816 |  |  |
| This session has no Flowmingo script yet. | This show has no prompter script yet. | cueola-app.js:19979 |  | synonym, brand-for-concept — session -> show; Flowmingo for prompter |
| Code | Show code | cueola-app.js:19985 |  | synonym — code -> show code |
| Or type a show code above. |  | cueola-app.js:20012 |  |  |
| Loaded script from Cueola |  | cueola-app.js:20299 |  |  |
| No script in Cueola yet. Add script cues and push to Flowmingo from the live view. | No script yet. Add script to cues and send it to the prompter from Live. | cueola-app.js:20301 |  | long, brand-for-concept — Flowmingo for prompter; 'script cues' is unclear |
| Sign in on this device to link |  | cueola-app.js:20339, cueola-app.js:20341 |  |  |
| Class key needed for |  | cueola-app.js:20352 |  | unclear — 'class key' is never defined on screen; explain it once behind an info icon |
| No show found for "…". Double-check the code. |  | cueola-app.js:20399 |  |  |
| Flowmingo linked to … | Prompter linked to … | cueola-app.js:20497 |  | brand-for-concept — Flowmingo for prompter |
| Linked to |  | cueola-app.js:20502 |  |  |
| Flowmingo operator controls | Prompter controls | cueola-app.js:20782 |  | brand-for-concept, duplicate — same region label as 1-179 |
| That group no longer exists. |  | cueola-app.js:21302 |  |  |
| Groups are locked. Ask your instructor to move you. |  | cueola-app.js:21305 |  |  |
| Reviewing |  | cueola-app.js:21331 |  |  |
| Your group |  | cueola-app.js:21338 |  |  |
| Groups are locked |  | cueola-app.js:21340 |  |  |
| Switch group |  | cueola-app.js:21341 |  |  |
| Editing now |  | cueola-app.js:21924 |  | tooltip-only — presence avatar hint; harmless but hover-only |
| On this page |  | cueola-app.js:21957 |  |  |
| Elsewhere |  | cueola-app.js:21958 |  |  |
| Patch sheet updated by a collaborator. | Patch sheet updated by someone else. | cueola-app.js:22187 |  |  |
| Published notes save automatically. Draft kept. | Notes save automatically. Your draft is kept. | cueola-app.js:22374 |  | unclear — 'Published notes' vs draft is confusing at a glance |
| Rundown is already part of the package. | The rundown is already in the paperwork export. | cueola-app.js:22375 |  | synonym — package -> paperwork |
| What this show code requires. Off means hidden for the whole crew and skipped in the package export. Saved work is kept and comes back when an item is turned back on. Production Notes is always on. | Choose which paperwork this show requires. Off hides it for the crew and leaves it out of the export; saved work comes back when it is turned on again. Production Notes is always on. | cueola-app.js:22509 | yes | long — four sentences of helper text |
| Choose a saved profile, position, and required paperwork. The saved roster shows here for the whole crew. Changes remain unsaved until Firestore confirms | Choose a profile, position, and required paperwork for each person. The crew sees this roster. Nothing is saved until you press Save assignments. | cueola-app.js:22610 | yes | long, jargon — 'Firestore confirms' is developer wording |
| Save assignments |  | cueola-app.js:22610, cueola-app.js:22623 |  |  |
| Positions |  | cueola-app.js:22613 |  |  |
| Remove … from this production | Remove … from this show | cueola-app.js:22615 |  | synonym — production -> show |
| + Add person |  | cueola-app.js:22622 |  |  |
| This workspace is not on a shared show code. Open Planda Bear with the show code to set position assignments. | No show code. Open the planner with a show code to assign positions. | cueola-app.js:22637 |  | brand-for-concept, jargon — 'workspace' and Planda Bear for planner |
| Only instructors can add Planda Bear comments. | Only instructors can add comments. | cueola-app.js:22814 |  | brand-for-concept — Planda Bear for planner |
| Instructor comment added. |  | cueola-app.js:22838 |  |  |
| Comment marked reviewed. |  | cueola-app.js:22853 |  |  |
| Instructor comment removed. |  | cueola-app.js:22862 |  |  |
| Comment section |  | cueola-app.js:22878 |  |  |
| Reviewed by you |  | cueola-app.js:22906 |  |  |
| Mark reviewed |  | cueola-app.js:22907 |  |  |
| Nothing yet. Notes you leave show up here for the whole group. |  | cueola-app.js:22911 |  |  |
| Add a comment for students to review... |  | cueola-app.js:22915 |  |  |
| Add Comment |  | cueola-app.js:22916 |  |  |
| Pick an image file. |  | cueola-app.js:23592 |  |  |
| That image is too large. Pick one under 15 MB. |  | cueola-app.js:23596 |  |  |
| That image is too large after compression. Try a simpler one. |  | cueola-app.js:23607 |  |  |
| Could not read that image. |  | cueola-app.js:23611, cueola-streamdeck.js:4510 |  |  |
| Background color |  | cueola-app.js:23629, cueola-identity.js:1154 |  |  |
| Background … |  | cueola-app.js:23632 |  |  |
| Use this background |  | cueola-app.js:23632 |  |  |
| This is how you appear across Cueola. |  | cueola-app.js:23637 |  |  |
| Choose your look |  | cueola-app.js:23639 |  |  |
| Initials |  | cueola-app.js:23642, cueola-identity.js:1139 |  |  |
| Profile updated. |  | cueola-app.js:23656 |  |  |
| Type a note first, then export it. |  | cueola-app.js:23775 |  |  |
| The export model is unavailable. Reload Cueola before exporting. | Export isn't ready. Reload Cueola and try again. | cueola-app.js:23780 |  | jargon — 'export model' is developer wording |
| Building note PDF... |  | cueola-app.js:23800, cueola-app.js:25757 |  |  |
| Unpublished note PDF downloaded · … pages. |  | cueola-app.js:23803 |  |  |
| Export canceled. |  | cueola-app.js:23805, cueola-app.js:25765 (+5) |  |  |
| PDF renderer unavailable. Print preview opened · … pages. Safari tip: pick Letter + orientation in the dialog. | Print preview opened instead of a PDF · … pages. In Safari, pick Letter and the orientation in the dialog. | cueola-app.js:23809, cueola-app.js:25768 (+5) |  | long, jargon — 'PDF renderer' is developer wording |
| Could not render the unpublished note: … |  | cueola-app.js:23811 |  |  |
| "…" is over the 4 MB document limit. | “…” is over the 4 MB limit. | cueola-app.js:23960 |  |  |
| Up to … attachments per …. |  | cueola-app.js:23995 |  |  |
| Couldn't read "…". |  | cueola-app.js:24002 |  |  |
| Remove attachment |  | cueola-app.js:24033, cueola-app.js:24033 |  |  |
| Attachment is too large to keep offline. It will only last this visit. |  | cueola-app.js:24082 |  |  |
| Fetching attachment… |  | cueola-app.js:24165 |  |  |
| Could not load that attachment. |  | cueola-app.js:24167 |  |  |
| Image is still loading. Try again in a second. |  | cueola-app.js:24178 |  |  |
| Crew position |  | cueola-app.js:24366 |  |  |
| Assign this to-do to someone in the session | Assign to someone on the show | cueola-app.js:24495 |  | tooltip-only, synonym — session -> show; hover-only |
| Anyone |  | cueola-app.js:24497, cueola-app.js:24537 |  |  |
| To-do item … |  | cueola-app.js:24535 |  |  |
| Checklist item … |  | cueola-app.js:24535 |  |  |
| Who owes this item | Assigned to | cueola-app.js:24536 |  | duplicate, unclear — 'owes' vs 'Assigned to' (1-321) for the same thing |
| Assign checklist item … |  | cueola-app.js:24536 |  |  |
| Remove item |  | cueola-app.js:24540, cueola-app.js:24540 (+1) |  |  |
| Uploading …… |  | cueola-app.js:24597, cueola-app.js:24696 |  |  |
| Only instructors can pin notes. |  | cueola-app.js:24639 |  |  |
| You can only edit your own notes. |  | cueola-app.js:24652 |  |  |
| A note needs some text, or delete it instead. |  | cueola-app.js:24678 |  |  |
| Type a note, add a checklist, or attach a file first. |  | cueola-app.js:24692 |  |  |
| Could not post the note. Check your connection and try again. |  | cueola-app.js:24730 |  |  |
| Only instructors or the author can check off this to-do. |  | cueola-app.js:24740 |  |  |
| You can only remove your own notes. |  | cueola-app.js:24753 |  |  |
| Note removed. |  | cueola-app.js:24766 |  |  |
| Click to enlarge |  | cueola-app.js:24773 |  |  |
| Loading image… |  | cueola-app.js:24773 |  |  |
| Download & send to the Outrangutan SFX board | Send to playback SFX board | cueola-app.js:24779 |  | tooltip-only, brand-for-concept — Outrangutan for playback; hover-only on an action |
| Download |  | cueola-app.js:24780 |  |  |
| Loading audio… |  | cueola-app.js:24781 |  |  |
| Download this file | Download | cueola-app.js:24784 |  | duplicate — same action as 1-312 with different words |
| That audio isn’t ready yet. Try again in a moment. |  | cueola-app.js:24809 |  |  |
| Could not read that audio file. |  | cueola-app.js:24811 |  |  |
| Downloaded “…” and added it to Outrangutan’s SFX board. | Downloaded “…” and added it to the playback SFX board. | cueola-app.js:24825 |  | brand-for-concept — Outrangutan for playback |
| Downloaded “…”. Open Outrangutan → SFX Board and add it to a pad, or pull it there with the SFX tab’s Import from Production Notes. | Downloaded “…”. On playback, open SFX Board and add it to a pad. | cueola-app.js:24828 |  | long, brand-for-concept — two routes in one toast; keep one |
| Enter to save · Esc to cancel |  | cueola-app.js:24903 |  |  |
| Completed |  | cueola-app.js:24916 |  |  |
| Assigned to |  | cueola-app.js:24917, cueola-app.js:24949 |  |  |
| Only instructors or the author can check off items. |  | cueola-app.js:24975 |  | duplicate — same rule as 1-306 worded differently; use one string |
| Nothing to add: the to-do has no text. | The to-do has no text. | cueola-app.js:25015 |  |  |
| Already on the Ready Before Show checklist. |  | cueola-app.js:25021 |  |  |
| Added to the Production Schedule: Ready Before Show. |  | cueola-app.js:25033 |  |  |
| That note is no longer on the board. |  | cueola-app.js:25040 |  |  |
| That checklist item is gone. |  | cueola-app.js:25043 |  |  |
| … items added to Ready Before Show. |  | cueola-app.js:25059 |  |  |
| Only instructors can open the who-owes-what view. | Only instructors can open the assignments view. | cueola-app.js:25066 |  | unclear — 'who-owes-what' is not a screen name a student knows |
| Nothing open. Every to-do and checklist item is checked off. | All to-dos and checklist items are done. | cueola-app.js:25077 |  | long — two sentences for an empty state |
| Jump to this note |  | cueola-app.js:25088 |  |  |
| Add to the Production Schedule's Ready Before Show checklist | Add to the Ready Before Show checklist | cueola-app.js:25088 |  | long, tooltip-only — button reads 'Schedule'; the tip carries the meaning |
| Add the open to-dos to the Production Schedule's Ready Before Show checklist | Add to the Ready Before Show checklist | cueola-app.js:25136 |  | long, tooltip-only, duplicate — same control as 2-2, second wording |
| Edit your reply |  | cueola-app.js:25169, cueola-app.js:25169 |  |  |
| Delete reply |  | cueola-app.js:25170, cueola-app.js:25170 |  |  |
| Reply to …… Type @ to mention someone. | Reply… (@ to mention someone) | cueola-app.js:25180 |  | long — placeholder is two sentences |
| Attach to reply |  | cueola-app.js:25181, cueola-app.js:25181 |  |  |
| Reply |  | cueola-app.js:25183, cueola-app.js:25736 |  |  |
| Collapse note |  | cueola-app.js:25210, cueola-app.js:25210 |  |  |
| Expand note |  | cueola-app.js:25214 |  |  |
| … note…${openTodos ? |  | cueola-app.js:25253 |  |  |
| No notes yet |  | cueola-app.js:25257 |  |  |
| Start the board: post a note, a photo, or a file. Everyone in this session sees it live. | Post a note, photo, or file. Everyone in this show sees it. | cueola-app.js:25257 |  | long, synonym — session -> show; three clauses |
| No matching notes |  | cueola-app.js:25268 |  |  |
| Nothing matches that search or tag. |  | cueola-app.js:25268 |  |  |
| Clear filters |  | cueola-app.js:25268 |  |  |
| Attached image |  | cueola-app.js:25305 |  |  |
| This browser does not support notifications. | This browser can't show browser alerts. | cueola-app.js:25561 |  | synonym — 'notifications' vs 'browser alerts' for the same thing |
| Browser alerts off. You will still see in-app alerts and the badge. |  | cueola-app.js:25566 |  |  |
| Browser alerts on. |  | cueola-app.js:25571, cueola-app.js:25574 |  |  |
| Notifications blocked. You will still see in-app alerts. | Browser alerts blocked. You will still see in-app alerts. | cueola-app.js:25575 |  | synonym — notifications -> browser alerts |
| Notifications are blocked in your browser settings for this site. | Browser alerts are blocked for this site in your browser settings. | cueola-app.js:25579 |  | synonym — notifications -> browser alerts |
| Likes |  | cueola-app.js:25698 |  |  |
| Production Note |  | cueola-app.js:25709 |  |  |
| Tag |  | cueola-app.js:25712, cueola-app.js:25742 |  |  |
| Author |  | cueola-app.js:25713 |  |  |
| (edited) |  | cueola-app.js:25736 |  |  |
| By |  | cueola-app.js:25742 |  |  |
| Note |  | cueola-app.js:25742 |  |  |
| No production notes yet. |  | cueola-app.js:25743 |  |  |
| Production note PDF downloaded · … pages. |  | cueola-app.js:25763 |  |  |
| Note export blocked: … | Couldn't export the note: … | cueola-app.js:25771 |  | unclear, synonym — 'blocked' does not say what happened; many 'X blocked' variants |
| Notes preview blocked: … | Couldn't preview the notes: … | cueola-app.js:25790 |  | unclear, synonym — 'blocked' variant |
| Building notes log PDF... | Building the notes PDF… | cueola-app.js:25804 |  | synonym — 'notes log' vs 'production notes' |
| Notes log PDF downloaded · … pages. | Notes PDF downloaded · … pages. | cueola-app.js:25810 |  | synonym — 'notes log' vs 'production notes' |
| Notes export blocked: … | Couldn't export the notes: … | cueola-app.js:25818 |  | unclear, synonym, duplicate — 'blocked' variant; near-duplicate of 2-33 |
| Target row | Target cue | cueola-app.js:25850 |  | synonym — row -> cue |
| Pick a row… | Pick a cue… | cueola-app.js:25851 |  | synonym — row -> cue |
| Add a row first | Add a cue first | cueola-app.js:25854 |  | synonym — row -> cue |
| Close notes panel |  | cueola-app.js:25872 |  |  |
| Copy note text to the target row's notes field | Add to the cue's notes | cueola-app.js:25909 |  | tooltip-only, synonym, jargon — 'field' is dev vocabulary; row -> cue; meaning lives only in the tip |
| Set as script cue text on the target row | Use as the cue's script | cueola-app.js:25912 |  | tooltip-only, synonym — row -> cue; meaning lives only in the tip |
| Create a new rundown row from this note | Add a new cue from this note | cueola-app.js:25916 |  | tooltip-only, synonym — row -> cue; meaning lives only in the tip |
| Pick a target row first. | Pick a cue first. | cueola-app.js:25947, cueola-app.js:25959 |  | synonym — row -> cue |
| Note has no text to add. |  | cueola-app.js:25948 |  |  |
| Note added to row …. | Note added to cue …. | cueola-app.js:25952 |  | synonym — row -> cue |
| Note has no text to use as script. |  | cueola-app.js:25960 |  |  |
| Script set on row …. | Script set on cue …. | cueola-app.js:25965 |  | synonym — row -> cue |
| New row added from note (now the target row). | New cue added from the note. | cueola-app.js:25980 |  | synonym, long — row -> cue; parenthetical adds a second idea |
| Last by … · … | Last edited by … · … | cueola-app.js:26023 |  | unclear — 'Last by' is not a phrase |
| That paperwork type is turned off for this session. | That paperwork is turned off for this show. | cueola-app.js:26057 |  | synonym — session -> show |
| Building fixed-page preview… | Building preview… | cueola-app.js:26560 |  | unclear — 'fixed-page' means nothing to a student |
| Rundown preview blocked: … | Couldn't preview the rundown: … | cueola-app.js:26615 |  | unclear, synonym — 'blocked' variant |
| Dur |  | cueola-app.js:26722, cueola-app.js:26723 (+1) |  |  |
| Total |  | cueola-app.js:26722, cueola-app.js:26723 |  |  |
| = standby the source · | (delete) | cueola-app.js:26724 |  | state-as-action, synonym — READY is removed in 3.0; standby is shown, not pressed |
| = go · For playback rows: | TAKE = go to this cue ·  | cueola-app.js:26724 |  | synonym — 'rows' -> cues; legend shrinks to TAKE + OUT + Total |
| = start the clip · | (delete) | cueola-app.js:26724 |  | synonym — ROLL is removed in 3.0; TAKE starts the clip |
| = the plan for getting out · Total = running show time | OUT = how the cue ends · Total = running show time | cueola-app.js:26724 |  | unclear — 'the plan for getting out' is vague |
| Total runtime | Total running time | cueola-app.js:26725 |  | jargon — 'runtime' is on the dev-word list |
| No rows yet. | No cues yet. | cueola-app.js:26726 |  | synonym — rows -> cues |
| Call sheet preview blocked: … | Couldn't preview the call sheet: … | cueola-app.js:26747 |  | unclear, synonym — 'blocked' variant |
| Stage plot saved. |  | cueola-app.js:27414 |  |  |
| Only instructors and admins can add stage plots. |  | cueola-app.js:27536 |  |  |
| Added another stage plot. |  | cueola-app.js:27557 |  |  |
| Only instructors and admins can delete a stage plot. |  | cueola-app.js:27561 |  |  |
| A session always keeps at least one stage plot. | A show always keeps at least one stage plot. | cueola-app.js:27566 |  | synonym — session -> show |
| Delete "…"? |  | cueola-app.js:27571, cueola-app.js:29373 |  |  |
| Stage plot deleted. |  | cueola-app.js:27589 |  |  |
| That cable already runs there on this layer. |  | cueola-app.js:27733 |  |  |
| That cable already runs there on that layer. | That cable already runs there on this layer. | cueola-app.js:27766 |  | duplicate — near-duplicate of 2-71 |
| A cable already runs that direction on this layer. | That cable already runs there on this layer. | cueola-app.js:27784 |  | duplicate — near-duplicate of 2-71 |
| Work on the … layer |  | cueola-app.js:27958 |  |  |
| … the … layer |  | cueola-app.js:27961, cueola-app.js:27961 |  |  |
| Draw signal flow on the … layer: click the source, then the destination. Shortcut: F | Draw a cable: click the source, then the destination (F). | cueola-app.js:27964 | yes | long, tooltip-only — how-to lives only in a hover tip |
| One PDF with each layer on its own page plus the combined plot | One PDF: each layer on its own page, plus all layers together. | cueola-app.js:27967 | yes | long, tooltip-only — explanation lives only in a hover tip |
| Layer Set PDF | Export layers | cueola-app.js:27968 |  | unclear — 'Layer Set PDF' is not a verb and not a plain phrase |
| FRONT · AUDIENCE |  | cueola-app.js:28136 |  |  |
| 1 square = 1 ft |  | cueola-app.js:28137 |  |  |
| All layers are hidden. Show one in the layer bar above. |  | cueola-app.js:28139 |  |  |
| Stage plot editor canvas |  | cueola-app.js:28165 |  |  |
| Manage the bank from the main workspace, outside a group. It applies to the whole session. | Leave the group to manage the bank. It applies to the whole show. | cueola-app.js:28195 |  | long, synonym, unclear — session -> show; 'main workspace' undefined |
| Tap gear to hide it from students. Anything already placed stays on the plot. | Tap an item to hide it from students. Placed items stay on the plot. | cueola-app.js:28234 |  | unclear, long — 'gear' reads as the settings icon |
| Label |  | cueola-app.js:28258, cueola-app.js:30212 (+1) |  |  |
| Layer |  | cueola-app.js:28262, cueola-app.js:28312 |  |  |
| Rotation |  | cueola-app.js:28266 |  |  |
| Rotate -45° |  | cueola-app.js:28270 |  |  |
| Rotate +45° |  | cueola-app.js:28271 |  |  |
| Drape panels |  | cueola-app.js:28277 |  |  |
| Panels |  | cueola-app.js:28279 |  |  |
| Wide (feet) |  | cueola-app.js:28280 |  |  |
| Size (feet) |  | cueola-app.js:28283, cueola-app.js:28289 |  |  |
| Wide |  | cueola-app.js:28285, cueola-app.js:28291 (+1) |  |  |
| Deep (auto) |  | cueola-app.js:28286 |  |  |
| Deep |  | cueola-app.js:28292, cueola-app.js:28340 |  |  |
| Arrange |  | cueola-app.js:28295, cueola-app.js:28315 |  |  |
| Bring Forward |  | cueola-app.js:28297 |  |  |
| Send Back |  | cueola-app.js:28298 |  |  |
| Cable |  | cueola-app.js:28301 |  |  |
| Out of |  | cueola-app.js:28303 |  |  |
| Connector |  | cueola-app.js:28306 |  |  |
| Reverse Direction |  | cueola-app.js:28317 |  |  |
| Floor plan |  | cueola-app.js:28328 |  |  |
| Assign the floor plan for your learning space. Picking a room sizes the space to match it. | Pick a room to size the space to match it. | cueola-app.js:28334 | yes | long — two sentences of helper text |
| Space size (feet) |  | cueola-app.js:28337 |  |  |
| Grid |  | cueola-app.js:28342 |  |  |
| Snap to the half-foot grid |  | cueola-app.js:28344 |  |  |
| Each grid square is one foot. The front of the space faces the audience. | Each square is one foot. The front faces the audience. | cueola-app.js:28345 | yes | long, duplicate — repeats 2-79 and 2-80 which are already on the canvas |
| Selected item |  | cueola-app.js:28350, cueola-app.js:28350 |  |  |
| Space and grid |  | cueola-app.js:28351, cueola-app.js:28351 |  |  |
| Stage plot diagram |  | cueola-app.js:28572 |  |  |
| Venue |  | cueola-app.js:28578, cueola-app.js:29577 |  |  |
| Date |  | cueola-app.js:28579 |  |  |
| Layers |  | cueola-app.js:28580 |  |  |
| Scale |  | cueola-app.js:28581 |  |  |
| … stage plot figure… could not pre-render; the PDF uses the live drawing instead (may differ slightly). | … stage plot drawings may look slightly different in the PDF. | cueola-app.js:28654 |  | jargon, long — 'pre-render' is dev vocabulary |
| Could not render …: … | Couldn't build …: … | cueola-app.js:28677 |  | jargon — 'render' is dev vocabulary |
| Stage plot preview blocked: … | Couldn't preview the stage plot: … | cueola-app.js:28699 |  | unclear, synonym — 'blocked' variant |
| Export blocked: … | Couldn't export: … | cueola-app.js:28714, cueola-app.js:28742 (+3) |  | unclear, duplicate — 'blocked' does not say what happened; one of many variants |
| Remove PPE item |  | cueola-app.js:29050 |  |  |
| Add PPE item |  | cueola-app.js:29052 |  |  |
| Call sheet saved. |  | cueola-app.js:29327, cueola-app.js:31148 |  |  |
| Only an instructor or admin can delete a call sheet. | Only instructors and admins can delete a call sheet. | cueola-app.js:29359 |  | synonym — 'an instructor or admin' vs 'instructors and admins' in 2-67 |
| A session always keeps at least one call sheet. | A show always keeps at least one call sheet. | cueola-app.js:29362 |  | synonym — session -> show |
| Added another call sheet. |  | cueola-app.js:29490 |  |  |
| Nearest Hospital |  | cueola-app.js:29585 |  |  |
| Crew / Talent |  | cueola-app.js:29587 |  |  |
| Email |  | cueola-app.js:29588, cueola-app.js:31271 (+1) |  |  |
| Phone |  | cueola-app.js:29588, cueola-app.js:31272 (+1) |  |  |
| No crew or talent entered yet. |  | cueola-app.js:29588 |  |  |
| Safety plan saved. |  | cueola-app.js:29662 |  |  |
| REQUIRED: |  | cueola-app.js:29687 |  |  |
| Preview blocked: … | Couldn't preview: … | cueola-app.js:29715, cueola-app.js:29965 (+1) |  | unclear, duplicate — 'blocked' variant |
| Checklist Item |  | cueola-app.js:29822 |  |  |
| Add a ready-before-show item |  | cueola-app.js:29828 |  |  |
| Remove readiness row | Remove checklist item | cueola-app.js:29831 |  | synonym — 'readiness row' vs 'checklist item' for the same thing |
| Add checklist item |  | cueola-app.js:29839 |  |  |
| Production schedule saved. |  | cueola-app.js:29924 |  |  |
| No separate setup day. Setup happens on show day. |  | cueola-app.js:29935 |  |  |
| No ready-before-show items yet. |  | cueola-app.js:29957 |  |  |
| Move row up |  | cueola-app.js:29999 |  |  |
| Move … row … up |  | cueola-app.js:29999 |  |  |
| Move row down |  | cueola-app.js:30000 |  |  |
| Move … row … down |  | cueola-app.js:30000 |  |  |
| Type directly in the first row. Use Add row for another line, or import a CSV/TSV. The arrows reorder rows. | Type in the first row, or import a CSV/TSV. | cueola-app.js:30005 | yes | long — three sentences of helper text |
| Remove … row … |  | cueola-app.js:30014, cueola-app.js:30022 |  |  |
| Add row |  | cueola-app.js:30026 |  |  |
| Import CSV/TSV |  | cueola-app.js:30027 |  |  |
| Add rows manually or upload a CSV/TSV. Imported columns fill left to right. | Add rows or import a CSV/TSV. Columns fill left to right. | cueola-app.js:30083 | yes | long, duplicate — says what 2-146 already says |
| Video patch sheet saved. |  | cueola-app.js:30147 |  |  |
| Audio and comms patch sheets saved. |  | cueola-app.js:30151 |  |  |
| Patch rows imported. |  | cueola-app.js:30196 |  |  |
| Gear |  | cueola-app.js:30212 |  |  |
| Cabling |  | cueola-app.js:30212 |  |  |
| No rows saved yet. |  | cueola-app.js:30212 |  |  |
| What’s in the export package |  | cueola-app.js:30286 |  |  |
| Package export options |  | cueola-app.js:30286 |  |  |
| Package preview blocked: … | Couldn't preview the package: … | cueola-app.js:30313 |  | unclear, synonym — 'blocked' variant |
| Who holds each position, and the paperwork that position owns. |  | cueola-app.js:30334 |  |  |
| Required paperwork |  | cueola-app.js:30336 |  |  |
| Assigned by |  | cueola-app.js:30336 |  |  |
| Updated |  | cueola-app.js:30336 |  |  |
| No canonical assignments were saved for this production. | No positions have been assigned for this show. | cueola-app.js:30337 |  | jargon, synonym — 'canonical' is dev vocabulary; production -> show |
| Page … of … |  | cueola-app.js:30851 |  |  |
| Download window blocked. Allow pop-ups for this site, then export again. |  | cueola-app.js:30896 |  |  |
| Remove person |  | cueola-app.js:31283, cueola-app.js:31283 |  |  |
| The roster already lists … … with positions. Tap Fill from roster to add them all at once. | … people on the roster have positions. Tap Fill from roster to add them. | cueola-app.js:31293 |  | long — two long sentences |
| No saved role assignments yet. Assign positions on the Planda Bear hub first. | No positions assigned yet. Assign positions in the planner first. | cueola-app.js:31319 |  | brand-for-concept, synonym — Planda Bear stands in for 'planner'; 'role' vs 'position' |
| … from the roster. |  | cueola-app.js:31353 |  |  |
| The sheet already matches the roster. |  | cueola-app.js:31356 |  |  |
| The rundown has no timed rows yet. | The rundown has no timed cues yet. | cueola-app.js:31364 |  | synonym — rows -> cues |
| Set a show start or call time first. |  | cueola-app.js:31366 |  |  |
| Estimated wrap … (start + … runtime). | Estimated wrap … (start + … running time). | cueola-app.js:31372 |  | jargon — 'runtime' is on the dev-word list |
| Call sheet PDF downloaded · … pages. |  | cueola-app.js:31420 |  |  |
| Could not render the saved call sheet: … | Couldn't build the call sheet PDF: … | cueola-app.js:31428 |  | jargon — 'render' is dev vocabulary |
| Export blocked: the Safety Plan needs at least … real OSHA PPE items. "None" and "N/A" do not count. | The safety plan needs at least … PPE items before export. "None" and "N/A" don't count. | cueola-app.js:31437 |  | long — leads with 'Export blocked' instead of the fix |
| Planda Bear package PDF downloaded · … pages. | Paperwork package PDF downloaded · … pages. | cueola-app.js:31467 |  | brand-for-concept — Planda Bear stands in for 'paperwork' |
| Could not render the saved package: … | Couldn't build the package PDF: … | cueola-app.js:31475 |  | jargon — 'render' is dev vocabulary |
| Rundown PDF downloaded · … pages. |  | cueola-app.js:31504 |  |  |
| Could not render the saved rundown: … | Couldn't build the rundown PDF: … | cueola-app.js:31512 |  | jargon — 'render' is dev vocabulary |
| Leave this session and return to the front page? | Leave this show and go to the front page? | cueola-app.js:31622 |  | synonym — session -> show |
| … needs a class key for this session. Sign in or enter your key to continue. | … needs a class key for this show. Sign in or enter your key. | cueola-app.js:31653 |  | synonym — session -> show |
| Offline in this browser. You can open a local copy with this code. | You're offline. This show code opens the copy saved on this device. | cueola-app.js:31861 |  | unclear — 'local copy' is not a student phrase |
| Have a profile? |  | cueola-identity.js:857 |  |  |
| Use my username | Sign in | cueola-identity.js:858 |  |  |
| Joining as |  | cueola-identity.js:870, outrangutan/outrangutan.js:6285 |  |  |
| Profile |  | cueola-identity.js:871, cueola-identity.js:1967 |  |  |
| Create profile |  | cueola-identity.js:951, cueola-identity.js:1175 (+1) |  |  |
| First time here. I have a login code from my instructor. | First time here. I have a class code from my instructor. | cueola-identity.js:952 |  | synonym — 'login code' is a third name; FALL26TV is a class code, not a show code |
| I have a username |  | cueola-identity.js:954 |  |  |
| Sign in on this device. No password needed. | Sign in with your username and PIN. | cueola-identity.js:955 |  | unclear — says 'no password' but a PIN is required two screens later |
| Just pick an avatar |  | cueola-identity.js:957 |  |  |
| Device-only look for the notes board, no profile. | No profile. Just a look for your notes on this device. | cueola-identity.js:958 |  | unclear — 'device-only look for the notes board' is hard to parse |
| e.g. alex.j |  | cueola-identity.js:970, cueola-identity.js:1119 |  |  |
| Not you? |  | cueola-identity.js:998, cueola-identity.js:1013 (+3) |  |  |
| e.g. FALL26TV |  | cueola-identity.js:1006, cueola-identity.js:1109 |  |  |
| New PIN |  | cueola-identity.js:1007, cueola-identity.js:2188 |  |  |
| Repeat PIN |  | cueola-identity.js:1009, cueola-identity.js:1129 (+1) |  |  |
| Save and continue | Continue | cueola-identity.js:1012, cueola-identity.js:2190 |  | duplicate — same step-forward action as 'Continue' (5-20) |
| PIN |  | cueola-identity.js:1019, cueola-identity.js:1127 (+1) |  |  |
| Continue |  | cueola-identity.js:1111, cueola-identity.js:1122 (+3) |  |  |
| Full name |  | cueola-identity.js:1116 |  |  |
| e.g. Alex Johnson |  | cueola-identity.js:1117 |  |  |
| Lowercase letters, numbers, dots and dashes. This is what you type to sign in. | Lowercase letters, numbers, dots, dashes. | cueola-identity.js:1120 | yes | long — second sentence goes behind the info icon |
| 4 digits |  | cueola-identity.js:1128, cueola-identity.js:1130 |  |  |
| You type this with your username to sign in. Avoid easy ones like 1234, 1111, or your birth year. | Avoid 1234, 1111, or your birth year. | cueola-identity.js:1131 | yes | long — first sentence repeats what the screen already shows |
| Background ' + esc(c) + ' |  | cueola-identity.js:1156 |  |  |
| Show codes |  | cueola-identity.js:1171 |  |  |
| e.g. SHOW42, NEWS7 (optional) |  | cueola-identity.js:1172 |  |  |
| Separate multiple codes with commas. You can always add more later. | Separate codes with commas. | cueola-identity.js:1173 |  | long — second sentence is reassurance, not instruction |
| Sign out on this device | Sign out | cueola-identity.js:1534, cueola-identity.js:1595 |  | long — button should be a short verb |
| Remove this session from your profile | (delete) | cueola-identity.js:1547, cueola-identity.js:1634 |  | tooltip-only, synonym — session -> show; hover-only; make the button text 'Remove' and drop the tip |
| Remove ' + esc(entry.code) + ' from your profile |  | cueola-identity.js:1547, cueola-identity.js:1634 |  |  |
| This profile was loaded from offline cache and may be out of date. | You're offline. This profile may be out of date. | cueola-identity.js:1581 |  | jargon — 'offline cache' is developer vocabulary |
| Your stable profile identity could not be saved yet. Assignments may be unavailable until cloud access is restored. | Not saved. Assignments will appear when you're back online. | cueola-identity.js:1584 |  | jargon, long — 'stable profile identity', 'cloud access' are developer words |
| No sessions on your profile yet. Add a show code below. | No shows yet. Add a show code below. | cueola-identity.js:1589 |  | synonym — session -> show |
| Add a show code… |  | cueola-identity.js:1591 |  |  |
| Add |  | cueola-identity.js:1592, outrangutan/outrangutan.js:6174 |  |  |
| Edit look |  | cueola-identity.js:1594 |  |  |
| Session may be out of date · offline | Offline · may be out of date | cueola-identity.js:1614 |  | synonym — session -> show; order the state first |
| Legacy assignment · migration pending | (delete) | cueola-identity.js:1616 |  | jargon — 'legacy', 'migration' mean nothing to a student and there is nothing to press |
| No crew assignment yet |  | cueola-identity.js:1617 |  |  |
| No open actions or unseen notes | No to-dos or new notes | cueola-identity.js:1619 |  | synonym — 'actions' vs 'to-dos' (5-50) name the same thing; 'unseen' -> 'new' |
| Open Cueola | Open show | cueola-identity.js:1626 |  | duplicate — same action as 'Open' (5-96); 'Cueola' names the app, not the show |
| Retry status | Retry | cueola-identity.js:1628 |  | long |
| Put this session back in your front page and pickers | (delete) | cueola-identity.js:1631 |  | tooltip-only, synonym — hover-only and the visible 'Unhide' already says it |
| Unhide ' + esc(entry.code) + ' |  | cueola-identity.js:1631 |  |  |
| Unhide |  | cueola-identity.js:1631, cueola-identity.js:2107 |  |  |
| Hide this session from your front page and pickers on this device | (delete) | cueola-identity.js:1632 |  | tooltip-only, synonym — hover-only; visible 'Hide' suffices |
| Hide ' + esc(entry.code) + ' |  | cueola-identity.js:1632 |  |  |
| All sessions &amp; notes | All shows & notes | cueola-identity.js:1890 |  | synonym — session -> show |
| New here? Create your profile |  | cueola-identity.js:1891 |  |  |
| Have a show code? |  | cueola-identity.js:1892 |  |  |
| Loading your profile&hellip; |  | cueola-identity.js:1973 |  |  |
| Sign-in not finished on this device | Sign-in not finished | cueola-identity.js:1978 |  |  |
| Finish sign-in |  | cueola-identity.js:1980 |  |  |
| Not me | Not you? | cueola-identity.js:1981 |  | synonym — 'Not me' and 'Not you?' (5-13) are the same action |
| Not signed in |  | cueola-identity.js:1985 |  |  |
| Sign in to see your sessions and notes | Sign in to see your shows and notes | cueola-identity.js:1986 |  | synonym — session -> show |
| Hidden sessions: | Hidden shows: | cueola-identity.js:1998 |  | synonym — session -> show |
| Use Hide next to a session on the front page to tuck old classes away. | Hide a show to tuck old classes away. | cueola-identity.js:1999 | yes | long, synonym — session -> show |
| Show all | Unhide all | cueola-identity.js:2000 |  | unclear — 'Show all' reads as the noun 'show' next to a list of shows |
| Loading your sessions&hellip; | Loading your shows… | cueola-identity.js:2053 |  | synonym — session -> show |
| Signed in as @' + esc(id.username) + ', but the cloud is not reachable. Your sessions will appear when it is. | You're offline. Your shows will appear when you're back online. | cueola-identity.js:2060 |  | jargon, synonym, long — 'the cloud' and 'sessions' |
| Every session on your profile is hidden. Use the hidden link below to bring one back. | All your shows are hidden. Open Hidden shows below to bring one back. | cueola-identity.js:2084 |  | synonym, long — session -> show |
| No sessions on your profile yet. Your instructor can assign them, or add one with its code. | No shows yet. Your instructor can assign one, or add a show code. | cueola-identity.js:2085 |  | synonym — session -> show |
| Checking your sessions&hellip; | Checking your shows… | cueola-identity.js:2089 |  | synonym — session -> show |
| Open this session | (delete) | cueola-identity.js:2101, cueola-identity.js:2284 |  | tooltip-only, synonym — title attr is hover-only; the 'Open' button is visible |
| Open |  | cueola-identity.js:2104, cueola-identity.js:2287 |  |  |
| Put this session back in your lists | (delete) | cueola-identity.js:2107 |  | tooltip-only, synonym — hover-only; visible text suffices |
| Unhide ' + esc(m.code) + ' |  | cueola-identity.js:2107 |  |  |
| Hide this session from your lists on this device | (delete) | cueola-identity.js:2108 |  | tooltip-only, synonym — hover-only; visible text suffices |
| Hide ' + esc(m.code) + ' |  | cueola-identity.js:2108 |  |  |
| Hidden on this device |  | cueola-identity.js:2116 |  |  |
| Continuing as @' + esc(username) + ' |  | cueola-identity.js:2141 |  |  |
| Welcome back |  | cueola-identity.js:2148, cueola-identity.js:2153 |  |  |
| Checking your profile&hellip; |  | cueola-identity.js:2148 |  |  |
| @' + esc(username) + ', the cloud is not reachable. Your sign-in will continue when it is. | You're offline. Sign-in will finish when you're back online. | cueola-identity.js:2154 |  | jargon — 'the cloud' |
| No favorites yet |  | cueola-scriptop-prefs.js:197 |  |  |
| Move section up |  | cueola-scriptop-prefs.js:247 |  |  |
| Move section down |  | cueola-scriptop-prefs.js:248 |  |  |
| All talk off. |  | cueola-streamdeck.js:289 |  |  |
| No | No cue in slot N yet. | cueola-streamdeck.js:589 |  |  |
| OBS refused |  | cueola-streamdeck.js:612 |  |  |
| OBS is still starting the |  | cueola-streamdeck.js:629 |  |  |
| No OBS scene in slot |  | cueola-streamdeck.js:633 |  |  |
| OBS has no audio inputs to ride. | OBS has no audio inputs. | cueola-streamdeck.js:652 |  | jargon — 'ride' is mixer slang students won't know |
| OBS refused the volume change: |  | cueola-streamdeck.js:655 |  |  |
| REC' + (o.recordPaused ? ' ❚❚' : '') + ' |  | cueola-streamdeck.js:666 |  |  |
| Micochondria daemon found. Mic controls are live. | Mics connected. | cueola-streamdeck.js:674 |  | jargon, brand-for-concept — 'daemon' and the Micochondria brand stand in for 'mics' |
| Talkback daemon not running (start talkbackd). | Talkback is not running on this computer. | cueola-streamdeck.js:698 | yes | jargon — 'daemon', 'talkbackd' are developer words; put the start command behind the info icon |
| Another Cueola window took over the Stream Deck. |  | cueola-streamdeck.js:829 |  |  |
| Took over the Stream Deck (the owning window stopped responding). | This window now controls the Stream Deck. | cueola-streamdeck.js:882 |  | long |
| WebHID needs Chrome or Edge. The control surface is Chromium only. | Use Chrome or Edge to connect a Stream Deck. | cueola-streamdeck.js:995, cueola-streamdeck.js:1026 |  | jargon — 'WebHID', 'control surface', 'Chromium' |
| Could not take the Stream Deck over from the other Cueola window. | Could not take over the Stream Deck from the other window. | cueola-streamdeck.js:998, cueola-streamdeck.js:1030 |  |  |
| Stream Deck selection cancelled. |  | cueola-streamdeck.js:1005, cueola-streamdeck.js:1036 (+2) |  |  |
| No Stream Deck selected. Quit the Elgato app first, then Connect. |  | cueola-streamdeck.js:1006 |  |  |
| Took the Stream Deck over from another Cueola window. |  | cueola-streamdeck.js:1010 |  |  |
| That deck is already connected. |  | cueola-streamdeck.js:1034 |  |  |
| Could not open the Stream Deck. Quit the Elgato Stream Deck app (it grabs the device), then Connect again. | Could not open the Stream Deck. Quit the Elgato app, then Connect again. | cueola-streamdeck.js:1048, cueola-streamdeck.js:1074 |  | long |
| Connected: |  | cueola-streamdeck.js:1117 |  |  |
| WebHID needs Chrome or Edge. | Use Chrome or Edge to connect a Stream Deck. | cueola-streamdeck.js:1186 |  | jargon, duplicate — same message as 5-126; drop 'WebHID' |
| No Stream Deck selected. Quit the Elgato app first, then try again. | No Stream Deck selected. Quit the Elgato app first, then Connect. | cueola-streamdeck.js:1195 |  | duplicate — same message as 5-129 with different wording |
| Deck diagnostics captured. Nothing was changed on the device. |  | cueola-streamdeck.js:1234 |  |  |
| Deck diagnostics |  | cueola-streamdeck.js:1289 |  |  |
| Copy report |  | cueola-streamdeck.js:1291 |  |  |
| Stream Deck disconnected. |  | cueola-streamdeck.js:1300, outrangutan/outrangutan.js:2278 |  |  |
| Now configuring | Now editing: | cueola-streamdeck.js:1329 |  |  |
| Preview mode: this is your deck on screen. Connect real hardware any time. |  | cueola-streamdeck.js:1345 |  |  |
| 🎉 HYPE! |  | cueola-streamdeck.js:2619 |  |  |
| Touch strip error: |  | cueola-streamdeck.js:2717 |  |  |
| Strip check: watch the touch strip and remember which big NUMBER (1-4) shows up. | Watch the touch strip and remember which big number (1-4) shows. | cueola-streamdeck.js:2772 |  | long |
| Layout storage is full: this change may not survive a reload. Remove some key images or GIFs, or save the layout as a .keywi file. | Storage is full; this change may not survive a reload. Remove some key images, or download a .keywi file. | cueola-streamdeck.js:3128 |  | long |
| Director page loaded for this show. |  | cueola-streamdeck.js:3287 |  |  |
| Only one page saved. Add more layouts to page between them. | Only one page saved. Add a page first. | cueola-streamdeck.js:3291 |  |  |
| Page: |  | cueola-streamdeck.js:3291, cueola-streamdeck.js:3292 (+3) |  |  |
| No layout named " |  | cueola-streamdeck.js:3292, cueola-streamdeck.js:3317 |  |  |
| Only one page saved on that deck. |  | cueola-streamdeck.js:3297 |  |  |
| No default layout set. Use Set default in the layout bar. | No home page set. Use Set home in the page bar. | cueola-streamdeck.js:3305 |  | synonym — 'default layout' here, 'home page' / 'Set home' at 5-226/227 |
| No default layout set on that deck. | No home page set on that deck. | cueola-streamdeck.js:3310 |  | synonym — default -> home |
| Layout: | Page: | cueola-streamdeck.js:3316 |  | synonym — layout vs page used for the same thing; 5-149 says 'Page:' |
| Keep at least one profile. | Keep at least one page. | cueola-streamdeck.js:3330 |  | synonym — 'profile' here means a deck page and collides with the user profile |
| Connect a deck (or open Preview) first. |  | cueola-streamdeck.js:3337, cueola-streamdeck.js:3487 (+4) |  |  |
| Add a page |  | cueola-streamdeck.js:3338, cueola-streamdeck.js:3596 |  |  |
| Pick what the new page starts with. Every key can be changed afterwards. | Pick a starting point. You can change every key later. | cueola-streamdeck.js:3339 |  |  |
| Starter: every app, laid out for this deck | Starter: every tool, laid out for this deck | cueola-streamdeck.js:3340 |  |  |
| Director: rundown only (BACK, NEXT, TAKE, ABORT, ROW, CLOCK) | Director: rundown keys only | cueola-streamdeck.js:3341 |  | synonym — NEXT and ROW are being removed/renamed in 3.0 (TAKE, cue); key names need the rename pass |
| Saved " |  | cueola-streamdeck.js:3368 |  |  |
| Could not read that layout file. |  | cueola-streamdeck.js:3374 |  |  |
| That file is not a KeyWi layout. | That file is not a layout file. | cueola-streamdeck.js:3375 |  | brand-for-concept — KeyWi brand standing in for 'layout' |
| Imported layout " |  | cueola-streamdeck.js:3377 |  |  |
| Save this layout to your profile or a .keywi file | (delete) | cueola-streamdeck.js:3399 |  | tooltip-only — hover-only; the button says Save layout and the dialog explains the choice |
| ' + (layoutDirty ? 'Save layout' : 'Saved') + ' |  | cueola-streamdeck.js:3399 |  |  |
| ' + (_leaveAfterSave ? 'Save before you leave?' : 'Save this layout?') + ' |  | cueola-streamdeck.js:3407 |  |  |
| "' + esc(p.name) + '" is already saved on this device. Saving to your profile carries it to any machine you sign in on; a .keywi file is a standalone copy you can share or import anywhere. | Already saved on this device. Save to your profile to use it on any computer, or download a file to share. | cueola-streamdeck.js:3408 | yes | long |
| ' + (_leaveAfterSave ? 'Just leave, keep on this device' : 'Keep on this device') + ' | Keep on this device | cueola-streamdeck.js:3410 |  |  |
| Download .keywi |  | cueola-streamdeck.js:3411 |  |  |
| Save to my profile |  | cueola-streamdeck.js:3412 |  |  |
| Sign in on the front page to save layouts to your profile. |  | cueola-streamdeck.js:3413 |  |  |
| Kept on this device. |  | cueola-streamdeck.js:3420 |  |  |
| Sign in on the front page first. |  | cueola-streamdeck.js:3430 |  |  |
| Cloud is not reachable right now. Try Download .keywi instead. | You're offline. Try Download .keywi instead. | cueola-streamdeck.js:3431 |  | jargon — 'Cloud' |
| This layout’s images are too large for a profile save. Download a .keywi file instead. | Images too large to save to your profile. Download a .keywi file instead. | cueola-streamdeck.js:3435 |  |  |
| Layout saved to @ |  | cueola-streamdeck.js:3442 |  |  |
| Profile save was refused (the updated rules may not be deployed yet). Download a .keywi file instead. | Could not save to your profile. Download a .keywi file instead. | cueola-streamdeck.js:3449 |  | jargon — 'rules may not be deployed' is developer talk |
| Your profile is out of room for layouts. Delete an old saved layout, or download a .keywi file instead. |  | cueola-streamdeck.js:3450 |  |  |
| Profile save failed. Check the connection, or download a .keywi file instead. |  | cueola-streamdeck.js:3451 |  |  |
| My layouts |  | cueola-streamdeck.js:3489 |  |  |
| Layouts saved to your profile. Picking one adds it as a page on this deck. |  | cueola-streamdeck.js:3490 |  |  |
| Nothing saved yet. Save layout, then Save to my profile, puts one here. | Nothing saved yet. Use Save layout, then Save to my profile. | cueola-streamdeck.js:3496 |  | unclear — sentence is ungrammatical |
| Added " |  | cueola-streamdeck.js:3507 |  |  |
| KeyWi Bird needs Chrome or Edge (WebHID). Open Cueola there to connect a Stream Deck. | Stream Deck needs Chrome or Edge. Open Cueola there to connect. | cueola-streamdeck.js:3525 |  | brand-for-concept, jargon — KeyWi Bird, WebHID |
| Preview mode: a virtual Stream Deck + XL so you can lay it out, pick a theme, and press keys on screen. Plug in real hardware and hit | Preview mode: a Stream Deck on screen. Plug in a real one and press Connect deck to drive the show. | cueola-streamdeck.js:3532 | yes | long — three fragments (5-189..191) form one long sentence |
| Connect real deck | Connect deck | cueola-streamdeck.js:3532 |  | duplicate — 'Connect real deck' vs 'Connect deck' (5-195) |
| to drive the show. | (delete) | cueola-streamdeck.js:3532 |  | long — tail of 5-189; folded into that rewrite |
| Deck settings: theme, OBS' + (micoParked() ? '' : ', Micochondria') + ' | (delete) | cueola-streamdeck.js:3542 |  | tooltip-only, brand-for-concept — hover-only and the visible label says it |
| Deck settings |  | cueola-streamdeck.js:3542, cueola-streamdeck.js:3779 |  |  |
| Disconnect |  | cueola-streamdeck.js:3543, outrangutan/outrangutan.js:2508 (+1) |  |  |
| Connect deck |  | cueola-streamdeck.js:3543, cueola-streamdeck.js:3560 (+1) |  |  |
| Exit preview |  | cueola-streamdeck.js:3544 |  |  |
| Cut both Micochondria mics (TKB + VofU) instantly | (delete) | cueola-streamdeck.js:3547 |  | tooltip-only, brand-for-concept — hover-only; visible 'All talk off' suffices |
| All talk off |  | cueola-streamdeck.js:3547, cueola-streamdeck.js:3925 (+1) |  |  |
| Any Stream Deck. The whole rig. | Any Stream Deck. | cueola-streamdeck.js:3557 |  | unclear — 'The whole rig' explains nothing |
| Another Cueola window is the deck window right now. | Another Cueola window is using the Stream Deck. | cueola-streamdeck.js:3558 |  | unclear — 'is the deck window' is odd phrasing |
| Connect here to drive the Stream Deck from this window instead; closing the other window also moves it here. | Connect here to use it from this window instead. | cueola-streamdeck.js:3558 | yes | long |
| Plug in a deck (Mini to + XL) and KeyWi Bird lays it out by app for its size: ' + apps + ', with saved layouts as pages. Or explore on screen first: preview mode is the full deck with no hardware. Quit the Elgato Stream Deck app before connecting; it hogs the USB device. | Plug in a Stream Deck and Cueola lays it out for you. Or try it on screen first. Quit the Elgato app before connecting. | cueola-streamdeck.js:3559 | yes | long, brand-for-concept — KeyWi Bird; three ideas in one paragraph |
| See it on screen | Preview | cueola-streamdeck.js:3560 |  | synonym — 'See it on screen' vs 'Preview mode' / 'Exit preview' |
| Setup wizard |  | cueola-streamdeck.js:3560, cueola-streamdeck.js:3625 |  |  |
| Diagnostics |  | cueola-streamdeck.js:3560, cueola-streamdeck.js:3904 |  |  |
| Micochondria | Mics | cueola-streamdeck.js:3563, cueola-streamdeck.js:3786 (+1) |  | brand-for-concept — Micochondria as a section title/tab; plain word is mics |
| ' + (d === device ? 'This deck is being configured' : 'Configure this deck') + ' | Editing | cueola-streamdeck.js:3572 |  | tooltip-only — hover-only state; show 'Editing' as a chip instead |
| Connect another Stream Deck to this computer | (delete) | cueola-streamdeck.js:3574 |  | tooltip-only — visible 'Add deck' suffices |
| Decks |  | cueola-streamdeck.js:3574 |  |  |
| Add deck |  | cueola-streamdeck.js:3574 |  |  |
| Page name |  | cueola-streamdeck.js:3586 |  |  |
| ' + (on ? 'Double-click to rename this page' : 'Switch to this page') + ' | (delete) | cueola-streamdeck.js:3588 |  | tooltip-only — double-click rename is hidden; a Rename button (5-219) already exists |
| Home page (the one the deck starts on) | Home page | cueola-streamdeck.js:3589 |  | tooltip-only — show as a small visible 'home' tag, as 5-338 already does |
| Rename page |  | cueola-streamdeck.js:3591, cueola-streamdeck.js:3591 |  |  |
| Delete page |  | cueola-streamdeck.js:3592, cueola-streamdeck.js:3592 |  |  |
| Pages |  | cueola-streamdeck.js:3595, cueola-streamdeck.js:4799 |  |  |
| Add a page (starter layout) | (delete) | cueola-streamdeck.js:3596 |  | tooltip-only, duplicate — repeats the visible label |
| Duplicate this page | (delete) | cueola-streamdeck.js:3598 |  | tooltip-only |
| Duplicate |  | cueola-streamdeck.js:3598, cueola-streamdeck.js:4801 |  |  |
| Make this page HOME: the one the deck starts on and the HOME key jumps to | Make this the home page | cueola-streamdeck.js:3599 |  | tooltip-only, long — hover-only; keep as a one-line info |
| Set home |  | cueola-streamdeck.js:3599 |  |  |
| Layouts saved to your profile, on any machine you signed in on | (delete) | cueola-streamdeck.js:3600 |  | tooltip-only — 5-183 already explains inside the panel |
| My layouts' + (cloudLayoutRows().length ? ' (' + cloudLayoutRows().length + ')' : '') + ' |  | cueola-streamdeck.js:3600 |  |  |
| Delete the page " |  | cueola-streamdeck.js:3613 |  |  |
| Page deleted. |  | cueola-streamdeck.js:3615 |  |  |
| ' + (learnArmed ? 'Press a control to map it…' : 'Live learn') + ' | Learn a key | cueola-streamdeck.js:3621 |  | unclear — 'Live learn' does not say what it does; the armed text is fine |
| Brightness |  | cueola-streamdeck.js:3622 |  |  |
| Test pattern |  | cueola-streamdeck.js:3623 |  |  |
| Reset this layout | Reset this page | cueola-streamdeck.js:3624 |  | synonym — layout -> page |
| Current program scene | Program | cueola-streamdeck.js:3634 |  | tooltip-only — hover-only label on a live readout; show 'Program' as visible prefix |
| REC |  | cueola-streamdeck.js:3635 |  |  |
| Not connected. For stream, record, and scene keys, plus the program monitor on the strip. | Not connected. | cueola-streamdeck.js:3636 | yes | long — feature list belongs behind the info icon |
| The OBS audio input the stream-volume dial rides | (delete) | cueola-streamdeck.js:3641 |  | tooltip-only, jargon — 'rides' is slang; visible label suffices |
| Stream audio |  | cueola-streamdeck.js:3641 |  |  |
| Disconnect OBS |  | cueola-streamdeck.js:3644 |  |  |
| ws://localhost:4455 |  | cueola-streamdeck.js:3645, cueola-streamdeck.js:4811 |  |  |
| ' + (cfg.password ? '••••••••' : 'password (if set)') + ' |  | cueola-streamdeck.js:3645 |  |  |
| Connect OBS |  | cueola-streamdeck.js:3645, cueola-streamdeck.js:4811 |  |  |
| Key rims back to defaults. |  | cueola-streamdeck.js:3704 |  |  |
| Key rims |  | cueola-streamdeck.js:3729 |  |  |
| Keys wear a rim in their app\'s color so a glance sorts the deck by app. System keys (pages, mics, fun) stay bare. Width is measured on a 96 px key; smaller decks scale it down. | Each key gets a colored rim for its tool. | cueola-streamdeck.js:3730 | yes | long — pixel math goes behind the info icon |
| On |  | cueola-streamdeck.js:3731 |  |  |
| Stroke |  | cueola-streamdeck.js:3733 |  |  |
| Thin |  | cueola-streamdeck.js:3734 |  |  |
| Regular |  | cueola-streamdeck.js:3735 |  |  |
| Rim width |  | cueola-streamdeck.js:3737 |  |  |
| ' + p[1] + ' rim color |  | cueola-streamdeck.js:3739 |  |  |
| Deck disconnected. Reconnect it, then flip the dials. |  | cueola-streamdeck.js:3768 |  |  |
| Reskin the whole deck | (delete) | cueola-streamdeck.js:3778 |  | tooltip-only — hover-only; the theme picker is self-evident |
| Dials |  | cueola-streamdeck.js:3782, cueola-streamdeck.js:3841 (+1) |  |  |
| Clockwise turns forward: the prompter scrubs ahead, volume and speed go up. If this deck\'s dials run the opposite way, flip them here. | If turning clockwise goes the wrong way, flip it here. | cueola-streamdeck.js:3783 | yes | long |
| Normal |  | cueola-streamdeck.js:3784 |  |  |
| Reversed |  | cueola-streamdeck.js:3784 |  |  |
| OBS Studio |  | cueola-streamdeck.js:3785, cueola-streamdeck.js:4809 |  |  |
| Layout files |  | cueola-streamdeck.js:3787 |  |  |
| A .keywi file is a standalone copy of the current page: back it up, share it, or move it to another machine. | A .keywi file is a copy of this page you can share or back up. | cueola-streamdeck.js:3788 | yes | long |
| Export this page (.keywi) |  | cueola-streamdeck.js:3789 |  |  |
| Import a .keywi file |  | cueola-streamdeck.js:3789 |  |  |
| Clipboard |  | cueola-streamdeck.js:3790 |  |  |
| The PASTE key reads this machine\'s clipboard, and the browser only allows that after you approve it once. Approve it here so the key never stalls mid-show. | Allow clipboard once so the PASTE key works during the show. | cueola-streamdeck.js:3791 | yes | long |
| Enable clipboard | Allow clipboard | cueola-streamdeck.js:3792 |  |  |
| Connecting to OBS… |  | cueola-streamdeck.js:3801, cueola-streamdeck.js:4845 |  |  |
| Stream-volume dial now rides " | Stream volume dial now controls " | cueola-streamdeck.js:3803 |  | jargon — 'rides' |
| This browser cannot read the clipboard from a page. Use Chrome or Edge. |  | cueola-streamdeck.js:3811 |  |  |
| Clipboard access granted. The PASTE key is good to go. | Clipboard allowed. The PASTE key is ready. | cueola-streamdeck.js:3813 |  |  |
| Clipboard access is blocked. Click the lock icon by the address bar, set Clipboard to Allow, then try again. |  | cueola-streamdeck.js:3814 |  |  |
| click a key to change what it does and how it looks · drag one key onto another to swap them · drag an action from the tray below onto a key to assign it | Click a key to edit it. Drag keys to swap, or drag an action onto a key. | cueola-streamdeck.js:3822 | yes | long |
| The touch strip, live. Tap a zone on the hardware = press its dial; flick = a big turn. | Touch strip | cueola-streamdeck.js:3837 | yes | tooltip-only, long — hover-only on a live readout |
| each shows what turning and pressing does · click to reassign | click a dial to change it | cueola-streamdeck.js:3841 |  |  |
| turn |  | cueola-streamdeck.js:3848 |  |  |
| press |  | cueola-streamdeck.js:3849 |  |  |
| Action tray |  | cueola-streamdeck.js:3871 |  |  |
| drag an action onto a key |  | cueola-streamdeck.js:3871 |  |  |
| How KeyWi Bird works | How the Stream Deck works | cueola-streamdeck.js:3886 |  | brand-for-concept — KeyWi Bird for Stream Deck |
| Keys |  | cueola-streamdeck.js:3887, cueola-streamdeck.js:4646 |  |  |
| press to fire the action printed on them. Keys with a glowing ring are ON (a toggle that is active, a cue that is playing, the scene on air). BRAKE, BOOST, TKB and VofU are hold keys: press and hold, release to stop. | Press a key to fire its action. A glowing ring means ON. BRAKE, BOOST and the talk keys work while held. | cueola-streamdeck.js:3887 | yes | long — help panel text; fine as info content, trim |
| do two things each: turning adjusts the value, pressing the dial in fires its second action. Both are written on the dial card above. | Turn to adjust, press to fire the second action. | cueola-streamdeck.js:3888 | yes | long |
| Touch strip |  | cueola-streamdeck.js:3889 |  |  |
| is a live dashboard over the dials. Tap a zone to fire that dial’s press action; flick along it for a fast turn. | Tap a zone to press that dial; flick for a fast turn. | cueola-streamdeck.js:3889 | yes | long |
| Layouts |  | cueola-streamdeck.js:3890 |  |  |
| are whole pages of key assignments. Save one per situation (rehearsal, live, OBS-heavy) and jump between them with a PAGE key, right from the deck. | A page is a full set of key assignments. Save one per situation and jump between them with a PAGE key. | cueola-streamdeck.js:3890 | yes | long, synonym — layouts vs pages |
| Deck details |  | cueola-streamdeck.js:3896 |  |  |
| Print what the hardware itself reports (ids, name string, descriptor, feature dumps). | Show what the hardware reports. | cueola-streamdeck.js:3904 |  | jargon — 'descriptor', 'feature dumps' |
| Mic | Mics | cueola-streamdeck.js:3921, cueola-streamdeck.js:4065 (+1) |  | brand-for-concept — 'Mic' + 'ochondria' split brand label |
| ochondria | (delete) | cueola-streamdeck.js:3921, cueola-streamdeck.js:4065 (+1) |  | brand-for-concept — second half of the split brand label (5-309) |
| ' + (on ? 'Connected' : 'Not running') + ' |  | cueola-streamdeck.js:3922 |  |  |
| Pop Micochondria out into its own little window | (delete) | cueola-streamdeck.js:3924 |  | tooltip-only, brand-for-concept — visible 'Pop out' suffices |
| Pop out |  | cueola-streamdeck.js:3924 |  |  |
| Cut both mics (TKB + VofU) instantly | (delete) | cueola-streamdeck.js:3925 |  | tooltip-only, duplicate — same as 5-197/5-326 |
| The talkback daemon runs the mics. Start it on this machine and this dot turns green by itself: | Talkback runs on this computer. Start it and the dot turns green. | cueola-streamdeck.js:3931 | yes | jargon, long — 'daemon' |
| Hold to talk on ' + name + '. Releases the moment you let go. | Hold to talk on &lt;name> | cueola-streamdeck.js:3939 |  | tooltip-only, duplicate — same as 5-323; first sentence is enough |
| Hold to talk. The lamp is the truth. | Hold to talk. Lit means live. | cueola-streamdeck.js:3943 |  | unclear — 'The lamp is the truth' is a riddle |
| ' + name + ' volume |  | cueola-streamdeck.js:3945 |  |  |
| ' + (onAir ? 'ON AIR' : 'off') + ' |  | cueola-streamdeck.js:3946 |  |  |
| Hold to talk on ' + name + ' | Hold to talk on &lt;name> | cueola-streamdeck.js:4052 |  | tooltip-only — the button itself should read 'Hold to talk' |
| Pop-up blocked. Allow pop-ups for this site to pop Micochondria out. | Pop-up blocked. Allow pop-ups for this site, then try again. | cueola-streamdeck.js:4060 |  | brand-for-concept |
| Cut both mics instantly | (delete) | cueola-streamdeck.js:4070 |  | tooltip-only, duplicate — third variant of the same tip |
| Learn mode ended: nothing was pressed in 20 seconds. |  | cueola-streamdeck.js:4124 |  |  |
| Edit key ' + (index + 1) + (fromLearn ? ' |  | cueola-streamdeck.js:4140 |  |  |
| learned |  | cueola-streamdeck.js:4140, cueola-streamdeck.js:4541 (+1) |  |  |
| Acts on this machine only, never over the session: on a multi-machine rig this key does nothing remote. | Works on this computer only. | cueola-streamdeck.js:4141 | yes | tooltip-only, jargon, long — 'session', 'multi-machine rig', 'remote' |
| TOGGLE |  | cueola-streamdeck.js:4141 |  |  |
| THIS MACHINE | THIS COMPUTER | cueola-streamdeck.js:4141 |  |  |
| This deck’s pages |  | cueola-streamdeck.js:4150 |  |  |
| PAGE ' + (pi2 + 1) + ' · ' + esc(pname) + (pid === defaultProfileId ? ' (home)' : '') + ' |  | cueola-streamdeck.js:4153 |  |  |
| This show |  | cueola-streamdeck.js:4159, cueola-streamdeck.js:4162 |  |  |
| PAD ' + esc(pads[id].name \|\| '') + ' |  | cueola-streamdeck.js:4161 |  |  |
| Load a show in Outrangutan to bind cues and pads by name. | Load a show in playback to pick cues and pads by name. | cueola-streamdeck.js:4162 |  | brand-for-concept — Outrangutan stands in for playback; 'bind' is developer talk |
| This OBS |  | cueola-streamdeck.js:4166, cueola-streamdeck.js:4169 |  |  |
| SCENE ' + esc(name) + ' |  | cueola-streamdeck.js:4167 |  |  |
| MUTE ' + esc(name) + ' |  | cueola-streamdeck.js:4168 |  |  |
| Connect OBS to bind scenes and audio by name. | Connect OBS to pick scenes and audio by name. | cueola-streamdeck.js:4169 |  |  |
| Hide label |  | cueola-streamdeck.js:4174 |  |  |
| Accent color |  | cueola-streamdeck.js:4175 |  |  |
| Custom color (hex) |  | cueola-streamdeck.js:4177 |  |  |
| Search symbols |  | cueola-streamdeck.js:4178 |  |  |
| Symbol |  | cueola-streamdeck.js:4178 |  |  |
| Type one emoji, or leave blank |  | cueola-streamdeck.js:4180 |  |  |
| Draws one emoji big on the key. Press Control+Command+Space for the emoji picker. | One big emoji on the key. | cueola-streamdeck.js:4180 |  | tooltip-only, long — Mac-only shortcut in a hover tip; drop it |
| Emoji |  | cueola-streamdeck.js:4180 |  |  |
| Use this art on the key | (delete) | cueola-streamdeck.js:4181 |  | tooltip-only — visible label suffices |
| Key art |  | cueola-streamdeck.js:4181 |  |  |
| Custom image |  | cueola-streamdeck.js:4182 |  |  |
| ' + (slot.img ? 'Change image' : 'Upload image') + ' |  | cueola-streamdeck.js:4184 |  |  |
| Show trigger overlays on the image | Show the label over the image | cueola-streamdeck.js:4187 |  | unclear — 'trigger overlays' is not a student word; confirm what is overlaid |
| GIPHY |  | cueola-streamdeck.js:4188 |  |  |
| Progress style |  | cueola-streamdeck.js:4194 |  |  |
| Press flash |  | cueola-streamdeck.js:4196 |  |  |
| Reactive animation | Animate with state | cueola-streamdeck.js:4197 |  | unclear — 'Reactive' does not say what the key reacts to |
| Reset appearance |  | cueola-streamdeck.js:4198 |  |  |
| Paste the API key first. |  | cueola-streamdeck.js:4265 |  |  |
| That does not look like a GIPHY API key. |  | cueola-streamdeck.js:4266 |  |  |
| Type what you want to see and press Search. |  | cueola-streamdeck.js:4288 |  |  |
| Only an instructor can share a class key. | Only an instructor can share a class GIPHY key. | cueola-streamdeck.js:4381 |  | synonym — 'class key' already means the student sign-in key on the dashboard |
| Cloud is not reachable right now. The key was kept on this device. | Not saved online right now. The key is kept on this device. | cueola-streamdeck.js:4382 |  | jargon — 'Cloud' is developer wording |
| Class key saved. Everyone signed in can search GIPHY now. | Class GIPHY key saved. Everyone signed in can search GIPHY now. | cueola-streamdeck.js:4387 |  | synonym — 'class key' collides with the sign-in key |
| Paste a GIPHY API key |  | cueola-streamdeck.js:4406 |  |  |
| Save key |  | cueola-streamdeck.js:4406 |  |  |
| Use for the whole class |  | cueola-streamdeck.js:4408 |  |  |
| ' + (own ? 'Search GIPHY (blank shows trending)' : 'Search GIPHY') + ' |  | cueola-streamdeck.js:4411 |  |  |
| Search |  | cueola-streamdeck.js:4411 |  |  |
| ' + (shared ? 'Use the class key instead' : 'Remove key') + ' | ' + (shared ? 'Use the class GIPHY key instead' : 'Remove key') + ' | cueola-streamdeck.js:4414 |  | synonym — 'class key' collides with the sign-in key |
| Change class key | Change class GIPHY key | cueola-streamdeck.js:4415 |  | synonym — 'class key' collides with the sign-in key |
| Searching… |  | cueola-streamdeck.js:4426 |  |  |
| No results. Try another search. |  | cueola-streamdeck.js:4453 |  |  |
| ' + esc(g.title) + ' |  | cueola-streamdeck.js:4455 |  |  |
| ' + esc('Use this GIF: ' + g.title) + ' |  | cueola-streamdeck.js:4455 |  |  |
| GIF added to the key. |  | cueola-streamdeck.js:4470 |  |  |
| Pick a PNG, JPEG, WebP, or GIF image. |  | cueola-streamdeck.js:4478 |  |  |
| That image is over 15 MB. Pick a smaller one. |  | cueola-streamdeck.js:4479 |  |  |
| That GIF is over 300 KB. Trim or shrink it (giphy-size clips work well). | That GIF is over 300 KB. Pick a smaller or shorter one. | cueola-streamdeck.js:4483 |  | long — parenthetical is a second sentence |
| That image stays too large after compression. Try a simpler one. | That image is still too large. Try a simpler one. | cueola-streamdeck.js:4507 |  |  |
| Dial ' + (index + 1) + (fromLearn ? ' |  | cueola-streamdeck.js:4541 |  |  |
| ' + esc(c.label) + ' |  | cueola-streamdeck.js:4546 |  |  |
| turn: ' + esc(c.turnLabel \|\| '') + ' &middot; press: ' + esc(c.pressLabel \|\| '') + ' |  | cueola-streamdeck.js:4547 |  |  |
| Diagnostics copied. | Deck report copied. | cueola-streamdeck.js:4561 |  | jargon — 'Diagnostics' is developer wording |
| Copy failed: select the text and copy by hand. |  | cueola-streamdeck.js:4561, cueola-streamdeck.js:4562 |  |  |
| Press a key or turn a dial on the deck to map it. |  | cueola-streamdeck.js:4566 |  |  |
| Test pattern sent. Keys are numbered 1- |  | cueola-streamdeck.js:4662 |  |  |
| Connect a deck first. |  | cueola-streamdeck.js:4668 |  |  |
| This deck has no touch strip. |  | cueola-streamdeck.js:4669 |  |  |
| Strip test could not draw the image: | Touch strip test failed: could not draw the image. | cueola-streamdeck.js:4696 |  | jargon — developer error detail |
| Strip test: the image encoded to zero bytes. | Touch strip test failed: empty image. | cueola-streamdeck.js:4698 |  | jargon — 'encoded to zero bytes' is developer wording |
| Strip test could not packetize: | Touch strip test failed: could not send. | cueola-streamdeck.js:4703 |  | jargon — 'packetize' is developer wording |
| Strip test FAILED at packet | Touch strip test failed partway through. | cueola-streamdeck.js:4717 |  | jargon — 'packet' is developer wording |
| Strip test sent OK: | Touch strip test sent. | cueola-streamdeck.js:4720 |  |  |
| One deck. The whole rig. |  | cueola-streamdeck.js:4785 |  |  |
| A Stream Deck becomes the control surface for the show: Outrangutan playback and SFX, the Cueola rundown, the Flowmingo prompter, the Micochondria mics, and OBS. Organized by app, like the rig itself. | Your Stream Deck runs the whole show: playback and SFX, the rundown, the prompter, the mics, and OBS. | cueola-streamdeck.js:4786 |  | long, brand-for-concept — four product names stand in for plain concepts; two sentences |
| A few quick steps. Only the deck matters; the rest is optional and can wait. | A few quick steps. Only the deck is required. | cueola-streamdeck.js:4787 |  | long — second clause restates the first |
| Connect your deck |  | cueola-streamdeck.js:4789 |  |  |
| Quit the Elgato Stream Deck app first |  | cueola-streamdeck.js:4791 |  |  |
| : it holds the USB device and blocks the browser. Then connect and pick your deck from the list. Expect a little light show. | : it holds the USB connection. Then connect and pick your deck. | cueola-streamdeck.js:4791 |  | long — three sentences; 'light show' aside is noise |
| No deck? Preview on screen |  | cueola-streamdeck.js:4792 |  |  |
| This browser has no WebHID, so real hardware needs | This browser cannot talk to the deck. Real hardware needs | cueola-streamdeck.js:4793 |  | jargon — 'WebHID' is developer wording |
| Chrome or Edge |  | cueola-streamdeck.js:4793 |  |  |
| . Preview mode still works everywhere. |  | cueola-streamdeck.js:4793 |  |  |
| Preview on screen |  | cueola-streamdeck.js:4794 |  |  |
| Every saved layout is a |  | cueola-streamdeck.js:4800 |  |  |
| page |  | cueola-streamdeck.js:4800 |  |  |
| , so even a six-key deck can carry a whole show: a rehearsal page, a live page, an OBS page. The default layouts ship with | , so even a six-key deck can carry a whole show. The default layouts include | cueola-streamdeck.js:4800 | yes | long — example list belongs behind an info icon |
| PAGE ← |  | cueola-streamdeck.js:4800 |  |  |
| PAGE → |  | cueola-streamdeck.js:4800 |  |  |
| keys, and a |  | cueola-streamdeck.js:4800 |  |  |
| HOME |  | cueola-streamdeck.js:4800 |  |  |
| key jumps straight back to your default layout. |  | cueola-streamdeck.js:4800 |  |  |
| Make a new page with |  | cueola-streamdeck.js:4801 |  |  |
| New |  | cueola-streamdeck.js:4801 |  |  |
| in the layout bar, then flip between them from the deck itself. The page keys show where you are, like 2/3. | in the layout bar, then flip between them from the deck. | cueola-streamdeck.js:4801 | yes | long — second sentence is detail for an info icon |
| optional |  | cueola-streamdeck.js:4803, cueola-streamdeck.js:4809 |  |  |
| The powerhouse for the mics: hold | Talkback for the mics: hold | cueola-streamdeck.js:4804 |  |  |
| TKB |  | cueola-streamdeck.js:4804 |  |  |
| to talk to the crew, hold |  | cueola-streamdeck.js:4804 |  |  |
| VofU |  | cueola-streamdeck.js:4804 |  | unclear — 'VofU' is not explained anywhere on screen; key label needs an info icon |
| to speak to the room. It needs the little talkbackd program running on this machine: | It needs the talkback helper running on this computer: | cueola-streamdeck.js:4804 |  | jargon — 'talkbackd program' is a developer name |
| KeyWi Bird finds it by itself. No address, no pairing. The dot below goes green the moment it is up. | The deck finds it by itself. The dot below turns green when it is running. | cueola-streamdeck.js:4806 |  | long, brand-for-concept — brand name stands in for the deck; three sentences |
| For stream, record, and scene keys, plus the program monitor and stream volume on a dial. In OBS: | For stream, record, and scene keys. In OBS: | cueola-streamdeck.js:4810 |  | long — two sentences of feature list |
| Tools › WebSocket Server Settings |  | cueola-streamdeck.js:4810 |  |  |
| , enable the server, copy the password if one is set. |  | cueola-streamdeck.js:4810 |  |  |
| ' + ((((OBSc() && OBSc().config()) \|\| {}).password) ? '••••••••' : 'password (if set)') + ' |  | cueola-streamdeck.js:4811 |  |  |
| Make it yours |  | cueola-streamdeck.js:4815 |  |  |
| Pick a look. It reskins the physical keys and the on-screen deck alike: | Pick a look for the keys and the on-screen deck: | cueola-streamdeck.js:4816 |  |  |
| From here: click any key to remap it, use |  | cueola-streamdeck.js:4818 |  |  |
| Live learn |  | cueola-streamdeck.js:4818 |  |  |
| to map by touch, and save whole layouts as pages. And yes, there is a HYPE key. | to map by touch, and save layouts as pages. | cueola-streamdeck.js:4818 |  | long — HYPE aside is a third sentence |
| Skip the tour |  | cueola-streamdeck.js:4821 |  |  |
| Skip |  | cueola-streamdeck.js:4823 |  |  |
| ' + (n === 0 ? 'Set it up' : 'Next') + ' |  | cueola-streamdeck.js:4824 |  |  |
| Start driving | Finish | cueola-streamdeck.js:4824 |  |  |
| KeyWi Bird is ready. Enjoy the deck. | Stream Deck is ready. | cueola-streamdeck.js:4839 |  | brand-for-concept — brand name stands in for the deck |
| Sign in to open KeyWi Bird. | Sign in to open the Stream Deck. | cueola-streamdeck.js:4868 |  | brand-for-concept — brand name stands in for the deck |
| Cueola Instructor Dashboard |  | dashboard.html:6 |  |  |
| Go to Cueola front page |  | dashboard.html:892 |  |  |
| Instructor |  | dashboard.html:897, cueola-app.js:24924 (+2) |  |  |
| Signed in as |  | dashboard.html:900 |  |  |
| System settings |  | dashboard.html:902, dashboard.html:902 (+1) |  |  |
| Accounts |  | dashboard.html:903, dashboard.html:983 (+1) |  |  |
| Sign Out | Sign out | dashboard.html:904, cueola-identity.js:1893 (+2) |  |  |
| Mint a real session pre-loaded with The Break Room, the full-system test show | Makes a test show pre-loaded with The Break Room. | dashboard.html:905 | yes | tooltip-only, synonym, jargon — 'Mint' and 'session' are not classroom words; the explanation is hover-only |
| Create Test Show | Create test show | dashboard.html:905, dashboard.html:2044 |  |  |
| + New Session | + New show | dashboard.html:906 |  | synonym — 'session' -> show |
| Instructor Dashboard |  | dashboard.html:916 |  |  |
| Welcome to Cueola |  | dashboard.html:917, dashboard.html:1568 |  |  |
| Sign in with your instructor account to manage sessions. | Sign in with your instructor account to manage shows. | dashboard.html:918, dashboard.html:1569 |  | synonym — 'sessions' -> shows |
| Sessions | Shows | dashboard.html:923, dashboard.html:951 (+1) |  | synonym — 'Sessions' -> Shows |
| Total Cues |  | dashboard.html:927 |  |  |
| Active |  | dashboard.html:931 |  |  |
| Account Management |  | dashboard.html:938 |  |  |
| Instructor accounts |  | dashboard.html:941 |  |  |
| Add, remove, rename, reset codes, and set access levels on a dedicated page. | Add, rename, or remove instructors. | dashboard.html:942 |  | long — list of five verbs for a link |
| Manage Accounts |  | dashboard.html:944 |  |  |
| Your |  | dashboard.html:951 |  |  |
| Which sessions to show | Which shows to list | dashboard.html:953 |  | synonym — 'sessions' -> shows |
| Mine |  | dashboard.html:954 |  |  |
| All |  | dashboard.html:955, dashboard.html:2071 |  |  |
| Refresh |  | dashboard.html:957, dashboard.html:1023 |  |  |
| Create a New Session | Create a new show | dashboard.html:965 |  | synonym — 'Session' -> show |
| Cueola generates the show code automatically. Share it with your crew. |  | dashboard.html:966 |  |  |
| Recently |  | dashboard.html:975 |  |  |
| Deleted |  | dashboard.html:975 |  |  |
| Kept for 30 days, then removed for good. |  | dashboard.html:976 |  |  |
| Manage |  | dashboard.html:983 |  |  |
| Simple account setup for instructor/admin access. | Instructor and admin accounts. | dashboard.html:984 |  |  |
| ← Dashboard |  | dashboard.html:986 |  |  |
| Create Instructor |  | dashboard.html:990 |  |  |
| Username (letters, numbers, . _ -) |  | dashboard.html:992 |  |  |
| Temp password (8+ characters) |  | dashboard.html:993 |  |  |
| Standard |  | dashboard.html:995, dashboard.html:2622 |  |  |
| Super | Admin | dashboard.html:996, dashboard.html:2623 |  | synonym — 'Super', 'super instructor', 'super admin' and 'admin' all name the same level |
| Add Account |  | dashboard.html:998 |  |  |
| A class key is the term-long key students use to create their profile and sign in. One per class or role. | The key students use to make a profile and sign in. One per class. | dashboard.html:1006 | yes | tooltip-only, long — explanation is hover-only |
| Class Keys |  | dashboard.html:1006 |  |  |
| Label, e.g. "Fall 2026 TV Production" |  | dashboard.html:1007 |  |  |
| Student key |  | dashboard.html:1009 |  |  |
| Instructor key |  | dashboard.html:1010 |  |  |
| Mint Code | Make key | dashboard.html:1012 |  | synonym, jargon — 'Mint' is jargon; 'Code' vs 'key' for the same thing |
| Loading login codes… | Loading class keys… | dashboard.html:1014 |  | synonym — 'login codes' vs 'class keys' |
| Class Roster |  | dashboard.html:1020 |  |  |
| Show code(s), comma-separated | Show codes, comma-separated | dashboard.html:1021 |  |  |
| Attach to selected | Add shows to selected students | dashboard.html:1022 |  | unclear — 'Attach' does not say what is attached to whom |
| Loading roster… |  | dashboard.html:1025 |  |  |
| Confirm |  | dashboard.html:1034, dashboard.html:4090 |  |  |
| OK |  | dashboard.html:1039 |  |  |
| Sign in with your instructor username and password. |  | dashboard.html:1048 |  |  |
| No account yet? |  | dashboard.html:1058 |  |  |
| Sign In → |  | dashboard.html:1061, dashboard.html:1449 (+2) |  |  |
| ← Back to Front Page |  | dashboard.html:1062 |  |  |
| New Session | New show | dashboard.html:1071 |  | synonym — 'Session' -> show |
| 1 · Show |  | dashboard.html:1073 |  |  |
| 2 · Who can join |  | dashboard.html:1074 |  |  |
| 3 · Paperwork |  | dashboard.html:1075, dashboard.html:1224 |  |  |
| Name the show. Set your own show code or leave it blank and Cueola will generate one. | Name the show. Leave the code blank and Cueola makes one. | dashboard.html:1078 |  | long — two long sentences for a form step |
| e.g. Campus News |  | dashboard.html:1081 |  |  |
| The short code a crew types on the front page to join this show's rundown. | The code a crew types on the front page to join this show. | dashboard.html:1084 | yes | tooltip-only — explanation is hover-only |
| Leave blank to auto-generate · Auto format: YYMM + 4 letters e.g. 2604KWXR | Leave blank to auto-generate (e.g. 2604KWXR) | dashboard.html:1086 |  | long — format spec is detail for an info icon |
| Show Start Time |  | dashboard.html:1089, dashboard.html:2126 |  |  |
| Decide what it takes to get in. You can change this any time in Session Setup. | Decide who can join. You can change this later in Show Setup. | dashboard.html:1094 |  | synonym — 'Session Setup' -> Show Setup |
| A class key is the term-long key students use to create their profile and sign in. | The key students use to make a profile and sign in. | dashboard.html:1096, dashboard.html:1198 | yes | tooltip-only, duplicate — same as 6-123; hover-only |
| Entry Requirement | Who can join | dashboard.html:1096, dashboard.html:1198 |  | synonym — step is named 'Who can join' but the field says 'Entry Requirement' |
| Show code only: anyone with the code joins |  | dashboard.html:1098 |  |  |
| Show code + class key: students must sign in with a profile |  | dashboard.html:1099 |  |  |
| Pick the paperwork this class will use. Nothing is deleted by turning a type off. |  | dashboard.html:1104 |  |  |
| Presets fill the checkboxes. Change this later in Session Setup. | Presets fill the checkboxes. Change this later in Show Setup. | dashboard.html:1107 |  | synonym — 'Session Setup' -> Show Setup |
| Could not connect. Check your internet and try again. |  | dashboard.html:1110 |  |  |
| Next → |  | dashboard.html:1111, cueola-app.js:7878 |  |  |
| Rundown: |  | dashboard.html:1119 |  |  |
| Read-only live view. The highlighted row is where the show is right now. | Read-only live view. The highlighted cue is where the show is right now. | dashboard.html:1120 |  | synonym — 'row' -> cue |
| Session Ready | Show ready | dashboard.html:1129 |  | synonym — 'Session' -> show |
| Share this code with your crew. They'll use it to join the rundown from any device. |  | dashboard.html:1130 |  |  |
| https://cueola.live/?code=... |  | dashboard.html:1135 |  |  |
| Open Rundown → |  | dashboard.html:1142 |  |  |
| Back to Dashboard |  | dashboard.html:1143 |  |  |
| Session Management | Show management | dashboard.html:1153 |  | synonym — 'Session' -> show |
| Session Details | Show details | dashboard.html:1154 |  | synonym — 'Session' -> show |
| Manage the show setup, assign production roles, and review Planda Bear progress from one place. | Set up the show, assign roles, and review planner progress. | dashboard.html:1155 |  | brand-for-concept, long — 'Planda Bear' stands in for the planner |
| Save Session | Save show | dashboard.html:1159 |  | synonym — 'Session' -> show |
| Open Rundown |  | dashboard.html:1160 |  |  |
| Session Setup | Show Setup | dashboard.html:1169, dashboard.html:2141 |  | synonym — 'Session' -> show |
| Three quick tasks. One Save Session button updates them all. | Three quick tasks. One Save button updates them all. | dashboard.html:1170 |  | synonym — 'Save Session' -> Save |
| 1 · The show |  | dashboard.html:1175 |  |  |
| Show Title |  | dashboard.html:1178 |  |  |
| Status |  | dashboard.html:1186, cueola-app.js:30336 (+1) |  |  |
| Idle: between shows |  | dashboard.html:1188 |  |  |
| Active: show day |  | dashboard.html:1189 |  |  |
| 2 · Who can join, who owns it |  | dashboard.html:1195 |  |  |
| Show code only |  | dashboard.html:1200 |  |  |
| Also require a class key |  | dashboard.html:1201 |  |  |
| Owner |  | dashboard.html:1205 |  |  |
| Created by |  | dashboard.html:1206, dashboard.html:1234 |  |  |
| Split the class into per-group paperwork workspaces. The rundown and Live stay shared with everyone. | Each group gets its own paperwork. The rundown stays shared. | dashboard.html:1210 | yes | tooltip-only, long — hover-only explanation |
| Groups |  | dashboard.html:1210 |  |  |
| Whole class: one paperwork workspace | Whole class: one set of paperwork | dashboard.html:1212 |  |  |
| Break into groups |  | dashboard.html:1213 |  |  |
| Group Names |  | dashboard.html:1217 |  |  |
| (one per line) |  | dashboard.html:1217 |  |  |
| Group 1&#10;Group 2&#10;Group 3 |  | dashboard.html:1218 |  |  |
| Lock groups: students can no longer switch |  | dashboard.html:1219 |  |  |
| Turning a type off hides it everywhere for this session. Nothing is deleted, and re-enabling restores it. | Turning a type off hides it for this show. Nothing is deleted. | dashboard.html:1227 |  | synonym, long — 'session' -> show; three clauses |
| Cues |  | dashboard.html:1233, cueola-app.js:26723 |  |  |
| Created |  | dashboard.html:1235 |  |  |
| People and Roles |  | dashboard.html:1241 |  |  |
| Assign the production role beside each session member. | Assign a production role to each crew member. | dashboard.html:1242 |  | synonym — 'session member' -> crew |
| No participants yet. | No crew yet. | dashboard.html:1246 |  | synonym — 'participants', 'learners', 'students', 'members' all used for the same people |
| Production Roles |  | dashboard.html:1250 |  |  |
| No learners available yet. | No students yet. | dashboard.html:1252 |  | synonym — 'learners' -> students |
| Planda Bear Paperwork | Planner paperwork | dashboard.html:1259 |  | brand-for-concept — 'Planda Bear' stands in for the planner |
| Latest saved work for this session. | Latest saved work for this show. | dashboard.html:1260 |  | synonym — 'session' -> show |
| No Planda Bear work recorded yet. | No planner work yet. | dashboard.html:1264 |  | brand-for-concept — 'Planda Bear' stands in for the planner |
| Next Episode | Next episode | dashboard.html:1269 |  | synonym — 'episode' is a second word for a show; decide whether it survives as the copy-for-next-time term |
| Fork this show into a fresh episode: the rundown skeleton, cue columns, paperwork structure, crew grid, and settings carry. Notes, roles, script, and dates start clean. | Copy this show for the next episode. Rundown, columns, paperwork and crew carry over. Notes, roles, script and dates start clean. | dashboard.html:1271 | yes | long — three-sentence explainer belongs behind an info icon |
| Start Next Episode → | Start next episode → | dashboard.html:1272, dashboard.html:1989 |  |  |
| Danger Zone |  | dashboard.html:1274 |  |  |
| Delete removes this session for the class. Use only when the session is no longer needed. | Delete removes this show for the class. | dashboard.html:1275 |  | synonym — 'session' -> show; second sentence adds nothing |
| Delete Session | Delete show | dashboard.html:1277 |  | synonym — 'Session' -> show |
| Delete Session? | Delete show? | dashboard.html:1287, dashboard.html:3987 |  | synonym — 'Session' -> show |
| The session moves to Recently Deleted and stops accepting joins. You can restore it for 30 days. | The show moves to Recently Deleted and no one can join. Restore within 30 days. | dashboard.html:1288, dashboard.html:3988 |  | synonym — 'session' -> show |
| New joins are blocked immediately. | (delete) | dashboard.html:1290, dashboard.html:3989 |  | duplicate — already said in 6-205 |
| Yes, Delete Session | Yes, delete show | dashboard.html:1291, dashboard.html:3990 |  | synonym — 'Session' -> show |
| Choose the workspace look and keep global Cueola preferences in one place. | Choose the look and Cueola-wide preferences. | dashboard.html:1300 |  | long — one clause is enough for a settings intro |
| Save Settings |  | dashboard.html:1314 |  |  |
| Copied |  | dashboard.html:1320 |  |  |
| System settings saved. |  | dashboard.html:1370 |  |  |
| Signing in... |  | dashboard.html:1538 |  |  |
| ' : 'All |  | dashboard.html:1648 |  |  |
| Loading sessions… | Loading shows… | dashboard.html:1684, dashboard.html:1762 |  | synonym — 'sessions' -> shows |
| Could not load sessions | Could not load shows. Check your internet and try again. | dashboard.html:1701 |  | synonym — 'sessions' -> shows; says nothing to do next |
| … expired deleted session… removed (30-day window passed) | Removed … expired shows from Recently Deleted. | dashboard.html:1738 |  | long, synonym — 'session' -> show; parenthetical is developer detail |
| Sessions refreshed | Shows refreshed | dashboard.html:1818 |  | synonym — 'Sessions' -> shows |
| Connecting… |  | dashboard.html:1874, dashboard.html:2736 (+2) |  |  |
| Session not found. | Show not found. | dashboard.html:1880 |  | synonym — 'Session' -> show |
| Live view unavailable. Check the connection. |  | dashboard.html:1885 |  |  |
| ' : i === active + 1 ? ' | ' : i === active + 1 ? '&lt;span class="peek-pill next">STANDBY&lt;/span>' : ' | dashboard.html:1906 |  | synonym — NEXT pill -> STANDBY per the 3.0 rename |
| No rundown rows yet. | No cues yet. | dashboard.html:1909 |  | synonym — 'rundown rows' -> cues |
| No one is live right now. |  | dashboard.html:1916 |  |  |
| Only the session owner or a super admin can start the next episode. | Only the show owner or an admin can start the next episode. | dashboard.html:1929 |  | synonym — 'session' -> show; 'super admin' -> admin |
| Creating… |  | dashboard.html:1938, dashboard.html:2010 (+2) |  |  |
| The source session no longer exists. | The original show no longer exists. | dashboard.html:1942 |  | synonym — 'source session' -> original show |
| Could not find a free show code this month. Set one manually via New Session. | Could not find a free show code this month. Set one yourself in New show. | dashboard.html:1966, dashboard.html:2035 |  | synonym — 'New Session' -> New show |
| Could not start the next episode: |  | dashboard.html:1987 |  |  |
| The Break Room module did not load. Reload the dashboard and try again. | The Break Room did not load. Reload and try again. | dashboard.html:2003 |  | jargon — 'module' is developer wording |
| Could not connect to Firebase. Check your internet and try again. | Could not connect. Check your internet and try again. | dashboard.html:2013 |  | jargon — 'Firebase' is developer wording |
| Could not create the test show: |  | dashboard.html:2042 |  |  |
| Switch to |  | dashboard.html:2071 |  |  |
| Date created |  | dashboard.html:2127 |  |  |
| Started as the next episode of … |  | dashboard.html:2129 |  |  |
| Learners in this session | Students in this show | dashboard.html:2130 |  | synonym, tooltip-only — 'learners' -> students; 'session' -> show |
| Learners with an assigned role | Students with a role | dashboard.html:2131 |  | synonym, tooltip-only — 'learners' -> students |
| Copy Code | Copy show code | dashboard.html:2137, cueola-app.js:3535 |  | synonym — 'Code' alone; one name is 'show code' |
| Rundown ▸ |  | dashboard.html:2139 |  |  |
| Open → |  | dashboard.html:2140 |  |  |
| Restore |  | dashboard.html:2178, cueola-app.js:1453 |  |  |
| Delete Forever | Delete forever | dashboard.html:2179 |  |  |
| Owner or super admin only | Owner or admin only | dashboard.html:2180 |  | synonym — 'super admin' -> admin |
| Only the session owner or a super admin can restore this session. | Only the show owner or an admin can restore this show. | dashboard.html:2189 |  | synonym — 'session' -> show; 'super admin' -> admin |
| Session … restored | Show … restored | dashboard.html:2195 |  | synonym — 'Session' -> show |
| Restore failed: |  | dashboard.html:2198 |  |  |
| Only the session owner or a super admin can delete this session. | Only the show owner or an admin can delete this show. | dashboard.html:2205, dashboard.html:3982 (+1) |  | synonym — 'session' -> show; 'super admin' -> admin |
| Delete Forever? |  | dashboard.html:2208 |  |  |
| This permanently removes the session, its cues, and every attachment. Anyone with the code will no longer be able to join. | This permanently removes the show, its cues and all attachments. | dashboard.html:2209 |  | synonym, long — 'session' -> show; second sentence is implied |
| This cannot be undone. |  | dashboard.html:2210 |  |  |
| Yes, Delete Forever |  | dashboard.html:2211 |  |  |
| Only a super instructor can manage accounts. | Only an admin can manage accounts. | dashboard.html:2238 |  | synonym — 'super instructor' -> admin |
| Give the code a label (e.g. the class name). | Give the key a label (e.g. the class name). | dashboard.html:2302 |  | synonym — 'code' vs 'key' for the same thing |
| Mint failed: | Could not make the key: | dashboard.html:2308 |  | jargon — 'Mint' is jargon |
| Class key … minted. Share it with the class. | Class key … created. Share it with the class. | dashboard.html:2310 |  | jargon — 'minted' is jargon |
| Update failed: |  | dashboard.html:2323, dashboard.html:2479 (+1) |  |  |
| … copied. |  | dashboard.html:2330 |  |  |
| No class keys yet. Mint one and share it with the class. | No class keys yet. Make one and share it with the class. | dashboard.html:2339 |  | jargon — 'Mint' is jargon |
| No profiles yet. Students appear here once they sign up with a class key. |  | dashboard.html:2395 |  |  |
| Remove … from this profile |  | dashboard.html:2404 |  |  |
| Remove … from @… |  | dashboard.html:2404 |  |  |
| no sessions | no shows | dashboard.html:2405 |  | synonym — 'sessions' -> shows |
| Select … |  | dashboard.html:2407 |  |  |
| Rename |  | dashboard.html:2414 |  |  |
| Merge |  | dashboard.html:2415, dashboard.html:3404 |  |  |
| Reset PIN |  | dashboard.html:2416 |  |  |
| Only a super instructor can reset a PIN. | Only an admin can reset a PIN. | dashboard.html:2428 |  | synonym — 'super instructor' -> admin |
| Admins sign in with a password, not a PIN. |  | dashboard.html:2430 |  |  |
| PIN tools are not loaded. Reload the dashboard. | PIN tools did not load. Reload the dashboard. | dashboard.html:2431 |  | jargon — 'not loaded' is developer phrasing |
| @… PIN set to …. Share it with them. |  | dashboard.html:2448, dashboard.html:2470 |  |  |
| Reset failed: |  | dashboard.html:2469 |  |  |
| Usernames are 3 to 40 characters: lowercase letters, numbers, dots, dashes. |  | dashboard.html:2489 |  |  |
| @… is already taken. |  | dashboard.html:2490 |  |  |
| @… → @…. Their next sign-in points them to the new name. |  | dashboard.html:2517 |  |  |
| Enter a different, existing username to merge into. |  | dashboard.html:2527 |  |  |
| Merge failed: |  | dashboard.html:2543, dashboard.html:3466 |  |  |
| @… merged into @…. |  | dashboard.html:2544 |  |  |
| Remove failed: |  | dashboard.html:2560, dashboard.html:3958 |  |  |
| … removed from @…. |  | dashboard.html:2561, cueola-app.js:3758 |  |  |
| Enter one or more show codes. |  | dashboard.html:2569 |  |  |
| Tick the roster rows to attach the code(s) to. | Tick the students to add the show codes to. | dashboard.html:2570 |  | unclear — 'roster rows' and 'attach' are unclear |
| Attached … to … profile…. |  | dashboard.html:2580 |  |  |
| Loading instructor accounts… |  | dashboard.html:2603 |  |  |
| Instructor · |  | dashboard.html:2614 |  |  |
| Admin name |  | dashboard.html:2615 |  |  |
| Access |  | dashboard.html:2620 |  |  |
| Remove |  | dashboard.html:2628, cueola-app.js:3624 (+5) |  |  |
| No instructor accounts yet. Create the first one above. |  | dashboard.html:2631 |  |  |
| Name, username, and a temp password are required. |  | dashboard.html:2639 |  |  |
| Instructor "…" created. Share the temp password and have them change it. |  | dashboard.html:2645 |  |  |
| Instructor updated. |  | dashboard.html:2662 |  |  |
| You cannot remove the signed-in admin. |  | dashboard.html:2672 |  |  |
| Instructor removed. |  | dashboard.html:2678 |  |  |
| Create Session → | Create show → | dashboard.html:2742, dashboard.html:2758 (+2) |  | synonym — 'Session' -> show |
| No participants have joined yet. | No one has joined yet. | dashboard.html:3093 |  | synonym — 'participants' -> plain wording |
| Assign role |  | dashboard.html:3118 |  |  |
| Custom... |  | dashboard.html:3120 |  |  |
| Custom role |  | dashboard.html:3122 |  |  |
| Rename … |  | dashboard.html:3125, dashboard.html:3125 |  |  |
| Remove … |  | dashboard.html:3126, cueola-app.js:4782 (+2) |  |  |
| Remove … from this session | Remove … from this show | dashboard.html:3126 |  | synonym — 'session' -> show |
| Add a student by name… |  | dashboard.html:3197 |  |  |
| + Add Student |  | dashboard.html:3198 |  |  |
| No Planda Bear paperwork has been started for this session yet. | No planner paperwork started for this show yet. | dashboard.html:3289 |  | brand-for-concept, synonym — 'Planda Bear' stands in for the planner; 'session' -> show |
| No plots yet. | No stage plots yet. | dashboard.html:3328 |  | unclear — 'plots' alone is ambiguous |
| Instructor Comments |  | dashboard.html:3342, cueola-app.js:22887 |  |  |
| Not started yet. |  | dashboard.html:3373 |  |  |
| Show full change log |  | dashboard.html:3379 |  |  |
| ⇄ Merge duplicate people |  | dashboard.html:3399 |  |  |
| Duplicate… |  | dashboard.html:3401 |  |  |
| into |  | dashboard.html:3402, cueola-app.js:28304 |  |  |
| Keep… |  | dashboard.html:3403 |  |  |
| Only a super instructor can rename | Only an admin can rename | dashboard.html:3414 |  | synonym — 'super instructor' -> admin |
| Renamed to … |  | dashboard.html:3437 |  |  |
| Rename failed: |  | dashboard.html:3438 |  |  |
| Only a super instructor can merge | Only an admin can merge | dashboard.html:3443 |  | synonym — 'super instructor' -> admin |
| Pick both people |  | dashboard.html:3446 |  |  |
| Pick two different people |  | dashboard.html:3447 |  |  |
| Merged … into … |  | dashboard.html:3465 |  |  |
| Profile link required | Needs a saved profile | dashboard.html:3527 |  | unclear — 'Profile link' is not a student-facing concept |
| Session details updated | Show saved | dashboard.html:3649 |  | synonym, duplicate — 'Session details updated' and 'Session saved' (6-326) say the same thing |
| Assignments unavailable. Draft kept. | Roles could not load. Your changes are kept. | dashboard.html:3697 |  | unclear — 'Assignments' and 'Draft' are not the on-screen words |
| Wait for assignments to finish loading | Wait for roles to finish loading | dashboard.html:3702 |  | synonym — 'assignments' -> roles |
| Reconnect before saving assignments | Reconnect before saving roles | dashboard.html:3707 |  | synonym — 'assignments' -> roles |
| Custom role cannot be blank |  | dashboard.html:3721 |  |  |
| Profile link changed. Draft kept. | Profile changed. Your changes are kept. | dashboard.html:3732 |  | unclear — 'Profile link' and 'Draft' are internal words |
| That profile already has this role |  | dashboard.html:3748 |  |  |
| Link every legacy role to a saved profile first | Link every old role to a saved profile first | dashboard.html:3798 |  | jargon — 'legacy' is developer wording |
| Session roles already up to date | Roles already up to date | dashboard.html:3816 |  | synonym — 'Session roles' -> roles |
| Session roles saved | Roles saved | dashboard.html:3874 |  | synonym — 'Session roles' -> roles |
| Assignments changed elsewhere. Draft kept. | Roles changed elsewhere. Your changes are kept. | dashboard.html:3880 |  | synonym — 'Assignments' and 'Draft' are internal words |
| Session saved | Show saved | dashboard.html:3895 |  | synonym — 'Session' -> show |
| Only a super instructor can add students | Only an admin can add students | dashboard.html:3904 |  | synonym — 'super instructor' -> admin |
| "…" is already in this session | "…" is already in this show | dashboard.html:3914 |  | synonym — 'session' -> show |
| Added … to the session | Added … to the show | dashboard.html:3928 |  | synonym — 'session' -> show |
| Add failed: |  | dashboard.html:3930 |  |  |
| Only a super instructor can remove students | Only an admin can remove students | dashboard.html:3937 |  | synonym — 'super instructor' -> admin |
| Removed … from the session | Removed … from the show | dashboard.html:3956 |  | synonym — 'session' -> show |
| Session … and … attachment file… deleted forever | Show … deleted forever. | dashboard.html:4044 |  | synonym, long — 'Session' -> show; attachment count is noise |
| Session … moved to Recently Deleted. Restore within 30 days. | Show … moved to Recently Deleted. Restore within 30 days. | dashboard.html:4050 |  | synonym — 'Session' -> show |
| Delete failed: |  | dashboard.html:4056 |  |  |
| Code … copied. | Show code … copied. | dashboard.html:4076 |  | synonym — 'Code' -> show code |
| Share link copied. |  | dashboard.html:4081 |  |  |
| Cueola |  | index.html:6, index.html:5341 (+5) |  |  |
| Cue |  | index.html:5282, index.html:5417 (+9) |  |  |
| Build rundowns, prep paperwork with |  | index.html:5284 |  |  |
| Planda Bear |  | index.html:5284, index.html:5317 (+16) |  | brand-for-concept — fine as a card/theme name; 18 uses include button and tip text where 'planner' should stand |
| , go live, sync | , go live, run the prompter with | index.html:5284 |  | jargon — 'sync' is on the dev-word list |
| Flowmingo |  | index.html:5284, index.html:5318 (+9) |  | brand-for-concept — fine as a card/theme name; tips and instructions should say 'prompter' |
| , cue playback with |  | index.html:5284 |  |  |
| Outrangutan |  | index.html:5284, index.html:5319 (+4) |  | brand-for-concept — fine as a card/theme name; instructions should say 'playback' |
| , and drive it all from a Stream Deck with |  | index.html:5284 |  |  |
| KeyWi Bird. |  | index.html:5284 |  |  |
| Resume |  | index.html:5290, cueola-app.js:18882 (+1) |  |  |
| Dismiss |  | index.html:5291, index.html:6580 (+2) |  |  |
| New here? |  | index.html:5295 |  |  |
| Start the guide |  | index.html:5295 |  |  |
| Open production notes | Open notes | index.html:5297, index.html:6577 |  | synonym — 'production notes' vs 'Notes' (2-291); one name |
| Production Notes | Notes | index.html:5297, index.html:5487 (+3) |  | synonym — 'Production Notes' vs 'Notes' (2-291); one name |
| Sign in |  | index.html:5300, index.html:5355 (+10) |  |  |
| Sign in or open your profile |  | index.html:5300 |  |  |
| Settings and theme |  | index.html:5303 |  |  |
| Settings |  | index.html:5303, index.html:5443 (+3) |  |  |
| Themes |  | index.html:5310, index.html:6140 (+2) |  |  |
| Choose |  | index.html:5310, index.html:6140 (+2) |  |  |
| Glacier |  | index.html:5312, index.html:5828 (+5) |  |  |
| Honey |  | index.html:5313, index.html:5829 (+5) |  |  |
| Polar Bear |  | index.html:5314, index.html:5830 (+5) |  |  |
| Eucalyptus |  | index.html:5315, index.html:5831 (+5) |  |  |
| Koala |  | index.html:5316, index.html:5832 (+5) |  |  |
| PrepBear |  | index.html:5320, index.html:5836 (+5) |  |  |
| Front-page theme carries into the main app. Sub-app settings can still choose their own look. | This theme carries into the app. Each tool can pick its own. | index.html:5324 | yes | long — 'sub-app' is not a student word; two sentences |
| Autosave uses this browser on this device. | Your work is saved in this browser on this device. | index.html:5325 | yes | synonym — 'autosave' vs the single Saved indicator |
| Support |  | index.html:5326 |  |  |
| : bugs, questions &amp; help |  | index.html:5326 |  |  |
| support@cueola.live |  | index.html:5326 |  |  |
| Say hello |  | index.html:5327 |  |  |
| : info &amp; everything else |  | index.html:5327 |  |  |
| hello@cueola.live |  | index.html:5327 |  |  |
| License |  | index.html:5329 |  |  |
| BY-NC-ND |  | index.html:5329 |  |  |
| Creative Commons BY-NC-ND 4.0 |  | index.html:5331 |  |  |
| Copyright © 2026 Jon Kost. Free to use and share for non-commercial educational purposes with attribution. No derivatives or commercial use permitted. |  | index.html:5332 |  |  |
| Attribution |  | index.html:5334 |  |  |
| : credit must be given to Jon Kost |  | index.html:5334 |  |  |
| NonCommercial |  | index.html:5335 |  |  |
| : no commercial use |  | index.html:5335 |  |  |
| NoDerivatives |  | index.html:5336 |  |  |
| : no modified versions may be distributed |  | index.html:5336 |  |  |
| Full license text |  | index.html:5338 |  |  |
| Your sessions | Your shows | index.html:5353, cueola-app.js:5167 (+7) |  | synonym — sessions -> shows (9 uses) |
| Sign in with your username and the sessions assigned to you are one tap away. No password. | Sign in with your username to see your shows. No password. | index.html:5354, cueola-identity.js:2011 |  | synonym, long — sessions -> shows |
| Plan | Planner | index.html:5359, index.html:5436 (+1) |  | brand-for-concept — card title may keep the brand; the topbar button (index.html:5436) should read 'Planner' |
| da Bear | Planner | index.html:5359, index.html:5436 (+1) |  | brand-for-concept — second half of the split brand name; see 2-251 |
| View and build the paperwork package for your session. | Build the paperwork for your show. | index.html:5360 |  | synonym — session -> show |
| Show code required |  | index.html:5361 |  |  |
| Flow |  | index.html:5365, index.html:5522 (+2) |  |  |
| mingo |  | index.html:5365, index.html:5522 (+2) |  |  |
| Open the script display for talent, or run a remote operator without going live in Cueola. | Open the prompter for talent, or run it remotely. | index.html:5366 |  | long, synonym — 'script display' vs 'prompter' vs 'Talent Display' |
| Talent Display | Prompter | index.html:5368 |  | synonym — 'Talent Display' is the prompter |
| Remote Op | Prompter operator | index.html:5369 |  | unclear — 'Op' abbreviation |
| Out |  | index.html:5374, cueola-app.js:26724 (+2) |  |  |
| rangutan |  | index.html:5374, outrangutan/outrangutan.js:5775 |  |  |
| Cue and play video &amp; sound effects for a live show. Best in Chrome or Edge. |  | index.html:5375 |  |  |
| Session | Join a show | index.html:5377, index.html:5877 (+2) |  | synonym — session -> show; as a button it needs a verb |
| Standalone |  | index.html:5378, outrangutan/outrangutan.js:5776 |  |  |
| Key |  | index.html:5383, index.html:7518 (+2) |  |  |
| Wi Bird |  | index.html:5383, index.html:7518 (+1) |  |  |
| Run playback, rundown, prompter, and OBS from any Stream Deck, with saved layouts as pages. Sign in, then connect. Best in Chrome or Edge. | Drive playback, the rundown, the prompter, and OBS from a Stream Deck. Sign in, then connect. | index.html:5384 |  | long — three sentences on a card |
| Any Stream Deck |  | index.html:5385 |  |  |
| Demo |  | index.html:5389 |  |  |
| Load a pre-built example rundown. No login needed. |  | index.html:5390 |  |  |
| Loads the Campus News example rundown (10 rows) | (delete) | index.html:5392 |  | tooltip-only, synonym, duplicate — card text already says it; rows -> cues |
| Enter demo |  | index.html:5392 |  |  |
| Blank Slate |  | index.html:5397, index.html:6778 |  |  |
| Make your own code and work in it together. | Make a show code and work in it together. | index.html:5398 |  | synonym — 'code' -> 'show code' |
| Free text setup | Any code you like | index.html:5399 |  | unclear — 'Free text setup' explains nothing |
| Are you an instructor? |  | index.html:5404 |  |  |
| Open Instructor Dashboard |  | index.html:5405 |  |  |
| DEMO MODE: Pre-built example. Changes are not saved. |  | index.html:5414 |  |  |
| Go back to the home screen |  | index.html:5417 |  |  |
| Back to home |  | index.html:5417 |  |  |
| Code: | Show code: | index.html:5421 |  | synonym — 'Code' -> 'show code' |
| INST | Instructor | index.html:5422 |  | unclear — 'INST' abbreviation on a badge |
| Open the show preflight |  | index.html:5428 |  |  |
| Systems status, opens the show preflight |  | index.html:5428 |  |  |
| OBS |  | index.html:5429, cueola-streamdeck.js:3564 |  |  |
| TALK | PROMPTER | index.html:5430 |  | unclear — 'TALK' does not name a known link; read as the prompter/talent link |
| DECK |  | index.html:5431, cueola-streamdeck.js:3562 (+1) |  |  |
| Admin |  | index.html:5433, index.html:6162 (+3) |  |  |
| Edit |  | index.html:5434, index.html:6069 |  |  |
| Show production notes next to the rundown |  | index.html:5435 |  |  |
| Notes |  | index.html:5435, index.html:5963 (+9) |  |  |
| Choose who calls the show | Choose the director | index.html:5437, index.html:5437 |  | synonym — 'who calls the show' -> director |
| One click opens this machine's show windows on their displays | Opens the show windows on this computer's displays. | index.html:5438 | yes | tooltip-only, long — explanation lives only in a hover tip |
| Show setup |  | index.html:5438, index.html:6742 (+1) |  |  |
| Guide |  | index.html:5439, index.html:5524 (+1) |  |  |
| Enter fullscreen |  | index.html:5442, index.html:5442 (+3) |  |  |
| Open settings |  | index.html:5443 |  |  |
| Go Live |  | index.html:5445, index.html:5452 (+2) |  |  |
| You are calling the show. | You are the director. | index.html:5451, index.html:5533 |  | synonym — 'calling the show' -> director |
| GO advances the rundown for everyone. | TAKE moves everyone to the next cue. | index.html:5451, index.html:5533 |  | synonym — GO -> TAKE |
| Your Stream Deck works while you hold control. | Your Stream Deck works while you are director. | index.html:5451, index.html:5533 |  | synonym — 'hold control' -> director |
| Show |  | index.html:5456, index.html:5682 (+1) |  |  |
| Edit the show name |  | index.html:5457 |  |  |
| Untitled Show |  | index.html:5457, index.html:5545 (+2) |  |  |
| Start |  | index.html:5460, cueola-app.js:26722 (+1) |  |  |
| Duration |  | index.html:5461, index.html:5954 (+4) |  |  |
| End |  | index.html:5462, cueola-app.js:13460 |  |  |
| Rows | Cues | index.html:5463, cueola-app.js:19986 |  | synonym — rows -> cues |
| Name |  | index.html:5474, dashboard.html:991 (+5) |  |  |
| Start / Dur |  | index.html:5475, cueola-app.js:7625 |  |  |
| Video |  | index.html:5476, cueola-app.js:26722 |  |  |
| Audio |  | index.html:5477, cueola-app.js:26722 |  |  |
| Playback |  | index.html:5478, index.html:5581 (+1) |  |  |
| GFX |  | index.html:5479, cueola-app.js:26722 |  |  |
| Lighting |  | index.html:5480, cueola-app.js:26722 |  |  |
| Script |  | index.html:5481, index.html:5513 (+8) |  |  |
| Elapsed |  | index.html:5491, index.html:5653 |  |  |
| Remaining |  | index.html:5492, index.html:5550 (+1) |  |  |
| NOW → — |  | index.html:5495 |  |  |
| NEXT → — | STANDBY → — | index.html:5496 |  | synonym — the next cue is STANDBY in 3.0 |
| ● LIVE |  | index.html:5506 |  |  |
| Connection status |  | index.html:5509 |  |  |
| Cloud: not in use | Saved / Saving… / Not saved | index.html:5510 |  | jargon, tooltip-only — 'Cloud' is the sync concept; becomes the plain saving indicator |
| CLOUD | SAVED | index.html:5510 |  | jargon — 'CLOUD' -> saving indicator |
| Talent: not in use | Prompter: not connected | index.html:5511 |  | synonym, tooltip-only — 'Talent' stands for the prompter link |
| TALENT | PROMPTER | index.html:5511, cueola-app.js:19874 |  | synonym — 'TALENT' stands for the prompter link |
| Playout: not in use | Playback: not connected | index.html:5512 |  | synonym, tooltip-only — 'Playout' vs 'playback' |
| PLAYOUT | PLAYBACK | index.html:5512, index.html:5558 (+1) |  | synonym — 'PLAYOUT' vs 'playback' |
| Script Op: not in use | Prompter operator: not connected | index.html:5513 |  | synonym, tooltip-only, unclear — 'Script Op' abbreviation; ties to prompter |
| Following the show caller | Following the director | index.html:5515 |  | synonym, tooltip-only — 'show caller' becomes 'director'; badge meaning should be visible, not hover-only |
| VIEWER |  | index.html:5515 |  |  |
| Start or pause the show clock |  | index.html:5519 |  |  |
| Start Show | Start show | index.html:5519 |  |  |
| Switch between the focused view and the full grid | Switch between focus view and full rundown | index.html:5520 |  |  |
| Full Grid | Full rundown | index.html:5520 |  | unclear — 'grid' means nothing in production vocabulary |
| Show or hide the Script Op panel | Show or hide the script panel | index.html:5521 |  | synonym — 'Script Op' / 'Script Operator' / 'script panel' name the same thing; pick one |
| Script Op | Script | index.html:5521, index.html:5606 |  | synonym, unclear — abbreviation; competes with 'Script Operator' (3-38) |
| Turn the Flowmingo operator view on or off | Turn the prompter controls on or off | index.html:5522 |  | brand-for-concept — brand name standing in for 'prompter' |
| Op | Prompter controls | index.html:5522 |  | unclear, brand-for-concept — button reads 'Flowmingo Op'; 'Op' is an abbreviation students must decode |
| Open Flowmingo in a new browser window | Open the prompter in a new window | index.html:5523 |  | brand-for-concept — plain word in instruction text |
| Open the Cueola learning guide | Open the guide | index.html:5524 |  |  |
| Leave Live and return to the rundown builder | Leave Live and go back to the rundown | index.html:5528 |  |  |
| Exit |  | index.html:5528, index.html:5898 |  |  |
| Following: |  | index.html:5536 |  |  |
| Myself |  | index.html:5538, cueola-app.js:14131 |  |  |
| Make Everyone Follow Me | Become director | index.html:5540 |  | long, synonym — one verb for taking the director seat |
| Live show overview |  | index.html:5542 |  |  |
| Live Rundown | Live rundown | index.html:5544 |  |  |
| Row 1 of 0 | Cue 1 of 0 | index.html:5546 |  | synonym — row -> cue |
| Now |  | index.html:5548, dashboard.html:1906 (+1) |  |  |
| Next | Standby | index.html:5549, index.html:5714 (+6) |  | synonym — the next cue is shown as STANDBY in 3.0; keep 'Next' only where it is a nav button |
| Playout now playing | Playback now playing | index.html:5557 |  | synonym — playout -> playback |
| Nothing playing |  | index.html:5559, cueola-app.js:9530 |  |  |
| PANIC: kill all playout audio and video instantly. Shortcut: Shift+Esc | Stops all playback instantly (Shift+Esc) | index.html:5562 | yes | long, synonym, tooltip-only — safety-critical; the shortcut should be visible or in an info icon |
| PANIC |  | index.html:5562, outrangutan/outrangutan.js:5844 |  |  |
| READY | STANDBY | index.html:5567, index.html:5612 (+7) |  | synonym, state-as-action — READY is removed in 3.0; the call stage is shown as STANDBY |
| Manual TAKE is on for this show, which parks every call at READY. Switch the show to automatic: this call runs READY · TRACK · ROLL and fires itself. | (delete) | index.html:5569 |  | long, jargon, synonym, tooltip-only — Manual TAKE / READY · TRACK · ROLL are removed; the AUTO button goes with them |
| Play the clip now. Shortcut: G | Take the clip now (G) | index.html:5570 |  |  |
| TAKE · G | TAKE | index.html:5570 |  |  |
| Cancel the call so nothing plays. Shortcut: S | Cancel so nothing plays (S) | index.html:5571 |  |  |
| ABORT · S | ABORT | index.html:5571 |  |  |
| Live subsystem status and recovery | Live status | index.html:5573 |  | jargon — 'subsystem' is developer jargon |
| System status | Status | index.html:5574 |  |  |
| Waiting for connection | Not connected | index.html:5577 |  |  |
| Flowmingo recovery actions | Prompter fixes | index.html:5578 |  | brand-for-concept |
| Output closed | Playback window closed | index.html:5581 |  | unclear — 'output' needs the noun |
| Playback recovery actions | Playback fixes | index.html:5582 |  |  |
| Script Operator | Script | index.html:5585, script-operator.html:24 |  | synonym — same thing as 'Script Op' (3-7); one name |
| Panel closed |  | index.html:5585 |  |  |
| Script Operator recovery actions | Script panel fixes | index.html:5586 |  | synonym |
| Saved state | Saved | index.html:5589 |  | jargon, synonym — use the single saving indicator: Saved / Saving… / Not saved |
| Monitoring | Saved | index.html:5589 |  | unclear — 'Monitoring' tells a student nothing |
| Saved-state recovery actions | Saving fixes | index.html:5590 |  | jargon |
| Cloud sync lost. Showing the last saved state while it reconnects. | Not saved. Reconnecting… | index.html:5595 |  | jargon, tooltip-only — important status hidden in a hover; fold into the visible indicator |
| SYNC RECONNECTING… | NOT SAVED · RECONNECTING… | index.html:5595 |  | jargon, synonym — 'sync' is developer jargon |
| A sound effect pad just played | A sound effect just played | index.html:5596 |  |  |
| SFX |  | index.html:5596, cueola-app.js:10054 (+1) |  |  |
| Close the Script Operator panel | Close the script panel | index.html:5601 |  | synonym |
| Resize the Script Operator panel | Resize the script panel | index.html:5602 |  | synonym |
| Drag or use arrow keys to resize the panel | Drag or use arrow keys to resize | index.html:5602 |  |  |
| Make the panel text smaller | Smaller text | index.html:5607 |  |  |
| Decrease Live panel text size | Smaller text | index.html:5607 |  |  |
| Make the panel text larger | Larger text | index.html:5608 |  |  |
| Increase Live panel text size | Larger text | index.html:5608 |  |  |
| Pop the controls out into a movable panel | Pop out the controls | index.html:5609 |  |  |
| Pop out the Script Op controls | Pop out the script controls | index.html:5609 |  | synonym |
| Close the Script Op panel | Close the script panel | index.html:5610, index.html:5610 |  | synonym |
| Waiting for Flowmingo… | Waiting for the prompter… | index.html:5612 |  | brand-for-concept |
| Live Flowmingo script | Live prompter script | index.html:5614, script-operator.html:53 (+1) |  | brand-for-concept |
| Live Flowmingo script appears here. Type updates, then push. | The prompter script appears here. Edit, then send. | index.html:5614 |  | brand-for-concept, unclear — 'push' is a developer verb; pair with the button (3-71) |
| Talent · — |  | index.html:5619 |  |  |
| Keep the script scrolled to where the talent is reading. Pauses while you type. | Follow where the talent is reading. Pauses while you type. | index.html:5620 | yes | long, tooltip-only — two sentences; move behind an info icon |
| Follow |  | index.html:5620 |  |  |
| Drag or use arrow keys to resize the script | Drag or use arrow keys to resize | index.html:5622 |  |  |
| Resize the script editor |  | index.html:5622 |  |  |
| Edit this cue's script |  | index.html:5624 |  |  |
| Edit cue script |  | index.html:5624, script-operator.html:60 (+1) |  |  |
| Clear the script. Asks you to confirm first. | Clear the script (asks first) | index.html:5625 |  |  |
| Clear script; confirmation required | Clear script | index.html:5625 |  |  |
| Send the script to Flowmingo (Cmd+Enter) | Send the script to the prompter (Cmd+Enter) | index.html:5626 |  | brand-for-concept |
| Push to Flowmingo | Send to prompter | index.html:5626, script-operator.html:68 |  | brand-for-concept, jargon — 'push' is a developer verb |
| Script Op control groups | Prompter controls | index.html:5632 |  | synonym |
| Transport controls | Play and scroll | index.html:5633 |  |  |
| Cue and on-air controls | Cue and on-air | index.html:5634 |  |  |
| Clocks and alerts |  | index.html:5635, script-operator.html:84 |  |  |
| Display and theme |  | index.html:5636, script-operator.html:88 |  |  |
| Transport |  | index.html:5638, script-operator.html:76 (+5) |  |  |
| Live prompter actions | Prompter actions | index.html:5641 |  |  |
| Go back to the previous cue | Back to the previous cue | index.html:5663 |  |  |
| Previous cue |  | index.html:5663, outrangutan/outrangutan.js:5839 (+1) |  |  |
| Previous |  | index.html:5663, cueola-app.js:3236 (+1) |  |  |
| GO to the next cue | Take the next cue | index.html:5664, index.html:5664 |  | synonym — GO -> TAKE |
| GO | TAKE | index.html:5664, cueola-app.js:10072 (+1) |  | synonym — GO -> TAKE, the single live verb |
| Next cue | Take | index.html:5664, outrangutan/outrangutan.js:5842 (+1) |  | duplicate — same button as GO (3-83); one label |
| Not connected |  | index.html:5681, index.html:5864 (+1) |  |  |
| Connected to your show |  | index.html:5682 |  |  |
| A script is loaded |  | index.html:5683 |  |  |
| Link a show | Connect to a show | index.html:5685, index.html:5802 |  | synonym — link / connect / load all mean join; use 'Connect' |
| Show or hide controls |  | index.html:5686, index.html:5686 |  |  |
| Drag to move |  | index.html:5693, index.html:5757 |  |  |
| SPACE |  | index.html:5694, index.html:5888 |  |  |
| play / pause |  | index.html:5694, index.html:5888 (+2) |  |  |
| DOWN hold | hold DOWN | index.html:5695, index.html:5889 |  |  |
| brake | slow down | index.html:5695, index.html:5889 (+3) |  |  |
| UP hold | hold UP | index.html:5696, index.html:5890 |  |  |
| boost | speed up | index.html:5696, index.html:5890 (+3) |  |  |
| OPT + DOWN |  | index.html:5697, index.html:5892 |  |  |
| reverse | scroll back | index.html:5697, index.html:5892 (+3) |  |  |
| OPT + UP |  | index.html:5698, index.html:5893 |  |  |
| forward | scroll ahead | index.html:5698, index.html:5893 (+3) |  |  |
| fullscreen |  | index.html:5699, index.html:5793 (+2) |  |  |
| hide controls |  | index.html:5701, index.html:5896 |  |  |
| mirror mode | mirror | index.html:5702 |  | duplicate — same hotkey listed as 'mirror' at 5897 |
| Holding |  | index.html:5715 |  |  |
| Technical Difficulties |  | index.html:5722 |  |  |
| Please stand by |  | index.html:5723 |  |  |
| Generated NTSC color bars | Color bars | index.html:5725 |  |  |
| NTSC Color Bars |  | index.html:5729 |  |  |
| Connect Flowmingo to your show | Connect the prompter to your show | index.html:5737 |  |  |
| Tap your show, or enter the show code from your Script Op or Flowmingo Op. | Tap your show, or enter its show code. | index.html:5738 |  | long, synonym, brand-for-concept — names two other screens the student may not know |
| SHOW CODE |  | index.html:5741, index.html:5862 (+9) |  |  |
| Connect |  | index.html:5742, outrangutan/outrangutan.js:2510 |  |  |
| Keep this script (not linked to a show) | Keep this script (not connected to a show) | index.html:5745 |  | synonym — linked -> connected |
| Connect to your show |  | index.html:5747 |  |  |
| Script loads automatically from the Script Op | The script loads by itself | index.html:5748 |  | synonym |
| When it turns green |  | index.html:5749 |  | synonym — the bold word READY inside this line becomes CONNECTED (READY is retired) |
| , you're set |  | index.html:5749 |  |  |
| No code? Load a file or paste a script instead | No show code? Load or paste a script instead | index.html:5751 |  |  |
| Panel size |  | index.html:5759 |  |  |
| Shrink this panel | Smaller panel | index.html:5760 |  |  |
| Shrink the control panel | Smaller panel | index.html:5760 |  |  |
| Grow this panel | Larger panel | index.html:5762 |  |  |
| Grow the control panel | Larger panel | index.html:5762 |  |  |
| Prompter speed |  | index.html:5771, index.html:5774 (+1) |  |  |
| Speed |  | index.html:5772, script-operator.html:236 (+2) |  |  |
| Scroll slower | Slower | index.html:5773 |  |  |
| Decrease speed | Slower | index.html:5773, script-operator.html:237 |  |  |
| Scroll faster | Faster | index.html:5775 |  |  |
| Increase speed | Faster | index.html:5775, script-operator.html:239 |  |  |
| Prompter text size |  | index.html:5777, index.html:5780 (+1) |  |  |
| Size |  | index.html:5778, script-operator.html:242 (+3) |  |  |
| Make the text smaller | Smaller text | index.html:5779 |  |  |
| Decrease text size | Smaller text | index.html:5779, script-operator.html:243 |  |  |
| Make the text larger | Larger text | index.html:5781 |  |  |
| Increase text size | Larger text | index.html:5781, script-operator.html:245 |  |  |
| Align |  | index.html:5784, script-operator.html:248 (+2) |  |  |
| Align the script left | Align left | index.html:5785 |  |  |
| Align script left | Align left | index.html:5785 |  |  |
| Left |  | index.html:5785, script-operator.html:250 (+2) |  |  |
| Center the script | Align center | index.html:5786 |  |  |
| Align script center | Align center | index.html:5786 |  |  |
| Center |  | index.html:5786, script-operator.html:251 (+2) |  |  |
| Align the script right | Align right | index.html:5787 |  |  |
| Align script right | Align right | index.html:5787 |  |  |
| Right |  | index.html:5787, script-operator.html:252 (+2) |  |  |
| Reset | Top | index.html:5791, index.html:5895 (+6) |  | unclear — the button scrolls the script back to the top; 'Reset' sounds like it clears settings |
| Mirror |  | index.html:5792, index.html:5897 (+3) |  |  |
| Show the NEXT and HOLDING row chips along the bottom | Show the STANDBY and HOLDING cue names | index.html:5794 |  | synonym, tooltip-only — row -> cue; NEXT -> STANDBY; visible label should carry the meaning |
| Row info | Cue names | index.html:5794 |  | synonym, unclear — row -> cue |
| Show code e.g. 2605A | Show code, e.g. 2605A | index.html:5806 |  |  |
| Load | Connect | index.html:5807, index.html:5863 (+9) |  | synonym — Load / Link / Connect are the same action for a show code |
| Link a Cueola show code to keep Flowmingo synced. The script panel and Flowmingo Op can play, pause, brake, boost, resize, align, theme, and mirror this talent screen remotely. | Enter the show code so the director can control this prompter. | index.html:5810 | yes | long, jargon, brand-for-concept — two long sentences; 'synced' is jargon; feature list belongs behind an info icon |
| Open Remote Operator | Open prompter controls | index.html:5812 |  | synonym — third name for Flowmingo Op / Script Op |
| Edit / Load Script | Edit or load script | index.html:5815 |  |  |
| Theme |  | index.html:5824, dashboard.html:1302 (+6) |  |  |
| Glacier theme |  | index.html:5828, index.html:5828 |  |  |
| Honey theme |  | index.html:5829, index.html:5829 |  |  |
| Polar Bear theme |  | index.html:5830, index.html:5830 |  |  |
| Eucalyptus theme |  | index.html:5831, index.html:5831 |  |  |
| Koala theme |  | index.html:5832, index.html:5832 |  |  |
| Planda Bear theme |  | index.html:5833, index.html:5833 |  |  |
| Flowmingo theme |  | index.html:5834, index.html:5834 (+1) |  |  |
| Outrangutan theme |  | index.html:5835, index.html:5835 |  |  |
| PrepBear theme |  | index.html:5836, index.html:5836 |  |  |
| Or Paste / Type | Or paste or type | index.html:5839 |  |  |
| Paste or type your script here... | Paste or type your script here… | index.html:5840 |  |  |
| Text | Load text file | index.html:5842 |  | unclear — single word does not say it opens a file picker |
| PDF | Load PDF | index.html:5843 |  | unclear — pair with 3-167 |
| Cancel |  | index.html:5844, index.html:5967 (+23) |  |  |
| Load Script | Load script | index.html:5845 |  |  |
| Standalone remote | Prompter remote | index.html:5858 |  | unclear — 'standalone' is a developer distinction |
| Flowmingo Op | Prompter controls | index.html:5859, cueola-app.js:19963 |  | synonym, brand-for-concept — screen title may keep the brand; 'Op' abbreviation should go |
| Talent Screen | Open talent screen | index.html:5866 |  |  |
| Load a show code to control Flowmingo remotely. | Enter a show code to control the prompter. | index.html:5872, cueola-app.js:19965 |  | synonym, brand-for-concept |
| No session loaded | No show connected | index.html:5879, cueola-app.js:19964 |  | synonym — session -> show |
| Enter the same code used on the talent Flowmingo screen. | Enter the same show code as the talent screen. | index.html:5880, cueola-app.js:19964 |  | synonym, brand-for-concept |
| Hotkeys | Shortcuts | index.html:5887 |  |  |
| LEFT / RIGHT |  | index.html:5891 |  |  |
| text size |  | index.html:5891 |  |  |
| ESC |  | index.html:5898 |  |  |
| New Row: Step 1 of 2 | New cue · Step 1 of 2 | index.html:5915 |  | synonym — row -> cue |
| Add a row | Add a cue | index.html:5916 |  | synonym — row -> cue |
| Cue Name / Label | Cue name | index.html:5918 |  | synonym — name / label are two words for one thing |
| e.g. "Show Open" | e.g. Show Open | index.html:5919 |  |  |
| The first full production moment after countdown: music, graphics, camera, and talent come together. | The first full moment after countdown: music, graphics, camera, talent. | index.html:5922 | yes | long, tooltip-only — curriculum definition; belongs in an info icon or the guide, not a hover |
| Show Open |  | index.html:5922 |  |  |
| A quick opening segment before the main show open, often used for a hook, tease, or dramatic start. | A short hook or tease before the show open. | index.html:5923 | yes | long, tooltip-only |
| Cold Open |  | index.html:5923 |  |  |
| Package: a pre-produced video story or edited segment that rolls from playback. | Package: a pre-edited video that plays from playback. | index.html:5924 | yes | long, tooltip-only |
| PKG |  | index.html:5924 |  |  |
| A handoff from one host, guest, camera, segment, or location to another. | A handoff from one host, camera, or location to another. | index.html:5925 | yes | long, tooltip-only |
| Toss |  | index.html:5925 |  |  |
| A live camera or remote segment, usually with timing and IFB-style crew cues. | A live camera or remote segment. | index.html:5926 | yes | long, tooltip-only — 'IFB-style' is unexplained |
| Live Shot |  | index.html:5926 |  |  |
| A short transition into or out of a break, often with music, graphics, or a quick tease. | A short transition into or out of a break. | index.html:5927 | yes | long, tooltip-only |
| Bumper |  | index.html:5927 |  |  |
| The closing row for final thanks, credits, music, graphics, and fade out. | The closing cue: thanks, credits, music, fade out. | index.html:5928 | yes | long, synonym, tooltip-only — row -> cue |
| Signoff |  | index.html:5928 |  |  |
| A planned pause in the show flow, such as commercial, reset, station break, or classroom pause. | A planned pause: commercial, reset, or station break. | index.html:5929 | yes | long, tooltip-only |
| Break |  | index.html:5929, index.html:6070 (+3) |  |  |
| A general setup or lead-in row before a segment, guest, topic, or scripted moment. | A lead-in cue before a segment, guest, or topic. | index.html:5930 | yes | long, synonym, tooltip-only — row -> cue |
| Intro |  | index.html:5930 |  |  |
| An unscripted conversation segment where talent can speak naturally from prompts or topic notes. | Unscripted talk from topic notes. | index.html:5931 | yes | long, tooltip-only |
| Open Conversation |  | index.html:5931 |  |  |
| Style | Timing | index.html:5934, cueola-app.js:10751 |  | unclear — the choice is Timed / Flex / Segment; 'Style' sounds like appearance and collides with 'Cue Type' in step 2 |
| Timed |  | index.html:5938 |  |  |
| Fixed duration. Clock counts down. | Set length. Clock counts down. | index.html:5939 |  |  |
| No fixed time. Expand as needed. | No set length. Runs as long as needed. | index.html:5944 |  |  |
| Segment |  | index.html:5948 |  |  |
| Section divider. Collapses its cues in build. | Groups cues. Cannot be taken. | index.html:5949 |  | unclear — 'in build' is an internal mode name; say what a segment is |
| MIN |  | index.html:5960, cueola-app.js:8368 |  |  |
| SEC |  | index.html:5960, cueola-app.js:8373 |  |  |
| (optional) |  | index.html:5963, index.html:6782 (+6) |  |  |
| Additional info for the crew | Notes for the crew | index.html:5964 |  |  |
| Choose Cue Type | Next: cue type | index.html:5968 |  |  |
| Step 2 of 2 · Cue Type | Step 2 of 2 · Cue type | index.html:5974 |  |  |
| What type of cue is this? |  | index.html:5975 |  |  |
| Back |  | index.html:5978, cueola-streamdeck.js:4821 (+6) |  |  |
| Open Cue Builder | Add cue | index.html:5979 |  | unclear — 'Cue Builder' is a third screen name; the student just wants the cue added |
| Edit Cue | Edit cue | index.html:5992 |  |  |
| Save Changes | Save | index.html:5994, index.html:6852 (+1) |  | duplicate — 'Save' and 'Save Changes' on sibling dialogs (3-224) |
| Remove this row | Delete cue | index.html:5995 |  | synonym, duplicate — row -> cue; duplicates 3-225 with different noun |
| Configure Cue | Edit cue | index.html:6004 |  | duplicate — Configure / Edit are two names for the same dialog |
| Save |  | index.html:6006, index.html:6605 (+1) |  |  |
| Remove this cue | Delete cue | index.html:6007 |  | duplicate — match 3-222; app uses 'Delete' elsewhere |
| Self-guided training |  | index.html:6019 |  |  |
| Cueola Learning Hub | Guide | index.html:6020 |  | synonym — button says 'Guide' (3-11); the screen should too |
| Short lessons for getting from blank show to live rundown, Planda Bear paperwork, Flowmingo prompting, Outrangutan playback, and the KeyWi Bird deck without needing outside support. | Short lessons on the rundown, paperwork, prompter, playback, and Stream Deck. | index.html:6021 |  | long, brand-for-concept |
| Turn on voice over |  | index.html:6023 |  |  |
| Voice Over Off | Voice over | index.html:6023 |  | state-as-action — button label reads as a state; use a toggle with a fixed label |
| Replay Lesson | Replay lesson | index.html:6024 |  |  |
| Voice over off. |  | index.html:6029 |  |  |
| Listen once, then follow the Where To Go and Do This sections while the lesson talks. | Listen once, then follow the steps as the lesson plays. | index.html:6030 |  | long |
| Close the guide |  | index.html:6033 |  |  |
| Close guide |  | index.html:6033 |  |  |
| Lesson progress |  | index.html:6038 |  |  |
| Hand rundown control | Choose the director | index.html:6055 |  | synonym — 'rundown control' -> director |
| The chosen student drives GO, playback calls, and the prompter for everyone, with the same sequential safety rail instructors get. You keep full control alongside them and can take it back any time. | The director drives TAKE, playback, and the prompter for everyone. You can take it back any time. | index.html:6056 | yes | long, synonym, jargon — 'sequential safety rail' is unexplained; GO -> TAKE |
| Close |  | index.html:6058, index.html:6186 (+9) |  |  |
| Edit the full script here. Saving pushes this row to Flowmingo. | Saving sends this cue's script to the prompter. | index.html:6065 |  | synonym, jargon, brand-for-concept — row -> cue; 'pushes' is a developer verb |
| Update | [UPDATE] marker | index.html:6068, script-operator.html:278 (+2) |  | unclear — chip inserts a script marker; label alone reads like a save button |
| Line break |  | index.html:6071 |  |  |
| Divider |  | index.html:6072 |  |  |
| Stop here |  | index.html:6073 |  |  |
| Hold |  | index.html:6074, cueola-streamdeck.js:4141 (+1) |  |  |
| Stand by |  | index.html:6075 |  |  |
| Tech difficulty | Tech difficulties | index.html:6076, script-operator.html:151 |  |  |
| Save &amp; Push to Flowmingo | Save and send | index.html:6080 |  | brand-for-concept, jargon, long |
| Close this preview | Close | index.html:6090 |  |  |
| Close preview |  | index.html:6090 |  |  |
| Cue to this row | Jump to this cue | index.html:6093 |  | synonym, unclear — row -> cue; 'cue' as a verb collides with 'cue' the noun |
| Makes this the current row and cues the prompter. Playout does not auto-fire. | Makes this the NOW cue. Playback does not start. | index.html:6094 | yes | synonym, long — row -> cue; playout -> playback |
| Previous row | Previous cue | index.html:6096 |  | synonym |
| Next row | Next cue | index.html:6097 |  | synonym |
| Start the show from… |  | index.html:6107 |  |  |
| This session is parked on | This show is stopped on | index.html:6110 |  | synonym — session -> show |
| with the clock at 0:00, likely left over from a previous run. | with the clock at 0:00, probably from an earlier run. | index.html:6110 |  | long |
| Take it from the top: | Start from the top: | index.html:6111 |  | synonym — 'Take' is now reserved for the live verb |
| Start here: |  | index.html:6112 |  |  |
| Pre-production workspace | Planner | index.html:6125 |  |  |
| Your paperwork in show order. Everything saves as you type, and the PDF comes out exactly like the preview. | Your paperwork in show order. Saves as you type. | index.html:6127 |  | long |
| Go back to the Cueola rundown | Back to the rundown | index.html:6131 |  |  |
| Back to Cueola rundown | Back to the rundown | index.html:6131 |  |  |
| Planda Bear settings: theme, exports, and previews | Planner settings | index.html:6132 |  | brand-for-concept |
| Planda Bear settings | Planner settings | index.html:6132, index.html:6137 (+1) |  | brand-for-concept |
| Exports | Export | index.html:6156 |  |  |
| Export the whole paperwork package as one PDF | All paperwork as one PDF | index.html:6158 |  |  |
| Export PDF Package | Export paperwork | index.html:6158, index.html:6183 |  |  |
| See the package before you export | See it before you export | index.html:6159 |  |  |
| Preview Package | Preview paperwork | index.html:6159, index.html:6184 |  |  |
| Export just the call sheet | Just the call sheet | index.html:6160 |  |  |
| Export Call Sheet Only | Export call sheet | index.html:6160, index.html:6185 |  |  |
| Sign in as admin to edit position assignments on the hub | Instructor sign-in to edit positions | index.html:6164 |  |  |
| Admin sign in | Instructor sign in | index.html:6164 |  |  |
| The crew’s message board. Tag a department and the thread stays with the show. | The crew's message board. Tag a department to keep the thread with the show. | index.html:6172 |  |  |
| Pick your group |  | index.html:6195 |  |  |
| Each group has its own paperwork workspace. The rundown and Live stay shared with the whole class. | Each group has its own paperwork. The rundown is shared with the class. | index.html:6196 |  | long |
| Groups are locked. Ask your instructor if you need to move. | Groups are locked. Ask your instructor to move. | index.html:6198 |  |  |
| Not now |  | index.html:6199 |  |  |
| Exporting PDF |  | index.html:6206, cueola-app.js:30912 |  |  |
| Preparing… |  | index.html:6207 |  |  |
| About exports and the verified stamp |  | index.html:6216 |  |  |
| Preview |  | index.html:6216, cueola-app.js:22405 |  |  |
| Done |  | index.html:6222, index.html:6867 (+12) |  |  |
| Call Sheet | Call sheet | index.html:6234, index.html:6241 |  |  |
| Times, contacts, access, and crew notes. |  | index.html:6235 |  |  |
| Why a show has multiple call sheets | Why a show can have more than one call sheet | index.html:6241 |  |  |
| Current Call Sheet | Call sheet | index.html:6244 |  |  |
| Setup Day, Production Day | e.g. Setup Day | index.html:6247 |  |  |
| Call Sheet Name | Name | index.html:6247 |  |  |
| Add another call sheet, e.g. a second shoot day | Add a call sheet, e.g. a second shoot day | index.html:6248 |  |  |
| + Add | Add call sheet | index.html:6248, index.html:6472 (+2) |  |  |
| Delete this call sheet. Instructors and admins only. | Delete this call sheet (instructor only) | index.html:6249 |  | tooltip-only — the permission note should be visible, or the button hidden for students |
| Delete |  | index.html:6249, index.html:6473 (+3) |  |  |
| What the event info section is for | About event info | index.html:6253 |  |  |
| Event Info | Event info | index.html:6253 |  |  |
| e.g. Campus News Live |  | index.html:6255 |  |  |
| Production | Show | index.html:6255, index.html:6844 (+2) |  | synonym — production / show / session; one word |
| Shoot Date | Shoot date | index.html:6256, cueola-app.js:29570 |  |  |
| Call Time | Call time | index.html:6257, cueola-app.js:29571 |  |  |
| Show Start | Show start | index.html:6258, index.html:6418 (+2) |  |  |
| Fill in the wrap time: show start plus the rundown's total runtime | Show start plus rundown length | index.html:6259 |  | tooltip-only — the button label alone (3-304) does not explain the action |
| Estimated Wrap | Estimated wrap | index.html:6259, cueola-app.js:29574 |  |  |
| Rundown | From rundown | index.html:6259 |  | unclear — a noun as a button label; it fills the wrap time from the rundown |
| Doors Open | Doors open | index.html:6260, index.html:6417 (+2) |  |  |
| e.g. Sam |  | index.html:6261 |  |  |
| Late / Lost Contact Name | Running-late contact | index.html:6261 |  |  |
| Who to text if you are running late. |  | index.html:6261 |  |  |
| Late / Lost Contact Number | Their phone number | index.html:6262 |  |  |
| Their phone number. | (delete) | index.html:6262 |  | duplicate — redundant with the label |
| What the location and weather section is for | About location and weather | index.html:6266 |  |  |
| Location and Weather | Location and weather | index.html:6266 |  |  |
| e.g. Studio A, Media Building |  | index.html:6268 |  |  |
| Location |  | index.html:6268, index.html:6421 (+2) |  |  |
| e.g. 400 College Ave |  | index.html:6269 |  |  |
| Address |  | index.html:6269, index.html:6422 (+2) |  |  |
| Use the full street address so maps and parking directions work. | Full street address, so maps work. | index.html:6269 |  |  |
| Venue Type | Venue | index.html:6272, index.html:6273 |  |  |
| Indoors |  | index.html:6274 |  |  |
| Outdoors |  | index.html:6275 |  |  |
| Both |  | index.html:6276 |  |  |
| Add a shoot date |  | index.html:6282 |  |  |
| Add a location |  | index.html:6284 |  |  |
| Get forecast |  | index.html:6286 |  |  |
| Auto-fills from your location and shoot date. You can edit anything below. | Fills in from your location and shoot date. Edit anything. | index.html:6288 |  |  |
| e.g. Partly cloudy |  | index.html:6290 |  |  |
| Conditions |  | index.html:6290 |  |  |
| High |  | index.html:6291 |  |  |
| Low |  | index.html:6292 |  |  |
| Precip | Rain | index.html:6293 |  | unclear — Abbreviation; say the plain word. |
| 8 mph |  | index.html:6294 |  |  |
| Wind |  | index.html:6294 |  |  |
| Sunrise |  | index.html:6295 |  |  |
| Sunset |  | index.html:6296 |  |  |
| What the access and crew notes section is for |  | index.html:6301 |  |  |
| Access and Crew Notes |  | index.html:6301 |  |  |
| e.g. Lot C after 4 PM · permits not enforced |  | index.html:6303 |  |  |
| Parking |  | index.html:6303, cueola-app.js:29579 |  |  |
| e.g. Loading dock door, knock twice |  | index.html:6304 |  |  |
| Entrance |  | index.html:6304, cueola-app.js:29580 |  |  |
| e.g. YouTube · Stream op: Sam |  | index.html:6305 |  |  |
| Stream Information | Stream | index.html:6305, cueola-app.js:29582 |  |  |
| Say where the show streams and who runs the stream, or N/A for a show that does not stream. | Where the show streams and who runs it. N/A if it does not stream. | index.html:6305 | yes | long — Helper sentence is long; move behind the info icon. |
| e.g. Show blacks · closed-toe shoes |  | index.html:6306 |  |  |
| Dress Code |  | index.html:6306, cueola-app.js:29583 |  |  |
| Meals Provided |  | index.html:6308, index.html:6309 |  |  |
| Provided |  | index.html:6310 |  |  |
| Not provided |  | index.html:6311 |  |  |
| Meal Time |  | index.html:6314 |  |  |
| e.g. Pizza in the green room · vegetarian available |  | index.html:6315 |  |  |
| Meals |  | index.html:6315, cueola-app.js:29584 |  |  |
| What the crew and talent contacts section is for |  | index.html:6319 |  |  |
| Crew / Talent Contacts |  | index.html:6319 |  |  |
| Type directly in the row below. Use Add person when you need another row. | Type in the row below, or tap Add person for another. | index.html:6320 | yes | long — Two sentences explaining a button; one sentence or an info icon. |
| Add person |  | index.html:6323 |  |  |
| Add everyone from the saved role assignments in one tap | Adds everyone on the roster | index.html:6324 | yes | tooltip-only, synonym — Hover-only; says 'role assignments' while the button says 'roster'. |
| Fill from roster |  | index.html:6324 |  |  |
| What the plans and notes section is for |  | index.html:6327 |  |  |
| Plans and Notes |  | index.html:6327 |  |  |
| General Notes |  | index.html:6328, cueola-app.js:29589 |  |  |
| Key times, reminders, transportation, access notes |  | index.html:6329 |  |  |
| Export Call Sheet PDF | Export call sheet | index.html:6332 |  |  |
| Safety Plan |  | index.html:6343 |  |  |
| Emergency contacts, safety notes, and gear needs. |  | index.html:6344 |  |  |
| What the emergency contacts section is for |  | index.html:6350 |  |  |
| Emergency Contacts and Hospital |  | index.html:6350 |  |  |
| e.g. Mercy General |  | index.html:6352 |  |  |
| Local Hospital |  | index.html:6352, cueola-app.js:29692 |  |  |
| e.g. 1200 Health Way |  | index.html:6353 |  |  |
| Hospital Address |  | index.html:6353 |  |  |
| Prints on the call sheet too, so the crew can navigate fast. | Also prints on the call sheet. | index.html:6353 |  | long — Trim the justification clause. |
| Hospital Phone |  | index.html:6354 |  |  |
| 911, campus emergency, etc. |  | index.html:6355 |  |  |
| Emergency Numbers |  | index.html:6355, cueola-app.js:29697 |  |  |
| e.g. Facilities (555) 210-3000 |  | index.html:6356 |  |  |
| Non-Emergency Numbers |  | index.html:6356, cueola-app.js:29698 |  |  |
| e.g. Campus security (555) 210-2000 |  | index.html:6357 |  |  |
| Security |  | index.html:6357, cueola-app.js:29699 |  |  |
| e.g. Sam (555) 210-8100 |  | index.html:6358 |  |  |
| Late / Lost Contact |  | index.html:6358, cueola-app.js:29581 (+1) |  |  |
| Who to text if someone runs late. Auto-fills from the Call Sheet. | Who to text if someone runs late (from the call sheet). | index.html:6358 |  | long — Two sentences; fold into one. |
| What the site and equipment section is for |  | index.html:6362 |  |  |
| Site, Weather and Equipment |  | index.html:6362 |  |  |
| Conditions, temperature, rain, wind |  | index.html:6364 |  |  |
| Weather |  | index.html:6364, cueola-app.js:29578 (+1) |  |  |
| Auto-fills from the Call Sheet. | From the call sheet. | index.html:6364, index.html:6415 (+3) |  |  |
| e.g. Control room shelf, by the door |  | index.html:6365 |  |  |
| First Aid Kit Location |  | index.html:6365, cueola-app.js:29695 |  |  |
| e.g. Hallway outside Studio A |  | index.html:6366 |  |  |
| Fire Extinguisher Location |  | index.html:6366, cueola-app.js:29696 |  |  |
| Equipment Needed |  | index.html:6368, cueola-app.js:29701 |  |  |
| e.g. Ladders, rigging, cable runs across walkways |  | index.html:6369 |  |  |
| List gear that needs special safety handling so the crew can plan around it. | Gear that needs special safety handling. | index.html:6370 |  |  |
| OSHA PPE Requirements |  | index.html:6375, cueola-app.js:29694 |  |  |
| Personal protective equipment this production requires. Every production lists at least 3 real items, like closed-toe shoes, work gloves, eye protection, hearing protection, or hard hats. "None" and "N/A" are not accepted. Reference: | List at least 3 real items, like closed-toe shoes or eye protection. "None" is not accepted. | index.html:6376 | yes | long — Four sentences; keep the rule visible, move the rest and the OSHA link behind the info icon. |
| osha.gov/personal-protective-equipment |  | index.html:6376 | yes |  |
| What the safety notes section is for |  | index.html:6380 |  |  |
| Safety Notes |  | index.html:6381, cueola-app.js:29702 |  |  |
| Anything else the crew should know to stay safe |  | index.html:6382 |  |  |
| Production Schedule |  | index.html:6393 |  |  |
| A simple two-day schedule: setup day, show day, and what must be ready before the show starts. | Setup day, show day, and what must be ready before the show. | index.html:6394 | yes | long — Explanatory sentence; info icon. |
| What the setup day section is for |  | index.html:6400 |  |  |
| Setup Day |  | index.html:6400 |  |  |
| Use this for load-in, build, tech checks, and wrap. Tap N/A if setup happens on show day or a different day. | Load-in, build, tech checks, wrap. Tap N/A if there is no separate setup day. | index.html:6401 | yes | long — Two sentences of explanation; info icon. |
| Setup Date |  | index.html:6403, cueola-app.js:29936 |  |  |
| Setup Start |  | index.html:6404, cueola-app.js:29937 |  |  |
| Setup Wrap |  | index.html:6405, cueola-app.js:29938 |  |  |
| Load-in notes, tech check order, room access, gear reminders |  | index.html:6408 |  |  |
| Setup Notes |  | index.html:6408, cueola-app.js:29939 |  |  |
| What the show day section is for |  | index.html:6412 |  |  |
| Show Day |  | index.html:6412, index.html:6415 (+2) |  |  |
| Crew call and show start never fill in on their own: enter the real times. The linked fields below follow the call sheet until you type a different value here. | Enter crew call and show start. Other times follow the call sheet until you change them. | index.html:6413 | yes | long, unclear — 'Linked fields' and 'never fill in on their own' are hard to parse; info icon. |
| Crew Call |  | index.html:6416, cueola-app.js:29949 |  |  |
| Arrival details, holding areas, final reminders, day-of timing notes |  | index.html:6423 |  |  |
| Show Notes |  | index.html:6423, cueola-app.js:29954 |  |  |
| What the ready before show checklist is for |  | index.html:6427 |  |  |
| Ready Before Show |  | index.html:6427, cueola-app.js:12051 (+1) |  |  |
| Patch Sheet |  | index.html:6439 |  |  |
| Add rows or upload a CSV/TSV to format into the generator. | Add rows or upload a CSV. | index.html:6440 |  | unclear, jargon — 'format into the generator' is developer talk. |
| Stage Plot |  | index.html:6458, index.html:6465 |  |  |
| Build each system as its own layer: drag gear from the bank, then draw the signal flow between it. | Drag gear from the bank, then draw the signal flow. | index.html:6459 | yes | long — 'Build each system as its own layer' is a second idea; info icon. |
| How the stage plot works |  | index.html:6465 |  |  |
| Current Plot |  | index.html:6468 |  |  |
| Studio A talk show |  | index.html:6471 |  |  |
| Plot Name |  | index.html:6471 |  |  |
| Add another stage plot | Add plot | index.html:6472 |  |  |
| Delete this plot. Instructors and admins only. | Delete plot (instructors only) | index.html:6473 |  | tooltip-only — Permission rule is hidden in a hover tip; show it or say it on tap. |
| Object Bank | Gear bank | index.html:6479 |  | synonym — Helper text calls it 'gear', heading calls it 'Object'. |
| Post what changed, tag the department, and replies stay threaded. Everyone in this session sees it live. | Post what changed and tag a department. Everyone in the show sees it live. | index.html:6498 | yes | long, synonym — 'session' -> show; two-sentence explainer goes behind info icon. |
| Open your profile to change your avatar | Change avatar in your profile | index.html:6505 |  |  |
| Your profile |  | index.html:6505, index.html:6602 |  |  |
| 0 notes |  | index.html:6506 |  |  |
| Search notes & authors… |  | index.html:6507 |  |  |
| Filter |  | index.html:6510 |  |  |
| Newest |  | index.html:6513 |  |  |
| Alerts off | Alerts: Off | index.html:6514 |  | unclear — Toggle reads like a command ('turn alerts off') rather than a state. |
| Every open to-do and checklist item, by person | (delete) | index.html:6515 |  | tooltip-only, duplicate — Same explanation as 4-149 inside the panel; drop the hover tip. |
| Open items |  | index.html:6515 |  |  |
| Tips |  | index.html:6516 |  |  |
| Export PDF |  | index.html:6517, index.html:6552 (+1) |  |  |
| New note |  | index.html:6530 |  |  |
| Make the selected text bold (Cmd/Ctrl+B) | Bold (Cmd/Ctrl+B) | index.html:6534 |  |  |
| Make the selected text italic (Cmd/Ctrl+I) | Italic (Cmd/Ctrl+I) | index.html:6535 |  |  |
| Cross out the selected text | Strikethrough | index.html:6536 |  |  |
| Format the selected text as code | Code | index.html:6537 |  |  |
| &lt;/> |  | index.html:6537 |  |  |
| Insert a bulleted list | Bulleted list | index.html:6539 |  |  |
| • List |  | index.html:6539 |  |  |
| Insert a numbered list | Numbered list | index.html:6540 |  |  |
| 1. List |  | index.html:6540 |  |  |
| Share a note with the crew. Type @ to mention someone. |  | index.html:6542 |  |  |
| Audio uploads cap at 4MB. Use mp3 or m4a for SFX. | Audio up to 4 MB (mp3 or m4a). | index.html:6544 | yes | long — Limit note; one line or info icon. |
| Tag for | Tag | index.html:6547 |  | unclear — 'Tag for' is a dangling fragment. |
| Attach images, audio, or documents |  | index.html:6551 |  |  |
| Attach |  | index.html:6551 |  |  |
| Save this note as a PDF | (delete) | index.html:6552 |  | duplicate — Button already says Export PDF; tip repeats it. |
| **bold** |  | index.html:6554 | yes |  |
| *italic* |  | index.html:6554 | yes |  |
| · ~~strike~~ · lists · ⌘/Ctrl+Enter to post | ~~strike~~ · lists · Cmd/Ctrl+Enter to post | index.html:6554 | yes | long — Cheat-sheet line; info icon. |
| Post the note (Cmd/Ctrl+Enter) | Post (Cmd/Ctrl+Enter) | index.html:6555 |  |  |
| Post |  | index.html:6555 |  |  |
| Write a new note |  | index.html:6560, index.html:6560 |  |  |
| Close (Esc) |  | index.html:6573 |  |  |
| Close image preview |  | index.html:6573 |  |  |
| Attachment preview |  | index.html:6574 |  |  |
| Click anywhere or press Esc to close |  | index.html:6575 |  |  |
| Dismiss this notice |  | index.html:6580 |  |  |
| About session and class codes | About show codes | index.html:6585, index.html:6726 |  | synonym — 'session' -> show. |
| Open Planda Bear | Open planner | index.html:6585, index.html:6594 (+2) |  | brand-for-concept — Brand name stands in for the plain word on a button. |
| Enter the show code to work on the Planda Bear package. | Enter the show code to open the planner. | index.html:6586 |  | brand-for-concept, jargon — 'Planda Bear package' -> planner. |
| Have a different code? |  | index.html:6589, index.html:6730 (+1) |  |  |
| e.g. "Alex" |  | index.html:6591, index.html:6732 |  |  |
| Your Name |  | index.html:6591, index.html:6732 (+2) |  |  |
| This session requires it | Required for this show | index.html:6592, index.html:6733 |  | synonym — 'session' -> show. |
| Class login code | Class code | index.html:6592, index.html:6733 (+3) |  | unclear — Second code next to the show code needs one short name; 'login' adds noise. |
| Fill in both fields. |  | index.html:6593, index.html:6734 |  |  |
| Pick how you show up across Cueola. Signed-in profiles carry it to every device. | Pick your avatar. It follows your sign-in on every device. | index.html:6603 |  | long — 'how you show up across Cueola' is vague. |
| Who owes what | Open items | index.html:6613 |  | synonym — Same panel is called 'Open items' on its button (4-108). |
| Every open to-do and checklist item on the board, grouped by the person it is assigned to. | Open to-dos and checklist items, grouped by person. | index.html:6614 | yes | long — Explainer; info icon. |
| Your Cueola profile |  | index.html:6623 |  |  |
| Admin Panel |  | index.html:6637 |  |  |
| Close the admin panel |  | index.html:6638 |  |  |
| Close admin panel |  | index.html:6638 |  |  |
| Instructor Sign In |  | index.html:6654, dashboard.html:1047 |  |  |
| Sign in with your instructor account to use admin tools inside this rundown. | Sign in to use instructor tools. | index.html:6655 |  | long — Trim. |
| Username |  | index.html:6657, dashboard.html:1050 (+3) |  |  |
| Your username |  | index.html:6658, dashboard.html:1051 |  |  |
| Password |  | index.html:6661, dashboard.html:1054 (+3) |  |  |
| Your password |  | index.html:6662, dashboard.html:1055 |  |  |
| Wrong username or password. |  | index.html:6664, dashboard.html:1060 |  |  |
| Live |  | index.html:6678, cueola-streamdeck.js:666 (+1) |  |  |
| Leave the live show? |  | index.html:6679 |  |  |
| You can come back any time. The rundown stays where it is. |  | index.html:6682 |  |  |
| Pause the show clock |  | index.html:6685 |  |  |
| Pauses it for everyone. Start Show resumes it. |  | index.html:6685 |  |  |
| Stop playout on the Air | Stop playback | index.html:6686 |  | jargon, unclear — 'playout on the Air' is not a phrase students know. |
| Stops what is playing. Output windows stay open. | Stops what is playing. | index.html:6686 |  |  |
| Something did not confirm | Something did not finish | index.html:6691 |  | unclear — 'confirm' is developer wording. |
| Leave anyway |  | index.html:6692 |  |  |
| Leave live options |  | index.html:6694 |  |  |
| Stay live |  | index.html:6695 |  |  |
| Leave live |  | index.html:6696, cueola-app.js:12580 |  |  |
| Cueola could not finish leaving | Could not finish leaving | index.html:6700 |  |  |
| Return to the rundown now. Your rundown and paperwork are saved. |  | index.html:6700 |  |  |
| Return to the rundown |  | index.html:6701 |  |  |
| Ready to go live? |  | index.html:6711 |  |  |
| Join a Session | Join a show | index.html:6726 |  | synonym — 'Session' -> show. |
| Enter the show code your director gave you. |  | index.html:6727 |  |  |
| Join Session | Join show | index.html:6735, cueola-app.js:5285 (+1) |  | synonym — 'Session' -> show. |
| Pick the session and the windows this machine needs. Cueola remembers the set for next time. If a window gets blocked, allow pop-ups for this site once. | Pick the show and the windows this computer needs. | index.html:6743 | yes | long, synonym — Three sentences; 'session' -> show; pop-up tip behind info icon. |
| Talent display on another machine | Prompter on another computer | index.html:6748 |  | synonym — 'Talent display' -> prompter. |
| Copy |  | index.html:6751, dashboard.html:1136 (+1) |  |  |
| Sign in on that device first. Open the link there and the show loads by itself. |  | index.html:6753 |  |  |
| Windows |  | index.html:6755 |  |  |
| Rundown, in this tab |  | index.html:6757 |  |  |
| Talent display (Flowmingo) window | Prompter window | index.html:6758 |  | brand-for-concept, synonym — Brand plus 'talent display' for one concept. |
| Script Operator pop-out, opens itself when Live starts | Prompter controls (opens when live starts) | index.html:6759 |  | long — Checkbox label is a sentence. |
| Planda Bear paperwork, its own window | Planner window | index.html:6760 |  | brand-for-concept — Brand for concept. |
| Playout (Outrangutan), its own window | Playback window | index.html:6761 |  | brand-for-concept — Brand for concept; 'Playout' vs 'Playback'. |
| KeyWi Bird deck setup, its own window | Stream Deck setup window | index.html:6762 |  | brand-for-concept — Brand for concept. |
| Detect displays |  | index.html:6767 |  |  |
| Each window can open on a chosen physical display (Chrome or Edge). The talent display also goes fullscreen there. | Each window can open on its own display (Chrome or Edge). | index.html:6769 | yes | long — Two sentences; info icon. |
| Pick or type a session code. | Pick or type a show code. | index.html:6771 |  | synonym — 'session code' -> show code. |
| Open my show |  | index.html:6772 |  |  |
| Create a saved workspace with your own code. Rows and cues stay free-text so you can build without guided prompts. | Start an empty show with your own show code. | index.html:6779 | yes | long, synonym, jargon — 'workspace', 'Rows', 'guided prompts' are internal ideas. |
| e.g. "Alex Producer" |  | index.html:6780 |  |  |
| e.g. SHOWA |  | index.html:6781 |  |  |
| Workspace Code | Show code | index.html:6781 |  | synonym — 'Workspace Code' -> show code. |
| Share this code with collaborators and Flowmingo. Leave blank to auto-generate. | Share this code with your crew. Leave blank to make one. | index.html:6781 |  | brand-for-concept, long — Flowmingo stands in for the prompter; trim. |
| Show Name |  | index.html:6782, index.html:6795 (+2) |  |  |
| Enter your name. |  | index.html:6783 |  |  |
| Create Shared Blank Slate | Create show | index.html:6784, cueola-app.js:5449 (+1) |  | long, synonym — 'Shared Blank Slate' is three words for one action. |
| Work Locally Only | Work offline | index.html:6785 |  | unclear — 'Locally Only' needs explaining. |
| Locked: only an admin can change this. |  | index.html:6795 |  |  |
| Start Time |  | index.html:6796, dashboard.html:1182 (+1) |  |  |
| Production Clock Frame Rate | Clock frame rate | index.html:6798 |  |  |
| 24 fps |  | index.html:6800 |  |  |
| 30 fps |  | index.html:6801 |  |  |
| 60 fps |  | index.html:6802 |  |  |
| Appearance |  | index.html:6807, cueola-streamdeck.js:4172 |  |  |
| About the .cueola show file |  | index.html:6824 |  |  |
| File |  | index.html:6824 |  |  |
| Export the rundown paperwork as a PDF |  | index.html:6826 |  |  |
| Save this rundown as a .cueola show file. Cmd+S saves it again in place. | Save show file (Cmd+S) | index.html:6827 |  | tooltip-only — Shortcut hidden in a hover tip; keep it short and visible. |
| Save File |  | index.html:6827 |  |  |
| Open a saved .cueola show file. Older .json files still open. | Open a .cueola show file | index.html:6828 |  |  |
| Open File |  | index.html:6828 |  |  |
| Browse backup snapshots saved on this device | Browse backups saved on this device | index.html:6829 |  | jargon — 'snapshots' is developer wording. |
| History |  | index.html:6829 |  |  |
| Apps |  | index.html:6833 |  |  |
| Open the admin controls |  | index.html:6835 |  |  |
| Show the production notes sidebar |  | index.html:6836 |  |  |
| Open the Planda Bear paperwork | Open the planner | index.html:6837 |  | brand-for-concept — Brand for concept. |
| Open the guide |  | index.html:6838 |  |  |
| Cueola workspace | Cueola apps | index.html:6841 |  | synonym — 'workspace' is used elsewhere for the show; the section heading says Apps. |
| Rundown, Planda Bear, Flowmingo, and Outrangutan use the same show data and theme language from here. | Rundown, planner, prompter, and playback share this show's data and theme. | index.html:6841 | yes | long, brand-for-concept — Brand list plus 'theme language'; info icon. |
| Check the whole show before going live: media, links, sound effects, sync, and theme | Check media, links, sound effects, and theme before going live | index.html:6846 |  | jargon — 'sync' is developer wording. |
| Preflight |  | index.html:6846, cueola-app.js:11573 |  |  |
| A timestamped record of cues, media and sync events, and errors | A timestamped record of cues, media, and errors | index.html:6847 |  | jargon — 'sync events' is developer wording. |
| Show Log |  | index.html:6847, index.html:6861 |  |  |
| Cueola v2.2.1 | Cueola v3.0 | index.html:6854 |  |  |
| Clear |  | index.html:6865, cueola-app.js:24329 |  |  |
| Export .txt |  | index.html:6866 |  |  |
| About restore |  | index.html:6874 |  |  |
| Session History | Show history | index.html:6874 |  | synonym — 'Session' -> show. |
| Local recovery snapshots for this session. | Backups saved on this device. | index.html:6875 |  | jargon, synonym — 'recovery snapshots', 'session'. |
| Restore Current Local Copy | Restore this device's copy | index.html:6878 |  | unclear — 'Current Local Copy' is unclear to a student. |
| Export All |  | index.html:6879 |  |  |
| Cueola update ready |  | index.html:6893 |  |  |
| Reload when the operator is at a safe stopping point. | Reload when the director is at a safe stopping point. | index.html:6893 |  | synonym — 'operator' -> director. |
| Reload |  | index.html:6894 |  |  |
| Dismiss update notice |  | index.html:6895 |  |  |
| Later |  | index.html:6895, cueola-app.js:13387 |  |  |
| Go back to the front page |  | index.html:7516 |  |  |
| Back to the front page |  | index.html:7516 |  |  |
| Playback · rundown · prompter · OBS · pages |  | index.html:7518 |  |  |
| Outrangutan Output |  | outrangutan/output.html:6, outrangutan/output.html:75 |  |  |
| Tap or press a key for sound |  | outrangutan/output.html:48 |  |  |
| OUTPUT ERROR: protocol unavailable | OUTPUT ERROR: could not connect | outrangutan/output.html:77 |  | jargon — 'protocol' is developer wording |
| OUTPUT ERROR: session identity missing | OUTPUT ERROR: no show code | outrangutan/output.html:82 |  | jargon — 'session identity' is developer wording |
| OUTPUT REPLACED: close this window |  | outrangutan/output.html:799 |  |  |
| ' + esc(THEME_LABELS[name] \|\| name) + ' |  | outrangutan/outrangutan.js:185 |  |  |
| Skipped " |  | outrangutan/outrangutan.js:540 |  |  |
| Could not import " |  | outrangutan/outrangutan.js:561 |  |  |
| Could not create the matte. |  | outrangutan/outrangutan.js:574 |  |  |
| Matte added. Holds a full-screen | Matte added. Holds a full-screen COLOR until the next take. | outrangutan/outrangutan.js:584 |  | synonym — 'advanced' -> take |
| Keep at least one bank. |  | outrangutan/outrangutan.js:659 |  |  |
| Web Audio unavailable in this browser. | Sound is unavailable in this browser. | outrangutan/outrangutan.js:694 |  | jargon — 'Web Audio' is developer wording |
| Could not decode “ | Could not open “ | outrangutan/outrangutan.js:698 |  | jargon — 'decode' is developer wording |
| ⚠ Another Outrangutan window on this Mac is already driving | Another playback window on this Mac is already running this show. Use that window, or close it and rejoin here. | outrangutan/outrangutan.js:1134 |  | long, brand-for-concept, synonym — 'Outrangutan' stands in for playback; 'session' -> show |
| Kiosk media synced: | Kiosk media saved: … files. | outrangutan/outrangutan.js:1287 |  | jargon — 'synced' -> saved |
| Removed |  | outrangutan/outrangutan.js:1306 |  |  |
| Could not prune the helper cache. | Could not clear the kiosk files. | outrangutan/outrangutan.js:1308 |  | jargon — 'prune', 'helper cache' are developer wording |
| Output window blocked. Allow pop-ups for Outrangutan. | Output window blocked. Allow pop-ups for playback. | outrangutan/outrangutan.js:1373 |  | brand-for-concept — 'Outrangutan' stands in for playback |
| Kiosk helper is not running. Start it, or turn off Kiosk for |  | outrangutan/outrangutan.js:1406 |  |  |
| Assign a display to |  | outrangutan/outrangutan.js:1413 |  |  |
| Launching |  | outrangutan/outrangutan.js:1453 |  |  |
| Keep at least one output. |  | outrangutan/outrangutan.js:1524 |  |  |
| Window Management needs Chrome or Edge. For now, drag output windows to displays manually. |  | outrangutan/outrangutan.js:1535 |  |  |
| Found |  | outrangutan/outrangutan.js:1539 |  |  |
| Display access denied. Allow “Window management” for this site. |  | outrangutan/outrangutan.js:1541 |  |  |
| Cross-surface keys need a linked session. | Keys for other screens need a joined show. | outrangutan/outrangutan.js:2134 |  | jargon — 'Cross-surface' and 'linked session' are developer wording |
| Web MIDI needs Chrome/Edge. |  | outrangutan/outrangutan.js:2172 |  |  |
| MIDI already connected: |  | outrangutan/outrangutan.js:2175 |  |  |
| MIDI access was blocked. Allow it in the site settings. |  | outrangutan/outrangutan.js:2179 |  |  |
| MIDI connected: |  | outrangutan/outrangutan.js:2185 |  |  |
| Pick cue… |  | outrangutan/outrangutan.js:2232, outrangutan/outrangutan.js:2750 |  |  |
| #' + c.num + ' ' + esc(c.name) + ' |  | outrangutan/outrangutan.js:2232, outrangutan/outrangutan.js:2750 |  |  |
| Pick pad… |  | outrangutan/outrangutan.js:2233, outrangutan/outrangutan.js:2751 |  |  |
| Remove mapping | Remove | outrangutan/outrangutan.js:2235, outrangutan/outrangutan.js:2235 |  | tooltip-only — icon-only button; tip carries the label. Keep aria-label, tip may go |
| Web MIDI needs Chrome or Edge. | MIDI needs Chrome or Edge. | outrangutan/outrangutan.js:2238 |  | jargon — "Web MIDI" is an API name |
| No mappings yet. Connect a box and learn its controls. | No MIDI keys set yet. Connect a controller, then press Learn. | outrangutan/outrangutan.js:2239 |  | unclear — "box" and "learn its controls" are unclear |
| ● ' + midi.inputs.size + ' input' + (midi.inputs.size === 1 ? '' : 's') + ' |  | outrangutan/outrangutan.js:2241 |  |  |
| Connect MIDI |  | outrangutan/outrangutan.js:2242 |  |  |
| WebHID needs Chrome or Edge. Stream Deck control is Chromium-only. | Stream Deck needs Chrome or Edge. | outrangutan/outrangutan.js:2253 |  | jargon, long — WebHID / Chromium are dev words; second sentence repeats the first |
| No Stream Deck selected. |  | outrangutan/outrangutan.js:2260 |  |  |
| Could not open the Stream Deck (another app using it?). | Could not open the Stream Deck. Close other apps using it and try again. | outrangutan/outrangutan.js:2261 |  | unclear — question in parentheses instead of a next step |
| This Stream Deck model is not supported yet; no controls or images were sent. | This Stream Deck model isn't supported yet. | outrangutan/outrangutan.js:2265 |  | long — second clause is implementation detail |
| Stream Deck connected: |  | outrangutan/outrangutan.js:2275 |  |  |
| Default device |  | outrangutan/outrangutan.js:2350 |  |  |
| node scripts/kiosk-helper.mjs |  | outrangutan/outrangutan.js:2357, outrangutan/outrangutan.js:2362 | yes | jargon — terminal command shown inline; instructor-only, put behind info |
| Google Chrome not found on this Mac |  | outrangutan/outrangutan.js:2360 |  |  |
| Kiosk helper | Fullscreen helper | outrangutan/outrangutan.js:2365 |  | jargon — "kiosk" is a Chrome term students do not know |
| In use by a kiosk output | In use by an output | outrangutan/outrangutan.js:2366 |  | tooltip-only, jargon — reason a checkbox is disabled hides in a hover tip |
| Use kiosk helper | Use fullscreen helper | outrangutan/outrangutan.js:2366 |  | jargon — kiosk |
| Sync media | Copy media to helper | outrangutan/outrangutan.js:2367 |  | jargon — "sync" is on the banned list |
| Clear unused | Remove unused media | outrangutan/outrangutan.js:2368 |  | unclear — unclear what is cleared |
| ' + esc(kioskSync.running ? ('Syncing media ' + kioskSync.done + ' of ' + kioskSync.total + '…') : (kioskSync.error \|\| '')) + ' | Copying media ' + kioskSync.done + ' of ' + kioskSync.total + '… | outrangutan/outrangutan.js:2371 |  | jargon — sync |
| ' + sym('action.add') + ' Add output |  | outrangutan/outrangutan.js:2408 |  |  |
| ' + sym('content.display') + ' Detect displays |  | outrangutan/outrangutan.js:2409 |  |  |
| Master audio output (control) | Master audio device | outrangutan/outrangutan.js:2410 |  | unclear — "(control)" does not explain anything |
| Standby text (empty = black) | Standby text (blank for black) | outrangutan/outrangutan.js:2411 |  | unclear — "empty = black" is terse code-speak |
| No display set |  | outrangutan/outrangutan.js:2425 |  |  |
| Detect displays to place this on a screen |  | outrangutan/outrangutan.js:2426 |  |  |
| Not responding: the window may be frozen | Not responding | outrangutan/outrangutan.js:2428 |  | tooltip-only — frozen-window warning only on hover over a dot; make it visible status text |
| ' + (o.kiosk ? (open ? 'Relaunch kiosk' : 'Launch kiosk') : (open ? 'Focus' : 'Open')) + ' | ' + (o.kiosk ? (open ? 'Reopen' : 'Open') : (open ? 'Show' : 'Open')) + ' | outrangutan/outrangutan.js:2430 |  | jargon — kiosk; Launch/Relaunch/Focus are three verbs for open |
| Identify |  | outrangutan/outrangutan.js:2431 |  |  |
| ' + esc(statusDetail) + ' | ' + status.toUpperCase() + ' · ' + detail + ' | outrangutan/outrangutan.js:2435 |  | jargon — status line shows "Last ack &lt;commandType>"; ack is banned, drop that part |
| Start the kiosk helper to enable | Needs the fullscreen helper | outrangutan/outrangutan.js:2438 |  | tooltip-only, jargon — why the checkbox is disabled hides in a tip |
| Kiosk (true fullscreen, no Esc) | Fullscreen (no Esc bubble) | outrangutan/outrangutan.js:2438 |  | jargon — kiosk |
| Audio on this output |  | outrangutan/outrangutan.js:2439 |  |  |
| Device |  | outrangutan/outrangutan.js:2441, outrangutan/outrangutan.js:2442 |  |  |
| Kiosk audio plays on that display\'s default device | Fullscreen audio uses that display's default device | outrangutan/outrangutan.js:2441 |  | jargon — kiosk |
| Outputs are where video appears. Add an output, choose its display and audio device, then Open it. Set each cue\'s output in the Inspector. | Outputs are where video appears. Add one, pick its display and audio, then Open it. Set each cue's output in the Inspector. | outrangutan/outrangutan.js:2445 | yes | long — three-sentence helper; move behind info |
| No scenes. Connect to load. | No scenes yet. Connect to OBS to load them. | outrangutan/outrangutan.js:2500 |  | unclear — "Connect to load" is elliptical |
| ' + sym('content.display') + ' OBS Studio |  | outrangutan/outrangutan.js:2502 |  |  |
| obs-websocket v5 |  | outrangutan/outrangutan.js:2502 | yes | jargon — protocol version label; info only |
| ' + (obs.streaming ? 'Stop Stream' : 'Start Stream') + ' |  | outrangutan/outrangutan.js:2506 |  |  |
| ' + (obs.recording ? 'Stop Record' : 'Start Record') + ' |  | outrangutan/outrangutan.js:2507 |  |  |
| host | OBS address (e.g. localhost:4455) | outrangutan/outrangutan.js:2510 |  | unclear — placeholder "host" does not say what to type |
| Enable in OBS: |  | outrangutan/outrangutan.js:2511 |  |  |
| Tools ▸ WebSocket Server Settings |  | outrangutan/outrangutan.js:2511 |  |  |
| . Per-cue OBS actions (switch scene / start-stop record &amp; stream) are set in the cue Inspector; a cue can also fire when OBS switches to a named scene. | Set each cue's OBS action in the Inspector. A cue can also fire when OBS switches to a named scene. | outrangutan/outrangutan.js:2511 | yes | long — run-on helper paragraph |
| Pull | Download | outrangutan/outrangutan.js:2513 |  | unclear — "Pull" is git-speak |
| ' + sym('action.down') + ' Dropbox |  | outrangutan/outrangutan.js:2515 |  |  |
| access token |  | outrangutan/outrangutan.js:2516, outrangutan/outrangutan.js:2518 |  |  |
| /folder (blank = root) | Folder (blank for top level) | outrangutan/outrangutan.js:2516 |  | unclear — "root" is a dev word |
| List media |  | outrangutan/outrangutan.js:2516 |  |  |
| Pull all ' + dbx.files.length + ' | Download all ' + dbx.files.length + ' | outrangutan/outrangutan.js:2517 |  | unclear — Pull |
| Paste a Dropbox |  | outrangutan/outrangutan.js:2518 |  |  |
| (from a Dropbox app). Full OAuth needs a registered redirect (deferred). Files download into local cues (IndexedDB). | Files download into this computer's cues. | outrangutan/outrangutan.js:2518 | yes | jargon, long — OAuth, redirect, IndexedDB, "(deferred)" are dev notes |
| ' + sym('action.settings') + ' Transcode on upload | Convert video on import | outrangutan/outrangutan.js:2521 |  | jargon — transcode |
| Normalize non-web-playable uploads to H.264 MP4 (ffmpeg.wasm) | Convert files the browser can't play (.mov, .mkv…) to MP4 | outrangutan/outrangutan.js:2522 |  | jargon — normalize, H.264, ffmpeg.wasm |
| When on, dropping a .mov/.mkv/etc. transcodes it in-browser (ffmpeg.wasm, ~30&nbsp;MB, lazy-loaded) before it becomes a cue. ProRes/DNxHD &amp; large jobs belong to the future native engine; this always falls back to storing as-is. | Converting happens in the browser and can take a while. If a file can't be converted, it is kept as-is. | outrangutan/outrangutan.js:2523 | yes | jargon, long — ffmpeg.wasm, lazy-loaded, ProRes/DNxHD, "future native engine" |
| Stream Deck orientation proof exported. | Test images exported. | outrangutan/outrangutan.js:2736 |  | jargon — orientation proof is a dev/QA term |
| Key ' + (i + 1) + ' action |  | outrangutan/outrangutan.js:2748 |  |  |
| Key ' + (i + 1) + ' cue |  | outrangutan/outrangutan.js:2750 |  |  |
| Key ' + (i + 1) + ' SFX pad |  | outrangutan/outrangutan.js:2751 |  |  |
| Simulated physical display for key ' + (i + 1) + ' | Key ' + (i + 1) + ' preview | outrangutan/outrangutan.js:2752 |  | long — aria-label reads like a spec |
| No image profile | No preview for this model | outrangutan/outrangutan.js:2752 |  | jargon — image profile |
| KEY ' + (i + 1) + ' |  | outrangutan/outrangutan.js:2753 |  |  |
| ' + esc(sd.model.name) + ' · input only, no image profile | ' + esc(sd.model.name) + ' · buttons only, no key images | outrangutan/outrangutan.js:2757 |  | jargon — image profile |
| ' + esc(item.name) + ' · ' + item.keys + ' keys |  | outrangutan/outrangutan.js:2761 |  |  |
| ' + esc(sample.label) + ' orientation sample | ' + esc(sample.label) + ' test image | outrangutan/outrangutan.js:2763 |  | jargon — orientation sample |
| Connected: ' + esc(sd.model.name) + ' (' + sd.model.keys + ' keys)' : (hasHid ? ' |  | outrangutan/outrangutan.js:2766 |  |  |
| Connect Stream Deck |  | outrangutan/outrangutan.js:2768 |  |  |
| ' + (connected ? 'Connected image profile' : 'Preview model') + ' | Model | outrangutan/outrangutan.js:2770 |  | jargon — "image profile" / "Preview model" are two labels for one select |
| ' + sym('action.export') + 'Export orientation proof | Export test images | outrangutan/outrangutan.js:2770 |  | jargon — orientation proof; QA tool, consider hiding from students |
| Map each key to GO / Stop / Pause / Fade·Stop / PANIC, a cue, or an SFX pad. The preview models the physical display from the same canonical art and verified 180° upload transform used by Classic/MK.2/v2 and XL hardware. It supports rehearsal, but does not replace a physical-device check. | Give each key a job: Take, Stop, Pause, Fade, Panic, a cue, or an SFX pad. The preview is close to the real device, but check on hardware before the show. | outrangutan/outrangutan.js:2772 | yes | long, jargon, synonym — GO must become Take; canonical art / upload transform / model list is dev detail |
| Orientation check | Image check | outrangutan/outrangutan.js:2774 |  | jargon — orientation |
| These cases round-trip through the raw device frame before display simulation. | These test images show how key art will look on the device. | outrangutan/outrangutan.js:2774 | yes | jargon, long — round-trip, raw device frame, display simulation |
| Skipped a command from the rundown as too old. Check that both Macs keep the same clock. |  | outrangutan/outrangutan.js:3007 |  |  |
| Working | Working… | outrangutan/outrangutan.js:3140, outrangutan/outrangutan.js:3248 |  |  |
| The director asks: |  | outrangutan/outrangutan.js:3240 |  |  |
| The director asks: ' + esc(verb) + '. |  | outrangutan/outrangutan.js:3247 |  |  |
| Do it |  | outrangutan/outrangutan.js:3248 |  |  |
| Rundown fired a cue Outrangutan doesn’t have on this device ( | The director took a cue that isn't in this playback ( | outrangutan/outrangutan.js:3280 |  | brand-for-concept — Outrangutan stands in for playback; "device" is vague |
| Rundown fired an SFX pad Outrangutan doesn’t have on this device. | The director fired an SFX pad this playback doesn't have. | outrangutan/outrangutan.js:3287, outrangutan/outrangutan.js:3288 (+1) |  | brand-for-concept — Outrangutan stands in for playback |
| Could not load the Break Room demo media. You can import files into cues by hand. |  | outrangutan/outrangutan.js:3357 |  |  |
| Setting up The Break Room demo playout… | Setting up the Break Room demo… | outrangutan/outrangutan.js:3373 |  | synonym — "playout" is a second word for playback |
| The Break Room demo playout is ready: | The Break Room demo is ready: | outrangutan/outrangutan.js:3427 |  | synonym — playout |
| Keying is unavailable. WebGL failed to start (check that graphics acceleration is on). | Keying is off: graphics acceleration failed to start. Turn it on in browser settings. | outrangutan/outrangutan.js:3674 |  | jargon — WebGL |
| OBS: invalid address. |  | outrangutan/outrangutan.js:3703 |  |  |
| OBS: connection failed. Enable the WebSocket server in OBS. |  | outrangutan/outrangutan.js:3706 |  |  |
| OBS connected. |  | outrangutan/outrangutan.js:3714 |  |  |
| Paste a Dropbox access token first. |  | outrangutan/outrangutan.js:3751 |  |  |
| Dropbox: |  | outrangutan/outrangutan.js:3754, outrangutan/outrangutan.js:3757 |  |  |
| Dropbox list failed (token/CORS). | Dropbox couldn't list files. Check the access token. | outrangutan/outrangutan.js:3759 |  | jargon — CORS |
| Dropbox download failed ( |  | outrangutan/outrangutan.js:3764 |  |  |
| Dropbox pull failed. | Dropbox download failed. | outrangutan/outrangutan.js:3767 |  | synonym — pull vs download |
| Transcoder unavailable. Storing “ | Can't convert here. Keeping “ | outrangutan/outrangutan.js:3797 |  | jargon — transcoder |
| Transcoding “ | Converting “ | outrangutan/outrangutan.js:3799 |  | jargon — transcode |
| Transcoded “ | Converted “ | outrangutan/outrangutan.js:3805 |  | jargon — transcode |
| Transcode failed. Storing as-is. | Couldn't convert. Kept the original file. | outrangutan/outrangutan.js:3807 |  | jargon — transcode |
| No cue to fire. Add media first. | No cue to take. Add media first. | outrangutan/outrangutan.js:3851 |  | synonym — fire vs Take |
| Media missing for " |  | outrangutan/outrangutan.js:3906, outrangutan/outrangutan.js:4022 |  |  |
| Playback blocked by the browser. Press GO again. | The browser blocked playback. Press Take again. | outrangutan/outrangutan.js:3941 |  | synonym — GO becomes Take |
| Stopped. |  | outrangutan/outrangutan.js:4196 |  |  |
| PANIC: all stopped. |  | outrangutan/outrangutan.js:4206 |  |  |
| Fading out… |  | outrangutan/outrangutan.js:4271 |  |  |
| PRE-WAIT · |  | outrangutan/outrangutan.js:4339 |  |  |
| UP | PLAYING | outrangutan/outrangutan.js:4358 |  | unclear — "UP" as a clock state is not obvious |
| PAUSED |  | outrangutan/outrangutan.js:4376 |  |  |
| No cues yet |  | outrangutan/outrangutan.js:4447 |  |  |
| Drop a video, audio, or still-image file below, or click “Add media”. | Drop a video, audio, or still below, or click to add. | outrangutan/outrangutan.js:4447 |  | synonym — names an “Add media” button that is labelled "click to add" (7-300) |
| Failed to play last time. Replace or re-import this media | Didn’t play last time — replace this media | outrangutan/outrangutan.js:4458 |  | tooltip-only — important warning only on hover; make it visible or an info |
| Tied SFX pad: fires with this cue' + (c.sfxDelay > 0 ? ' after ' + c.sfxDelay + 's' : '') + ' | SFX pad plays with this cue' + (c.sfxDelay > 0 ? ' after ' + c.sfxDelay + 's' : '') + ' | outrangutan/outrangutan.js:4458 |  | tooltip-only — hover-only badge meaning |
| Pre-wait: the clock runs before this cue shows | Pre-wait: counts down before this cue plays | outrangutan/outrangutan.js:4458 |  | tooltip-only — hover-only badge meaning |
| XF' + c.xfade + 's | FADE ' + c.xfade + 's | outrangutan/outrangutan.js:4458 |  | unclear — "XF" abbreviation is not taught |
| PRE ' + fmtPre(c.preWait) + ' |  | outrangutan/outrangutan.js:4458 |  |  |
| Select a cue to edit its properties. |  | outrangutan/outrangutan.js:4505 |  |  |
| ' + c.srcW + '×' + c.srcH + ' · ' + aspectLabel(c.srcW, c.srcH) + (c.type === 'image' ? ' · still' : '') + ' |  | outrangutan/outrangutan.js:4508 |  |  |
| ' + opt('hold', 'Hold', c.endAction === 'stop' ? 'hold' : c.endAction) + opt('black', 'Fade', c.endAction) + ' |  | outrangutan/outrangutan.js:4531 |  |  |
| ' + opt('', 'Auto', c.fadeCurve) + opt('linear', 'Linear', c.fadeCurve) + opt('s', 'S', c.fadeCurve) + opt('log', 'Log', c.fadeCurve) + ' |  | outrangutan/outrangutan.js:4537 |  |  |
| ' + opt('0', 'No', c.loop ? '1' : '0') + opt('1', 'Yes', c.loop ? '1' : '0') + ' |  | outrangutan/outrangutan.js:4546, outrangutan/outrangutan.js:4812 |  |  |
| ' + opt('stop', 'Stop', c.endAction) + opt('hold', 'Hold', c.endAction) + opt('black', 'Fade', c.endAction) + ' |  | outrangutan/outrangutan.js:4547 |  |  |
| EQ |  | outrangutan/outrangutan.js:4553 |  |  |
| Compressor |  | outrangutan/outrangutan.js:4559, outrangutan/outrangutan.js:5260 |  |  |
| ' + opt('contain', 'Contain', c.fit) + opt('cover', 'Cover', c.fit) + opt('fill', 'Fill', c.fit) + ' | ' + opt('contain', 'Fit', c.fit) + opt('cover', 'Fill', c.fit) + opt('fill', 'Stretch', c.fit) + ' | outrangutan/outrangutan.js:4564 |  | jargon — Contain/Cover are CSS words |
| ' + opt('off', 'Off', k.mode) + opt('chroma', 'Chroma', k.mode) + opt('luma', 'Luma', k.mode) + opt('alpha', 'Alpha', k.mode) + ' |  | outrangutan/outrangutan.js:4574 |  |  |
| ' + opt('1', 'On', c.armed === false ? '0' : '1') + opt('0', 'Off', c.armed === false ? '0' : '1') + ' | ' + opt('1', 'On', …) + opt('0', 'Off', …) + '  (field label: Active) | outrangutan/outrangutan.js:4585 |  | synonym — field is labelled "Armed"; armed is being retired, use Active or Skip |
| Set cue color |  | outrangutan/outrangutan.js:4587 |  |  |
| No SFX pads yet. Build one on the SFX Board, then tie it here. | No SFX pads yet. Add one on the SFX Board first. | outrangutan/outrangutan.js:4591 |  | unclear — "build" / "tie" are not the words used elsewhere |
| Fires with this cue and fades out when the clip ends or stops. A rundown-linked fire brings it too. | Plays with this cue and fades out when the cue ends. | outrangutan/outrangutan.js:4600 | yes | long, unclear — "rundown-linked fire brings it too" is unclear |
| ' + opt('none', '—', ob.action) + opt('scene', 'Switch scene', ob.action) + opt('startRecord', 'Start record', ob.action) + opt('stopRecord', 'Stop record', ob.action) + opt('startStream', 'Start stream', ob.action) + opt('stopStream', 'Stop stream', ob.action) + ' |  | outrangutan/outrangutan.js:4605 |  |  |
| Scene name |  | outrangutan/outrangutan.js:4606 |  |  |
| (optional) OBS scene | OBS scene that triggers this cue (optional) | outrangutan/outrangutan.js:4607 |  | unclear — placeholder does not say what the scene does |
| ' + sym('action.delete') + ' Delete cue |  | outrangutan/outrangutan.js:4609 |  |  |
| Cue inspector groups | Inspector tabs | outrangutan/outrangutan.js:4614 |  |  |
| Cue name |  | outrangutan/outrangutan.js:4620 |  |  |
| Duration applies the next time this still plays. GO fires the next cue. | Duration applies the next time this still plays. | outrangutan/outrangutan.js:4662 |  | synonym, long — GO becomes Take; second sentence not needed |
| Select a cue to trim and scrub it. |  | outrangutan/outrangutan.js:4786 |  |  |
| Stills have no timeline. Set an optional duration in the Inspector (0 holds until advanced). | Stills have no timeline. Set a duration in the Inspector, or 0 to hold until the next Take. | outrangutan/outrangutan.js:4787 |  | long, synonym — "advanced" is a retired verb |
| Set IN at the playhead | (delete) | outrangutan/outrangutan.js:4793 |  | tooltip-only, duplicate — repeats the visible "Set In" |
| Set In |  | outrangutan/outrangutan.js:4793 |  |  |
| Set OUT at the playhead | (delete) | outrangutan/outrangutan.js:4794 |  | tooltip-only, duplicate — repeats the visible "Set Out" |
| Set Out |  | outrangutan/outrangutan.js:4794 |  |  |
| Clear trim | Clear | outrangutan/outrangutan.js:4795 |  | tooltip-only — button label lives only in the tip; make it visible |
| · IN |  | outrangutan/outrangutan.js:4799 |  |  |
| · OUT |  | outrangutan/outrangutan.js:4799 |  |  |
| Trim in |  | outrangutan/outrangutan.js:4805, outrangutan/outrangutan.js:4908 |  |  |
| Trim out |  | outrangutan/outrangutan.js:4806, outrangutan/outrangutan.js:4909 |  |  |
| Select a pad’s ' + sym('action.more') + ' to trim its sound. |  | outrangutan/outrangutan.js:4896 |  |  |
| ' + sym('media.play') + ' Fire | ' + sym('media.play') + ' Play | outrangutan/outrangutan.js:4900, outrangutan/outrangutan.js:5269 |  | synonym — Fire / GO / Play are three words for one action; Take is for cues, Play for pads |
| IN ' + fmtClock(tin) + ' · OUT ' + fmtClock(tout) + ' · ' + (dur ? fmtClock(dur) : '—') + ' |  | outrangutan/outrangutan.js:4904 |  |  |
| ' + opt('0', 'No', p.loop ? '1' : '0') + opt('1', 'Yes', p.loop ? '1' : '0') + ' |  | outrangutan/outrangutan.js:4914, outrangutan/outrangutan.js:5265 |  |  |
| Drop a sound |  | outrangutan/outrangutan.js:5063 |  |  |
| Edit pad |  | outrangutan/outrangutan.js:5067 |  | tooltip-only — icon button with tip but no aria-label |
| Grow this bank by one pad slot | (delete) | outrangutan/outrangutan.js:5073 |  | tooltip-only, duplicate — repeats the visible "+ Add pad" |
| + Add pad · ' + padCount + '/' + PAD_COUNT_MAX + ' |  | outrangutan/outrangutan.js:5073 |  |  |
| This bank is full. Clear a pad or add a bank, then record. |  | outrangutan/outrangutan.js:5115 |  |  |
| Mic blocked. Allow microphone access for this page to record live SFX. |  | outrangutan/outrangutan.js:5119 |  |  |
| This browser cannot record audio. |  | outrangutan/outrangutan.js:5120 |  |  |
| Recording could not start. |  | outrangutan/outrangutan.js:5125, outrangutan/outrangutan.js:5154 |  |  |
| Recording was empty. Nothing added. |  | outrangutan/outrangutan.js:5135 |  |  |
| Live SFX on pad |  | outrangutan/outrangutan.js:5147 |  |  |
| ● REC |  | outrangutan/outrangutan.js:5168 |  |  |
| Bank name |  | outrangutan/outrangutan.js:5180 |  |  |
| Double-click to rename | (delete) | outrangutan/outrangutan.js:5182 |  | tooltip-only, duplicate — a Rename button already exists (7-216) |
| Rename bank |  | outrangutan/outrangutan.js:5184, outrangutan/outrangutan.js:5184 |  |  |
| Delete bank |  | outrangutan/outrangutan.js:5185, outrangutan/outrangutan.js:5185 |  |  |
| Add a bank | Add bank | outrangutan/outrangutan.js:5187, outrangutan/outrangutan.js:5187 |  |  |
| Record a live sound effect |  | outrangutan/outrangutan.js:5188 |  |  |
| No pads match “' + esc(q) + '”. |  | outrangutan/outrangutan.js:5216 |  |  |
| Fire this pad | Play this pad | outrangutan/outrangutan.js:5223, outrangutan/outrangutan.js:5223 |  | synonym — fire vs play |
| Select a pad’s ' + sym('action.more') + ' to edit it, or drop a sound on an empty pad. |  | outrangutan/outrangutan.js:5241 |  |  |
| ' + (p.key ? keyLabel(p.key) : 'Set key') + ' |  | outrangutan/outrangutan.js:5250 |  |  |
| ' + opt('restart', 'Restart', p.retrigger) + opt('poly', 'Layer', p.retrigger) + opt('toggle', 'Toggle', p.retrigger) + ' |  | outrangutan/outrangutan.js:5251 |  |  |
| Set pad color |  | outrangutan/outrangutan.js:5268 |  |  |
| ' + sym('action.delete') + ' Clear pad |  | outrangutan/outrangutan.js:5269 |  |  |
| press a key… |  | outrangutan/outrangutan.js:5288 |  |  |
| Nothing to print yet. Add a cue or pad first. |  | outrangutan/outrangutan.js:5485 |  |  |
| The print pipeline is not available here. | Printing isn't available in this browser. | outrangutan/outrangutan.js:5486 |  | jargon — pipeline |
| Type |  | outrangutan/outrangutan.js:5496 |  |  |
| Trim |  | outrangutan/outrangutan.js:5496 |  |  |
| Pad |  | outrangutan/outrangutan.js:5507 |  |  |
| Sound |  | outrangutan/outrangutan.js:5507 |  |  |
| Hotkey |  | outrangutan/outrangutan.js:5507 |  |  |
| Outrangutan Show Pack |  | outrangutan/outrangutan.js:5512 |  |  |
| Show pack PDF downloaded. |  | outrangutan/outrangutan.js:5531 |  |  |
| PDF renderer unavailable. Print preview opened - | Couldn't make a PDF. Opened print preview instead. | outrangutan/outrangutan.js:5537 |  | jargon — renderer |
| Could not build the show pack PDF. |  | outrangutan/outrangutan.js:5540 |  |  |
| Nothing to save yet. Add a cue or pad first. |  | outrangutan/outrangutan.js:5547 |  |  |
| Show saved: |  | outrangutan/outrangutan.js:5591 |  |  |
| Could not read that file. |  | outrangutan/outrangutan.js:5612 |  |  |
| Show opened: |  | outrangutan/outrangutan.js:5637 |  |  |
| That show file is missing its manifest. | That show file is damaged. | outrangutan/outrangutan.js:5646 |  | jargon — manifest |
| That file isn’t a valid show file. |  | outrangutan/outrangutan.js:5648, outrangutan/outrangutan.js:5667 |  |  |
| That isn’t an Outrangutan show file. | That isn't a playback show file. | outrangutan/outrangutan.js:5649, outrangutan/outrangutan.js:5668 |  | brand-for-concept — Outrangutan stands in for playback |
| Could not open the show file. |  | outrangutan/outrangutan.js:5662, outrangutan/outrangutan.js:5679 |  |  |
| Select prev / next | Previous / next cue | outrangutan/outrangutan.js:5744 |  |  |
| ↑ / ↓ (fixed) |  | outrangutan/outrangutan.js:5744 |  |  |
| Switch Playback / SFX |  | outrangutan/outrangutan.js:5745 |  |  |
| Tab (fixed) |  | outrangutan/outrangutan.js:5745 |  |  |
| SFX pads |  | outrangutan/outrangutan.js:5746 |  |  |
| per-pad hotkeys (set on the board) |  | outrangutan/outrangutan.js:5746 |  |  |
| Tab |  | outrangutan/outrangutan.js:5766 |  |  |
| ' + sym('content.display') + 'Playback |  | outrangutan/outrangutan.js:5777 |  |  |
| ' + sym('action.grid') + 'SFX Board |  | outrangutan/outrangutan.js:5777 |  |  |
| Switch to 12-hour clock |  | outrangutan/outrangutan.js:5779 |  | tooltip-only — icon-only button; needs an aria-label, tip alone is not enough |
| Pop the program output into a movable window for another display | Open program in its own window | outrangutan/outrangutan.js:5780 |  | tooltip-only, long — visible label already says Pop out program |
| Pop out program window |  | outrangutan/outrangutan.js:5780 |  |  |
| Pop out program |  | outrangutan/outrangutan.js:5780 |  |  |
| Tools |  | outrangutan/outrangutan.js:5786 |  |  |
| Waveform + vectorscope |  | outrangutan/outrangutan.js:5788 |  |  |
| Scopes |  | outrangutan/outrangutan.js:5788 |  |  |
| Manage output windows &amp; displays | (delete) | outrangutan/outrangutan.js:5789 |  | tooltip-only, duplicate — repeats the visible "Outputs" |
| ' + sym('content.display') + 'Outputs |  | outrangutan/outrangutan.js:5789 |  |  |
| Stream Deck control (WebHID) | (delete) | outrangutan/outrangutan.js:5790 |  | tooltip-only, jargon — WebHID; visible label is enough |
| ' + sym('action.grid') + 'Stream Deck |  | outrangutan/outrangutan.js:5790 |  |  |
| MIDI control surfaces (Web MIDI) | (delete) | outrangutan/outrangutan.js:5791 |  | tooltip-only, jargon — Web MIDI; visible label is enough |
| ' + sym('action.grid') + 'MIDI |  | outrangutan/outrangutan.js:5791 |  |  |
| Print the show-day pack: cue sheet + SFX pad map |  | outrangutan/outrangutan.js:5792 |  |  |
| ' + sym('action.export') + 'Print |  | outrangutan/outrangutan.js:5792 |  |  |
| ' + (OBS_UI ? 'OBS · ' : '') + 'Dropbox · Transcode | ' + (OBS_UI ? 'OBS · ' : '') + 'Dropbox · Convert video | outrangutan/outrangutan.js:5793 |  | jargon — transcode |
| ' + sym('action.more') + 'Integrations |  | outrangutan/outrangutan.js:5793 |  |  |
| Lock edits during the show |  | outrangutan/outrangutan.js:5794 |  |  |
| ' + sym('action.lock') + 'Show Lock |  | outrangutan/outrangutan.js:5794 |  |  |
| Keyboard shortcuts |  | outrangutan/outrangutan.js:5795, outrangutan/outrangutan.js:5889 |  |  |
| ' + sym('action.guide') + 'Shortcuts |  | outrangutan/outrangutan.js:5795 |  |  |
| Save this show (with its media) to a file on your computer |  | outrangutan/outrangutan.js:5796 |  |  |
| ' + sym('action.download') + 'Save Show |  | outrangutan/outrangutan.js:5796 |  |  |
| Open a saved show file from your computer |  | outrangutan/outrangutan.js:5797 |  |  |
| ' + sym('action.upload') + 'Open Show |  | outrangutan/outrangutan.js:5797 |  |  |
| About the .ogshow show file |  | outrangutan/outrangutan.js:5799 |  |  |
| Standby that cue | Select that cue | outrangutan/outrangutan.js:5805 |  | state-as-action — STANDBY is a shown state, never a button verb |
| Cue List |  | outrangutan/outrangutan.js:5811 |  |  |
| Drop video / audio / stills here, or click to add |  | outrangutan/outrangutan.js:5814 |  |  |
| Add a solid-color matte cue |  | outrangutan/outrangutan.js:5815 |  |  |
| ' + sym('content.image') + ' Matte |  | outrangutan/outrangutan.js:5815 |  |  |
| Program |  | outrangutan/outrangutan.js:5820, outrangutan/outrangutan.js:5822 |  |  |
| IDLE |  | outrangutan/outrangutan.js:5822 |  |  |
| VU |  | outrangutan/outrangutan.js:5827 |  |  |
| Output level |  | outrangutan/outrangutan.js:5828 |  |  |
| Output |  | outrangutan/outrangutan.js:5828, outrangutan/output.html:46 |  |  |
| WAVEFORM |  | outrangutan/outrangutan.js:5831 |  |  |
| VECTORSCOPE |  | outrangutan/outrangutan.js:5831 |  |  |
| Toggle count direction (elapsed / remaining) | Count up / count down | outrangutan/outrangutan.js:5832 |  | unclear — "Toggle count direction" is dev phrasing |
| Toggle count direction | Count up / count down | outrangutan/outrangutan.js:5832 |  | unclear — same as 7-310 |
| STANDBY |  | outrangutan/outrangutan.js:5832 |  |  |
| DUR 0:00 |  | outrangutan/outrangutan.js:5832 |  |  |
| Prev |  | outrangutan/outrangutan.js:5839 |  |  |
| Play or pause |  | outrangutan/outrangutan.js:5840 |  |  |
| Fade out |  | outrangutan/outrangutan.js:5841, outrangutan/outrangutan.js:5841 |  |  |
| Fade |  | outrangutan/outrangutan.js:5841 |  |  |
| Panic: stop everything |  | outrangutan/outrangutan.js:5844, outrangutan/outrangutan.js:5844 |  |  |
| Inspector |  | outrangutan/outrangutan.js:5848, outrangutan/outrangutan.js:5856 |  |  |
| Bottom panel |  | outrangutan/outrangutan.js:5855 |  |  |
| Clip Editor |  | outrangutan/outrangutan.js:5857, outrangutan/outrangutan.js:5861 |  |  |
| Select a cue to inspect or trim |  | outrangutan/outrangutan.js:5858 |  |  |
| Search pads… |  | outrangutan/outrangutan.js:5870 |  |  |
| Pull audio uploaded to this session’s Production Notes onto empty pads | Add audio from this show's Production Notes to empty pads | outrangutan/outrangutan.js:5870 |  | synonym, tooltip-only — "session" should be show; tip repeats the visible button |
| SFX Board |  | outrangutan/outrangutan.js:5870 |  |  |
| Multi-trigger | Allow overlap | outrangutan/outrangutan.js:5870 |  | unclear — "Multi-trigger" does not say what it does |
| ' + sym('content.note') + 'Import from Production Notes |  | outrangutan/outrangutan.js:5870 |  |  |
| ' + sym('media.stop', 'og-sfx-stop-icon') + 'Stop SFX |  | outrangutan/outrangutan.js:5870 |  |  |
| Pad Inspector |  | outrangutan/outrangutan.js:5876 |  |  |
| MASTER |  | outrangutan/outrangutan.js:5876 |  |  |
| Master level |  | outrangutan/outrangutan.js:5877 |  |  |
| Pad Editor |  | outrangutan/outrangutan.js:5882 |  |  |
| Click a field and press a key to rebind. GO and PANIC are always reachable by keyboard. | Click a field and press a key to change it. Take and Panic always have a key. | outrangutan/outrangutan.js:5890 |  | synonym — GO becomes Take; "rebind" is dev-speak |
| ' + sym('content.display') + ' Outputs &amp; displays |  | outrangutan/outrangutan.js:5892 |  |  |
| ' + sym('action.grid') + ' Stream Deck |  | outrangutan/outrangutan.js:5893 |  |  |
| ' + sym('action.grid') + ' MIDI Control |  | outrangutan/outrangutan.js:5894 |  |  |
| ' + sym('action.more') + ' Integrations |  | outrangutan/outrangutan.js:5895 |  |  |
| ' + sym('action.guide') + ' About this browser |  | outrangutan/outrangutan.js:5898 |  |  |
| MIDI controllers, Stream Deck, and automatic multi-display placement need |  | outrangutan/outrangutan.js:5899 |  |  |
| a desktop Chromium browser (Chrome or Edge) | Chrome or Edge on a computer | outrangutan/outrangutan.js:5899, outrangutan/outrangutan.js:6226 |  | jargon — Chromium |
| ; playback, cues, outputs, and show files all work here. |  | outrangutan/outrangutan.js:5899 |  |  |
| You won’t see this again on this machine. |  | outrangutan/outrangutan.js:5900 |  |  |
| ' + sym('content.image') + ' New Matte |  | outrangutan/outrangutan.js:5902 |  |  |
| Custom color |  | outrangutan/outrangutan.js:5905 |  |  |
| Custom… |  | outrangutan/outrangutan.js:5905 |  |  |
| A matte is a full-screen solid color that holds until you advance. Use it for blackouts, backgrounds, and key fills. It becomes a normal still cue: set duration, fades, or an output in the Inspector. | A matte is a full-screen solid color. Use it for blackouts, backgrounds, or key fills. | outrangutan/outrangutan.js:5907 | yes | long, synonym — "advance" is a retired verb; three sentences |
| ' + sym('content.note') + ' Import from Production Notes |  | outrangutan/outrangutan.js:5911 |  |  |
| Open Outrangutan | Open playback | outrangutan/outrangutan.js:5913, outrangutan/outrangutan.js:5921 |  | brand-for-concept — Outrangutan stands in for playback on a button |
| Enter the show code to run playback for this show. |  | outrangutan/outrangutan.js:5914 |  |  |
| Please fill in both fields. | Enter a show code and your name. | outrangutan/outrangutan.js:5920, outrangutan/outrangutan.js:6392 |  | jargon — "field" is on the banned list; say what is missing |
| No audio uploads found in this session’s Production Notes. | No audio uploads found in this show's Production Notes. | outrangutan/outrangutan.js:6168 |  | synonym — session should be show |
| Audio uploaded to this session’s Production Notes board. Each Add drops the file on the first empty SFX pad; a full bank rolls into a fresh one. | Audio from this show's Production Notes. Add puts each file on the next empty pad. | outrangutan/outrangutan.js:6172 | yes | long, synonym — session; bank-rollover detail can go behind info |
| Add all ' + items.length + ' |  | outrangutan/outrangutan.js:6175 |  |  |
| Adding… |  | outrangutan/outrangutan.js:6178 |  |  |
| Could not add “ |  | outrangutan/outrangutan.js:6183 |  |  |
| All added |  | outrangutan/outrangutan.js:6195 |  |  |
| Not you? Switch |  | outrangutan/outrangutan.js:6287 |  |  |
| Joined session | Joined show | outrangutan/outrangutan.js:6426 |  | synonym — session should be show |
| Cueola · Script Operator |  | script-operator.html:7 |  |  |
| Cueola Script Operator |  | script-operator.html:23 |  |  |
| Cu |  | script-operator.html:23 |  |  |
| Close Script Operator |  | script-operator.html:31, script-operator.html:31 |  |  |
| Script Operator disconnected |  | script-operator.html:40 |  |  |
| The Cueola Live window is not responding. Controls are paused. |  | script-operator.html:41 |  |  |
| Reconnect |  | script-operator.html:45 |  |  |
| Waiting for state | Connecting… | script-operator.html:56 |  | jargon — 'state' is developer wording. |
| The live Flowmingo script appears here. | The live prompter script appears here. | script-operator.html:58 |  | brand-for-concept — Brand for concept. |
| Script actions |  | script-operator.html:59 |  |  |
| Clear script |  | script-operator.html:63, script-operator.html:63 |  |  |
| Script Operator controls |  | script-operator.html:73 |  |  |
| Script Operator control groups |  | script-operator.html:75 |  |  |
| Cue and On Air |  | script-operator.html:80 |  |  |
| Cue & On Air |  | script-operator.html:82 |  |  |
| Clocks & Alerts |  | script-operator.html:86 |  |  |
| Display & Theme |  | script-operator.html:90 |  |  |
| Play |  | script-operator.html:107 |  |  |
| Screen |  | script-operator.html:119, cueola-app.js:17331 (+1) |  |  |
| Hide UI | Hide controls | script-operator.html:122, cueola-app.js:17334 (+1) |  | jargon — 'UI' is developer wording. |
| Full | Fullscreen | script-operator.html:124, cueola-app.js:17336 (+1) |  | unclear — 'Full' alone is ambiguous. |
| Show the NEXT and HOLDING row chips along the bottom of the talent screen | Shows the NEXT and STANDBY cue chips on the prompter | script-operator.html:126, cueola-app.js:17338 (+1) | yes | tooltip-only, synonym — 'row' -> cue; hover-only explanation of a toggle. |
| Row info on talent | Cue info on prompter | script-operator.html:126, cueola-app.js:17338 (+1) |  | synonym — 'Row' -> cue; 'talent' -> prompter. |
| Cue Now |  | script-operator.html:135, cueola-app.js:18187 |  |  |
| Cue Next |  | script-operator.html:138, cueola-app.js:18188 |  |  |
| Find in script · Enter cues the match | Find in script · Enter jumps to the match | script-operator.html:142 |  |  |
| Find in script |  | script-operator.html:142 |  |  |
| Cue Flowmingo to the next line containing this text | Jump the prompter to the next line with this text | script-operator.html:143 |  | brand-for-concept — Brand for concept. |
| Find |  | script-operator.html:143, cueola-app.js:18192 |  |  |
| On Air |  | script-operator.html:148, cueola-app.js:13380 (+2) |  |  |
| NTSC Bars |  | script-operator.html:154 |  |  |
| Scrub |  | script-operator.html:160, cueola-app.js:18207 |  |  |
| Cue prompter back |  | script-operator.html:162, cueola-app.js:18210 |  |  |
| Cue prompter position |  | script-operator.html:163, cueola-app.js:18211 |  |  |
| Cue prompter forward |  | script-operator.html:164, cueola-app.js:18212 |  |  |
| Punch in from this position | Play from here | script-operator.html:165 |  | unclear — 'Punch in' is not a term students know. |
| Clock and alert preview |  | script-operator.html:173 |  |  |
| Clock |  | script-operator.html:174, script-operator.html:178 (+1) |  |  |
| Off |  | script-operator.html:175, cueola-streamdeck.js:3731 |  |  |
| Question in chat |  | script-operator.html:176, cueola-app.js:19149 (+1) |  |  |
| Time |  | script-operator.html:180, cueola-app.js:13532 (+2) |  |  |
| To Time | Countdown | script-operator.html:182 |  | synonym — Button says 'To Time' but its field says 'Count to'. |
| Hide |  | script-operator.html:183, cueola-identity.js:1632 (+1) |  |  |
| Duration (min) |  | script-operator.html:186 |  |  |
| Count to |  | script-operator.html:187, cueola-app.js:19785 |  |  |
| Wrap Up |  | script-operator.html:192, cueola-app.js:19789 |  |  |
| Wrap 10 |  | script-operator.html:194 |  |  |
| Wrap 5 |  | script-operator.html:195 |  |  |
| Send | Send wrap | script-operator.html:196 |  |  |
| Wrap in (min) |  | script-operator.html:198, cueola-app.js:19795 |  |  |
| Alerts |  | script-operator.html:202, cueola-app.js:19798 |  |  |
| Question |  | script-operator.html:204, cueola-app.js:19149 |  |  |
| Drop the clock, wrap, question, and slates in one go | Clears the clock, wrap, question, and slates | script-operator.html:206, cueola-app.js:19801 |  |  |
| Clear all overlays |  | script-operator.html:207 |  |  |
| Paste a chat question · Enter pushes · Esc clears |  | script-operator.html:210, cueola-app.js:19805 |  |  |
| Question for the talent |  | script-operator.html:210, cueola-app.js:19806 |  |  |
| Push this question to the talent as a QUESTION card | Shows the question to the talent as a card | script-operator.html:214, cueola-app.js:19808 |  |  |
| Push card |  | script-operator.html:215, cueola-app.js:19808 |  |  |
| Paste this question INTO the script at the prompter's current position — the talent reads it in the natural flow | Inserts the question into the script where the prompter is now | script-operator.html:217, cueola-app.js:19809 |  | long — Long hover tip with a dash clause. |
| Into script |  | script-operator.html:218, cueola-app.js:19809 |  |  |
| Overlay size |  | script-operator.html:222, cueola-app.js:19812 |  |  |
| Make overlay smaller |  | script-operator.html:224 |  |  |
| Make overlay larger |  | script-operator.html:226 |  |  |
| Display |  | script-operator.html:234, cueola-app.js:17300 (+2) |  |  |
| Text alignment |  | script-operator.html:249 |  |  |
| Formatting & Markers |  | script-operator.html:273 |  |  |
| Formatting is inserted into the script at the current selection. | Inserted at the cursor in the script. | script-operator.html:274 |  |  |
| Bold |  | script-operator.html:276, cueola-app.js:17369 (+1) |  |  |
| Bold (Cmd B) |  | script-operator.html:276 |  |  |
| Italic |  | script-operator.html:277, cueola-app.js:17370 |  |  |
| Italic (Cmd I) |  | script-operator.html:277 |  |  |
| Stop | Stop here | script-operator.html:280, cueola-app.js:8593 (+1) |  | unclear — Inserts a [STOP HERE] marker; 'Stop' reads like a transport button. |
| New paragraph | Paragraph | script-operator.html:281 |  | synonym — Tip says 'New paragraph', button says 'Newline'. |
| Newline | Paragraph | script-operator.html:281 |  | synonym — Match the tip. |
| Panel Text |  | script-operator.html:288, cueola-app.js:17379 |  |  |
| Sizes this control panel and the script editor for your reading distance. The talent's prompter size is set in the Display section above. | Sizes this panel for your reading distance. | script-operator.html:289 | yes | long — Two sentences; info icon. |
| Smaller panel text |  | script-operator.html:292 |  |  |
| Panel text size |  | script-operator.html:293 |  |  |
| Larger panel text |  | script-operator.html:294 |  |  |
| Clear the live Flowmingo script? This immediately pushes an empty script to the talent display. | Clear the prompter script? Talent will see a blank prompter right away. | script-operator.js:390 |  | brand-for-concept, long — Flowmingo stands in for prompter; "pushes" is dev-speak |

## Developer-only strings

252 strings are error labels (`containError`), show-log lines, or template fragments the extractor picked up; they were not rewritten. Show-log lines will be re-read once the glossary is approved so the log speaks the same words as the screens.
