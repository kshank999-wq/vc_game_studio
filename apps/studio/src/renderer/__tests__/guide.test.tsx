/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Guide, STEPS } from '../components/help/Guide';
import { guideSeen, markGuideSeen } from '../components/help/lazy';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Getting started', () => {
  it('pages through the tour and opens what a page talks about', () => {
    const onGo = vi.fn();
    const onClose = vi.fn();
    render(<Guide onGo={onGo} onClose={onClose} onSample={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open the sample game' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'The story graph' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send it to the engine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Engine handoff' }));
    expect(onGo).toHaveBeenCalledWith('engine');
    expect(onClose).toHaveBeenCalled();
    expect(STEPS.at(-1)!.title).toBe('Send it to the engine');
  });

  it('remembers it was seen', () => {
    expect(guideSeen()).toBe(false);
    markGuideSeen();
    expect(guideSeen()).toBe(true);
  });
});
