import { describe, expect, it } from 'vitest';
import { connect, createProject, makeObject, placeNew, setConnectionRules } from '../project';
import { spineLane, spineSequence } from '../layout';
import { advance, playToDecision, promptOf, startPlay } from '../play';
import { buildIR } from '../handoff/ir';
import type { Project } from '../types';

/** Beginning → a cinematic → two plot points → Ending, the cinematic able to skip the first when a state holds. */
const branching = () => {
  let p: Project = createProject();
  const spine = spineLane(p).id;
  const add = (type: 'cinematic' | 'plotPoint', x: number) => {
    const r = placeNew(p, type, spine, x)!;
    p = r.project;
    return r.id;
  };
  const cine = add('cinematic', 150);
  const skipped = add('plotPoint', 300);
  const landed = add('plotPoint', 450);
  const state = makeObject('state', 'seen it', '2026-01-01T00:00:00Z');
  p = { ...p, objects: { ...p.objects, [state.id]: state } };
  const seen = state.id;
  const order = spineSequence(p);
  expect(order.indexOf(cine)).toBeLessThan(order.indexOf(skipped));
  const link = connect(p, cine, landed);
  if ('error' in link) throw new Error(link.error);
  p = setConnectionRules(link.project, link.id, { conditions: { match: 'all', items: [{ kind: 'flag', ref: seen, op: 'is', value: 'yes' }] } });
  return { p, cine, skipped, landed, seen };
};

/** Every heading the play-through shows, Continue by Continue, to the end. */
const headings = (p: Project, play = startPlay(p)) => {
  for (let i = 0; i < 40 && promptOf(p, play).kind === 'continue'; i++) play = playToDecision(p, advance(p, play));
  return play.log.filter((e) => e.kind === 'heading' || e.kind === 'cinematic').map((e) => ('id' in e ? e.id : e.text));
};

describe('branching cinematics', () => {
  it('can skip ahead on the spine, by its route’s conditions', () => {
    const { p, skipped, landed, seen } = branching();
    // Not seen: on along the spine.
    expect(headings(p)).toContain(skipped);
    // Seen from the start: the route is taken and the next plot point skipped.
    const q = { ...p, objects: { ...p.objects, [seen]: { ...p.objects[seen]!, data: { ...p.objects[seen]!.data, initialState: 'yes' } } } };
    const taken = headings(q);
    expect(taken).not.toContain(skipped);
    expect(taken).toContain(landed);
  });

  it('send their routes to the engines', () => {
    const { p, cine, landed } = branching();
    const ir = buildIR(p);
    const node = ir.graph.find((n) => n.key === ir.cinematics.find((c) => c.id === cine)!.ident.key)!;
    expect(node.routes.map((r) => r.to)).toContain(ir.graph.find((n) => n.name === p.objects[landed]!.name)!.key);
  });
});
