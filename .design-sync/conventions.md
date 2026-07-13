# Building with the Cueola design system

Cueola is a live show-calling tool: operators read it at a glance, under time
pressure, often in a dark control room. Every design puts the content (cues,
clocks, script) first and keeps chrome quiet.

## Setup

This is a tokens-only system — there are no importable React components
(`window.Cueola` is an empty namespace). Build screens from plain markup and
style them with the CSS custom properties, material classes, and icon classes
that ship in `styles.css`. Do not invent your own colors, fonts, radii, or
icon art — every value you need is a token below.

Set the theme once, on the root element: `<div data-product-theme="cool">…`.
Themes: cool (default), warm, white, green, koala, panda, flamingo, prepbear.
All are dark except `white`. Without the attribute you get the neutral
light/dark contract from tokens.css.

## Styling idiom — CSS custom properties

- Surfaces: `--ui-background` (page), `--ui-content` / `--ui-content-secondary`
  (cards, tables, forms), `--ui-separator` / `--ui-separator-strong` (hairlines).
- Text: `--ui-label`, `--ui-label-secondary`, `--ui-label-tertiary`. Fonts:
  `--ui-font` (system sans); `--ui-mono` plus `font-variant-numeric:tabular-nums`
  for every clock and duration so digits never shift.
- Semantic: `--ui-accent`, `--ui-success`, `--ui-warning`, `--ui-destructive`,
  `--ui-live` (on-air red).
- Departments keep their color everywhere they appear: `--video` video,
  `--green` audio, `--red` playback, `--yellow` graphics, `--purple` lighting,
  `--cyan` script, `--orange` warnings.
- Shape and size: `--ui-radius-control`, `--ui-radius-group`,
  `--ui-radius-panel`; `--ui-control-height`, `--ui-control-height-compact`,
  `--ui-hit-target` (44px minimum); focus via `box-shadow: var(--ui-focus-ring)`.
- Motion: `--ui-duration-fast` / `--ui-duration-standard` with `--ui-ease`.

## Materials — glass is for chrome, never content

`.material-glass-regular` for toolbars, floating action groups, and popovers.
`.material-glass-clear` only over rich media. `.material-content` for cards,
tables, and forms. Dense content (rundown tables, scripts, inputs) always sits
on opaque surfaces — see guidelines/liquid-glass.md.

## Icons

`<span class="symbol icon-action-settings"></span>` — a masked SF Symbol that
takes the surrounding text color. Names come from
guidelines/symbols-semantic-map.json (`action.settings` → `.icon-action-settings`);
the full class list is in the index below. Never draw ad-hoc icon art.

## Read before styling

`styles.css` imports `tokens/tokens.css`, `tokens/themes.css`,
`tokens/departments.css`, and `tokens/symbols.css` — read those for exact
values, and `guidelines/DESIGN_GUIDELINES.md` for the rules (clarity at
operator distance, department color consistency, confirm before destructive).

## Example

```html
<div data-product-theme="cool" style="background:var(--ui-background);color:var(--ui-label);font-family:var(--ui-font);min-height:100%">
  <header class="material-glass-regular" style="display:flex;gap:12px;align-items:center;padding:10px 16px;border-radius:var(--ui-radius-group)">
    <strong>Friday Studio Show</strong>
    <span style="font-family:var(--ui-mono);font-variant-numeric:tabular-nums;color:var(--ui-label-secondary)">00:42:17</span>
    <button style="margin-left:auto;min-height:var(--ui-control-height);padding:0 14px;border:0;border-radius:var(--ui-radius-control);background:var(--ui-live);color:#fff;font-weight:600">
      <span class="symbol icon-marker-go"></span> Go Live</button>
  </header>
  <section class="material-content" style="margin:12px;padding:14px;border-radius:var(--ui-radius-group)">
    <span style="color:var(--green);font-weight:600">AUDIO</span> Host mic live
  </section>
</div>
```
