import { describe, expect, it } from 'vitest';
import { createProject, placeNew } from '../project';
import { spineLane } from '../layout';
import { addSubScene } from '../subscene';
import { buildIR } from '../handoff/ir';

describe('rooms for the engines', () => {
  it('go out as a Where now? choice after the scene, into each room and back, and leave along the spine', () => {
    let p = createProject('Rooms');
    const scene = placeNew(p, 'scene', spineLane(p).id, 400)!;
    p = scene.project;
    const study = addSubScene(p, scene.id, 'The Study')!;
    p = study.project;
    const closet = addSubScene(p, study.id, 'The Closet')!;
    p = closet.project;
    const before = JSON.stringify(p);
    const ir = buildIR(p);
    expect(JSON.stringify(p)).toBe(before);
    const node = (name: string) => ir.graph.find((n) => n.name === name)!;
    const where = ir.choices.find((c) => c.name === 'New scene: where now?')!;
    expect(where.prompt).toBe('Where now?');
    // The scene goes to its choice; the choice into the study, or on along the spine.
    expect(node('New scene').routes.map((r) => r.to)).toEqual([node('New scene: where now?').key]);
    const onward = ir.graph.find((n) => n.key === node('New scene').onward)!;
    expect(where.options.map((o) => [o.label, o.to])).toEqual([
      ['Go into The Study', node('The Study').key],
      ['Leave New scene', onward.key],
    ]);
    expect(onward.name).toBe('Ending');
    // The study has its own choice; the closet goes back to it; leaving the study goes back to the scene's.
    const study2 = ir.choices.find((c) => c.name === 'The Study: where now?')!;
    expect(study2.options.map((o) => o.label)).toEqual(['Go into The Closet', 'Leave The Study']);
    expect(study2.options[1]!.to).toBe(node('New scene: where now?').key);
    expect(node('The Closet').routes.map((r) => r.to)).toEqual([node('The Study: where now?').key]);
    // Rooms are scenes the engines have, with the scene they are in.
    expect(ir.scenes.find((s) => s.name === 'The Closet')).toBeTruthy();
  });

  it('leaves a project without rooms as it was', () => {
    const p = createProject('Plain');
    expect(buildIR(p).choices).toHaveLength(0);
  });
});
