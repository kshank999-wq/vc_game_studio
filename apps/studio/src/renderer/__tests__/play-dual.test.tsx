/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PlayView } from '../components/play/PlayView';
import { sunkenVault } from '../model/sample';

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

describe('the game preview', () => {
  it('plays dual dialogue at once: two voices side by side, one Continue', () => {
    const p = sunkenVault();
    const vault = Object.values(p.objects).find((o) => o.type === 'scene' && o.name === 'The Vault Door')!.id;
    render(<PlayView project={p} from={vault} onNavigate={() => {}} />);
    for (let i = 0; i < 6 && !screen.queryByRole('group', { name: 'Spoken at the same time' }); i++) fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    const pair = screen.getByRole('group', { name: 'Spoken at the same time' });
    const voices = [...pair.querySelectorAll('.play-line')].map((v) => [v.querySelector('.play-speaker')!.textContent, v.querySelector('.play-said')!.textContent]);
    expect(voices).toEqual([
      ['MARA', 'Water’s holding it shut. There’s a lever somewhere.'],
      ['THE EXPLORER', 'Stand back. I’ll find it.'],
    ]);
    expect(within(pair).getByText('(wading forward)')).toBeTruthy();
    // Nobody says his line a second time.
    expect(screen.getAllByText('Stand back. I’ll find it.')).toHaveLength(1);
  });
});
