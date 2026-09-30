/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PlayView } from '../components/play/PlayView';
import { sunkenVault } from '../model/sample';

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

describe('equipment in the play-through', () => {
  it('equips the knife from the cave mouth, uses it until it breaks', () => {
    render(<PlayView project={sunkenVault()} onNavigate={() => {}} />);
    const gear = screen.getByRole('region', { name: 'Equipment' });
    expect(within(gear).getByText('Nothing equipped.')).toBeTruthy();
    fireEvent.click(within(gear).getByRole('button', { name: 'Equip Diving Knife' }));
    expect(within(gear).getByText('Hand: Diving Knife · Damage 2')).toBeTruthy();
    for (let i = 0; i < 3; i++) fireEvent.click(within(gear).getByRole('button', { name: 'Use Diving Knife' }));
    expect([...document.querySelectorAll('.play-gear')].map((e) => e.textContent)).toEqual([
      ' Equipped Diving Knife · Hand',
      ' Used Diving Knife · 2 uses left',
      ' Used Diving Knife · 1 use left',
      ' Used Diving Knife',
      ' Diving Knife breaks',
    ]);
    expect(within(gear).getByText('No equipment carried.')).toBeTruthy();
  });
});
