# Cueola SF Symbols Staging Library

This library is the source of truth for Cueola's semantic interface symbols.
The app loads a reviewed subset through the generated `assets/sf-symbols.css`
mask stylesheet; source templates remain isolated from application markup.

## Contents

- `source/<category>/`: original Apple Template v7.0 SVG exports, preserved for
  future native or custom-symbol work.
- `runtime/<weight>-small/<category>/` (currently `light-small`): compact monochrome SVGs extracted from the
  Regular-S master for later masks or inline use.
- `catalog.json`: complete machine-readable metadata and paths.
- `catalog.csv`: spreadsheet-friendly index.
- `index.html`: standalone searchable visual catalog.
- `aliases.json`: duplicate export names mapped to one canonical symbol.
- `semantic-map.json`: proposed stable Cueola names mapped to Apple symbol names.

Open `index.html` directly or serve the repository locally to browse and search
by Apple category, keyword, Cueola department, action, state, or semantic name.

## Import more symbols

```bash
python3 scripts/import_sf_symbols.py "/path/to/SF Symbol SVGs.zip"
```

The default behavior merges new exports with the existing source library. It
regenerates runtime files and all catalogs, preserves prior symbols, and collapses
identical Finder-style names such as `symbol_2.svg` into aliases. Use `--fresh`
only when intentionally replacing the entire managed library.

The importer uses only the Python standard library. When the SF Symbols app is
installed, it reads Apple's local category, search keyword, and availability
metadata. Otherwise it falls back to conservative filename-based categories.

## App integration

Resolve application concepts through `semantic-map.json`, rather than scattering
Apple filenames through markup. Regenerate the application stylesheet after
changing the map or importing symbols:

```bash
python3 scripts/build_sf_symbol_css.py
```

Example CSS pattern for a later implementation:

```css
.symbol {
  width: 1em;
  height: 1em;
  background: currentColor;
  -webkit-mask: var(--symbol-url) center / contain no-repeat;
  mask: var(--symbol-url) center / contain no-repeat;
}
```

Icon-only controls still need a visible tooltip where useful and an accessible
name on the control. The SVG itself is marked `aria-hidden="true"` because the
meaning belongs to its usage context.

## Version and distribution notes

The supplied files contain Template v7.0 masters generated with SF Symbols 7 and
state that they require Xcode 26 or later. Apple's public site currently also
offers SF Symbols 8 beta. Keep source version and OS availability metadata when
adding newer exports.

Apple directs developers to review the SF Symbols terms and prohibits symbol use
in app icons, logos, or trademark uses. Cueola is currently a web application, so
the generated catalog marks every symbol `review-required` until distribution on
the intended platforms has been checked against Apple's license terms.
