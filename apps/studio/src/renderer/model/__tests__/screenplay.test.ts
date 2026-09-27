import { describe, expect, it } from 'vitest';
import { spineLane } from '../layout';
import { createProject, makeObject, placeNew } from '../project';
import { addElement, addLine, characterNamed, inScene, sceneLines, updateLine } from '../scene';
import { cueNames, fromElements, resolveCue, toElements, type ScriptElement } from '../script-elements';
import { autoType, cueExtension, cueName, cueSuggestions, onEnter, onTab, reformatText, retype, withExtension } from '../screenplay';

const setup = () => {
  let p = createProject('Vault');
  const scene = placeNew(p, 'scene', spineLane(p).id, 400)!;
  p = addElement(scene.project, scene.id, 'character', 'Mara')!.project;
  const jonah = makeObject('character', 'Jonah', new Date().toISOString());
  p = { ...p, objects: { ...p.objects, [jonah.id]: jonah } };
  return { p, sceneId: scene.id };
};

describe('VC Writer’s screenplay rules', () => {
  it('Tab changes the line, Return starts the next, as Final Draft does', () => {
    expect(onTab('action')).toEqual({ type: 'character', newLine: false });
    expect(onTab('character')).toEqual({ type: 'character', newLine: false, extensions: true });
    expect(onTab('character', { extensionOffered: true })).toEqual({ type: 'parenthetical', newLine: false });
    expect(onTab('character', { empty: true }).type).toBe('parenthetical');
    expect(onTab('dialogue').type).toBe('parenthetical');
    expect(onTab('parenthetical', { direction: -1 }).type).toBe('character');
    expect(onEnter('character', false)).toEqual({ type: 'dialogue', newLine: true });
    expect(onEnter('dialogue', false)).toEqual({ type: 'action', newLine: true });
    expect(onEnter('parenthetical', true)).toEqual({ type: 'dialogue', newLine: false });
  });

  it('puts a parenthetical in its brackets, and takes them off again', () => {
    expect(retype('whispering', 'dialogue', 'parenthetical')).toEqual({ text: '(whispering)', caret: 11 });
    expect(retype('', 'dialogue', 'parenthetical')).toEqual({ text: '()', caret: 1 });
    expect(retype('((beat))', 'parenthetical', 'action').text).toBe('beat');
  });

  it('types a line as what it turns out to be, and marks a cue’s voice', () => {
    expect(autoType('action', 'INT. VAULT - NIGHT')).toBe('scene_heading');
    expect(autoType('action', 'cut to:')).toBe('transition');
    expect(autoType('action', 'ANGLE ON the lever')).toBeNull();
    expect(autoType('action', 'ANGLE ON the lever', { detectShots: true })).toBe('shot');
    expect(autoType('dialogue', 'CUT TO:')).toBeNull();
    expect(withExtension('MARA (O.S.)', '(V.O.)')).toBe('MARA (V.O.)');
    expect(cueName("MARA (CONT'D)")).toBe('MARA');
    expect(cueExtension('MARA (V.O.)')).toBe('(V.O.)');
  });

  it('offers whoever is likeliest to speak next first', () => {
    expect(cueSuggestions(['Mara', 'Jonah', 'Ada'], ['Mara', 'Jonah'])).toEqual(['MARA', 'ADA', 'JONAH']);
  });

  it('reads a script pasted as text', () => {
    expect(reformatText('INT. VAULT - NIGHT\nWater pours in.\n\nMARA\n(quietly)\nWe go\nnow.\n\nCUT TO:').map((e) => [e.type, e.text])).toEqual([
      ['scene_heading', 'INT. VAULT - NIGHT'],
      ['action', 'Water pours in.'],
      ['character', 'MARA'],
      ['parenthetical', '(quietly)'],
      ['dialogue', 'We go now.'],
      ['transition', 'CUT TO:'],
    ]);
  });
});

describe('the script’s elements, as the scene’s lines', () => {
  it('reads lines as elements and writes them back unchanged', () => {
    const { p, sceneId } = setup();
    const mara = characterNamed(p, 'Mara')!.id;
    const a = addLine(p, sceneId, 'action');
    let q = updateLine(a.project, a.id, { text: 'She wades in.' });
    const d = addLine(q, sceneId, 'dialogue', a.id, mara);
    q = updateLine(d.project, d.id, { text: 'Hold the light.', direction: 'whispering', extension: '(O.S.)' });
    const elements = toElements(q, sceneId);
    expect(elements.map((e) => [e.type, e.text])).toEqual([
      ['action', 'She wades in.'],
      ['character', 'Mara (O.S.)'],
      ['parenthetical', '(whispering)'],
      ['dialogue', 'Hold the light.'],
    ]);
    expect(fromElements(q, sceneId, elements)).toBe(q);
  });

  it('keeps a line’s identity as it is re-typed, and splits a speech at a parenthetical in the middle', () => {
    const { p, sceneId } = setup();
    const a = addLine(p, sceneId, 'action');
    const els: ScriptElement[] = [
      { id: a.id, type: 'character', text: 'MARA (V.O.)' },
      { id: 'line_x', type: 'dialogue', text: 'Down here.' },
      { id: 'line_y', type: 'parenthetical', text: '(beat)' },
      { id: 'line_z', type: 'dialogue', text: 'Hurry.' },
    ];
    const next = fromElements(a.project, sceneId, els);
    const lines = sceneLines(next, sceneId);
    expect(lines.map((l) => [l.id, l.kind, l.text, l.direction, l.extension, !!l.joined])).toEqual([
      [a.id, 'dialogue', 'Down here.', '', '(V.O.)', false],
      ['line_y', 'dialogue', 'Hurry.', 'beat', '(V.O.)', true],
    ]);
    expect(lines.every((l) => l.speakerId === characterNamed(p, 'Mara')!.id)).toBe(true);
    // And back: the second line carries on under the same cue.
    expect(toElements(next, sceneId).map((e) => e.type)).toEqual(['character', 'dialogue', 'parenthetical', 'dialogue']);
  });

  it('leaves a name nobody has as typed until the cue is left, then makes them', () => {
    const { p, sceneId } = setup();
    const a = addLine(p, sceneId, 'action');
    const typed = fromElements(a.project, sceneId, [
      { id: a.id, type: 'character', text: 'old ferryman' },
      { id: 'line_t', type: 'dialogue', text: 'Mind the water.' },
    ]);
    expect(sceneLines(typed, sceneId)[0]).toMatchObject({ speakerId: null, cue: 'old ferryman' });
    expect(characterNamed(typed, 'old ferryman')).toBeUndefined();
    const left = resolveCue(typed, a.id);
    const him = characterNamed(left, 'Old Ferryman')!;
    expect(sceneLines(left, sceneId)[0]).toMatchObject({ speakerId: him.id });
    expect(sceneLines(left, sceneId)[0]!.cue).toBeUndefined();
    expect(inScene(left, sceneId, him.id)).toBe(true);
  });

  it('offers the scene’s cast before the rest of the project', () => {
    const { p, sceneId } = setup();
    expect(cueNames(p, sceneId)).toEqual(['MARA', 'JONAH']);
  });
});
