/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { levelsOf } from '../model/level/level';
import { createStructure } from '../model/level/structure';
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

describe('the library flyout', () => {
  it('slides out from the maps panel, back in once something is picked, and stays out when locked', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    // The maps and the outliner stay in the left panel; the library is a tab on its edge.
    expect(screen.getByRole('complementary', { name: 'Maps and outliner' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Library' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open the library' }));
    const lib = screen.getByRole('region', { name: 'Library' });
    // Picked: once the press is over, it slides back in.
    fireEvent.pointerDown(within(lib).getByRole('button', { name: 'Place Crate' }), { button: 0, clientX: 10, clientY: 10 });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    });
    expect(screen.queryByRole('region', { name: 'Library' })).toBeNull();
    // Locked out: it stays, beside the map, and is still out next time.
    fireEvent.keyDown(window, { key: 'l' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep the library out' }));
    expect(document.querySelector('.lvl')!.className).toContain('lib-pinned');
    fireEvent.pointerDown(within(screen.getByRole('region', { name: 'Library' })).getByRole('button', { name: 'Place Crate' }), { button: 0, clientX: 10, clientY: 10 });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    });
    expect(screen.getByRole('region', { name: 'Library' })).toBeTruthy();
    expect(localStorage.getItem('vcgs.levels.libraryPinned')).toBe('1');
    cleanup();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    expect(screen.getByRole('region', { name: 'Library' })).toBeTruthy();
    // Unlocked and closed: the tab again.
    fireEvent.click(screen.getByRole('button', { name: 'Close the library' }));
    expect(screen.getByRole('button', { name: 'Open the library' })).toBeTruthy();
    expect(localStorage.getItem('vcgs.levels.libraryPinned')).toBe('0');
  });
});

describe('the Hallway tool', () => {
  it('asks how wide, draws a hallway along the clicks, then fills the floor with rooms round it', async () => {
    const base = sunkenVault();
    const lv = levelsOf(base).levels[0]!;
    const made = createStructure(base, { parentId: lv.id, floorId: lv.floors[0]!.id, at: { x: 200, y: 200 }, type: 'office', seed: 4 });
    localStorage.setItem('vcgs.project.v1', JSON.stringify(made.project));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    fireEvent.change(screen.getByRole('combobox', { name: 'Level' }), { target: { value: made.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Hallway' }));
    const dialog = screen.getByRole('dialog', { name: 'Hallway width' });
    expect(within(dialog).getByRole('radio', { name: /8 ft/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('radio', { name: /4 ft/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Draw it' }));
    expect(screen.getByRole('button', { name: 'Hallway' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /wide$/ }).textContent).toMatch(/1\.22 m wide/);
    expect(localStorage.getItem('vcgs.hallway.width')).toBe('1.2192');
    // Three clicks (an L), then Enter.
    const map = screen.getByRole('application', { name: 'Level map' });
    fireEvent.pointerDown(map, { button: 0, clientX: 100, clientY: 200 });
    fireEvent.pointerDown(map, { button: 0, clientX: 400, clientY: 210 });
    fireEvent.pointerDown(map, { button: 0, clientX: 405, clientY: 420 });
    fireEvent.keyDown(window, { key: 'Enter' });
    const outliner = screen.getByRole('complementary', { name: 'Maps and outliner' });
    expect(within(outliner).getAllByRole('button', { name: /^Hallway [12]$/ })).toHaveLength(2);
    expect(within(outliner).getByRole('button', { name: /^Opening$/ })).toBeTruthy();
    // Then: rooms round it, previewed by the generator with its "Around the hallways" rules.
    const bar = screen.getByRole('note', { name: 'Hallway drawn' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Fill with rooms' }));
    const panel = screen.getByRole('region', { name: 'Generate a layout' });
    expect((within(panel).getByRole('combobox', { name: 'Rules' }) as HTMLSelectElement).value).toBe('hallways');
    // (A preview: how many rooms depends on where the clicks fell, which a test's window, with no size, can't say.)
    expect(within(panel).getByRole('status').textContent).toMatch(/^Preview, seed \d+:/);
    expect(within(panel).getByRole('button', { name: 'Accept' })).toBeTruthy();
  });
});
