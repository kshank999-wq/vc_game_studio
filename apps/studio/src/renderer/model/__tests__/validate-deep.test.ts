import { describe, expect, it } from 'vitest';
import { connect, createProject, makeObject, placeNew } from '../project';
import type { Project, StoryObject } from '../types';
import { deepIssues } from '../validate-deep';
import { findIssues } from '../validate';

const now = '2026-10-06T00:00:00.000Z';
const add = (p: Project, o: StoryObject): Project => ({ ...p, objects: { ...p.objects, [o.id]: o } });
const messages = (p: Project, id: string) => deepIssues(p).filter((i) => i.id === id).map((i) => i.message);

describe('whole-story checks', () => {
  it('flags branches only other stranded branches lead to', () => {
    let p = createProject();
    const a = placeNew(p, 'scene', null, 400, -200)!;
    p = a.project;
    const b = placeNew(p, 'scene', null, 700, -200)!;
    p = b.project;
    const linked = connect(p, a.id, b.id);
    if ('error' in linked) throw new Error(linked.error);
    p = linked.project;
    expect(messages(p, b.id)[0]).toMatch(/Unreachable/);
    // a has no incoming at all: the existing "Nothing leads here" covers it.
    expect(messages(p, a.id)).toEqual([]);
  });

  it('flags a state value the story waits for that nothing sets', () => {
    let p = createProject();
    const door = makeObject('state', 'vault door', now, { states: ['sealed', 'open'], initialState: 'sealed' });
    const gate = makeObject('gate', 'Vault gate', now, { rule: { match: 'all', items: [{ kind: 'flag', ref: door.id, op: 'is', value: 'open' }] } });
    p = add(add(p, door), gate);
    expect(messages(p, door.id)[0]).toContain('“open”');
    const lever = makeObject('trigger', 'Lever', now, { effects: [{ kind: 'setFlag', ref: door.id, value: 'open' }] });
    expect(messages(add(p, lever), door.id)).toEqual([]);
  });

  it('flags an item the story needs that can never be had', () => {
    let p = createProject();
    const key = makeObject('inventory', 'Vault Key', now);
    const gate = makeObject('gate', 'Vault gate', now, { rule: { match: 'all', items: [{ kind: 'item', ref: key.id, op: 'has' }] } });
    p = add(add(p, key), gate);
    expect(messages(p, key.id)[0]).toContain('can never get it');
    const giver = makeObject('trigger', 'Find the key', now, { effects: [{ kind: 'give', ref: key.id }] });
    expect(messages(add(p, giver), key.id)).toEqual([]);
  });

  it('flags effects that undo each other, and setups never paid off', () => {
    let p = createProject();
    const door = makeObject('state', 'door', now, { states: ['open', 'shut'] });
    const lever = makeObject('trigger', 'Lever', now, { effects: [{ kind: 'setFlag', ref: door.id, value: 'open' }, { kind: 'setFlag', ref: door.id, value: 'shut' }] });
    const setup = makeObject('theme', 'The sealed door', now, { kind: 'Setup / payoff', setUp: 'The shrine' });
    p = [door, lever, setup].reduce(add, p);
    expect(messages(p, lever.id)[0]).toContain('undo each other');
    expect(messages(p, setup.id)[0]).toContain('never paid off');
    // They reach the node's "!" badge with the rest.
    expect(findIssues(p).some((i) => i.id === setup.id)).toBe(true);
  });
});
