/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { sunkenVault } from '../model/sample';
import { resetPreferences } from '../preferences';

/** Lazy views: wait until nothing is loading. */
const opened = () => waitFor(() => expect(document.querySelector('.view-loading')).toBeNull());

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

const openLevels = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'LEVELS' }));
  await opened();
};

describe('the Level Designer', () => {
  it('creates the first level, places a room from the library and edits it in the inspector', async () => {
    const { container } = render(<App />);
    await openLevels();
    fireEvent.click(screen.getByRole('button', { name: '+ Create the first level' }));
    expect(screen.getByRole('application', { name: 'Level map' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /to check/ }).textContent).toContain('1 to check');

    // Click a room in the library, then click the map to put it down.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Place Room' }), { button: 0, clientX: 10, clientY: 10 });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    });
    fireEvent.pointerDown(screen.getByRole('application', { name: 'Level map' }), { button: 0, clientX: 200, clientY: 150 });
    expect(container.querySelector('.lvl-right-head')!.textContent).toContain('Room');
    expect(container.querySelector('.lvl-right-head')!.textContent).toMatch(/RM_\w+_Room_001/);
    expect(container.querySelector('.lvl-space')).toBeTruthy();

    // The inspector's width is the map's width.
    const width = screen.getByRole('textbox', { name: 'Width' });
    fireEvent.change(width, { target: { value: '12' } });
    fireEvent.blur(width);
    expect(container.querySelector('.lvl-map')!.textContent).toContain('12 m × 6 m');
    expect(screen.getByRole('button', { name: 'Reset Width' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset Width' }));
    expect(container.querySelector('.lvl-map')!.textContent).toContain('8 m × 6 m');

    // Undo takes back the reset, one step.
    act(() => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });
    expect(container.querySelector('.lvl-map')!.textContent).toContain('12 m × 6 m');
  });

  it('says so when the graybox cannot use WebGL', async () => {
    const p = sunkenVault();
    localStorage.setItem('vcgs.project.v1', JSON.stringify(p));
    render(<App />);
    await openLevels();
    fireEvent.click(screen.getByRole('button', { name: '3D graybox' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('needs WebGL'));
  });

  it('goes from a Bible entry to its place in the level, and from the level back to the scene', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'GAME BIBLE' }));
    await opened();
    fireEvent.click(screen.getAllByText('Vault Key')[0]!);
    const uses = container.querySelector('.level-uses')!;
    // The key itself, and the door that needs it.
    const labels = [...uses.querySelectorAll('.use-label')].map((l) => l.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Vault Key', 'Bronze Door']));
    fireEvent.click([...uses.querySelectorAll('button')].find((b) => b.querySelector('.use-label')!.textContent === 'Vault Key')!);
    await opened();
    expect(container.querySelector('.lvl-right-head')!.textContent).toContain('INV_SiltCamp_VaultKey_001');

    // Select the vault chamber from the outliner; its scene link opens the scene.
    fireEvent.click(screen.getByRole('tab', { name: /Outliner/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Vault Chamber$/ }));
    fireEvent.click(screen.getByRole('button', { name: /SC-\d+ The Vault Door/ }));
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('The Vault Door');
  });
});
