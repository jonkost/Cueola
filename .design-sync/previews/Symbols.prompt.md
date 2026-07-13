Semantic SF Symbol icon classes rendered as currentColor masks.

Usage: `<span class="symbol icon-action-settings"></span>` — the `.symbol` base class masks the glyph over `background: currentColor`, so icons inherit the surrounding text color (e.g. set `color: var(--green)` for an audio control). Class names mirror guidelines/symbols-semantic-map.json with dots as hyphens: `department.audio` → `.icon-department-audio`, `marker.go` → `.icon-marker-go`. Size by overriding width/height on `.symbol` (default 18px).
