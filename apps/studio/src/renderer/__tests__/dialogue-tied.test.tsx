/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { spineLane } from '../model/layout';
import { createProject, placeNew } from '../model/project';
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

/** A scene with Mara and a radio in it. */
const setup = (): Project => {
  let project = createProject('The Sunken Vault');
  const placed = placeNew(project, 'scene', spineLane(project).id, 400)!;
  project = addElement(placed.project, placed.id, 'character', 'Mara')!.project;
  return addElement(project, placed.id, 'object', 'Radio')!.project;
};

const openScene = () => {
  const view = render(<App />);
  fireEvent.doubleClick(view.container.querySelector('[data-type="scene"]')!);
  return view;
};

const saved = (): Project => JSON.parse(localStorage.getItem('vcgs.project.v1')!) as Project;
const row = (container: HTMLElement, name: string) => [...container.querySelectorAll<HTMLElement>('.side-item')].find((r) => r.textContent!.includes(name))!;

describe('dialogue tied to who says it', () => {
  it('a character clicked in the scene gets + Dialogue: a line in their dialogue box, open in the script', () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(setup()));
    const { container } = openScene();
    // Nothing selected: no button yet.
    expect(screen.queryByRole('button', { name: 'New dialogue for Mara' })).toBeNull();
    fireEvent.click(row(container, 'Mara'));
    fireEvent.click(screen.getByRole('button', { name: 'New dialogue for Mara' }));
    expect(screen.getByRole('tab', { name: 'Dialogue' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Line for Mara' })).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Mara’s dialogue' })).getByText(/Dialogue · 1/)).toBeTruthy();
  });

  it('an object clicked in the scene gets + Voiceover: RADIO (V.O.), listed on the radio', async () => {
    localStorage.setItem('vcgs.project.v1', JSON.stringify(setup()));
    const { container } = openScene();
    const objects = [...container.querySelectorAll<HTMLElement>('.side-cat-head')].find((b) => b.textContent!.includes('Objects'))!;
    if (objects.getAttribute('aria-expanded') !== 'true') fireEvent.click(objects);
    fireEvent.click(row(container, 'Radio'));
    fireEvent.click(screen.getByRole('button', { name: 'New voiceover from Radio' }));
    const cue = [...container.querySelectorAll<HTMLTextAreaElement>('textarea.line-cue')].at(-1)!;
    expect(cue.value).toBe('Radio (V.O.)');
    expect(within(screen.getByRole('group', { name: 'Voiceover from Radio' })).getByText(/Voiceover · 1/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 600));
    const line = saved().lines.at(-1)!;
    expect(line.voiceFrom).toBeTruthy();
    expect(line.speakerId).toBeNull();
  });
});
