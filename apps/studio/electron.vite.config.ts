import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { chunkFileNames, vendorChunks } from './chunks';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    // The desktop app is always the full edition.
    define: { __EDITION__: JSON.stringify('full'), __APP_VERSION__: JSON.stringify((JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }).version) },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') }, output: { manualChunks: vendorChunks, chunkFileNames } }, chunkSizeWarningLimit: 1200 },
  },
});
