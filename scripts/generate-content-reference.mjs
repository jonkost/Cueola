// Generates docs/content-reference.md from the LEARNING_LESSONS registry in
// cueola-app.js — Phase 11 kills the hand-maintained copy (dual-authoring
// drifted twice: the outrangutan lesson never got a row/MP3, and the
// plandabear row went stale after its v2 rewrite).
//
// The narration text mirrors learningNarrationText() in cueola-app.js
// (title. intro. "Where to go N." "Step N." "CalloutTitle. CalloutText";
// checks/actions excluded), then passes through spokenForm() — the
// TTS-friendly rewrites that used to be hand-applied to individual rows
// (bracket markers, slash pairs, keyboard chords). Pronunciation swaps
// (Cue ah la, Flow mingo, GFX→graphics…) stay in
// scripts/generate_cueola_narration.py, which consumes this file.
//
// Usage:  node scripts/generate-content-reference.mjs          # write
//         node scripts/generate-content-reference.mjs --check  # exit 1 on drift
import { readFile, writeFile } from 'node:fs/promises';

export const APP_SOURCE = new URL('../cueola-app.js', import.meta.url);
export const REFERENCE_DOC = new URL('../docs/content-reference.md', import.meta.url);

export function extractLessons(source) {
  const start = source.indexOf('const LEARNING_LESSONS = [');
  if (start < 0) throw new Error('LEARNING_LESSONS not found in cueola-app.js');
  const end = source.indexOf('\n];', start);
  if (end < 0) throw new Error('LEARNING_LESSONS array end not found');
  const literal = source.slice(start + 'const LEARNING_LESSONS ='.length, end + 3);
  return new Function(`return (${literal.trim().replace(/;$/, '')});`)();
}

// Mirror of learningNarrationText() in cueola-app.js — the contract test
// asserts the two never drift.
export function narrationText(lesson) {
  const navigation = (lesson.navigation || []).map((item, i) => `Where to go ${i + 1}. ${item}`).join(' ');
  const steps = (lesson.steps || []).map((step, i) => `Step ${i + 1}. ${step}`).join(' ');
  const callouts = (lesson.callouts || []).map(([title, text]) => `${title}. ${text}`).join(' ');
  return `${lesson.title}. ${lesson.intro} ${navigation} ${steps} ${callouts}`;
}

export function spokenForm(text) {
  return String(text || '')
    // "[BREAK - AUTO PAUSE]" → "BREAK AUTO PAUSE": strip brackets, drop the dash
    .replace(/\[([^\]]+)\]/g, (_, inner) => inner.replace(/\s+-\s+/g, ' '))
    // code-ish tokens the voice should not spell out
    .replace(/Outrangutan\.midiInject\([^)]*\)/g, 'Outrangutan dot midi inject')
    .replace(/Cmd\+S/g, 'Command S')
    .replace(/Shift\+Esc/g, 'Shift Escape')
    .replace(/\.ogshow/g, ' dot ogshow')
    .replace(/\.cueola/g, ' dot Cueola')
    .replace(/@-?mention(s?)/gi, 'at mention$1')
    // "play/pause" → "play and pause" (word pairs only; no URLs in lessons)
    .replace(/\b([A-Za-z]+)\/([A-Za-z]+)\b/g, '$1 and $2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function escapeCell(text) {
  return text.replace(/\|/g, '\\|');
}

export function buildDoc(lessons) {
  const rows = lessons.map(lesson =>
    `| \`LH-${lesson.id}.lesson\` | Learning Hub | ${escapeCell(spokenForm(narrationText(lesson)))} |`);
  return `# Cueola Content Reference

> GENERATED FILE — do not hand-edit. Regenerate with
> \`node scripts/generate-content-reference.mjs\` after changing
> LEARNING_LESSONS in cueola-app.js, then run the Kokoro batch
> (\`.venv-kokoro/bin/python scripts/generate_cueola_narration.py\`) with
> \`--force-ref <id>\` for every changed row.

These reference IDs power Cueola Learning Hub voice-over. The browser plays
\`assets/narration/af_heart/{referenceId}.mp3\` when the reference appears in the manifest.

| Reference ID | Area | Narration Text |
| --- | --- | --- |
${rows.join('\n')}
`;
}

const isCli = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isCli) {
  const source = await readFile(APP_SOURCE, 'utf8');
  const generated = buildDoc(extractLessons(source));
  if (process.argv.includes('--check')) {
    const current = await readFile(REFERENCE_DOC, 'utf8').catch(() => '');
    if (current !== generated) {
      console.error('docs/content-reference.md is stale — run: node scripts/generate-content-reference.mjs');
      process.exit(1);
    }
    console.log('content-reference.md is in sync.');
  } else {
    await writeFile(REFERENCE_DOC, generated);
    console.log(`Wrote docs/content-reference.md (${generated.split('\n').filter(l => l.startsWith('| `')).length} rows).`);
  }
}
