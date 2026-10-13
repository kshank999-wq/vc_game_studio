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
  moveLane,
  updateLane,
} from '../project';
import { NODE_GAP, laneRows, laneSequence, nodeSize, spineLane, spineSequence, subplotReach } from '../layout';
import { readProject } from '../storage';
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
  it('starts with the Opening, Beginning, one plot point and Ending on a locked spine, with the Level lane at the bottom', () => {
    const p = createProject();
    expect(types(p)).toEqual(['cinematic', 'begin', 'plotPoint', 'end']);
    expect(codes(p)).toEqual(['OPEN', 'begin', 'PP1', 'end']);
    expect(laneRows(p).map((r) => r.lane.kind)).toEqual(['spine', 'subplot', 'level']);
    expect(spineLane(p).locked).toBe(true);
    expect(spineLane(p).span).toBeUndefined();
  });
});

describe('placing on the spine', () => {
  it('inserts a node where it is dropped and keeps the track in order', () => {
    let p = createProject();
    p = place(p, 'choice', spineId(p), 150).project;
    expect(codes(p)).toEqual(['OPEN', 'begin', 'C1', 'PP1', 'end']);
    p = place(p, 'scene', spineId(p), 320).project;
    expect(codes(p)).toEqual(['OPEN', 'begin', 'C1', 'PP1', 'SC-01', 'end']);
    noOverlaps(p, spineId(p));
  });

  it('never puts anything before Beginning or the Opening', () => {
    let p = createProject();
    p = place(p, 'plotPoint', spineId(p), -500).project;
    expect(codes(p)[0]).toBe('OPEN');
    expect(types(p)[1]).toBe('begin');
    expect(codes(p)[2]).toBe('PP2');
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
    const first = place(p, 'scene', spineId(p), 300);
    p = place(first.project, 'scene', spineId(p), 400).project;
    p = removeObject(p, first.id);
    p = place(p, 'scene', spineId(p), 450).project;
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
    expect(codes(p)).toEqual(['OPEN', 'begin', 'SC-01', 'PP1', 'end']);
    noOverlaps(p, spineId(p));
  });

  it('leaves Beginning, the Opening and Ending where they are', () => {
    const p = createProject();
    const [openingId, beginId, , endId] = spineSequence(p);
    expect(moveNode(p, beginId!, 900)).toBe(p);
    expect(moveNode(p, openingId!, 900)).toBe(p);
    expect(moveNode(p, endId!, -900)).toBe(p);
    expect(removeObject(p, endId!)).toBe(p);
    expect(removeObject(p, openingId!)).toBe(p);
  });
});

describe('the Player Lane', () => {
  it('is there from the start, a lane of its own beneath the spine', () => {
    const p = createProject();
    const lane = p.lanes.find((l) => l.role === 'player')!;
    expect(lane.name).toBe('Player Lane');
    expect(lane.span).toBeUndefined();
    expect(laneRows(p).map((r) => r.lane.name)).toEqual(['Spine', 'Player Lane', 'Levels']);
  });
});

describe('subplot lanes', () => {
  it('are added as lanes of their own, above the Level lane at the bottom, one under another', () => {
    const first = addLane(createProject(), 'subplot');
    const second = addLane(first.project, 'subplot');
    const p = second.project;
    expect(p.lanes.find((l) => l.id === first.laneId)!.span).toBeUndefined();
    expect(laneRows(p).map((r) => r.lane.name)).toEqual(['Spine', 'Player Lane', 'Subplot 1', 'Subplot 2', 'Levels']);
    expect(laneRows(p)[3]!.top).toBeGreaterThan(laneRows(p)[2]!.top);
  });

  it('take beats anywhere along the story, without moving the spine', () => {
    const added = addLane(createProject(), 'subplot');
    const before = added.project.placements;
    let p = added.project;
    for (const x of [3000, 200, 1200]) p = place(p, 'scene', added.laneId, x).project;
    const xs = laneSequence(p, added.laneId).map((id) => p.placements[id]!.x);
    expect(xs[0]).toBe(200);
    expect(xs[2]).toBe(3000);
    for (const id of spineSequence(p)) expect(p.placements[id]).toEqual(before[id]);
    noOverlaps(p, added.laneId);
  });

  it('run alongside the stretch of spine their beats are under', () => {
    let p = createProject();
    p = place(p, 'scene', spineId(p), 600).project;
    const added = addLane(p, 'subplot');
    p = added.project;
    const lane = () => p.lanes.find((l) => l.id === added.laneId)!;
    expect(subplotReach(p, lane())).toBeNull();
    const [, begin, pp1, scene, end] = spineSequence(p);
    p = place(p, 'scene', added.laneId, p.placements[pp1!]!.x + 40).project;
    expect(subplotReach(p, lane())).toEqual({ startRef: pp1, endRef: scene });
    p = place(p, 'scene', added.laneId, p.placements[end!]!.x + 400).project;
    expect(subplotReach(p, lane())!.endRef).toBe(end);
    expect(begin).toBeDefined();
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
    expect(laneRows(p).map((r) => r.lane.name)).toEqual(['Spine', 'Player Lane', 'Levels']);
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
    expect(laneRows(hidden).map((r) => r.lane.name)).toEqual(['Spine', 'Player Lane', 'Levels']);
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

// ---------------------------------------------------------------- step 4

import { connect, connectionRefusal, relabelConnection, setOutcome, setPolarity, settle } from '../project';
import { findIssues } from '../validate';

const node = (p: Project, type: string, n = 0) => Object.values(p.objects).filter((o) => o.type === type)[n]!;

describe('arranging lanes', () => {
  it('moves any lane above or below the others, the spine included, and keeps the order', () => {
    const added = addLane(createProject(), 'subplot');
    let p = added.project;
    const names = () => laneRows(p).map((r) => r.lane.name);
    const level = p.lanes.find((l) => l.kind === 'level')!.id;
    p = moveLane(p, level, 0);
    expect(names()).toEqual(['Levels', 'Spine', 'Player Lane', 'Subplot 1']);
    p = moveLane(p, added.laneId, 1);
    expect(names()).toEqual(['Levels', 'Subplot 1', 'Spine', 'Player Lane']);
    p = moveLane(p, spineId(p), 3);
    expect(names()).toEqual(['Levels', 'Subplot 1', 'Player Lane', 'Spine']);
    expect(moveLane(p, spineId(p), 3)).toBe(p);
    expect(moveLane(p, spineId(p), 99)).toBe(p);
    // A new lane still goes in above the Level lane only when that is at the bottom.
    p = addLane(p, 'character').project;
    expect(names().at(-1)).toBe('Character 1');
  });

  it('turns an older project’s lanes into free lanes: the spine first, the Level lane at the bottom, subplots untied', () => {
    const fresh = addLane(createProject(), 'subplot');
    const seq = spineSequence(fresh.project);
    const old: Project = {
      ...fresh.project,
      lanes: fresh.project.lanes.map((l) =>
        l.kind === 'level' ? { ...l, order: -1 } : l.kind === 'subplot' ? { ...l, span: { startRef: seq[1]!, endRef: seq.at(-1)! } } : l,
      ),
    };
    const p = readProject(JSON.parse(JSON.stringify(old)))!;
    expect(laneRows(p).map((r) => r.lane.name)).toEqual(['Spine', 'Player Lane', 'Subplot 1', 'Levels']);
    expect(p.lanes.every((l) => !l.span)).toBe(true);
    // Done once: a Level lane dragged to the top stays there.
    const moved = moveLane(p, p.lanes.find((l) => l.kind === 'level')!.id, 0);
    expect(laneRows(readProject(JSON.parse(JSON.stringify(moved)))!)[0]!.lane.kind).toBe('level');
  });
});

describe('branches', () => {
  it('float above the spine and never sit on it', () => {
    const p = createProject();
    const { project, id } = place(p, 'scene', null as unknown as string, 200);
    expect(project.placements[id]!.laneId).toBeNull();
    expect(project.placements[id]!.y + nodeSize('scene').h).toBeLessThan(0);
    const moved = moveNode(project, id, 260, 500);
    expect(moved.placements[id]!.y + nodeSize('scene').h).toBeLessThan(0);
    expect(moved.placements[id]!.x).toBe(260);
  });

  it('connect from a choice with a numbered option label that can be renamed', () => {
    let p = createProject();
    p = place(p, 'choice', spineId(p), 120).project;
    const branch = placeNew(p, 'scene', null, 200, -200)!;
    p = branch.project;
    const choice = node(p, 'choice');
    const made = connect(p, choice.id, branch.id);
    if ('error' in made) throw new Error(made.error);
    const c = made.project.connections[0]!;
    expect(c).toMatchObject({ kind: 'branch', label: 'Option 1', sourceId: choice.id });
    p = relabelConnection(made.project, c.id, 'Crawl through');
    expect(p.connections[0]!.label).toBe('Crawl through');
    expect(connect(p, choice.id, branch.id)).toEqual({ error: 'These are already connected' });
  });

  it('refuse connections that the tracks already express', () => {
    let p = createProject();
    const [opening, begin, pp1, end] = spineSequence(p);
    expect(connectionRefusal(p, pp1!, end!)).toMatch(/track order/);
    expect(connectionRefusal(p, pp1!, begin!)).toMatch(/Beginning/);
    expect(connectionRefusal(p, pp1!, opening!)).toMatch(/Opening/);
    expect(connectionRefusal(p, pp1!, pp1!)).toMatch(/itself/);
    p = place(p, 'choice', spineId(p), 120).project;
    expect(connectionRefusal(p, node(p, 'choice').id, end!)).toBeNull();
  });

  it('flag dead ends until they lead on or are marked as an ending', () => {
    let p = createProject();
    p = place(p, 'choice', spineId(p), 120).project;
    const choice = node(p, 'choice');
    expect(findIssues(p).map((i) => i.id)).toEqual([choice.id]);
    const branch = placeNew(p, 'scene', null, 200, -200)!;
    const made = connect(branch.project, choice.id, branch.id);
    if ('error' in made) throw new Error(made.error);
    p = made.project;
    expect(findIssues(p)).toEqual([{ id: branch.id, message: expect.stringMatching(/Dead end/) }]);
    p = setOutcome(p, branch.id, 'gameOver');
    // It no longer dead-ends, but nothing is written in it yet.
    expect(findIssues(p)).toEqual([{ id: branch.id, message: expect.stringMatching(/Nothing written yet/) }]);
    p = { ...p, objects: { ...p.objects, [branch.id]: { ...p.objects[branch.id]!, data: { ...p.objects[branch.id]!.data, summary: 'The rock shifts.' } } } };
    expect(findIssues(p)).toEqual([]);
  });
});

describe('arc events', () => {
  it('land on a character lane tied to the spine moment above them', () => {
    let p = createProject();
    const added = addLane(p, 'character');
    p = added.project;
    const pp1 = spineSequence(p)[2]!;
    const { project, id } = place(p, 'arcEvent', added.laneId, p.placements[pp1]!.x);
    expect(project.connections).toEqual([expect.objectContaining({ sourceId: id, targetId: pp1, kind: 'arcEvent' })]);
    expect(canPlace(project, 'arcEvent', spineId(project))).toBe(false);
    const setback = setPolarity(project, id, 'down');
    expect(setback.objects[id]).toMatchObject({ name: 'Setback', data: { polarity: 'down' } });
  });
});
