import { describe, expect, it } from 'vitest';
import { placeAsset, updateItem } from '../level/level';
import { dismiss, interactWith, skipScene, startLevelPlay } from '../level/play';
import { sceneSpeech, startWorld } from '../play';
import { addLine, sceneLines, updateLine } from '../scene';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

/** The sample with someone in its level to talk to: talking plays The Vault Door. */
const setup = () => {
  let project: Project = sunkenVault();
  const levelId = project.levels!.levels[0]!.id;
  const floorId = project.levels!.levels[0]!.floors[0]!.id;
  const vault = Object.values(project.objects).find((o) => o.type === 'scene' && o.name === 'The Vault Door')!.id;
  const placed = placeAsset(project, levelId, floorId, 'actor.npc', { x: 0, y: 0 }, { name: 'Mara here' });
  project = updateItem(placed.project, placed.ids[0]!, { links: [vault] });
  // A last line on the main track, after the pair ("Not like that." is on a choice's branch).
  const mara = Object.values(project.objects).find((o) => o.name === 'Mara')!.id;
  const added = addLine(project, vault, 'dialogue', sceneLines(project, vault).at(-1)!.id, mara);
  project = updateLine(added.project, added.id, { text: 'Hold the light.' });
  return { project, levelId, vault, npc: placed.ids[0]!, last: added.id };
};

describe('a scene in the 3D Play Mode', () => {
  it('says its lines beat by beat: a dual speech is one beat, two voices', () => {
    const { project, vault } = setup();
    const beats = sceneSpeech(project, startWorld(project), vault);
    expect(beats.map((b) => b.map((v) => v.text))).toEqual([['Water’s holding it shut. There’s a lever somewhere.', 'Stand back. I’ll find it.'], ['Hold the light.']]);
    expect(beats[0]!.map((v) => v.speaker)).toEqual(['Mara', 'The Explorer']);
  });

  it('leaves out a line whose conditions don’t hold', () => {
    const { project, vault, last } = setup();
    const gated = { ...project, lines: project.lines.map((l) => (l.id === last ? { ...l, conditions: { match: 'all' as const, items: [{ kind: 'flag' as const, ref: 'never', op: 'is' as const, value: 'yes' }] } } : l)) };
    expect(sceneSpeech(gated, startWorld(gated), vault)).toHaveLength(1);
  });

  it('talking to someone steps through the lines, then carries on; or skips the scene', () => {
    const { project, levelId, npc } = setup();
    let s = interactWith(project, startLevelPlay(project, levelId), npc);
    expect(s.scene?.beat).toBe(0);
    expect(s.scene?.speech).toHaveLength(2);
    s = dismiss(s);
    expect(s.scene?.beat).toBe(1);
    s = dismiss(s);
    expect(s.scene).toBeUndefined();
    const again = interactWith(project, startLevelPlay(project, levelId), npc);
    expect(skipScene(again).scene).toBeUndefined();
  });
});
