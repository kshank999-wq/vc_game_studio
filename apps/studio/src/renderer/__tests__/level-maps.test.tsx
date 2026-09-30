/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
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

describe('worlds, regions and child maps in the Level Designer (spec V2)', () => {
  it('starts a world from a preset, places a zone, opens it as a region and comes back', async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'LEVELS' }));
    await opened();
    fireEvent.click(screen.getByRole('button', { name: '+ Start with a world' }));
    const dialog = screen.getByRole('dialog', { name: 'New world' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Medium world/ }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'World name' }), { target: { value: 'The Drowned Coast' } });
    expect(within(dialog).getByText(/40 km × 40 km, a 250 m grid/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create world' }));
    const crumbs = screen.getByRole('navigation', { name: 'Where you are' });
    expect(within(crumbs).getByRole('button', { name: 'The Drowned Coast' }).getAttribute('aria-current')).toBe('location');
    expect(container.querySelector('.lvl-right-head')!.textContent).toContain('World');
    expect(container.querySelector('.lvl-bounds')!.textContent).toContain('The Drowned Coast · 40 km × 40 km');
    const nav = screen.getByRole('tree', { name: 'Maps' });
    expect(within(nav).getByRole('button', { name: 'The Drowned Coast, world' })).toBeTruthy();

    // An exterior zone on the world, opened as its own map: a region, its size.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Place Exterior zone' }), { button: 0, clientX: 10, clientY: 10 });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    });
    fireEvent.pointerDown(screen.getByRole('application', { name: 'Level map' }), { button: 0, clientX: 200, clientY: 150 });
    fireEvent.click(screen.getByRole('button', { name: 'Open as a map ▸' }));
    expect(within(crumbs).getAllByRole('button').map((b) => b.textContent)).toEqual(['The Drowned Coast', 'Exterior zone', '↑']);
    expect(container.querySelector('.lvl-right-head')!.textContent).toContain('Region');
    expect(within(nav).getByRole('button', { name: 'Exterior zone, region' })).toBeTruthy();
    // Back up to the world, onto the zone, which now says it opens.
    fireEvent.click(screen.getByRole('button', { name: 'Back to the parent map' }));
    expect(within(crumbs).getByRole('button', { name: 'The Drowned Coast' }).getAttribute('aria-current')).toBe('location');
    expect(container.querySelector('.lvl-opens')!.textContent).toContain('▸ Exterior zone');
    expect(screen.getByRole('button', { name: 'Open Exterior zone ▸' })).toBeTruthy();

    // Deleting the world warns about the region inside it.
    fireEvent.click(within(nav).getByRole('button', { name: 'More for The Drowned Coast' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm.textContent).toContain('Delete “The Drowned Coast”?');
    expect(confirm.textContent).toContain('Exterior zone (Region)');
  });
});
