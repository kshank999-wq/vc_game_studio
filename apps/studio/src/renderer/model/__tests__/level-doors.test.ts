import { describe, expect, it } from 'vitest';
import { frameOf } from '../level/geometry';
import { resizeItem, setParam } from '../level/level';
import { isOpen, startLevelPlay, tick } from '../level/play';
import { levelIssues } from '../level/validate';
import { sunkenVault } from '../sample';

const setUp = () => {
  const p = sunkenVault();
  const set = p.levels!;
  const levelId = set.levels[0]!.id;
  const door = (name: string) => set.items.find((i) => i.name === name)!;
  return { p, levelId, door };
};

describe('doors in Play Mode', () => {
  it('open as the player walks up to them, once each approach', () => {
    const { p: sample, levelId, door } = setUp();
    // The sample's Bronze Door, unlocked.
    const p = setParam(sample, door('Bronze Door').id, 'locked', false);
    const bronze = p.levels!.items.find((i) => i.name === 'Bronze Door')!;
    const f = frameOf(p.levels!, bronze);
    let s = startLevelPlay(p, levelId);
    s = tick(p, s, 0.1, { x: f.x, y: f.y + 3, z: 0 });
    expect(isOpen(p, s, bronze)).toBe(false);
    s = tick(p, s, 0.1, { x: f.x, y: f.y + 0.8, z: 0 });
    expect(isOpen(p, s, bronze)).toBe(true);
  });

  it('a locked one says what it needs instead, and stays shut', () => {
    const { p, levelId, door } = setUp();
    const bronze = door('Bronze Door');
    const f = frameOf(p.levels!, bronze);
    let s = startLevelPlay(p, levelId);
    s = tick(p, s, 0.1, { x: f.x, y: f.y + 0.8, z: 0 });
    expect(isOpen(p, s, bronze)).toBe(false);
    expect(s.message?.text).toBeTruthy();
    // Not said again every frame while standing there.
    const said = s.log.length;
    s = tick(p, { ...s, message: undefined }, 0.1, { x: f.x, y: f.y + 0.8, z: 0 });
    expect(s.message).toBeUndefined();
    expect(s.log.length).toBe(said);
  });

  it('can be left for Interact instead', () => {
    const { p, levelId, door } = setUp();
    const id = door('Bronze Door').id;
    const q = setParam(setParam(p, id, 'locked', false), id, 'autoOpen', false);
    const bronze = q.levels!.items.find((i) => i.id === id)!;
    const f = frameOf(q.levels!, bronze);
    const s = tick(q, startLevelPlay(q, levelId), 0.1, { x: f.x, y: f.y + 0.8, z: 0 });
    expect(isOpen(q, s, bronze)).toBe(false);
  });

  it('warns of a door too narrow for the player', () => {
    const { p, door } = setUp();
    const narrow = resizeItem(p, door('Chamber stair').id, { w: 0.7 });
    expect(levelIssues(narrow).some((i) => i.message.startsWith('Chamber stair is too narrow for the player'))).toBe(true);
    expect(levelIssues(p).some((i) => i.message.includes('too narrow'))).toBe(false);
  });
});
