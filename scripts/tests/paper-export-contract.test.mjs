import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const app = readFileSync(join(root, 'cueola-app.js'), 'utf8');
const page = readFileSync(join(root, 'index.html'), 'utf8');
const audio = readFileSync(join(root, 'outrangutan/outrangutan.js'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const bump = readFileSync(join(root, 'scripts/bump-cache.mjs'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing section ${start}`);
  return source.slice(from, to);
}

assert.match(page, /class="paper-export-page is-\$\{orientation\}"|\.paper-export-page\{/);
assert.match(page, /@page cueola-portrait\{size:letter portrait;margin:0\}/);
assert.match(page, /@page cueola-landscape\{size:letter landscape;margin:0\}/);
assert.match(page, /\.paper-export-page thead\{display:table-header-group\}/);
assert.match(page, /\.paper-export-page :is\(p,li,td,th,[^)]+\)\{overflow-wrap:anywhere/);

assert.match(app, /_getDocFromServer/);
assert.match(app, /_getDocsFromServer/);
assert.match(app, /_waitForPendingWrites/);
// The 2026-07-15 export change replaced the whole-document before/after fence
// (every export raced live classroom typing) with a targeted cross-document
// consistency check: the assignment register revision must not move while the
// assignments subcollection downloads.
assert.match(app, /Number\(before\.assignmentRevision\)/);
assert.match(app, /revBefore !== revAfter/);
assert.match(app, /error\.code = 'export-revision-race'/);
assert.match(app, /error:serverAuthority \? _pbLastCloudSaveError : null/);
assert.match(app, /pendingCount:serverAuthority \? _pbPendingNoteWrites : 0/);
assert.match(app, /error:serverAuthority \? _pbLastNoteSaveError : null/);
assert.match(app, /function buildPaperExportDocument\(/);
assert.match(app, /Page \$\{index \+ 1\} of \$\{pages\.length\}/);
assert.match(app, /tableParts = paperExportTableShell/);
assert.match(app, /assignmentRegisterHTML\(snapshot/);
assert.match(app, /snapshot\?\.assignmentGroups/);
assert.match(app, /pbPackageIncludeNotes\s*\?\s*lastPackageExportSnapshot/);
assert.match(app, /snapshot \? snapshot\.options\?\.includeNotes === true : pbPackageIncludeNotes/);
assert.match(app, /<section><div class="paper-landscape">\s*\n\s*<h1>5\. Full Rendered Rundown/);
assert.match(app, /source\.querySelectorAll\('\.sf-symbol'\)/);
assert.match(app, /UNVERIFIED PREVIEW: NOT A SAVED EXPORT/);
assert.match(app, /Image attachment: \$\{esc\(a\.name\)\} \(open the saved original in Cueola\)/);

const formalExports = [
  ['async function downloadCallSheetPDF()', 'async function exportPreProPackagePDF()'],
  ['async function exportPreProPackagePDF()', '// ─────────────────────────────────────────────────────────────\n// PDF EXPORT'],
  ['async function exportPDF()', '// ─────────────────────────────────────────────────────────────\n// HELPERS'],
  ['async function exportProductionNoteById(id)', 'let lastProductionNotesExportSnapshot'],
  ['async function exportProductionNotesPDF()', '/* ══════════════════════════════════════════════════════════════════════'],
];
for (const [start, end] of formalExports) {
  const body = section(app, start, end);
  assert.match(body, /preparePaperworkExportSnapshot|last[A-Za-z]+ExportSnapshot/);
  assert.match(body, /exportPaperHTMLAsPDF/);
  assert.match(body, /printPaperHTML/);
  assert.doesNotMatch(body, /window\.print\(/);
}

const draft = section(app, 'async function pbExportDraftPDF()', 'function pbNoteInputKeydown');
assert.match(draft, /authority:'unpublished'/);
assert.match(draft, /Production note draft/);
assert.match(draft, /printPaperHTML/);
assert.doesNotMatch(draft, /window\.print\(/);

const directPrintCalls = [...app.matchAll(/window\.print\(\)/g)];
assert.equal(directPrintCalls.length, 1, 'only the shared fixed-page print function may call window.print');
assert.ok(app.lastIndexOf('window.print()', directPrintCalls[0].index) === directPrintCalls[0].index);

const showPack = section(audio, 'async function printShowPack()', 'async function exportShowFile()');
assert.match(showPack, /cloneForExport/);
assert.match(showPack, /freezeExportValue/);
assert.match(showPack, /sourceLabel: 'Local Outrangutan snapshot'/);
assert.match(showPack, /window\.printPaperHTML\(html, options\)/);
assert.doesNotMatch(showPack, /[📌↩🔁▶⏸⏹]/u);

assert.match(page, /cueola-export-model\.js\?v=/);
assert.match(sw, /cueola-export-model\.js\?v=/);
assert.match(bump, /'cueola-export-model\.js'/);

console.log('PASS paper export static contract');
