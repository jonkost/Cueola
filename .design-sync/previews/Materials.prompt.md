Liquid Glass materials: glass chrome for toolbars and floating controls, opaque surfaces for content.

`.material-glass-regular` styles the functional layer — top bars, floating action groups, popovers — with blur, edge, and shadow from the `--glass-*` tokens. `.material-glass-clear` is only for controls floating over rich media. `.material-content` is the opaque surface for cards, tables, and forms. Never put dense content (rundown tables, scripts, text inputs) on glass; pair glass panels with `border-radius: var(--ui-radius-group)` or `--ui-radius-panel`.
