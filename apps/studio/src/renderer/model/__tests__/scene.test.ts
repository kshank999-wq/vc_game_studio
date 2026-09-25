import { describe, expect, it } from 'vitest';
import { addLane, createProject, placeNew, removeObject } from '../project';
import { spineLane } from '../layout';
import {
  addElement,
  addLine,
  categoryCounts,
  categoryFor,
  elementsIn,
  inScene,
  nextSpeaker,
  removeFromScene,
  sceneLines,
  setSceneData,
  speakers,
  updateLine,
  useInScene,
} from '../scene';
import type { Project } from '../types';

const withScene = (): { p: Project; scene: string } => {
  const p = createProject();
  const placed = placeNew(p, 'scene', spineLane(p).id, 400)!;
  return { p: placed.project, scene: placed.id };
};

const add = (p: Project, scene: string, type: Parameters<typeof addElement>[2], name?: string) => {
  const r = addElement(p, scene, type, name);
  if (!r) throw new Error(`could not add ${type}`);
  return r;
};

describe('scene contents', () => {
  it('files each element under its category, with a code', () => {
    let { p, scene } = withScene();
    p = add(p, scene, 'object', 'Rusted Lever').project;
    p = add(p, scene, 'trigger').project;
    p = add(p, scene, 'gate').project;
    expect(elementsIn(p, scene, 'objects').map((o) => [o.name, o.data.code])).toEqual([['Rusted Lever', 'OBJ-01']]);
    expect(elementsIn(p, scene, 'logic')).toHaveLength(2);
    expect(categoryCounts(p, scene)).toMatchObject({ objects: 1, logic: 2, characters: 0 });
    expect(categoryFor('state')?.key).toBe('logic');
    expect(categoryFor('plotPoint')).toBeUndefined();
    expect(addElement(p, scene, 'plotPoint')).toBeNull();
  });

  it('shares one character between scenes rather than copying it', () => {
    let { p, scene } = withScene();
    const second = placeNew(p, 'scene', spineLane(p).id, 700)!;
    p = second.project;
    const mara = add(p, scene, 'character', 'Mara');
    p = useInScene(mara.project, second.id, mara.id);
    expect(inScene(p, scene, mara.id) && inScene(p, second.id, mara.id)).toBe(true);
    expect(Object.values(p.objects).filter((o) => o.type === 'character')).toHaveLength(1);
    // Leaving one scene keeps her in the project and in the other scene.
    p = removeFromScene(p, scene, mara.id);
    expect(p.objects[mara.id]).toBeDefined();
    expect(inScene(p, second.id, mara.id)).toBe(true);
  });

  it('deletes an element only this scene used when it is taken out', () => {
    let { p, scene } = withScene();
    const lever = add(p, scene, 'object', 'Rusted Lever');
    p = removeFromScene(lever.project, scene, lever.id);
    expect(p.objects[lever.id]).toBeUndefined();
  });

  it('keeps a lane’s character even when no scene uses it', () => {
    const lane = addLane(createProject(), 'character');
    const placed = placeNew(lane.project, 'scene', spineLane(lane.project).id, 400)!;
    const characterId = lane.project.lanes.find((l) => l.id === lane.laneId)!.characterId!;
    let p = useInScene(placed.project, placed.id, characterId);
    p = removeFromScene(p, placed.id, characterId);
    expect(p.objects[characterId]).toBeDefined();
  });

  it('sets the location as one of the scene’s environments', () => {
    let { p, scene } = withScene();
    const vault = add(p, scene, 'environment', 'Vault Chamber');
    p = setSceneData(vault.project, scene, { intExt: 'INT.', time: 'NIGHT', locationId: vault.id });
    expect(p.objects[scene]!.data).toMatchObject({ intExt: 'INT.', time: 'NIGHT', locationId: vault.id });
    p = removeFromScene(p, scene, vault.id);
    expect(p.objects[scene]!.data.locationId).toBeUndefined();
  });
});

describe('the script', () => {
  it('keeps lines in order, inserting after a given line', () => {
    let { p, scene } = withScene();
    const a = addLine(p, scene, 'action');
    const c = addLine(a.project, scene, 'action');
    const b = addLine(c.project, scene, 'dialogue', a.id);
    p = b.project;
    expect(sceneLines(p, scene).map((l) => l.id)).toEqual([a.id, b.id, c.id]);
    expect(sceneLines(p, scene).map((l) => l.order)).toEqual([1, 2, 3]);
  });

  it('brings a speaker into the scene, and alternates speakers on Enter', () => {
    let { p, scene } = withScene();
    const mara = add(p, scene, 'character', 'Mara');
    const explorer = addElement(mara.project, scene, 'character', 'The Explorer')!;
    p = explorer.project;
    const one = addLine(p, scene, 'dialogue', undefined, mara.id);
    const two = addLine(one.project, scene, 'dialogue', one.id, explorer.id);
    p = two.project;
    expect(nextSpeaker(p, scene, two.id)).toBe(mara.id);
    expect(categoryCounts(p, scene).dialogue).toBe(2);
    // Picking someone not yet in the scene brings them in.
    const other = placeNew(p, 'scene', spineLane(p).id, 900)!;
    const tomas = add(other.project, other.id, 'character', 'Tomas');
    p = updateLine(tomas.project, two.id, { speakerId: tomas.id });
    expect(inScene(p, scene, tomas.id)).toBe(true);
    expect(speakers(p, scene).map((s) => s.present)).toEqual([true, true, true]);
  });

  it('turns a dialogue line into action without leaving a speaker behind', () => {
    let { p, scene } = withScene();
    const mara = add(p, scene, 'character', 'Mara');
    const line = addLine(mara.project, scene, 'dialogue', undefined, mara.id);
    p = updateLine(line.project, line.id, { kind: 'action' });
    expect(p.lines[0]).toMatchObject({ kind: 'action', speakerId: null, vo: 'none' });
  });

  it('goes with its scene, and a deleted speaker leaves the line to reassign', () => {
    let { p, scene } = withScene();
    const mara = add(p, scene, 'character', 'Mara');
    const line = addLine(mara.project, scene, 'dialogue', undefined, mara.id);
    p = removeObject(line.project, mara.id);
    expect(p.lines[0]!.speakerId).toBeNull();
    p = removeObject(p, scene);
    expect(p.lines).toHaveLength(0);
  });
});
