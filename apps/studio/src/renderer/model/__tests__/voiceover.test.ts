import { describe, expect, it } from 'vitest';
import { buildIR } from '../handoff/ir';
import { planHandoff, setTarget } from '../handoff';
import { advance, startPlay } from '../play';
import { createProject, placeNew, removeObject } from '../project';
import { spineLane } from '../layout';
import { addElement, addLine, addVoiceover, cueLabel, inScene, isTied, removeFromScene, voiceOf } from '../scene';
import { fromElements, toElements } from '../script-elements';
import { sunkenVault } from '../sample';
import { addEvent, eventTitle, sceneTimeline } from '../timeline';
import { findIssues as validateProject } from '../validate';
import type { Project } from '../types';

/** A scene with Mara in it, and a radio. */
const setup = () => {
  let p: Project = createProject('Test');
  const placed = placeNew(p, 'scene', spineLane(p).id, 400)!;
  const scene = placed.id;
  p = placed.project;
  const empty = p;
  const mara = addElement(p, scene, 'character', 'Mara')!;
  p = mara.project;
  const radio = addElement(p, scene, 'object', 'Radio')!;
  p = radio.project;
  return { p, empty, scene, mara: mara.id, radio: radio.id };
};

describe('dialogue is always somebody’s', () => {
  it('can’t be added to a scene with nobody in it, from the palette or the timeline', () => {
    const { empty, scene } = setup();
    expect(addElement(empty, scene, 'dialogue')).toBeNull();
    expect(addEvent(empty, scene, 'dialogue')).toBeNull();
  });

  it('a character’s line is tied to them; one with no speaker is flagged', () => {
    const { p, scene, mara } = setup();
    const said = addLine(p, scene, 'dialogue', undefined, mara);
    expect(isTied(said.project, said.project.lines.find((l) => l.id === said.id)!)).toBe(true);
    const loose = addLine(p, scene, 'dialogue');
    expect(isTied(loose.project, loose.project.lines.find((l) => l.id === loose.id)!)).toBe(false);
    expect(validateProject(loose.project).map((i) => i.message).join(' ')).toMatch(/has no speaker: give it a character, or make it voiceover from a cinematic or an object/);
  });
});

describe('voiceover, from a cinematic or an object', () => {
  it('plays from a radio: marked V.O., tied, listed on the radio, and fine by validation', () => {
    const { p, scene, radio } = setup();
    const vo = addVoiceover(p, scene, radio)!;
    const line = vo.project.lines.find((l) => l.id === vo.id)!;
    expect(line).toMatchObject({ kind: 'dialogue', speakerId: null, voiceFrom: radio, extension: '(V.O.)' });
    expect(isTied(vo.project, line)).toBe(true);
    expect(cueLabel(vo.project, line)).toBe('RADIO (V.O.)');
    expect(voiceOf(vo.project, scene, radio).map((l) => l.id)).toEqual([vo.id]);
    expect(validateProject(vo.project).some((i) => i.id === scene && /speaker|voiceover/.test(i.message))).toBe(false);
    // Only cinematics and objects (and items) play voiceover.
    const scene2 = Object.keys(vo.project.objects).find((id) => vo.project.objects[id]!.type === 'character')!;
    expect(addVoiceover(vo.project, scene, scene2)).toBeNull();
  });

  it('can be a known voice over something: MARA (V.O., RADIO)', () => {
    const { p, scene, mara, radio } = setup();
    const vo = addVoiceover(p, scene, radio, undefined, mara)!;
    expect(cueLabel(vo.project, vo.project.lines.find((l) => l.id === vo.id)!)).toBe('MARA (V.O., RADIO)');
  });

  it('a cinematic plays it too, and the cinematic joins the scene', () => {
    const { p, scene } = setup();
    const cin = addElement(p, scene, 'cinematic', 'The Flood')!;
    const vo = addVoiceover(cin.project, scene, cin.id)!;
    expect(cueLabel(vo.project, vo.project.lines.find((l) => l.id === vo.id)!)).toBe('THE FLOOD (V.O.)');
    expect(inScene(vo.project, scene, cin.id)).toBe(true);
  });

  it('keeps where it plays from through the script editor, and a cue naming the radio is the radio', () => {
    const { p, scene, radio } = setup();
    const vo = addVoiceover(p, scene, radio)!;
    const els = toElements(vo.project, scene);
    expect(els.find((e) => e.type === 'character')!.text).toBe('Radio (V.O.)');
    // Re-typed as it is: unchanged.
    expect(fromElements(vo.project, scene, els)).toBe(vo.project);
    // Typed fresh: RADIO (V.O.) is the radio, not a new character called Radio.
    const typed = fromElements(p, scene, [{ id: 'new1', type: 'character', text: 'RADIO (V.O.)' }, { id: 'new1:text', type: 'dialogue', text: 'Mayday.' }]);
    const line = typed.lines.find((l) => l.id === 'new1')!;
    expect(line.voiceFrom).toBe(radio);
    expect(line.cue).toBeUndefined();
    expect(Object.values(typed.objects).filter((o) => o.type === 'character' && o.name.toLowerCase() === 'radio')).toHaveLength(0);
  });

  it('loses where it plays from when that leaves the scene or is deleted, and validation says so', () => {
    const { p, scene, radio } = setup();
    const vo = addVoiceover(p, scene, radio)!;
    const gone = removeObject(vo.project, radio);
    expect(validateProject(gone).map((i) => i.message).join(' ')).toMatch(/voiceover from something that’s gone/);
    const left = removeFromScene(vo.project, scene, radio);
    expect(left.lines.find((l) => l.id === vo.id)!.voiceFrom).toBeUndefined();
  });

  it('reads as RADIO (V.O.) on the timeline and in the play-through', () => {
    const { p, scene, radio } = setup();
    const vo = addVoiceover(p, scene, radio)!;
    const ev = sceneTimeline(vo.project, scene).flatMap((t) => t.events).find((e) => e.kind === 'dialogue')!;
    expect(eventTitle(vo.project, ev)).toBe('RADIO (V.O.)');
    let s = startPlay(vo.project);
    for (let i = 0; i < 20 && !s.log.some((e) => e.kind === 'line'); i++) s = advance(vo.project, s);
    expect(s.log.find((e) => e.kind === 'line')).toMatchObject({ speaker: 'Radio', from: 'Radio' });
  });

  it('goes to the engines with what it plays from', () => {
    let p = sunkenVault();
    const scene = Object.values(p.objects).find((o) => o.name === 'The Vault Door')!.id;
    const lever = Object.values(p.objects).find((o) => o.name === 'Rusted Lever')!.id;
    p = addVoiceover(p, scene, lever)!.project;
    const line = buildIR(p).lines.find((l) => l.from);
    expect(line).toMatchObject({ speaker: null, from_name: 'Rusted Lever' });
    const godot = planHandoff(p).output!.files;
    expect(godot.find((f) => f.path.endsWith('dialogue_table.gd'))!.content).toContain('"from_name": "Rusted Lever"');
    const unity = planHandoff(setTarget(p, { engine: 'unity' })).output!.files;
    expect(unity.some((f) => String(f.content).includes('D.Str(l, "from_name")'))).toBe(true);
    const unreal = planHandoff(setTarget(p, { engine: 'unreal' })).output!.files;
    expect(unreal.some((f) => String(f.content).includes('---,Scene,Speaker,From,FromName,Text'))).toBe(true);
  });
});
