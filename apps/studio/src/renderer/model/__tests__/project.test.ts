import { describe, expect, it } from 'vitest';
import {
  addLane,
  canPlace,
  createProject,
  moveNode,
  placeNew,
  removeLane,
  removeObject,
  renameObject,
  setSpanEdge,
  spanDependents,
  updateLane,
} from '../project';
import { NODE_GAP, laneRows, laneSequence, nodeSize, spanRange, spineLane, spineSequence } from '../layout';
import { commit, redo, startHistory, undo } from '../history';
import type { Project } from '../types';

const types = (p: Project): string[] => spineSequence(p).map((id) => p.objects[id]!.type);
const codes = (p: Project): string[] => spineSequence(p).map((id) => p.objects[id]!.data.code ?? p.objects[id]!.type);
const spineId = (p: Project): string => spineLane(p).id;

const place = (p: Project, type: Parameters<typeof placeNew>[1], laneId: string, x: number) => {
  const result = placeNew(p, type, laneId, x);
  if (!result) throw new Error(`could not place ${type}`);
  return result;
};

const noOverlaps = (p: Project, laneId: string): void => {
  const lane = p.lanes.find((l) => l.id === laneId)!;
  const ids = laneSequence(p, laneId);
  for (let i = 1; i < ids.length; i++) {
    const prev = p.placements[ids[i - 1]!]!;
    const w = nodeSize(p.objects[ids[i - 1]!]!.type, lane.kind).w;
    expect(p.placements[ids[i]!]!.x).toBeGreaterThanOrEqual(prev.x + w + NODE_GAP);
  }
};

describe('a new project', () => {
  it('starts with Beginning, one plot point and Ending on a locked spine', () => {
    const p = createProject();
    expect(types(p)).toEqual(['begin', 'plotPoint', 'end']);
    expect(codes(p)).toEqual(['begin', 'PP1', 'end']);
    expect(spineLane(p).locked).toBe(true);
    expect(spineLane(p).span).toBeUndefined();
  });
});

describe('placing on the spine', () => {
  it('inserts a node where it is dropped and keeps the track in order', () => {
    let p = createProject();
    p = place(p, 'choice', spineId(p), 150).project;
    expect(codes(p)).toEqual(['begin', 'C1', 'PP1', 'end']);
    p = place(p, 'scene', spineId(p), 320).project;
    expect(codes(p)).toEqual(['begin', 'C1', 'PP1', 'SC-01', 'end']);
    noOverlaps(p, spineId(p));
  });

  it('never puts anything before Beginning', () => {
    let p = createProject();
    p = place(p, 'plotPoint', spineId(p), -500).project;
    expect(types(p)[0]).toBe('begin');
    expect(codes(p)[1]).toBe('PP2');
  });

  it('pushes Ending along when a node is dropped past it: the track never ends', () => {
    let p = createProject();
    const endBefore = p.placements[spineSequence(p).at(-1)!]!.x;
    p = place(p, 'cinematic', spineId(p), endBefore + 400).project;
    expect(types(p).at(-1)).toBe('end');
    expect(p.placements[spineSequence(p).at(-1)!]!.x).toBeGreaterThan(endBefore + 400);
    noOverlaps(p, spineId(p));
  });

  it('numbers codes from the highest one in use, so a code is never reused', () => {
    let p = createProject();
    const first = place(p, 'scene', spineId(p), 100);
    p = place(first.project, 'scene', spineId(p), 200).project;
    p = removeObject(p, first.id);
    p = place(p, 'scene', spineId(p), 250).project;
    expect(codes(p).filter((c) => c.startsWith('SC-'))).toEqual(['SC-02', 'SC-03']);
  });

  it('refuses scene elements, which belong inside a scene', () => {
    const p = createProject();
    expect(canPlace(p, 'character', spineId(p))).toBe(false);
    expect(placeNew(p, 'dialogue', spineId(p), 100)).toBeNull();
  });
});

describe('moving along the spine', () => {
  it('reorders by position and pushes neighbours clear', () => {
    let p = createProject();
    const { project, id } = place(p, 'scene', spineId(p), 500);
    p = moveNode(project, id, 120);
    expect(codes(p)).toEqual(['begin', 'SC-01', 'PP1', 'end']);
    noOverlaps(p, spineId(p));
  });

  it('leaves Beginning and Ending where they are', () => {
    const p = createProject();
    const [beginId, , endId] = spineSequence(p);
    expect(moveNode(p, beginId!, 900)).toBe(p);
    expect(moveNode(p, endId!, -900)).toBe(p);
    expect(removeObject(p, endId!)).toBe(p);
  });
});

describe('subplot lanes', () => {
  it('are added below the spine with a span from the first node after Beginning to Ending', () => {
    const { project: p, laneId } = addLane(createProject(), 'subplot');
    const lane = p.lanes.find((l) => l.id === laneId)!;
    const seq = spineSequence(p);
    expect(lane.span).toEqual({ startRef: seq[1], endRef: seq[2] });
    expect(laneRows(p).map((r) => r.lane.kind)).toEqual(['spine', 'subplot']);
    expect(laneRows(p)[1]!.top).toBeGreaterThan(laneRows(p)[0]!.top);
  });

  it('span handles snap to spine nodes and the start stays before the end', () => {
    let p = createProject();
    p = place(p, 'scene', spineId(p), 500).project;
    const added = addLane(p, 'subplot');
    p = added.project;
    const [begin, pp1, , end] = spineSequence(p);
    p = setSpanEdge(p, added.laneId, 'start', begin!);
    expect(p.lanes.find((l) => l.id === added.laneId)!.span!.startRef).toBe(begin);
    expect(setSpanEdge(p, added.laneId, 'end', begin!)).toBe(p);
    expect(setSpanEdge(p, added.laneId, 'start', end!)).toBe(p);
    const range = spanRange(p, p.lanes.find((l) => l.id === added.laneId)!)!;
    expect(range.from).toBeLessThan(range.to);
    expect(pp1).toBeDefined();
  });

  it('keeps a span whole when the node it starts on is deleted', () => {
    let p = createProject();
    const { project, id } = place(p, 'scene', spineId(p), 120);
    const added = addLane(project, 'subplot');
    p = setSpanEdge(added.project, added.laneId, 'start', id);
    expect(spanDependents(p, id).map((l) => l.id)).toEqual([added.laneId]);
    p = removeObject(p, id);
    const span = p.lanes.find((l) => l.id === added.laneId)!.span!;
    expect(p.objects[span.startRef]).toBeDefined();
    expect(spanRange(p, p.lanes.find((l) => l.id === added.laneId)!)).not.toBeNull();
  });

  it('take plot points, choices and scenes, coded as subplot beats', () => {
    const added = addLane(createProject(), 'subplot');
    const { project } = place(added.project, 'plotPoint', added.laneId, 400);
    const ids = laneSequence(project, added.laneId);
    expect(ids.map((id) => project.objects[id]!.data.code)).toEqual(['SP1']);
    expect(canPlace(project, 'cinematic', added.laneId)).toBe(false);
  });

  it('refuse edits while locked', () => {
    const added = addLane(createProject(), 'subplot');
    const locked = updateLane(added.project, added.laneId, { locked: true });
    expect(placeNew(locked, 'scene', added.laneId, 400)).toBeNull();
  });

  it('take their nodes with them when removed', () => {
    const added = addLane(createProject(), 'subplot');
    const { project } = place(added.project, 'scene', added.laneId, 400);
    const p = removeLane(project, added.laneId);
    expect(p.lanes).toHaveLength(1);
    expect(Object.values(p.objects).filter((o) => o.type === 'scene')).toHaveLength(0);
  });
});

describe('character lanes', () => {
  it('follow a canonical character with its own colour', () => {
    const first = addLane(createProject(), 'character');
    const second = addLane(first.project, 'character');
    const lanes = second.project.lanes.filter((l) => l.kind === 'character');
    expect(lanes.map((l) => l.color)).toEqual(['#D9607A', '#E8E0C8']);
    const character = second.project.objects[lanes[0]!.characterId!]!;
    expect(character.type).toBe('character');
  });

  it('rename their character, and renaming the character renames the lane', () => {
    const { project, laneId } = addLane(createProject(), 'character');
    let p = updateLane(project, laneId, { name: 'Mara' });
    const lane = p.lanes.find((l) => l.id === laneId)!;
    expect(p.objects[lane.characterId!]!.name).toBe('Mara');
    p = renameObject(p, lane.characterId!, 'Mara Vell');
    expect(p.lanes.find((l) => l.id === laneId)!.name).toBe('Mara Vell');
  });

  it('keep their character when the lane goes', () => {
    const { project, laneId } = addLane(createProject(), 'character');
    const characterId = project.lanes.find((l) => l.id === laneId)!.characterId!;
    expect(removeLane(project, laneId).objects[characterId]).toBeDefined();
  });

  it('drop out of the layout while hidden', () => {
    const { project, laneId } = addLane(createProject(), 'character');
    const hidden = updateLane(project, laneId, { visible: false });
    expect(laneRows(hidden).map((r) => r.lane.kind)).toEqual(['spine']);
    expect(updateLane(hidden, spineId(hidden), { visible: false })).toBe(hidden);
  });
});

describe('undo', () => {
  it('steps back and forward through interactions', () => {
    const p0 = createProject();
    let h = startHistory(p0);
    const p1 = place(p0, 'choice', spineId(p0), 150).project;
    h = commit(h, p1);
    h = commit(h, p1);
    expect(h.past).toHaveLength(1);
    h = undo(h);
    expect(h.present).toBe(p0);
    h = redo(h);
    expect(h.present).toBe(p1);
  });
});
