import { describe, expect, it } from 'vitest';
import { interactionsOf, statesOf, updateInteraction } from '../details';
import { levelsOf } from '../level/level';
import { setWorldByHand, startLevelPlay, startPoint, tick } from '../level/play';
import { applyStoryEffects, settleWorld, startWorld, useStoryObject } from '../play';
import { addCue, addHint, clueOf, cuesOf, elementIssues, traceClues, updateClue, updateCue, updateHint } from '../puzzle/clues';
import { compileTree, createPuzzle, nodesOf, puzzleIssues, updateNode } from '../puzzle/design';
import { addElement, conditionFor, ELEMENT_KINDS, elementKindOf, elementsOf, linkElement, revealedBy, stepFromElement, stepsUsing, unlinkElement } from '../puzzle/elements';
import { BUILT_IN_TEMPLATES, puzzleFromTemplate, templateFrom } from '../puzzle/templates';
import { buildIR } from '../handoff/ir';
import { makeObject } from '../project';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const fresh = () => {
  const made = createPuzzle(sunkenVault(), 'The Safe', 'object');
  return { project: made.project, id: made.id };
};
const byName = (p: Project, name: string) => Object.values(p.objects).find((o) => o.name === name)!;

describe('the puzzle element library (puzzle spec §9, §11)', () => {
  it('has every kind the spec names, each with an icon and the story element it is', () => {
    expect(ELEMENT_KINDS.map((k) => k.label)).toEqual([
      'Clue', 'Key', 'Code', 'Note', 'Symbol', 'Lock', 'Container', 'Switch', 'Lever', 'Dial', 'Button', 'Pressure plate',
      'Movable object', 'Collectible piece', 'Power source', 'Socket', 'Sequence trigger', 'Timer', 'Door', 'Reward', 'Custom',
    ]);
    expect(ELEMENT_KINDS.every((k) => k.icon && k.type)).toBe(true);
  });

  it('makes an element with its states and verbs, a step from it, and plays it', () => {
    let { project, id } = fresh();
    const lever = addElement(project, id, 'lever', 'Brass lever');
    project = lever.project;
    const o = project.objects[lever.elementId]!;
    expect([o.type, o.data.code, elementKindOf(o), statesOf(o)]).toEqual(['object', expect.stringMatching(/^OBJ-/), 'lever', ['Down', 'Up']]);
    expect(interactionsOf(o).map((i) => `${i.verb} ${i.when}→${i.becomes}`)).toEqual(['Pull Down→Up', 'Push Up→Down']);
    expect(elementsOf(project, id).map((e) => e.name)).toEqual(['Brass lever']);
    const step = stepFromElement(project, id, lever.elementId);
    project = step.project;
    expect(nodesOf(project.objects[id])[0]).toMatchObject({ kind: 'interaction', label: 'Brass lever: Up', when: { kind: 'object', ref: lever.elementId, op: 'is', value: 'Up' } });
    expect(stepsUsing(project, id, lever.elementId).map((n) => n.id)).toEqual([step.nodeId]);
    // Pulled in the play-through: the step's condition holds, the puzzle is solved.
    const used = useStoryObject(project, startWorld(project), lever.elementId);
    expect(used.verb).toBe('Pull');
    expect(used.world.solved[id]).toBe(true);
  });

  it('turns a dial round through its positions, and lists elements its steps name', () => {
    let { project, id } = fresh();
    const dial = addElement(project, id, 'dial');
    project = dial.project;
    expect(interactionsOf(project.objects[dial.elementId]).map((i) => `${i.when}→${i.becomes}`)).toEqual(['1→2', '2→3', '3→4', '4→1']);
    // The sample's puzzle lists the lever, and its steps name door_solved too.
    const vault = Object.values(project.objects).find((o) => o.type === 'puzzle' && o.name === 'The Vault Door')!;
    expect(elementsOf(project, vault.id).map((e) => e.name)).toEqual(['Rusted Lever', 'door_solved']);
    expect(elementKindOf(byName(project, 'Rusted Lever'))).toBe('lever');
    project = unlinkElement(linkElement(project, id, byName(project, 'Vault Key').id), id, dial.elementId);
    expect(elementsOf(project, id).map((e) => e.name)).toEqual(['Vault Key']);
    expect(conditionFor(project, byName(project, 'Vault Key').id)).toEqual({ kind: 'item', ref: byName(project, 'Vault Key').id, op: 'has' });
  });
});

describe('the clue system (puzzle spec §10)', () => {
  it('traces every clue to a purpose, and says when nothing reveals one', () => {
    let { project, id } = fresh();
    const clue = addElement(project, id, 'clue', 'Scratched digits');
    project = clue.project;
    project = updateClue(project, clue.elementId, { form: 'Visual', content: '42 on the wall', location: 'Behind the painting', discovery: 'Inspect', knowledge: 'The code starts 42', strength: 'Subtle' });
    expect(clueOf(project.objects[clue.elementId])).toMatchObject({ form: 'Visual', strength: 'Subtle', mandatory: true, supports: [] });
    expect(project.objects[clue.elementId]!.data.clueLocation).toBe('Behind the painting');
    let issues = elementIssues(project, id).map((i) => i.message);
    expect(issues).toEqual(['The clue “Scratched digits” helps no step: say which it helps, or have a step need it known.', 'Nothing reveals the clue “Scratched digits”: bind it to a clue in a level, or reveal it from an interaction.']);
    // A step that needs it known uses it; an interaction that reveals it reaches it.
    const step = stepFromElement(project, id, clue.elementId);
    project = step.project;
    const painting = addElement(project, id, 'custom', 'Painting');
    project = painting.project;
    project = { ...project, objects: { ...project.objects, [painting.elementId]: { ...project.objects[painting.elementId]!, data: { ...project.objects[painting.elementId]!.data, interactions: [{ id: 'act_x', verb: 'Inspect', effects: [{ kind: 'revealLore', ref: clue.elementId }] }] } } } };
    expect(revealedBy(project, clue.elementId)).toBe('effect');
    expect(traceClues(project, id).map((t) => [t.clue.name, t.usedBy, t.used, t.reached])).toEqual([['Scratched digits', [step.nodeId], true, 'effect']]);
    expect(elementIssues(project, id)).toEqual([]);
    // Inspecting the painting reveals the clue, which does the step.
    const w = useStoryObject(project, startWorld(project), painting.elementId).world;
    expect(w.lore[clue.elementId]).toBe(true);
    expect(w.solved[id]).toBe(true);
    // Optional, and saying which step it helps.
    project = updateClue(project, clue.elementId, { mandatory: false, supports: [step.nodeId, step.nodeId] });
    expect(clueOf(project.objects[clue.elementId])).toMatchObject({ mandatory: false, supports: [step.nodeId] });
  });

  it('gives staged hints once their wrong moves are made or their condition holds, each once', () => {
    let { project, id } = fresh();
    const lever = addElement(project, id, 'lever', 'Lever');
    project = lever.project;
    const alarm = makeObject('state', 'alarm', new Date().toISOString());
    project = { ...project, objects: { ...project.objects, [alarm.id]: alarm } };
    const step = stepFromElement(project, id, lever.elementId);
    project = updateNode(step.project, id, step.nodeId, { fail: { when: { kind: 'flag', ref: alarm.id, op: 'is', value: 'yes' } } });
    project = addHint(project, id, 'Try the lever');
    project = addHint(project, id, 'Pull it up');
    const [h1, h2] = (project.objects[id]!.data.hints as { id: string }[])!;
    project = updateHint(project, id, h2!.id, { afterFails: undefined, when: { kind: 'flag', ref: alarm.id, op: 'is', value: 'no' } });
    let w = settleWorld(project, startWorld(project)).world;
    // The second hint's condition held from the start; the first waits for a wrong move.
    expect(Object.keys(w.hinted ?? {})).toEqual([h2!.id]);
    const r = applyStoryEffects(project, w, [{ kind: 'setFlag', ref: alarm.id, value: 'yes' }]);
    expect(r.log.filter((e) => e.kind === 'hint').map((e) => e.text)).toEqual(['Try the lever']);
    w = r.world;
    expect(w.hinted?.[h1!.id]).toBe(true);
    expect(settleWorld(project, w).log.filter((e) => e.kind === 'hint')).toEqual([]);
    expect(elementIssues(updateHint(project, id, h1!.id, { afterFails: 0 }), id).map((i) => i.message)).toContain('The hint “Try the lever” is never given: give it wrong moves to wait for, or a condition.');
  });

  it('plays what solving it plays: a line in the play-through, a cinematic and a message in Play Mode', () => {
    let { project, id } = fresh();
    const lever = addElement(project, id, 'lever', 'Lever');
    project = stepFromElement(lever.project, id, lever.elementId).project;
    const cinematic = Object.values(project.objects).find((o) => o.type === 'cinematic')!;
    project = addCue(addCue(project, id, 'cinematic'), id, 'message');
    const [c1, c2] = cuesOf(project.objects[id]);
    project = updateCue(updateCue(project, id, c1!.id, { ref: cinematic.id, text: 'The safe opens' }), id, c2!.id, { text: 'Click.' });
    const used = useStoryObject(project, startWorld(project), lever.elementId);
    expect(used.log.map((e) => ('text' in e ? e.text : '')).filter((t) => t.startsWith('▶'))).toEqual([`▶ Cinematic: ${cinematic.name}: The safe opens`, '▶ A message on screen: Click.']);
    // In Play Mode, solving it plays the cinematic.
    const level = levelsOf(project).levels[0]!;
    let s = startLevelPlay(project, level.id);
    s = tick(project, s, 0.1, startPoint(project, level.id));
    s = setWorldByHand(project, s, used.world, 'pull');
    expect(s.cinematic?.id).toBe(cinematic.id);
  });
});

describe('puzzle templates (puzzle spec §9, §15)', () => {
  it('makes the spec’s safe-code puzzle from its built-in template: fresh elements, clues, steps and rule', () => {
    const base = sunkenVault();
    const safe = BUILT_IN_TEMPLATES.find((t) => t.id === 'builtin.safe')!;
    const { project, id } = puzzleFromTemplate(base, safe, 'The Study Safe');
    const puzzle = project.objects[id]!;
    expect([puzzle.name, puzzle.data.scale, puzzle.data.objective]).toEqual(['The Study Safe', 'object', 'Open the safe']);
    const els = elementsOf(project, id);
    expect(els.map((e) => [e.name, e.type, elementKindOf(e)])).toEqual([
      ['Safe', 'object', 'container'],
      ['Safe code', 'lore', 'code'],
      ['First two digits', 'lore', 'clue'],
      ['The order', 'lore', 'clue'],
      ['Confirmation', 'lore', 'clue'],
      ['Painting', 'object', 'custom'],
      ['Desk drawer', 'object', 'container'],
    ]);
    expect(els[1]!.data.answer).toBe('4271');
    const nodes = nodesOf(puzzle);
    expect(nodes.every((n) => n.id.startsWith('pzn_'))).toBe(true);
    // The steps point at the new elements, and links at the new steps.
    expect(nodes.find((n) => n.label === 'Learn the first two digits')!.when).toEqual({ kind: 'lore', ref: els[2]!.id, op: 'known' });
    expect(nodes.find((n) => n.label === 'Enter the code')!.requires).toEqual([nodes.find((n) => n.label === 'Work out the code')!.id]);
    expect(puzzle.data.rule).toEqual(compileTree(nodes, id));
    expect(traceClues(project, id).every((t) => t.used)).toBe(true);
    expect(puzzleIssues(project, id).filter((i) => i.severity === 'error')).toEqual([]);
    expect(elementIssues(project, id).filter((i) => /Nothing reveals/.test(i.message))).toEqual([]);
    // Solvable as it comes: the code can't be entered until both clues are found; then it opens the safe.
    let w = settleWorld(project, startWorld(project)).world;
    expect(useStoryObject(project, w, els[0]!.id).verb).toBe('Inspect');
    w = useStoryObject(project, w, els[5]!.id).world;
    w = useStoryObject(project, w, els[6]!.id).world;
    expect([w.lore[els[2]!.id], w.lore[els[3]!.id]]).toEqual([true, true]);
    const safeObj = project.objects[els[0]!.id]!;
    expect(interactionsOf(safeObj)[1]).toMatchObject({ verb: 'Enter code', screen: true });
    expect((safeObj.data.screen as { codeRef: string }).codeRef).toBe(els[1]!.id);
    // The engines get the elements as they get any object and lore: kind, states, verbs, the clue's fields.
    const ir = buildIR(project);
    const irLore = (ir.lore as { name: string; fields: Record<string, string> }[]).find((l) => l.name === 'First two digits')!;
    expect(irLore.fields).toMatchObject({ elementKind: 'clue', clueForm: 'Visual', clueLocation: 'Behind the painting', clueStrength: 'Moderate' });
    const irSafe = (ir.objects as { name: string; fields: Record<string, string>; interactions: { verb: string }[] }[]).find((o) => o.name === 'Safe')!;
    expect([irSafe.fields.elementKind, irSafe.interactions.map((i) => i.verb)]).toEqual(['container', ['Inspect', 'Enter code', 'Take']]);
    // Two from one template share nothing.
    const again = puzzleFromTemplate(project, safe);
    expect(elementsOf(again.project, again.id).map((e) => e.id).some((x) => els.some((e) => e.id === x))).toBe(false);
    expect(interactionsOf(elementsOf(again.project, again.id)[0]).map((i) => i.id)).not.toEqual(interactionsOf(els[0]).map((i) => i.id));
  });

  it('saves a puzzle as a template and makes another from it, leaving out what is outside it', () => {
    let { project, id } = puzzleFromTemplate(sunkenVault(), BUILT_IN_TEMPLATES.find((t) => t.id === 'builtin.lever')!);
    // The lever's pull also names a scene, which a template can't carry.
    const lever = elementsOf(project, id)[0]!;
    const scene = Object.values(project.objects).find((o) => o.type === 'scene')!;
    const pull = interactionsOf(lever)[0]!;
    project = updateInteraction(project, lever.id, pull.id, { requires: { match: 'all', items: [{ kind: 'visited', ref: scene.id, op: 'visited' }] } });
    const { template, blanked } = templateFrom(project, id, 'My lever door', 'Mine');
    expect(blanked).toBe(1);
    expect(template.elements.map((e) => e.key)).toEqual(['el1', 'el2']);
    expect(JSON.stringify(template)).not.toContain(lever.id);
    const made = puzzleFromTemplate(project, template);
    const els = elementsOf(made.project, made.id);
    expect(els.map((e) => e.name)).toEqual(['Lever', 'Door']);
    expect(interactionsOf(els[0])[0]!.effects).toEqual([{ kind: 'setObject', ref: els[1]!.id, value: 'Closed' }]);
    // Pull, then open: solved.
    let w = startWorld(made.project);
    w = useStoryObject(made.project, w, els[0]!.id).world;
    expect(w.objects[els[1]!.id]).toBe('Closed');
    w = useStoryObject(made.project, w, els[1]!.id).world;
    expect(w.solved[made.id]).toBe(true);
  });
});
