/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { spineLane } from '../model/layout';
import { createProject, placeNew } from '../model/project';
import { addElement, setSceneHeading } from '../model/scene';
import { fromElements } from '../model/script-elements';
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

/** INT. HOTEL — DAY, with Jonah's line written before Mara's. */
const setup = (): { project: Project; sceneId: string } => {
  let project = createProject('Hotel');
  const placed = placeNew(project, 'scene', spineLane(project).id, 400)!;
  project = setSceneHeading(placed.project, placed.id, 'INT. HOTEL — DAY');
  project = addElement(project, placed.id, 'character', 'Mara')!.project;
  project = addElement(project, placed.id, 'character', 'Jonah')!.project;
  project = fromElements(project, placed.id, [
    { id: 'a', type: 'action', text: 'The lobby.' },
    { id: 'c1', type: 'character', text: 'JONAH' },
    { id: 'd1', type: 'dialogue', text: 'You came.' },
    { id: 'c2', type: 'character', text: 'MARA' },
    { id: 'd2', type: 'dialogue', text: 'I said I would.' },
  ]);
  return { project, sceneId: placed.id };
};

const openDialogue = () => {
  const view = render(<App />);
  fireEvent.doubleClick(view.container.querySelector('[data-type="scene"]')!);
  fireEvent.click(screen.getByRole('tab', { name: 'Dialogue' }));
  return view;
};

describe('the scene’s beats and its script', () => {
  it('Beats lists the scene in order; moving one reorders the script', () => {
    const { project } = setup();
    localStorage.setItem('vcgs.project.v1', JSON.stringify(project));
    openDialogue();
    fireEvent.click(screen.getByRole('tab', { name: 'Beats' }));
    const list = screen.getByRole('list', { name: 'Beats' });
    expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('.beat-text')!.textContent)).toEqual(['The lobby.', 'You came.', 'I said I would.']);
    fireEvent.click(screen.getByRole('button', { name: 'Move beat 3 up' }));
    expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('.beat-text')!.textContent)).toEqual(['The lobby.', 'I said I would.', 'You came.']);
    // Alt+↓ moves it back.
    fireEvent.keyDown(within(list).getAllByRole('listitem')[1]!, { key: 'ArrowDown', altKey: true });
    expect(within(list).getAllByRole('listitem')[1]!.querySelector('.beat-text')!.textContent).toBe('You came.');
    fireEvent.click(screen.getByRole('button', { name: 'Move beat 2 down' }));
    // Back in the script, in the new order.
    fireEvent.click(screen.getByRole('tab', { name: 'Script' }));
    const said = screen.getAllByRole('textbox').map((t) => (t as HTMLTextAreaElement).value).filter((v) => v === 'You came.' || v === 'I said I would.');
    expect(said).toEqual(['I said I would.', 'You came.']);
  });

  it('exports the script and the recording script from the scene', () => {
    const { project } = setup();
    localStorage.setItem('vcgs.project.v1', JSON.stringify(project));
    openDialogue();
    fireEvent.click(screen.getByRole('button', { name: 'Export script…' }));
    const dialog = screen.getByRole('dialog', { name: 'Export the script' });
    const preview = within(dialog).getByTitle('Preview') as HTMLIFrameElement;
    expect(preview.getAttribute('srcdoc')).toContain('INT. HOTEL — DAY');
    expect(within(dialog).getByRole('button', { name: 'Download .fountain' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Recording script' }));
    expect(within(dialog).getByText('2 lines · 2 voices')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Lines for' }), { target: { value: Object.values(project.objects).find((o) => o.name === 'Mara')!.id } });
    expect(within(dialog).getByText('1 line')).toBeTruthy();
    expect(preview.getAttribute('srcdoc')).toContain('after JONAH: “You came.”');
  });

  it('Takes: upload a session of audio and each file marks its line recorded', async () => {
    const { project } = setup();
    localStorage.setItem('vcgs.project.v1', JSON.stringify(project));
    openDialogue();
    fireEvent.click(screen.getByRole('button', { name: 'Takes…' }));
    const dialog = screen.getByRole('dialog', { name: 'Export the script' });
    expect(within(dialog).getByText('0 of 2 recorded')).toBeTruthy();
    const keys = [...dialog.querySelectorAll('.takes-row .key')].map((k) => k.textContent!);
    const files = [new File([new Uint8Array([1, 2])], `${keys[1]}.wav`, { type: 'audio/wav' }), new File(['x'], 'room tone.wav', { type: 'audio/wav' })];
    fireEvent.change(within(dialog).getByLabelText('Audio files for these lines'), { target: { files } });
    await waitFor(() => expect(within(dialog).getByText('1 of 2 recorded')).toBeTruthy());
    expect(within(dialog).getByText(/1 take matched to its line; 1 not matched \(room tone.wav\)/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Play the take for “I said I would.”' })).toBeTruthy();
    // Taken off again: back to be recorded.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove the take for “I said I would.”' }));
    expect(within(dialog).getByText('0 of 2 recorded')).toBeTruthy();
  });

  it('a beat card takes its line’s audio', async () => {
    const { project } = setup();
    localStorage.setItem('vcgs.project.v1', JSON.stringify(project));
    openDialogue();
    fireEvent.click(screen.getByRole('tab', { name: 'Beats' }));
    const file = new File([new Uint8Array([9])], 'whatever.mp3', { type: 'audio/mpeg' });
    fireEvent.change(screen.getByLabelText('Audio file for “You came.”'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play the take for “You came.”' })).toBeTruthy());
    expect(screen.getByLabelText('Audio file for “I said I would.”')).toBeTruthy();
  });
});
