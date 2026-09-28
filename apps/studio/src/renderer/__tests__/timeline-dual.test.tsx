/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { sunkenVault } from '../model/sample';
import { moveEvent, sceneTimeline } from '../model/timeline';
import type { Project } from '../model/types';

beforeAll(() => {
  globalThis.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const vaultOf = (p: Project) => Object.values(p.objects).find((o) => o.type === 'scene' && o.name === 'The Vault Door')!.id;

const openTimeline = (project: Project) => {
  localStorage.setItem('vcgs.project.v1', JSON.stringify(project));
  const view = render(<App />);
  const node = [...view.container.querySelectorAll('[data-type="scene"]')].find((n) => n.textContent!.includes('The Vault Door'))!;
  fireEvent.doubleClick(node);
  fireEvent.click(screen.getByRole('button', { name: /SCENE TIMELINE/ }));
  return view;
};

describe('dual dialogue on the scene timeline', () => {
  it('sets the two lines side by side in one slot, the left-hand speech first', () => {
    const { container } = openTimeline(sunkenVault());
    const pair = screen.getByRole('group', { name: 'Dual dialogue: spoken at the same time' });
    const cards = [...pair.querySelectorAll('.ev')].map((c) => [c.querySelector('.ek')!.textContent, c.querySelector('.et')!.textContent]);
    expect(cards).toEqual([
      ['DLG #1', 'MARA'],
      ['DLG #2', 'THE EXPLORER'],
    ]);
    // Only these two are paired: every other dialogue card stands alone.
    expect(container.querySelectorAll('.ev-dual')).toHaveLength(1);
    // Each line is its own event: pick the Explorer's and the inspector edits his line.
    fireEvent.pointerDown(pair.querySelectorAll('.ev')[1]!, { button: 0 });
    fireEvent.pointerUp(window);
    expect(pair.querySelectorAll('.ev')[1]!.classList.contains('selected')).toBe(true);
    expect(screen.getByDisplayValue('Stand back. I’ll find it.')).toBeTruthy();
  });

  it('sets them apart once something plays between them', () => {
    const p = sunkenVault();
    const vault = vaultOf(p);
    const events = sceneTimeline(p, vault)[0]!.events;
    const echo = events.find((e) => e.label === 'Echo cue')!;
    // The echo cue between Mara and the Explorer: now they speak in turn.
    const apart = moveEvent(p, vault, echo.id, 'main', events.indexOf(echo) - 1);
    openTimeline(apart);
    expect(screen.queryByRole('group', { name: 'Dual dialogue: spoken at the same time' })).toBeNull();
  });

  it('pairs them in either order, still left-hand speech first', () => {
    const p = sunkenVault();
    const vault = vaultOf(p);
    const events = sceneTimeline(p, vault)[0]!.events;
    const dialogue = events.filter((e) => e.kind === 'dialogue');
    const swapped = moveEvent(p, vault, dialogue[1]!.id, 'main', events.indexOf(dialogue[0]!));
    openTimeline(swapped);
    const pair = screen.getByRole('group', { name: 'Dual dialogue: spoken at the same time' });
    expect([...pair.querySelectorAll('.ev .et')].map((c) => c.textContent)).toEqual(['MARA', 'THE EXPLORER']);
  });

  it('sets the pair side by side in the exploded scene too, over its two speakers', () => {
    const { container } = openTimeline(sunkenVault());
    const box = screen.getByRole('group', { name: 'Dual dialogue: Mara and The Explorer, spoken at the same time' });
    // The columns sit as their speakers do, so the wires don't cross: the Explorer's box is on the left.
    const cols = [...box.querySelectorAll('.dual-col')].map((c) => [c.querySelector('.dual-who')!.textContent, c.querySelector('.dlg-text')!.textContent]);
    expect(cols).toEqual([
      ['#3 THE EXPLORER', 'Stand back. I’ll find it.'],
      ['#2 MARA', 'Water’s holding it shut. There’s a lever somewhere.'],
    ]);
    expect(container.querySelectorAll('.dual-wire')).toHaveLength(2);
    // A column picks its speaker, which picks their first line on the timeline.
    fireEvent.pointerDown(box.querySelectorAll('.dual-col')[1]!, { button: 0 });
    const pair = screen.getByRole('group', { name: 'Dual dialogue: spoken at the same time' });
    expect(pair.querySelectorAll('.ev')[0]!.classList.contains('selected')).toBe(true);
  });

  it('says so in the exploded scene when the timeline plays the pair apart', () => {
    const p = sunkenVault();
    const vault = vaultOf(p);
    const events = sceneTimeline(p, vault)[0]!.events;
    const echo = events.find((e) => e.label === 'Echo cue')!;
    openTimeline(moveEvent(p, vault, echo.id, 'main', events.indexOf(echo) - 1));
    const box = screen.getByRole('group', { name: 'Dual dialogue: Mara and The Explorer, apart on the timeline' });
    expect(box.classList.contains('apart')).toBe(true);
    expect(within(box).getByText(/apart on the timeline/)).toBeTruthy();
  });

  it('sets a dual line side by side with its partner in both speakers’ dialogue boxes', () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(sunkenVault()));
    const view = render(<App />);
    const node = [...view.container.querySelectorAll('[data-type="scene"]')].find((n) => n.textContent!.includes('The Vault Door'))!;
    fireEvent.doubleClick(node);
    const halves = (who: string) =>
      [...screen.getByRole('group', { name: `${who}’s dialogue` }).querySelectorAll('.dlg-dual .dlg-half')].map((h) => [
        h.querySelector('.dlg-half-who')!.textContent,
        h.classList.contains('own'),
      ]);
    // The same pair in both boxes, as the script sets it; each box's own half in full.
    expect(halves('Mara')).toEqual([
      ['MARA', true],
      ['THE EXPLORER', false],
    ]);
    expect(halves('The Explorer')).toEqual([
      ['MARA', false],
      ['THE EXPLORER', true],
    ]);
    // Mara's other line is an ordinary row.
    const mara = screen.getByRole('group', { name: 'Mara’s dialogue' });
    expect(mara.querySelectorAll('.dlg-row:not(.dlg-dual)')).toHaveLength(1);
    // The row still goes to the line in the script.
    fireEvent.click(within(screen.getByRole('group', { name: 'The Explorer’s dialogue' })).getByRole('button', { name: /#3, spoken at the same time as MARA/ }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Line for The Explorer' }));
  });

  it('keeps the exploded scene’s dialogue box to its room when dual rows would overflow it', async () => {
    const { addElement, sceneLines } = await import('../model/scene');
    const { fromElements } = await import('../model/script-elements');
    const { createProject, placeNew } = await import('../model/project');
    const { spineLane } = await import('../model/layout');
    let project = createProject('Duet');
    const placed = placeNew(project, 'scene', spineLane(project).id, 400)!;
    project = addElement(placed.project, placed.id, 'character', 'Mara')!.project;
    project = addElement(project, placed.id, 'character', 'Jonah')!.project;
    project = fromElements(project, placed.id, [
      { id: 'line_a', type: 'character', text: 'MARA' },
      { id: 'line_a:text', type: 'dialogue', text: 'One.' },
      { id: 'line_b', type: 'character', text: 'JONAH', dual: true },
      { id: 'line_b:text', type: 'dialogue', text: 'Two.' },
      { id: 'line_c', type: 'character', text: 'MARA' },
      { id: 'line_c:text', type: 'dialogue', text: 'Three.' },
      { id: 'line_d', type: 'character', text: 'JONAH', dual: true },
      { id: 'line_d:text', type: 'dialogue', text: 'Four.' },
      { id: 'line_e', type: 'character', text: 'MARA' },
      { id: 'line_e:text', type: 'dialogue', text: 'Five.' },
    ]);
    expect(sceneLines(project, placed.id)).toHaveLength(5);
    localStorage.setItem('vcgs.project.v1', JSON.stringify(project));
    const view = render(<App />);
    fireEvent.doubleClick(view.container.querySelector('[data-type="scene"]')!);
    // The workspace box has room: all three of Mara's lines, two of them dual.
    const workspace = screen.getByRole('group', { name: 'Mara’s dialogue' });
    expect(workspace.querySelectorAll('.dlg-row')).toHaveLength(3);
    expect(workspace.querySelectorAll('.dlg-dual')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /SCENE TIMELINE/ }));
    const exploded = view.container.querySelector('.exploded [aria-label="Mara’s dialogue"]')!;
    expect(exploded.querySelectorAll('.dlg-row')).toHaveLength(1);
    expect(exploded.querySelector('.dlg-more')!.textContent).toBe('+ 2 more');
  });
});
