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

describe('the Character Creator (character spec)', () => {
  it('opens from the toolbar on the registry: every character the story already has', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Characters' }));
    await opened();
    expect(screen.getByRole('button', { name: 'Characters' }).getAttribute('aria-current')).toBe('page');
    const registry = screen.getByRole('listbox', { name: 'Character registry' });
    const names = within(registry).getAllByRole('option').map((o) => o.textContent);
    expect(names.some((n) => n?.includes('Mara'))).toBe(true);
    expect(names.some((n) => n?.includes('The Explorer'))).toBe(true);
    // The Explorer was the player character in the Bible: the Player role is on.
    fireEvent.click(within(registry).getByRole('option', { name: /The Explorer/ }));
    expect(screen.getByRole('button', { name: 'Player' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('img', { name: 'The Explorer placeholder' })).toBeTruthy();
  });

  it('makes a character with the wizard, a dialogue speaker at once, then adds abilities and gear', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Characters' }));
    await opened();
    fireEvent.click(screen.getAllByRole('button', { name: '+ New character' })[0]!);
    const wizard = screen.getByRole('dialog', { name: 'New character' });
    fireEvent.click(within(wizard).getByRole('checkbox', { name: /Enemy NPC/ }));
    fireEvent.click(within(wizard).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(wizard).getByRole('radio', { name: /Orc/ }));
    fireEvent.click(within(wizard).getByRole('button', { name: 'Next' }));
    // The orc's abilities are ticked; the graybox ones say they play.
    expect((within(wizard).getByRole('checkbox', { name: /Melee attack/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(wizard).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(wizard).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(wizard).getByRole('button', { name: 'Next' }));
    fireEvent.change(within(wizard).getByRole('textbox', { name: 'Character name' }), { target: { value: 'Grub' } });
    fireEvent.click(within(wizard).getByRole('button', { name: 'Save to the registry' }));
    expect(screen.queryByRole('dialog', { name: 'New character' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Grub' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Internal id' }) as HTMLInputElement).value).toBe('grub');
    expect(within(screen.getByRole('listbox', { name: 'Character registry' })).getByRole('option', { name: /Grub/ }).getAttribute('aria-selected')).toBe('true');

    // A library ability, tuned on the right.
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.click(within(screen.getByLabelText('Ability library')).getByRole('button', { name: /Block/ }));
    const props = screen.getByRole('complementary', { name: 'Properties' });
    expect(within(props).getByText(/Graybox stub/)).toBeTruthy();
    const range = within(props).getByRole('spinbutton', { name: 'Range' });
    fireEvent.change(range, { target: { value: '3' } });
    fireEvent.blur(range);
    expect(within(props).getByRole('button', { name: 'reset' })).toBeTruthy();

    // Starting gear: the knife in hand.
    const hand = screen.getByRole('combobox', { name: 'Hand slot' });
    fireEvent.change(hand, { target: { value: (within(hand).getByRole('option', { name: 'Diving Knife' }) as HTMLOptionElement).value } });
    expect(screen.getByRole('button', { name: 'Diving Knife' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Block, active/ }).textContent).toContain('tuned');

    // A slot limit too small for what it carries is said at once.
    fireEvent.change(screen.getByRole('combobox', { name: 'Capacity' }), { target: { value: 'slots' } });
    const slots = screen.getByRole('spinbutton', { name: 'Slots' });
    fireEvent.change(slots, { target: { value: '1' } });
    fireEvent.blur(slots);
    expect(screen.getByRole('meter', { name: 'Slots' }).textContent).toBe('Slots 1 of 1');
    expect(screen.queryByText(/to fix/)).toBeNull();
    const qty = screen.getByRole('spinbutton', { name: 'Diving Knife quantity' });
    fireEvent.change(qty, { target: { value: '3' } });
    fireEvent.blur(qty);
    expect(screen.getByText(/1 to fix/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Diagnostics/ }));
    expect(screen.getByText(/The starting items take 3 slots; it has 1\./)).toBeTruthy();
    expect(screen.getByText(/Block: a graybox stub/)).toBeTruthy();
  });
});

describe('the Character Creator, phase 2 (character spec §6)', () => {
  const makeOrc = async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Characters' }));
    await opened();
    fireEvent.click(screen.getAllByRole('button', { name: '+ New character' })[0]!);
    const wizard = screen.getByRole('dialog', { name: 'New character' });
    fireEvent.click(within(wizard).getByRole('checkbox', { name: /Enemy NPC/ }));
    fireEvent.click(within(wizard).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(wizard).getByRole('radio', { name: /Orc/ }));
    for (let i = 0; i < 4; i++) fireEvent.click(within(wizard).getByRole('button', { name: 'Next' }));
    fireEvent.change(within(wizard).getByRole('textbox', { name: 'Character name' }), { target: { value: 'Orc' } });
    fireEvent.click(within(wizard).getByRole('button', { name: 'Save to the registry' }));
  };

  it('sets an enemy’s AI: detection, the starter state machine, and a preview that says why', async () => {
    await makeOrc();
    fireEvent.click(screen.getByRole('tab', { name: /AI & detection/ }));
    expect((screen.getByRole('spinbutton', { name: 'Sight distance' }) as HTMLInputElement).value).toBe('12');
    const table = screen.getByRole('table', { name: 'Transitions' });
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(20);
    // The preview: the orc starts on patrol; a step later it is still patrolling, with its senses said.
    expect(screen.getByRole('img', { name: 'Patrol: the AI preview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Step' }));
    expect(document.querySelector('.cc-diag')!.textContent).toMatch(/^Patrol/);
    // Turn Search off: the chase now has nowhere to go when it loses the target, and that is said.
    fireEvent.click(within(screen.getByRole('group', { name: 'States it uses' })).getByRole('checkbox', { name: 'Search' }));
    expect(document.querySelector('.cc-state')!.textContent).toMatch(/to check/);
    fireEvent.click(screen.getByRole('tab', { name: /Diagnostics/ }));
    expect(screen.getAllByText(/AI: Chase → Search goes to a state that is off/).length).toBeGreaterThan(0);
  });

  it('generates Orc Guard and Orc Elite variants, each with its differences and budget', async () => {
    await makeOrc();
    fireEvent.click(screen.getByRole('tab', { name: /Variants/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate 2 variants' }));
    expect(screen.getByRole('button', { name: /^Orc Guard tier/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /^Orc Elite tier/ })).toBeTruthy();
    const diffs = screen.getByRole('table', { name: 'Orc Guard differences' });
    expect(within(diffs).getByText('Health')).toBeTruthy();
    expect(within(diffs).getByText('→ 156')).toBeTruthy();
  });

  it('gives an interactive NPC topics tied to its script lines', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Characters' }));
    await opened();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Character registry' })).getByRole('option', { name: /Mara/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Interactive NPC' }));
    fireEvent.click(screen.getByRole('tab', { name: /Dialogue & knowledge/ }));
    expect(screen.getByText(/in every scene’s speaker list/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Topic' }));
    const add = screen.getByRole('combobox', { name: 'Add a line' });
    const first = within(add).getAllByRole('option')[1] as HTMLOptionElement;
    fireEvent.change(add, { target: { value: first.value } });
    expect(screen.getByRole('button', { name: /New topic/ }).textContent).toContain('1 line');
  });
});

describe('the Character Creator, phase 3 (character spec §7, §8)', () => {
  it('adds the sample cast, and previews Village Market as 20 people', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Characters' }));
    await opened();
    fireEvent.click(screen.getByRole('button', { name: '+ Sample cast' }));
    const registry = screen.getByRole('listbox', { name: 'Character registry' });
    for (const name of ['Strolling Villager', 'Market Gossip', 'Patrol Guard', 'Lurking Orc', 'Orc Sentry', 'Loyal Hound']) expect(within(registry).getByRole('option', { name: new RegExp(name) })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Groups/ }));
    const library = screen.getByRole('listbox', { name: 'Group library' });
    expect(within(library).getByRole('option', { name: /Village Market/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('img', { name: 'Village Market: 20 people' })).toBeTruthy();
    // Fewer strollers, fewer people.
    const from = within(screen.getByRole('table', { name: 'Entries' })).getAllByRole('spinbutton', { name: 'From' })[0]!;
    const to = within(screen.getByRole('table', { name: 'Entries' })).getAllByRole('spinbutton', { name: 'To' })[0]!;
    fireEvent.change(from, { target: { value: '4' } });
    fireEvent.blur(from);
    fireEvent.change(to, { target: { value: '4' } });
    fireEvent.blur(to);
    expect(screen.getByRole('img', { name: 'Village Market: 10 people' })).toBeTruthy();
    fireEvent.click(within(library).getByRole('option', { name: /Orc Patrol/ }));
    expect(screen.getByText(/Not in a level yet/)).toBeTruthy();
  });
});

describe('the Character Creator, phase 4 (character spec §10, §11)', () => {
  it('binds final art: model, rig, animations, and says what is missing', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Characters' }));
    await opened();
    const registry = screen.getByRole('listbox', { name: 'Character registry' });
    fireEvent.click(within(registry).getByRole('option', { name: /The Explorer/ }));
    const binding = screen.getByRole('group', { name: 'Final art binding' });
    expect(within(binding).getByText(/Empty: the engine gets the placeholder figure/)).toBeTruthy();
    const model = within(binding).getByRole('textbox', { name: 'Final model' });
    fireEvent.change(model, { target: { value: 'res://art/explorer.glb' } });
    fireEvent.blur(model);
    const after = screen.getByRole('group', { name: 'Final art binding' });
    expect(within(after).getByText(/puts this model in place of the placeholder, under the same id/)).toBeTruthy();
    const anims = within(after).getByRole('textbox', { name: 'Animations' });
    fireEvent.change(anims, { target: { value: 'run, jump' } });
    fireEvent.blur(anims);
    const problems = within(screen.getByRole('group', { name: 'Final art binding' })).getByRole('list', { name: 'Art binding problems' });
    expect(problems.textContent).toContain('no “idle” animation');
    expect(problems.textContent).toContain('no “walk” animation');
  });
});
