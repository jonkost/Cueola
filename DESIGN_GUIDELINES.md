# Cueola Design Guidelines

> The reference standard for all UI work in Cueola. New screens, components, and
> restyles should be checked against this document before they ship. Based on
> Apple's Human Interface Guidelines — Design principles:
> https://developer.apple.com/design/human-interface-guidelines/design-principles

Cueola is a live show-calling tool. People use it under time pressure, often on a
second screen during a production. Every design decision serves one goal: **the
operator can read the right thing at a glance and act without hesitation.**

---

## The three foundational principles

### 1. Clarity
Text is legible at every size, icons are precise and unambiguous, and the
interface foregrounds the content — the cues, the clock, the script.

- Type stays readable at the live operator's viewing distance. Production-critical
  numbers (clocks, durations) use the tabular monospace face so digits don't shift.
- Color carries meaning consistently: each department keeps its color
  (`--video`, `--green` audio, `--red` playback, `--yellow` gfx, `--purple`
  lighting, `--cyan` script) everywhere it appears — build, live, and PDF.
- Negative space and alignment do the work that borders and boxes otherwise would.
  Don't add chrome to separate things that spacing already separates.

### 2. Deference
The UI defers to the content. Chrome is quiet so the show is loud.

- No decoration that competes with the cues. Gradients, glows, and shadows are
  used sparingly and only to establish hierarchy or depth — never as ornament.
  (The front page wordmark and chrome are intentionally flat.)
- The "NOW" row and the running clock are the loudest things on the live screen.
  Everything else calms down around them.
- Motion is subtle and purposeful (state changes, focus), never attention-seeking.

### 3. Depth
Distinct layers and realistic motion convey hierarchy and help people understand
where they are.

- Modals, the admin panel, and Planda Bear sit on clear layers (glass/blur, a
  dimmed scrim) so the user always knows what's primary.
- Transitions communicate relationships — a panel slides from the side it lives
  on; back/next move the expected direction.

---

## Working principles (how those show up in Cueola)

- **Consistency.** A control that looks the same behaves the same. The same
  cue-cell box style is used in build and live. The same production-clock face is
  used in both bottom bars. The Cueola ↔ Planda Bear nav buttons mirror each
  other. Reuse a token/class before inventing a new one.
- **Feedback.** Every action gets an immediate, legible response — toasts for
  saves, the ON AIR pulse, live presence, sync dots. Never leave the operator
  guessing whether something registered.
- **Direct manipulation & user control.** People drive the show; the app doesn't
  surprise them. Destructive or outward actions confirm first. The show caller
  controls the shared clock; followers mirror.
- **Accessibility is not optional.** Maintain contrast (WCAG AA where feasible),
  honor `forced-colors`, keep focus-visible outlines, give icon-only buttons
  `aria-label`/`title`, and keep hit targets comfortable.

---

## Concrete house rules

These make the principles enforceable in this codebase.

1. **Tokens over hardcoded values.** Use the CSS custom properties
   (`--accent`, `--text`, `--s1..s4`, `--border`, department colors, `--r`,
   `--mono`, `--syne`, `--sans`). Hardcoded hex is reserved for the deliberately
   theme-independent LED clock faces.
2. **Theme-aware always.** Anything branded or accented must follow the active
   theme via `var(--accent)` — including the two-tone wordmarks
   (Cu**e** / **ola**, Plan / **da Bear**). Inside Planda Bear, `--accent` is the
   Planda theme accent; outside it's the app theme.
3. **One type scale.** Display = Syne (`--syne`), body/labels = `--sans`,
   numbers/codes = `--mono`. Don't introduce one-off font sizes when an existing
   step fits.
4. **Spacing rhythm.** Prefer the existing gaps/paddings already used by sibling
   components over new arbitrary values. Cells fill their row; content centers
   when the box is taller than its text.
5. **Iconography.** Use the SF Symbol system (`assets/sf-symbols.css`,
   `data-symbol="..."` / `sfIcon()`), not ad-hoc emoji or inline SVG, for UI
   affordances. Emoji are allowed only as brand glyphs (🐨 / 🐼 / 🦩).
6. **Quiet by default, loud on purpose.** Reserve high-contrast color, motion, and
   glow for state that matters live (now/next, warnings, running clock).
7. **Capsule primaries.** The confirming action in a modal or sheet is a capsule
   (`border-radius:999px`) — `.btn-primary`, `.btn-secondary`, `.save-btn`,
   dashboard `.btn-full`, and the toolbar's one prominent action (`.tbtn-live`)
   all follow it, as the entry dock always has. Toolbar utility buttons stay at
   `--ui-radius-control` (12px); panels use `--ui-radius-group`/`--ui-radius-panel`
   (16/22px). Prefer the concentric habit: inner radius + padding ≈ outer radius.
8. **44px is a touch rule, honored via `pointer:coarse`.** Desktop keeps its
   compact menu/toolbar density on purpose (a mac-app idiom — 34–40px rows and
   toolbar buttons); the `@media(pointer:coarse)` blocks in index.html and
   dashboard.html lift every interactive control to a 44px minimum target on
   iPad. New controls must appear in (or inherit from) those blocks. Known
   exemption: dense chip clouds (`.chip`/`.cc-chip`) stay compact — spacing
   keeps them separable.
9. **Spacing and motion ride tokens.** New CSS uses the 8px-grid spacing steps
   (`--sp-1`…`--sp-6`, 4→32px; `--s1..s4` are surface *colors*, never spacing)
   and the duration tokens (`--dur-fast/normal/slow` with `--ease`). Existing
   hardcoded values migrate opportunistically — don't invent new one-offs.
   Every page carries a global `prefers-reduced-motion: reduce` kill-block
   (index.html, dashboard.html, script-operator.css) — keep it true for any
   new page.
10. **Sheet & alert anatomy.** Cueola's "sheet" is the centered glass `.modal`
    (desktop idiom — no grabber/detents): title, body, then `.modal-actions`
    with secondary/Cancel leading and ONE capsule primary trailing. At most
    three actions, labeled with verbs (Save, Restore, Done — never "OK").
    A casual dismissal (Esc, click-outside) must never destroy unsaved work
    (`data-esc-hold` exists for exactly that). Outrangutan sheets follow the
    same shape with `.og-sheet-head` + trailing Done.
11. **The info pattern.** Explaining a surface takes a bare accent-colored
    "i" glyph (`.info-btn`, no ring or circle around it, owner decision
    2026-07-21) that opens the shared `#infoPop` popover (`toggleInfoPop`):
    a short, plain-language explanation plus a "Learn more" deep link into
    the matching Learning Hub lesson (`openLearningHub('<id>')`). Never a
    modal, never navigation; copy lives in the `INFO_POPS` registry (single
    source). Coarse pointers still get a 32px hit target via padding.

---

## The inspector standard (control panels)

Modeled on the Keynote/Pages inspector; the Script Op drawer is the reference
implementation (`.insp-head/.insp-tabs/.insp-tab/.insp-caption/.insp-pane`).
When a panel holds more than one group of controls:

1. **Icon tabs on top** pick ONE group at a time — never a stacked accordion.
   A small uppercase caption under the tabs names the active group.
2. **One flat page per group.** Section headers are bold text; sections are
   separated by hairlines (`color-mix(in srgb, var(--text) 8-10%, transparent)`),
   never by nested bordered cards. Controls sit directly on the panel background.
3. **No boxes in boxes.** A panel gets ONE level of container chrome (the panel
   itself). If a section "needs" a border, it probably needs a header and a
   hairline instead.
4. Remember the active tab (`localStorage`) so panels reopen where the
   operator works.

---

## Steer toward a mac/iPad-app feel

Cueola should feel like a native Apple app that happens to run in a browser —
that is the owner's standing direction for 2.1+.

- **Desktop density, touch reach.** Pointer-precision surfaces keep tight,
  Keynote-like toolbars and menu rows; `pointer:coarse` lifts targets to 44px.
  Never design a screen that only works at one of the two densities.
- **System materials and shapes.** Frosted glass panels (`--glass-*`/
  `--liquid-*` tokens, always with the `-webkit-backdrop-filter` twin),
  capsule primaries, SF Symbols, and the inspector standard above — not web
  cards, hamburger menus, or underlined links.
- **Files behave like documents.** `.cueola`/`.ogshow` open by double-click in
  the installed app (manifest `file_handlers` + launchQueue), Cmd+S saves back
  into the opened file, and exports land as real files. System-wide Finder
  document icons are native-wrapper (3.0) territory — don't fake them.
- **Honor the platform.** `prefers-reduced-motion`, `prefers-color-scheme`
  awareness where it applies, safe-area insets on installed displays, and no
  browser-chrome dependence: everything reachable inside the app's own UI.

## Pre-ship checklist

- [ ] Reads clearly at a glance under time pressure?
- [ ] Uses theme tokens; follows the selected theme?
- [ ] Consistent with the existing equivalent in build/live/Planda Bear?
- [ ] Gives immediate feedback for every action?
- [ ] Contrast, focus states, `aria-label`s, `forced-colors` handled?
- [ ] No decoration competing with the cues/clock?
- [ ] Primary action is a capsule; actions are verb-labeled, ≤3 per alert?
- [ ] 44px target on `pointer:coarse` (in or inheriting the coarse block)?
- [ ] Animations die under `prefers-reduced-motion`?
- [ ] New spacing/durations use `--sp-*` / `--dur-*` tokens?
