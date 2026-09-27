import { describe, expect, it } from 'vitest';
import { createProject, placeNew, removeObject } from '../project';
import { spineLane } from '../layout';
import { addElement } from '../scene';
import { setField, setterNames } from '../details';
import { apply, describeEffects, describeRule, emptyState, evaluate, newCondition, newEffect, type Rule } from '../rules';
import { findIssues } from '../validate';

const setup = () => {
  let p = createProject();
  const placed = placeNew(p, 'scene', spineLane(p).id, 400)!;
  p = placed.project;
  const add = (type: Parameters<typeof addElement>[2], name: string) => {
    const r = addElement(p, placed.id, type, name)!;
    p = r.project;
    return r.id;
  };
  return { get p() { return p; }, set p(v) { p = v; }, scene: placed.id, key: add('inventory', 'Vault Key'), solved: add('state', 'door_solved'), lever: add('object', 'Rusted Lever'), mara: add('character', 'Mara'), drains: add('trigger', 'Seam drains') };
};

describe('rules', () => {
  it('read as a sentence', () => {
    const s = setup();
    const rule: Rule = { match: 'all', items: [newCondition('item', s.key), newCondition('flag', s.solved, 'yes'), { match: 'any', items: [newCondition('arc', s.mara, '1')] }] };
    expect(describeRule(s.p, rule)).toBe('Vault Key is carried and door_solved is yes and (Mara’s arc ≥ 1)');
    expect(describeRule(s.p, { match: 'all', items: [] })).toBe('Always');
    expect(describeEffects(s.p, [newEffect('take', s.key), newEffect('arc', s.mara, '-1')])).toBe('take Vault Key · Mara −1');
  });

  it('evaluate all, any and nested groups against a playthrough', () => {
    const s = setup();
    const rule: Rule = { match: 'all', items: [newCondition('item', s.key), { match: 'any', items: [newCondition('flag', s.solved, 'yes'), newCondition('arc', s.mara, '2')] }] };
    let state = emptyState();
    expect(evaluate(rule, state)).toBe(false);
    state = apply([newEffect('give', s.key)], state);
    expect(evaluate(rule, state)).toBe(false);
    state = apply([newEffect('arc', s.mara, '1'), newEffect('arc', s.mara, '1')], state);
    expect(evaluate(rule, state)).toBe(true);
    state = apply([newEffect('take', s.key)], state);
    expect(evaluate(rule, state)).toBe(false);
    expect(evaluate(undefined, state)).toBe(true);
  });

  it('count as setting a state, wherever the effect is', () => {
    const s = setup();
    expect(findIssues(s.p).map((i) => i.message)).toContain('Nothing sets this state. Give an interaction or trigger “sets” it.');
    s.p = setField(s.p, s.drains, 'x', '');
    s.p = { ...s.p, objects: { ...s.p.objects, [s.drains]: { ...s.p.objects[s.drains]!, data: { ...s.p.objects[s.drains]!.data, effects: [newEffect('setFlag', s.solved, 'yes')] } } } };
    expect(setterNames(s.p, s.solved)).toEqual(['Seam drains']);
    expect(findIssues(s.p).some((i) => i.id === s.solved)).toBe(false);
  });

  it('flag a condition pointing at something deleted', () => {
    const s = setup();
    s.p = { ...s.p, objects: { ...s.p.objects, [s.drains]: { ...s.p.objects[s.drains]!, data: { ...s.p.objects[s.drains]!.data, rule: { match: 'all', items: [newCondition('item', s.key)] } } } } };
    expect(findIssues(s.p).some((i) => i.id === s.drains)).toBe(false);
    s.p = removeObject(s.p, s.key);
    expect(findIssues(s.p).find((i) => i.id === s.drains)?.message).toMatch(/no longer exists/);
  });
});

describe('rules on routes and timelines', () => {
  it('a branch route carries conditions and effects, and clears them when emptied', async () => {
    const { setConnectionRules } = await import('../project');
    const s = setup();
    const connection = { id: 'c1', kind: 'branch' as const, sourceId: s.scene, targetId: s.scene };
    s.p = { ...s.p, connections: [...s.p.connections, connection] };
    s.p = setConnectionRules(s.p, 'c1', { conditions: { match: 'all', items: [newCondition('item', s.key)] }, effects: [newEffect('take', s.key)] });
    const c = s.p.connections.find((x) => x.id === 'c1')!;
    expect(c.conditions?.items).toHaveLength(1);
    expect(c.effects).toHaveLength(1);
    s.p = setConnectionRules(s.p, 'c1', { conditions: undefined, effects: [] });
    const cleared = s.p.connections.find((x) => x.id === 'c1')!;
    expect('conditions' in cleared || 'effects' in cleared).toBe(false);
  });
});
