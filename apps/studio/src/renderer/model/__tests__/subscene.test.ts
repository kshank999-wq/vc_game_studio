import { describe, expect, it } from 'vitest';
import { createProject, placeNew } from '../project';
import { spineLane } from '../layout';
import { addSubScene, parentSceneOf, sceneTrail, subScenesOf } from '../subscene';
import { findIssues } from '../validate';
import { newSceneArea, newWorld, pinMapOf, sceneMapOf } from '../level/scene-area';

describe('sub-scenes', () => {
  it('belong to their scene, nest, and are not flagged for being off the story graph', () => {
    const p0 = createProject('Rooms');
    const placed = placeNew(p0, 'scene', spineLane(p0).id, 400)!;
    const room = addSubScene(placed.project, placed.id)!;
    const closet = addSubScene(room.project, room.id, 'Closet')!;
    const p = closet.project;
    expect(subScenesOf(p, placed.id).map((s) => s.name)).toEqual(['Room 1']);
    expect(parentSceneOf(p, closet.id)!.id).toBe(room.id);
    expect(sceneTrail(p, closet.id).map((s) => s.id)).toEqual([placed.id, room.id]);
    expect(p.objects[room.id]!.data.code).toBe('SC-02');
    expect(findIssues(p).filter((i) => i.message.startsWith('Not on the story graph'))).toHaveLength(0);
    // Only scenes have rooms.
    expect(addSubScene(p, spineLane(p).id)).toBeNull();
  });

  it('get a room inside the scene’s area, with their pin on the scene’s map', () => {
    const p0 = createProject('Rooms');
    const placed = placeNew(p0, 'scene', spineLane(p0).id, 400)!;
    const world = newWorld(placed.project, 'World', 'small');
    const area = newSceneArea(world.project, placed.id, world.mapId, 'level', 'Manor');
    const room = addSubScene(area.project, placed.id, 'Study')!;
    const p = newSceneArea(room.project, room.id, area.mapId, 'interior', 'Study').project;
    expect(sceneMapOf(p, room.id)!.kind).toBe('interior');
    expect(sceneMapOf(p, room.id)!.parentId).toBe(area.mapId);
    expect(pinMapOf(p, room.id)!.id).toBe(area.mapId);
  });
});
