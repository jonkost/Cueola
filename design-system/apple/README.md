# Cueola Apple Design Staging

This directory prepares an Apple Human Interface Guidelines design system for
Cueola without changing the application. Nothing here is loaded by `index.html`,
`dashboard.html`, or `cueola-app.js`.

## What is ready

- `hig-foundations.md` translates the current HIG into Cueola design decisions.
- `reference.json` records semantic typography, color, control, layout, symbol,
  accessibility, and motion requirements for a future implementation.
- `fonts/README.md` records the installed San Francisco fonts and why they are
  not copied or embedded in the repository.
- `liquid-glass/` contains a current-UI audit, migration map, token contract,
  and standalone visual lab for reviewing the direction before app changes.
- `symbols/` contains preserved Apple export templates, compact runtime SVGs,
  searchable catalogs, semantic proposals, and the import workflow.

## Current baseline

- Review date: 2026-06-13
- Public Apple release: SF Symbols 7
- Public Apple beta: SF Symbols 8 beta
- Imported archive: SF Symbols Template v7.0 exports
- Runtime staging preset: Regular-S, monochrome, 2.5% optical padding
- Distribution status: review required before these assets are shipped by the
  web app or published through a CDN

## Future adoption order

1. Confirm the target platforms and Apple asset license boundaries.
2. Introduce semantic design tokens, not raw colors or font file URLs.
3. Add a small symbol helper that resolves names from `symbols/semantic-map.json`.
4. Replace one coherent control family at a time and test light, dark, increased
   contrast, large text, keyboard, reduced motion, and right-to-left layouts.
5. Keep app-specific personality in content and brand elements while using HIG
   conventions for controls, hierarchy, accessibility, and behavior.

The staging files are intentionally separate from the application so the design
system can be reviewed before any visual or behavioral change is made.
