import { spineSequence } from '../layout';
import { codeFormatFor, makeObject, nextCode } from '../project';
import { parentSceneOf, subScenesOf } from '../subscene';
import type { Connection, Project } from '../types';

/**
 * Rooms for the engines (as the play-through has them): a scene with rooms
 * goes on to a choice, “Where now?”, with an option into each room and one
 * to leave. A room, played through, goes back to its scene's choice; leaving
 * a room with rooms of its own goes back out one level. Leaving the scene
 * takes its routes out (each its own option, with its conditions) or carries
 * on along the spine. It is all plain choices and routes, so every runtime
 * plays it as it plays any branch. The project itself is not changed.
 */
export const withRoomsAsChoices = (project: Project): Project => {
  const withRooms = Object.values(project.objects).filter((o) => o.type === 'scene' && subScenesOf(project, o.id).length);
  if (!withRooms.length) return project;
  const objects = { ...project.objects };
  const placements = { ...project.placements };
  let connections = [...project.connections];
  const choiceOf = new Map(withRooms.map((s) => [s.id, `${s.id}.rooms`]));
  const now = new Date(0).toISOString();
  let next: Project = { ...project, objects };
  const route = (sourceId: string, targetId: string, label: string, extra: Partial<Connection> = {}): Connection => ({
    id: `${sourceId}>${targetId}`,
    sourceId,
    targetId,
    kind: 'branch',
    label,
    ...extra,
  });

  // A room stands off the graph: give it a place, so the graph has it.
  const placeNear = (id: string, nearId: string, depth: number) => {
    if (placements[id]) return;
    const near = placements[nearId];
    placements[id] = { laneId: null, x: near?.x ?? 0, y: -260 - 120 * depth };
  };
  const depthOf = (id: string): number => {
    let n = 0;
    for (let at = parentSceneOf(project, id); at && n < 16; at = parentSceneOf(project, at.id)) n++;
    return n;
  };
  const anchorOf = (id: string): string => {
    let at = id;
    for (let p = parentSceneOf(project, at); p; p = parentSceneOf(project, at)) at = p.id;
    return at;
  };

  for (const scene of withRooms) {
    const choiceId = choiceOf.get(scene.id)!;
    const format = codeFormatFor('choice');
    const code = format ? nextCode(next, format) : undefined;
    objects[choiceId] = { ...makeObject('choice', `${scene.name}: where now?`, now, { ...(code ? { code } : {}), prompt: 'Where now?', roomsOf: scene.id }), id: choiceId };
    next = { ...next, objects };
    placeNear(scene.id, anchorOf(scene.id), depthOf(scene.id));
    placeNear(choiceId, anchorOf(scene.id), depthOf(scene.id) + 0.5);

    // Leaving: out to the scene a room is in, or the scene's own routes, else on along the spine.
    const parent = parentSceneOf(project, scene.id);
    const own = connections.filter((c) => c.kind === 'branch' && c.sourceId === scene.id && project.objects[c.targetId]);
    const leave: Connection[] = [];
    if (parent) leave.push(route(choiceId, choiceOf.get(parent.id) ?? parent.id, `Leave ${scene.name}`));
    else {
      for (const c of own) {
        leave.push({ ...c, id: `${c.id}.leave`, sourceId: choiceId, label: c.label ? `Leave: ${c.label}` : `Leave for ${project.objects[c.targetId]!.name}` });
        if (!c.conditions?.items.length) break;
      }
      const onward = spineSequence(project)[spineSequence(project).indexOf(scene.id) + 1];
      const always = own.some((c) => !c.conditions?.items.length);
      if (!always && onward) leave.push(route(choiceId, onward, `Leave ${scene.name}`));
    }
    connections = [
      ...connections.filter((c) => !(c.kind === 'branch' && c.sourceId === scene.id)),
      route(scene.id, choiceId, ''),
      ...subScenesOf(project, scene.id).map((r) => route(choiceId, r.id, `Go into ${r.name}`)),
      ...leave,
    ];
  }

  // A room with no rooms of its own goes back to its scene's choice when it is played through.
  for (const o of Object.values(project.objects)) {
    const parent = parentSceneOf(project, o.id);
    if (!parent || choiceOf.has(o.id)) continue;
    placeNear(o.id, anchorOf(o.id), depthOf(o.id));
    connections = [...connections.filter((c) => !(c.kind === 'branch' && c.sourceId === o.id)), route(o.id, choiceOf.get(parent.id)!, '')];
  }
  return { ...next, objects, placements, connections };
};
