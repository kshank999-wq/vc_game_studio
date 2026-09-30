/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PlayView } from '../components/play/PlayView';
import { sunkenVault } from '../model/sample';

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

describe('skills in the play-through', () => {
  it('lists the tree, learns a rank, and says why the upgrade waits', () => {
    render(<PlayView project={sunkenVault()} onNavigate={() => {}} />);
    const skills = screen.getByRole('region', { name: 'Skills' });
    expect(within(skills).getByText('Diving')).toBeTruthy();
    const hood = within(skills).getByRole('button', { name: 'Learn Lantern Hood' }) as HTMLButtonElement;
    expect(hood.disabled).toBe(true);
    expect(within(skills).getByText('Learn Deep Breath first.')).toBeTruthy();
    fireEvent.click(within(skills).getByRole('button', { name: 'Learn Deep Breath' }));
    expect(within(skills).getByText(/· Skill · 1\/2/)).toBeTruthy();
    expect(document.querySelector('.play-skill')!.textContent).toBe(' Learned: Deep Breath · rank 1 of 2');
    // The lantern is lit by now (SC-01): next in the way, the salvage.
    expect(within(skills).getByText('Costs 2 × Salvage (you have 0).')).toBeTruthy();
  });
});
