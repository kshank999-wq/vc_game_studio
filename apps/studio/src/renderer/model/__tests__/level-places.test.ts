import { describe, expect, it } from 'vitest';
import { buildIR } from '../handoff/ir';
import { removeItems } from '../level/level';
import { eventsAt, placeOf, placeToOf } from '../level/places';
import { sunkenVault } from '../sample';
import { sceneTimeline, updateEvent } from '../timeline';
import type { Project } from '../types';

const sample = () => {
  const project = sunkenVault();
  const item = (name: string) => project.levels!.items.find((i) => i.name === name)!;
  const scene = (code: string) => Object.values(project.objects).find((o) => o.type === 'scene' && o.data.code === code)!;
  const events = (p: Project, sceneId: string) => sceneTimeline(p, sceneId).flatMap((t) => t.events);
  return { project, item, scene, events };
};

describe('timeline events in the level', () => {
  it('find their place through the level’s links: a cinematic at its trigger, dialogue at its speaker', () => {
    const { project, item, events } = sample();
    const all = Object.values(project.objects).filter((o) => o.type === 'scene').flatMap((s) => events(project, s.id));
    const cinematic = all.find((e) => e.kind === 'cinematic' && project.objects[e.refId!]?.name === 'Door in the dark')!;
    expect(placeOf(project, cinematic)).toMatchObject({ how: 'link', item: { name: 'Door in the dark trigger' } });
    const maraId = Object.values(project.objects).find((o) => o.type === 'character' && o.name === 'Mara')!.id;
    const line = all.find((e) => e.kind === 'dialogue' && project.lines.find((l) => l.id === e.refId)?.speakerId === maraId)!;
    expect(placeOf(project, line)).toMatchObject({ how: 'link', item: { name: 'Mara' } });
    expect(eventsAt(project, item('Door in the dark trigger').id).map((u) => u.how)).toContain('link');
  });

  it('take a place set on the event, and where an actor moves to, and export both', () => {
    const { project, item, scene, events } = sample();
    const sc = scene('SC-03');
    const action = events(project, sc.id).find((e) => e.kind !== 'dialogue' && e.kind !== 'choice')!;
    let p = updateEvent(project, sc.id, action.id, { place: item('Rusted Lever').id, placeTo: item('Vault Chamber').id });
    const placed = events(p, sc.id).find((e) => e.id === action.id)!;
    expect(placeOf(p, placed)).toMatchObject({ how: 'set', item: { name: 'Rusted Lever' } });
    expect(placeToOf(p, placed)?.name).toBe('Vault Chamber');
    expect(eventsAt(p, item('Vault Chamber').id)).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'to', how: 'set' })]));
    const ir = buildIR(p).scenes.find((s) => s.code === 'SC-03')!;
    const exported = [...ir.main, ...ir.branches.flatMap((b) => b.events)].find((e) => e.place === item('Rusted Lever').id)!;
    expect(exported.placeTo).toBe(item('Vault Chamber').id);
    // Removing the item takes the place off the event.
    p = removeItems(p, [item('Rusted Lever').id]);
    expect(p.events.find((e) => e.id === action.id)!.place).toBeUndefined();
    expect(p.events.find((e) => e.id === action.id)!.placeTo).toBe(item('Vault Chamber').id);
  });
});
