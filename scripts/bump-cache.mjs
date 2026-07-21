#!/usr/bin/env node
/* Content-hash cache busting for Cueola's no-build pages.
 *
 * Every versioned asset gets `?v=<first 10 hex of its SHA-256>` and every
 * reference in the HTML pages is rewritten in one shot — no more hand-bumped
 * letters, no stale-cache drift between assets that changed and versions that
 * didn't. Idempotent: unchanged files produce unchanged pages. The Phase 2
 * service worker derives its cache name from these same `?v=` values, so this
 * script doubles as its invalidation switch.
 *
 * Zero dependencies (hashing via WebCrypto, available in Node 18+ and
 * browsers). Run before shipping, after check-contracts:
 *     node scripts/bump-cache.mjs          # rewrite pages in place
 *     node scripts/bump-cache.mjs --dry    # show what would change
 *
 * Pure logic is exported so it can run in a browser against fetched sources
 * (how it is verified in this repo's preview).
 */

export const ASSETS = [
  'cueola-entitlements.js',
  'cueola-avatar-profile.js',
  'cueola-assignment-model.js',
  'cueola-session-clone.js',
  'cueola-export-model.js',
  'cueola-prepro-sync.js',
  'cueola-identity.js',
  'cueola-admin-auth.js',
  'cueola-live-session.js',
  'cueola-link-state.js',
  'cueola-keymap.js',
  'cueola-prompter-session.js',
  'cueola-script-operator-protocol.js',
  'script-operator.js',
  'script-operator.css',
  'outrangutan/output-protocol.js',
  'outrangutan/output-command-queue.js',
  'outrangutan/stream-deck-label.js',
  'cueola-app.js',
  'outrangutan/outrangutan.js',
  'outrangutan/outrangutan.css',
  'assets/sf-symbols.css',
];
// sw.js repeats the explicit versioned shell URLs. Rewriting it from the same
// hashes makes the service-worker cache name change mechanically with assets.
export const PAGES = ['index.html', 'dashboard.html', 'script-operator.html', 'outrangutan/output.html', 'sw.js'];

const VERSIONED_REF_RE = /["'(]([\w./-]+\.(?:js|css))\?v=([\w.-]+)/g;

export async function hashText(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function rewriteVersions(pageText, versionByAsset) {
  const changes = [];
  let out = pageText;
  for (const [asset, hash] of Object.entries(versionByAsset)) {
    const re = new RegExp(`(["'(])((?:\\.\\./)*${escapeRegex(asset)})\\?v=([\\w.-]+)`, 'g');
    out = out.replace(re, (whole, quote, path, oldV) => {
      if (oldV !== hash) changes.push({ asset, from: oldV, to: hash });
      return `${quote}${path}?v=${hash}`;
    });
  }
  return { text: out, changes };
}

/* Versioned references a page carries that are NOT in ASSETS — future files
 * someone forgot to register here would silently stop being bumped. */
export function findUnmanagedRefs(pageText) {
  const unmanaged = new Set();
  for (const m of pageText.matchAll(VERSIONED_REF_RE)) {
    const normalized = m[1].replace(/^(?:\.\.\/)+/, '');
    if (!ASSETS.includes(normalized)) unmanaged.add(m[1]);
  }
  return [...unmanaged];
}

/* assets/pages: [{path, text}] → { versions, results: [{path, text, changes}], unmanaged } */
export async function computeBumps(assets, pages) {
  const versions = {};
  for (const a of assets) versions[a.path] = await hashText(a.text);
  const results = [];
  const unmanaged = new Set();
  for (const p of pages) {
    const { text, changes } = rewriteVersions(p.text, versions);
    findUnmanagedRefs(p.text).forEach(u => unmanaged.add(u));
    results.push({ path: p.path, text, changes });
  }
  return { versions, results, unmanaged: [...unmanaged] };
}

const isNode = typeof process !== 'undefined' && !!process.versions?.node;
if (isNode) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dry = process.argv.includes('--dry');
  const load = path => ({ path, text: readFileSync(join(root, path), 'utf8') });

  const { versions, results, unmanaged } = await computeBumps(ASSETS.map(load), PAGES.map(load));
  for (const [asset, hash] of Object.entries(versions)) console.log(`  ${hash}  ${asset}`);
  let total = 0;
  for (const r of results) {
    for (const c of r.changes) { total++; console.log(`  ${r.path}: ${c.asset} ?v=${c.from} → ?v=${c.to}`); }
    if (!dry && r.changes.length) writeFileSync(join(root, r.path), r.text);
  }
  if (unmanaged.length) {
    console.warn(`  WARNING: versioned refs not managed by this script: ${unmanaged.join(', ')}`);
    console.warn('  Add them to ASSETS in scripts/bump-cache.mjs so they keep getting bumped.');
  }
  console.log(total ? `${dry ? 'Would rewrite' : 'Rewrote'} ${total} reference${total === 1 ? '' : 's'}.` : 'All references already current.');
}
