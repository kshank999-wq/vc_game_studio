/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fileNameFor, parse, serialize } from '../files';
import { sunkenVault } from '../model/sample';
import { getPreferences, resetPreferences, setPreferences } from '../preferences';

/** The Bible, play-through, shot list and handoff load on first use; wait for the one just opened. */
// The first import of a lazy view (three.js among them) can take a few seconds on a busy machine.
const opened = () => waitFor(() => expect(document.querySelector('.view-loading')).toBeNull(), { timeout: 5000 });

/** File › New from the sample, which loads the sample on demand. */
const openSample = async () => {
  fireEvent.click(screen.getByRole('menuitem', { name: 'New from the sample (The Sunken Vault)' }));
  await waitFor(() => expect(document.querySelectorAll('[data-node]').length).toBeGreaterThan(10), { timeout: 5000 });
};

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

const openMenu = (title: string) => fireEvent.pointerDown(screen.getByRole('menuitem', { name: title }));

describe('project files', () => {
  it('round-trip a whole project, and refuse anything else', () => {
    const project = sunkenVault();
    expect(parse(serialize(project))).toEqual(project);
    expect(parse('{"hello": 1}')).toBeNull();
    expect(parse('not json')).toBeNull();
    expect(fileNameFor({ ...project, name: 'Act 1: The Vault?' })).toBe('Act 1 The Vault.vcgs');
  });
});

describe('preferences', () => {
  it('are kept on this computer and fall back to the defaults', () => {
    setPreferences({ showMinimap: false, scriptSize: 18 });
    expect(JSON.parse(localStorage.getItem('vcgs.prefs.v1')!)).toMatchObject({ showMinimap: false, scriptSize: 18 });
    resetPreferences();
    expect(getPreferences().showMinimap).toBe(true);
  });
});

describe('the menu bar', () => {
  it('opens a menu, runs a command, and closes', () => {
    const { container } = render(<App />);
    openMenu('Project');
    expect(screen.getByRole('menu', { name: 'Project' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add a subplot lane' }));
    expect(container.querySelectorAll('.subplot-band')).toHaveLength(1);
    expect(screen.queryByRole('menu', { name: 'Project' })).toBeNull();
  });

  it('starts from the sample, then asks before a new project throws it away', async () => {
    const { container } = render(<App />);
    openMenu('File');
    await openSample();
    expect(container.querySelectorAll('[data-node]').length).toBeGreaterThan(10);
    act(() => {
      fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    });
    expect(screen.getByRole('alertdialog').textContent).toContain('Save “The Sunken Vault” first?');
    fireEvent.click(screen.getByRole('button', { name: 'Don’t save' }));
    expect(container.querySelectorAll('[data-node]')).toHaveLength(3);
  });

  it('toggles the minimap from View, and opens Preferences and the shortcuts', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.minimap')).toBeTruthy();
    openMenu('View');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Minimap/ }));
    expect(container.querySelector('.minimap')).toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    });
    expect(screen.getByRole('dialog', { name: 'Preferences' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    act(() => {
      fireEvent.keyDown(window, { key: '?' });
    });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });
});

describe('search', () => {
  it('opens with Ctrl+K and goes to a node on the graph', async () => {
    const { container } = render(<App />);
    openMenu('File');
    await openSample();
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'cave mouth' } });
    expect(screen.getAllByRole('option')[0]!.textContent).toContain('The Cave Mouth');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: 'Enter' });
    expect(screen.queryByRole('dialog', { name: 'Search the project' })).toBeNull();
    expect(container.querySelector('[data-node].selected')?.textContent).toContain('The Cave Mouth');
  });
});

describe('other windows', () => {
  it('the main window takes an edit sent from another window, and it is one undo step', async () => {
    const { role } = await import('../windows');
    const { renameProject } = await import('../model/project');
    render(<App />);
    const other = new BroadcastChannel(`vcgs:${role.session}`);
    const heard: { t: string; project?: { name: string } }[] = [];
    other.onmessage = (e) => heard.push(e.data);
    other.postMessage({ t: 'hello' });
    await act(() => new Promise((r) => setTimeout(r, 30)));
    const state = heard.find((m) => m.t === 'state')!;
    expect(state.project!.name).toBe('Untitled Game');
    other.postMessage({ t: 'commit', project: renameProject(state.project as never, 'From the Bible window') });
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(screen.getByRole('button', { name: 'From the Bible window' })).toBeTruthy();
    expect(heard.at(-1)!.project!.name).toBe('From the Bible window');
    other.postMessage({ t: 'undo' });
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(screen.getByRole('button', { name: 'Untitled Game' })).toBeTruthy();
    other.close();
  });
});

describe('deleting from the Bible', () => {
  it('says what goes with a character before deleting her', async () => {
    render(<App />);
    openMenu('File');
    await openSample();
    fireEvent.click(screen.getByRole('button', { name: 'GAME BIBLE' }));
    await opened();
    fireEvent.click(screen.getAllByText('Mara')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Delete “Mara”?');
    expect(dialog.textContent).toContain('The arc lane “Mara” stays');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete…' })).toBeNull();
  });
});

describe('play-through', () => {
  it('opens with F5, plays to a choice, and takes it', async () => {
    const { container } = render(<App />);
    openMenu('File');
    await openSample();
    act(() => {
      fireEvent.keyDown(window, { key: 'F5' });
    });
    await opened();
    expect(container.querySelector('.play-view')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /To the next decision/ }));
    // SC-01 opens by lighting the lantern: its oil is a mechanic in play.
    expect(container.querySelector('.play-mechanic')?.textContent).toContain('Now available: Lantern oil');
    expect((screen.getByLabelText('Available: Lantern oil') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Carry on/ }));
    fireEvent.click(screen.getByRole('button', { name: /To the next decision/ }));
    // SC-02 opens on an encounter: win it or lose it.
    expect(container.querySelector('.play-choice-title')?.textContent).toContain('Encounter: Eel swarm');
    fireEvent.click(screen.getByRole('button', { name: /Lose · try again/ }));
    expect(container.querySelector('.play-transcript')?.textContent).toContain('Eel swarm: try again');
    fireEvent.click(screen.getByRole('button', { name: /^1\s*Win/ }));
    fireEvent.click(screen.getByRole('button', { name: /To the next decision/ }));
    // Finding the key starts the quest, and its seal tells the Order's story.
    expect(container.querySelector('.play-quest')?.textContent).toContain('New quest: Open the vault');
    expect(container.querySelector('.play-lore')?.textContent).toContain('Discovered: The Drowned Order');
    // The codex counts those, Mara, the chamber, the key, the lantern's oil and the eels (met, then beaten), and opens on the quest log, the characters, the locations, the items, the mechanics, the encounters and the lore (C, or its button).
    expect(screen.getByRole('button', { name: /Codex/ }).textContent).toBe('Codex · 8 new');
    act(() => {
      fireEvent.keyDown(window, { key: 'c' });
    });
    const codex = screen.getByRole('dialog', { name: 'Codex' });
    expect(codex.textContent).toContain('Open the vault — Reach the vault chamber and open the door');
    expect(codex.textContent).toContain('Lantern oil · Hold to raise the lantern');
    expect(codex.textContent).toContain('MaraA guide who knows the flooded caves');
    expect(codex.textContent).toContain('Vault Key (carried)A heavy bronze key');
    expect(codex.textContent).toContain('Vault ChamberA drowned hall under the old city');
    expect(codex.textContent).toContain('Eel swarm (won)Eels, a dozen or so · weak to lantern light');
    expect(codex.textContent).toContain('The Drowned OrderRiver priests who sealed the vault');
    expect(screen.getByRole('button', { name: /Codex/ }).textContent).toBe('Codex');
    // Search it: "/" goes to the box; only what matches stays, and C types rather than closes.
    act(() => {
      fireEvent.keyDown(window, { key: '/' });
    });
    const search = screen.getByLabelText('Search the codex') as HTMLInputElement;
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: 'lantern' } });
    expect(codex.textContent).toContain('MaraA guide');
    expect(codex.textContent).toContain('Eel swarm');
    expect(codex.textContent).not.toContain('Vault Key');
    expect(screen.queryByRole('region', { name: 'Lore' })).toBeNull();
    fireEvent.keyDown(search, { key: 'c' });
    expect(screen.getByRole('dialog', { name: 'Codex' })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'nothing like it' } });
    expect(codex.textContent).toContain('Nothing matches “nothing like it”.');
    // Escape clears the search, then leaves the box.
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search.value).toBe('');
    expect(codex.textContent).toContain('Vault Key');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(document.activeElement).not.toBe(search);
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog', { name: 'Codex' })).toBeNull();
    expect(container.querySelector('.play-free')?.textContent).toContain('Rusted Lever');
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }));
    expect(container.querySelector('.play-transcript')?.textContent).toContain('Seam drains fires');
    // Using the lever puts it in the codex's objects.
    expect(screen.getByRole('button', { name: /Codex/ }).textContent).toBe('Codex · 1 new');
    // Turning the key opens the vault: the quest is done.
    expect(container.querySelector('.play-quest.done')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Turn the key/ }));
    expect(container.querySelector('.play-quest.done')?.textContent).toContain('Quest complete: Open the vault');
    expect((screen.getByLabelText('Quest Open the vault') as HTMLSelectElement).value).toBe('done');
  });
});

describe('the shot list', () => {
  it('opens from a cinematic in the Bible, adds a shot and edits it', async () => {
    const { container } = render(<App />);
    openMenu('File');
    await openSample();
    fireEvent.click(screen.getByRole('button', { name: 'GAME BIBLE' }));
    await opened();
    fireEvent.click(screen.getAllByText('Door in the dark')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Open the shot list' }));
    await opened();
    expect(container.querySelectorAll('.shot-card')).toHaveLength(3);
    expect(container.querySelector('.shotlist-sum')?.textContent).toBe('3 shots · 7.5s');
    fireEvent.click(screen.getByRole('button', { name: '+ Add a shot at the end' }));
    expect(container.querySelectorAll('.shot-card')).toHaveLength(4);
    fireEvent.change(screen.getByRole('combobox', { name: 'Framing' }), { target: { value: 'Insert' } });
    expect(container.querySelectorAll('.seq-shot')[3]?.textContent).toContain('Insert');
    expect(container.querySelector('.shotlist-sum')?.textContent).toBe('4 shots · 10.5s');
  });
});
