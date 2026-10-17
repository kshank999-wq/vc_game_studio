/**
 * Packages the app with electron-builder: `node scripts/package.mjs --win` or
 * `--mac`, plus any electron-builder flags (CI adds signing and notarization).
 *
 * A wrapper rather than a bare `electron-builder` script because this is an npm
 * workspace: Electron is hoisted to the repository's node_modules, where
 * electron-builder does not look, so it is told the installed version here.
 * Node rather than shell so the same script runs on the Windows runner.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronVersion = require('electron/package.json').version;
const builder = require.resolve('electron-builder/cli.js');

/**
 * electron-builder 25 hands Azure Artifact Signing its arguments unquoted, so
 * PowerShell splits any path with a space ("VC Game Studio.exe", the
 * uninstaller named after the product) and signing fails. Quote them, once,
 * before packaging; a later electron-builder that quotes them itself is left
 * alone.
 */
const quoteAzureSigningArgs = () => {
  const file = createRequire(builder).resolve('app-builder-lib/out/codeSign/windowsSignAzureManager.js');
  const unquoted = 'return [...res, `-${field}`, value];';
  const quoted = 'return [...res, `-${field}`, `\'${String(value).replace(/\'/g, "\'\'")}\'`];';
  const source = readFileSync(file, 'utf8');
  if (source.includes(unquoted)) writeFileSync(file, source.replace(unquoted, quoted));
};
quoteAzureSigningArgs();

const result = spawnSync(process.execPath, [builder, ...process.argv.slice(2), '--publish', 'never', `-c.electronVersion=${electronVersion}`], {
  stdio: 'inherit',
  cwd: new URL('..', import.meta.url),
});
process.exit(result.status ?? 1);
