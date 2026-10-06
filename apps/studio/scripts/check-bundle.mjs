#!/usr/bin/env node
/**
 * Keeps the web builds split: what the page loads up front stays under a
 * budget, and none of it is engine handoff code (loaded when the handoff is
 * opened, or exported on save) or three.js (loaded when a level's 3D graybox
 * is opened). Run after `npm run build:web`:
 * `node scripts/check-bundle.mjs [out/web out/preview]`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Up front: the entry and React. They come to about 439 kB minified today (October 2026), with room to grow before anything new must load on demand. */
const BUDGET = 480 * 1024;
/** Only engine runtime source, or three.js, says these; none of it belongs in the first load. */
const LAZY_MARKERS = ['VcgsCore', 'VCGSStory', 'StoryWalker', 'WebGLRenderer'];

const here = resolve(import.meta.dirname, '..');
const dirs = process.argv.length > 2 ? process.argv.slice(2) : ['out/web', 'out/preview'];
let failed = false;
const fail = (message) => {
  console.error(`✗ ${message}`);
  failed = true;
};

for (const dir of dirs.map((d) => resolve(here, d))) {
  const html = join(dir, 'index.html');
  if (!existsSync(html)) {
    fail(`${html} is missing. Build it first.`);
    continue;
  }
  const upFront = [...readFileSync(html, 'utf8').matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  let total = 0;
  for (const file of upFront) {
    const text = readFileSync(join(dir, file), 'utf8');
    total += statSync(join(dir, file)).size;
    for (const marker of LAZY_MARKERS) if (text.includes(marker)) fail(`${file} loads up front but carries code meant to load on demand (${marker}).`);
  }
  const chunks = readdirSync(join(dir, 'assets')).filter((f) => f.endsWith('.js'));
  if (!chunks.some((f) => f.startsWith('handoff-'))) fail(`${dir} has no handoff chunk: the handoff is no longer loaded on demand.`);
  if (total > BUDGET) fail(`${dir} loads ${(total / 1024).toFixed(0)} kB up front, over the ${BUDGET / 1024} kB budget.`);
  console.log(`${dir}: ${upFront.length} scripts up front, ${(total / 1024).toFixed(0)} kB; ${chunks.length} chunks in all.`);
}

process.exit(failed ? 1 : 0);
