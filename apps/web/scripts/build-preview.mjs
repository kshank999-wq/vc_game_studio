/**
 * Builds the studio's preview edition (the whole app, with saving switched
 * off and a way to subscribe) and copies it under public/preview, which the
 * site serves at /preview. Runs before `next build` (the `prebuild` script),
 * so every deployment carries the preview of the same commit.
 *
 * Set SKIP_PREVIEW=1 to build the site alone.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const studio = resolve(here, '../../studio');
const target = resolve(here, '../public/preview');

if (process.env.SKIP_PREVIEW === '1') {
  console.log('build-preview: skipped (SKIP_PREVIEW=1)');
  process.exit(0);
}

execFileSync('npx', ['vite', 'build', '--config', 'vite.web.config.mts'], {
  cwd: studio,
  stdio: 'inherit',
  env: { ...process.env, VCGS_EDITION: 'preview', VCGS_BASE: '/preview/' },
});

const built = resolve(studio, 'out/preview');
if (!existsSync(resolve(built, 'index.html'))) throw new Error(`build-preview: no index.html in ${built}`);
rmSync(target, { recursive: true, force: true });
cpSync(built, target, { recursive: true });
console.log(`build-preview: copied ${built} to ${target}`);
