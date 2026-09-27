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

const cue = (container: HTMLElement, n = -1) => [...container.querySelectorAll<HTMLTextAreaElement>('textarea.line-cue')].at(n)!;
const typeIn = (el: HTMLElement, value: string) => {
  if (el instanceof HTMLTextAreaElement) fireEvent.change(el, { target: { value } });
  else {
    (el as HTMLInputElement).value = value;
    fireEvent.input(el);
  }
};
const key = (el: Element, k: string, opts: Partial<KeyboardEventInit> = {}) => act(() => void fireEvent.keyDown(el, { key: k, ...opts }));
const styles = (container: HTMLElement) => [...container.querySelectorAll<HTMLSelectElement>('select.element-type')].map((s) => s.value);

describe('writing the script (VC Writer’s editor)', () => {
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
    // Mara speaks; Return from a cue gives her dialogue.
    expect(cue(container).value).toBe('Mara');
    const text = screen.getByRole('textbox', { name: 'Line for Mara' }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(text);
    typeIn(text, 'There’s a lever somewhere.');
    // Return after dialogue is back to action; Tab there makes it a cue.
    key(text, 'Enter');
    const action = screen.getByRole('textbox', { name: 'Action' });
    expect(document.activeElement).toBe(action);
    key(action, 'Tab');
    expect(document.activeElement).toBe(cue(container));
    expect(styles(container)).toEqual(['character', 'dialogue', 'character']);
  });

  it('makes a new character from a name nobody has, who joins the scene’s cast with their dialogue', () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(setup()));
    const { container } = openScene();
    fireEvent.click(screen.getByRole('button', { name: 'Start with a character' }));
    typeIn(cue(container), 'OLD FERRYMAN');
    key(cue(container), 'Enter');
    expect(cue(container).value).toBe('Old Ferryman');
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

  it('re-types the line on Tab, as Final Draft does: a cue, its extension, a parenthetical', () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(setup()));
    const { container } = openScene();
    fireEvent.click(screen.getByRole('button', { name: 'Start with action' }));
    const action = screen.getByRole('textbox', { name: 'Action' });
    typeIn(action, 'Mara');
    key(action, 'Tab');
    expect(styles(container)).toEqual(['character']);
    // Beside a name, Tab asks which voice it is.
    key(cue(container), 'Tab');
    fireEvent.click(within(screen.getByRole('menu', { name: 'Extension' })).getByText('Voiceover'));
    expect(screen.queryByRole('menu', { name: 'Extension' })).toBeNull();
    expect(cue(container).value).toBe('Mara (V.O.)');
    key(cue(container), 'Enter');
    // Tab in the speech reaches for a parenthetical, which arrives in its brackets.
    key(screen.getByRole('textbox', { name: 'Line for Mara' }), 'Tab');
    const paren = screen.getByRole('textbox', { name: 'Parenthetical' }) as HTMLTextAreaElement;
    expect(paren.value).toBe('()');
    expect(paren.selectionStart).toBe(1);
    typeIn(paren, '(whispering');
    fireEvent.blur(paren);
    expect(paren.value).toBe('(whispering)');
    key(paren, 'Enter');
    typeIn(screen.getByRole('textbox', { name: 'Line for Mara' }), 'Quiet now.');
    fireEvent.blur(screen.getByRole('textbox', { name: 'Line for Mara' }));
    expect(styles(container)).toEqual(['character', 'parenthetical', 'dialogue']);
    expect(screen.getByRole('group', { name: 'Mara’s dialogue' }).textContent).toContain('Quiet now.');
    // Shift+Tab walks back, and takes the brackets off.
    key(paren, 'Tab', { shiftKey: true });
    expect(styles(container)).toEqual(['character', 'character', 'dialogue']);
  });

  it('marks (CONT’D) when a character speaks again with only action between', () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(setup()));
    const { container } = openScene();
    fireEvent.click(screen.getByRole('button', { name: 'Start with a character' }));
    typeIn(cue(container), 'Mara');
    key(cue(container), 'Enter');
    typeIn(screen.getByRole('textbox', { name: 'Line for Mara' }), 'Hold the light.');
    key(screen.getByRole('textbox', { name: 'Line for Mara' }), 'Enter');
    typeIn(screen.getByRole('textbox', { name: 'Action' }), 'She wades in.');
    key(screen.getByRole('textbox', { name: 'Action' }), 'Tab');
    typeIn(cue(container), 'Mara');
    key(cue(container), 'Enter');
    expect(container.querySelectorAll('.line-contd')).toHaveLength(1);
    // Another voice between them breaks the run.
    const last = screen.getAllByRole('textbox', { name: 'Line for Mara' }).at(-1)!;
    key(last, 'Enter');
    key(screen.getAllByRole('textbox', { name: 'Action' }).at(-1)!, 'Tab');
    typeIn(cue(container), 'Jonah');
    key(cue(container), 'Enter');
    key(screen.getByRole('textbox', { name: 'Line for Jonah' }), 'Enter');
    key(screen.getAllByRole('textbox', { name: 'Action' }).at(-1)!, 'Tab');
    typeIn(cue(container), 'Mara');
    key(cue(container), 'Enter');
    expect(container.querySelectorAll('.line-contd')).toHaveLength(1);
  });

  it('reads a script pasted as text into cues, parentheticals and dialogue', () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(setup()));
    const { container } = openScene();
    fireEvent.click(screen.getByRole('button', { name: 'Start with action' }));
    const action = screen.getByRole('textbox', { name: 'Action' });
    fireEvent.paste(action, { clipboardData: { getData: () => 'Water pours in.\n\nMARA\nWe go now.\n\nJONAH\n(quietly)\nFine.' } });
    expect(styles(container)).toEqual(['action', 'character', 'dialogue', 'character', 'parenthetical', 'dialogue']);
    fireEvent.blur(document.activeElement!);
    expect(screen.getByRole('group', { name: 'Jonah’s dialogue' }).textContent).toContain('Fine.');
  });

  it('removes an empty line on Backspace', () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(setup()));
    const { container } = openScene();
    fireEvent.click(screen.getByRole('button', { name: 'Start with action' }));
    typeIn(screen.getByRole('textbox', { name: 'Action' }), 'The door groans.');
    key(screen.getByRole('textbox', { name: 'Action' }), 'Enter');
    expect(styles(container)).toEqual(['action', 'action']);
    key(screen.getAllByRole('textbox', { name: 'Action' })[1]!, 'Backspace');
    expect(styles(container)).toEqual(['action']);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Action' }));
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
    // The line is what it turns out to be.
    const first = screen.getByRole('textbox', { name: 'Transition' }) as HTMLTextAreaElement;
    expect(first.value).toBe('CUT TO:');
    key(first, 'Enter');
    // Enter left a new action line: Ctrl+6 makes it a transition, which completes.
    const next = screen.getByRole('textbox', { name: 'Action' });
    key(next, '6', { ctrlKey: true });
    const transitions = () => screen.getAllByRole('textbox', { name: 'Transition' }) as HTMLTextAreaElement[];
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
