/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineHandoff } from '../components/engine/EngineHandoff';
import { planHandoff, recordExport, setTarget } from '../model/handoff';
import { moveItems } from '../model/level/level';
import { sunkenVault } from '../model/sample';
import type { Project } from '../model/types';

afterEach(() => {
  cleanup();
  delete (globalThis as { vcgs?: unknown }).vcgs;
});

/** A desktop bridge over an in-memory folder. */
const fakeDesktop = (disk: Record<string, string>) => {
  const writes: string[][] = [];
  (globalThis as { vcgs?: unknown }).vcgs = {
    platform: 'linux',
    desktop: true,
    pickFolder: async () => '/game',
    checkFolder: async () => ({ exists: true, engineProject: true }),
    writeFiles: async (_: string, files: { path: string; content: string }[]) => {
      writes.push(files.map((f) => f.path));
      for (const f of files) disk[f.path] = f.content;
      return { written: files.length };
    },
    readFiles: async (_: string, paths: string[]) => Object.fromEntries(paths.map((p) => [p, disk[p] ?? null])),
  };
  return writes;
};

const sent = (): { project: Project; disk: Record<string, string>; tscn: string } => {
  let project = setTarget(sunkenVault(), { projectFolder: '/game' });
  const plan = planHandoff(project);
  project = recordExport(project, plan);
  const disk = Object.fromEntries(plan.output!.files.map((f) => [f.path, f.content]));
  return { project, disk, tscn: plan.output!.files.find((f) => f.path.endsWith('levels/sunken_vault.tscn'))!.path };
};

const show = (project: Project, onReplace: (p: Project) => void, says: string[]) =>
  render(<EngineHandoff project={project} onReplace={onReplace} onNavigate={() => {}} onSay={(m) => says.push(m)} />);

describe('sending levels to the engine', () => {
  it('shows what changed in the levels since the last export', () => {
    const { project } = sent();
    const items = planHandoff(project).levels[0]!.items;
    const item = items.find((i) => !i.host && !items.some((o) => o.host?.guid === i.guid) && i.kind !== 'volume')!;
    show(moveItems(project, [item.guid], 1, 0), () => {}, []);
    expect(screen.getByLabelText('Level changes').textContent).toMatch(/\d+ changed/);
    expect(screen.getByText(/^Changed:/).textContent).toContain(item.name);
  });

  it('asks before replacing a file changed in the engine, and can keep the engine’s version', async () => {
    const { project, disk, tscn } = sent();
    disk[tscn] += '\n[node name="Mine" type="Node3D" parent="."]\n';
    const writes = fakeDesktop(disk);
    let replaced: Project | null = null;
    const says: string[] = [];
    show(project, (p) => (replaced = p), says);
    fireEvent.click(screen.getByText('SEND TO GODOT'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain(tscn);
    fireEvent.click(screen.getByText('Keep Godot’s version'));
    await waitFor(() => expect(replaced).not.toBeNull());
    expect(writes[0]).not.toContain(tscn);
    expect(disk[tscn]).toContain('name="Mine"');
    expect(says.at(-1)).toContain('Left 1 as Godot had it.');
  });

  it('overwrites when asked to', async () => {
    const { project, disk, tscn } = sent();
    const mine = disk[tscn] + '\n[node name="Mine" type="Node3D" parent="."]\n';
    disk[tscn] = mine;
    const writes = fakeDesktop(disk);
    show(project, () => {}, []);
    fireEvent.click(screen.getByText('SEND TO GODOT'));
    fireEvent.click(await screen.findByText('Overwrite them'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toContain(tscn);
    expect(disk[tscn]).not.toBe(mine);
  });

  it('sends without asking when nothing was changed in the engine', async () => {
    const { project, disk } = sent();
    const writes = fakeDesktop(disk);
    show(project, () => {}, []);
    fireEvent.click(screen.getByText('SEND TO GODOT'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
