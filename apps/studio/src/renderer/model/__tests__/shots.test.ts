import { describe, expect, it } from 'vitest';
import { buildIR } from '../handoff/ir';
import { generateGodot } from '../handoff/godot';
import { buildReport } from '../reports';
import { sunkenVault } from '../sample';
import { addShot, cinematicTiming, describeShot, duplicateShot, moveShot, removeShot, runningTime, shotsOf, updateShot } from '../shots';
import { eventDetail, sceneTimeline } from '../timeline';

const p = sunkenVault();
const cin = Object.values(p.objects).find((o) => o.name === 'Door in the dark')!.id;

describe('shot lists', () => {
  it('the sample cinematic is three shots, and its timing comes from them', () => {
    const shots = shotsOf(p.objects[cin]);
    expect(shots.map((s) => s.framing)).toEqual(['Extreme wide', 'Close-up', 'Over the shoulder']);
    expect(runningTime(shots)).toBe(7.5);
    expect(cinematicTiming(p, cin, { seconds: 6, shots: 1 })).toEqual({ seconds: 7.5, shots: 3, fromList: true });
    const scene = Object.values(p.objects).find((o) => o.name === 'The Vault Door' && o.type === 'scene')!.id;
    const event = sceneTimeline(p, scene)[0]!.events.find((e) => e.refId === cin)!;
    expect(eventDetail(p, event)).toBe('7.5s · 3 shots');
  });

  it('adds after a shot (carrying its framing on), duplicates, moves and removes', () => {
    const first = shotsOf(p.objects[cin])[0]!;
    const added = addShot(p, cin, first.id);
    let shots = shotsOf(added.project.objects[cin]);
    expect(shots[1]!.id).toBe(added.shotId);
    expect(shots[1]!.framing).toBe('Extreme wide');
    let q = updateShot(added.project, cin, added.shotId, { framing: 'Insert', seconds: 1 });
    q = moveShot(q, cin, added.shotId, 0);
    expect(shotsOf(q.objects[cin])[0]!.framing).toBe('Insert');
    const dup = duplicateShot(q, cin, added.shotId);
    expect(shotsOf(dup.project.objects[cin])).toHaveLength(5);
    q = removeShot(dup.project, cin, dup.shotId);
    q = removeShot(q, cin, added.shotId);
    shots = shotsOf(q.objects[cin]);
    expect(shots.map((s) => s.id)).toEqual(shotsOf(p.objects[cin]).map((s) => s.id));
    expect(updateShot(q, cin, shots[0]!.id, { framing: shots[0]!.framing })).toBe(q);
  });

  it('reads as words, reports as a table, and goes to the engine', () => {
    const close = shotsOf(p.objects[cin])[1]!;
    expect(describeShot(p, close)).toBe('Close-up · push in · 50mm — Mara — Mara lifts the lantern; the seam weeps. — “Water’s holding it shut. There’s a lever somewhere.”');
    const report = buildReport(p, 'cinematics');
    expect(report.blocks.some((b) => b.kind === 'table' && b.rows.length === 3 && b.rows[1]![1] === 'Close-up · Push in · 50mm')).toBe(true);
    const ir = buildIR(p);
    const shots = ir.cinematics.find((c) => c.name === 'Door in the dark')!.shots!;
    expect(shots[1]).toMatchObject({ framing: 'Close-up', characters: ['mara'], line: 'sc_03_line_02' });
    const tres = generateGodot(ir, 'res://vcgs/generated').files.find((f) => f.path.endsWith('door_in_the_dark.tres'))!.content;
    expect(tres).toContain('shot_list = [');
    expect(tres).toContain('seconds = 7.5');
  });
});
