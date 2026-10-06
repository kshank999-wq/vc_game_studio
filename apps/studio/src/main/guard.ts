import { app, dialog, shell, type BrowserWindow } from 'electron';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isNewer, releaseFor } from './launch';

/**
 * Keeping the app standing: a log of what went wrong, a window that crashed
 * offered back, and a once-a-day check for a newer version.
 *
 * The log is userData/logs/main.log, kept short. Nothing in it leaves the
 * computer; Help › Show logs opens the folder for someone to send to support.
 */

export const logsFolder = (): string => join(app.getPath('userData'), 'logs');

export const log = (message: string): void => {
  try {
    mkdirSync(logsFolder(), { recursive: true });
    const file = join(logsFolder(), 'main.log');
    let previous = '';
    try {
      previous = readFileSync(file, 'utf8');
    } catch {
      // A first line.
    }
    // The newest ~200 kB is plenty to see what happened.
    if (previous.length > 400_000) writeFileSync(file, previous.slice(-200_000));
    appendFileSync(file, `${new Date().toISOString()} ${app.getVersion()} ${message}\n`);
  } catch {
    // Logging must never be what breaks the app.
  }
};

/** Main-process errors are logged rather than taking the app down silently. */
export const guardProcess = (): void => {
  process.on('uncaughtException', (error) => log(`uncaught: ${error.stack ?? error.message}`));
  process.on('unhandledRejection', (reason) => log(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`));
};

/**
 * A window whose page crashed or hung. Its project is safe: the file on disk,
 * and the working copy it keeps as you edit. Offer to reload it.
 */
export const guardWindow = (window: BrowserWindow): void => {
  window.webContents.on('render-process-gone', (_e, details) => {
    log(`window gone: ${details.reason} (exit ${details.exitCode})`);
    if (details.reason === 'clean-exit' || window.isDestroyed()) return;
    const choice = dialog.showMessageBoxSync(window, {
      type: 'error',
      buttons: ['Reload', 'Quit'],
      defaultId: 0,
      message: 'VC Game Studio stopped unexpectedly.',
      detail: 'Your saved file and the working copy of your latest changes are kept. Reload to carry on where you were.',
    });
    if (choice === 0) window.reload();
    else app.quit();
  });
  window.on('unresponsive', () => log('window unresponsive'));
};

const UPDATE_STATE = () => join(app.getPath('userData'), 'update-check.json');
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Once a day, ask the site which version is out, and if it is newer than this
 * one say so, once per version, with a button to the download page. A
 * developer build (not packaged) never asks.
 */
export const checkForUpdate = async (siteUrl: string, getWindow: () => BrowserWindow | null): Promise<void> => {
  if (!app.isPackaged) return;
  let state: { checkedAt?: number; dismissed?: string } = {};
  try {
    state = JSON.parse(readFileSync(UPDATE_STATE(), 'utf8')) as typeof state;
  } catch {
    // Never checked.
  }
  if (state.checkedAt && Date.now() - state.checkedAt < DAY_MS) return;
  try {
    const response = await fetch(`${siteUrl}/api/releases`, { signal: AbortSignal.timeout(10_000) });
    const release = releaseFor(await response.json(), process.platform === 'darwin' ? 'macos' : 'windows');
    state.checkedAt = Date.now();
    if (release && isNewer(release.version, app.getVersion()) && state.dismissed !== release.version) {
      const window = getWindow();
      const options = {
        type: 'info' as const,
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
        message: `VC Game Studio ${release.version} is available.`,
        detail: `You have ${app.getVersion()}.${release.notes ? `\n\n${release.notes}` : ''}\n\nInstall it over this one; your projects and license stay as they are.`,
      };
      const { response: choice } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
      if (choice === 0) await shell.openExternal(`${siteUrl}/download`);
      state.dismissed = release.version;
    }
    writeFileSync(UPDATE_STATE(), JSON.stringify(state));
  } catch (error) {
    // Offline, or the site is down: try again next launch.
    log(`update check: ${error instanceof Error ? error.message : String(error)}`);
  }
};
