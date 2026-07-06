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

## Pre-ship checklist

- [ ] Reads clearly at a glance under time pressure?
- [ ] Uses theme tokens; follows the selected theme?
- [ ] Consistent with the existing equivalent in build/live/Planda Bear?
- [ ] Gives immediate feedback for every action?
- [ ] Contrast, focus states, `aria-label`s, `forced-colors` handled?
- [ ] No decoration competing with the cues/clock?
