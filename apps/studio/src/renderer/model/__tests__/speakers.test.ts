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
