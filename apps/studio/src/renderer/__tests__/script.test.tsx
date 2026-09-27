/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { spineLane } from '../model/layout';
import { createProject, makeObject, placeNew } from '../model/project';
import { addElement } from '../model/scene';
import type { Project } from '../model/types';

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
});

/** A scene with Mara already in it, and Jonah elsewhere in the project. */
const setup = (): Project => {
  let project = createProject('The Sunken Vault');
  const placed = placeNew(project, 'scene', spineLane(project).id, 400)!;
  project = addElement(placed.project, placed.id, 'character', 'Mara')!.project;
  const jonah = makeObject('character', 'Jonah', new Date().toISOString());
  return { ...project, objects: { ...project.objects, [jonah.id]: jonah } };
};

const openScene = () => {
  const view = render(<App />);
  fireEvent.doubleClick(view.container.querySelector('[data-type="scene"]')!);
  return view;
};

const cue = (container: HTMLElement, n = -1) => [...container.querySelectorAll<HTMLInputElement>('input.line-cue')].at(n)!;
const typeIn = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  el.value = value;
  fireEvent.input(el);
};
const key = (el: Element, k: string, opts: Partial<KeyboardEventInit> = {}) => act(() => void fireEvent.keyDown(el, { key: k, ...opts }));

describe('writing the script', () => {
  it('completes a character’s name as it is typed, the scene’s cast first', () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(setup()));
    const { container } = openScene();
    fireEvent.click(screen.getByRole('button', { name: 'Start with a character' }));
    expect(document.activeElement).toBe(cue(container));
    typeIn(cue(container), 'm');
    const options = () => within(screen.getByRole('listbox', { name: 'Characters' })).getAllByRole('option').map((o) => o.textContent);
    expect(options()).toEqual(['MARA']);
    typeIn(cue(container), 'j');
    expect(options()).toEqual(['JONAHnot in this scene yet']);
    typeIn(cue(container), 'ma');
    key(cue(container), 'Enter');
    // Mara speaks; the caret goes on to her line.
    expect(cue(container).value).toBe('Mara');
    const text = screen.getByRole('textbox', { name: 'Line for Mara' }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(text);
    typeIn(text, 'There’s a lever somewhere.');
    key(text, 'Enter');
    // The next cue: empty, offering the other side of the exchange.
    expect(document.activeElement).toBe(cue(container));
    expect(cue(container).value).toBe('');
  });

  it('makes a new character from a name nobody has, who joins the scene’s cast with their dialogue', () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(setup()));
    const { container } = openScene();
    fireEvent.click(screen.getByRole('button', { name: 'Start with a character' }));
    typeIn(cue(container), 'OLD FERRYMAN');
    key(cue(container), 'Enter');
    const text = screen.getByRole('textbox', { name: 'Line for Old Ferryman' }) as HTMLTextAreaElement;
    typeIn(text, 'Mind the water.');
    fireEvent.blur(text);
    // The Characters node now holds him, and his dialogue box hangs off him.
    const chips = [...container.querySelectorAll('.chip-item')].map((c) => c.textContent);
    expect(chips).toEqual([expect.stringContaining('Mara'), expect.stringContaining('Old Ferryman')]);
    const box = screen.getByRole('group', { name: 'Old Ferryman’s dialogue' });
    expect(box.textContent).toContain('Dialogue · 1');
    expect(box.textContent).toContain('Mind the water.');
    expect(screen.queryByRole('group', { name: 'Mara’s dialogue' })).toBeNull();
  });

  it('turns an empty cue into action, and takes a parenthetical with Tab or “(”', () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(setup()));
    const { container } = openScene();
    fireEvent.click(screen.getByRole('button', { name: 'Start with a character' }));
    typeIn(cue(container), 'Mara');
    key(cue(container), 'Tab');
    const text = screen.getByRole('textbox', { name: 'Line for Mara' });
    key(text, '(');
    const paren = screen.getByRole('textbox', { name: 'Parenthetical' }) as HTMLInputElement;
    expect(document.activeElement).toBe(paren);
    typeIn(paren, 'whispering');
    key(paren, 'Enter');
    expect(paren.value).toBe('(whispering)');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Line for Mara' }));
    key(screen.getByRole('textbox', { name: 'Line for Mara' }), 'Enter');
    // Enter on the empty cue: this one is action.
    key(cue(container), 'Enter');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Action' }));
    // And Tab on an empty action line makes it a cue again.
    key(screen.getByRole('textbox', { name: 'Action' }), 'Tab');
    expect(document.activeElement).toBe(cue(container));
  });

  it('writes the scene heading as the first line, completing INT./EXT., the place and the time', () => {
    const project = setup();
    const vault = makeObject('environment', 'Vault Chamber', new Date().toISOString());
    localStorage.setItem('vcgs.project.v1', JSON.stringify({ ...project, objects: { ...project.objects, [vault.id]: vault } }));
    openScene();
    const heading = screen.getByRole('textbox', { name: 'Scene heading' }) as HTMLInputElement;
    fireEvent.focus(heading);
    const options = () => within(screen.getByRole('listbox', { name: 'Heading' })).getAllByRole('option').map((o) => o.textContent);
    expect(options()).toEqual(['INT.', 'EXT.', 'INT./EXT.']);
    typeIn(heading, 'int');
    key(heading, 'Tab');
    expect(heading.value).toBe('INT. ');
    typeIn(heading, 'INT. va');
    expect(options()).toEqual(['INT. VAULT CHAMBER —']);
    key(heading, 'Enter');
    expect(heading.value).toBe('INT. VAULT CHAMBER — ');
    typeIn(heading, 'INT. VAULT CHAMBER — ni');
    key(heading, 'Enter');
    // The scene is set there, at night: the pickers above say so, and the caret is in the script.
    expect((screen.getByRole('combobox', { name: 'Location' }) as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Vault Chamber');
    expect((screen.getByRole('combobox', { name: 'Time of day' }) as HTMLSelectElement).value).toBe('NIGHT');
    expect((screen.getByRole('textbox', { name: 'Scene heading' }) as HTMLInputElement).value).toBe('INT. VAULT CHAMBER — NIGHT');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Action' }));
  });

  it('makes a new place from a heading nobody has, and picks it up in the Environment node', () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(setup()));
    const { container } = openScene();
    const heading = screen.getByRole('textbox', { name: 'Scene heading' }) as HTMLInputElement;
    fireEvent.focus(heading);
    typeIn(heading, 'ext. lighthouse cliff - dusk');
    key(heading, 'Enter');
    expect((screen.getByRole('textbox', { name: 'Scene heading' }) as HTMLInputElement).value).toBe('EXT. LIGHTHOUSE CLIFF — DUSK');
    const environment = [...container.querySelectorAll('.perimeter')].find((b) => b.textContent!.startsWith('Environment'))!;
    expect(environment.textContent).toBe('Environment1');
  });

  it('writes transitions on the right, from Ctrl+6 or an action typed as one', () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(setup()));
    const { container } = openScene();
    fireEvent.click(screen.getByRole('button', { name: 'Start with action' }));
    const action = screen.getByRole('textbox', { name: 'Action' }) as HTMLTextAreaElement;
    typeIn(action, 'CUT TO:');
    key(action, 'Enter');
    expect((screen.getByRole('textbox', { name: 'Transition' }) as HTMLInputElement).value).toBe('CUT TO:');
    // Enter left a new action line: Ctrl+6 makes it a transition, which completes.
    const next = screen.getByRole('textbox', { name: 'Action' });
    key(next, '6', { ctrlKey: true });
    const transitions = () => screen.getAllByRole('textbox', { name: 'Transition' }) as HTMLInputElement[];
    const second = transitions()[1]!;
    expect(document.activeElement).toBe(second);
    typeIn(second, 'dis');
    expect(within(screen.getByRole('listbox', { name: 'Transitions' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['DISSOLVE TO:']);
    key(second, 'Enter');
    expect(transitions().map((t) => t.value)).toEqual(['CUT TO:', 'DISSOLVE TO:']);
    // And Ctrl+3 makes the next line a character cue.
    key(screen.getByRole('textbox', { name: 'Action' }), '3', { ctrlKey: true });
    expect(document.activeElement).toBe(cue(container));
  });
});
