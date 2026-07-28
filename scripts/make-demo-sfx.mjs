#!/usr/bin/env node
/* Synthesizes the four demo SFX pads for "The Break Room" advanced test show
 * into test-media/ (gitignored, regenerate anywhere: no ffmpeg, no deps).
 *
 *   demo-applause.wav  2.5 s  shaped white noise clap bursts with decay
 *   demo-aww.wav       1.5 s  soft descending sine chorus
 *   demo-rimshot.wav   0.4 s  click plus noise snap
 *   demo-airhorn.wav   1.8 s  detuned saw stack, tasteful volume
 *
 * All files: 44.1 kHz, 16 bit, mono, peak normalized to -3 dBFS.
 * Deterministic (seeded PRNG), so reruns produce byte identical output.
 *
 *   node scripts/make-demo-sfx.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const PEAK = Math.pow(10, -3 / 20); // -3 dBFS

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-media');
mkdirSync(outDir, { recursive: true });

/* ---------- helpers ---------- */

// mulberry32: tiny seeded PRNG so the media set is reproducible
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function onePoleLP(cutoffHz) {
  const k = 1 - Math.exp((-2 * Math.PI * cutoffHz) / SR);
  let y = 0;
  return (x) => (y += k * (x - y));
}

function onePoleHP(cutoffHz) {
  const lp = onePoleLP(cutoffHz);
  return (x) => x - lp(x);
}

function normalize(buf) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max === 0) return buf;
  const g = PEAK / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

function writeWav(name, samples) {
  const n = samples.length;
  const bytes = Buffer.alloc(44 + n * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + n * 2, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16); // PCM fmt chunk size
  bytes.writeUInt16LE(1, 20); // PCM
  bytes.writeUInt16LE(1, 22); // mono
  bytes.writeUInt32LE(SR, 24);
  bytes.writeUInt32LE(SR * 2, 28); // byte rate
  bytes.writeUInt16LE(2, 32); // block align
  bytes.writeUInt16LE(16, 34); // bits per sample
  bytes.write('data', 36);
  bytes.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    bytes.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  const path = join(outDir, name);
  writeFileSync(path, bytes);
  console.log(`${name}  ${bytes.length} bytes  ${(n / SR).toFixed(2)} s`);
}

/* ---------- 1. applause: shaped white noise bursts with decay ---------- */

function renderApplause() {
  const dur = 2.5;
  const n = Math.round(dur * SR);
  const rng = makeRng(0xc1ea01a);

  // amplitude field: many short clap impulses, dense while the crowd is hot
  const env = new Float64Array(n);
  const clapCount = 240;
  for (let c = 0; c < clapCount; c++) {
    const t0 = rng() * 2.35;
    const amp = 0.4 + 0.6 * rng();
    const tau = 0.004 + 0.008 * rng(); // per clap decay, 4 to 12 ms
    const start = Math.round(t0 * SR);
    const span = Math.min(n - start, Math.round(0.06 * SR));
    for (let i = 0; i < span; i++) {
      env[start + i] += amp * Math.exp(-i / (tau * SR));
    }
  }

  const hp = onePoleHP(500);
  const lp = onePoleLP(5500);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // crowd swell: quick rise, hold, then die away over the back second
    let g = t < 0.12 ? t / 0.12 : 1;
    if (t > 1.3) g *= Math.exp(-(t - 1.3) / 0.45);
    if (t > dur - 0.08) g *= (dur - t) / 0.08; // clean tail, no end click
    const noise = rng() * 2 - 1;
    out[i] = lp(hp(noise * env[i])) * g;
  }
  return normalize(out);
}

/* ---------- 2. aww: soft descending sine chorus ---------- */

function renderAww() {
  const dur = 1.5;
  const n = Math.round(dur * SR);
  // G major hue, each chord tone doubled with a light detune for chorus width
  const chord = [392, 494, 587.33];
  const voices = [];
  for (const f of chord) {
    voices.push({ f: f * 0.9975, phase: 0, amp: 0.5 });
    voices.push({ f: f * 1.0025, phase: 0, amp: 0.5 });
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const glide = 1 - 0.22 * (t / dur) * (t / dur); // eased slide down ~4 semitones
    const vib = 1 + 0.003 * Math.sin(2 * Math.PI * 5 * t);
    let a = t < 0.2 ? 0.5 - 0.5 * Math.cos((Math.PI * t) / 0.2) : 1;
    if (t > 1.0) a *= 0.5 + 0.5 * Math.cos((Math.PI * (t - 1.0)) / 0.5);
    let s = 0;
    for (const v of voices) {
      v.phase += (2 * Math.PI * v.f * glide * vib) / SR;
      s += v.amp * Math.sin(v.phase);
    }
    out[i] = s * a;
  }
  return normalize(out);
}

/* ---------- 3. rimshot: click plus noise snap ---------- */

function renderRimshot() {
  const dur = 0.4;
  const n = Math.round(dur * SR);
  const rng = makeRng(0x51de511);
  const clickHP = onePoleHP(2500);
  const snapHP = onePoleHP(1200);
  const snapLP = onePoleLP(7000);
  const out = new Float64Array(n);
  let tockPhase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // stick click: 2 ms of bright noise right at the front
    const click = t < 0.002 ? clickHP(rng() * 2 - 1) * 1.4 : 0;
    // wood tock: short sine that falls from 330 Hz and dies in ~45 ms
    const tockF = 330 - 150 * Math.min(1, t / 0.05);
    tockPhase += (2 * Math.PI * tockF) / SR;
    const tock = Math.sin(tockPhase) * Math.exp(-t / 0.045) * 0.9;
    // snare snap: band limited noise burst trailing the click
    const snapT = t - 0.002;
    const snap =
      snapT >= 0
        ? snapLP(snapHP(rng() * 2 - 1)) * Math.exp(-snapT / 0.06) * 1.1
        : 0;
    let s = click + tock + snap;
    if (t > dur - 0.05) s *= (dur - t) / 0.05;
    out[i] = s;
  }
  return normalize(out);
}

/* ---------- 4. airhorn: detuned saw stack, tasteful volume ---------- */

function renderAirhorn() {
  const dur = 1.8;
  const n = Math.round(dur * SR);
  const base = 415; // the classic G sharp blast
  const detunes = [1, 1.0065, 1 / 1.0065];
  const phases = [0, 0.31, 0.62];
  // two gentle low passes tame the saw edge so it reads fun, not painful
  const lp1 = onePoleLP(2800);
  const lp2 = onePoleLP(2800);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // holds pitch, then sags into the signature droop at the end
    let bend = 1;
    if (t > 1.35) bend = 1 - 0.14 * Math.min(1, (t - 1.35) / 0.4);
    let s = 0;
    for (let v = 0; v < 3; v++) {
      phases[v] = (phases[v] + (base * detunes[v] * bend) / SR) % 1;
      s += (phases[v] * 2 - 1) / 3; // naive saw per voice
    }
    let a = t < 0.03 ? t / 0.03 : 1;
    if (t > 1.62) a *= Math.max(0, 1 - (t - 1.62) / 0.18);
    out[i] = lp2(lp1(s)) * a;
  }
  return normalize(out);
}

/* ---------- run ---------- */

writeWav('demo-applause.wav', renderApplause());
writeWav('demo-aww.wav', renderAww());
writeWav('demo-rimshot.wav', renderRimshot());
writeWav('demo-airhorn.wav', renderAirhorn());
