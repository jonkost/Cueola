#!/usr/bin/env node
/* Re-inlines the brand SVGs into the page sprites.
 *
 * The pages reference brand art via <svg class="brand-ico"><use href="#ic-NAME"/></svg>
 * against an inline <symbol> sprite (index.html, dashboard.html). Whenever a
 * file in assets/Brand/ changes, run:
 *     node scripts/inline-brand-icons.mjs
 * and the matching <symbol> blocks are rewritten in place: class styles become
 * fill/style attributes, and every id (gradients, groups) is namespaced with a
 * per-icon prefix so the icons can share one sprite without collisions.
 * mix-blend-mode declarations are carried through as inline styles inside the
 * symbol's isolation group; verify rendering in the preview after running.
 * KeyWi_icon.svg is referenced as an <img>, not sprited, so it never needs
 * this. Brand SVGs are precached UNVERSIONED by sw.js: artwork changes also
 * need a WORKER_SCHEMA bump there.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ICONS = [
  { src: 'assets/Brand/Cueola_Icon.svg', symbol: 'ic-cueola', prefix: 'cue3', pages: ['index.html', 'dashboard.html'] },
  { src: 'assets/Brand/Flowmingo_Icon.svg', symbol: 'ic-flowmingo', prefix: 'flow3', pages: ['index.html'] },
  { src: 'assets/Brand/Planda_Bear_icon.svg', symbol: 'ic-plandabear', prefix: 'pb3', pages: ['index.html', 'dashboard.html'] },
  { src: 'assets/Brand/Outrangutan_icon.svg', symbol: 'ic-outrangutan', prefix: 'og3', pages: ['index.html'] },
];

function parseStyleRules(styleText) {
  const rules = {};
  for (const m of styleText.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
    for (const sel of m[1].split(',')) {
      const cls = sel.trim().replace(/^\./, '');
      if (!cls) continue;
      rules[cls] = { ...(rules[cls] || {}), ...decls };
    }
  }
  return rules;
}

function convert(svgText, symbolId, prefix) {
  const vb = (svgText.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 1024 1024';
  let body = svgText.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const styleMatch = body.match(/<style>([\s\S]*?)<\/style>\s*/);
  const rules = styleMatch ? parseStyleRules(styleMatch[1]) : {};
  if (styleMatch) body = body.replace(styleMatch[0], '');
  // class="cls-a cls-b" -> merged fill / style attributes
  body = body.replace(/class="([^"]+)"/g, (_, classes) => {
    const merged = {};
    for (const c of classes.trim().split(/\s+/)) Object.assign(merged, rules[c] || {});
    const fill = merged.fill;
    const styleProps = Object.entries(merged).filter(([k]) => k !== 'fill');
    let out = '';
    if (fill) out += `fill="${fill}"`;
    if (styleProps.length) out += `${out ? ' ' : ''}style="${styleProps.map(([k, v]) => `${k}:${v}`).join(';')}"`;
    return out;
  });
  // Namespace every id and every reference to one.
  const ids = [...body.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    body = body.replace(new RegExp(`id="${esc}"`, 'g'), `id="${prefix}-${id}"`);
    body = body.replace(new RegExp(`url\\(#${esc}\\)`, 'g'), `url(#${prefix}-${id})`);
    body = body.replace(new RegExp(`(xlink:href|href)="#${esc}"`, 'g'), `$1="#${prefix}-${id}"`);
  }
  return `<symbol id="${symbolId}" viewBox="${vb}">\n      <g style="isolation:isolate">\n${body.trim()}\n      </g>\n    </symbol>`;
}

for (const icon of ICONS) {
  const svg = readFileSync(join(root, icon.src), 'utf8');
  const symbol = convert(svg, icon.symbol, icon.prefix);
  for (const page of icon.pages) {
    const path = join(root, page);
    const html = readFileSync(path, 'utf8');
    const re = new RegExp(`<symbol id="${icon.symbol}"[\\s\\S]*?</symbol>`);
    if (!re.test(html)) { console.log(`skip ${page}: no <symbol id="${icon.symbol}">`); continue; }
    writeFileSync(path, html.replace(re, symbol));
    console.log(`inlined ${icon.src} -> ${page} #${icon.symbol}`);
  }
}
console.log('Done. Brand SVGs are precached unversioned: bump WORKER_SCHEMA in sw.js and run bump-cache.mjs.');
