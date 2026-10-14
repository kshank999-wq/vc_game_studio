/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { entranceAt, groundFloorOf, guidedOrder } from '../model/level/generate';
import { assetOf, frameOf } from '../model/level/geometry';
import { levelsOf } from '../model/level/level';
import { createStructure, updateStructure } from '../model/level/structure';
import { sunkenVault } from '../model/sample';
import { resetPreferences } from '../preferences';

const opened = () => waitFor(() => expect(document.querySelector('.view-loading')).toBeNull(), { timeout: 5000 });

beforeAll(() => {
  globalThis.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetPreferences();
});

describe('generating a building floor by floor', () => {
  it('asks for the way in, lays out the ground floor, then asks for the stairs before the floors above', async () => {
    const base = sunkenVault();
    const lv = levelsOf(base).levels[0]!;
    const made = createStructure(base, { parentId: lv.id, floorId: lv.floors[0]!.id, at: { x: 200, y: 200 }, type: 'apartment', seed: 4 });
    const s = levelsOf(made.project);
    const level = s.levels.find((l) => l.id === made.id)!;
    const ground = groundFloorOf(level)!;
    const second = guidedOrder(level)[1]!;
    const fp = s.items.find((i) => i.levelId === made.id && i.floorId === ground.id && assetOf(s, i).role === 'footprint')!;
    const f = frameOf(s, fp);
    localStorage.setItem('vcgs.project.v1', JSON.stringify(made.project));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    fireEvent.change(screen.getByRole('combobox', { name: 'Level' }), { target: { value: made.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const panel = screen.getByRole('region', { name: 'Generate a layout' });
    const steps = within(panel).getByRole('list', { name: 'Floor by floor' });
    // Nothing can be laid out until the way in is set.
    expect((within(steps).getByRole('button', { name: `Generate ${ground.name}` }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(steps).getByRole('button', { name: `Generate ${second.name}` }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(steps).getByRole('button', { name: 'Set the entrance' }));
    const pick = screen.getByRole('button', { name: 'Click on the outside wall where the entrance goes' });
    fireEvent.keyDown(pick, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Click on the outside wall where the entrance goes' })).toBeNull();
    cleanup();
    // With the way in set (as a click on the south wall sets it), the ground floor is next.
    const entrance = entranceAt(made.project, made.id, { x: f.x, y: f.y + f.d / 2 })!;
    localStorage.setItem('vcgs.project.v1', JSON.stringify(updateStructure(made.project, made.id, { entrance })));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    fireEvent.change(screen.getByRole('combobox', { name: 'Level' }), { target: { value: made.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const panel2 = screen.getByRole('region', { name: 'Generate a layout' });
    fireEvent.click(within(panel2).getByRole('button', { name: `Generate ${ground.name}` }));
    expect(within(panel2).getByRole('status').textContent).toMatch(/^Preview, seed \d+: \d+ rooms/);
    fireEvent.click(within(panel2).getByRole('button', { name: 'Accept' }));
    // Accepted: it asks for the stairs straight away.
    expect(screen.getByRole('button', { name: 'Click where the stairs go up' })).toBeTruthy();
    const steps2 = within(panel2).getByRole('list', { name: 'Floor by floor' });
    expect(steps2.textContent).toContain(`Click on ${ground.name} where the stairs go up.`);
    expect((within(steps2).getByRole('button', { name: `Generate ${second.name}` }) as HTMLButtonElement).disabled).toBe(true);
  });
});
