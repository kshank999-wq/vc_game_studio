/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { spineLane } from '../model/layout';
import { createProject, placeNew } from '../model/project';

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
  vi.useRealTimers();
});

describe('a game with work in it and no file', () => {
  it('is reminded to save after two minutes, and Later waits a quarter of an hour', () => {
    vi.useFakeTimers();
    // Nothing done yet: nothing to remind about.
    render(<App />);
    act(() => vi.advanceTimersByTime(3 * 60 * 1000));
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();
    // A game with a scene written, never saved to a file.
    const project = createProject();
    const placed = placeNew(project, 'scene', spineLane(project).id, 400)!;
    localStorage.setItem('vcgs.project.v1', JSON.stringify(placed.project));
    render(<App />);
    act(() => vi.advanceTimersByTime(60 * 1000));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => vi.advanceTimersByTime(61 * 1000));
    expect(screen.getByRole('alert').textContent).toContain('isn’t saved to a file yet');
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => vi.advanceTimersByTime(10 * 60 * 1000));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => vi.advanceTimersByTime(6 * 60 * 1000));
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

describe('saving where the browser cannot ask where', () => {
  it('asks for a name, downloads it under that name, and keeps the name for the next save', async () => {
    const names: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const created = URL.createObjectURL;
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL ??= () => {};
    render(<App />);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Save the project' });
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: 'My Cave: Part 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(names).toEqual(['My Cave Part 1.vcgs']));
    expect(dialog.isConnected).toBe(false);
    // The next save keeps the name; Save As asks again, and Cancel saves nothing.
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await vi.waitFor(() => expect(names).toHaveLength(2));
    expect(names[1]).toBe('My Cave Part 1.vcgs');
    expect(screen.queryByRole('dialog', { name: 'Save the project' })).toBeNull();
    fireEvent.keyDown(window, { key: 'S', ctrlKey: true, shiftKey: true });
    await screen.findByRole('dialog', { name: 'Save the project' });
    expect((screen.getByLabelText('File name') as HTMLInputElement).value).toBe('My Cave Part 1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(names).toHaveLength(2);
    click.mockRestore();
    URL.createObjectURL = created;
  });
});
