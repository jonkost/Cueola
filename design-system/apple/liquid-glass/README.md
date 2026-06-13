# Cueola Liquid Glass Preparation

This directory prepares a Liquid Glass migration without loading any of these
files in the Cueola application.

## Deliverables

- `audit.md`: current-state findings and a recommended migration sequence.
- `component-map.json`: existing Cueola selectors classified by HIG layer,
  material recommendation, risk, and migration wave.
- `tokens.css`: implementation-neutral CSS custom properties and fallback rules.
- `tokens.json`: the same contract in structured form for future tooling.
- `themes.css` and `themes.json`: the canonical eight-theme registry shared by
  the future Cueola, Planda Bear, and Flowmingo implementations.
- `index.html`: a standalone visual lab using Cueola content and staged SF Symbols.

## Core rule

Liquid Glass belongs on Cueola's functional layer: navigation, toolbars, compact
floating controls, popovers, and transient sheets. It does not belong on every
card, form, table cell, or content panel.

The style lab intentionally keeps the rundown table and information cards on
opaque or standard-material surfaces while the top bar, floating actions, and
inspector controls use glass.

## Review the lab

From the repository root:

```bash
python3 -m http.server 8010
```

Then open:

`http://localhost:8010/design-system/apple/liquid-glass/`

The lab includes all eight current product themes plus light/dark appearance,
increased contrast, reduced transparency, and reduced motion controls. These are
design states for review; they do not change system settings.

## Adoption gate

Do not import `tokens.css` wholesale into the app. First approve the layer map and
visual direction, then introduce semantic tokens into the app in small waves.
Each wave should preserve current behavior and be tested independently.
