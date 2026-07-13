#!/usr/bin/env python3
"""Off-script design-sync converter for Cueola (tokens-only design system).

Cueola is a vanilla-JS app with no npm package, no Storybook, and no React
components, so the bundled design-sync converter (Node/esbuild) does not
apply. This script assembles the same upload layout the converter would
emit for a tokens-only DS: styles.css + tokens, an empty-bodied
_ds_bundle.js with the @ds-bundle header, guidelines, and hand-authored
preview cards from .design-sync/previews/.

Run from anywhere:  python3 .design-sync/build.py
Output:             <repo>/ds-bundle/   (gitignored)
"""
import json
import os
import re
import shutil
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT = os.path.join(REPO, "ds-bundle")
LG = os.path.join(REPO, "design-system", "apple", "liquid-glass")
SYM = os.path.join(REPO, "design-system", "apple", "symbols")
NAMESPACE = "Cueola"

# Department color properties, extracted verbatim from the app's index.html.
DEPT_PROPS = ["--video", "--video-bg", "--green", "--cyan", "--purple",
              "--yellow", "--red", "--orange"]

errors = []


def clean_out():
    if os.path.exists(OUT):
        marker = os.path.join(OUT, "_ds_bundle.js")
        if os.listdir(OUT) and not os.path.exists(marker):
            sys.exit(f"refusing to rm {OUT}: not a prior ds-bundle")
        shutil.rmtree(OUT)
    os.makedirs(OUT)


def copy_tokens():
    tdir = os.path.join(OUT, "tokens")
    os.makedirs(tdir)
    for f in ["tokens.css", "themes.css", "tokens.json", "themes.json"]:
        shutil.copy(os.path.join(LG, f), os.path.join(tdir, f))


def extract_departments():
    """Department colors from the app's index.html — base :root values plus
    per-theme overrides, re-keyed to match both the app's [data-theme] and
    the registry's [data-product-theme] attribute."""
    css = open(os.path.join(REPO, "index.html")).read()
    lines = [
        "/* Department colors — extracted verbatim from the Cueola app",
        "   (index.html :root and [data-theme] blocks) by .design-sync/build.py.",
        "   Each department keeps its color everywhere it appears:",
        "   --video video, --green audio, --red playback, --yellow gfx,",
        "   --purple lighting, --cyan script. */",
        ":root {",
    ]
    for p in DEPT_PROPS:
        m = re.search(re.escape(p) + r":([^;}]+)", css)
        if not m:
            errors.append(f"departments: base value for {p} not found")
            continue
        lines.append(f"  {p}:{m.group(1).strip()};")
    lines.append("}")
    themes = re.findall(r'\[data-theme="(\w+)"\]\{([^}]+)\}', css)
    if len(themes) < 8:
        errors.append(f"departments: expected 8 theme blocks, found {len(themes)}")
    for name, body in themes:
        props = []
        for p in DEPT_PROPS:
            m = re.search(re.escape(p) + r":([^;]+)", body)
            if m:
                props.append(f"{p}:{m.group(1).strip()}")
        if props:
            lines.append(f'[data-theme="{name}"],[data-product-theme="{name}"]{{'
                         + ";".join(props) + "}")
    with open(os.path.join(OUT, "tokens", "departments.css"), "w") as f:
        f.write("\n".join(lines) + "\n")
    return [t[0] for t in themes]


def build_symbols():
    """Semantic SF Symbol icons as data-URI mask classes, so the icons travel
    inside the styles.css import closure (the app's mask idiom, from the
    liquid-glass lab)."""
    sem = json.load(open(os.path.join(SYM, "semantic-map.json")))["symbols"]
    idx = {}
    for root, _dirs, files in os.walk(os.path.join(SYM, "runtime")):
        for f in files:
            if f.endswith(".svg"):
                idx[f[:-4]] = os.path.join(root, f)
    lines = [
        "/* Semantic SF Symbol icons (Cueola semantic-map.json), inlined as",
        "   data-URI masks by .design-sync/build.py. Usage:",
        '   <span class="symbol icon-action-settings"></span>',
        "   The glyph takes the surrounding text color (currentColor). */",
        ".symbol{display:inline-block;width:18px;height:18px;background:currentColor;"
        "-webkit-mask:var(--icon) center/contain no-repeat;"
        "mask:var(--icon) center/contain no-repeat}",
    ]
    names = []
    for key in sorted(sem):
        sf = sem[key]
        if sf not in idx:
            errors.append(f"symbols: {key} -> {sf} has no runtime svg")
            continue
        svg = open(idx[sf]).read()
        svg = re.sub(r"\s+", " ", svg).replace('"', "'").strip()
        enc = urllib.parse.quote(svg, safe="' =/:.;,()-_")
        cls = "icon-" + key.replace(".", "-")
        names.append(cls)
        lines.append(f'.{cls}{{--icon:url("data:image/svg+xml,{enc}")}}')
    with open(os.path.join(OUT, "tokens", "symbols.css"), "w") as f:
        f.write("\n".join(lines) + "\n")
    return names


def write_root_files():
    with open(os.path.join(OUT, "styles.css"), "w") as f:
        f.write('@import "./tokens/tokens.css";\n'
                '@import "./tokens/themes.css";\n'
                '@import "./tokens/departments.css";\n'
                '@import "./tokens/symbols.css";\n')
    header = json.dumps({"namespace": NAMESPACE, "components": [],
                         "sourceHashes": {}, "inlinedExternals": [],
                         "builtBy": "cc-design-sync"}).replace("*/", "*\\/")
    with open(os.path.join(OUT, "_ds_bundle.js"), "w") as f:
        f.write(f"/* @ds-bundle: {header} */\n"
                f"window.{NAMESPACE} = window.{NAMESPACE} || {{}};\n")
    with open(os.path.join(OUT, "_ds_needs_recompile"), "w") as f:
        f.write('{"by":"design-sync-cli"}')


def copy_guidelines():
    gdir = os.path.join(OUT, "guidelines")
    os.makedirs(gdir)
    pairs = [
        (os.path.join(REPO, "DESIGN_GUIDELINES.md"), "DESIGN_GUIDELINES.md"),
        (os.path.join(REPO, "design-system", "apple", "hig-foundations.md"), "hig-foundations.md"),
        (os.path.join(REPO, "design-system", "apple", "reference.json"), "apple-reference.json"),
        (os.path.join(LG, "README.md"), "liquid-glass.md"),
        (os.path.join(LG, "audit.md"), "liquid-glass-audit.md"),
        (os.path.join(LG, "component-map.json"), "component-map.json"),
        (os.path.join(SYM, "semantic-map.json"), "symbols-semantic-map.json"),
    ]
    for src, dst in pairs:
        if os.path.exists(src):
            shutil.copy(src, os.path.join(gdir, dst))
        else:
            errors.append(f"guidelines: {src} missing")


def copy_cards(icon_names):
    """Hand-authored preview cards from .design-sync/previews/ into
    components/Foundations/<Name>/. Cards must start with a @dsCard line.
    A literal `<!-- @icons -->` line is replaced with one labeled cell per
    icon class, keeping the Symbols card in lockstep with symbols.css."""
    cells = "\n".join(
        f'<div class="cell"><span class="symbol {n}"></span><code>{n}</code></div>'
        for n in icon_names)
    pdir = os.path.join(HERE, "previews")
    cards = sorted(f[:-5] for f in os.listdir(pdir) if f.endswith(".html"))
    for name in cards:
        html = open(os.path.join(pdir, name + ".html")).read()
        html = html.replace("<!-- @icons -->", cells)
        if not html.startswith("<!-- @dsCard"):
            errors.append(f"card {name}: first line isn't a @dsCard comment")
        cdir = os.path.join(OUT, "components", "Foundations", name)
        os.makedirs(cdir)
        with open(os.path.join(cdir, name + ".html"), "w") as f:
            f.write(html)
        prompt = os.path.join(pdir, name + ".prompt.md")
        if os.path.exists(prompt):
            pt = open(prompt).read()
            if not pt.strip() or not pt.splitlines()[0].strip():
                errors.append(f"card {name}: .prompt.md first line is empty")
            shutil.copy(prompt, os.path.join(cdir, name + ".prompt.md"))
        else:
            errors.append(f"card {name}: no .prompt.md authored")
    return cards


def prop_names(*files):
    seen, out = set(), []
    for fn in files:
        for m in re.finditer(r"(--[a-z0-9-]+)\s*:", open(fn).read()):
            if m.group(1) not in seen:
                seen.add(m.group(1))
                out.append(m.group(1))
    return out


def write_readme(themes, icon_names, cards):
    tdir = os.path.join(OUT, "tokens")
    parts = []
    conv = os.path.join(HERE, "conventions.md")
    if os.path.exists(conv):
        parts.append(open(conv).read().rstrip() + "\n\n---\n")
    else:
        errors.append("README: .design-sync/conventions.md missing")
    ui = prop_names(os.path.join(tdir, "tokens.css"))
    dept = prop_names(os.path.join(tdir, "departments.css"))
    parts.append(f"""
# Cueola Design System — generated index

Tokens-only design system (no React components; `_ds_bundle.js` is an
empty-bodied namespace). Build UI with plain markup styled by the CSS
custom properties, material classes, and icon classes below — all of it
ships in `styles.css`'s import closure.

## Themes

Set `data-product-theme` on the root container. Registry themes
(tokens/themes.css): cool, warm, white, green, koala, panda, flamingo,
prepbear. Department overrides (tokens/departments.css) exist for:
{", ".join(themes)}. All themes are dark except `white`.

## Token index (tokens/tokens.css)

{chr(10).join("- `" + p + "`" for p in ui)}

## Department colors (tokens/departments.css)

{chr(10).join("- `" + p + "`" for p in dept)}

## Material classes (tokens/tokens.css)

- `.material-glass-regular` — Liquid Glass chrome for the functional layer
  (toolbars, floating controls, popovers). Never for content panels.
- `.material-glass-clear` — glass over rich media only.
- `.material-content` — opaque content surface (cards, tables, forms).

## Icons (tokens/symbols.css)

`<span class="symbol icon-…"></span>` — {len(icon_names)} semantic classes
(see guidelines/symbols-semantic-map.json). Full list:

{chr(10).join("- `." + n + "`" for n in icon_names)}

## Preview cards

{chr(10).join("- components/Foundations/" + c + "/" + c + ".html" for c in cards)}

## Guidelines

- guidelines/DESIGN_GUIDELINES.md — the Cueola design reference (read first)
- guidelines/hig-foundations.md — Apple HIG foundations digest
- guidelines/liquid-glass.md + liquid-glass-audit.md — where glass belongs
- guidelines/component-map.json — app surfaces classified by HIG layer/material
- guidelines/apple-reference.json — typography strategy (system font stack)
- guidelines/symbols-semantic-map.json — semantic icon names -> SF Symbols

## Fonts

None shipped, deliberately: Cueola uses the platform system-font stack
(`-apple-system, BlinkMacSystemFont, system-ui, …` via `--ui-font`;
`ui-monospace, SF Mono, …` via `--ui-mono`). Apple's license prohibits
redistributing San Francisco — do not add @font-face for it.
""")
    with open(os.path.join(OUT, "README.md"), "w") as f:
        f.write("".join(parts).lstrip())


def validate():
    css = open(os.path.join(OUT, "styles.css")).read()
    for m in re.finditer(r'@import\s+"([^"]+)"', css):
        if not os.path.exists(os.path.join(OUT, m.group(1))):
            errors.append(f"styles.css imports {m.group(1)} which doesn't exist")
    for root, _dirs, files in os.walk(os.path.join(OUT, "components")):
        for f in files:
            if f.endswith(".html"):
                p = os.path.join(root, f)
                for m in re.finditer(r'href="([^"]+\.css)"', open(p).read()):
                    tgt = os.path.normpath(os.path.join(root, m.group(1)))
                    if not os.path.exists(tgt):
                        errors.append(f"{p}: <link href={m.group(1)}> doesn't resolve")


def main():
    clean_out()
    copy_tokens()
    themes = extract_departments()
    icon_names = build_symbols()
    write_root_files()
    copy_guidelines()
    cards = copy_cards(icon_names)
    write_readme(themes, icon_names, cards)
    validate()
    n = sum(len(fs) for _r, _d, fs in os.walk(OUT))
    if errors:
        print(f"BUILD FAILED ({len(errors)} errors):")
        for e in errors:
            print("  ✗", e)
        sys.exit(1)
    print(f"ok: {n} files in {OUT} — themes: {len(themes)}, icons: {len(icon_names)}, cards: {', '.join(cards)}")


if __name__ == "__main__":
    main()
