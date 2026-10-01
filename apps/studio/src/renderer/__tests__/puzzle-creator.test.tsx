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

const write = (label: string, text: string) => {
  const field = screen.getByRole('textbox', { name: label });
  fireEvent.change(field, { target: { value: text } });
  fireEvent.blur(field);
};

describe('the Puzzle Creator (puzzle spec)', () => {
  it('opens on the sample’s puzzle, its steps deciding when it is solved', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'PUZZLES' }));
    await opened();
    const library = screen.getByRole('listbox', { name: 'Puzzle library' });
    expect(within(library).getByRole('option', { name: /The Vault Door/ }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByRole('textbox', { name: 'The player’s objective' }) as HTMLInputElement).value).toBe('Open the vault door');
    fireEvent.click(screen.getByRole('tab', { name: /Steps/ }));
    const steps = screen.getByRole('tree', { name: 'Puzzle steps' });
    expect(within(steps).getAllByRole('treeitem').map((t) => t.getAttribute('aria-label') ?? t.textContent)).toEqual([
      '🎯Open the vault doorALL',
      'Drain the seam, Sub-goal',
      'Pull the Rusted Lever, Interaction',
      'The seam drains, Requirement',
      'Hear Mara at the door, Requirement',
    ]);
    // With nothing selected, the puzzle: its rule comes from its steps.
    expect(container.querySelector('.pz-says')!.textContent).toBe('(Rusted Lever is up and door_solved is yes)');
    expect(screen.getByText('✓ Nothing stops it being solved.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Bronze Door/ })).toBeTruthy();
  });

  it('writes a new puzzle, turns its discoveries into steps, and makes what a step needs', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'PUZZLES' }));
    await opened();
    fireEvent.change(screen.getByRole('textbox', { name: 'New puzzle name' }), { target: { value: 'The Safe' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'New puzzle scale' }), { target: { value: 'object' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Puzzle' }));
    expect(screen.getByRole('heading', { name: 'The Safe' })).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Object/ }) as HTMLInputElement).checked).toBe(true);
    write('The player’s objective', 'Open the safe');
    write('Discoveries, clues, objects and actions', 'Find the code:\nRead the torn note\nLearn the order\n\nEnter the code');
    fireEvent.click(screen.getByRole('button', { name: 'Turn into steps ▸' }));
    const steps = screen.getByRole('tree', { name: 'Puzzle steps' });
    expect(within(steps).getAllByRole('treeitem')).toHaveLength(5);
    // Nothing marks the steps done yet: it can't be solved, and says so.
    expect(screen.getAllByText(/has nothing that marks it done/)).toHaveLength(3);

    fireEvent.click(within(steps).getByRole('treeitem', { name: 'Read the torn note, Interaction' }));
    fireEvent.click(screen.getByRole('button', { name: 'An item to carry' }));
    expect(within(steps).getByRole('treeitem', { name: 'Read the torn note, Interaction' }).textContent).toContain('Torn note is carried');
    fireEvent.click(within(steps).getByRole('treeitem', { name: 'Learn the order, Requirement' }));
    fireEvent.click(screen.getByRole('button', { name: 'A clue to learn (lore)' }));
    expect(within(steps).getByRole('treeitem', { name: 'Learn the order, Requirement' }).textContent).toContain('Order is known');
    expect(screen.getAllByText(/has nothing that marks it done/)).toHaveLength(1);
    // Its kind changes: still the same step.
    fireEvent.click(within(steps).getByRole('treeitem', { name: 'Enter the code, Interaction' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind' }), { target: { value: 'requirement' } });
    expect(within(steps).getByRole('treeitem', { name: 'Enter the code, Requirement' })).toBeTruthy();

    // A step added under the selected sub-goal, optional; then removed.
    fireEvent.click(within(steps).getByRole('treeitem', { name: 'Find the code, Sub-goal' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Done when' }), { target: { value: 'any' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Requirement' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Optional/ }));
    expect(within(steps).getByRole('treeitem', { name: 'New requirement, Requirement' }).textContent).toContain('optional');
    fireEvent.click(screen.getByRole('button', { name: 'Delete step' }));
    expect(within(steps).queryByRole('treeitem', { name: 'New requirement, Requirement' })).toBeNull();
    expect(within(steps).getByRole('treeitem', { name: 'Find the code, Sub-goal' }).textContent).toContain('ANY');
  });
});
