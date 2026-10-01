/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { sunkenVault } from '../model/sample';
import { resetPreferences } from '../preferences';
import { resetTemplateCache } from '../components/puzzle/template-library';

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
  resetTemplateCache();
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
    // Nothing stops it; its cues wait for puzzle export to reach the engines.
    expect([...container.querySelectorAll('.pz-issue')].map((b) => b.textContent)).toEqual(['○ Its hints and what solving it plays are in the studio; puzzle export brings them to the engines.']);
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

  it('draws the steps as a graph, links one to need another first, and sets sequence, time and wrong moves', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'PUZZLES' }));
    await opened();
    fireEvent.click(screen.getByRole('tab', { name: 'Graph' }));
    const graph = screen.getByRole('group', { name: 'Puzzle graph' });
    expect(within(graph).getAllByRole('button', { name: /\(graph\)$/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Pull the Rusted Lever (graph)',
      'The seam drains (graph)',
      'Drain the seam (graph)',
      'Hear Mara at the door (graph)',
      'Open the vault door (graph)',
    ]);
    // Hearing Mara first, through the inspector: an arrow appears.
    fireEvent.click(within(graph).getByRole('button', { name: 'Pull the Rusted Lever (graph)' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Add a step it needs first' }), { target: { value: within(screen.getByRole('combobox', { name: 'Add a step it needs first' })).getByRole('option', { name: 'Hear Mara at the door' }).getAttribute('value') } });
    const arrow = within(screen.getByRole('group', { name: 'Puzzle graph' })).getByRole('button', { name: 'Pull the Rusted Lever needs Hear Mara at the door first' });
    fireEvent.click(arrow);
    expect(screen.getByText(/needs Hear Mara at the door first/, { selector: '.pz-edge-picked' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(within(screen.getByRole('group', { name: 'Puzzle graph' })).queryByRole('button', { name: /needs Hear Mara/ })).toBeNull();

    // The sub-goal in order, against the clock; the steps say so in the tree.
    fireEvent.click(within(screen.getByRole('group', { name: 'Puzzle graph' })).getByRole('button', { name: 'Drain the seam (graph)' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Done when' }), { target: { value: 'sequence' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Within (s)' }), { target: { value: '30' } });
    expect(within(screen.getByRole('group', { name: 'Puzzle graph' })).getByRole('button', { name: 'Drain the seam (graph)' }).textContent).toContain('SEQ · ⏱ 30s');
    fireEvent.click(screen.getByRole('tab', { name: /Steps/ }));
    const steps = screen.getByRole('tree', { name: 'Puzzle steps' });
    expect(within(steps).getByRole('treeitem', { name: 'Drain the seam, Sub-goal' }).textContent).toContain('SEQ');
    expect(within(steps).getByRole('treeitem', { name: 'Pull the Rusted Lever, Interaction' }).textContent).toContain('STATE');
    // The optional step is a reward branch; the engines' approximation is said.
    fireEvent.click(within(steps).getByRole('treeitem', { name: 'Hear Mara at the door, Requirement' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: 'clue' } });
    expect(within(steps).getByRole('treeitem', { name: 'Hear Mara at the door, Requirement' }).textContent).toContain('? clue');
    expect(screen.getByText(/engines get the conditions its steps come to/)).toBeTruthy();
  });

  it('makes the safe-code puzzle from a template, adds an element and a step from it, traces the clues and keeps it as a template', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'PUZZLES' }));
    await opened();
    fireEvent.change(screen.getByRole('combobox', { name: 'Template' }), { target: { value: 'builtin.safe' } });
    fireEvent.click(screen.getByRole('button', { name: '+ From template' }));
    expect(screen.getByRole('heading', { name: 'Safe code' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Elements' }));
    const list = () => screen.getByRole('listbox', { name: 'Puzzle elements' });
    expect(within(list()).getAllByRole('option').map((o) => o.querySelector('.pz-element-name')!.textContent)).toEqual(['Safe', 'Safe code', 'First two digits', 'The order', 'Confirmation', 'Painting', 'Desk drawer']);
    fireEvent.change(screen.getByRole('textbox', { name: 'New element name' }), { target: { value: 'Brass lever' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Lever' }));
    expect(within(list()).getByRole('option', { name: /Brass lever/ }).getAttribute('aria-selected')).toBe('true');
    expect(within(list()).getByRole('option', { name: /Brass lever/ }).textContent).toContain('Down → Up');
    expect(screen.getAllByRole('combobox', { name: 'Verb' }).map((v) => (v as HTMLInputElement).value)).toEqual(['Pull', 'Push']);
    fireEvent.click(screen.getByRole('button', { name: '+ Step: Up' }));
    expect(within(screen.getByRole('tree', { name: 'Puzzle steps' })).getByRole('treeitem', { name: 'Brass lever: Up, Interaction' }).textContent).toContain('Brass lever is Up');

    // The clues and what each is for; the optional one says so.
    fireEvent.click(screen.getByRole('tab', { name: 'Clues' }));
    const rows = within(screen.getByRole('table', { name: 'Clues' })).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelector('td')!.textContent)).toEqual(['First two digitsneeded', 'The orderneeded', 'Confirmationoptional']);
    expect(rows[0]!.textContent).toContain('Learn the first two digits');
    expect(rows[0]!.textContent).toContain('revealed');
    fireEvent.click(within(rows[1]!).getByRole('button', { name: /The order/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Hint strength' }), { target: { value: 'Explicit' } });
    expect(within(screen.getByRole('table', { name: 'Clues' })).getAllByRole('row')[2]!.textContent).toContain('Explicit');
    expect(screen.getAllByRole('textbox', { name: /^Hint \d$/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '+ Hint' }));
    expect(screen.getAllByRole('textbox', { name: /^Hint \d$/ })).toHaveLength(3);

    // The puzzle: its cues, and kept as a template of mine.
    fireEvent.click(within(screen.getByRole('tree', { name: 'Steps' })).getAllByRole('treeitem')[0]!);
    expect(screen.getAllByRole('textbox', { name: /^Cue \d$/ }).map((c) => (c as HTMLInputElement).value)).toEqual(['A heavy click', 'The safe door swings open']);
    fireEvent.change(screen.getByRole('textbox', { name: 'Template name' }), { target: { value: 'Study safe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as a template' }));
    const mine = within(screen.getByRole('combobox', { name: 'Template' })).getByRole('option', { name: 'Study safe' }) as HTMLOptionElement;
    fireEvent.change(screen.getByRole('combobox', { name: 'Template' }), { target: { value: mine.value } });
    fireEvent.change(screen.getByRole('textbox', { name: 'New puzzle name' }), { target: { value: 'The Attic Safe' } });
    fireEvent.click(screen.getByRole('button', { name: '+ From template' }));
    expect(screen.getByRole('heading', { name: 'The Attic Safe' })).toBeTruthy();
    expect(within(screen.getByRole('tree', { name: 'Puzzle steps' })).getAllByRole('treeitem')).toHaveLength(7);
    expect(JSON.parse(localStorage.getItem('vcgs.puzzle-templates.v1')!)[0].name).toBe('Study safe');
    expect(container.querySelector('.pz-bottom')!.textContent).not.toContain('Nothing reveals');
  });

  it('designs a screen puzzle and plays it beside the design: the safe’s keypad, then a new one', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'PUZZLES' }));
    await opened();
    fireEvent.change(screen.getByRole('combobox', { name: 'Template' }), { target: { value: 'builtin.safe' } });
    fireEvent.click(screen.getByRole('button', { name: '+ From template' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Screen' }));
    expect((screen.getByRole('combobox', { name: 'Screen element' }) as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Safe · Keypad');
    expect((screen.getByRole('combobox', { name: 'Code element' }) as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Safe code (4271)');
    const pad = screen.getByRole('dialog', { name: 'Safe screen' });
    const key = (k: string) => fireEvent.click(within(within(pad).getByRole('group', { name: 'Keys' })).getByRole('button', { name: k }));
    for (const k of '1111') key(k);
    fireEvent.click(within(pad).getByRole('button', { name: 'Enter' }));
    expect(within(pad).getByRole('status').textContent).toBe('A dull buzz. Wrong code.');
    for (const k of '4271') key(k);
    expect(within(pad).getByLabelText('Display').textContent).toBe('4271');
    fireEvent.click(within(pad).getByRole('button', { name: 'Enter' }));
    expect(within(pad).getByRole('status').textContent).toBe('A heavy click. The door gives.');
    expect(screen.getByText(/Solved, it does what “Enter code” does: Enter code · only when Locked · becomes Open/)).toBeTruthy();

    // The painting gets sliding tiles: its own design, and a preview to play.
    fireEvent.change(screen.getByRole('combobox', { name: 'Screen element' }), { target: { value: within(screen.getByRole('combobox', { name: 'Screen element' })).getByRole('option', { name: 'Painting' }).getAttribute('value') } });
    fireEvent.click(screen.getByRole('button', { name: 'Make a sliding tiles' }));
    expect((screen.getByRole('spinbutton', { name: 'Size' }) as HTMLInputElement).value).toBe('3');
    expect(within(screen.getByRole('dialog', { name: 'Painting screen' })).getAllByRole('button', { name: /^Tile \d$/ })).toHaveLength(8);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Size' }), { target: { value: '4' } });
    expect(within(screen.getByRole('dialog', { name: 'Painting screen' })).getAllByRole('button', { name: /^Tile \d+$/ })).toHaveLength(15);
    // The painting's Inspect changes nothing, so the tiles get an interaction of their own.
    expect((screen.getByRole('combobox', { name: 'Opens on' }) as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Slide the tiles');
  });
});
