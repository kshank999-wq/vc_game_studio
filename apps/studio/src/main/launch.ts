import { extname, isAbsolute, resolve } from 'node:path';

/**
 * What the app was asked to open, kept pure so it is tested without Electron.
 *
 * Windows and Linux pass a double-clicked project on the command line (on
 * first launch, and to the running copy as a second instance's argv); macOS
 * sends an `open-file` event instead, sometimes before the app is ready.
 */

/** The first .vcgs file named on a command line, as an absolute path. */
export const projectInArgv = (argv: readonly string[], cwd: string): string | null => {
  // argv[0] is the executable; in development argv[1] is the app folder. Flags are skipped.
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-') || extname(arg).toLowerCase() !== '.vcgs' || arg.includes('\0')) continue;
    // A Windows path is absolute whatever system reads it (and is tested on).
    return isAbsolute(arg) || /^[A-Za-z]:[\\/]|^\\\\/.test(arg) ? arg : resolve(cwd, arg);
  }
  return null;
};

/** Versions as the site publishes them ("0.1.0", "v1.2"); true when `latest` is newer than `current`. */
export const isNewer = (latest: string, current: string): boolean => {
  const parts = (v: string) => v.replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parts(latest), parts(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
};

/** The release the site lists for this platform, from /api/releases. */
export const releaseFor = (
  body: unknown,
  platform: 'windows' | 'macos',
): { version: string; notes: string | null } | null => {
  const releases = (body as { releases?: unknown } | null)?.releases;
  if (!Array.isArray(releases)) return null;
  const found = releases.find((r) => r && typeof r === 'object' && (r as { platform?: unknown }).platform === platform) as
    | { version?: unknown; release_notes?: unknown }
    | undefined;
  return found && typeof found.version === 'string'
    ? { version: found.version, notes: typeof found.release_notes === 'string' ? found.release_notes : null }
    : null;
};
