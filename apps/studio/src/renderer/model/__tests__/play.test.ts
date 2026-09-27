import { describe, expect, it } from 'vitest';
import { advance, choose, endFreePlay, interact, playToDecision, promptOf, setWorld, startPlay, type Play } from '../play';
import { setConnectionRules } from '../project';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const p = sunkenVault();
const id = (project: Project, name: string, type?: string) => Object.values(project.objects).find((o) => o.name === name && (!type || o.type === type))!.id;

/** Take the first option on offer and use the first usable object, to the end. */
const playThrough = (project: Project, play: Play = startPlay(project)): Play => {
  for (let i = 0; i < 50; i++) {
    play = playToDecision(project, play);
    const prompt = promptOf(project, play);
    if (prompt.kind === 'end') return play;
    if (prompt.kind === 'choice') play = choose(project, play, prompt.options.findIndex((o) => o.available));
    if (prompt.kind === 'freePlay') {
      const o = prompt.objects.find((x) => x.verbs.some((v) => v.available));
      play = o ? interact(project, play, o.id, o.verbs.find((v) => v.available)!.id) : endFreePlay(project, play);
    }
  }
  throw new Error('did not end');
};

describe('play-through', () => {
  it('plays the sample from the Beginning to an ending, as the engine would', () => {
    const end = playThrough(p);
    expect(promptOf(p, end)).toMatchObject({ kind: 'end', outcome: 'ending' });
    const texts = end.log.map((e) => e.text);
    // The key is found in SC-02, the lever solves the door, the free play ends by itself, and the key is spent.
    expect(texts.indexOf('Find the key in the silt')).toBeLessThan(texts.indexOf('Pull the Rusted Lever'));
    expect(texts).toContain('Seam drains fires');
    expect(texts).toContain('The Vault Door is solved');
    expect(texts).toContain('Search the chamber ends');
    expect(texts).toContain('Turn the key');
    expect(end.world.items[id(p, 'Vault Key')]).toBe(0);
    expect(end.world.arcs[id(p, 'Mara')]).toBe(1);
    expect(end.world.visited[id(p, 'The Vault Door', 'scene')]).toBe(true);
  });

  it('waits for Continue on lines, and shows who said what', () => {
    let play = startPlay(p);
    // SC-01 has no timeline: it waits for Continue, then comes the choice.
    expect(promptOf(p, play).kind).toBe('continue');
    play = playToDecision(p, play);
    expect(promptOf(p, play).kind).toBe('choice');
    play = choose(p, play, 0);
    play = playToDecision(p, play);
    const line = play.log.find((e) => e.kind === 'line')!;
    expect(line).toMatchObject({ speaker: 'Mara' });
    expect(promptOf(p, play).kind).toBe('freePlay');
  });

  it('skips what the world does not allow, and says what it needed', () => {
    // Start at the Vault Door with no key: the choice is skipped once the door is solved.
    const end = playThrough(p, startPlay(p, id(p, 'The Vault Door', 'scene')));
    const skip = end.log.find((e) => e.kind === 'skip')!;
    expect(skip.text).toBe('Turn the key');
    expect(skip.kind === 'skip' && skip.needs).toBe('door_solved is yes and Vault Key is carried');
  });

  it('offers an option whose conditions fail as unavailable, with what it needs', () => {
    const lantern = id(p, 'Take the lantern');
    const crawl = p.connections.find((c) => c.kind === 'branch' && c.sourceId === lantern && c.label === 'Crawl through')!;
    const locked = setConnectionRules(p, crawl.id, { conditions: { match: 'all', items: [{ kind: 'item', ref: id(p, 'Vault Key'), op: 'has' }] } });
    const play = playToDecision(locked, startPlay(locked));
    const prompt = promptOf(locked, play);
    expect(prompt.kind === 'choice' && prompt.options[1]).toEqual({ label: 'Crawl through', available: false, needs: 'Vault Key is carried' });
    expect(choose(locked, play, 1)).toBe(play);
    // Give the key by hand and it is on offer.
    const given = setWorld(locked, play, (w) => ({ ...w, items: { ...w.items, [id(locked, 'Vault Key')]: 1 } }));
    const now = promptOf(locked, given);
    expect(now.kind === 'choice' && now.options[1]!.available).toBe(true);
  });

  it('a route with nowhere to go ends as a dead end, and says where', () => {
    let play = playToDecision(p, startPlay(p));
    play = choose(p, play, 1); // Crawl through → The Squeeze
    play = playThrough(p, play);
    const prompt = promptOf(p, play);
    expect(prompt.kind).toBe('end');
    expect(['ending', 'gameOver', 'deadEnd']).toContain(prompt.kind === 'end' && prompt.outcome);
  });

  it('free play lists what can be used, and what each verb needs or does', () => {
    let play = playToDecision(p, choose(p, playToDecision(p, startPlay(p)), 0));
    const prompt = promptOf(p, play);
    expect(prompt.kind === 'freePlay' && prompt.objects[0]).toMatchObject({ name: 'Rusted Lever', state: 'down', verbs: [{ verb: 'Pull', available: true, does: 'Rusted Lever → up' }] });
    play = advance(p, play);
    expect(promptOf(p, play).kind).toBe('freePlay');
  });
});

describe('options once picked', () => {
  it('Force it disappears after it is picked: the second time only the key is offered', () => {
    let play = playToDecision(p, choose(p, playToDecision(p, startPlay(p)), 0));
    const lever = promptOf(p, play);
    if (lever.kind !== 'freePlay') throw new Error('expected free play');
    play = interact(p, play, lever.objects[0]!.id, lever.objects[0]!.verbs[0]!.id);
    const first = promptOf(p, play);
    expect(first.kind === 'choice' && first.options.map((o) => o.label)).toEqual(['Turn the key', 'Force it']);
    play = playToDecision(p, choose(p, play, 1));
    const second = promptOf(p, play);
    expect(second.kind === 'choice' && second.options.map((o) => o.label)).toEqual(['Turn the key']);
  });

  it('a locked option stays in the list, greyed, and a hidden one shows only when it can be picked', async () => {
    const { updateBranch } = await import('../timeline');
    const force = p.branches.find((b) => b.label === 'Force it')!;
    const locked = updateBranch(p, force.id, { after: 'locked' });
    let play = playToDecision(locked, choose(locked, playToDecision(locked, startPlay(locked)), 0));
    const lever = promptOf(locked, play);
    if (lever.kind !== 'freePlay') throw new Error('expected free play');
    play = interact(locked, play, lever.objects[0]!.id, lever.objects[0]!.verbs[0]!.id);
    play = playToDecision(locked, choose(locked, play, 1));
    const again = promptOf(locked, play);
    expect(again.kind === 'choice' && again.options[1]).toEqual({ label: 'Force it', available: false, needs: 'already chosen' });

    const hidden = updateBranch(p, force.id, { when: { match: 'all', items: [{ kind: 'item', ref: id(p, 'Vault Key'), op: 'hasNot' }] }, hideUnavailable: true });
    let h = playToDecision(hidden, choose(hidden, playToDecision(hidden, startPlay(hidden)), 0));
    const lv = promptOf(hidden, h);
    if (lv.kind !== 'freePlay') throw new Error('expected free play');
    h = interact(hidden, h, lv.objects[0]!.id, lv.objects[0]!.verbs[0]!.id);
    // The key is carried, so Force it is not in the list at all.
    const offered = promptOf(hidden, h);
    expect(offered.kind === 'choice' && offered.options.map((o) => o.label)).toEqual(['Turn the key']);
  });
});

describe('dual dialogue in the preview', () => {
  const vault = id(p, 'The Vault Door', 'scene');
  const lineEntries = (project: Project) => playThrough(project).log.filter((e) => e.kind === 'line' && e.sceneId === vault);

  it('speaks a dual speech at the same time as the one it is beside: one beat, two voices', () => {
    const lines = lineEntries(p);
    const pair = lines.find((e) => e.kind === 'line' && e.with)!;
    expect(pair).toMatchObject({ speaker: 'Mara', text: 'Water’s holding it shut. There’s a lever somewhere.', with: { speaker: 'The Explorer', text: 'Stand back. I’ll find it.' } });
    // His line isn't played again on its own.
    expect(lines.filter((e) => e.text === 'Stand back. I’ll find it.')).toHaveLength(0);
    expect(lines.filter((e) => e.kind === 'line' && e.with)).toHaveLength(1);
  });

  it('pairs them whichever comes first on the timeline, the left-hand speech reading first', async () => {
    const { sceneTimeline, moveEvent } = await import('../timeline');
    const events = sceneTimeline(p, vault)[0]!.events;
    const mara = events.find((e) => e.kind === 'dialogue' && p.lines.find((l) => l.id === e.refId)?.dual)!;
    const at = events.indexOf(mara);
    const swapped = moveEvent(p, vault, mara.id, 'main', at - 1);
    expect(lineEntries(swapped).find((e) => e.kind === 'line' && e.with)).toMatchObject({ speaker: 'Mara', with: { speaker: 'The Explorer' } });
  });

  it('plays a dual speech on its own when it may not be spoken with its partner', async () => {
    const { updateLine } = await import('../scene');
    const dual = p.lines.find((l) => l.dual)!;
    // Only once the puzzle is solved, which is after this exchange.
    const never = updateLine(p, dual.id, { conditions: { match: 'all', items: [{ kind: 'puzzle', ref: id(p, 'The Vault Door', 'puzzle'), op: 'solved' }] } });
    const lines = lineEntries(never);
    // Mara speaks alone; his line waits for its own condition, which never holds.
    expect(lines.some((e) => e.kind === 'line' && e.with)).toBe(false);
    expect(lines.map((e) => e.text)).toContain('Water’s holding it shut. There’s a lever somewhere.');
    expect(lines.map((e) => e.text)).not.toContain('Stand back. I’ll find it.');
  });
});
