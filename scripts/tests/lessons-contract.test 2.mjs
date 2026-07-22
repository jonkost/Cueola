// Phase 11: the dual-authoring kill-switch. content-reference.md is GENERATED
// from LEARNING_LESSONS — this suite fails the moment they drift (the old
// hand-maintained copy drifted twice: a missing outrangutan row and a stale
// plandabear one), and pins every cross-reference a lesson edit can break.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { extractLessons, buildDoc, narrationText, spokenForm } from '../generate-content-reference.mjs';

const app = await readFile(new URL('../../cueola-app.js', import.meta.url), 'utf8');
const lessons = extractLessons(app);

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('content-reference.md is exactly what the generator produces', async () => {
  const doc = await readFile(new URL('../../docs/content-reference.md', import.meta.url), 'utf8');
  assert.equal(doc, buildDoc(lessons),
    'docs/content-reference.md is stale — run: node scripts/generate-content-reference.mjs (then the Kokoro batch with --force-ref for changed rows)');
});

test('the generator narration template mirrors learningNarrationText()', () => {
  // The generator reimplements the in-app composition; if the app-side
  // template changes shape, this must fail so both move together.
  const start = app.indexOf('function learningNarrationText(');
  const body = app.slice(start, start + 700);
  assert.match(body, /Where to go \$\{i \+ 1\}\. \$\{item\}/);
  assert.match(body, /Step \$\{i \+ 1\}\. \$\{step\}/);
  assert.match(body, /\$\{title\}\. \$\{text\}/);
  // Anchored to the closing backtick-semicolon — an unanchored match let a
  // SUFFIX addition (e.g. appending ${checks}) slip past the whole suite.
  assert.match(body, /return `\$\{lesson\.title\}\. \$\{lesson\.intro\} \$\{navigation\} \$\{steps\} \$\{callouts\}`;/);
  const sample = lessons[0];
  assert.ok(narrationText(sample).startsWith(`${sample.title}. ${sample.intro}`));
});

test('every lesson has narration audio in the manifest, on disk, and FRESH', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../assets/narration/af_heart/manifest.json', import.meta.url), 'utf8'));
  const listed = new Set(manifest.files);
  for (const lesson of lessons) {
    const refId = `LH-${lesson.id}.lesson`;
    assert.ok(listed.has(refId), `manifest.json is missing ${refId} — run the Kokoro batch`);
    await access(new URL(`../../assets/narration/af_heart/${refId}.mp3`, import.meta.url));
    // Freshness: the manifest records the row-text hash each MP3 was
    // synthesized from; a lesson edit without --force-ref leaves the old
    // hash behind and fails here instead of shipping stale audio silently.
    const expected = createHash('sha256').update(spokenForm(narrationText(lesson))).digest('hex').slice(0, 12);
    assert.equal(manifest.texts?.[refId], expected,
      `${refId} audio is STALE — regenerate with: .venv-kokoro/bin/python scripts/generate_cueola_narration.py --force-ref ${refId}`);
  }
});

test('INFO_POPS Learn-more targets point at real lessons and real section anchors', () => {
  const ids = new Set(lessons.map(l => l.id));
  const block = app.slice(app.indexOf('const INFO_POPS = {'), app.indexOf('};', app.indexOf('const INFO_POPS = {')));
  const lessonRefs = [...block.matchAll(/lesson: '([a-z-]+)'/g)].map(m => m[1]);
  assert.ok(lessonRefs.length >= 5, 'INFO_POPS lost its lesson deep-links');
  for (const ref of lessonRefs) assert.ok(ids.has(ref), `INFO_POPS points at unknown lesson '${ref}'`);
  const sectionRefs = [...block.matchAll(/section: '([a-z-]+)'/g)].map(m => m[1]);
  for (const ref of sectionRefs) {
    assert.ok(['where', 'steps', 'know', 'check'].includes(ref), `INFO_POPS section '${ref}' has no anchor`);
    assert.ok(app.includes(`id="guide-sec-${ref}"`), `renderLearningLesson lost anchor guide-sec-${ref}`);
  }
});

test('every lesson action token has an openGuideAction handler', () => {
  const handler = app.slice(app.indexOf('function openGuideAction('), app.indexOf('function markPaperworkDirty'));
  for (const lesson of lessons) {
    for (const [, action] of lesson.actions || []) {
      assert.ok(handler.includes(`'${action}'`), `openGuideAction has no branch for action '${action}' (lesson ${lesson.id})`);
    }
  }
});

for (const { name, run } of tests) {
  await run();
  console.log('PASS', name);
}
console.log(`PASS ${tests.length} lessons contract tests`);
