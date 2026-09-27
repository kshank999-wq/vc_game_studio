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
