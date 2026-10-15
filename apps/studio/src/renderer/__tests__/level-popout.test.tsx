/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { sunkenVault } from '../model/sample';
import { resetPreferences } from '../preferences';

/** The library slides out from the maps panel's edge: open it, if it isn't. */
const openLibrary = () => {
  const tab = screen.queryByRole('button', { name: 'Open the library' });
  if (tab) fireEvent.click(tab);
};


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
  vi.restoreAllMocks();
  document.querySelectorAll('iframe').forEach((f) => f.remove());
});

/** jsdom opens no windows: an iframe's window stands in for the one the panel goes to. */
const fakeWindows = () => {
  const made: Window[] = [];
  vi.spyOn(window, 'open').mockImplementation(() => {
    const f = document.createElement('iframe');
    document.body.appendChild(f);
    made.push(f.contentWindow!);
    return f.contentWindow;
  });
  return made;
};

describe('Levels panels in windows of their own', () => {
  it('pulls the properties out into a window, keeps it live, and puts it back', async () => {
    const wins = fakeWindows();
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Open the properties in its own window' }));
    await waitFor(() => expect(wins).toHaveLength(1));
    const other = wins[0]!.document;
    await waitFor(() => expect(other.querySelector('.lvl-right')).not.toBeNull());
    // Gone from here, its column too; the styles went across.
    expect(document.querySelector('.lvl > .lvl-right')).toBeNull();
    expect(document.querySelector('.lvl')!.className).toContain('right-out');
    expect(other.head.querySelectorAll('style, link').length).toBe(document.head.querySelectorAll('style, link[rel="stylesheet"]').length);
    // Live: selecting here shows over there.
    const row = document.querySelector('.lvl-left [data-id], .lvl-left .lvl-out-row');
    if (row) fireEvent.click(row);
    expect(other.querySelector('.popout-bar')!.textContent).toContain('Properties');
    // Put back.
    fireEvent.click(within(other.body).getByRole('button', { name: 'Put it back' }));
    await waitFor(() => expect(document.querySelector('.lvl > .lvl-right')).not.toBeNull());
    expect(document.querySelector('.lvl')!.className).not.toContain('right-out');
  });

  it('the generator and prefabs go out too, from their own headers; a blocked window says so', async () => {
    const wins = fakeWindows();
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Prefabs' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Prefabs' })).getByRole('button', { name: 'Open in its own window' }));
    await waitFor(() => expect(wins[0]?.document.querySelector('[aria-label="Prefabs"]')).toBeTruthy());
    expect(screen.queryByRole('region', { name: 'Prefabs' })).toBeNull();
    // Placing from the window places on the map here.
    fireEvent.click(within(wins[0]!.document.body).getByRole('button', { name: 'Place Guard post' }));
    await waitFor(() => expect(document.body.textContent).toMatch(/Guard post placed: \d+ pieces/));
    vi.restoreAllMocks();
    vi.spyOn(window, 'open').mockImplementation(() => null);
    openLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Open the library in its own window' }));
    await waitFor(() => expect(document.body.textContent).toMatch(/The new window was blocked/));
    expect(document.querySelector('.lvl > .lvl-left')).not.toBeNull();
  });

  it('the map goes out too: a note here, the map over there, and back', async () => {
    const wins = fakeWindows();
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Open the map in its own window' }));
    await waitFor(() => expect(wins[0]?.document.querySelector('.lvl-centre-out .lvl-view')).toBeTruthy());
    expect(screen.getByRole('note').textContent).toContain('The 2D map is in its own window.');
    expect(document.querySelector('.lvl-view')).toBeNull();
    const other = wins[0]!.document;
    // The window has its own 2D / 3D switch.
    expect(within(other.body).getByRole('button', { name: '3D graybox' })).toBeTruthy();
    fireEvent.click(within(other.body).getByRole('button', { name: 'Put it back' }));
    await waitFor(() => expect(document.querySelector('.lvl-view')).not.toBeNull());
  });

  it('a library asset or a prefab dragged onto the map (from any window) goes where it is dropped', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    const view = document.querySelector('.lvl-view')!;
    const carrying = (type: string, id: string) => ({ types: [type], getData: (t: string) => (t === type ? id : ''), dropEffect: 'none' });
    // jsdom lays nothing out: the map is 0 × 0 at the corner, so the drop goes there.
    const over = fireEvent.dragOver(view, { clientX: 0, clientY: 0, dataTransfer: carrying('application/x-vcgs-asset', 'prop.crate') });
    expect(over).toBe(false);
    fireEvent.drop(view, { clientX: 0, clientY: 0, dataTransfer: carrying('application/x-vcgs-asset', 'prop.crate') });
    await waitFor(() => expect(document.querySelector('.lvl-status')!.textContent).toMatch(/Crate/));
    fireEvent.drop(view, { clientX: 0, clientY: 0, dataTransfer: carrying('application/x-vcgs-prefab', 'starter.guard-post') });
    await waitFor(() => expect(document.body.textContent).toMatch(/Guard post placed: \d+ pieces/));
    // Anything else (a link, a file) isn't taken.
    expect(fireEvent.dragOver(view, { clientX: 0, clientY: 0, dataTransfer: carrying('text/uri-list', 'https://example.com') })).toBe(true);
  });

  it('remembers where the map window was: it opens there next time', async () => {
    const features: string[] = [];
    const wins: Window[] = [];
    vi.spyOn(window, 'open').mockImplementation((_u, _n, f) => {
      features.push(String(f));
      const fr = document.createElement('iframe');
      document.body.appendChild(fr);
      wins.push(fr.contentWindow!);
      return fr.contentWindow;
    });
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Open the map in its own window' }));
    await waitFor(() => expect(wins).toHaveLength(1));
    // Moved to the second screen and made bigger.
    for (const [k, v] of Object.entries({ screenX: 1920, screenY: 40, outerWidth: 1500, outerHeight: 900 })) Object.defineProperty(wins[0]!, k, { value: v, configurable: true });
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vcgs.popout.view') ?? 'null')).toEqual({ x: 1920, y: 40, w: 1500, h: 900 }), { timeout: 2000 });
    fireEvent.click(within(wins[0]!.document.body).getByRole('button', { name: 'Put it back' }));
    await waitFor(() => expect(document.querySelector('.lvl-view')).not.toBeNull());
    // Out again: where it was.
    fireEvent.click(screen.getByRole('button', { name: 'Open the map in its own window' }));
    await waitFor(() => expect(features).toHaveLength(2));
    expect(features[1]).toBe('popup=yes,width=1500,height=900,left=1920,top=40');
  });
});

