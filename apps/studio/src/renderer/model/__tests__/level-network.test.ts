import { describe, expect, it } from 'vitest';
import { updateMap } from '../level/hierarchy';
import { levelsOf, placeAsset, updateItem } from '../level/level';
import { assetOf, frameOf } from '../level/geometry';
import { defaultReplication, networkIssues, networkLayout } from '../level/network';
import { levelIssues } from '../level/validate';
import { buildIR } from '../handoff/ir';
import { planHandoff, setTarget } from '../handoff';
import { sunkenVault } from '../sample';
import type { Project, EngineId } from '../types';

const vault = () => {
  const p = sunkenVault();
  const set = levelsOf(p);
  const level = set.levels.find((l) => l.name === 'Sunken Vault')!;
  const start = set.items.find((i) => i.levelId === level.id && assetOf(set, i).role === 'playerStart')!;
  return { p, level, start };
};

/** Another player start, `dx` metres east of the first. */
const addStart = (p: Project, levelId: string, startId: string, dx: number) => {
  const set = levelsOf(p);
  const s = set.items.find((i) => i.id === startId)!;
  const f = frameOf(set, s);
  const made = placeAsset(p, levelId, s.floorId, s.assetId, { x: f.x + dx, y: f.y });
  return { p: made.project, id: made.ids[0]! };
};

describe('multiplayer planning', () => {
  it('no plan, single player: nothing to check', () => {
    const { p, level } = vault();
    expect(networkLayout(p, level.id)).toBeNull();
    expect(networkIssues(p, level.id)).toEqual([]);
  });

  it('what the network does with things, by what they are', () => {
    const { p, level } = vault();
    const set = levelsOf(p);
    const items = set.items.filter((i) => i.levelId === level.id && !i.hidden);
    const role = (r: string) => items.find((i) => assetOf(set, i).role === r)!;
    expect(defaultReplication(set, role('door'))).toBe('shared');
    expect(defaultReplication(set, role('playerStart'))).toBe('server');
    expect(defaultReplication(set, role('room'))).toBe('local');
    // The Lantern a rule turns on is shared.
    expect(defaultReplication(set, items.find((i) => i.name === 'Lantern')!)).toBe('shared');
    // A wall a rule opens has to be shared.
    const wall = items.find((i) => assetOf(set, i).role === 'light' && defaultReplication(set, i) === 'local')!;
    const q = updateItem(p, role('playerStart').id, { rules: [{ id: 'r', on: 'enter', actions: [{ kind: 'disable', target: wall.id }] }] });
    expect(defaultReplication(levelsOf(q), levelsOf(q).items.find((i) => i.id === wall.id)!)).toBe('shared');
    // Said by hand wins.
    const r = updateItem(q, wall.id, { net: { replicate: 'local' } });
    const l = networkLayout(updateMap(r, level.id, { network: { players: 1 } }), level.id)!;
    expect(l.items.find((i) => i.id === wall.id)).toEqual({ id: wall.id, replicate: 'local', set: true });
  });

  it('warns of too few player starts, and starts on top of each other', () => {
    const { p, level, start } = vault();
    const q = updateMap(p, level.id, { network: { players: 2 } });
    expect(networkIssues(q, level.id).map((i) => i.message)).toContain('Sunken Vault has 1 player start for up to 2 players.');
    const near = addStart(q, level.id, start.id, 0.5);
    const issues = networkIssues(near.p, level.id);
    expect(issues.some((i) => i.message.includes('player start for up to'))).toBe(false);
    expect(issues.find((i) => i.id === near.id)!.message).toMatch(/is 0\.5 m from .*land inside each other/);
    const apart = addStart(q, level.id, start.id, 3);
    expect(networkIssues(apart.p, level.id)).toEqual([]);
  });

  it('teams: each needs a start for its players, and every start a team', () => {
    const { p, level, start } = vault();
    const two = addStart(updateMap(p, level.id, { network: { players: 4, teams: ['Red', 'Blue'] } }), level.id, start.id, 3);
    let msgs = networkIssues(two.p, level.id).map((i) => i.message);
    expect(msgs).toContain('Team Red has 0 player starts for up to 2 players.');
    expect(msgs.filter((m) => m.endsWith('is in no team.'))).toHaveLength(2);
    const teamed = updateItem(updateItem(two.p, start.id, { net: { team: 'Red' } }), two.id, { net: { team: 'Green' } });
    msgs = networkIssues(teamed, level.id).map((i) => i.message);
    expect(msgs).toContain('Team Red has 1 player start for up to 2 players.');
    expect(msgs.some((m) => m.includes('for team Green, which this map doesn’t have'))).toBe(true);
    const l = networkLayout(teamed, level.id)!;
    expect(l.spawns.find((s) => s.id === start.id)!.team).toBe('Red');
  });

  it('warns when a rule changes something kept local, or players can’t see what they must', () => {
    const { p, level } = vault();
    const set = levelsOf(p);
    const items = set.items.filter((i) => i.levelId === level.id && !i.hidden);
    const wall = items.find((i) => assetOf(set, i).role === 'light' && defaultReplication(set, i) === 'local')!;
    const trigger = items.find((i) => assetOf(set, i).role === 'playerStart')!;
    let q = updateMap(p, level.id, { network: { players: 1 } });
    q = updateItem(q, trigger.id, { rules: [{ id: 'r', on: 'enter', actions: [{ kind: 'disable', target: wall.id }] }] });
    expect(networkIssues(q, level.id)).toEqual([]);
    const local = updateItem(q, wall.id, { net: { replicate: 'local' } });
    expect(networkIssues(local, level.id).find((i) => i.id === wall.id)!.message).toMatch(/is Local, but .* disables it: only the player who set it off would see that\./);
    const hidden = updateItem(q, wall.id, { net: { replicate: 'server' } });
    expect(networkIssues(hidden, level.id).find((i) => i.id === wall.id)!.message).toMatch(/is Server only, so players won’t see it\./);
    expect(levelIssues(hidden).some((i) => i.levelId === level.id && i.severity === 'warning' && i.message.includes('Server only'))).toBe(true);
  });

  it('the handoff carries the plan, and every engine gets NETWORKING.md', () => {
    const { p, level, start } = vault();
    const engines: EngineId[] = ['godot', 'unity', 'unreal', 'custom'];
    for (const e of engines) expect(planHandoff(setTarget(p, { engine: e })).output!.files.some((f) => f.path.endsWith('NETWORKING.md'))).toBe(false);
    const q = updateItem(updateMap(p, level.id, { network: { players: 2, teams: ['Red'] } }), start.id, { net: { team: 'Red' } });
    const n = buildIR(q).levels.find((l) => l.guid === level.id)!.network!;
    expect(n).toMatchObject({ players: 2, teams: ['Red'], spawns: [{ guid: start.id, team: 'Red' }] });
    expect(n.shared.length).toBeGreaterThan(0);
    expect(n.server).toContain(start.id);
    const docs: Record<string, RegExp> = { godot: /MultiplayerSynchronizer/, unity: /NetworkVariable/, unreal: /bReplicates = true/, custom: /sends every change to every player/ };
    for (const e of engines) {
      const md = planHandoff(setTarget(q, { engine: e })).output!.files.find((f) => f.path.endsWith('NETWORKING.md'))!;
      expect(md.content).toContain('# Networking');
      expect(md.content).toContain('**Red**');
      expect(md.content).toMatch(docs[e]!);
    }
  });
});
