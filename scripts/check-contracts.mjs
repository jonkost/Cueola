#!/usr/bin/env node
/* DOM-contract lint for Cueola's no-build pages.
 *
 * The b3c1a6a merge kept JavaScript while silently dropping the markup it
 * drives — the app "worked" until a click hit a missing element. This lint
 * makes that class of drift a pre-ship failure instead of a show-day surprise:
 *
 *   1. every getElementById('literal') / querySelector('#literal') in a page's
 *      scripts must resolve to an id that exists in that page's HTML, its JS
 *      template strings, or an `el.id = '...'` assignment;
 *   2. every inline on*="handler(...)" attribute (in HTML or in JS template
 *      strings) must call a function name defined in the page's scripts.
 *
 * Dynamic names (anything containing ${…} or string concatenation) are
 * deliberately skipped — only literals are contracts.
 *
 * Zero dependencies. Run before shipping:
 *     node scripts/check-contracts.mjs
 * Exits 1 when a contract is broken.
 *
 * The checking logic is pure and importable, so it can also run in a browser
 * against fetched sources (how it is verified in this repo's preview).
 */

const ID_ATTR_RE = /\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
const ID_ASSIGN_RE = /\.id\s*=\s*(?:"([^"${}]+)"|'([^'${}]+)')/g;
const GET_BY_ID_RE = /getElementById\(\s*(?:"([^"${}]+)"|'([^'${}]+)')\s*\)/g;
const QUERY_ONE_RE = /querySelector(?:All)?\(\s*(?:"#([A-Za-z_][\w-]*)"|'#([A-Za-z_][\w-]*)')\s*\)/g;
const HANDLER_ATTR_RE = /\bon[a-z]+\s*=\s*"([^"]*)"/g;
const FN_DECL_RE = /(?:^|[\s;{}()])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
const WINDOW_ASSIGN_RE = /window\.([A-Za-z_$][\w$]*)\s*=/g;
const TOP_BINDING_RE = /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
const CALL_IN_HANDLER_RE = /(?:^|[;{(]|\breturn\s+|&&\s*|\|\|\s*)\s*([A-Za-z_$][\w$]*)\s*\(/g;
const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const JS_KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'return', 'try', 'catch', 'new', 'typeof', 'void', 'delete', 'in', 'of', 'function']);
const BROWSER_GLOBALS = new Set(['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'alert', 'confirm', 'prompt', 'print', 'fetch']);

function matchAll(re, text, pick) {
  const out = [];
  for (const m of text.matchAll(re)) out.push(pick ? pick(m) : (m[1] ?? m[2]));
  return out;
}

export function collectIds(texts) {
  const ids = new Set();
  const dynamicPatterns = [];
  for (const text of texts) {
    for (const id of matchAll(ID_ATTR_RE, text)) {
      if (!id) continue;
      if (id.includes('${')) {
        // A template-built id like "${scope}-seek" defines a FAMILY of ids.
        // Match literal references against the family instead of flagging them.
        // A fully dynamic id ("${x}") anchors nothing — skipping it, or its
        // ^.+$ pattern would swallow every missing-id and blind the lint.
        const literalPart = id.replace(/\$\{[^}]*\}/g, '');
        if (!/[A-Za-z0-9]/.test(literalPart)) continue;
        const pattern = '^' + id.split(/\$\{[^}]*\}/).map(part =>
          part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+') + '$';
        dynamicPatterns.push(new RegExp(pattern));
      } else {
        ids.add(id);
      }
    }
    for (const id of matchAll(ID_ASSIGN_RE, text)) if (id) ids.add(id);
  }
  return { ids, dynamicPatterns };
}

function idResolves(id, { ids, dynamicPatterns }) {
  return ids.has(id) || dynamicPatterns.some(re => re.test(id));
}

export function collectDefinedNames(jsTexts) {
  const names = new Set();
  for (const text of jsTexts) {
    for (const n of matchAll(FN_DECL_RE, text)) names.add(n);
    for (const n of matchAll(WINDOW_ASSIGN_RE, text)) names.add(n);
    for (const n of matchAll(TOP_BINDING_RE, text)) names.add(n);
  }
  return names;
}

export function collectIdReferences(jsTexts) {
  const refs = [];
  jsTexts.forEach(({ path, text }) => {
    for (const m of text.matchAll(GET_BY_ID_RE)) {
      const id = m[1] ?? m[2];
      if (id) refs.push({ id, path, at: m.index });
    }
    for (const m of text.matchAll(QUERY_ONE_RE)) {
      const id = m[1] ?? m[2];
      if (id) refs.push({ id, path, at: m.index });
    }
  });
  return refs;
}

export function collectHandlerReferences(texts) {
  const refs = [];
  texts.forEach(({ path, text }) => {
    for (const m of text.matchAll(HANDLER_ATTR_RE)) {
      const body = m[1];
      if (!body) continue;
      // Template handlers like onclick="pbToggleCollapse('${id}')" still name
      // a checkable function — only calls INSIDE a ${…} interpolation are
      // dynamic and skipped.
      const dynamicSpans = [...body.matchAll(/\$\{[^}]*\}/g)].map(d => [d.index, d.index + d[0].length]);
      const inDynamic = i => dynamicSpans.some(([a, b]) => i >= a && i < b);
      for (const call of body.matchAll(CALL_IN_HANDLER_RE)) {
        const nameAt = call.index + call[0].indexOf(call[1]);
        if (inDynamic(nameAt)) continue;
        if (!JS_KEYWORDS.has(call[1]) && !BROWSER_GLOBALS.has(call[1])) refs.push({ name: call[1], path, at: m.index });
      }
    }
  });
  return refs;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/* pages: [{ name, html: [{path,text}], js: [{path,text}] }]
 * allowlist: { "missing-id": [...], "missing-handler": [...] } — documented
 * legacy references that must not fail the lint (keep this list shrinking). */
export function checkContracts(pages, allowlist = {}) {
  const errors = [];
  const stats = { pages: 0, idRefs: 0, handlerRefs: 0, allowlisted: 0 };
  const allowed = kind => new Set(allowlist[kind] || []);
  for (const page of pages) {
    stats.pages++;
    const inlineScripts = page.html.flatMap(h => matchAll(INLINE_SCRIPT_RE, h.text, m => m[1]));
    const allJs = [...page.js, ...inlineScripts.map((text, i) => ({ path: `${page.name}#inline${i}`, text }))];
    const idIndex = collectIds([...page.html.map(h => h.text), ...allJs.map(j => j.text)]);
    const defined = collectDefinedNames(allJs.map(j => j.text));

    const idRefs = collectIdReferences(allJs);
    stats.idRefs += idRefs.length;
    const textByPath = new Map([...page.html, ...allJs].map(f => [f.path, f.text]));
    const allowedIds = allowed('missing-id');
    for (const ref of idRefs) {
      if (idResolves(ref.id, idIndex)) continue;
      if (allowedIds.has(ref.id)) { stats.allowlisted++; continue; }
      errors.push({ page: page.name, kind: 'missing-id', name: ref.id, where: `${ref.path}:${lineOf(textByPath.get(ref.path) || '', ref.at)}` });
    }

    const handlerRefs = collectHandlerReferences([...page.html, ...allJs]);
    stats.handlerRefs += handlerRefs.length;
    const allowedHandlers = allowed('missing-handler');
    for (const ref of handlerRefs) {
      if (defined.has(ref.name)) continue;
      if (allowedHandlers.has(ref.name)) { stats.allowlisted++; continue; }
      errors.push({ page: page.name, kind: 'missing-handler', name: ref.name, where: `${ref.path}:${lineOf(textByPath.get(ref.path) || '', ref.at)}` });
    }
  }
  return { errors, stats };
}

/* Which scripts serve which page. Outrangutan rides index.html. */
export const PAGE_CONFIG = [
  { name: 'index', html: ['index.html'], js: ['cueola-app.js', 'cueola-live-session.js', 'cueola-prompter-session.js', 'cueola-script-operator-protocol.js', 'cueola-entitlements.js', 'cueola-avatar-profile.js', 'cueola-assignment-model.js', 'cueola-export-model.js', 'cueola-identity.js', 'outrangutan/output-protocol.js', 'outrangutan/stream-deck-label.js', 'outrangutan/outrangutan.js'] },
  { name: 'script-operator', html: ['script-operator.html'], js: ['cueola-script-operator-protocol.js', 'script-operator.js'] },
  { name: 'outrangutan-output', html: ['outrangutan/output.html'], js: ['outrangutan/output-protocol.js', 'outrangutan/output-command-queue.js'] },
  { name: 'dashboard', html: ['dashboard.html'], js: [] },
];

const isNode = typeof process !== 'undefined' && !!process.versions?.node;
if (isNode) {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const load = path => ({ path, text: readFileSync(join(root, path), 'utf8') });
  let allowlist = {};
  try { allowlist = JSON.parse(readFileSync(join(root, 'scripts/contract-allowlist.json'), 'utf8')); } catch {}
  const pages = PAGE_CONFIG.map(p => ({ name: p.name, html: p.html.map(load), js: p.js.map(load) }));
  const { errors, stats } = checkContracts(pages, allowlist);
  console.log(`contract check · ${stats.pages} pages · ${stats.idRefs} id refs · ${stats.handlerRefs} handler refs · ${stats.allowlisted} allowlisted`);
  if (errors.length) {
    for (const e of errors) console.error(`  BROKEN ${e.kind} "${e.name}" (${e.page}) at ${e.where}`);
    console.error(`\n${errors.length} broken contract${errors.length === 1 ? '' : 's'}`);
    process.exit(1);
  }
  console.log('PASS: every DOM id and inline handler resolves');
}
