import { describe, expect, it } from 'vitest';
import { spineLane } from '../layout';
import { createProject, makeObject, placeNew } from '../project';
import { addElement, addLine, characterNamed, inScene, linesOf, setSpeakerByName, speakerSuggestions } from '../scene';

const setup = () => {
  let p = createProject('Vault');
  const scene = placeNew(p, 'scene', spineLane(p).id, 400)!;
  p = addElement(scene.project, scene.id, 'character', 'Marcus')!.project;
  const mara = makeObject('character', 'Mara', new Date().toISOString());
  const old = makeObject('character', 'Old Mara', new Date().toISOString());
  p = { ...p, objects: { ...p.objects, [mara.id]: mara, [old.id]: old } };
  return { p, sceneId: scene.id };
};

describe('speakers typed in the script', () => {
  it('suggest names that start with what is typed, the scene’s cast first, then names with a word starting with it', () => {
    const { p, sceneId } = setup();
    expect(speakerSuggestions(p, sceneId, 'ma').map((o) => o.name)).toEqual(['Marcus', 'Mara', 'Old Mara']);
    expect(speakerSuggestions(p, sceneId, 'OLD').map((o) => o.name)).toEqual(['Old Mara']);
    expect(speakerSuggestions(p, sceneId, '')).toEqual([]);
  });

  it('take an existing character whatever the case, or make a new one who joins the scene', () => {
    const { p, sceneId } = setup();
    const line = addLine(p, sceneId, 'dialogue');
    let r = setSpeakerByName(line.project, line.id, 'MARA');
    expect(r).toMatchObject({ created: false, speakerId: characterNamed(p, 'mara')!.id });
    // Taking her line brings Mara into the scene.
    expect(inScene(r.project, sceneId, r.speakerId!)).toBe(true);
    r = setSpeakerByName(r.project, line.id, 'OLD FERRYMAN');
    expect(r.created).toBe(true);
    expect(r.project.objects[r.speakerId!]!.name).toBe('Old Ferryman');
    expect(inScene(r.project, sceneId, r.speakerId!)).toBe(true);
    expect(linesOf(r.project, sceneId, r.speakerId!).map((l) => l.id)).toEqual([line.id]);
    // Mixed case is kept as written.
    const mc = setSpeakerByName(r.project, line.id, 'McAllister');
    expect(mc.project.objects[mc.speakerId!]!.name).toBe('McAllister');
  });
});

describe('scene headings and transitions', () => {
  it('read a heading in its usual forms', async () => {
    const { parseHeading } = await import('../scene');
    expect(parseHeading('INT. VAULT CHAMBER — NIGHT')).toEqual({ intExt: 'INT.', place: 'VAULT CHAMBER', time: 'NIGHT' });
    expect(parseHeading('ext lighthouse - dusk')).toEqual({ intExt: 'EXT.', place: 'lighthouse', time: 'DUSK' });
    expect(parseHeading('INT./EXT. CAR – MOVING')).toEqual({ intExt: 'INT./EXT.', place: 'CAR', time: 'MOVING' });
    expect(parseHeading('I/E SEA-SIDE HUT')).toEqual({ intExt: 'INT./EXT.', place: 'SEA-SIDE HUT' });
  });

  it('set the scene’s place and time, making a new place when the heading names one', async () => {
    const { sceneHeading, setSceneHeading, elementsIn } = await import('../scene');
    const { p, sceneId } = setup();
    const q = setSceneHeading(p, sceneId, 'ext. lighthouse cliff - dusk');
    expect(sceneHeading(q, sceneId)).toBe('EXT. LIGHTHOUSE CLIFF — DUSK');
    expect(elementsIn(q, sceneId, 'environment').map((o) => o.name)).toEqual(['Lighthouse Cliff']);
    // The same place again is the same place.
    const r = setSceneHeading(q, sceneId, 'INT. LIGHTHOUSE CLIFF — NIGHT');
    expect(Object.values(r.objects).filter((o) => o.type === 'environment')).toHaveLength(1);
    expect(sceneHeading(r, sceneId)).toBe('INT. LIGHTHOUSE CLIFF — NIGHT');
  });

  it('know a transition typed as action', async () => {
    const { looksLikeTransition, transitionSuggestions } = await import('../scene');
    expect(['CUT TO:', 'SMASH CUT TO:', 'FADE OUT.', 'Cut to:', 'She turns.'].map(looksLikeTransition)).toEqual([true, true, true, false, false]);
    expect(transitionSuggestions('fade')).toEqual(['FADE TO BLACK.', 'FADE OUT.', 'FADE IN:']);
  });
});
