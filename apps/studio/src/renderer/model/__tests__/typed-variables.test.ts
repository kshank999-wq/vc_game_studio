import { describe, expect, it } from 'vitest';
import { createProject, placeNew } from '../project';
import { spineLane } from '../layout';
import { addElement } from '../scene';
import { initialState, setInitialValue, setterNames, setValue, setVarType, statesOf, varTypeOf } from '../details';
import { apply, describeEffects, describeRule, emptyState, evaluate, fromNumber, newCondition, newEffect, toNumber } from '../rules';
import { buildIR } from '../handoff/ir';
import { startWorld } from '../play';

const setup = () => {
  let p = createProject();
  const placed = placeNew(p, 'scene', spineLane(p).id, 400)!;
  p = placed.project;
  const add = (type: Parameters<typeof addElement>[2], name: string) => {
    const r = addElement(p, placed.id, type, name)!;
    p = r.project;
    return r.id;
  };
  const trust = add('state', 'trust');
  const nick = add('state', 'nickname');
  const lever = add('trigger', 'Pull lever');
  p = setVarType(p, trust, 'number');
  p = setVarType(p, nick, 'text');
  return { p, trust, nick, lever };
};

describe('typed variables', () => {
  it('a state holds a list of values, a number or text', () => {
    const { p, trust, nick } = setup();
    expect(varTypeOf(p.objects[trust])).toBe('number');
    expect(varTypeOf(p.objects[nick])).toBe('text');
    expect(statesOf(p.objects[trust])).toEqual([]);
    expect(initialState(p.objects[trust])).toBe('0');
    expect(initialState(p.objects[nick])).toBe('');
    const q = setInitialValue(setInitialValue(p, trust, '3'), nick, 'Wren');
    expect(initialState(q.objects[trust])).toBe('3');
    expect(initialState(q.objects[nick])).toBe('Wren');
    expect(initialState(setInitialValue(p, trust, 'lots').objects[trust])).toBe('0');
    // Back to a list of values: the usual no / yes.
    expect(statesOf(setVarType(q, trust, 'states').objects[trust])).toEqual(['no', 'yes']);
  });

  it('numbers are added to, set and compared, and kept as text', () => {
    const { p, trust } = setup();
    let s = emptyState();
    s = apply([newEffect('addNumber', trust, '2'), newEffect('addNumber', trust, '0.1'), newEffect('addNumber', trust, '0.2')], s);
    expect(s.flags[trust]).toBe('2.3');
    expect(evaluate({ match: 'all', items: [{ kind: 'number', ref: trust, op: 'atLeast', value: 2 }] }, s)).toBe(true);
    expect(evaluate({ match: 'all', items: [{ kind: 'number', ref: trust, op: 'below', value: 2 }] }, s)).toBe(false);
    s = apply([newEffect('setNumber', trust, '5'), newEffect('addNumber', trust, '-7')], s);
    expect(s.flags[trust]).toBe('-2');
    expect(evaluate({ match: 'all', items: [{ kind: 'number', ref: trust, op: 'equals', value: -2 }] }, s)).toBe(true);
    expect(describeRule(p, { match: 'all', items: [newCondition('number', trust, '3')] })).toBe('trust ≥ 3');
    expect(describeEffects(p, [newEffect('addNumber', trust, '-1'), newEffect('setNumber', trust, '4')])).toBe('trust −1 · trust = 4');
  });

  it('reads anything that is not a number as 0, and writes no float noise', () => {
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber('abc')).toBe(0);
    expect(toNumber('2.5')).toBe(2.5);
    expect(fromNumber(0.1 + 0.2)).toBe('0.3');
    expect(fromNumber(3)).toBe('3');
  });

  it('effects that change a number count as setting it, and the play-through starts it at its value', () => {
    let { p, trust, lever } = setup();
    p = setValue(p, lever, 'effects', [newEffect('addNumber', trust, '1')]);
    expect(setterNames(p, trust)).toContain('Pull lever');
    p = setInitialValue(p, trust, '4');
    expect(startWorld(p).flags[trust]).toBe('4');
  });

  it('travels to the engines with its type and scope', () => {
    let { p, trust, nick, lever } = setup();
    p = setValue(p, lever, 'effects', [newEffect('setNumber', trust, '2')]);
    p = setValue(p, trust, 'scope', 'Quest');
    const flags = buildIR(p).flags;
    const t = flags.find((f) => f.id === trust)!;
    expect(t).toMatchObject({ type: 'number', initial: '0', values: [], scope: 'Quest' });
    expect(t.setBy.length).toBe(1);
    expect(flags.find((f) => f.id === nick)).toMatchObject({ type: 'text', initial: '' });
  });
});
