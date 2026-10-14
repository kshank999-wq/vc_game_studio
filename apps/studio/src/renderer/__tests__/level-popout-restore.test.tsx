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
  delete (globalThis as { vcgs?: unknown }).vcgs;
  document.querySelectorAll('iframe').forEach((f) => f.remove());
});

const fakeWindows = () => {
  const made: { name: string; w: Window }[] = [];
  vi.spyOn(window, 'open').mockImplementation((_u, name) => {
    const f = document.createElement('iframe');
    document.body.appendChild(f);
    made.push({ name: String(name), w: f.contentWindow! });
    return f.contentWindow;
  });
  return made;
};
const levels = async () => {
  localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
  await opened();
};

describe('pop-outs open again next time', () => {
  it('remembers which are out as they come and go', async () => {
    fakeWindows();
    await levels();
    fireEvent.click(screen.getByRole('button', { name: 'Open the properties in its own window' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open the map in its own window' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vcgs.levels.popouts')!).sort()).toEqual(['inspector', 'view']));
  });

  it('in a browser, offers to open them again (a window only opens on a click there)', async () => {
    localStorage.setItem('vcgs.levels.popouts', JSON.stringify(['inspector', 'view']));
    const wins = fakeWindows();
    await levels();
    const offer = screen.getByRole('note', { name: 'Windows from last time' });
    expect(offer.textContent).toContain('the map, the properties');
    expect(wins).toHaveLength(0);
    // Not answered yet: what was out is still remembered.
    expect(JSON.parse(localStorage.getItem('vcgs.levels.popouts')!)).toEqual(['inspector', 'view']);
    fireEvent.click(within(offer).getByRole('button', { name: 'Open them again' }));
    await waitFor(() => expect(wins.map((x) => x.name).sort()).toEqual(['vcgs-panel-inspector', 'vcgs-panel-view']));
    expect(screen.queryByRole('note', { name: 'Windows from last time' })).toBeNull();
  });

  it('“Keep them here” forgets them', async () => {
    localStorage.setItem('vcgs.levels.popouts', JSON.stringify(['library']));
    fakeWindows();
    await levels();
    fireEvent.click(screen.getByRole('button', { name: 'Keep them here' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vcgs.levels.popouts')!)).toEqual([]));
  });

  it('in the desktop app, opens them again by itself', async () => {
    (globalThis as { vcgs?: unknown }).vcgs = {};
    localStorage.setItem('vcgs.levels.popouts', JSON.stringify(['prefabs', 'library']));
    const wins = fakeWindows();
    await levels();
    await waitFor(() => expect(wins.map((x) => x.name).sort()).toEqual(['vcgs-panel-library', 'vcgs-panel-prefabs']));
    expect(screen.queryByRole('note', { name: 'Windows from last time' })).toBeNull();
  });

  it('closing the studio leaves the list as it was, so they come back', async () => {
    fakeWindows();
    await levels();
    fireEvent.click(screen.getByRole('button', { name: 'Open the map in its own window' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vcgs.levels.popouts')!)).toEqual(['view']));
    window.dispatchEvent(new Event('pagehide'));
    cleanup();
    expect(JSON.parse(localStorage.getItem('vcgs.levels.popouts')!)).toEqual(['view']);
  });
});
