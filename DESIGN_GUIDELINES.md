# Cueola Design Guidelines

> The reference standard for all UI work in Cueola. New screens, components, and
> restyles should be checked against this document before they ship. Based on
> Apple's Human Interface Guidelines, Design principles:
> https://developer.apple.com/design/human-interface-guidelines/design-principles

Cueola is a live show-calling tool. People use it under time pressure, often on a
second screen during a production. Every design decision serves one goal: **the
operator can read the right thing at a glance and act without hesitation.**

---

## The three foundational principles

### 1. Clarity
Text is legible at every size, icons are precise and unambiguous, and the
interface foregrounds the content: the cues, the clock, the script.

- Type stays readable at the live operator's viewing distance. Production-critical
  numbers (clocks, durations) use the tabular monospace face so digits don't shift.
- Color carries meaning consistently: each department keeps its color
  (`--video`, `--green` audio, `--red` playback, `--yellow` gfx, `--purple`
  lighting, `--cyan` script) everywhere it appears: build, live, and PDF.
- Negative space and alignment do the work that borders and boxes otherwise would.
  Don't add chrome to separate things that spacing already separates.

### 2. Deference
The UI defers to the content. Chrome is quiet so the show is loud.

- Chrome never uses glows or drop shadows, period. Not on modals, cards, toasts,
  popovers, buttons, badges, or hover states. No gradient painted to imitate a
  shadow either.
- Depth comes from the liquid glass material: a translucent layered fill, a
  backdrop blur with saturation, and a hairline rim border. See the material
  spec below.
- Status and LED states (ON AIR, sync dots, record) are sharp: solid bright
  fill, a 1px rim, and an optional opacity pulse. Never a soft outer glow. The
  state stays loud with zero blur.
- The "NOW" row and the running clock are the loudest things on the live screen.
  Everything else calms down around them.
- Motion is subtle and purposeful (state changes, focus), never attention-seeking.

### 3. Depth
Distinct layers and realistic motion convey hierarchy and help people understand
where they are.

- Modals, the admin panel, and Planda Bear sit on clear layers (the liquid glass
  material over a dimmed scrim) so the user always knows what's primary. The
  layer reads as glass because you can see through it, not because it casts a
  shadow.
- Transitions communicate relationships: a panel slides from the side it lives
  on; back/next move the expected direction.

---

## The liquid glass material

This is the one surface material for app chrome. Every floating panel, modal,
toolbar, popover, and tooltip is built from it.

**Tokens**

| Token | Role |
| --- | --- |
| `--liquid-fill` | Standard translucent surface fill |
| `--liquid-fill-strong` | Denser fill for surfaces over busy content |
| `--liquid-edge` | Hairline rim border color (1px) |
| `--liquid-edge-strong` | Rim for surfaces that need a firmer outline |
| `--liquid-blur` | Backdrop blur radius (26px) |
| `--liquid-saturation` | Backdrop saturation boost (155%) |
| `--ui-radius-control` | 12px, buttons and inputs |
| `--ui-radius-group` | 16px, grouped rows and cards |
| `--ui-radius-panel` | 22px, panels, modals, sheets |

**Usage rules**

1. A glass surface is exactly: `background` from a `--liquid-fill` token,
   `backdrop-filter: blur(var(--liquid-blur)) saturate(var(--liquid-saturation))`
   (always with the `-webkit-` twin), and a 1px border from a `--liquid-edge`
   token. Nothing else creates elevation.
2. A slightly brighter top edge is acceptable as a 1px inset highlight. That is
   a rim, not a glow; keep it to a hairline.
3. The old `--liquid-shadow` / `--liquid-shadow-raised` tokens are retired to
   transparent no-ops, like the `--shadow-*` family. Do not reintroduce
   `box-shadow` elevation through them or around them.
4. Radius comes only from the three `--ui-radius-*` steps. Prefer the concentric
   habit: inner radius + padding roughly equals outer radius.
5. **Floating-bubble chrome.** Panels and toolbars float as rounded glass
   bubbles with breathing room around them, not pinned edge-to-edge slabs.
   Where a surface must hint at scrolled-under content (sticky headers), use a
   hairline border plus a subtle glass tint, never a shadow.

---

## Working principles (how those show up in Cueola)

- **Consistency.** A control that looks the same behaves the same. The same
  cue-cell box style is used in build and live. The same production-clock face is
  used in both bottom bars. The Cueola and Planda Bear nav buttons mirror each
  other. Reuse a token/class before inventing a new one.
- **Feedback.** Every action gets an immediate, legible response: toasts for
  saves, the ON AIR pulse, live presence, sync dots. Never leave the operator
  guessing whether something registered.
- **Direct manipulation & user control.** People drive the show; the app doesn't
  surprise them. Destructive or outward actions confirm first. The show caller
  controls the shared clock; followers mirror.
- **Accessibility is not optional.** Maintain contrast (WCAG AA where feasible),
  honor `forced-colors`, keep focus-visible outlines, give icon-only buttons
  `aria-label` plus a `data-tip`, and keep hit targets comfortable.

---

## Concrete house rules

These make the principles enforceable in this codebase.

1. **Tokens over hardcoded values.** Use the CSS custom properties
   (`--accent`, `--text`, `--s1..s4`, `--border`, department colors, `--r`,
   `--mono`, `--syne`, `--sans`, the `--liquid-*` material set). Hardcoded hex
   is reserved for the deliberately theme-independent LED clock faces.
2. **Theme-aware always.** Anything branded or accented must follow the active
   theme via `var(--accent)`, including the two-tone wordmarks
   (Cu**e** / **ola**, Plan / **da Bear**). Inside Planda Bear, `--accent` is the
   Planda theme accent; outside it's the app theme.
3. **One type scale.** Display = Syne (`--syne`), body/labels = `--sans`,
   numbers/codes = `--mono`. Don't introduce one-off font sizes when an existing
   step fits. Timecode always uses tabular numerals.
4. **Spacing rhythm.** Prefer the existing gaps/paddings already used by sibling
   components over new arbitrary values. Cells fill their row; content centers
   when the box is taller than its text.
5. **Iconography.** Use the SF Symbol system (`assets/sf-symbols.css`,
   `data-symbol="..."` / `sfIcon()`), not ad-hoc emoji or inline SVG, for UI
   affordances. One close glyph everywhere. Emoji are allowed only as brand
   glyphs (🐨 / 🐼 / 🦩) and in deliberately celebratory moments (HYPE), never
   in functional copy.
6. **Quiet by default, loud on purpose.** Reserve high-contrast color and motion
   for state that matters live (now/next, warnings, running clock). Loud state
   is sharp: solid fill, rim, opacity pulse. It is never a soft glow or shadow.
7. **Capsule primaries.** The confirming action in a modal or sheet is a capsule
   (`border-radius:999px`): `.btn-primary`, `.btn-secondary`, `.save-btn`,
   dashboard `.btn-full`, and the toolbar's one prominent action (`.tbtn-live`)
   all follow it, as the entry dock always has. Toolbar utility buttons stay at
   `--ui-radius-control` (12px); panels use `--ui-radius-group`/`--ui-radius-panel`
   (16/22px).
8. **44px is a touch rule, honored via `pointer:coarse`.** Desktop keeps its
   compact menu/toolbar density on purpose (a mac-app idiom: 34 to 40px rows and
   toolbar buttons); the `@media(pointer:coarse)` blocks in index.html and
   dashboard.html lift every interactive control to a 44px minimum target on
   iPad. New controls must appear in (or inherit from) those blocks. Known
   exemption: dense chip clouds (`.chip`/`.cc-chip`) stay compact, spacing
   keeps them separable.
9. **Spacing and motion ride tokens.** New CSS uses the 8px-grid spacing steps
   (`--sp-1`…`--sp-6`, 4→32px; `--s1..s4` are surface *colors*, never spacing)
   and the duration tokens (`--dur-fast/normal/slow` with `--ease`). Existing
   hardcoded values migrate opportunistically; don't invent new one-offs.
   Every page carries a global `prefers-reduced-motion: reduce` kill-block
   (index.html, dashboard.html, script-operator.css). Keep it true for any
   new page.
10. **Sheet & alert anatomy.** Cueola's "sheet" is the centered glass `.modal`
    (desktop idiom, no grabber/detents): title, body, then `.modal-actions`
    with secondary/Cancel leading and ONE capsule primary trailing. At most
    three actions, labeled with verbs (Save, Restore, Done, never "OK").
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
12. **No inline styles in generated markup.** JS that builds DOM sets
    data-state classes and lets the stylesheet style them.

---

## The tooltip standard

One engine, one look, everywhere.

- **The engine.** Any control gets `data-tip="plain text"`. A single reusable
  `.ui-float-tip` glass chip (liquid glass material, small radius) appears near
  the element after a 150ms hover or focus delay, and hides on leave, blur, or
  Esc. Touch users get it on long-press. There is exactly one engine, in
  cueola-app.js; do not add CSS-only tooltip chips or per-surface variants.
- **Native `title` is converted.** Interactive controls carry `data-tip`, not
  `title` (the engine replaced roughly 135 of them). Keep `title` only where
  native semantics matter (for example an `iframe` title). `aria-label` stays
  for accessibility; `data-tip` is the visible label.
- **Copy rules.** Plain language, sentence case, no jargon, no abbreviations
  the most basic user wouldn't know. Verb-first for actions: "Start the show
  clock", not "Init clk" or "Show clock init". One short sentence; if it needs
  two, it probably needs the info pattern instead.
- **When to use the info glyph instead.** Tooltips name a control. When a whole
  surface or concept needs explaining (what a panel is for, how a workflow
  runs), use the `.info-btn` + `#infoPop` pattern from house rule 11, which can
  hold a paragraph and a Learn more link.

---

## Professional copy checklist

Cueola copy reads like a calm broadcast tool, not a chatbot.

- No emoji in functional UI copy: chips, buttons, labels, toasts, tooltips.
  (Brand mascots and the celebratory HYPE moment are the sanctioned exceptions.)
- No exclamation marks. No "Oops", no apologies, no chatty filler.
- Toasts are short and factual: "Rundown saved", "Cue 14 skipped". State what
  happened, nothing else.
- Sentence case for labels and tooltips; verbs for actions.
- No em dashes or en dashes anywhere in app copy. Use a period, colon, comma,
  or parentheses.

---

## Sanctioned exceptions (the short list)

The no-glow, no-shadow rule has exactly these carve-outs. Anything not listed
here follows the rule.

1. **Focus and selection rings**, including `forced-colors` treatments. These
   are accessibility function, not decoration.
2. **Video-overlay legibility shadows.** Text sitting over video or media
   (prompter output overlays, avatar initials over photos) may carry a
   text-shadow so it stays readable. App chrome text never gets one.
3. **Print and paper preview.** The export preview's paper skeuomorphism (page
   edge, paper look) stays; it is depicting a physical artifact.
4. **KeyWi deck hardware simulation.** The bezel and keycap art inside its
   canvas/frame are an illustration of a physical device, not UI chrome.
5. **Inset state bars and lit-edge sheens.** These are fills, not shadows;
   they ride tokens and stay.

---

## The inspector standard (control panels)

Modeled on the Keynote/Pages inspector; the Script Op drawer is the reference
implementation (`.insp-head/.insp-tabs/.insp-tab/.insp-caption/.insp-pane`).
When a panel holds more than one group of controls:

1. **Icon tabs on top** pick ONE group at a time, never a stacked accordion.
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

Cueola should feel like a native Apple app that happens to run in a browser.
That is the owner's standing direction for 2.1+.

- **Desktop density, touch reach.** Pointer-precision surfaces keep tight,
  Keynote-like toolbars and menu rows; `pointer:coarse` lifts targets to 44px.
  Never design a screen that only works at one of the two densities.
- **System materials and shapes.** The liquid glass material (`--liquid-*`
  tokens, always with the `-webkit-backdrop-filter` twin), capsule primaries,
  SF Symbols, and the inspector standard above. Not web cards, hamburger menus,
  or underlined links.
- **Files behave like documents.** `.cueola`/`.ogshow` open by double-click in
  the installed app (manifest `file_handlers` + launchQueue), Cmd+S saves back
  into the opened file, and exports land as real files. System-wide Finder
  document icons are native-wrapper (3.0) territory; don't fake them.
- **Honor the platform.** `prefers-reduced-motion`, `prefers-color-scheme`
  awareness where it applies, safe-area insets on installed displays, and no
  browser-chrome dependence: everything reachable inside the app's own UI.

## Pre-ship checklist

- [ ] Reads clearly at a glance under time pressure?
- [ ] Uses theme tokens; follows the selected theme?
- [ ] Zero glows and drop shadows in chrome (or on the sanctioned-exceptions list)?
- [ ] Glass surfaces built only from the `--liquid-*` material recipe?
- [ ] Consistent with the existing equivalent in build/live/Planda Bear?
- [ ] Gives immediate feedback for every action?
- [ ] Contrast, focus states, `aria-label`s, `forced-colors` handled?
- [ ] No decoration competing with the cues/clock?
- [ ] Controls carry `data-tip` (plain, sentence case, verb-first), not `title`?
- [ ] Copy passes the professional checklist (no emoji, no exclamation marks)?
- [ ] Primary action is a capsule; actions are verb-labeled, ≤3 per alert?
- [ ] 44px target on `pointer:coarse` (in or inheriting the coarse block)?
- [ ] Animations die under `prefers-reduced-motion`?
- [ ] New spacing/durations use `--sp-*` / `--dur-*` tokens?
