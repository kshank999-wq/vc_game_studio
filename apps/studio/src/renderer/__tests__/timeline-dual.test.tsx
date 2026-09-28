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
});
