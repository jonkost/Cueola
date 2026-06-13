# Liquid Glass Readiness Audit

Audit date: 2026-06-13. Scope: current `index.html` presentation and structure.
No application files were changed.

## Executive assessment

Cueola is already partway toward the visual mechanics of glass: it has 29
`backdrop-filter` declarations, layered dark surfaces, sticky control bars, and
semantic-looking root variables. The next step is not adding more blur. It is
reducing inconsistency and assigning every surface to a clear functional or
content layer.

The current stylesheet also contains roughly 514 direct hex color occurrences,
243 `rgba()` uses, 234 `color-mix()` uses, 254 radius declarations, and 25
`transition: all` declarations. Those values make a global restyle risky. A token
and component migration should precede visual replacement.

## Existing strengths

- `.topbar`, `.bot-bar`, `#pt-bar`, `#pt-panel`, `.prompt-op-panel`, and several
  floating action bars already occupy the correct functional layer for glass.
- The root has reusable surface, text, accent, radius, shadow, and easing tokens.
- Focus-visible styling exists globally.
- The layout already distinguishes major screens and supports compact variants.
- Critical live and rundown content has strong hierarchy and persistent controls.

## Main risks

### Glass is currently defined as blur

Existing blurred surfaces mostly combine a dark translucent background with a
large blur. A Liquid Glass treatment also needs edge definition, adaptive
luminosity, restrained tint, depth, and clear separation from content.

### Content and controls sometimes share the same surface language

Entry cards, metadata tiles, tables, forms, dialogs, sidebars, and toolbars use
similar dark panels and borders. Glass should identify function, not simply make
every container translucent.

### Global visual replacement would have a large blast radius

The stylesheet is embedded in a large HTML file and many components use inline
styles. Introducing the new system through compatibility tokens is safer than
renaming the existing surface variables all at once.

### Accessibility fallbacks need explicit design

Reduce Transparency and Increased Contrast need opaque variants. Motion needs a
reduced state. Clear glass should never be the only contrast strategy over video,
images, or dense rundown content.

### Typography and iconography are mixed

The app uses the system stack for body copy, Syne for display headings, several
other web fonts, emoji, custom SVG, and text glyphs. Liquid Glass will look more
coherent after controls use the staged SF Symbol mapping and typography is
assigned by role. Branding can retain a distinct display voice.

## Layer decisions

### Functional glass candidates

- `.topbar` and `.ls-bar`
- `.bot-bar` and `.ls-bot`
- `.mode-tabs` and compact segmented controls
- `.p-tooltip`, `.notif-panel`, and similar popovers
- `.paperwork-flow-actions`
- `#pt-bar`, `#pt-panel`, `.pt-hint`, and `.prompt-op-panel`
- compact modal or sheet chrome where it floats above content

Use regular glass by default. Reserve clear glass for controls over media where a
dimming strategy has been verified.

### Standard-material or opaque content surfaces

- `.rd-table`, `.rd-scroll`, and rundown cells
- `.show-strip` and show metadata
- `.e-card` entry choices
- `.ls-overview`, `.ls-main`, and `.ls-sidebar` content
- forms, text inputs, paperwork documents, note threads, and script editors
- large modal bodies with substantial text or form content

These surfaces can adopt the new spacing, typography, corner, separator, and
semantic color system without becoming glass.

### Backdrops

Modal and sheet backdrops should dim the content plane. Avoid heavy blur across
the entire application as the primary modal treatment; it can reduce orientation
and becomes expensive on lower-power devices. Let the foreground component carry
the material identity.

## Migration waves

1. **Compatibility tokens**
   Add semantic label, surface, separator, accent, material, elevation, radius,
   and motion tokens while preserving current rendered values.
2. **Symbols and control metrics**
   Standardize icon sizing, control heights, hit areas, focus rings, and semantic
   symbol names. Replace emoji only where it represents a conventional control.
3. **Primary functional layer**
   Convert the rundown top and bottom bars and their popovers. Verify scrolling,
   sticky behavior, reduced transparency, and increased contrast.
4. **Transient UI**
   Convert sheets, compact dialogs, notification panels, and floating action
   groups. Keep form bodies on opaque standard surfaces.
5. **Live and prompter controls**
   Apply glass to control chrome without reducing readability of timing, script,
   status, or video-adjacent content.
6. **Content refinement**
   Simplify cards, tables, borders, and typography so the glass layer remains
   visually distinct. Do not turn content panels into glass.

## Theme contract

The existing app exposes eight global themes: Glacier (`cool`), Honey (`warm`),
Polar Bear (`white`), Eucalyptus (`green`), Koala (`koala`), Planda Bear
(`panda`), Flowmingo (`flamingo`), and PrepBear (`prepbear`). Planda Bear also
maintains a local copy of most palettes, and Flowmingo has another parallel theme
object.

The migration should keep the existing IDs for storage and synchronization, but
resolve them through one registry. Each theme must supply semantic content,
label, accent, separator, glass fill, glass edge, and dimming roles. Appearance,
increased contrast, reduced transparency, and reduced motion are modifiers on a
theme, not additional themes.

`themes.json` is the proposed source of truth. `themes.css` is its current CSS
reference output. The visual lab can preview every registered theme.

## Per-wave verification

- light and dark appearance
- increased contrast and reduced transparency
- browser without `backdrop-filter`
- keyboard focus and screen-reader names
- 200% text size and narrow viewport
- reduced motion
- sticky and fixed controls during scroll
- legibility over the brightest and darkest expected content
- no loss of primary status, warning, live, or destructive meaning
