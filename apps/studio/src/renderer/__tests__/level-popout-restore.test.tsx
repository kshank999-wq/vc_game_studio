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
const PROJECT = sunkenVault();
/** What is remembered for each project. */
const saved = (): Record<string, string[]> => JSON.parse(localStorage.getItem('vcgs.levels.popouts') ?? '{}');
const levels = async (project = PROJECT) => {
  localStorage.setItem('vcgs.project.v1', JSON.stringify(project));
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
    await waitFor(() => expect(saved()[PROJECT.id]?.sort()).toEqual(['inspector', 'view']));
  });

  it('in a browser, offers to open them again (a window only opens on a click there)', async () => {
    localStorage.setItem('vcgs.levels.popouts', JSON.stringify({ [PROJECT.id]: ['inspector', 'view'] }));
    const wins = fakeWindows();
    await levels();
    const offer = screen.getByRole('note', { name: 'Windows from last time' });
    expect(offer.textContent).toContain('the map, the properties');
    expect(wins).toHaveLength(0);
    // Not answered yet: what was out is still remembered.
    expect(saved()[PROJECT.id]).toEqual(['inspector', 'view']);
    fireEvent.click(within(offer).getByRole('button', { name: 'Open them again' }));
    await waitFor(() => expect(wins.map((x) => x.name).sort()).toEqual(['vcgs-panel-inspector', 'vcgs-panel-view']));
    expect(screen.queryByRole('note', { name: 'Windows from last time' })).toBeNull();
  });

  it('“Keep them here” forgets them', async () => {
    localStorage.setItem('vcgs.levels.popouts', JSON.stringify({ [PROJECT.id]: ['library'] }));
    fakeWindows();
    await levels();
    fireEvent.click(screen.getByRole('button', { name: 'Keep them here' }));
    await waitFor(() => expect(saved()[PROJECT.id]).toBeUndefined());
  });

  it('in the desktop app, opens them again by itself', async () => {
    (globalThis as { vcgs?: unknown }).vcgs = {};
    localStorage.setItem('vcgs.levels.popouts', JSON.stringify({ [PROJECT.id]: ['prefabs', 'library'] }));
    const wins = fakeWindows();
    await levels();
    await waitFor(() => expect(wins.map((x) => x.name).sort()).toEqual(['vcgs-panel-library', 'vcgs-panel-prefabs']));
    expect(screen.queryByRole('note', { name: 'Windows from last time' })).toBeNull();
  });

  it('each project keeps its own: one opens with its windows, another with none, or with its own', async () => {
    (globalThis as { vcgs?: unknown }).vcgs = {};
    const other = { ...sunkenVault(), id: 'proj-other', name: 'Another Game' };
    localStorage.setItem('vcgs.levels.popouts', JSON.stringify({ [PROJECT.id]: ['library'], [other.id]: ['view', 'inspector'] }));
    let wins = fakeWindows();
    await levels(other);
    await waitFor(() => expect(wins.map((x) => x.name).sort()).toEqual(['vcgs-panel-inspector', 'vcgs-panel-view']));
    cleanup();
    vi.restoreAllMocks();
    wins = fakeWindows();
    await levels(PROJECT);
    await waitFor(() => expect(wins.map((x) => x.name)).toEqual(['vcgs-panel-library']));
    // Untouched: the other project's windows are still its own.
    expect(saved()[other.id]).toEqual(['view', 'inspector']);
    cleanup();
    vi.restoreAllMocks();
    wins = fakeWindows();
    await levels({ ...sunkenVault(), id: 'proj-new', name: 'New' });
    await new Promise((r) => setTimeout(r, 200));
    expect(wins).toHaveLength(0);
  });

  it('an old single list (from before it was kept per project) still opens them once', async () => {
    (globalThis as { vcgs?: unknown }).vcgs = {};
    localStorage.setItem('vcgs.levels.popouts', JSON.stringify(['prefabs']));
    const wins = fakeWindows();
    await levels();
    await waitFor(() => expect(wins.map((x) => x.name)).toEqual(['vcgs-panel-prefabs']));
    await waitFor(() => expect(saved()).toEqual({ [PROJECT.id]: ['prefabs'] }));
  });

  it('closing the studio leaves the list as it was, so they come back', async () => {
    fakeWindows();
    await levels();
    fireEvent.click(screen.getByRole('button', { name: 'Open the map in its own window' }));
    await waitFor(() => expect(saved()[PROJECT.id]).toEqual(['view']));
    window.dispatchEvent(new Event('pagehide'));
    cleanup();
    expect(saved()[PROJECT.id]).toEqual(['view']);
  });
});
