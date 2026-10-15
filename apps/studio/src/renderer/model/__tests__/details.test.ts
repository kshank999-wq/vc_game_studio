import { sunkenVault } from '../sample';
import { describe, expect, it } from 'vitest';
import { spineLane } from '../layout';
import { addLane, createProject, placeNew } from '../project';
import { addElement, addLine, updateLine, useInScene } from '../scene';
import {
  addInteraction,
  describeInteraction,
  interactionsOf,
  sceneUse,
  setField,
  setSceneUse,
  setStates,
  settersOf,
  statesOf,
  toggleTag,
  updateInteraction,
  whereUsed,
} from '../details';
import { viewCount, viewGroups, voProgress } from '../bible';
import { REPORTS, buildReport } from '../reports';
import { findIssues } from '../validate';
import type { Project } from '../types';

const vault = () => {
  let p = createProject('The Sunken Vault');
  const placed = placeNew(p, 'scene', spineLane(p).id, 400)!;
  const scene = placed.id;
  p = placed.project;
  const add = (type: Parameters<typeof addElement>[2], name: string) => {
    const r = addElement(p, scene, type, name)!;
    p = r.project;
    return r.id;
  };
  const mara = add('character', 'Mara');
  const lever = add('object', 'Rusted Lever');
  const drains = add('trigger', 'Seam drains');
  const solved = add('state', 'door_solved');
  const line = addLine(p, scene, 'dialogue', undefined, mara);
  p = updateLine(line.project, line.id, { text: 'There’s a lever somewhere.' });
  return { p: p as Project, scene, mara, lever, drains, solved };
};

describe('element detail', () => {
  it('gives an object states and interactions that read as a sentence', () => {
    let { p, lever, drains, solved } = vault();
    p = setStates(p, lever, ['down', 'up']);
    p = addInteraction(p, lever);
    const i = interactionsOf(p.objects[lever])[0]!;
    p = updateInteraction(p, lever, i.id, { verb: 'Pull', fires: drains, setsFlag: solved, flagValue: 'yes' });
    expect(statesOf(p.objects[lever])).toEqual(['down', 'up']);
    expect(describeInteraction(p, interactionsOf(p.objects[lever])[0]!)).toBe('Pull · only when down · becomes up · sets door_solved = yes · fires Seam drains');
    expect(settersOf(p, solved).map((o) => o.name)).toEqual(['Rusted Lever']);
  });

  it('drops a state an interaction used when the state is removed', () => {
    let { p, lever } = vault();
    p = setStates(p, lever, ['down', 'up']);
    p = addInteraction(p, lever);
    p = setStates(p, lever, ['down']);
    expect(interactionsOf(p.objects[lever])[0]).not.toHaveProperty('becomes');
  });

  it('warns about a state that nothing sets, until something does', () => {
    let { p, lever, solved } = vault();
    expect(findIssues(p).map((i) => i.id)).toContain(solved);
    p = addInteraction(p, lever);
    p = updateInteraction(p, lever, interactionsOf(p.objects[lever])[0]!.id, { setsFlag: solved });
    expect(findIssues(p).map((i) => i.id)).not.toContain(solved);
  });

  it('keeps what a character does in one scene on that scene, not on the character', () => {
    let { p, scene, mara } = vault();
    const other = placeNew(p, 'scene', spineLane(p).id, 800)!;
    p = useInScene(other.project, other.id, mara);
    p = setSceneUse(p, scene, mara, 'behaviour', 'Leads if trust ≥ 1');
    expect(sceneUse(p, scene, mara)).toEqual({ behaviour: 'Leads if trust ≥ 1' });
    expect(sceneUse(p, other.id, mara)).toEqual({});
    expect(p.objects[mara]!.data).not.toHaveProperty('behaviour');
  });

  it('lists everywhere an element is used', () => {
    let { p, scene, mara } = vault();
    p = setSceneUse(p, scene, mara, 'behaviour', 'Lead');
    const lane = addLane(p, 'character');
    p = lane.project;
    const uses = whereUsed(p, mara);
    expect(uses).toEqual([expect.objectContaining({ label: 'SC-01 New scene', detail: 'present · 1 line · behaviour: Lead', to: { kind: 'scene', sceneId: scene, mode: 'exploded' } })]);
  });
});

describe('the Game Bible', () => {
  it('groups characters by role and finds things by any field', () => {
    let { p, mara } = vault();
    p = setField(p, mara, 'role', 'Main');
    const groups = viewGroups(p, 'characters');
    expect(groups.map((g) => [g.label, g.entries.length])).toEqual([['Main', 1]]);
    expect(viewGroups(p, 'all', 'seam').flatMap((g) => g.entries.map((e) => e.id))).toHaveLength(1);
    expect(viewCount(p, 'logic')).toBe(2);
  });

  it('lists dialogue by speaker, with VO progress', () => {
    const { p } = vault();
    const groups = viewGroups(p, 'dialogue');
    expect(groups.map((g) => g.label)).toEqual(['Mara']);
    expect(voProgress(p.lines)).toEqual({ recorded: 0, total: 1 });
  });

  it('collects production requirements by tag', () => {
    let { p, lever } = vault();
    p = toggleTag(p, lever, 'Animation');
    p = toggleTag(p, lever, 'Audio');
    expect(viewGroups(p, 'production').map((g) => g.label)).toEqual(['Animation', 'Audio']);
    p = toggleTag(p, lever, 'Audio');
    expect(viewGroups(p, 'production').map((g) => g.label)).toEqual(['Animation']);
  });

  it('builds every production report from the project as it stands', () => {
    const { p } = vault();
    for (const r of REPORTS) {
      const report = buildReport(p, r.key);
      expect(report.title).toBe(r.label);
      expect(report.blocks.length).toBeGreaterThan(0);
    }
    const vo = buildReport(p, 'voByScene');
    // Each line's subtitle, as the engines get it, and how long it shows (no take: the time to read it).
    expect(vo.blocks).toContainEqual({ kind: 'table', columns: ['#', 'Speaker', 'Line', 'Direction', 'VO', 'Subtitle'], rows: [['1', 'Mara', 'There’s a lever somewhere.', '', 'to record', 'Mara: There’s a lever somewhere. (2.6s)']] });
    // The character sheets: each one's subtitles, and their time on screen.
    const sheets = buildReport(p, 'characters').blocks;
    expect(sheets).toContainEqual({ kind: 'table', columns: ['Scene', '#', 'Subtitle', 'Shows for'], rows: [['SC-01', '1', 'Mara: There’s a lever somewhere.', '2.6s']] });
    const maraKv = sheets.find((b) => b.kind === 'kv' && b.rows.some(([k]) => k === 'Subtitles'));
    expect(maraKv && maraKv.kind === 'kv' && maraKv.rows.find(([k]) => k === 'Subtitles')![1]).toBe('1 line · 2.6s on screen');
    // The scene breakdowns: each scene's subtitles in the order it says them, and their time on screen.
    const breakdown = buildReport(p, 'scenes').blocks;
    expect(breakdown).toContainEqual({ kind: 'table', columns: ['#', 'Subtitle', 'Shows for'], rows: [['1', 'Mara: There’s a lever somewhere.', '2.6s']] });
    const contents = breakdown.find((b) => b.kind === 'table' && b.columns[0] === 'Category');
    expect(contents && contents.kind === 'table' && contents.rows.find((r) => r[0] === 'Dialogue')).toEqual(['Dialogue', '1 line · subtitles 2.6s on screen']);
    const sampleScenes = buildReport(sunkenVault(), 'scenes').blocks.filter((b) => b.kind === 'table' && b.columns[1] === 'Subtitle');
    expect(sampleScenes.flatMap((b) => (b.kind === 'table' ? b.rows : [])).find((r) => r[1]?.startsWith('Mara: Water’s'))).toEqual(['2', 'Mara: Water’s holding it shut. There’s a lever somewhere.', '2.5s (take)']);
    // The location reports: what is said there, from every scene set there.
    const places = buildReport(sunkenVault(), 'locations').blocks;
    const chamber = places.find((b) => b.kind === 'table' && b.columns[2] === 'Subtitle');
    expect(chamber && chamber.kind === 'table' && chamber.rows.map((r) => r[2])).toEqual([
      'Mara: Water’s holding it shut. There’s a lever somewhere.',
      'The Explorer: Stand back. I’ll find it.',
      'Mara: Not like that.',
    ]);
    const chamberKv = places.find((b) => b.kind === 'kv' && b.rows.some(([k]) => k === 'Subtitles'));
    expect(chamberKv && chamberKv.kind === 'kv' && chamberKv.rows.find(([k]) => k === 'Subtitles')![1]).toBe('3 lines · 5.4s on screen');
    // The cinematics report: what is said over each, its voiceovers as the engines subtitle them, flagged when longer than it runs.
    const withVo = (() => {
      const q = sunkenVault();
      const cine = Object.values(q.objects).find((o) => o.type === 'cinematic' && o.name === 'The Vault Opens')!;
      const line = q.lines.find((l) => l.text.startsWith('Water’s holding'))!;
      return { q: { ...q, lines: q.lines.map((l) => (l.id === line.id ? { ...l, voiceFrom: cine.id } : l)) }, cine };
    })();
    const cineBlocks = buildReport(withVo.q, 'cinematics').blocks;
    const cineTable = cineBlocks.find((b) => b.kind === 'table' && b.columns[2] === 'Subtitle');
    expect(cineTable && cineTable.kind === 'table' && cineTable.rows).toEqual([['SC-03', '2', 'Mara (V.O., The Vault Opens): Water’s holding it shut. There’s a lever somewhere.', '2.5s (take)']]);
    // The sample: Door in the dark's shot carries Mara's line.
    const sampleCine = buildReport(sunkenVault(), 'cinematics').blocks;
    expect(sampleCine).toContainEqual({ kind: 'table', columns: ['Scene', '#', 'Subtitle', 'Shows for'], rows: [['SC-03', '2', 'Mara: Water’s holding it shut. There’s a lever somewhere.', '2.5s (take)']] });
    // Every line over Door in the dark (7.5s): 9.6s of subtitles, flagged.
    const crowded = (() => {
      const q = sunkenVault();
      const door = Object.values(q.objects).find((o) => o.type === 'cinematic' && o.name === 'Door in the dark')!;
      return { ...q, lines: q.lines.map((l) => (l.kind === 'dialogue' ? { ...l, voiceFrom: door.id } : l)) };
    })();
    const doorKv = buildReport(crowded, 'cinematics').blocks.find((b) => b.kind === 'kv' && b.rows.some(([k, v]) => k === 'Subtitles' && v.includes('longer')));
    expect(doorKv && doorKv.kind === 'kv' && doorKv.rows.find(([k]) => k === 'Subtitles')![1]).toBe('6 lines · 9.6s on screen — longer than its 7.5s');
    // Recorded lines show for their take's length, and say so.
    const sample = buildReport(sunkenVault(), 'characters').blocks.find((b) => b.kind === 'table' && b.columns[2] === 'Subtitle');
    expect(sample && sample.kind === 'table' && sample.rows[0]).toEqual(['SC-01', '2', 'Mara: Lit. You go first.', '1.5s (take)']);
    const byCharacter = buildReport(p, 'voByCharacter').blocks.find((b) => b.kind === 'table');
    expect(byCharacter && byCharacter.kind === 'table' && byCharacter.columns.at(-1)).toBe('Subtitle');
  });
});
