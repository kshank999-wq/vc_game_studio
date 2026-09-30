/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';
import { sunkenVault } from '../model/sample';
import { resetPreferences, setPreferences } from '../preferences';

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
  resetPreferences();
});

describe('comments, tasks and history (spec §16)', () => {
  it('comments on an element, gives a role a task, records who changed it, and brings back what it was', async () => {
    const project = { ...sunkenVault(), comments: [] };
    const key = Object.values(project.objects).find((o) => o.name === 'Vault Key')!;
    localStorage.setItem('vcgs.project.v1', JSON.stringify(project));
    setPreferences({ authorName: 'Ana', authorRole: 'writer' });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'GAME BIBLE' }));
    fireEvent.change(await screen.findByLabelText('Search the Bible', {}, { timeout: 5000 }), { target: { value: 'Vault Key' } });
    fireEvent.click([...document.querySelectorAll('.bible-row')].find((r) => r.textContent!.includes('Vault Key'))!);
    const detail = screen.getByRole('complementary', { name: 'Vault Key detail' });
    const collab = await within(detail).findByLabelText('Comments and history of Vault Key', {}, { timeout: 5000 });

    // A comment, and a task for audio.
    fireEvent.change(within(collab).getByLabelText('New comment'), { target: { value: 'Should it glow?' } });
    fireEvent.click(within(collab).getByRole('button', { name: 'Comment' }));
    fireEvent.change(within(collab).getByLabelText('Comment or task'), { target: { value: 'task' } });
    fireEvent.change(within(collab).getByLabelText('Task for'), { target: { value: 'audio' } });
    fireEvent.change(within(collab).getByLabelText('New comment'), { target: { value: 'Record a clink' } });
    fireEvent.click(within(collab).getByRole('button', { name: 'Add task' }));
    expect([...collab.querySelectorAll('.collab-comment .collab-text')].map((e) => e.textContent)).toEqual(['Should it glow?', 'Record a clink']);
    expect(collab.querySelector('.collab-comment.task .collab-kind')!.textContent).toBe('Task · Audio');
    expect(within(collab).getAllByText(/^Ana \(Writer\) · /)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Comments and changes, 2 open' })).toBeTruthy();

    // Rename it: the history says who, and can bring the old name back.
    const name = within(detail).getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Bronze Key' } });
    fireEvent.blur(name);
    const renamed = screen.getByRole('complementary', { name: 'Bronze Key detail' });
    const history = await within(renamed).findByLabelText('Comments and history of Bronze Key');
    expect(within(history).getByText(/^Last changed by Ana \(Writer\)/)).toBeTruthy();
    fireEvent.click(within(history).getByRole('tab', { name: /History/ }));
    expect(within(history).getByText('Changed name')).toBeTruthy();
    fireEvent.click(within(history).getByRole('button', { name: 'Restore before this' }));
    expect(screen.getByRole('complementary', { name: 'Vault Key detail' })).toBeTruthy();

    // Done: the task is ticked off by the one who did it.
    const again = await within(screen.getByRole('complementary', { name: 'Vault Key detail' })).findByLabelText('Comments and history of Vault Key');
    fireEvent.click(within(again).getByRole('tab', { name: /Comments/ }));
    fireEvent.click(within(again).getByLabelText('Done: Record a clink'));
    expect(screen.getByRole('button', { name: 'Comments and changes, 1 open' })).toBeTruthy();

    // The project's panel: the open comment, the recent changes, and a way back to the key.
    fireEvent.click(screen.getByRole('button', { name: 'Comments and changes, 1 open' }));
    const panel = await screen.findByRole('dialog', { name: 'Comments and changes' }, { timeout: 5000 });
    expect([...within(panel).getByLabelText('All comments and tasks').querySelectorAll('.collab-text')].map((e) => e.textContent)).toEqual(['Should it glow?']);
    // It starts on your role's tasks; the audio task shows for every role.
    expect((within(panel).getByLabelText('Tasks for') as HTMLSelectElement).value).toBe('writer');
    fireEvent.click(within(panel).getByLabelText('Show done and resolved'));
    expect(within(panel).queryByText('Record a clink')).toBeNull();
    fireEvent.change(within(panel).getByLabelText('Tasks for'), { target: { value: '' } });
    expect(within(panel).getAllByText(/^Done by Ana \(Writer\)/)).toHaveLength(1);
    fireEvent.click(within(panel).getByRole('tab', { name: /Changes/ }));
    const changes = within(panel).getByLabelText('Recent changes');
    expect([...changes.querySelectorAll('.collab-kind')].map((e) => e.textContent)).toEqual(['Changed name']);
    expect(changes.textContent).toContain(`Vault Key`);
    expect(key.id).toBeTruthy();
  });
});
