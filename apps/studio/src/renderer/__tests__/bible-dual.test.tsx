/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GameBible } from '../components/bible/GameBible';
import { sunkenVault } from '../model/sample';
import { moveEvent, sceneTimeline } from '../model/timeline';
import type { Project } from '../model/types';

afterEach(cleanup);

const lineSaying = (p: Project, words: string) => p.lines.find((l) => l.text.startsWith(words))!;
const open = (p: Project, focus: string) => render(<GameBible project={p} onCommit={() => {}} focus={focus} onNavigate={() => {}} onOpenCode={() => {}} onDelete={() => {}} />);

describe('dual dialogue in the Game Bible', () => {
  it('sets a dual line beside the line it is spoken with, in the list and in its detail', () => {
    const p = sunkenVault();
    const explorer = lineSaying(p, 'Stand back');
    const { container } = open(p, explorer.id);
    // In the list, each line of the pair reads with its partner beside it, the script's left-hand speech first.
    const rows = [...container.querySelectorAll('.bible-dual')].map((d) =>
      [...d.querySelectorAll('.bible-dual-half')].map((h) => [h.classList.contains('own'), h.textContent]),
    );
    expect(rows).toEqual([
      [
        [true, 'Water’s holding it shut. There’s a lever somewhere.'],
        [false, 'THE EXPLORERStand back. I’ll find it.'],
      ],
      [
        [false, 'MARAWater’s holding it shut. There’s a lever somewhere.'],
        [true, 'Stand back. I’ll find it.'],
      ],
    ]);
    // The detail: both lines side by side, and the partner goes to its line.
    const together = screen.getByRole('region', { name: 'Spoken at the same time' });
    const cols = [...together.querySelectorAll('.bible-dual-col')].map((c) => c.textContent);
    expect(cols).toEqual(['#2 MARA(listening)Water’s holding it shut. There’s a lever somewhere.', '#3 THE EXPLORER(wading forward)Stand back. I’ll find it.']);
    expect(within(together).getByText(/the game plays them as one beat/)).toBeTruthy();
    fireEvent.click(within(together).getByRole('button', { name: /MARA/ }));
    expect(container.querySelector('.detail-name')!.textContent).toBe('Line #2');
  });

  it('says when the timeline plays the pair apart', () => {
    const p = sunkenVault();
    const vault = Object.values(p.objects).find((o) => o.type === 'scene' && o.name === 'The Vault Door')!.id;
    const events = sceneTimeline(p, vault)[0]!.events;
    const echo = events.find((e) => e.label === 'Echo cue')!;
    const apart = moveEvent(p, vault, echo.id, 'main', events.indexOf(echo) - 1);
    open(apart, lineSaying(apart, 'Stand back').id);
    const together = screen.getByRole('region', { name: 'Spoken at the same time' });
    expect(within(together).getByText(/the game plays them in turn/)).toBeTruthy();
  });
});
