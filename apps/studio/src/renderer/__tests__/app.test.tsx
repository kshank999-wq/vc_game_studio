/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../App';

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
    expect(container.querySelectorAll('.track')).toHaveLength(3);
    expect(container.querySelectorAll('.span-handle')).toHaveLength(2);
    act(() => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });
    expect(container.querySelectorAll('.track')).toHaveLength(2);
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
    expect(container.querySelectorAll('.track')).toHaveLength(1);
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
    expect(dialog.textContent).toContain('“Subplot 1” starts or stops here');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(container.querySelector('[data-type="plotPoint"]')).toBeNull();
    expect(container.querySelectorAll('.span-handle')).toHaveLength(2);
  });
});
