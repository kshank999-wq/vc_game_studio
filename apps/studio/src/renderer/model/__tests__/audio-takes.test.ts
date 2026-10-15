import { describe, expect, it } from 'vitest';
import { attachTake, detachTake, getAudio, isAudioFile, matchTakes, putAudio, storeTake, takeExt, takeFiles, takeSummary } from '../audio-takes';
import { crc32, zip } from '../handoff/zip';
import { spineLane } from '../layout';
import { createProject, placeNew } from '../project';
import { addElement, sceneLines, setSceneHeading, updateLine } from '../scene';
import { fromElements, toElements } from '../script-elements';
import { lineKey } from '../script-export';
import type { AudioTake, Project } from '../types';

/** SC-03: Mara and Jonah, two lines to record. */
const setup = () => {
  let p: Project = createProject('Takes');
  const placed = placeNew(p, 'scene', spineLane(p).id, 400)!;
  const scene = placed.id;
  p = placed.project;
  p = { ...p, objects: { ...p.objects, [scene]: { ...p.objects[scene]!, data: { ...p.objects[scene]!.data, code: 'SC-03' } } } };
  p = setSceneHeading(p, scene, 'INT. HOTEL — DAY');
  p = addElement(p, scene, 'character', 'Mara')!.project;
  p = addElement(p, scene, 'character', 'Jonah')!.project;
  p = fromElements(p, scene, [
    { id: 'c1', type: 'character', text: 'JONAH' },
    { id: 'd1', type: 'dialogue', text: 'You came.' },
    { id: 'c2', type: 'character', text: 'MARA' },
    { id: 'd2', type: 'dialogue', text: 'I said I would.' },
  ]);
  const [a, b] = sceneLines(p, scene);
  return { p, scene, a: a!, b: b! };
};

const take = (over: Partial<AudioTake> = {}): AudioTake => ({ id: 'take_1', name: 'sc_03_line_01.wav', type: 'audio/wav', bytes: 2_400_000, seconds: 2.5, at: '2026-10-15T00:00:00Z', ...over });

describe('recorded takes', () => {
  it('a take marks its line recorded; taking it off sends it back to be recorded', () => {
    const { p, a } = setup();
    const on = attachTake(p, a.id, take());
    const line = on.lines.find((l) => l.id === a.id)!;
    expect(line.vo).toBe('recorded');
    expect(line.take?.name).toBe('sc_03_line_01.wav');
    const off = detachTake(on, a.id);
    expect(off.lines.find((l) => l.id === a.id)!.take).toBeUndefined();
    expect(off.lines.find((l) => l.id === a.id)!.vo).toBe('todo');
  });

  it('keeps its take while the script is re-typed, and loses it if the line stops being dialogue', () => {
    const { p, scene, a } = setup();
    const on = attachTake(p, a.id, take());
    const retyped = fromElements(on, scene, toElements(on, scene).map((e) => (e.type === 'dialogue' && e.text === 'You came.' ? { ...e, text: 'You came!' } : e)));
    expect(retyped.lines.find((l) => l.id === a.id)!.take?.id).toBe('take_1');
    const action = updateLine(on, a.id, { kind: 'action' });
    expect(action.lines.find((l) => l.id === a.id)!.take).toBeUndefined();
  });

  it('files go to the lines they are named for', () => {
    const { p, a, b } = setup();
    expect(lineKey(p, a)).toBe('sc_03_line_01');
    const files = [{ name: 'SC_03_LINE_02 Mara take 3.wav' }, { name: 'sc_03_line_01.wav' }, { name: 'sc_03_line_011.wav' }, { name: 'room tone.wav' }];
    const { matched, unmatched } = matchTakes(p, files);
    expect(matched.map((m) => [m.file.name, m.lineId])).toEqual([
      ['SC_03_LINE_02 Mara take 3.wav', b.id],
      ['sc_03_line_01.wav', a.id],
    ]);
    expect(unmatched.map((f) => f.name)).toEqual(['sc_03_line_011.wav', 'room tone.wav']);
    // Only among the lines asked for.
    expect(matchTakes(p, files, [a.id]).matched.map((m) => m.lineId)).toEqual([a.id]);
  });

  it('knows audio by its type or its name', () => {
    expect(isAudioFile({ name: 'x.bin', type: 'audio/wav' })).toBe(true);
    expect(isAudioFile({ name: 'line.FLAC', type: '' })).toBe(true);
    expect(isAudioFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
    expect(takeExt({ name: 'take', type: 'audio/mpeg' })).toBe('mp3');
    expect(takeSummary(take())).toBe('2.4 MB · 2.5 s');
    expect(takeSummary(take({ bytes: 4000, seconds: undefined }))).toBe('4 KB');
  });

  it('keeps the audio, and hands the takes over named for their lines', async () => {
    const { p, a, b } = setup();
    const file = new File([new Uint8Array([82, 73, 70, 70])], 'jonah.wav', { type: 'audio/wav' });
    const stored = await storeTake(file);
    expect(stored).toMatchObject({ name: 'jonah.wav', type: 'audio/wav', bytes: 4 });
    expect(await getAudio(stored.id)).toBeTruthy();
    let q = attachTake(p, a.id, stored);
    // Recorded somewhere else: the line says so, the audio isn't here.
    q = attachTake(q, b.id, take({ id: 'take_elsewhere' }));
    const { files, missing } = await takeFiles(q);
    expect(files.map((f) => f.path)).toEqual(['audio/vo/sc_03_line_01.wav']);
    expect([...files[0]!.content]).toEqual([82, 73, 70, 70]);
    expect(missing.map((l) => l.id)).toEqual([b.id]);
    await putAudio('take_elsewhere', new Blob([new Uint8Array([1])]));
    expect((await takeFiles(q)).missing).toEqual([]);
  });

  it('the zip holds the audio as it is', () => {
    const bytes = new Uint8Array([0, 255, 128, 7]);
    const out = zip([{ path: 'audio/vo/a.wav', content: bytes }]);
    const view = new DataView(out.buffer);
    expect(view.getUint32(14, true)).toBe(crc32(bytes));
    expect([...out.slice(30 + 'audio/vo/a.wav'.length, 30 + 'audio/vo/a.wav'.length + 4)]).toEqual([0, 255, 128, 7]);
  });
});
