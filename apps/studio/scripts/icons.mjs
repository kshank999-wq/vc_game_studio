/**
 * Draws the app icon at 1024 px from the mark (a gold diamond over the story
 * spine, the same glyph as vc-gamestudio.com's header) with the Chromium that
 * Playwright drives. Two files, as VC Writer has: build/icon.png square for
 * Windows, build/icon-mac.png on the rounded tile macOS expects. electron-builder
 * derives the .ico and .icns from them. Regenerate with `node scripts/icons.mjs`.
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const mark = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect x="2" y="15.2" width="28" height="1.6" fill="#8a6f2f"/>
  <path d="M16 4 L26.5 16 L16 28 L5.5 16 Z" fill="none" stroke="#c9a45c" stroke-width="1.6"/>
  <path d="M16 10.5 L20.8 16 L16 21.5 L11.2 16 Z" fill="#e8c872"/>
</svg>`;

const page = (rounded) => `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:1024px;height:1024px;display:grid;place-items:center;${rounded ? 'padding:100px;box-sizing:border-box' : ''}">
  <div style="width:100%;height:100%;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,#1a170e,#0b0a07 70%);${rounded ? 'border-radius:185px;box-shadow:0 0 0 2px #332b17 inset' : ''}">
    ${mark(rounded ? 700 : 860)}
  </div>
</div></body></html>`;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const tab = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
for (const [file, rounded] of [['icon.png', false], ['icon-mac.png', true]]) {
  await tab.setContent(page(rounded));
  await tab.screenshot({ path: resolve(import.meta.dirname, '../build', file), omitBackground: true });
}
await browser.close();
console.log('build/icon.png, build/icon-mac.png');
