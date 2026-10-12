import { describe, expect, it } from 'vitest';
import { addCredit, creditsOf, updateCredit } from '../credits';
import { buildIR } from '../handoff/ir';
import { spineLane, spineSequence } from '../layout';
import { levelsOf } from '../level/level';
import { addLevelBand, inLevel, levelBands, levelOf, removeBand, renameBand, setBandEdge } from '../level-lane';
import { advance, startPlay } from '../play';
import { createProject, isOpening, placeNew, plotStops, removeObject, withStoryFrame } from '../project';
import { addLine, updateLine } from '../scene';
import { readProject } from '../storage';
import type { Project } from '../types';

const named = (p: Project, name: string) => Object.values(p.objects).find((o) => o.name === name)!.id;

describe('the Opening', () => {
  it('comes right after Beginning with placeholder credits, and plays first, credits and all', () => {
    const p = createProject();
    const [, opening] = spineSequence(p);
    expect(isOpening(p.objects[opening!])).toBe(true);
    expect(creditsOf(p.objects[opening!]).map((c) => c.role)).toContain('Directed by');
    const play = startPlay(p);
    const entry = play.log.find((e) => e.kind === 'cinematic');
    expect(entry).toMatchObject({ kind: 'cinematic', text: 'OPEN Opening' });
    expect(entry && 'credits' in entry && entry.credits).toContain('Directed by — [name]');
  });

  it('hands its credits to the engines, in order, filled in or as placeholders', () => {
    let p = createProject();
    const opening = spineSequence(p)[1]!;
    const directed = creditsOf(p.objects[opening]).find((c) => c.role === 'Directed by')!;
    p = updateCredit(p, opening, directed.id, { name: 'Ken' });
    p = addCredit(p, opening, 'Thanks to', '');
    const c = buildIR(p).cinematics.find((x) => x.id === opening)!;
    expect(c.fields.opening).toBe('yes');
    expect(c.fields.credits!.split('\n')).toContain('Directed by — Ken');
    expect(c.fields.credits!.split('\n').at(-1)).toBe('Thanks to — [name]');
  });

  it('is given to a project from before it, with the Level lane, and nothing else moves out of order', () => {
    const fresh = createProject();
    // A project as saved before: no Opening, no Level lane.
    const old: Project = {
      ...fresh,
      objects: Object.fromEntries(Object.entries(fresh.objects).filter(([, o]) => !isOpening(o))),
      placements: Object.fromEntries(Object.entries(fresh.placements).filter(([id]) => !isOpening(fresh.objects[id]))),
      lanes: fresh.lanes.filter((l) => l.kind !== 'level'),
    };
    const read = readProject(JSON.parse(JSON.stringify(old)))!;
    const types = spineSequence(read).map((id) => read.objects[id]!.type);
    expect(types).toEqual(['begin', 'cinematic', 'plotPoint', 'end']);
    expect(read.lanes.some((l) => l.kind === 'level')).toBe(true);
    // Twice is the same as once.
    expect(withStoryFrame(read)).toBe(read);
  });
});

describe('the Level lane', () => {
  const twoPoints = () => {
    const p = createProject();
    return placeNew(p, 'plotPoint', spineLane(p).id, 800)!.project;
  };

  it('adds levels one after another between plot points, each with its map', () => {
    let p = twoPoints();
    const stops = plotStops(p);
    const first = addLevelBand(p, 'The Cave')!;
    p = first.project;
    expect(levelBands(p)[0]).toMatchObject({ name: 'The Cave', startRef: stops[0], endRef: stops[1] });
    expect(levelsOf(p).levels.find((l) => l.id === first.mapId)?.name).toBe('The Cave');
    const second = addLevelBand(p)!;
    p = second.project;
    expect(levelBands(p)[1]).toMatchObject({ startRef: stops[1], endRef: stops[2] });
    p = addLevelBand(p)!.project;
    // Every stretch of the spine has its level now.
    expect(addLevelBand(p, 'More')).toBeNull();
  });

  it('stretches between plot points, never over another level', () => {
    let p = twoPoints();
    const stops = plotStops(p);
    const made = addLevelBand(p)!;
    p = setBandEdge(made.project, made.id, 'end', stops[2]!);
    expect(levelBands(p)[0]!.endRef).toBe(stops[2]);
    // Not inside out.
    expect(setBandEdge(p, made.id, 'start', stops[3]!)).toBe(p);
    p = setBandEdge(p, made.id, 'end', stops[1]!);
    const other = addLevelBand(p)!;
    p = other.project;
    expect(setBandEdge(p, made.id, 'end', stops[2]!)).toBe(p);
  });

  it('knows which level each scene on the spine happens in, by where it sits', () => {
    let p = twoPoints();
    const made = addLevelBand(p, 'The Cave')!;
    p = made.project;
    const pp1 = plotStops(p)[1]!;
    const scene = placeNew(p, 'scene', spineLane(p).id, p.placements[pp1]!.x - 10)!;
    p = scene.project;
    expect(levelOf(p, scene.id)?.name).toBe('The Cave');
    expect(inLevel(p, made.id)).toContain(scene.id);
    const cinematic = placeNew(p, 'cinematic', spineLane(p).id, p.placements[plotStops(p)[1]!]!.x - 10)!;
    p = cinematic.project;
    expect(buildIR(p).cinematics.find((c) => c.id === cinematic.id)?.fields.level).toBe('The Cave');
  });

  it('follows a deleted plot point to the next one, and renames its map with it', () => {
    let p = twoPoints();
    const made = addLevelBand(p)!;
    p = renameBand(made.project, made.id, 'Harbour');
    expect(levelsOf(p).levels.find((l) => l.id === made.mapId)?.name).toBe('Harbour');
    const pp1 = plotStops(p)[1]!;
    p = removeObject(p, pp1);
    expect(levelBands(p)[0]!.endRef).toBe(plotStops(p)[1]);
    // Off the lane, its map stays.
    p = removeBand(p, made.id);
    expect(levelBands(p)).toHaveLength(0);
    expect(levelsOf(p).levels.some((l) => l.id === made.mapId)).toBe(true);
  });
});

describe('plot points written like scenes', () => {
  it('play their script in the play-through, then go on along the spine', () => {
    let p = createProject();
    const pp1 = named(p, 'Plot Point 1');
    const line = addLine(p, pp1, 'dialogue');
    p = updateLine(line.project, line.id, { text: 'The flood door groans shut behind you.' });
    let play = startPlay(p);
    for (let i = 0; i < 6 && play.cursor.at !== 'end'; i++) play = advance(p, play);
    const texts = play.log.map((e) => ('text' in e ? e.text : ''));
    expect(texts).toContain('PP1 Plot Point 1');
    expect(texts.some((t) => t.includes('The flood door groans shut'))).toBe(true);
    expect(play.cursor).toMatchObject({ at: 'end', outcome: 'ending' });
  });
});
