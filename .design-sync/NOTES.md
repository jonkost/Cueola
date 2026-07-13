# design-sync notes — Cueola

Synced to Claude Design project **Cueola Design System**
(`117d07bd-1414-4fa6-81a7-fee6cc847a75`, pinned in config.json). First sync
2026-07-13.

## How this repo syncs (off-script)

- Cueola is a vanilla-JS app: no package.json, no Storybook, no React
  components. The bundled design-sync converter (Node/esbuild) does not apply,
  and this machine has no system Node. The upload layout is produced by
  **`.design-sync/build.py` (python3, stdlib only)** → `ds-bundle/`
  (gitignored). It emits the tokens-only shape: `styles.css` + `tokens/`,
  empty-bodied `_ds_bundle.js` (namespace `Cueola`) with the `@ds-bundle`
  header, `guidelines/`, and four hand-authored cards from
  `.design-sync/previews/` under `components/Foundations/`.
- **Re-sync**: `python3 .design-sync/build.py`, verify cards in a browser,
  then upload via the DesignSync tool (atomic path — projectId is pinned).
  No `_ds_sync.json` anchor is uploaded (the off-script build has no hash
  recipe), so every re-sync re-verifies and re-uploads everything — the
  surface is small, that's fine and intentional.
- **Verification**: playwright render-check unavailable (no Node). Cards were
  verified in the Claude Code browser pane: screenshot each card, check
  console errors, confirm the styles.css @import closure all loads 200, and
  for Symbols run the unmasked-cell probe (0 of 97 unmasked on 2026-07-13).
  All four cards graded good (styled / complete / plausible).

## Sources of truth

- `tokens/tokens.css`, `tokens/themes.css` (+ json twins): copied verbatim
  from `design-system/apple/liquid-glass/`.
- `tokens/departments.css`: extracted at build time from the app's
  `index.html` (`:root` + single-line `[data-theme="x"]{…}` blocks). If the
  app's theme tokens ever move out of index.html, update build.py.
- `tokens/symbols.css`: generated from
  `design-system/apple/symbols/semantic-map.json` + `symbols/runtime/`
  (data-URI masks). The Symbols card's grid cells are injected at build via
  the `<!-- @icons -->` placeholder.
- `README.md`: `.design-sync/conventions.md` prepended to a generated index —
  re-run build.py after editing conventions.md.

## Findings / drift

- **Theme registry drift**: the app has 8 themes including `outrangutan`;
  the canonical registry (`themes.css`) has `prepbear` and no `outrangutan`.
  departments.css ships outrangutan department colors, but there is no
  `[data-product-theme="outrangutan"]` `--ui-*` block — an outrangutan-themed
  design falls back to the neutral dark contract. Consider adding
  outrangutan to `design-system/apple/liquid-glass/themes.css`.
- **Fonts**: none shipped, deliberately — Apple's license prohibits
  redistributing San Francisco; the system font stack is the policy
  (design-system/apple/fonts/README.md). Never add @font-face for SF.

## Re-sync risks

- `semantic-map.json` is `status: "proposal"` — renaming a semantic key
  renames its `.icon-*` class and silently breaks designs that used the old
  name. Treat semantic keys as published API once designs exist.
- The department-color extraction regex assumes the app keeps single-line
  `[data-theme="x"]{…}` token blocks in index.html.
- The upload-channel approval is per-session; a future sync needs a fresh
  `finalize_plan` approval (and DesignSync resolves a relative `localDir`
  against the shell's persistent cwd — pass it absolute).
- The liquid-glass contract is "reference-only, not loaded by the app" — if
  the app's real look diverges from it, the synced DS follows the reference,
  not the app.
