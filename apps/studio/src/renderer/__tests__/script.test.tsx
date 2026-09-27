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
});
