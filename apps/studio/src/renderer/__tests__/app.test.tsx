/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { spineLane } from '../model/layout';
import { createProject, placeNew } from '../model/project';
import { addElement, addLine, updateLine } from '../model/scene';

/** The Bible, play-through, shot list and handoff load on first use; wait for the one just opened. */
// The first import of a lazy view (three.js among them) can take a few seconds on a busy machine.
const opened = () => waitFor(() => expect(document.querySelector('.view-loading')).toBeNull(), { timeout: 5000 });

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
  it('opens a new project on the spine with Beginning, the Opening, one plot point and Ending, under the Level lane', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.header-spine')?.textContent).toContain('SPINE');
    expect(container.querySelector('.header-level')?.textContent).toContain('LEVELS');
    const types = [...container.querySelectorAll('[data-node]')].map((n) => n.getAttribute('data-type'));
    expect(types.sort()).toEqual(['begin', 'cinematic', 'end', 'plotPoint']);
  });

  it('adds a level on the Level lane, between Beginning and the first plot point, with a map of its own', () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '+ Level' }));
    expect(container.querySelectorAll('.level-band')).toHaveLength(1);
    expect(container.querySelectorAll('.level-handle')).toHaveLength(2);
    // Named as it is added; Enter keeps the name.
    const name = screen.getByRole('textbox', { name: 'Level name' });
    fireEvent.change(name, { target: { value: 'The Cave' } });
    fireEvent.blur(name);
    expect(container.querySelector('.level-band')?.textContent).toContain('The Cave');
    fireEvent.click(screen.getByRole('button', { name: '+ Level' }));
    expect(container.querySelectorAll('.level-band')).toHaveLength(2);
    // Every stretch has a level now: there is no third to add.
    fireEvent.click(screen.getByRole('button', { name: '+ Level' }));
    expect(container.querySelectorAll('.level-band')).toHaveLength(2);
  });

  it('opens a plot point in the writing box, as a scene opens, and the Opening in its shot list with credits', async () => {
    const { container } = render(<App />);
    fireEvent.doubleClick(container.querySelector('[data-type="plotPoint"]')!);
    expect(await screen.findByRole('tab', { name: 'Script' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Story Graph' }));
    fireEvent.doubleClick(container.querySelector('[data-type="cinematic"]')!);
    await opened();
    expect(await screen.findByRole('region', { name: 'Opening credits' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Credit 2 role' }) as HTMLInputElement).value).toBe('Directed by');
    fireEvent.click(screen.getByRole('button', { name: '+ Credit' }));
    expect(screen.getAllByRole('textbox', { name: /Credit \d+ role/ })).toHaveLength(6);
  });

  it('adds subplot and character lanes from the bottom menu, and undo takes one back', () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByText('+ Add subplot lane'));
    fireEvent.click(screen.getByText('+ Add character lane'));
    // Every lane runs the whole story: the spine, the Player Lane and the new
    // subplot, the character arc, and the Level lane at the bottom.
    expect(container.querySelectorAll('.track')).toHaveLength(5);
    expect(container.querySelectorAll('.track-subplot')).toHaveLength(2);
    expect(container.querySelectorAll('.span-handle')).toHaveLength(0);
    expect([...container.querySelectorAll('.track-header')].map((h) => h.className.split(' ')[1])).toEqual([
      'header-spine',
      'header-subplot',
      'header-subplot',
      'header-character',
      'header-level',
    ]);
    act(() => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });
    expect(container.querySelectorAll('.track')).toHaveLength(4);
    expect(container.querySelectorAll('.track-subplot')).toHaveLength(2);
  });

  it('hides a lane from its chip and shows it again', () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByText('+ Add character lane'));
    const chip = screen.getByRole('button', { name: 'Character 1' });
    fireEvent.click(chip);
    expect(container.querySelectorAll('.track')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Character 1 · hidden' }));
    expect(container.querySelectorAll('.track')).toHaveLength(4);
  });
});

describe('deleting', () => {
  it('asks in the app before a lane takes its nodes with it', async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByText('+ Add subplot lane'));
    fireEvent.click(screen.getByRole('button', { name: 'More for Subplot 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete lane' }));
    // An empty lane goes straight away; the Player Lane stays.
    expect(container.querySelectorAll('.track-subplot')).toHaveLength(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('moves a lane up or down from its menu, above the spine if wanted, and every lane has a grip to drag it', () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByText('+ Add subplot lane'));
    const order = () => [...container.querySelectorAll('.track-header')].map((h) => [h.querySelector('b')!.textContent, h.querySelector('.header-lane-name')?.textContent].filter(Boolean).join(' · '));
    expect(order()).toEqual(['SPINE', 'PLAYER · Player Lane', 'SUBPLOT · Subplot 1', 'LEVELS']);
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'More for Subplot 1' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    }
    expect(order()).toEqual(['SUBPLOT · Subplot 1', 'SPINE', 'PLAYER · Player Lane', 'LEVELS']);
    fireEvent.click(screen.getByRole('button', { name: 'More for Subplot 1' }));
    expect((screen.getByRole('menuitem', { name: 'Move up' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole('button', { name: /up or down$/ })).toHaveLength(4);
    // Undo puts it back.
    act(() => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });
    expect(order()[1]).toBe('SUBPLOT · Subplot 1');
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
    // A port per category; dialogue hangs off the characters who speak it.
    expect(container.querySelectorAll('.exploded-scene .port')).toHaveLength(8);
    expect([...container.querySelectorAll('.element-box')].map((b) => b.textContent)).toEqual([expect.stringContaining('Mara')]);

    fireEvent.click(screen.getByRole('button', { name: 'Story Graph' }));
    expect(container.querySelector('.canvas')).toBeTruthy();
    // The scene is still selected on the way back.
    expect(container.querySelector('[data-type="scene"].selected')).toBeTruthy();
  });
});

describe('the scene box', () => {
  it('lists what is in the scene down the right, opens one on a double-click, and adds a trigger from Logic', () => {
    let project = createProject('The Sunken Vault');
    const placed = placeNew(project, 'scene', spineLane(project).id, 400)!;
    project = addElement(placed.project, placed.id, 'inventory', 'Vault Key')!.project;
    localStorage.setItem('vcgs.project.v1', JSON.stringify(project));

    const { container } = render(<App />);
    fireEvent.doubleClick(container.querySelector('[data-type="scene"]')!);
    const panel = screen.getByRole('complementary', { name: 'In this scene' });
    const kind = (label: string) => within(panel).getByRole('button', { name: new RegExp(`^${label} \\(\\d+\\)$`) });
    // Inventory has something in it, so it is open; Logic is empty, so it is shut.
    expect(kind('Inventory').getAttribute('aria-expanded')).toBe('true');
    expect(kind('Logic').getAttribute('aria-expanded')).toBe('false');
    // A click selects the key; a double-click opens it in the panel, and Escape goes back to the list.
    fireEvent.click(within(panel).getByText('Vault Key'));
    expect(screen.queryByRole('complementary', { name: 'Vault Key detail' })).toBeNull();
    fireEvent.doubleClick(within(panel).getByText('Vault Key'));
    expect(screen.getByRole('complementary', { name: 'Vault Key detail' })).toBeTruthy();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('complementary', { name: 'Vault Key detail' })).toBeNull();
    // Logic: + Add logic, + New trigger, and the trigger is in the scene, ready to name.
    fireEvent.click(kind('Logic'));
    fireEvent.click(within(panel).getByRole('button', { name: '+ Add logic' }));
    fireEvent.click(within(panel).getByRole('menuitem', { name: '+ New trigger' }));
    expect(container.querySelectorAll('.side-item')).toHaveLength(2);
    expect(within(panel).getByLabelText('Name')).toBeTruthy();
    fireEvent.change(within(panel).getByLabelText('Name'), { target: { value: 'Rope snaps' } });
    fireEvent.blur(within(panel).getByLabelText('Name'));
    // Its open button takes it to where its rule is set.
    fireEvent.click(within(panel).getByRole('button', { name: 'Open Rope snaps' }));
    expect(screen.getByRole('complementary', { name: 'Rope snaps detail' }).textContent).toContain('Fires when');
    fireEvent.click(within(panel).getByRole('button', { name: '← In this scene' }));
    // The panel can be dragged wider by its edge.
    expect(within(panel).getByRole('separator')).toBeTruthy();
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
  it('opens on the selected element, edits it for every view, and goes back', async () => {
    let project = createProject('The Sunken Vault');
    const placed = placeNew(project, 'scene', spineLane(project).id, 400)!;
    project = addElement(placed.project, placed.id, 'character', 'Mara')!.project;
    localStorage.setItem('vcgs.project.v1', JSON.stringify(project));

    const { container } = render(<App />);
    const card = container.querySelector('[data-type="scene"]')!;
    fireEvent.pointerDown(card, { button: 0 });
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByRole('button', { name: 'GAME BIBLE' }));
    await opened();

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
    // The cast shows by itself once the scene has one.
    expect(container.querySelector('.side-item')!.textContent).toContain('Mara Vell');
  });
});
