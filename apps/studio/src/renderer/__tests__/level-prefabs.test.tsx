/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { makePrefab, prefabText, sha256 } from '../model/level/prefabs';
import { withTomb } from '../model/level/sample-structure';
import { sunkenVault } from '../model/sample';
import { resetPreferences, setPreferences } from '../preferences';

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
  vi.unstubAllGlobals();
});

describe('prefabs in the Level Designer (structure spec V2)', () => {
  it('places a starter, saves the selection as the project’s own, and downloads one from a catalog checked by its SHA-256', async () => {
    const t = withTomb(sunkenVault());
    const text = prefabText(makePrefab(t.project, [t.rooms.treasury], { name: 'Treasury' })!);
    const sum = await sha256(text);
    const files: Record<string, string> = {
      'https://kits.example.com/index.json': JSON.stringify({ format: 'vcgs-prefab-catalog', version: 1, name: 'Tomb kits', prefabs: [{ id: 't', name: 'Treasury', url: 'treasury.json', sha256: sum }, { id: 'd', name: 'Deluxe crypt', page: 'https://kits.example.com/deluxe', price: '$4' }] }),
      'https://kits.example.com/treasury.json': text,
    };
    vi.stubGlobal('fetch', async (url: string) => ({ ok: !!files[url], status: files[url] ? 200 : 404, text: async () => files[url] ?? '' }));
    setPreferences({ prefabCatalogs: ['https://kits.example.com/index.json'] });
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Prefabs' }));
    const panel = screen.getByRole('region', { name: 'Prefabs' });
    expect(within(panel).getByText('None yet: select something and save it.')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Place Locked vault' }));
    expect(document.querySelector('.lvl-status')!.textContent).toBeDefined();
    await waitFor(() => expect(document.body.textContent).toMatch(/Locked vault placed: 4 pieces, bringing 1 story object/));
    // What was placed is selected: save it as this project's own.
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Prefab name' }), { target: { value: 'My vault' } });
    fireEvent.click(within(panel).getByRole('button', { name: /^Save the selection/ }));
    expect(within(within(panel).getByRole('list', { name: 'This project’s prefabs' })).getByText('My vault')).toBeTruthy();
    // The catalog: opened on request, one to download, one sold on its page.
    fireEvent.click(within(panel).getByRole('button', { name: 'Open' }));
    const listed = await within(panel).findByRole('list', { name: 'Prefabs in Tomb kits' });
    expect(within(listed).getByRole('button', { name: 'Get Deluxe crypt' }).textContent).toBe('Get it ($4)');
    fireEvent.click(within(listed).getByRole('button', { name: 'Download Treasury' }));
    await waitFor(() => expect(within(within(panel).getByRole('list', { name: 'This project’s prefabs' })).getByText('Treasury')).toBeTruthy());
  });
});
