#!/usr/bin/env node
/* Generates the original "Podcast" badge pack for KeyWi Bird key art:
 * neon-warm text badges tuned for the 18-35 podcast crowd (CLIP THAT,
 * HOT TAKE, MIC DROP, NO CAP, ...) drawn as self-contained SVGs into
 * assets/keywi-art/podcast/.
 *
 * All artwork here is generated in-repo and original: short phrases and
 * letterforms carry no copyright, so this pack ships clean. Rerun after
 * editing BADGES, then rerun build-keywi-art-manifest.mjs so the key editor
 * sees the new files (and bump-cache.mjs so browsers pick up the manifest).
 *     node scripts/make-podcast-badges.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'keywi-art', 'podcast');
mkdirSync(outDir, { recursive: true });

// [file, text lines, color A, color B] — warm podcast palette with a few cool pops
const BADGES = [
  ['clip-that',  ['CLIP', 'THAT'],  '#ff8a00', '#ff3d71'],
  ['hot-take',   ['HOT', 'TAKE'],   '#ff3d71', '#ffb300'],
  ['mic-drop',   ['MIC', 'DROP'],   '#7c4dff', '#00e5ff'],
  ['no-cap',     ['NO', 'CAP'],     '#00e5ff', '#00ff9d'],
  ['real',       ['REAL'],          '#00ff9d', '#f5e960'],
  ['banger',     ['BANGER'],        '#ffb300', '#ff5ff0'],
  ['cooked',     ['COOKED'],        '#ff8a00', '#b91c1c'],
  ['locked-in',  ['LOCKED', 'IN'],  '#5b8df8', '#00e5ff'],
  ['aura',       ['AURA'],          '#b06ef8', '#ff5ff0'],
  ['rent-free',  ['RENT', 'FREE'],  '#f5e960', '#00ff9d'],
  ['big-w',      ['W'],             '#00ff9d', '#00e5ff'],
  ['big-l',      ['L'],             '#ff3d71', '#ff8a00'],
  ['goat',       ['GOAT'],          '#ffd700', '#ff8a00'],
  ['lets-go',    ['LETS', 'GO'],    '#00e5ff', '#ffb300'],
];

function badgeSvg(lines, a, b) {
  const S = 240, id = Math.random().toString(36).slice(2, 8);
  const multi = lines.length > 1;
  const longest = Math.max(...lines.map(l => l.length));
  const fs = multi ? (longest >= 6 ? 62 : 78) : (longest >= 5 ? 52 : longest >= 3 ? 78 : 120);
  const text = lines.map((ln, i) => {
    const y = multi ? 96 + i * 82 : 132;
    return `<text x="120" y="${y}" text-anchor="middle" dominant-baseline="middle"
      font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900"
      font-size="${fs}" fill="url(#g${id})" stroke="#0b0d14" stroke-width="3" paint-order="stroke">${ln}</text>`;
  }).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
    </linearGradient>
    <linearGradient id="bg${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#12141d"/><stop offset="1" stop-color="#07080d"/>
    </linearGradient>
  </defs>
  <rect width="${S}" height="${S}" rx="36" fill="url(#bg${id})"/>
  <rect x="7" y="7" width="${S - 14}" height="${S - 14}" rx="30" fill="none" stroke="${a}" stroke-opacity="0.85" stroke-width="6"/>
  <rect x="16" y="16" width="${S - 32}" height="${S - 32}" rx="24" fill="none" stroke="${b}" stroke-opacity="0.35" stroke-width="3"/>
  ${text}
  <rect x="70" y="${multi ? 196 : 176}" width="100" height="8" rx="4" fill="url(#g${id})"/>
</svg>
`;
}

let n = 0;
for (const [file, lines, a, b] of BADGES) {
  writeFileSync(join(outDir, `${file}.svg`), badgeSvg(lines, a, b));
  n++;
}
console.log(`Wrote ${n} podcast badges to assets/keywi-art/podcast/`);
