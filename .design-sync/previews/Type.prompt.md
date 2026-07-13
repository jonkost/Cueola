Cueola typography: system font stack, weights 400–700, and tabular monospace production numerals.

Body text uses `font-family: var(--ui-font)` (the platform system stack — San Francisco on Apple devices; no font files ship). Every clock, duration, or countdown uses `font-family: var(--ui-mono)` with `font-variant-numeric: tabular-nums` so digits never shift while running. Hierarchy comes from `--ui-label` / `--ui-label-secondary` / `--ui-label-tertiary` and weight, not from extra colors.
