import { describe, expect, it } from 'vitest';
import { buildIR } from '../handoff/ir';
import { json, storySchema } from '../handoff/json';
import { nodesOf } from '../puzzle/design';
import { BUILT_IN_TEMPLATES, puzzleFromTemplate } from '../puzzle/templates';
import { sunkenVault } from '../sample';

const withSafe = () => puzzleFromTemplate(sunkenVault(), BUILT_IN_TEMPLATES.find((t) => t.id === 'builtin.safe')!);

describe('puzzles in the handoff (puzzle spec §6–§11, for every engine)', () => {
  it('carries a puzzle’s design: its steps, links, hints, cues and elements, keyed for the engines', () => {
    const { project, id } = withSafe();
    const ir = buildIR(project);
    const safe = ir.objects.find((o) => o.id === id)!;
    const design = safe.design!;
    expect([design.progress, design.reset]).toEqual([true, 'never']);
    expect(design.elements).toHaveLength(7);
    expect(design.elements).toEqual(expect.arrayContaining(['safe', 'first_two_digits', 'the_order', 'painting', 'desk_drawer']));
    const nodes = nodesOf(project.objects[id]);
    const enter = design.steps.find((s) => s.label === 'Enter the code')!;
    expect(enter).toMatchObject({ kind: 'interaction', parent: null, requires: [nodes.find((n) => n.label === 'Work out the code')!.id], when: { match: 'all', items: [{ kind: 'object', ref: 'safe', op: 'is', value: 'Open' }] } });
    expect(design.steps.find((s) => s.label === 'Confirm the code')).toMatchObject({ optional: true });
    expect(design.steps.find((s) => s.label === 'Work out the code')).toMatchObject({ kind: 'goal', gate: 'all', parent: null });
    expect(design.hints.map((h) => [h.text, h.afterFails])).toEqual([['The painting hangs a little crooked.', 1], ['The note’s year, read backwards, orders the digits.', 2]]);
    expect(design.cues).toEqual([{ kind: 'audio', text: 'A heavy click' }, { kind: 'animation', text: 'The safe door swings open' }]);
    // The sample's own puzzle keeps no progress: its rule alone solves it, as before.
    expect(ir.objects.find((o) => o.name === 'The Vault Door' && o.kind === 'puzzle')!.design!.progress).toBe(false);
  });

  it('carries an object’s screen with its code read from its code element, and marks the interaction it opens on', () => {
    const { project } = withSafe();
    const ir = buildIR(project);
    const safe = ir.objects.find((o) => o.ident.key === 'safe')!;
    expect(safe.screen).toMatchObject({ kind: 'keypad', code: '4271', keys: '123456789*0#', attempts: 3, feedback: { correct: 'A heavy click. The door gives.' } });
    expect(safe.screen).not.toHaveProperty('codeRef');
    expect(safe.interactions.map((i) => [i.verb, !!i.screen])).toEqual([['Inspect', false], ['Enter code', true], ['Take', false]]);
    // story.json carries it all, and its schema knows it.
    const story = JSON.parse(json.generate!(ir, 'vcgs').files[0]!.content);
    expect(story.objects.find((o: { ident: { key: string } }) => o.ident.key === 'safe').screen.code).toBe('4271');
    const schema = storySchema() as unknown as { $defs: Record<string, { properties?: Record<string, unknown> }> };
    const defs = schema.$defs ?? (schema as unknown as { definitions: Record<string, { properties?: Record<string, unknown> }> }).definitions;
    expect(Object.keys(defs.object!.properties!)).toEqual(expect.arrayContaining(['design', 'screen']));
    expect(defs.step).toBeTruthy();
  });
});
