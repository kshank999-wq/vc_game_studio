/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PlayView } from '../components/play/PlayView';
import { sunkenVault } from '../model/sample';
import type { Project } from '../model/types';

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

describe('expected paths in the preview', () => {
  it('checks the sample’s paths, saves the run in view as another, and says which break after a change and why', () => {
    const p = sunkenVault();
    let committed: Project | null = null;
    const { rerender } = render(<PlayView project={p} onNavigate={() => {}} onCommit={(next) => (committed = next)} />);
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Paths' }));
    const panel = screen.getByRole('dialog', { name: 'Expected paths' });
    expect(within(panel).getByLabelText('Paths checked').textContent).toBe('All 2 paths still go their way.');
    // Save the run in view (one choice made) under a name.
    fireEvent.click(document.querySelector('.play-option:not(:disabled)')!);
    fireEvent.change(within(panel).getByLabelText('Name for this path'), { target: { value: 'Carry on at C1' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save this run' }));
    expect(committed!.paths).toHaveLength(3);
    expect(committed!.paths![2]).toMatchObject({ name: 'Carry on at C1', ending: null });
    expect(within(panel).getByRole('status').textContent).toMatch(/^Saved “Carry on at C1”: 1 decision, through \d+ scenes and plot points \(not to the end\)\.$/);

    // Rename the option "Pocket it": the path that takes it breaks, and says why.
    const pocket = p.connections.find((c) => c.kind === 'branch' && c.label === 'Pocket it')!;
    const changed: Project = { ...committed!, connections: committed!.connections.map((c) => (c.id === pocket.id ? { ...c, label: 'Keep it' } : c)) };
    rerender(<PlayView project={changed} onNavigate={() => {}} onCommit={(next) => (committed = next)} />);
    const again = screen.getByRole('dialog', { name: 'Expected paths' });
    expect(within(again).getByLabelText('Paths checked').textContent).toBe('1 of 3 paths go differently now.');
    const broken = [...again.querySelectorAll('.play-path.bad')];
    expect(broken).toHaveLength(1);
    expect(broken[0]!.textContent).toContain('Through the squeeze, pockets full');
    expect(broken[0]!.querySelector('.play-path-problem')!.textContent).toMatch(/no longer offers “Pocket it”\.$/);
    // Its decisions, with the one that broke marked.
    fireEvent.click(within(broken[0] as HTMLElement).getByRole('button', { name: 'Through the squeeze, pockets full' }));
    expect(broken[0]!.querySelector('.play-path-steps li.broke')!.textContent).toBe('C2 Pocket the ring: Pocket it');
    // Show takes the play-through to where it broke: the ring choice, offering "Keep it".
    fireEvent.click(within(broken[0] as HTMLElement).getByRole('button', { name: 'Show' }));
    fireEvent.click(within(again).getByRole('button', { name: 'Close' }));
    expect(document.querySelector('.play-choice')!.textContent).toContain('Keep it');
    // Closed, the Paths button says how many break.
    expect(screen.getByRole('button', { name: /Paths/ }).textContent).toBe('Paths · 1 ✗');
  });
});
