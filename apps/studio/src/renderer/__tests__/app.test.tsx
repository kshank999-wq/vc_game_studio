/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { spineLane } from '../model/layout';
import { createProject, placeNew } from '../model/project';
import { addElement, addLine, updateLine } from '../model/scene';

beforeAll(() => {
  // jsdom has no PointerEvent; a MouseEvent carries the button the handlers read.
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

describe('the story graph', () => {
  it('opens a new project on the spine with Beginning, one plot point and Ending', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.header-spine')?.textContent).toContain('SPINE');
    const types = [...container.querySelectorAll('[data-node]')].map((n) => n.getAttribute('data-type'));
    expect(types.sort()).toEqual(['begin', 'end', 'plotPoint']);
  });

  it('adds subplot and character lanes from the bottom menu, and undo takes one back', () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByText('+ Add subplot lane'));
    fireEvent.click(screen.getByText('+ Add character lane'));
    // The spine and the character arc run the whole story; the subplot is a band between two spine nodes.
    expect(container.querySelectorAll('.track')).toHaveLength(2);
    expect(container.querySelectorAll('.subplot-band')).toHaveLength(1);
    expect(container.querySelectorAll('.span-handle')).toHaveLength(2);
    act(() => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });
    expect(container.querySelectorAll('.track')).toHaveLength(1);
    expect(container.querySelectorAll('.subplot-band')).toHaveLength(1);
  });

  it('hides a lane from its chip and shows it again', () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByText('+ Add character lane'));
    const chip = screen.getByRole('button', { name: 'Character 1' });
    fireEvent.click(chip);
    expect(container.querySelectorAll('.track')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Character 1 · hidden' }));
    expect(container.querySelectorAll('.track')).toHaveLength(2);
  });
});

describe('deleting', () => {
  it('asks in the app before a lane takes its nodes with it', async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByText('+ Add subplot lane'));
    fireEvent.click(screen.getByRole('button', { name: 'More for Subplot 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete lane' }));
    // An empty lane goes straight away.
    expect(container.querySelectorAll('.subplot-band')).toHaveLength(0);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('warns before deleting a spine node a subplot starts on, then moves the span', () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByText('+ Add subplot lane'));
    const plotPoint = container.querySelector('[data-type="plotPoint"]')!;
    fireEvent.pointerDown(plotPoint, { button: 0 });
    fireEvent.pointerUp(window);
    fireEvent.keyDown(window, { key: 'Delete' });
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('“Subplot 1” branches off or rejoins the spine here');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(container.querySelector('[data-type="plotPoint"]')).toBeNull();
    expect(container.querySelectorAll('.span-handle')).toHaveLength(2);
  });
});

describe('the wheel', () => {
  it('zooms with a mouse wheel notch and pans with a trackpad scroll', () => {
    const { container } = render(<App />);
    const canvas = container.querySelector('.canvas')!;
    const readout = () => container.querySelector('.zoom-readout')!.textContent;
    const world = () => (container.querySelector('.world') as HTMLElement).style.transform;
    const start = readout();
    act(() => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    });
    expect(readout()).not.toBe(start);
    const zoomed = readout();
    const before = world();
    act(() => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 3.5, deltaY: 12.25, bubbles: true, cancelable: true }));
    });
    expect(readout()).toBe(zoomed);
    expect(world()).not.toBe(before);
  });
});

describe('a scene', () => {
  it('opens from the story graph, explodes into ports, and comes back', () => {
    // A saved project with one scene holding a character.
    let project = createProject('The Sunken Vault');
    const placed = placeNew(project, 'scene', spineLane(project).id, 400)!;
    project = addElement(placed.project, placed.id, 'character', 'Mara')!.project;
    localStorage.setItem('vcgs.project.v1', JSON.stringify(project));

    const { container } = render(<App />);
    const card = container.querySelector('[data-type="scene"]')!;
    expect(card.textContent).toContain('1 character');
    fireEvent.pointerDown(card, { button: 0 });
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(container.querySelector('.scene-box')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('SC-01 New scene');
    expect(screen.getByRole('button', { name: /Characters/ }).textContent).toContain('1');

    fireEvent.click(screen.getByRole('button', { name: /Expand all/ }));
    expect(container.querySelectorAll('.exploded-scene .port')).toHaveLength(9);
    expect([...container.querySelectorAll('.element-box')].map((b) => b.textContent)).toEqual([expect.stringContaining('Mara')]);

    fireEvent.click(screen.getByRole('button', { name: 'Story Graph' }));
    expect(container.querySelector('.canvas')).toBeTruthy();
    // The scene is still selected on the way back.
    expect(container.querySelector('[data-type="scene"].selected')).toBeTruthy();
  });
});

describe('the scene timeline', () => {
  it('shows the script’s dialogue, adds events, and edits a line from the inspector', () => {
    let project = createProject('The Sunken Vault');
    const placed = placeNew(project, 'scene', spineLane(project).id, 400)!;
    const mara = addElement(placed.project, placed.id, 'character', 'Mara')!;
    const line = addLine(mara.project, placed.id, 'dialogue', undefined, mara.id);
    project = updateLine(line.project, line.id, { text: 'There’s a lever somewhere.' });
    localStorage.setItem('vcgs.project.v1', JSON.stringify(project));

    const { container } = render(<App />);
    fireEvent.doubleClick(container.querySelector('[data-type="scene"]')!);
    expect(container.querySelector('.strip-summary')!.textContent).toBe('1 event · 0 branches · 0 free-play');
    fireEvent.click(screen.getByRole('button', { name: /SCENE TIMELINE/ }));

    const events = () => [...container.querySelectorAll('.ev .ek')].map((e) => e.textContent);
    expect(events()).toEqual(['DLG #1']);
    fireEvent.click(screen.getByRole('button', { name: '+ Event' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Free play/ }));
    expect(events()).toEqual(['DLG #1', 'FREE PLAY · OPEN-ENDED']);

    // Select the line: the panel lights Mara, and the inspector edits the script itself.
    fireEvent.pointerDown(container.querySelector('.ev-dialogue')!, { button: 0 });
    fireEvent.pointerUp(window);
    expect(container.querySelectorAll('.element-box.lit').length).toBeGreaterThan(0);
    const text = screen.getByDisplayValue('There’s a lever somewhere.');
    fireEvent.change(text, { target: { value: 'Water’s holding it shut.' } });
    fireEvent.blur(text);
    fireEvent.click(screen.getByRole('button', { name: 'Scene' }));
    expect(screen.getByDisplayValue('Water’s holding it shut.')).toBeTruthy();
  });
});

describe('the Game Bible', () => {
  it('opens on the selected element, edits it for every view, and goes back', () => {
    let project = createProject('The Sunken Vault');
    const placed = placeNew(project, 'scene', spineLane(project).id, 400)!;
    project = addElement(placed.project, placed.id, 'character', 'Mara')!.project;
    localStorage.setItem('vcgs.project.v1', JSON.stringify(project));

    const { container } = render(<App />);
    const card = container.querySelector('[data-type="scene"]')!;
    fireEvent.pointerDown(card, { button: 0 });
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByRole('button', { name: 'GAME BIBLE' }));

    // Opened on the selected scene, in the Scenes view.
    expect(container.querySelector('.bible-view.on')!.textContent).toContain('Scenes');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('New scene');

    fireEvent.click(screen.getByRole('button', { name: /Characters \/ NPCs/ }));
    fireEvent.click(screen.getByRole('button', { name: /Mara/ }));
    const name = screen.getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Mara Vell' } });
    fireEvent.blur(name);

    fireEvent.click(screen.getByRole('button', { name: /Back to Story Graph/ }));
    fireEvent.doubleClick(container.querySelector('[data-type="scene"]')!);
    fireEvent.click(screen.getByRole('button', { name: /Characters/ }));
    expect(container.querySelector('.chip-item')!.textContent).toContain('Mara Vell');
  });
});
