#!/usr/bin/env python3
"""Synthesize weight-correct runtime SVGs for Cueola's template-less symbols.

Thirteen catalog symbols are "runtime-only": they were hand-added as final
Regular-weight outlines and have no Apple template in source/, so
import_sf_symbols.py cannot re-extract them at another weight (it carries their
bytes through unchanged). For the solid .fill glyphs that is correct — SF fill
variants barely change with weight. But the simple STROKED glyphs (the two
chevrons, the ring, the drag bars) would sit visibly heavy next to a thinner
set, so this script rebuilds them analytically:

  * centerline geometry was measured once from the original Regular outlines
    (canvas isPointInPath scanline sampling at 0.01–0.02 units), and is kept
    fixed across weights so optical size does not drift;
  * stroke widths scale by the ratio of Apple's own bar-stroke widths, measured
    from the templated `pause` glyph at each master and interpolated exactly
    like import_sf_symbols.py interpolates template masters.

`timer` (a stopwatch outline) is deliberately NOT synthesized — its geometry is
too complex to rebuild faithfully. It stays at Regular until a real template is
exported from the SF Symbols app.

Run AFTER import_sf_symbols.py, e.g.:
    python3 scripts/import_sf_symbols.py design-system/apple/symbols/source --weight light
    python3 scripts/synthesize_runtime_symbols.py --weight light
    python3 scripts/build_sf_symbol_css.py
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SYMBOLS = REPO_ROOT / "design-system" / "apple" / "symbols"
SVG_NS = "http://www.w3.org/2000/svg"

# Apple bar-stroke width per weight, measured from the templated `pause` glyph
# (masters measured; the rest interpolate on the SF weight axis exactly like
# the template masters do).
MASTER_STROKE = {100.0: 2.19, 400.0: 7.50, 900.0: 16.60}  # ultralight, regular, black
WEIGHT_AXIS = {
    "ultralight": 100.0,
    "thin": 200.0,
    "light": 300.0,
    "regular": 400.0,
    "medium": 500.0,
    "semibold": 600.0,
    "bold": 700.0,
    "heavy": 800.0,
    "black": 900.0,
}


def stroke_scale(weight: str) -> float:
    """Bar-stroke width at `weight` relative to Regular."""
    position = WEIGHT_AXIS[weight]
    if position <= 400.0:
        lo, hi = 100.0, 400.0
    else:
        lo, hi = 400.0, 900.0
    t = (position - lo) / (hi - lo)
    width = MASTER_STROKE[lo] + (MASTER_STROKE[hi] - MASTER_STROKE[lo]) * t
    return width / MASTER_STROKE[400.0]


def fmt(value: float) -> str:
    rounded = f"{value:.3f}".rstrip("0").rstrip(".")
    return "0" if rounded in {"-0", ""} else rounded


def svg_doc(symbol_name: str, path_d: list[str], bounds: tuple[float, float, float, float]) -> str:
    min_x, min_y, max_x, max_y = bounds
    padding = max(max_x - min_x, max_y - min_y) * 0.025
    view_box = " ".join(
        fmt(v)
        for v in (min_x - padding, min_y - padding, max_x - min_x + 2 * padding, max_y - min_y + 2 * padding)
    )
    lines = "\n".join(f'  <path d="{d}"/>' for d in path_d)
    return (
        f'<svg xmlns="{SVG_NS}" viewBox="{view_box}" aria-hidden="true" '
        f'data-sf-symbol="{symbol_name}">\n <g fill="black">\n{lines}\n </g>\n</svg>\n'
    )


def chevron(apex, end_a, end_b, width) -> tuple[list[str], tuple[float, float, float, float]]:
    """Round-cap, round-outer-join stroked V (sharp inner corner), as one outline."""
    h = width / 2.0
    ax, ay = apex

    def unit(p, q):
        dx, dy = q[0] - p[0], q[1] - p[1]
        length = math.hypot(dx, dy)
        return dx / length, dy / length

    u1 = unit(end_a, apex)          # leg A -> apex
    u2 = unit(apex, end_b)          # apex -> leg B
    # The V interior faces the open side: from the apex toward the ends' midpoint.
    inward = unit(apex, ((end_a[0] + end_b[0]) / 2, (end_a[1] + end_b[1]) / 2))

    def outer_normal(u):
        candidate = (-u[1], u[0])
        if candidate[0] * inward[0] + candidate[1] * inward[1] < 0:
            return candidate
        return (u[1], -u[0])

    n1 = outer_normal(u1)
    n2 = outer_normal(u2)
    # Inner corner: inner edges intersect on the bisector, h/sin(half V angle)
    # inside the apex; sin comes from the cross product of leg and bisector.
    sin_half = abs(u1[0] * inward[1] - u1[1] * inward[0])
    inner = (ax + inward[0] * h / sin_half, ay + inward[1] * h / sin_half)
    # Arc sweep follows the traversal handedness (sign of the legs' cross
    # product) so any chevron orientation bows its arcs outward.
    sweep = 0 if (u1[0] * u2[1] - u1[1] * u2[0]) < 0 else 1

    p = []
    p.append(f"M{fmt(end_a[0] + n1[0] * h)} {fmt(end_a[1] + n1[1] * h)}")
    p.append(f"L{fmt(ax + n1[0] * h)} {fmt(ay + n1[1] * h)}")
    p.append(f"A{fmt(h)} {fmt(h)} 0 0 {sweep} {fmt(ax + n2[0] * h)} {fmt(ay + n2[1] * h)}")   # outer join
    p.append(f"L{fmt(end_b[0] + n2[0] * h)} {fmt(end_b[1] + n2[1] * h)}")
    p.append(f"A{fmt(h)} {fmt(h)} 0 0 {sweep} {fmt(end_b[0] - n2[0] * h)} {fmt(end_b[1] - n2[1] * h)}")  # cap B
    p.append(f"L{fmt(inner[0])} {fmt(inner[1])}")
    p.append(f"L{fmt(end_a[0] - n1[0] * h)} {fmt(end_a[1] - n1[1] * h)}")
    p.append(f"A{fmt(h)} {fmt(h)} 0 0 {sweep} {fmt(end_a[0] + n1[0] * h)} {fmt(end_a[1] + n1[1] * h)}")  # cap A
    p.append("Z")

    xs = [end_a[0], end_b[0], ax]
    ys = [end_a[1], end_b[1], ay]
    bounds = (min(xs) - h, min(ys) - h, max(xs) + h, max(ys) + h)
    return [" ".join(p)], bounds


def ring(center, outer_r, width) -> tuple[list[str], tuple[float, float, float, float]]:
    cx, cy = center
    inner_r = outer_r - width

    def circle_d(r, sweep):
        return (
            f"M{fmt(cx + r)} {fmt(cy)} "
            f"A{fmt(r)} {fmt(r)} 0 1 {sweep} {fmt(cx - r)} {fmt(cy)} "
            f"A{fmt(r)} {fmt(r)} 0 1 {sweep} {fmt(cx + r)} {fmt(cy)} Z"
        )

    # Opposite winding directions cut the hole under the nonzero fill rule.
    d = circle_d(outer_r, 1) + " " + circle_d(inner_r, 0)
    bounds = (cx - outer_r, cy - outer_r, cx + outer_r, cy + outer_r)
    return [d], bounds


def bars(x_start, x_end, y_centers, height) -> tuple[list[str], tuple[float, float, float, float]]:
    """Horizontal stadium bars; x_start/x_end are the cap-arc centers."""
    h = height / 2.0
    d_parts = []
    for y in y_centers:
        d_parts.append(
            f"M{fmt(x_start)} {fmt(y - h)} L{fmt(x_end)} {fmt(y - h)} "
            f"A{fmt(h)} {fmt(h)} 0 0 1 {fmt(x_end)} {fmt(y + h)} "
            f"L{fmt(x_start)} {fmt(y + h)} "
            f"A{fmt(h)} {fmt(h)} 0 0 1 {fmt(x_start)} {fmt(y - h)} Z"
        )
    bounds = (x_start - h, min(y_centers) - h, x_end + h, max(y_centers) + h)
    return [" ".join(d_parts)], bounds


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weight", choices=sorted(WEIGHT_AXIS, key=WEIGHT_AXIS.get), default="light")
    parser.add_argument("--symbols-dir", type=Path, default=DEFAULT_SYMBOLS)
    args = parser.parse_args()

    scale = stroke_scale(args.weight)
    out_root = args.symbols_dir / "runtime" / f"{args.weight}-small"

    # Regular-weight geometry measured from the original hand-built outlines.
    # Centerlines are held constant; only stroke width follows the weight.
    CHEVRON_W = 8.03   # SF chevrons run optically heavier than the 7.50 bar stroke
    RING_W = 7.45
    BARS_W = 6.62
    jobs = {
        "arrows/chevron.down.svg": chevron(
            apex=(43.8235, -17.892), end_a=(13.498, -48.709), end_b=(74.149, -48.709),
            width=CHEVRON_W * scale,
        ),
        "arrows/chevron.right.svg": chevron(
            apex=(49.198, -35.254), end_a=(18.379, -65.556), end_b=(18.379, -4.952),
            width=CHEVRON_W * scale,
        ),
        "objectsandtools/circle.svg": ring(
            center=(46.264, -40.253), outer_r=39.44, width=RING_W * scale,
        ),
        "objectsandtools/line.3.horizontal.svg": bars(
            x_start=13.027, x_end=84.435, y_centers=(-51.49, -35.20, -18.94),
            height=BARS_W * scale,
        ),
    }

    catalog_path = args.symbols_dir / "catalog.json"
    catalog = json.loads(catalog_path.read_text())
    by_name = {entry["name"]: entry for entry in catalog["symbols"]}

    for rel, (path_d, bounds) in jobs.items():
        name = Path(rel).stem
        doc = svg_doc(name, path_d, bounds)
        destination = out_root / rel
        if not destination.parent.exists():
            raise SystemExit(f"missing runtime directory {destination.parent} — run import_sf_symbols.py first")
        destination.write_text(doc)
        entry = by_name.get(name)
        if entry:
            vb = doc.split('viewBox="')[1].split('"')[0]
            entry["runtime"] = {
                "weight": f"{args.weight} (synthesized)",
                "master": "scripts/synthesize_runtime_symbols.py",
                "viewBox": vb,
                "pathCount": len(path_d),
                "rendering": "monochrome-mask",
                "carriedThrough": False,
            }
        print(f"synthesized {rel} at {args.weight} (stroke ×{scale:.4f})")

    catalog_path.write_text(json.dumps(catalog, indent=2, sort_keys=False) + "\n")
    print("catalog runtime metadata updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
