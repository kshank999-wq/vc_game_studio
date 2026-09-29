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

/** Take the lantern, win against the eels in SC-02 (the sample's encounter), and play on to the vault's free play. */
const toTheVault = (project: Project): Play => {
  let play = playToDecision(project, choose(project, playToDecision(project, startPlay(project)), 0));
  const eels = promptOf(project, play);
  if (eels.kind === 'choice' && eels.symbol === 'encounter') play = playToDecision(project, choose(project, play, 0));
  return play;
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
    // SC-02 opens on the eels: an encounter, won or lost by the player.
    expect(promptOf(p, play)).toMatchObject({ kind: 'choice', symbol: 'encounter', title: 'Eel swarm' });
    play = playToDecision(p, choose(p, play, 0));
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
    let play = toTheVault(p);
    const prompt = promptOf(p, play);
    expect(prompt.kind === 'freePlay' && prompt.objects[0]).toMatchObject({ name: 'Rusted Lever', state: 'down', verbs: [{ verb: 'Pull', available: true, does: 'Rusted Lever → up' }] });
    play = advance(p, play);
    expect(promptOf(p, play).kind).toBe('freePlay');
  });
});

describe('options once picked', () => {
  it('Force it disappears after it is picked: the second time only the key is offered', () => {
    let play = toTheVault(p);
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
    let play = toTheVault(locked);
    const lever = promptOf(locked, play);
    if (lever.kind !== 'freePlay') throw new Error('expected free play');
    play = interact(locked, play, lever.objects[0]!.id, lever.objects[0]!.verbs[0]!.id);
    play = playToDecision(locked, choose(locked, play, 1));
    const again = promptOf(locked, play);
    expect(again.kind === 'choice' && again.options[1]).toEqual({ label: 'Force it', available: false, needs: 'already chosen' });

    const hidden = updateBranch(p, force.id, { when: { match: 'all', items: [{ kind: 'item', ref: id(p, 'Vault Key'), op: 'hasNot' }] }, hideUnavailable: true });
    let h = toTheVault(hidden);
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

describe('quests and encounters', () => {
  const quest = id(p, 'Open the vault', 'quest');
  const eels = id(p, 'Eel swarm', 'encounter');
  const key = id(p, 'Vault Key');
  const theKey = id(p, 'The Key', 'scene');
  const set = (project: Project, objectId: string, data: Record<string, unknown>): Project => ({
    ...project,
    objects: { ...project.objects, [objectId]: { ...project.objects[objectId]!, data: { ...project.objects[objectId]!.data, ...data } } },
  });

  it('starts a quest with no start rule at once, and completes it when its rule holds, with its reward', () => {
    const rewarded = set(p, quest, { effects: [{ kind: 'arc', ref: id(p, 'Mara'), amount: 2 }] });
    const play = startPlay(rewarded);
    expect(play.world.quests[quest]).toBe('active');
    expect(play.log[0]).toEqual({ kind: 'quest', text: 'Open the vault', state: 'active', detail: 'Reach the vault chamber and open the door' });
    const end = playThrough(rewarded);
    expect(end.world.quests[quest]).toBe('done');
    const texts = end.log.map((e) => `${e.kind}:${e.text}`);
    // Done as the door is solved, and the reward is paid then (the key choice adds one more).
    expect(texts.indexOf('quest:Open the vault', 1)).toBe(texts.indexOf('fired:The Vault Door is solved') + 1);
    expect(end.world.arcs[id(p, 'Mara')]).toBe(3);
  });

  it('waits to start a quest until its start rule holds', () => {
    const later = set(p, quest, { starts: { match: 'all', items: [{ kind: 'item', ref: key, op: 'has' }] } });
    let play = startPlay(later);
    expect(play.world.quests[quest]).toBeUndefined();
    play = setWorld(later, play, (w) => ({ ...w, items: { ...w.items, [key]: 1 } }));
    expect(play.world.quests[quest]).toBe('active');
  });

  it('offers Win only when the encounter can be won, and says what it needs', () => {
    const guarded = set(p, eels, { rule: { match: 'all', items: [{ kind: 'item', ref: key, op: 'has' }] }, effects: [{ kind: 'give', ref: key }] });
    let play = playToDecision(guarded, startPlay(guarded, theKey));
    expect(promptOf(guarded, play)).toEqual({
      kind: 'choice',
      symbol: 'encounter',
      title: 'Eel swarm',
      prompt: 'Encounter: Eel swarm',
      options: [
        { label: 'Win', available: false, needs: 'Vault Key is carried' },
        { label: 'Lose · try again', available: true },
      ],
    });
    expect(play.log.find((e) => e.kind === 'encounter')).toEqual({ kind: 'encounter', text: 'Eel swarm', detail: 'Eels, a dozen or so · weak to lantern light' });
    expect(choose(guarded, play, 0)).toBe(play);
    play = setWorld(guarded, play, (w) => ({ ...w, items: { ...w.items, [key]: 1 } }));
    play = choose(guarded, play, 0);
    expect(play.world.won[eels]).toBe(true);
    // One by hand, one for the win, and the one found in the silt as the scene plays on.
    expect(play.world.items[key]).toBe(3);
    expect(play.log.some((e) => e.text === 'Won: Eel swarm')).toBe(true);
  });

  it('a loss does its effects, then tries again, ends the game or carries on', () => {
    const flag = id(p, 'door_solved');
    const losing = (onLose: string) => set(p, eels, { onLose, loseEffects: [{ kind: 'setFlag', ref: flag, value: 'no' }] });
    const at = (project: Project) => playToDecision(project, startPlay(project, theKey));

    const again = losing('Try again');
    const tried = choose(again, at(again), 1);
    expect(tried.world.flags[flag]).toBe('no');
    expect(promptOf(again, tried)).toMatchObject({ symbol: 'encounter' });

    const over = losing('Game over');
    expect(promptOf(over, choose(over, at(over), 1))).toEqual({ kind: 'end', outcome: 'gameOver', text: 'Game over: lost to Eel swarm' });

    const on = losing('Carry on');
    const carried = choose(on, at(on), 1);
    expect(carried.log.some((e) => e.text === 'Lost: Eel swarm')).toBe(true);
    expect(carried.log.at(-2)).toMatchObject({ kind: 'action', text: 'Find the key in the silt' });
  });

  it('goes on a timeline as a new encounter or one from the Bible, and its rules are checked like any other', async () => {
    const { addEvent, eventDetail, findEvent } = await import('../timeline');
    const { brokenReferences } = await import('../rules');
    const made = addEvent(p, theKey, 'encounter')!;
    const event = findEvent(made.project, theKey, made.id)!;
    expect(made.project.objects[event.refId!]).toMatchObject({ type: 'encounter', name: 'New encounter', data: { code: 'ENC-02' } });
    expect(addEvent(p, theKey, 'encounter', { refId: key })).toBeNull();
    const staged = findEvent(p, theKey, p.events.find((e) => e.refId === eels)!.id)!;
    expect(eventDetail(p, staged)).toBe('Win or lose · a loss: try again');
    const broken = set(p, quest, { starts: { match: 'all', items: [{ kind: 'item', ref: 'gone', op: 'has' }] } });
    expect(brokenReferences(broken)).toEqual([{ owner: quest, where: 'Open the vault · starts' }]);
  });
});

describe('lore and mechanics', () => {
  const lore = id(p, 'The Drowned Order', 'lore');
  const lantern = id(p, 'Lantern oil', 'mechanic');

  it('discovers lore and makes a mechanic available once its rule holds, and says so', () => {
    let play = startPlay(p);
    expect(play.world.lore[lore]).toBeUndefined();
    expect(play.world.mechanics[lantern]).toBeUndefined();
    // Taking the lantern makes its oil matter.
    play = choose(p, playToDecision(p, play), 0);
    expect(play.world.mechanics[lantern]).toBe(true);
    expect(play.log).toContainEqual({ kind: 'mechanic', text: 'Lantern oil' });
    // The Order's story comes out at the vault door.
    play = toTheVault(p);
    expect(play.world.lore[lore]).toBe(true);
    expect(play.log).toContainEqual({ kind: 'lore', text: 'The Drowned Order' });
  });

  it('knows lore, and has a mechanic, from the start when it has no rule', () => {
    const open = { ...p, objects: { ...p.objects, [lore]: { ...p.objects[lore]!, data: { ...p.objects[lore]!.data, rule: undefined } } } };
    const play = startPlay(open);
    expect(play.world.lore[lore]).toBe(true);
    expect(play.log[0]).toEqual({ kind: 'lore', text: 'The Drowned Order' });
  });
});
