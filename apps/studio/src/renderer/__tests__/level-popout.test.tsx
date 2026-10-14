/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
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
    fireEvent.click(within(screen.getByRole('tab', { name: /Outliner/ }).closest('aside')!).getByRole('tab', { name: /Outliner/ }));
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
});
