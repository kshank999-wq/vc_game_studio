/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
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
});

const select = (name: string) => {
  fireEvent.click(screen.getByRole('tab', { name: /Outliner/ }));
  fireEvent.click(screen.getAllByRole('button', { name }).find((b) => b.classList.contains('lvl-row-name'))!);
};

describe('puzzles on the level map (spec V2 §14)', () => {
  it('lists the map’s puzzle, shows its parts on the map, and binds an item to it', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'LEVELS' }));
    await opened();

    // Nothing selected: the map's puzzles, by part.
    const row = screen.getByRole('group', { name: 'Puzzle The Vault Door' });
    expect([...row.querySelectorAll('.lvl-puzzle-chip')].map((c) => c.textContent)).toEqual(['◉ Entry 1', '● Required 1', '? Clue 1', '▮ Gate 2']);
    expect(container.querySelector('.lvl-puzzle')).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Show on the map' }));
    const overlay = container.querySelector('.lvl-puzzle')!;
    expect(overlay.textContent).toContain('The Vault Door');
    expect([...overlay.querySelectorAll('.lvl-puzzle-part')].map((p) => p.getAttribute('data-role'))).toEqual(['entry', 'gate', 'clue', 'required', 'gate']);
    expect((screen.getByRole('combobox', { name: 'Puzzle shown' }) as HTMLSelectElement).value).not.toBe('');

    // The door: a gate, read from the level.
    select('Bronze Door');
    const puzzles = container.querySelector('.lvl-right')!;
    expect(puzzles.textContent).toContain('there until it is solved · read from the level');

    // The key in the silt, bound as what solving it brings: it shows, and can be unbound.
    select('Vault Key');
    fireEvent.change(screen.getByRole('combobox', { name: 'Puzzle role' }), { target: { value: 'output' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bind' }));
    expect(container.querySelector('.lvl-right')!.textContent).toContain('★ OutputThe Vault Door what solving it brings: there only once solved');
    expect([...container.querySelectorAll('.lvl-puzzle-part')].map((p) => p.getAttribute('data-role'))).toContain('output');
    fireEvent.click(screen.getByRole('button', { name: 'Unbind Output of The Vault Door' }));
    expect(container.querySelector('.lvl-right')!.textContent).not.toContain('★ OutputThe Vault Door what solving it brings: there only once solved');
  });
});
