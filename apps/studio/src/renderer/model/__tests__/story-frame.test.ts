import { describe, expect, it } from 'vitest';
import { addCredit, creditsOf, updateCredit } from '../credits';
import { buildIR } from '../handoff/ir';
import { columnEndings, spineLane, spineSequence } from '../layout';
import { levelsOf } from '../level/level';
import { addLevelBand, addTransition, inLevel, levelBands, levelOf, removeBand, renameBand, setBandEdge, transitionOf } from '../level-lane';
import { advance, promptOf, startPlay } from '../play';
import { addEnding, connect, createProject, makeObject, endingToSpine, isOpening, setConnectionRules, placeNew, plotStops, removeObject, withStoryFrame } from '../project';
import { addLine, updateLine } from '../scene';
import { readProject } from '../storage';
import { levelEnds } from '../level-of';
import { findIssues } from '../validate';
import type { Project } from '../types';

const named = (p: Project, name: string) => Object.values(p.objects).find((o) => o.name === name)!.id;

describe('the Opening', () => {
  it('is the first box, before Beginning, with placeholder credits, and plays first, credits and all', () => {
    const p = createProject();
    const [opening] = spineSequence(p);
    expect(isOpening(p.objects[opening!])).toBe(true);
    expect(creditsOf(p.objects[opening!]).map((c) => c.role)).toContain('Directed by');
    const play = startPlay(p);
    const entry = play.log.find((e) => e.kind === 'cinematic');
    expect(entry).toMatchObject({ kind: 'cinematic', text: 'OPEN Opening' });
    expect(entry && 'credits' in entry && entry.credits).toContain('Directed by — [name]');
  });

  it('hands its credits to the engines, in order, filled in or as placeholders', () => {
    let p = createProject();
    const opening = spineSequence(p)[0]!;
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
    expect(types).toEqual(['cinematic', 'begin', 'plotPoint']);
    expect(read.lanes.some((l) => l.kind === 'level')).toBe(true);
    // Twice is the same as once.
    expect(withStoryFrame(read)).toBe(read);
  });

  it('moves to the front when an earlier version put it after Beginning, and the story starts there', () => {
    const fresh = createProject();
    const [opening, begin] = spineSequence(fresh);
    const after: Project = { ...fresh, placements: { ...fresh.placements, [opening!]: { ...fresh.placements[opening!]!, x: fresh.placements[begin!]!.x + 130 } } };
    expect(spineSequence(after)[0]).toBe(begin);
    const read = readProject(JSON.parse(JSON.stringify(after)))!;
    expect(spineSequence(read).slice(0, 2)).toEqual([opening, begin]);
    expect(buildIR(read).graph.find((n) => n.start)?.kind).toBe('cinematic');
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
    // Every stretch has its level now: the spine is open, so the next level makes a plot point at its end to run to.
    p = addLevelBand(p, 'More')!.project;
    const more = plotStops(p);
    expect(more).toHaveLength(4);
    expect(levelBands(p)[2]).toMatchObject({ name: 'More', startRef: stops[2], endRef: more[3] });
    // Once the spine closes on an ending, a new level still goes on the end of the last: a plot
    // point before the Ending, where the last level now ends and the new one runs on to the Ending.
    p = endingToSpine(p, columnEndings(p)[0]!);
    p = addLevelBand(p, 'Fourth')!.project;
    const closing = spineSequence(p).at(-1)!;
    expect(p.objects[closing]!.type).toBe('end');
    p = addLevelBand(p, 'Fifth')!.project;
    const [fourth, fifth] = levelBands(p).slice(3);
    expect(fourth!.endRef).toBe(fifth!.startRef);
    expect(p.objects[fifth!.startRef]!.type).toBe('plotPoint');
    expect(fifth!.endRef).toBe(closing);
    expect(spineSequence(p).at(-1)).toBe(closing);
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
    p = endingToSpine(p, columnEndings(p)[0]!);
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

describe('the endings', () => {
  it('wait in their column until a plot point leads to one, by its conditions', () => {
    let p = createProject();
    // The spine is open: with no ending tied in, the play-through says so.
    let play = startPlay(p);
    for (let i = 0; i < 8 && play.cursor.at !== 'end'; i++) play = advance(p, play);
    expect(play.cursor).toMatchObject({ at: 'end', outcome: 'deadEnd' });
    expect(play.cursor.at === 'end' && play.cursor.text).toContain('no ending is tied in yet');
    const [one] = columnEndings(p);
    const two = addEnding(p);
    p = two.project;
    const pp1 = named(p, 'Plot Point 1');
    const key = makeObject('inventory', 'Key', '2026-01-01T00:00:00.000Z');
    const keyId = key.id;
    p = { ...p, objects: { ...p.objects, [key.id]: key } };
    // Ending 2 when the player has the key; else Ending 1.
    const toTwo = connect(p, pp1, two.id) as { project: Project; id: string };
    p = setConnectionRules(toTwo.project, toTwo.id, { conditions: { match: 'all', items: [{ kind: 'item', ref: keyId, op: 'has' }] } });
    p = (connect(p, pp1, one!) as { project: Project }).project;
    expect(findIssues(p).filter((i) => i.id === one || i.id === two.id)).toEqual([]);
    play = startPlay(p);
    for (let i = 0; i < 8 && play.cursor.at !== 'end'; i++) play = advance(p, play);
    expect(play.cursor).toMatchObject({ at: 'end', outcome: 'ending', text: 'Ending 1' });
    p = setConnectionRules(p, toTwo.id, { conditions: { match: 'all', items: [{ kind: 'item', ref: keyId, op: 'hasNot' }] } });
    play = startPlay(p);
    for (let i = 0; i < 8 && play.cursor.at !== 'end'; i++) play = advance(p, play);
    expect(play.cursor).toMatchObject({ at: 'end', outcome: 'ending', text: 'Ending 2' });
    // The engines get both routes, in order, with the condition on the first.
    const node = buildIR(p).graph.find((n) => n.name === 'Plot Point 1')!;
    expect(node.routes.map((r) => r.to)).toEqual(['ending_2', 'ending_1']);
  });
});

describe('level ends', () => {
  it('mark the spine where each level ends, and the play-through crosses into the next', () => {
    let p = createProject();
    p = placeNew(p, 'plotPoint', spineLane(p).id, 800)!.project;
    p = addLevelBand(p, 'The Cave')!.project;
    p = addLevelBand(p, 'The Ridge')!.project;
    const ends = levelEnds(p);
    expect(ends.map((e) => [e.name, e.next?.name])).toEqual([
      ['The Cave', 'The Ridge'],
      ['The Ridge', undefined],
    ]);
    expect(ends[0]!.at).toBe(plotStops(p)[1]);
    p = endingToSpine(p, columnEndings(p)[0]!);
    let play = startPlay(p);
    for (let i = 0; i < 12 && play.cursor.at !== 'end'; i++) play = advance(p, play);
    const levels = play.log.filter((e) => e.kind === 'level');
    expect(levels.map((e) => [e.text, 'from' in e ? e.from : undefined])).toEqual([
      ['The Cave', undefined],
      ['The Ridge', 'The Cave'],
    ]);
  });
});

describe('level transitions for the engines', () => {
  it('give each graph node the level it is in, by name, for the runtimes to cross', () => {
    let p = createProject();
    p = placeNew(p, 'plotPoint', spineLane(p).id, 800)!.project;
    p = addLevelBand(p, 'The Cave')!.project;
    p = addLevelBand(p, 'The Ridge')!.project;
    const graph = buildIR(p).graph;
    const at = (name: string) => graph.find((n) => n.name === name)!;
    expect(at('Beginning').level).toBe('The Cave');
    expect(at('Plot Point 1').level).toBe('The Ridge');
    // The Opening comes before any level; the endings column is in none.
    expect(at('Opening').level).toBeUndefined();
    expect(at('Ending 1').level).toBeUndefined();
  });
});

describe('level transitions on the spine', () => {
  it('put a cinematic between two levels, which plays as the player crosses into the next', () => {
    let p = createProject();
    p = placeNew(p, 'plotPoint', spineLane(p).id, 800)!.project;
    p = addLevelBand(p, 'Age of Wonder')!.project;
    const second = addLevelBand(p, 'Age of Iron')!;
    p = second.project;
    const [first] = levelBands(p);
    // The last level has no next one to go to.
    expect(addTransition(p, second.id)).toBeNull();
    const made = addTransition(p, first!.id)!;
    p = made.project;
    expect(p.objects[made.id]).toMatchObject({ type: 'cinematic', name: 'Age of Wonder → Age of Iron' });
    expect(transitionOf(p, first!.id)).toBe(made.id);
    expect(addTransition(p, first!.id)).toBeNull();
    // On the spine just after the plot point where the levels meet, in the next level.
    const spine = spineSequence(p);
    expect(spine.indexOf(made.id)).toBe(spine.indexOf(first!.endRef) + 1);
    expect(levelOf(p, made.id)?.name).toBe('Age of Iron');
    p = endingToSpine(p, columnEndings(p)[0]!);
    let play = startPlay(p);
    for (let i = 0; i < 16 && play.cursor.at !== 'end'; i++) play = advance(p, play);
    // The engines get it as the transition between those levels.
    const ir = buildIR(p);
    expect(ir.graph.find((n) => n.key === ir.graph.find((g) => g.name === 'Age of Wonder → Age of Iron')!.key)!.transition).toEqual({ from: 'Age of Wonder', to: 'Age of Iron' });
    expect(ir.cinematics.find((c) => c.name === 'Age of Wonder → Age of Iron')!.fields).toMatchObject({ transition: 'Age of Wonder → Age of Iron', level: 'Age of Iron' });
    expect(ir.cinematics.find((c) => c.name === 'Age of Wonder → Age of Iron')!.fields.transitionOf).toBeUndefined();
    // In the play-through it runs its length (3 s with no shots) and can be skipped.
    let at = startPlay(p);
    for (let i = 0; i < 16 && !(promptOf(p, at).kind === 'continue' && (promptOf(p, at) as { transition?: unknown }).transition); i++) at = advance(p, at);
    expect(promptOf(p, at)).toEqual({ kind: 'continue', transition: { title: '[Transition] Age of Wonder → Age of Iron', seconds: 3 } });
    expect(promptOf(p, advance(p, at))).not.toMatchObject({ transition: expect.anything() });
    // Into the next level, then its transition plays.
    const crossing = play.log.findIndex((e) => e.kind === 'level' && e.text === 'Age of Iron');
    const cinematic = play.log.findIndex((e) => e.kind === 'cinematic' && e.text.endsWith('Age of Wonder → Age of Iron'));
    expect(crossing).toBeGreaterThan(-1);
    expect(cinematic).toBeGreaterThan(crossing);
  });
});
