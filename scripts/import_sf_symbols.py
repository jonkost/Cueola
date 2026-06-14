#!/usr/bin/env python3
"""Import exported SF Symbols templates into Cueola's design staging area.

This script intentionally does not modify the Cueola application. It preserves the
Apple templates, extracts a compact monochrome Regular-S asset for later web use,
and regenerates searchable catalog files.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import io
import json
import math
import plistlib
import re
import shutil
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
import xml.etree.ElementTree as ET


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPO_ROOT / "design-system" / "apple" / "symbols"
DEFAULT_METADATA = Path(
    "/Applications/SF Symbols Beta.app/Contents/Resources/Metadata"
)
SVG_NS = "http://www.w3.org/2000/svg"
NS = {"svg": SVG_NS}
FEATURE_CATEGORIES = {"all", "whatsnew", "draw", "variable", "multicolor"}
FALLBACK_CATEGORY_LABELS = {
    "accessibility": "Accessibility",
    "arrows": "Arrows",
    "cameraandphotos": "Camera & Photos",
    "communication": "Communication",
    "devices": "Devices",
    "editing": "Editing",
    "health": "Health",
    "home": "Home",
    "human": "Human",
    "media": "Media",
    "nature": "Nature",
    "objectsandtools": "Objects & Tools",
    "shapes": "Shapes",
    "textformatting": "Text Formatting",
    "time": "Time",
    "weather": "Weather",
}
TOKEN_RE = re.compile(r"[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
NUMBERED_COPY_RE = re.compile(r"^(?P<base>.+)_\d+$")


@dataclass
class SourceAsset:
    name: str
    data: bytes
    origin: str

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import SF Symbols SVG templates without editing the app."
    )
    parser.add_argument("source", type=Path, help="ZIP archive or directory of SVGs")
    parser.add_argument(
        "--output", type=Path, default=DEFAULT_OUTPUT, help="catalog output directory"
    )
    parser.add_argument(
        "--metadata-dir",
        type=Path,
        default=DEFAULT_METADATA,
        help="optional SF Symbols Metadata directory",
    )
    parser.add_argument(
        "--fresh", action="store_true", help="replace rather than merge the catalog"
    )
    return parser.parse_args()


def safe_symbol_name(filename: str) -> str:
    stem = Path(filename).stem.strip()
    if not stem or not re.fullmatch(r"[A-Za-z0-9._-]+", stem):
        raise ValueError(f"Unsupported symbol filename: {filename!r}")
    return stem


def load_source(path: Path) -> tuple[list[SourceAsset], dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(path)

    assets: list[SourceAsset] = []
    provenance: dict[str, str] = {"file": path.name}
    if path.is_file():
        provenance["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()

    if path.is_dir():
        for svg_path in sorted(path.rglob("*.svg")):
            if svg_path.name.startswith(".") or "__MACOSX" in svg_path.parts:
                continue
            assets.append(
                SourceAsset(
                    safe_symbol_name(svg_path.name),
                    svg_path.read_bytes(),
                    str(svg_path.relative_to(path)),
                )
            )
    elif zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            for info in sorted(archive.infolist(), key=lambda item: item.filename):
                member = Path(info.filename)
                if (
                    info.is_dir()
                    or member.suffix.lower() != ".svg"
                    or "__MACOSX" in member.parts
                    or member.name.startswith(".")
                ):
                    continue
                assets.append(
                    SourceAsset(
                        safe_symbol_name(member.name),
                        archive.read(info),
                        info.filename,
                    )
                )
    else:
        raise ValueError(f"Source is neither a directory nor a ZIP archive: {path}")

    if not assets:
        raise ValueError(f"No SVG files found in {path}")
    return assets, provenance


def load_existing(output: Path) -> tuple[dict[str, SourceAsset], dict[str, str], list[dict]]:
    assets: dict[str, SourceAsset] = {}
    for svg_path in sorted((output / "source").glob("**/*.svg")):
        assets[svg_path.stem] = SourceAsset(
            svg_path.stem, svg_path.read_bytes(), str(svg_path.relative_to(output))
        )

    aliases_path = output / "aliases.json"
    aliases = json.loads(aliases_path.read_text()) if aliases_path.exists() else {}
    catalog_path = output / "catalog.json"
    imports = []
    if catalog_path.exists():
        imports = json.loads(catalog_path.read_text()).get("imports", [])
    return assets, aliases, imports


def load_plist(path: Path, default):
    if not path.exists():
        return default
    with path.open("rb") as handle:
        return plistlib.load(handle)


def load_apple_metadata(metadata_dir: Path) -> dict:
    categories_list = load_plist(metadata_dir / "categories.plist", [])
    category_labels = {
        item["key"]: item["label"]
        for item in categories_list
        if isinstance(item, dict) and "key" in item and "label" in item
    }
    category_labels.update(
        {key: value for key, value in FALLBACK_CATEGORY_LABELS.items() if key not in category_labels}
    )
    availability = load_plist(metadata_dir / "name_availability.plist", {})
    app_info = load_plist(metadata_dir.parents[1] / "Info.plist", {})
    return {
        "categories": load_plist(metadata_dir / "symbol_categories.plist", {}),
        "categoryLabels": category_labels,
        "categoryOrder": [item["key"] for item in categories_list if "key" in item],
        "keywords": load_plist(metadata_dir / "symbol_search.plist", {}),
        "availability": availability.get("symbols", availability),
        "source": (
            {
                "name": app_info.get("CFBundleDisplayName", "SF Symbols"),
                "version": app_info.get("CFBundleShortVersionString"),
                "build": app_info.get("CFBundleVersion"),
            }
            if metadata_dir.exists()
            else None
        ),
    }


def xml_root(data: bytes) -> ET.Element:
    return ET.fromstring(data)


def find_by_id(root: ET.Element, element_id: str) -> ET.Element | None:
    return next((element for element in root.iter() if element.get("id") == element_id), None)


def source_metadata(data: bytes) -> dict:
    text = data.decode("utf-8")
    root = xml_root(data)
    symbols = find_by_id(root, "Symbols")
    masters = [] if symbols is None else [child.get("id") for child in symbols if child.get("id")]

    def match(pattern: str):
        found = re.search(pattern, text)
        return found.group(1).strip() if found else None

    modes = set()
    for path in root.findall(".//svg:path", NS):
        classes = path.get("class", "")
        for mode in ("monochrome", "hierarchical", "palette", "multicolor"):
            if mode in classes:
                modes.add(mode)

    return {
        "glyph": match(r'<!--glyph: "([^"]+)"'),
        "fontVersion": match(r'font version: "([^"]+)"'),
        "templateVersion": match(r">Template v\.([^<]+)<"),
        "xcodeRequirement": match(r">(Requires Xcode [^<]+)<"),
        "descriptiveName": match(r'id="descriptive-name"[^>]*>([^<]+)<'),
        "viewBox": root.get("viewBox"),
        "masters": masters,
        "renderingModes": sorted(modes),
    }


def tokenize_path(path_data: str) -> list[str]:
    return TOKEN_RE.findall(path_data)


def cubic_value(p0: float, p1: float, p2: float, p3: float, t: float) -> float:
    mt = 1 - t
    return mt**3 * p0 + 3 * mt**2 * t * p1 + 3 * mt * t**2 * p2 + t**3 * p3


def cubic_extrema(p0: float, p1: float, p2: float, p3: float) -> list[float]:
    a = -p0 + 3 * p1 - 3 * p2 + p3
    b = 2 * (p0 - 2 * p1 + p2)
    c = p1 - p0
    values = [p0, p3]
    if abs(a) < 1e-12:
        if abs(b) > 1e-12:
            t = -c / b
            if 0 < t < 1:
                values.append(cubic_value(p0, p1, p2, p3, t))
        return values
    discriminant = b * b - 4 * a * c
    if discriminant >= 0:
        root = math.sqrt(discriminant)
        for t in ((-b + root) / (2 * a), (-b - root) / (2 * a)):
            if 0 < t < 1:
                values.append(cubic_value(p0, p1, p2, p3, t))
    return values


def path_bounds(path_data: str) -> tuple[float, float, float, float]:
    tokens = tokenize_path(path_data)
    index = 0
    command = None
    current = (0.0, 0.0)
    start = current
    last_control: tuple[float, float] | None = None
    previous_command = None
    xs: list[float] = []
    ys: list[float] = []

    def add(point: tuple[float, float]) -> None:
        xs.append(point[0])
        ys.append(point[1])

    def number() -> float:
        nonlocal index
        value = float(tokens[index])
        index += 1
        return value

    while index < len(tokens):
        if tokens[index].isalpha():
            command = tokens[index]
            index += 1
        if command is None:
            raise ValueError("SVG path starts without a command")

        relative = command.islower()
        upper = command.upper()
        if upper == "Z":
            current = start
            add(current)
            last_control = None
            previous_command = command
            command = None
            continue

        def point() -> tuple[float, float]:
            x, y = number(), number()
            return (x + current[0], y + current[1]) if relative else (x, y)

        if upper == "M":
            current = point()
            start = current
            add(current)
            command = "l" if relative else "L"
            last_control = None
        elif upper == "L":
            current = point()
            add(current)
            last_control = None
        elif upper == "H":
            value = number()
            current = (current[0] + value if relative else value, current[1])
            add(current)
            last_control = None
        elif upper == "V":
            value = number()
            current = (current[0], current[1] + value if relative else value)
            add(current)
            last_control = None
        elif upper == "C":
            p0 = current
            p1 = point()
            p2 = point()
            p3 = point()
            xs.extend(cubic_extrema(p0[0], p1[0], p2[0], p3[0]))
            ys.extend(cubic_extrema(p0[1], p1[1], p2[1], p3[1]))
            current = p3
            last_control = p2
        elif upper == "S":
            p0 = current
            if previous_command and previous_command.upper() in {"C", "S"} and last_control:
                p1 = (2 * p0[0] - last_control[0], 2 * p0[1] - last_control[1])
            else:
                p1 = p0
            p2 = point()
            p3 = point()
            xs.extend(cubic_extrema(p0[0], p1[0], p2[0], p3[0]))
            ys.extend(cubic_extrema(p0[1], p1[1], p2[1], p3[1]))
            current = p3
            last_control = p2
        else:
            raise ValueError(f"Unsupported SVG path command: {command}")
        previous_command = command

    if not xs or not ys:
        raise ValueError("SVG path has no geometry")
    return min(xs), min(ys), max(xs), max(ys)


def format_number(value: float) -> str:
    rounded = f"{value:.3f}".rstrip("0").rstrip(".")
    return "0" if rounded in {"-0", ""} else rounded


def extract_runtime(data: bytes, symbol_name: str) -> tuple[bytes, str, int]:
    root = xml_root(data)
    master = find_by_id(root, "Regular-S")
    if master is None:
        raise ValueError(f"{symbol_name}: missing Regular-S master")
    paths = list(master.findall(".//svg:path", NS))
    if not paths:
        raise ValueError(f"{symbol_name}: Regular-S has no paths")

    bounds = [path_bounds(path.get("d", "")) for path in paths]
    min_x = min(item[0] for item in bounds)
    min_y = min(item[1] for item in bounds)
    max_x = max(item[2] for item in bounds)
    max_y = max(item[3] for item in bounds)
    padding = max(max_x - min_x, max_y - min_y) * 0.025
    view_box = " ".join(
        format_number(value)
        for value in (
            min_x - padding,
            min_y - padding,
            max_x - min_x + 2 * padding,
            max_y - min_y + 2 * padding,
        )
    )

    path_lines = []
    for path in paths:
        path_lines.append(f'  <path d="{html.escape(path.get("d", ""), quote=True)}"/>')
    output = (
        f'<svg xmlns="{SVG_NS}" viewBox="{view_box}" aria-hidden="true" '
        f'data-sf-symbol="{html.escape(symbol_name, quote=True)}">\n'
        ' <g fill="black">\n'
        + "\n".join(path_lines)
        + "\n </g>\n</svg>\n"
    )
    return output.encode("utf-8"), view_box, len(paths)


def fallback_categories(name: str) -> list[str]:
    rules = [
        ("weather", r"cloud|sun|moon|wind|storm|tornado|hurricane|thermometer"),
        ("textformatting", r"^text\.|^quote|^list\.|checklist|scroll|magazine"),
        ("cameraandphotos", r"photo|viewfinder"),
        ("editing", r"crop|pencil|scissors|paintpalette|slider|sparkles|hand\.draw"),
        ("arrows", r"arrow"),
        ("media", r"play|pause|stop|film|movie|tv|speaker|waveform|microphone|guitar|popcorn"),
        ("devices", r"display|tv|hifispeaker"),
        ("privacyandsecurity", r"exclamation|fire\.extinguisher"),
        ("human", r"person"),
        ("health", r"heart|bandage|cross"),
        ("nature", r"tree|hare|tortoise"),
        ("home", r"house"),
        ("time", r"calendar"),
    ]
    return [category for category, pattern in rules if re.search(pattern, name)] or [
        "objectsandtools"
    ]


def cueola_tags(name: str, categories: list[str]) -> list[str]:
    tags = set()
    rules = {
        "department:audio": r"microphone|speaker|waveform",
        "department:lighting": r"lightbulb|sun|max|moon",
        "department:playback": r"play|pause|stop|film|movie|tv|display|popcorn|guitar",
        "department:graphics": r"photo|paint|sparkles|crop|pencil|palette|grid",
        "department:script": r"text|quote|list|checklist|scroll|magazine|paperclip",
        "action:navigation": r"^arrow|house|xmark|checkmark|ellipsis",
        "action:settings": r"gear|slider|wrench|hammer",
        "state:warning": r"exclamation|fire\.extinguisher|bandage|cross",
        "state:weather": r"cloud|sunset|wind|storm|tornado|hurricane|thermometer",
        "content:help": r"info|questionmark|lightbulb",
    }
    for tag, pattern in rules.items():
        if re.search(pattern, name):
            tags.add(tag)
    if "weather" in categories:
        tags.add("state:weather")
    return sorted(tags)


def choose_primary(name: str, categories: list[str], order: list[str]) -> str:
    inferred = fallback_categories(name)
    if inferred != ["objectsandtools"]:
        return inferred[0]
    semantic = [category for category in categories if category not in FEATURE_CATEGORIES]
    if not semantic:
        return "uncategorized"
    order_index = {category: index for index, category in enumerate(order)}
    return sorted(semantic, key=lambda item: (order_index.get(item, 999), item))[0]


def title_from_name(name: str) -> str:
    return " ".join(part.capitalize() for part in re.split(r"[._-]+", name))


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=False) + "\n")


def write_catalog_html(path: Path, catalog: dict) -> None:
    data = json.dumps(catalog, separators=(",", ":")).replace("</", "<\\/")
    page = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cueola SF Symbols Catalog</title>
<style>
:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;background:#f5f5f7;color:#1d1d1f}
*{box-sizing:border-box}body{margin:0}header{position:sticky;top:0;z-index:2;padding:24px clamp(18px,4vw,54px);background:color-mix(in srgb,Canvas 88%,transparent);backdrop-filter:blur(22px);border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent)}
h1{font-size:clamp(28px,4vw,44px);letter-spacing:-.04em;margin:0 0 6px}p{margin:0;color:color-mix(in srgb,CanvasText 62%,transparent)}
.tools{display:grid;grid-template-columns:minmax(220px,1fr) minmax(180px,280px);gap:12px;margin-top:20px}input,select{font:inherit;padding:11px 13px;border-radius:11px;border:1px solid color-mix(in srgb,CanvasText 16%,transparent);background:Canvas;color:CanvasText}
main{padding:28px clamp(18px,4vw,54px) 60px}.summary{margin-bottom:18px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.card{min-height:166px;border:1px solid color-mix(in srgb,CanvasText 12%,transparent);border-radius:16px;background:Canvas;padding:18px;text-align:left;color:CanvasText;cursor:pointer;box-shadow:0 1px 2px color-mix(in srgb,#000 7%,transparent)}
.card:hover,.card:focus-visible{border-color:#007aff;outline:none;box-shadow:0 0 0 3px color-mix(in srgb,#007aff 20%,transparent)}.icon{display:block;width:48px;height:48px;margin-bottom:15px;object-fit:contain}.name{font-size:13px;font-weight:650;overflow-wrap:anywhere}.meta{font-size:11px;margin-top:7px;color:color-mix(in srgb,CanvasText 56%,transparent)}
.empty{padding:50px 0;text-align:center}@media(prefers-color-scheme:dark){:root{background:#000;color:#f5f5f7}.icon{filter:invert(1)}}@media(max-width:600px){.tools{grid-template-columns:1fr}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.card{min-height:150px}}
</style>
</head>
<body>
<header><h1>SF Symbols staging catalog</h1><p>Design inventory only. Click a card to copy its symbol name.</p><div class="tools"><input id="search" type="search" placeholder="Search names, categories, keywords, or Cueola roles" aria-label="Search symbols"><select id="category" aria-label="Filter by category"><option value="">All categories</option></select></div></header>
<main><p class="summary" id="summary"></p><div class="grid" id="grid"></div></main>
<script>const catalog=__CATALOG__;const symbols=catalog.symbols;const q=document.querySelector('#search');const cat=document.querySelector('#category');const grid=document.querySelector('#grid');const summary=document.querySelector('#summary');
for(const item of [...new Set(symbols.map(s=>s.primaryCategory))].sort()){const option=document.createElement('option');option.value=item;option.textContent=catalog.categoryLabels[item]||item;cat.append(option)}
function render(){const needle=q.value.trim().toLowerCase();const visible=symbols.filter(s=>(!cat.value||s.primaryCategory===cat.value)&&(!needle||[s.name,s.displayName,...s.appleCategories,...s.keywords,...s.cueolaTags,...s.semanticNames].join(' ').toLowerCase().includes(needle)));summary.textContent=`${visible.length} of ${symbols.length} symbols`;grid.replaceChildren(...visible.map(s=>{const button=document.createElement('button');button.className='card';button.type='button';button.title='Copy '+s.name;button.innerHTML=`<img class="icon" src="${s.runtimePath}" alt=""><div class="name">${s.name}</div><div class="meta">${catalog.categoryLabels[s.primaryCategory]||s.primaryCategory}</div>`;button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(s.name);button.querySelector('.meta').textContent='Copied';setTimeout(()=>button.querySelector('.meta').textContent=catalog.categoryLabels[s.primaryCategory]||s.primaryCategory,900)}catch{prompt('Symbol name',s.name)}});return button}));if(!visible.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='No symbols match this filter.';grid.append(empty)}}q.addEventListener('input',render);cat.addEventListener('change',render);render();</script>
</body></html>
""".replace("__CATALOG__", data)
    path.write_text(page)


def main() -> int:
    args = parse_args()
    output = args.output.resolve()
    incoming, provenance = load_source(args.source.resolve())
    existing, aliases, imports = ({}, {}, []) if args.fresh else load_existing(output)

    inventory = dict(existing)
    incoming_by_name = {asset.name: asset for asset in incoming}
    inventory.update(incoming_by_name)

    # Finder commonly appends _2, _3, and so on to duplicate exports.
    for name in sorted(list(inventory)):
        match = NUMBERED_COPY_RE.match(name)
        if not match:
            continue
        base = match.group("base")
        if base in inventory and inventory[base].sha256 == inventory[name].sha256:
            aliases[name] = base
            del inventory[name]

    imports_by_hash = {item.get("sha256"): item for item in imports if item.get("sha256")}
    imports_by_hash[provenance.get("sha256", provenance["file"])] = provenance
    imports = sorted(imports_by_hash.values(), key=lambda item: item["file"])

    apple = load_apple_metadata(args.metadata_dir)
    category_order = apple["categoryOrder"] or list(FALLBACK_CATEGORY_LABELS)
    semantic_map_path = output / "semantic-map.json"
    semantic_map = (
        json.loads(semantic_map_path.read_text()).get("symbols", {})
        if semantic_map_path.exists()
        else {}
    )
    missing_semantic_targets = sorted(set(semantic_map.values()) - set(inventory))
    if missing_semantic_targets:
        raise ValueError(
            "semantic-map.json references missing symbols: "
            + ", ".join(missing_semantic_targets)
        )
    entries = []
    generated_sources: dict[str, bytes] = {}
    generated_runtime: dict[str, bytes] = {}

    for name, asset in sorted(inventory.items()):
        meta = source_metadata(asset.data)
        inferred_categories = fallback_categories(name)
        categories = list(apple["categories"].get(name) or [])
        for category in inferred_categories:
            if category not in categories:
                categories.append(category)
        primary = choose_primary(name, categories, category_order)
        runtime, runtime_view_box, path_count = extract_runtime(asset.data, name)
        source_path = f"source/{primary}/{name}.svg"
        runtime_path = f"runtime/regular-small/{primary}/{name}.svg"
        generated_sources[source_path] = asset.data
        generated_runtime[runtime_path] = runtime
        symbol_aliases = sorted(alias for alias, target in aliases.items() if target == name)
        entries.append(
            {
                "name": name,
                "displayName": title_from_name(name),
                "primaryCategory": primary,
                "appleCategories": categories,
                "keywords": sorted(set(apple["keywords"].get(name, []))),
                "cueolaTags": cueola_tags(name, categories),
                "semanticNames": sorted(
                    semantic for semantic, target in semantic_map.items() if target == name
                ),
                "availability": apple["availability"].get(name),
                "directionalCandidate": bool(
                    re.search(r"arrow|left|right|forward|backward|leading|trailing", name)
                ),
                "sourcePath": source_path,
                "runtimePath": runtime_path,
                "sha256": asset.sha256,
                "aliases": symbol_aliases,
                "template": meta,
                "runtime": {
                    "master": "Regular-S",
                    "viewBox": runtime_view_box,
                    "pathCount": path_count,
                    "rendering": "monochrome-mask",
                },
                "distributionStatus": "review-required",
            }
        )

    output.mkdir(parents=True, exist_ok=True)
    for managed in (output / "source", output / "runtime"):
        if managed.exists():
            shutil.rmtree(managed)
    for relative, data in {**generated_sources, **generated_runtime}.items():
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)

    category_labels = dict(sorted(apple["categoryLabels"].items()))
    catalog = {
        "schemaVersion": 1,
        "generator": "scripts/import_sf_symbols.py",
        "imports": imports,
        "metadataSource": apple["source"],
        "runtimePreset": "Regular-S monochrome with 2.5% optical padding",
        "categoryLabels": category_labels,
        "symbolCount": len(entries),
        "aliasCount": len(aliases),
        "symbols": entries,
    }
    write_json(output / "catalog.json", catalog)
    write_json(output / "aliases.json", dict(sorted(aliases.items())))

    with (output / "catalog.csv").open("w", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(
            [
                "name",
                "primary_category",
                "apple_categories",
                "cueola_tags",
                "semantic_names",
                "availability",
                "source_path",
                "runtime_path",
                "aliases",
            ]
        )
        for entry in entries:
            writer.writerow(
                [
                    entry["name"],
                    entry["primaryCategory"],
                    ";".join(entry["appleCategories"]),
                    ";".join(entry["cueolaTags"]),
                    ";".join(entry["semanticNames"]),
                    entry["availability"] or "",
                    entry["sourcePath"],
                    entry["runtimePath"],
                    ";".join(entry["aliases"]),
                ]
            )
    write_catalog_html(output / "index.html", catalog)

    print(
        f"Imported {len(incoming)} SVG files; catalog now has {len(entries)} symbols "
        f"and {len(aliases)} aliases in {output}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, ValueError, ET.ParseError, zipfile.BadZipFile) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
