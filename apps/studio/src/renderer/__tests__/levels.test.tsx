/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { addLevel, placeAsset, resizeItem, saveToLibrary, setParam } from '../model/level/level';
import { createProject } from '../model/project';
import { sunkenVault } from '../model/sample';
import { resetPreferences } from '../preferences';

/** Lazy views: wait until nothing is loading. */
// The first import of a lazy view (three.js among them) can take a few seconds on a busy machine.
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

const openLevels = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'LEVELS' }));
  await opened();
};

describe('the Level Designer', () => {
  it('creates the first level, places a room from the library and edits it in the inspector', async () => {
    const { container } = render(<App />);
    await openLevels();
    fireEvent.click(screen.getByRole('button', { name: '+ Create the first level' }));
    expect(screen.getByRole('application', { name: 'Level map' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /to check/ }).textContent).toContain('1 to check');

    // Click a room in the library, then click the map to put it down.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Place Room' }), { button: 0, clientX: 10, clientY: 10 });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    });
    fireEvent.pointerDown(screen.getByRole('application', { name: 'Level map' }), { button: 0, clientX: 200, clientY: 150 });
    expect(container.querySelector('.lvl-right-head')!.textContent).toContain('Room');
    expect(container.querySelector('.lvl-right-head')!.textContent).toMatch(/RM_\w+_Room_001/);
    expect(container.querySelector('.lvl-space')).toBeTruthy();

    // The inspector's width is the map's width.
    const width = screen.getByRole('textbox', { name: 'Width' });
    fireEvent.change(width, { target: { value: '12' } });
    fireEvent.blur(width);
    expect(container.querySelector('.lvl-map')!.textContent).toContain('12 m × 6 m');
    expect(screen.getByRole('button', { name: 'Reset Width' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset Width' }));
    expect(container.querySelector('.lvl-map')!.textContent).toContain('8 m × 6 m');

    // Undo takes back the reset, one step.
    act(() => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });
    expect(container.querySelector('.lvl-map')!.textContent).toContain('12 m × 6 m');
  });

  it('outlines a space of any shape corner by corner, then edits its corners', async () => {
    const { container } = render(<App />);
    await openLevels();
    fireEvent.click(screen.getByRole('button', { name: '+ Create the first level' }));
    const map = screen.getByRole('application', { name: 'Level map' });
    fireEvent.click(screen.getByRole('button', { name: 'Outline' }));
    // An L: six corners, then the first one again to close it.
    for (const [x, y] of [[96, 96], [240, 96], [240, 192], [336, 192], [336, 288], [96, 288], [97, 97]] as const) {
      fireEvent.pointerDown(map, { button: 0, clientX: x, clientY: y });
    }
    const shape = () => container.querySelector('.lvl-shape')!.textContent!;
    expect(shape()).toContain('6 corners');
    expect(shape()).toContain('64 m²');
    expect(container.querySelector('.lvl-map')!.textContent).toContain('64 m²');

    // Drag the notch's inner corner 2 m south: its east wall slants, and the room loses 4 m².
    fireEvent.pointerDown(container.querySelector('[data-handle="corner-2"]')!, { button: 0, clientX: 240, clientY: 192 });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 240, clientY: 240 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 240, clientY: 240 }));
    });
    expect(shape()).toContain('60 m²');

    // Click a wall's middle to add a corner there; double-click a corner to take it out.
    fireEvent.pointerDown(container.querySelector('[data-handle="add-0"]')!, { button: 0 });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', {}));
    });
    expect(shape()).toContain('7 corners');
    fireEvent.doubleClick(container.querySelector('[data-handle="corner-1"]')!);
    expect(shape()).toContain('6 corners');

    // Back to a rectangle of the same bounds, and one undo step brings the outline back.
    fireEvent.click(screen.getByRole('button', { name: 'Make rectangular' }));
    expect(shape()).toContain('Rectangle');
    act(() => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });
    expect(shape()).toContain('6 corners');
  });

  it('takes back a corner with Backspace while outlining, and Escape drops the outline', async () => {
    const { container } = render(<App />);
    await openLevels();
    fireEvent.click(screen.getByRole('button', { name: '+ Create the first level' }));
    const map = screen.getByRole('application', { name: 'Level map' });
    fireEvent.keyDown(window, { key: 'o' });
    for (const [x, y] of [[96, 96], [240, 96], [240, 240]] as const) fireEvent.pointerDown(map, { button: 0, clientX: x, clientY: y });
    expect(container.querySelectorAll('.lvl-outline-draft circle')).toHaveLength(3);
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(container.querySelectorAll('.lvl-outline-draft circle')).toHaveLength(2);
    fireEvent.pointerDown(map, { button: 0, clientX: 96, clientY: 240 });
    fireEvent.pointerDown(map, { button: 0, clientX: 48, clientY: 168 });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(container.querySelector('.lvl-shape')!.textContent).toContain('4 corners');
    fireEvent.pointerDown(map, { button: 0, clientX: 400, clientY: 400 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('.lvl-outline-draft')).toBeNull();
    // Still just the one space.
    expect(container.querySelectorAll('.lvl-space')).toHaveLength(1);
  });

  it('outlines a trigger volume too', async () => {
    const { container } = render(<App />);
    await openLevels();
    fireEvent.click(screen.getByRole('button', { name: '+ Create the first level' }));
    const map = screen.getByRole('application', { name: 'Level map' });
    fireEvent.click(screen.getByRole('button', { name: 'Outline' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Draw' }), { target: { value: 'logic.trigger' } });
    for (const [x, y] of [[96, 96], [240, 96], [168, 216]] as const) fireEvent.pointerDown(map, { button: 0, clientX: x, clientY: y });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(container.querySelector('.lvl-right-head')!.textContent).toContain('Trigger volume');
    expect(container.querySelector('.lvl-shape')!.textContent).toContain('3 corners');
    expect(container.querySelectorAll('[data-handle^="corner-"]')).toHaveLength(3);
  });

  it('saves an item’s changes to its library asset, and walks another item through the update', async () => {
    const made = addLevel(createProject('Store'), 'Store');
    const floorId = made.project.levels!.levels[0]!.floors[0]!.id;
    const crate = placeAsset(made.project, made.id, floorId, 'prop.crate', { x: 0, y: 0 });
    const saved = saveToLibrary(crate.project, crate.ids, 'Supply crate');
    const a = placeAsset(saved.project, made.id, floorId, saved.assetId, { x: 4, y: 0 });
    const b = placeAsset(a.project, made.id, floorId, saved.assetId, { x: 8, y: 0 });
    const p = resizeItem(setParam(b.project, a.ids[0]!, 'material', 'metal'), a.ids[0]!, { w: 2 });
    localStorage.setItem('vcgs.project.v1', JSON.stringify(p));
    const { container } = render(<App />);
    await openLevels();
    fireEvent.click(screen.getByRole('tab', { name: /Outliner/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Supply crate$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes to Supply crate' }));
    expect(screen.queryByRole('button', { name: 'Save changes to Supply crate' })).toBeNull();
    // The other crate is from v1: it says what changed, and can keep its old width.
    fireEvent.click(screen.getByRole('button', { name: /^Supply crate 2$/ }));
    const box = screen.getByRole('group', { name: 'Library update' });
    expect(box.textContent).toContain('v1 → v2');
    expect(box.textContent).toContain('Proxy material: neutral → metal');
    fireEvent.click(screen.getByRole('checkbox', { name: /Width: 1 → 2/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Update to v2' }));
    expect(screen.queryByRole('group', { name: 'Library update' })).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Width' }) as HTMLInputElement).value).toBe('1');
    expect(container.querySelector('.lvl-right-head')!.textContent).not.toContain('the library is at');
  });

  it('locates a timeline event’s place in the level, and lists the item’s events back', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    const { container } = render(<App />);
    const card = [...container.querySelectorAll('[data-type="scene"]')].find((c) => c.textContent!.includes('The Vault Door'))!;
    fireEvent.doubleClick(card);
    fireEvent.click(screen.getByRole('button', { name: /SCENE TIMELINE/ }));
    const cinematic = container.querySelector('.ev-cinematic')!;
    expect(cinematic.querySelector('.ev-place')!.getAttribute('aria-label')).toBe('In the level: Door in the dark trigger');
    fireEvent.pointerDown(cinematic, { button: 0 });
    fireEvent.pointerUp(window);
    const where = screen.getByRole('combobox', { name: 'Where in the level' }) as HTMLSelectElement;
    expect(where.selectedOptions[0]!.textContent).toBe('Found by its link: Door in the dark trigger');
    fireEvent.click(screen.getByRole('button', { name: 'Locate Door in the dark trigger' }));
    await opened();
    expect(container.querySelector('.lvl-right-head')!.textContent).toContain('Door in the dark trigger');
    expect(screen.getByLabelText('On scene timelines').textContent).toContain('SC-03');
  });

  it('says so when the graybox cannot use WebGL', async () => {
    const p = sunkenVault();
    localStorage.setItem('vcgs.project.v1', JSON.stringify(p));
    render(<App />);
    await openLevels();
    fireEvent.click(screen.getByRole('button', { name: '3D graybox' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('needs WebGL'), { timeout: 5000 });
  });

  it('goes from a Bible entry to its place in the level, and from the level back to the scene', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'GAME BIBLE' }));
    await opened();
    fireEvent.click(screen.getAllByText('Vault Key')[0]!);
    const uses = container.querySelector('.level-uses')!;
    // The key itself, and the door that needs it.
    const labels = [...uses.querySelectorAll('.use-label')].map((l) => l.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Vault Key', 'Bronze Door']));
    fireEvent.click([...uses.querySelectorAll('button')].find((b) => b.querySelector('.use-label')!.textContent === 'Vault Key')!);
    await opened();
    expect(container.querySelector('.lvl-right-head')!.textContent).toContain('INV_SiltCamp_VaultKey_001');

    // Select the vault chamber from the outliner; its scene link opens the scene.
    fireEvent.click(screen.getByRole('tab', { name: /Outliner/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Vault Chamber$/ }));
    fireEvent.click(screen.getByRole('button', { name: /SC-\d+ The Vault Door/ }));
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('The Vault Door');
  });
});

describe('Play Mode', () => {
  it('starts from the toolbar or F5, says when WebGL is off, and goes back to the editor', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    const { container } = render(<App />);
    await openLevels();
    fireEvent.click(screen.getByRole('button', { name: '▶ Play' }));
    // The message comes once the renderer has tried and failed to start.
    expect(await screen.findByText(/Play Mode needs WebGL/, undefined, { timeout: 5000 })).toBeTruthy();
    expect(container.querySelector('.lvl.playing')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the editor' }));
    expect(container.querySelector('.play-mode')).toBeNull();

    // F5 in the levels plays the level, not the story's play-through.
    act(() => {
      fireEvent.keyDown(window, { key: 'F5' });
    });
    await waitFor(() => expect(container.querySelector('.play-mode')).toBeTruthy(), { timeout: 5000 });
    expect(container.querySelector('.play-view')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Levels');
    fireEvent.click(screen.getByRole('button', { name: '■ Stop' }));
    expect(container.querySelector('.play-mode')).toBeNull();
  });

  it('pauses into the inspect panel, where a test preset and a note can be saved', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    const { container } = render(<App />);
    await openLevels();
    fireEvent.click(screen.getByRole('button', { name: '▶ Play' }));
    await waitFor(() => expect(container.querySelector('.play-mode')).toBeTruthy(), { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: /Inspect/ }));
    const panel = screen.getByRole('dialog', { name: 'Paused' });
    expect(panel.textContent).toContain('Vault Key');
    fireEvent.click(screen.getByRole('button', { name: 'Give Vault Key' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Preset name' }), { target: { value: 'Has the key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    fireEvent.click(screen.getByRole('tab', { name: /Notes/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Needs a light by the door' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop playing' }));
    // The preset is offered next time; the note is in the preflight.
    expect([...(screen.getByRole('combobox', { name: 'Start with' }) as HTMLSelectElement).options].map((o) => o.text)).toContain('Has the key');
    expect(screen.getByRole('button', { name: /to check/ }).textContent).toContain('1 to check');
  });
});
