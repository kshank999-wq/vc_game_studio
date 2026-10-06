import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BACKUPS_KEPT, backUp, backupFolderFor, saveSafely, stamp, writeAtomically } from '../safe-write';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vcgs-safe-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('safe project writes', () => {
  it('replaces the file whole and leaves no temporary file behind', async () => {
    const file = join(dir, 'Cave.vcgs');
    await writeFile(file, 'old');
    await writeAtomically(file, 'new');
    expect(await readFile(file, 'utf8')).toBe('new');
    expect(await readdir(dir)).toEqual(['Cave.vcgs']);
  });

  it('leaves the old file alone when the write fails', async () => {
    const file = join(dir, 'missing-folder', 'Cave.vcgs');
    await expect(writeAtomically(file, 'new')).rejects.toThrow();
  });

  it('backs up the previous version before a save, at most once every ten minutes', async () => {
    const file = join(dir, 'Cave.vcgs');
    const root = join(dir, 'Backups');
    await writeFile(file, 'v1');
    await saveSafely(file, 'v2', root);
    await saveSafely(file, 'v3', root);
    const folder = backupFolderFor(root, file);
    const copies = await readdir(folder);
    expect(copies).toHaveLength(1);
    expect(await readFile(join(folder, copies[0]!), 'utf8')).toBe('v1');
    expect(await readFile(file, 'utf8')).toBe('v3');
  });

  it('makes no backup of a file that does not exist yet', async () => {
    expect(await backUp(join(dir, 'New.vcgs'), join(dir, 'Backups'))).toBeNull();
  });

  it('keeps the newest twenty copies', async () => {
    const file = join(dir, 'Cave.vcgs');
    const root = join(dir, 'Backups');
    await writeFile(file, 'x');
    const start = Date.UTC(2026, 0, 1);
    for (let i = 0; i < BACKUPS_KEPT + 5; i++) {
      const made = await backUp(file, root, new Date(start + i * 11 * 60_000));
      // Date the copy as made then, so the next one is ten minutes later.
      if (made) await utimes(made, new Date(start + i * 11 * 60_000), new Date(start + i * 11 * 60_000));
    }
    const copies = (await readdir(backupFolderFor(root, file))).sort();
    expect(copies).toHaveLength(BACKUPS_KEPT);
    expect(copies[0]).toBe(stamp(new Date(start + 5 * 11 * 60_000)));
  });

  it('keeps two projects of the same name apart', () => {
    expect(backupFolderFor('/b', '/one/Cave.vcgs')).not.toBe(backupFolderFor('/b', '/two/Cave.vcgs'));
    expect(backupFolderFor('/b', '/one/Cave.vcgs')).toMatch(/Cave [0-9a-f]{8}$/);
  });
});
