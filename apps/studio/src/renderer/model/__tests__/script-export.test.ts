import { describe, expect, it } from 'vitest';
import { buildIR } from '../handoff/ir';
import { createProject, placeNew } from '../project';
import { addElement, addVoiceover, sceneLines, setSceneHeading } from '../scene';
import { fromElements, toElements, type ScriptElement } from '../script-elements';
import { beatsOf, moveBeat, projectFountain, recordingCsv, recordingHtml, recordingScript, sceneFountain, scriptHtml, scriptScenes } from '../script-export';
import { moveEvent, sceneTimeline } from '../timeline';
import { sunkenVault } from '../sample';
import { spineLane } from '../layout';
import type { Project } from '../types';

/** INT. HOTEL — DAY: Mara and Jonah, a radio, and a few beats out of order. */
const setup = () => {
  let p: Project = createProject('Hotel Test');
  const placed = placeNew(p, 'scene', spineLane(p).id, 400)!;
  const scene = placed.id;
  p = placed.project;
  p = { ...p, objects: { ...p.objects, [scene]: { ...p.objects[scene]!, data: { ...p.objects[scene]!.data, code: 'S1' } } } };
  p = setSceneHeading(p, scene, 'INT. HOTEL — DAY');
  const mara = addElement(p, scene, 'character', 'Mara')!;
  p = mara.project;
  const jonah = addElement(p, scene, 'character', 'Jonah')!;
  p = jonah.project;
  const radio = addElement(p, scene, 'object', 'Radio')!;
  p = radio.project;
  const els: ScriptElement[] = [
    { id: 'a1', type: 'action', text: 'A lobby gone to seed. MARA waits by the desk.' },
    { id: 'c1', type: 'character', text: 'JONAH' },
    { id: 'd1', type: 'dialogue', text: 'You came.' },
    { id: 'c2', type: 'character', text: 'MARA' },
    { id: 'p2', type: 'parenthetical', text: '(not looking up)' },
    { id: 'd2', type: 'dialogue', text: 'I said I would.' },
    { id: 't1', type: 'transition', text: 'CUT TO:' },
  ];
  p = fromElements(p, scene, els);
  const v = addVoiceover(p, scene, radio.id)!;
  p = v.project;
  const vo = p.lines.find((l) => l.id === v.id)!;
  p = { ...p, lines: p.lines.map((l) => (l.id === vo.id ? { ...l, text: 'Storm warning for the coast.' } : l)) };
  return { p, scene, mara: mara.id, jonah: jonah.id, radio: radio.id };
};

describe('the script, exported', () => {
  it('reads as a screenplay in Fountain: heading, action, cues, parentheticals, transitions', () => {
    const { p, scene } = setup();
    const f = sceneFountain(p, scene);
    expect(f.split('\n\n')[0]).toBe('INT. HOTEL — DAY #S1#');
    expect(f).toContain('A lobby gone to seed. MARA waits by the desk.');
    expect(f).toContain('JONAH\nYou came.');
    expect(f).toContain('MARA\n(not looking up)\nI said I would.');
    expect(f).toContain('CUT TO:');
    expect(f).toContain('RADIO (V.O.)\nStorm warning for the coast.');
    const whole = projectFountain(p);
    expect(whole.startsWith('Title: Hotel Test\n')).toBe(true);
    expect(whole).toContain('===');
  });

  it('forces lines Fountain would misread', () => {
    const { p, scene } = setup();
    const odd = fromElements(p, scene, [{ id: 'x', type: 'action', text: 'INT. is what the sign says' }, ...toElements(p, scene)]);
    expect(sceneFountain(odd, scene)).toContain('!INT. is what the sign says');
  });

  it('prints as a screenplay page, in story order', () => {
    const { p, scene } = setup();
    const html = scriptHtml(p);
    expect(html).toContain('<div class="cue">MARA</div>');
    expect(html).toContain('<div class="paren">(not looking up)</div>');
    expect(html).toContain('INT. HOTEL — DAY');
    expect(scriptScenes(p).map((s) => s.id)).toEqual([scene]);
    const sample = sunkenVault();
    const order = scriptScenes(sample).map((s) => s.id);
    const xs = order.filter((id) => sample.placements[id]).map((id) => sample.placements[id]!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });
});

describe('beats', () => {
  it('a speech is one beat, with its parenthetical and a dual speech beside it', () => {
    const { p, scene } = setup();
    expect(beatsOf(p, scene).map((b) => b.kind)).toEqual(['action', 'dialogue', 'dialogue', 'transition', 'dialogue']);
  });

  it('move into the right order, and the script and the engines follow', () => {
    const { p, scene } = setup();
    const beats = beatsOf(p, scene);
    // Mara speaks first.
    const moved = moveBeat(p, scene, beats[2]!.id, 1);
    expect(beatsOf(moved, scene).map((b) => b.id)).toEqual([beats[0]!.id, beats[2]!.id, beats[1]!.id, beats[3]!.id, beats[4]!.id]);
    expect(sceneLines(moved, scene).map((l) => l.order)).toEqual([1, 2, 3, 4, 5]);
    const f = sceneFountain(moved, scene);
    expect(f.indexOf('I said I would.')).toBeLessThan(f.indexOf('You came.'));
    // The handoff plays the lines in the new order.
    const ir = buildIR(moved);
    const said = [...ir.lines].sort((a, b) => a.order - b.order).map((l) => l.text);
    expect(said.slice(0, 2)).toEqual(['I said I would.', 'You came.']);
    // Nowhere to go: the same project.
    expect(moveBeat(moved, scene, beats[0]!.id, 0)).toBe(moved);
  });

  it('dialogue placed on the timeline by hand keeps its places, in the new order', () => {
    const { p, scene } = setup();
    const main = sceneTimeline(p, scene)[0]!.events;
    // Place the first two lines by hand (stored).
    let q = moveEvent(p, scene, main[1]!.id, 'main', 0);
    q = moveEvent(q, scene, sceneTimeline(q, scene)[0]!.events[1]!.id, 'main', 1);
    const beats = beatsOf(q, scene);
    const moved = moveBeat(q, scene, beats[2]!.id, 1);
    const said = sceneTimeline(moved, scene)[0]!.events.filter((e) => e.kind === 'dialogue').map((e) => moved.lines.find((l) => l.id === e.refId)!.text);
    expect(said.indexOf('I said I would.')).toBeLessThan(said.indexOf('You came.'));
  });

  it('a speech moved off another stands on its own cue (no stray dual dialogue)', () => {
    const { p, scene } = setup();
    const lines = sceneLines(p, scene);
    const dual = { ...p, lines: p.lines.map((l) => (l.id === lines[2]!.id ? { ...l, dual: true } : l)) };
    const beats = beatsOf(dual, scene);
    expect(beats.length).toBe(4);
    // Move the action below the speeches: still one dual beat. Move the dual pair: still a pair.
    const moved = moveBeat(dual, scene, beats[1]!.id, 3);
    expect(beatsOf(moved, scene).find((b) => b.kind === 'dialogue' && b.lines.length === 2)).toBeTruthy();
  });
});

describe('subtitles in the screenplay', () => {
  it('a note under each speech in Fountain, a small line on the page; off unless asked for', () => {
    const { p, scene } = setup();
    const mara = recordingScript(p).scenes[0]!.items.flatMap((i) => (i.kind === 'line' ? [i] : []))[1]!;
    const note = `[[Subtitle · ${mara.subtitleSeconds}s: ${mara.subtitle}]]`;
    expect(sceneFountain(p, scene)).not.toContain('[[Subtitle');
    const fountain = sceneFountain(p, scene, { subtitles: true });
    // Right under the words it subtitles, inside the speech.
    expect(fountain).toContain(`${mara.text}\n${note}`);
    expect(fountain.match(/\[\[Subtitle/g)).toHaveLength(3);
    expect(scriptHtml(p).includes('class="subtitle"')).toBe(false);
    expect(scriptHtml(p, { subtitles: true })).toContain(`<div class="subtitle">Subtitle · ${mara.subtitleSeconds}s: ${mara.subtitle}</div>`);
  });

  it('a subtitle can’t close its Fountain note early', () => {
    const { p, scene } = setup();
    const odd = { ...p, lines: p.lines.map((l) => (l.kind === 'dialogue' && l.text === 'You came.' ? { ...l, text: 'You came]] back.' } : l)) };
    expect(sceneFountain(odd, scene, { subtitles: true })).toMatch(/\[\[Subtitle · [\d.]+s: Jonah: You came\] \] back\.\]\]/);
  });
});

describe('the recording script', () => {
  it('numbers every line in order, with its file name, cue and direction', () => {
    const { p } = setup();
    const r = recordingScript(p);
    expect(r.total).toBe(3);
    const lines = r.scenes[0]!.items.filter((i) => i.kind === 'line');
    expect(lines.map((l) => (l.kind === 'line' ? `${l.take} ${l.cue}` : ''))).toEqual(['1 JONAH', '2 MARA', '3 RADIO (V.O.)']);
    const ir = buildIR(p);
    const keys = [...ir.lines].sort((a, b) => a.order - b.order).map((l) => l.id);
    expect(lines.map((l) => (l.kind === 'line' ? l.key : ''))).toEqual(keys);
    expect(r.scenes[0]!.heading).toBe('INT. HOTEL — DAY');
    expect(r.scenes[0]!.items[0]).toEqual({ kind: 'action', text: 'A lobby gone to seed. MARA waits by the desk.' });
    expect(recordingHtml(r)).toContain('(not looking up)');
    const csv = recordingCsv(r).trim().split('\n');
    expect(csv.length).toBe(4);
    expect(csv[0]).toMatch(/^File,Take,Scene/);
  });

  it('each line has its subtitle, as the engines get it, and how long it shows', () => {
    const { p } = setup();
    const r = recordingScript(p);
    const lines = r.scenes[0]!.items.flatMap((i) => (i.kind === 'line' ? [i] : []));
    const ir = buildIR(p);
    // The same subtitle, and the same time, as the handoff gives each engine.
    for (const l of lines) {
      const handed = ir.lines.find((x) => x.id === l.key)!;
      expect([l.subtitle, l.subtitleSeconds]).toEqual([handed.subtitle, handed.subtitle_seconds]);
    }
    expect(lines[1]!.subtitle).toMatch(/^Mara: /);
    // A voiceover's names where it plays from.
    expect(lines[2]!.subtitle).toMatch(/^Radio \(V\.O\.\): /);
    const html = recordingHtml(r);
    expect(html).toContain(`<b>Subtitle</b> · ${lines[1]!.subtitleSeconds}s: ${lines[1]!.subtitle}`);
    const csv = recordingCsv(r).trim().split('\n');
    expect(csv[0]).toMatch(/,Status,Subtitle,Subtitle seconds$/);
    expect(csv[2]).toContain(`${lines[1]!.subtitle},${lines[1]!.subtitleSeconds}`);
  });

  it('a recorded line’s subtitle shows for its take’s length', () => {
    const sample = sunkenVault();
    const mara = recordingScript(sample).scenes.flatMap((s) => s.items).find((i) => i.kind === 'line' && i.key === 'sc_03_line_02');
    expect(mara && mara.kind === 'line' && [mara.subtitle, mara.subtitleSeconds]).toEqual(['Mara: Water’s holding it shut. There’s a lever somewhere.', 2.5]);
  });

  it('for one actor: only their lines, each with the line before it', () => {
    const { p, mara } = setup();
    const r = recordingScript(p, { characterId: mara });
    expect(r.forName).toBe('Mara');
    const lines = r.scenes[0]!.items;
    expect(lines.length).toBe(1);
    const only = lines[0]!;
    expect(only.kind === 'line' && only.before).toEqual({ cue: 'JONAH', text: 'You came.' });
    expect(r.cast).toEqual([{ voice: 'Mara', lines: 1, words: 4, recorded: 0 }]);
  });

  it('the sample reads out', () => {
    const sample = sunkenVault();
    const r = recordingScript(sample);
    expect(r.total).toBe(sample.lines.filter((l) => l.kind === 'dialogue' && l.text.trim()).length);
    expect(projectFountain(sample)).toContain('INT. ');
  });
});
