import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { chunkFileNames, vendorChunks } from './chunks';

/**
 * The renderer built by plain Vite, with no Electron in the process.
 *
 * `VCGS_EDITION=preview` builds the teaser that VC Writer links to: the whole
 * app, with saving switched off and a way to buy. Anything else builds the
 * full edition, which is what local browser development uses.
 */
const edition = process.env['VCGS_EDITION'] === 'preview' ? 'preview' : 'full';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  // Relative by default; vc-gamestudio.com serves the preview under /preview/ (apps/web/scripts/build-preview.mjs).
  base: process.env['VCGS_BASE'] ?? './',
  plugins: [react()],
  define: { __LICENSING__: JSON.stringify(false), __EDITION__: JSON.stringify(edition), __APP_VERSION__: JSON.stringify((JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }).version) },
  build: {
    outDir: resolve(__dirname, edition === 'preview' ? 'out/preview' : 'out/web'),
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: vendorChunks, chunkFileNames } },
    // The graybox chunk is three.js (about 560 kB), fetched only when a level is opened in 3D.
    // What loads up front is held to its own budget by scripts/check-bundle.mjs.
    chunkSizeWarningLimit: 600,
  },
});
