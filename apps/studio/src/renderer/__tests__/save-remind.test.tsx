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
