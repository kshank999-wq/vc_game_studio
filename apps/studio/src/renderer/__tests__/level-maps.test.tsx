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

    // The world's library is the world's tools; a region on the world, opened as its own map, its size.
    expect(screen.queryByRole('button', { name: 'Place Exterior zone' })).toBeNull();
    expect(screen.getByText('World and region tools')).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Place Region' }), { button: 0, clientX: 10, clientY: 10 });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    });
    fireEvent.pointerDown(screen.getByRole('application', { name: 'Level map' }), { button: 0, clientX: 200, clientY: 150 });
    fireEvent.click(screen.getByRole('button', { name: 'Open as a map ▸' }));
    expect(within(crumbs).getAllByRole('button').map((b) => b.textContent)).toEqual(['The Drowned Coast', 'Region', '↑']);
    expect(container.querySelector('.lvl-right-head')!.textContent).toContain('Region');
    expect(container.querySelector('.lvl-bounds')!.textContent).toContain('Region · 5 km × 5 km');
    expect(within(nav).getByRole('button', { name: 'Region, region' })).toBeTruthy();
    // Back up to the world, onto the zone, which now says it opens.
    fireEvent.click(screen.getByRole('button', { name: 'Back to the parent map' }));
    expect(within(crumbs).getByRole('button', { name: 'The Drowned Coast' }).getAttribute('aria-current')).toBe('location');
    expect(container.querySelector('.lvl-opens')!.textContent).toContain('▸ Region');
    expect(screen.getByRole('button', { name: 'Open Region ▸' })).toBeTruthy();

    // Deleting the world warns about the region inside it.
    fireEvent.click(within(nav).getByRole('button', { name: 'More for The Drowned Coast' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm.textContent).toContain('Delete “The Drowned Coast”?');
    expect(confirm.textContent).toContain('Region (Region)');
  });

  it('draws a road between two places on the world map, and locks it until a rule holds', async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'LEVELS' }));
    await opened();
    fireEvent.click(screen.getByRole('button', { name: '+ Start with a world' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New world' })).getByRole('button', { name: 'Create world' }));
    const map = screen.getByRole('application', { name: 'Level map' });
    const place = (asset: string, x: number, y: number) => {
      fireEvent.pointerDown(screen.getByRole('button', { name: `Place ${asset}` }), { button: 0, clientX: 10, clientY: 10 });
      act(() => {
        window.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10 }));
      });
      fireEvent.pointerDown(map, { button: 0, clientX: x, clientY: y });
    };
    place('Destination', 150, 150);
    place('Landmark', 300, 220);
    const marker = (name: string) => [...container.querySelectorAll('.lvl-item')].find((g) => g.textContent?.includes(name))!;
    const [a, b] = [marker('Destination'), marker('Landmark')];
    expect(container.querySelector('.lvl-map')!.textContent).toContain('Destination · Level');
    // The route tool: click one place, then the other, and the road is drawn and selected.
    fireEvent.click(screen.getByRole('button', { name: 'Route' }));
    expect((screen.getByRole('combobox', { name: 'Route kind' }) as HTMLSelectElement).value).toBe('road');
    fireEvent.pointerDown(a!, { button: 0, clientX: 150, clientY: 150 });
    fireEvent.pointerDown(b!, { button: 0, clientX: 300, clientY: 220 });
    expect(container.querySelector('.lvl-route.road')).toBeTruthy();
    expect(container.querySelector('.lvl-right-head')!.textContent).toContain('Road: Destination → Landmark');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Locked' }));
    expect(container.querySelector('.lvl-route.locked')!.textContent).toContain('🔒');
    expect(screen.getByText('Opens when')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete route' }));
    expect(container.querySelector('.lvl-route')).toBeNull();
  });

  it('details one room of the sample: the rest dims, the library turns to room things, and back', async () => {
    const { sunkenVault } = await import('../model/sample');
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'LEVELS' }));
    await opened();
    // Double-click the room in the navigator.
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Vault Chamber, room' }));
    expect(screen.getByText('Room detail tools')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Place Room' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Place Table' })).toBeTruthy();
    expect(container.querySelector('.lvl-dimmed')).toBeTruthy();
    expect(container.querySelector('.lvl-focus-ring')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Back to the whole floor' })).toHaveLength(2);
    expect(screen.getByText(/things in it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Leave Vault Chamber' }));
    expect(container.querySelector('.lvl-dimmed')).toBeNull();
    expect(screen.queryByText('Room detail tools')).toBeNull();
  });
});

