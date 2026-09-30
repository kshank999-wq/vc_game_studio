/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlayInspect } from '../components/level/PlayInspect';
import { setWorldByHand, startLevelPlay, type LevelPlayState } from '../model/level/play';
import { sunkenVault } from '../model/sample';

afterEach(cleanup);

describe('the gear screen in Play Mode', () => {
  it('opens on Gear (I), equips, uses, learns and crafts, and the state follows', () => {
    const project = sunkenVault();
    const levelId = project.levels!.levels[0]!.id;
    const id = (name: string) => Object.values(project.objects).find((o) => o.name === name)!.id;
    let start = startLevelPlay(project, levelId);
    start = setWorldByHand(project, start, { ...start.world, items: { ...start.world.items, [id('Diving Knife')]: 1, [id('Flare Pistol')]: 1, [id('Salvage')]: 1 } }, 'give the gear');
    let last: LevelPlayState = start;
    const Harness = () => {
      const [state, setState] = useState(start);
      return (
        <PlayInspect
          project={project}
          levelId={levelId}
          state={state}
          tab="gear"
          at={{ x: 0, y: 0, z: 0 }}
          onState={(s) => {
            last = s;
            setState(s);
          }}
          onCommit={() => {}}
          onResume={() => {}}
          onRestart={() => {}}
          onExit={() => {}}
        />
      );
    };
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'Gear' }).getAttribute('aria-selected')).toBe('true');
    const gear = screen.getByRole('region', { name: 'Equipment' });
    fireEvent.click(within(gear).getByRole('button', { name: 'Equip Diving Knife' }));
    expect(last.world.equipped).toEqual({ Hand: id('Diving Knife') });
    expect(last.message?.text).toBe('Equipped Diving Knife');
    fireEvent.click(within(screen.getByRole('region', { name: 'Equipment' })).getByRole('button', { name: 'Use Diving Knife' }));
    expect(last.log.at(-1)?.text).toBe('Used Diving Knife · 2 uses left');
    fireEvent.click(within(screen.getByRole('region', { name: 'Skills' })).getByRole('button', { name: 'Learn Deep Breath' }));
    expect(last.world.skills[id('Deep Breath')]).toBe(1);
    fireEvent.click(within(screen.getByRole('region', { name: 'Crafting' })).getByRole('button', { name: 'Craft Flare' }));
    expect(last.world.items[id('Flare')]).toBe(2);
    expect(last.message?.text).toBe('Crafted 2 × Flare');
  });
});
