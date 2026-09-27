/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { fileNameFor, parse, serialize } from '../files';
import { sunkenVault } from '../model/sample';
import { getPreferences, resetPreferences, setPreferences } from '../preferences';

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

  it('starts from the sample, then asks before a new project throws it away', () => {
    const { container } = render(<App />);
    openMenu('File');
    fireEvent.click(screen.getByRole('menuitem', { name: 'New from the sample (The Sunken Vault)' }));
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
  it('opens with Ctrl+K and goes to a node on the graph', () => {
    const { container } = render(<App />);
    openMenu('File');
    fireEvent.click(screen.getByRole('menuitem', { name: 'New from the sample (The Sunken Vault)' }));
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
