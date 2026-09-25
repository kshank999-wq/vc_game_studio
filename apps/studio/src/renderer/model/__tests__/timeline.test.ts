import { describe, expect, it } from 'vitest';
import { spineLane } from '../layout';
import { createProject, placeNew, removeObject } from '../project';
import { addElement, addLine, removeFromScene, updateLine } from '../scene';
import {
  MAIN,
  addBranch,
  addEvent,
  eventDetail,
  eventTitle,
  exchanges,
  moveEvent,
  removeBranch,
  removeEvent,
  sceneExit,
  sceneTimeline,
  timelineSummary,
  updateBranch,
  updateEvent,
} from '../timeline';
import type { Project } from '../types';

const setup = () => {
  let p = createProject();
  const placed = placeNew(p, 'scene', spineLane(p).id, 400)!;
  const scene = placed.id;
  p = placed.project;
  const mara = addElement(p, scene, 'character', 'Mara')!;
  p = mara.project;
  const explorer = addElement(p, scene, 'character', 'The Explorer')!;
  p = explorer.project;
  const one = addLine(p, scene, 'dialogue', undefined, mara.id);
  const two = addLine(one.project, scene, 'dialogue', one.id, explorer.id);
  p = updateLine(two.project, one.id, { text: "Water's holding it shut." });
  return { p, scene, mara: mara.id, explorer: explorer.id, one: one.id, two: two.id };
};

const main = (p: Project, scene: string) => sceneTimeline(p, scene)[0]!.events;
const kinds = (p: Project, scene: string) => main(p, scene).map((e) => e.kind);

describe('a scene timeline', () => {
  it('has the script’s dialogue on it from the start, in order', () => {
    const { p, scene } = setup();
    expect(kinds(p, scene)).toEqual(['dialogue', 'dialogue']);
    expect(p.events).toHaveLength(0);
    expect(eventTitle(p, main(p, scene)[0]!)).toBe('MARA');
    expect(eventDetail(p, main(p, scene)[0]!)).toBe("Water's holding it shut.");
  });

  it('adds cinematics, actions and free play where they are dropped', () => {
    let { p, scene } = setup();
    p = addEvent(p, scene, 'cinematic', { index: 0 })!.project;
    p = addEvent(p, scene, 'action', { index: 2, label: 'Echo cue' })!.project;
    const free = addEvent(p, scene, 'freePlay', { label: 'Search the chamber' })!;
    p = updateEvent(free.project, scene, free.id, { endsWhen: 'lever = up' });
    expect(kinds(p, scene)).toEqual(['cinematic', 'dialogue', 'action', 'dialogue', 'freePlay']);
    expect(eventDetail(p, main(p, scene).at(-1)!)).toBe('Ends when: lever = up');
    // A new cinematic is an element of the scene, not a copy on the timeline.
    const cinematic = main(p, scene)[0]!;
    expect(p.objects[cinematic.refId!]?.type).toBe('cinematic');
  });

  it('reorders events, including the script’s dialogue, without touching the script', () => {
    let { p, scene, one, two } = setup();
    p = addEvent(p, scene, 'action', { label: 'Echo cue' })!.project;
    const action = main(p, scene).at(-1)!;
    p = moveEvent(p, scene, action.id, MAIN, 0);
    expect(kinds(p, scene)).toEqual(['action', 'dialogue', 'dialogue']);
    p = moveEvent(p, scene, `dlg_${two}`, MAIN, 1);
    expect(main(p, scene).map((e) => e.refId ?? e.label)).toEqual(['Echo cue', two, one]);
    expect(p.lines.find((l) => l.id === one)!.order).toBe(1);
  });

  it('keeps new lines coming after what is already placed', () => {
    let { p, scene, two, mara } = setup();
    p = addEvent(p, scene, 'cinematic')!.project;
    p = addLine(p, scene, 'dialogue', two, mara).project;
    expect(kinds(p, scene)).toEqual(['dialogue', 'dialogue', 'cinematic', 'dialogue']);
  });

  it('splits at a choice into branches that can reconnect', () => {
    let { p, scene, two } = setup();
    p = addEvent(p, scene, 'freePlay', { label: 'Search' })!.project;
    const free = main(p, scene).at(-1)!;
    const choice = addEvent(p, scene, 'choice')!;
    p = choice.project;
    const branch = addBranch(p, scene, choice.id, 'Force it')!;
    p = branch.project;
    p = addEvent(p, scene, 'action', { track: branch.id, label: 'Water rises' })!.project;
    p = moveEvent(p, scene, `dlg_${two}`, branch.id, 0);
    p = updateBranch(p, branch.id, { rejoinEventId: free.id });
    const tracks = sceneTimeline(p, scene);
    expect(tracks.map((t) => t.branch?.label ?? 'main')).toEqual(['main', 'Force it']);
    expect(tracks[1]!.events.map((e) => e.kind)).toEqual(['dialogue', 'action']);
    expect(tracks[1]!.branch!.rejoinEventId).toBe(free.id);
    expect(timelineSummary(p, scene)).toMatchObject({ events: 5, branches: 1, freePlay: 1 });
    // A choice can't move onto its own branch.
    expect(moveEvent(p, scene, choice.id, branch.id, 0)).toBe(p);
    // Removing the branch puts its events back after the choice.
    const merged = removeBranch(p, scene, branch.id);
    expect(kinds(merged, scene)).toEqual(['dialogue', 'freePlay', 'choice', 'dialogue', 'action']);
  });

  it('removes a choice with its branches, and a dialogue event with its line', () => {
    let { p, scene, one } = setup();
    const choice = addEvent(p, scene, 'choice')!;
    const branch = addBranch(choice.project, scene, choice.id)!;
    p = addEvent(branch.project, scene, 'action', { track: branch.id })!.project;
    p = removeEvent(p, scene, choice.id);
    expect(sceneTimeline(p, scene)).toHaveLength(1);
    expect(p.events.some((e) => e.kind === 'action')).toBe(false);
    p = removeEvent(p, scene, `dlg_${one}`);
    expect(p.lines.some((l) => l.id === one)).toBe(false);
  });

  it('drops events whose element leaves the scene', () => {
    let { p, scene } = setup();
    const cinematic = addEvent(p, scene, 'cinematic')!;
    p = cinematic.project;
    const refId = p.events.find((e) => e.id === cinematic.id)!.refId!;
    p = removeFromScene(p, scene, refId);
    expect(kinds(p, scene)).toEqual(['dialogue', 'dialogue']);
    p = removeObject(p, scene);
    expect(p.events).toHaveLength(0);
  });

  it('groups consecutive dialogue into exchanges', () => {
    let { p, scene } = setup();
    p = addEvent(p, scene, 'action')!.project;
    expect(exchanges(main(p, scene)).map((g) => g.length)).toEqual([2, 1]);
  });

  it('says where the scene goes next on the spine', () => {
    const { p, scene } = setup();
    expect(sceneExit(p, scene)).toBe('Ending');
  });
});
