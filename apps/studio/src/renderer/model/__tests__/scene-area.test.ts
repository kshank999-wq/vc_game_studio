import { describe, expect, it } from 'vitest';
import { createProject, placeNew } from '../project';
import { spineLane } from '../layout';
import { addElement } from '../scene';
import { addChildMap } from '../level/hierarchy';
import { areaPath, newSceneArea, newWorld, nextSpot, placeElement, placedFor, SCENE_PIN, sceneMapOf, scenePinOf, setSceneMap } from '../level/scene-area';

const withScene = () => {
  const p = createProject('Area test');
  const placed = placeNew(p, 'scene', spineLane(p).id, 400)!;
  return { project: placed.project, sceneId: placed.id };
};

describe('where a scene happens', () => {
  it('starts nowhere, then gets a world, an area inside it and a pin on that area', () => {
    const { project, sceneId } = withScene();
    expect(sceneMapOf(project, sceneId)).toBeUndefined();
    const world = newWorld(project, 'Aldermoor', 'medium');
    const region = addChildMap(world.project, world.mapId, 'region', 'Northern Forest');
    const area = newSceneArea(region.project, sceneId, region.id, 'level', '');
    const p = area.project;
    // Named after the scene when no name is given; part of the region, part of the world.
    expect(sceneMapOf(p, sceneId)!.name).toBe('New scene');
    expect(areaPath(p, area.mapId).map((m) => m.name)).toEqual(['Aldermoor', 'Northern Forest', 'New scene']);
    expect(sceneMapOf(p, sceneId)!.links).toContain(sceneId);
    const pin = scenePinOf(p, sceneId)!;
    // It shows up on the region, to be placed and joined to other places by paths.
    expect(pin.levelId).toBe(region.id);
    expect(pin.assetId).toBe('world.destination');
    expect(sceneMapOf(p, sceneId)!.width).toBe(300);
    expect(pin.tags).toEqual([SCENE_PIN]);
    expect(pin.links).toEqual([sceneId]);
    expect(pin.name).toBe('New scene');
  });

  it('moves its pin when it is set somewhere else, and keeps only one', () => {
    const { project, sceneId } = withScene();
    const world = newWorld(project, 'World', 'small');
    let p = setSceneMap(world.project, sceneId, world.mapId);
    const region = addChildMap(p, world.mapId, 'region', 'Coast');
    p = setSceneMap(region.project, sceneId, region.id);
    expect(sceneMapOf(p, sceneId)!.id).toBe(region.id);
    expect(p.levels!.items.filter((i) => i.tags?.includes(SCENE_PIN))).toHaveLength(1);
    // The pin is on the map the area is part of: the world, for the coast.
    expect(scenePinOf(p, sceneId)!.levelId).toBe(world.mapId);
    // Setting it again changes nothing.
    expect(setSceneMap(p, sceneId, region.id)).toBe(p);
  });

  it('puts the scene’s elements on its map, linked to both, around its pin', () => {
    const { project, sceneId } = withScene();
    const world = newWorld(project, 'World', 'small');
    let p = newSceneArea(world.project, sceneId, world.mapId, 'level', 'Cave').project;
    const mara = addElement(p, sceneId, 'character', 'Mara')!;
    p = mara.project;
    const lever = addElement(p, sceneId, 'object', 'Lever')!;
    p = lever.project;
    const first = placeElement(p, sceneId, mara.id, nextSpot(p, sceneId))!;
    p = first.project;
    const second = placeElement(p, sceneId, lever.id, nextSpot(p, sceneId))!;
    p = second.project;
    const a = p.levels!.items.find((i) => i.id === first.itemId)!;
    const b = p.levels!.items.find((i) => i.id === second.itemId)!;
    expect(a.assetId).toBe('actor.npc');
    expect(b.assetId).toBe('logic.interaction');
    expect(a.links).toEqual([mara.id, sceneId]);
    expect(a.name).toBe('Mara');
    expect([a.x, a.y]).not.toEqual([b.x, b.y]);
    expect(placedFor(p, sceneId, sceneMapOf(p, sceneId)!.id, mara.id)).toHaveLength(1);
    // No map, no place for them.
    const { project: bare, sceneId: other } = withScene();
    const ghost = addElement(bare, other, 'character', 'Nobody')!;
    expect(placeElement(ghost.project, other, ghost.id, { x: 0, y: 0 })).toBeNull();
  });
});
