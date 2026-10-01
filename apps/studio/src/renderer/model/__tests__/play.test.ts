import { describe, expect, it } from 'vitest';
import { advance, choose, endFreePlay, MAILTO_LIMIT, notesMailto, notesSms, notesPrintHtml, NOTES_PRINT_STYLE, interact, playToDecision, promptOf, settleWorld, setWorld, startPlay, startWorld, type Play } from '../play';
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
    // By its rules, not the sample's effects: under way at once, done when the door is solved.
    const byRule = set(p, quest, { byEffect: undefined, rule: { match: 'all', items: [{ kind: 'puzzle', ref: id(p, 'The Vault Door', 'puzzle'), op: 'solved' }] } });
    const rewarded = set(byRule, quest, { effects: [{ kind: 'arc', ref: id(p, 'Mara'), amount: 2 }] });
    const play = startPlay(rewarded);
    expect(play.world.quests[quest]).toBe('active');
    expect(play.log[0]).toEqual({ kind: 'quest', text: 'Open the vault', state: 'active', detail: 'Reach the vault chamber and open the door' });
    const end = playThrough(rewarded);
    expect(end.world.quests[quest]).toBe('done');
    const texts = end.log.map((e) => `${e.kind}:${e.text}`);
    // Done as the door is solved (after the two cues solving it plays), and the reward is paid then, once (the key choice adds one more).
    expect(texts.indexOf('quest:Open the vault', 1)).toBe(texts.indexOf('fired:The Vault Door is solved') + 3);
    expect(end.world.arcs[id(p, 'Mara')]).toBe(3);
  });

  it('waits to start a quest until its start rule holds', () => {
    const later = set(p, quest, { byEffect: undefined, starts: { match: 'all', items: [{ kind: 'item', ref: key, op: 'has' }] } });
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
    expect(carried.log).toContainEqual(expect.objectContaining({ kind: 'action', text: 'Find the key in the silt' }));
  });

  it('goes on a timeline as a new encounter or one from the Bible, and its rules are checked like any other', async () => {
    const { addEvent, eventDetail, findEvent } = await import('../timeline');
    const { brokenReferences } = await import('../rules');
    const made = addEvent(p, theKey, 'encounter')!;
    const event = findEvent(made.project, theKey, made.id)!;
    expect(made.project.objects[event.refId!]).toMatchObject({ type: 'encounter', name: 'New encounter', data: { code: 'ENC-02' } });
    expect(addEvent(p, theKey, 'encounter', { refId: key })).toBeNull();
    const staged = findEvent(p, theKey, p.events.find((e) => e.refId === eels)!.id)!;
    expect(eventDetail(p, staged)).toBe('Won when Lantern oil is available · a loss: try again');
    const broken = set(p, quest, { starts: { match: 'all', items: [{ kind: 'item', ref: 'gone', op: 'has' }] } });
    expect(brokenReferences(broken)).toEqual([{ owner: quest, where: 'Open the vault · starts' }]);
  });
});

describe('lore and mechanics', () => {
  const lore = id(p, 'The Drowned Order', 'lore');
  const lantern = id(p, 'Lantern oil', 'mechanic');

  it('in the sample: lighting the lantern makes its oil a mechanic, and the key\'s seal reveals the lore', () => {
    // Only by an effect: nothing is known or available before the story does it.
    const settled = settleWorld(p, startWorld(p)).world;
    expect(settled.lore[lore]).toBeUndefined();
    expect(settled.mechanics[lantern]).toBeUndefined();
    // SC-01 opens by lighting the lantern.
    let play = startPlay(p);
    expect(play.world.mechanics[lantern]).toBe(true);
    expect(play.log).toContainEqual({ kind: 'mechanic', text: 'Lantern oil' });
    // The key's seal tells the Order's story in SC-02, before the vault door (the rule's fallback).
    play = toTheVault(p);
    expect(play.world.lore[lore]).toBe(true);
    const texts = play.log.map((e) => `${e.kind}:${e.text}`);
    expect(texts.indexOf('lore:The Drowned Order')).toBeLessThan(texts.findIndex((t) => t.startsWith('heading:SC-03')));
    expect(texts.indexOf('quest:Open the vault')).toBe(texts.indexOf('action:Find the key in the silt') + 2);
  });

  it('knows lore, and has a mechanic, from the start when it has no rule', () => {
    const open = { ...p, objects: { ...p.objects, [lore]: { ...p.objects[lore]!, data: { ...p.objects[lore]!.data, rule: undefined } } } };
    const play = startPlay(open);
    expect(play.world.lore[lore]).toBe(true);
    expect(play.log[0]).toEqual({ kind: 'lore', text: 'The Drowned Order' });
  });
});

describe('conditions on quests, lore and mechanics', () => {
  it('hold as the play-through goes: the eels need the lantern oil', () => {
    const theKey = id(p, 'The Key', 'scene');
    // Straight into SC-02, without the lantern: Win isn't on offer yet.
    let play = playToDecision(p, startPlay(p, theKey));
    const prompt = promptOf(p, play);
    expect(prompt.kind === 'choice' && prompt.options[0]).toEqual({ label: 'Win', available: false, needs: 'Lantern oil is available' });
    play = setWorld(p, play, (w) => ({ ...w, mechanics: { ...w.mechanics, [id(p, 'Lantern oil', 'mechanic')]: true } }));
    const now = promptOf(p, play);
    expect(now.kind === 'choice' && now.options[0]!.available).toBe(true);
  });

  it('read each quest state, lore and mechanic, and say so in words', async () => {
    const { evaluate, describeRule, emptyState, newCondition } = await import('../rules');
    const q = id(p, 'Open the vault', 'quest');
    const rule = (c: ReturnType<typeof newCondition>) => ({ match: 'all' as const, items: [c] });
    const state = { ...emptyState(), quests: { [q]: 'active' as const } };
    const ops = ['done', 'notDone', 'active', 'notStarted'] as const;
    expect(ops.map((op) => evaluate(rule({ kind: 'quest', ref: q, op }), state))).toEqual([false, true, true, false]);
    expect(ops.map((op) => evaluate(rule({ kind: 'quest', ref: q, op }), emptyState()))).toEqual([false, true, false, true]);
    expect(describeRule(p, rule({ kind: 'quest', ref: q, op: 'active' }))).toBe('Open the vault is under way');
    const lore = id(p, 'The Drowned Order', 'lore');
    expect(evaluate(rule(newCondition('lore', lore)), { ...emptyState(), lore: { [lore]: true } })).toBe(true);
    expect(describeRule(p, rule({ kind: 'lore', ref: lore, op: 'unknown' }))).toBe('The Drowned Order is not known');
    expect(newCondition('mechanic', 'x')).toEqual({ kind: 'mechanic', ref: 'x', op: 'available' });
  });
});

describe('effects that start quests and reveal lore', () => {
  const quest = id(p, 'Open the vault', 'quest');
  const lore = id(p, 'The Drowned Order', 'lore');

  it('start a quest waiting for its rule, and reveal lore, when an event does them', async () => {
    const { addEvent, updateEvent } = await import('../timeline');
    const { describeEffects } = await import('../rules');
    // The quest waits for the key; the silt camp's event starts it and tells the Order's story early.
    let waiting: Project = { ...p, objects: { ...p.objects, [quest]: { ...p.objects[quest]!, data: { ...p.objects[quest]!.data, starts: { match: 'all', items: [{ kind: 'flag', ref: id(p, 'door_solved'), op: 'is', value: 'never' }] } } } } };
    const theKey = id(p, 'The Key', 'scene');
    const added = addEvent(waiting, theKey, 'action', { label: 'Read the camp journal' })!;
    const effects = [{ kind: 'startQuest' as const, ref: quest }, { kind: 'revealLore' as const, ref: lore }];
    waiting = updateEvent(added.project, theKey, added.id, { effects });
    expect(describeEffects(waiting, effects)).toBe('start Open the vault · reveal The Drowned Order');
    let play = startPlay(waiting, theKey);
    expect(play.world.quests[quest]).toBeUndefined();
    play = setWorld(waiting, play, (w) => ({ ...w, mechanics: { ...w.mechanics, [id(p, 'Lantern oil', 'mechanic')]: true } }));
    play = playToDecision(waiting, choose(waiting, play, 0));
    expect(play.world.quests[quest]).toBe('active');
    expect(play.world.lore[lore]).toBe(true);
    const texts = play.log.map((e) => `${e.kind}:${e.text}`);
    expect(texts).toContain('quest:Open the vault');
    expect(texts).toContain('lore:The Drowned Order');
  });

  it('leave a quest under way or done as it is', async () => {
    const { apply, emptyState } = await import('../rules');
    const done = { ...emptyState(), quests: { [quest]: 'done' as const } };
    expect(apply([{ kind: 'startQuest', ref: quest }], done).quests[quest]).toBe('done');
    expect(apply([{ kind: 'startQuest', ref: quest }], emptyState()).quests[quest]).toBe('active');
  });
});

describe('effects that complete quests and make mechanics available', () => {
  const quest = id(p, 'Open the vault', 'quest');
  const lantern = id(p, 'Lantern oil', 'mechanic');
  const mara = id(p, 'Mara');

  it('complete a quest at once, paying its reward once, and make a mechanic available', async () => {
    const { describeEffects } = await import('../rules');
    const { applyStoryEffects } = await import('../play');
    const rewarded = { ...p, objects: { ...p.objects, [quest]: { ...p.objects[quest]!, data: { ...p.objects[quest]!.data, effects: [{ kind: 'arc', ref: mara, amount: 1 }] } } } };
    const effects = [{ kind: 'completeQuest' as const, ref: quest }, { kind: 'enableMechanic' as const, ref: lantern }, { kind: 'completeQuest' as const, ref: quest }];
    expect(describeEffects(rewarded, effects.slice(0, 2))).toBe('complete Open the vault · make Lantern oil available');
    const done = applyStoryEffects(rewarded, startWorld(rewarded), effects);
    expect(done.world.quests[quest]).toBe('done');
    expect(done.world.mechanics[lantern]).toBe(true);
    // The reward is paid once, however many times it is completed.
    expect(done.world.arcs[mara]).toBe(1);
    expect(done.log.map((e) => `${e.kind}:${e.text}`)).toEqual(['quest:Open the vault', 'effect:Mara +1', 'mechanic:Lantern oil']);
  });
});

describe('the codex', () => {
  it('reads the same as the engines\' codex: the quest log, the characters met, the locations visited, the items found, the objects used, the mechanics, the encounters met, then the lore found', async () => {
    const { codexText, codexProgress } = await import('../play');
    expect(codexText(p, startWorld(p))).toBe('CODEX\n\nQUESTS · 0 under way, 0 done\nNone yet.\n\nCHARACTERS · 0 of 1 met\nNone yet.\n\nLOCATIONS · 0 of 1 visited\nNone yet.\n\nITEMS · 0 of 3 found\nNone yet.\n\nOBJECTS · 0 of 1 used\nNone yet.\n\nMECHANICS · 0 of 1 available\nNone yet.\n\nSKILLS · 0 of 2 learned\nNone yet.\n\nENCOUNTERS · 0 met, 0 won\nNone yet.\n\nLORE · 0 of 2 found\nNothing found yet.');
    // SC-01 lights the lantern at once.
    const start = startPlay(p);
    expect(codexText(p, start.world)).toContain('MECHANICS · 1 of 1 available\n\nLANTERN OIL\nControls: Hold to raise the lantern\nThe lantern’s oil drains the longer you stay in deep water');
    const atVault = toTheVault(p);
    expect(codexText(p, atVault.world)).toBe(
      'CODEX\n\nQUESTS · 1 under way, 0 done\n• Open the vault — Reach the vault chamber and open the door\n\nCHARACTERS · 1 of 1 met\n\nMARA\nA guide who knows the flooded caves better than anyone alive. She carries the lantern.\n\nLOCATIONS · 1 of 1 visited\n\nVAULT CHAMBER\nA drowned hall under the old city, its bronze door sealed by the Order.\n\nITEMS · 3 of 3 found\n\nDIVING KNIFE (carried)\nA short diving knife, notched from the rocks. It cuts kelp and cord, and dulls fast.\n\nFLARE PISTOL (carried)\nA brass signal pistol from the last expedition. Each flare lights a chamber for a few breaths.\n\nVAULT KEY (carried)\nA heavy bronze key, green with age, stamped with the Order’s wave.\n\nOBJECTS · 0 of 1 used\nNone yet.\n\nMECHANICS · 1 of 1 available\n\nLANTERN OIL\nControls: Hold to raise the lantern\nThe lantern’s oil drains the longer you stay in deep water; the screen edges darken as it runs low.\n\nSKILLS · 0 of 2 learned\nNone yet.\n\nENCOUNTERS · 1 met, 1 won\n\nEEL SWARM (won)\nEnemies: Eels, a dozen or so\nWeak to: Lantern light\nEels in the deep channels. They scatter from lantern light.\n\nLORE · 1 of 2 found\n\nTHE DROWNED ORDER\nRiver priests who sealed the vault three hundred years ago, when the river took the old city. They believed the water kept their secrets.',
    );
    // Since the start: Mara heard, the chamber visited, the pistol and the key found, the eels met and beaten, the quest started and the lore found (the oil and the knife were there already).
    expect(codexProgress(p, atVault.world) - codexProgress(p, start.world)).toBe(8);
    const end = playThrough(p);
    expect(codexText(p, end.world)).toContain('QUESTS · 0 under way, 1 done\n• Open the vault (done)');
    // The lever pulled in free play is in, with how it stands now.
    expect(codexText(p, end.world)).toContain('OBJECTS · 1 of 1 used\n\nRUSTED LEVER (up)\nAn iron lever half-buried by the door, stiff with rust. It works the old sluice.');
    // The key is spent at the door, but stays in the codex, no longer carried.
    expect(codexText(p, end.world)).toContain('ITEMS · 3 of 3 found\n\nDIVING KNIFE (carried)\nA short diving knife, notched from the rocks. It cuts kelp and cord, and dulls fast.\n\nFLARE PISTOL (carried)\nA brass signal pistol from the last expedition. Each flare lights a chamber for a few breaths.\n\nVAULT KEY\nA heavy bronze key, green with age, stamped with the Order’s wave.');
  });

  it('searches the codex: only the entries that match, in the sections that have any', async () => {
    const { codexText } = await import('../play');
    const world = toTheVault(p).world;
    // "lantern" is in Mara's entry, the oil and the eels' weakness, and nowhere else.
    expect(codexText(p, world, 'LANTERN')).toBe(
      'CODEX\n\nCHARACTERS · 1 of 1 met\n\nMARA\nA guide who knows the flooded caves better than anyone alive. She carries the lantern.\n\nMECHANICS · 1 of 1 available\n\nLANTERN OIL\nControls: Hold to raise the lantern\nThe lantern’s oil drains the longer you stay in deep water; the screen edges darken as it runs low.\n\nENCOUNTERS · 1 met, 1 won\n\nEEL SWARM (won)\nEnemies: Eels, a dozen or so\nWeak to: Lantern light\nEels in the deep channels. They scatter from lantern light.',
    );
    // A heading is not searched, and a blank search is no search.
    expect(codexText(p, world, 'quests')).toBe('CODEX\n\nNothing matches "quests".');
    expect(codexText(p, world, '  ')).toBe(codexText(p, world));
    expect(codexText(p, world, 'vault')).toContain('QUESTS · 1 under way, 0 done\n• Open the vault — Reach the vault chamber and open the door\n\nLOCATIONS');
  });

  it('lists the skills learned, in the order first learned, with their rank, kind and tree, and what they do', async () => {
    const { codexText, codexProgress, learn } = await import('../play');
    let play = toTheVault(p);
    const before = codexProgress(p, play.world);
    play = learn(p, play, id(p, 'Deep Breath'));
    expect(codexText(p, play.world, '', 'skills')).toBe('CODEX\n\nSKILLS · 1 of 2 learned\n\nDEEP BREATH (rank 1 of 2)\nSkill · Diving\nWhat it does: Hold your breath a third longer\nLonger under water with each rank.');
    // The eels' salvage buys the hood; each rank counts as new.
    play = learn(p, learn(p, play, id(p, 'Deep Breath')), id(p, 'Lantern Hood'));
    expect(codexProgress(p, play.world) - before).toBe(3);
    expect(codexText(p, play.world, 'hood', 'skills')).toBe('CODEX\n\nSKILLS · 2 of 2 learned\n\nLANTERN HOOD\nUpgrade · Diving\nWhat it does: The lantern burns half as fast in deep water\nA brass hood that keeps the flame out of the water.');
    expect(codexText(p, play.world, '', 'skills', 'name').split('\n').filter((l) => /^[A-Z ]+( \(|$)/.test(l) && !l.startsWith('CODEX'))).toEqual(['DEEP BREATH (rank 2 of 2)', 'LANTERN HOOD']);
  });

  it('filters the codex by section, alone or with a search', async () => {
    const { codexText, codexSectionKeys } = await import('../play');
    const world = toTheVault(p).world;
    expect(codexSectionKeys(p, world)).toEqual(['quests', 'characters', 'locations', 'items', 'objects', 'mechanics', 'skills', 'encounters', 'lore']);
    expect(codexText(p, world, '', 'lore')).toBe(
      'CODEX\n\nLORE · 1 of 2 found\n\nTHE DROWNED ORDER\nRiver priests who sealed the vault three hundred years ago, when the river took the old city. They believed the water kept their secrets.',
    );
    // An empty section still shows, saying so.
    expect(codexText(p, world, '', 'objects')).toBe('CODEX\n\nOBJECTS · 0 of 1 used\nNone yet.');
    // With a search: only that section's matches, or where nothing matched.
    expect(codexText(p, world, 'lantern', 'mechanics')).toBe(
      'CODEX\n\nMECHANICS · 1 of 1 available\n\nLANTERN OIL\nControls: Hold to raise the lantern\nThe lantern’s oil drains the longer you stay in deep water; the screen edges darken as it runs low.',
    );
    expect(codexText(p, world, 'lantern', 'lore')).toBe('CODEX\n\nNothing matches "lantern" in Lore.');
    expect(codexText(p, world, '', '')).toBe(codexText(p, world));
  });

  it('sorts each section: as found, newest first, or by name', async () => {
    const { codexText } = await import('../play');
    const drowned = id(p, 'The Drowned Order');
    const expedition = id(p, 'The Last Expedition');
    // Found the expedition's marks first, then the Order's story.
    const world = { ...toTheVault(p).world, lore: { [expedition]: true, [drowned]: true } };
    const heads = (sort: string) => codexText(p, world, '', 'lore', sort).split('\n').filter((l) => l.startsWith('THE '));
    expect(heads('')).toEqual(['THE LAST EXPEDITION', 'THE DROWNED ORDER']);
    expect(heads('found')).toEqual(['THE LAST EXPEDITION', 'THE DROWNED ORDER']);
    expect(heads('newest')).toEqual(['THE DROWNED ORDER', 'THE LAST EXPEDITION']);
    expect(heads('name')).toEqual(['THE DROWNED ORDER', 'THE LAST EXPEDITION']);
    // The heading and the search are the same whatever the order.
    expect(codexText(p, world, '', 'lore', 'name')).toContain('LORE · 2 of 2 found');
    expect(codexText(p, world, 'pry marks', '', 'name')).toContain('THE LAST EXPEDITION\nPry marks around the lock');
  });

  it('reveals the last expedition when the door is forced', () => {
    // Pull the lever in the vault's free play, then force the door rather than turn the key.
    let play = toTheVault(p);
    for (let i = 0; i < 10; i++) {
      const prompt = promptOf(p, play);
      if (prompt.kind === 'choice' && prompt.options.some((o) => o.label === 'Force it')) {
        play = choose(p, play, prompt.options.findIndex((o) => o.label === 'Force it'));
        break;
      }
      if (prompt.kind === 'freePlay') {
        const o = prompt.objects.find((x) => x.verbs.some((v) => v.available))!;
        play = interact(p, play, o.id, o.verbs.find((v) => v.available)!.id);
      } else play = playToDecision(p, prompt.kind === 'choice' ? choose(p, play, 0) : play);
    }
    expect(play.world.lore[id(p, 'The Last Expedition')]).toBe(true);
  });

  it('bookmarks entries: marked where they are, and a filter for them alone', async () => {
    const { codexText } = await import('../play');
    const world = toTheVault(p).world;
    const marks = new Set([`lore:${id(p, 'The Drowned Order')}`, `mechanics:${id(p, 'Lantern oil')}`]);
    // The mark goes at the end of the entry's first line.
    expect(codexText(p, world, '', '', '', marks)).toContain('\n\nLANTERN OIL ★\nControls: Hold to raise the lantern');
    expect(codexText(p, world, '', '', '', marks)).toContain('\n\nTHE DROWNED ORDER ★\nRiver priests');
    expect(codexText(p, world, '', '', '', marks)).toContain('\n\nEEL SWARM (won)\n');
    // The bookmarks alone: only those, each under its own section.
    expect(codexText(p, world, '', 'bookmarks', '', marks)).toBe(
      'CODEX\n\nMECHANICS · 1 of 1 available\n\nLANTERN OIL ★\nControls: Hold to raise the lantern\nThe lantern’s oil drains the longer you stay in deep water; the screen edges darken as it runs low.\n\nLORE · 1 of 2 found\n\nTHE DROWNED ORDER ★\nRiver priests who sealed the vault three hundred years ago, when the river took the old city. They believed the water kept their secrets.',
    );
    expect(codexText(p, world, 'priests', 'bookmarks', '', marks)).toBe('CODEX\n\nLORE · 1 of 2 found\n\nTHE DROWNED ORDER ★\nRiver priests who sealed the vault three hundred years ago, when the river took the old city. They believed the water kept their secrets.');
    expect(codexText(p, world, 'eels', 'bookmarks', '', marks)).toBe('CODEX\n\nNothing matches "eels" in Bookmarks.');
    expect(codexText(p, world, '', 'bookmarks')).toBe('CODEX\n\nNo bookmarks yet.');
    // The mark is not searched: a search for it finds nothing.
    expect(codexText(p, world, '★', '', '', marks)).toBe('CODEX\n\nNothing matches "★".');
  });

  it('keeps the player\'s notes on entries: under the entry, and found by a search', async () => {
    const { codexText } = await import('../play');
    const world = toTheVault(p).world;
    const notes = new Map([[`encounters:${id(p, 'Eel swarm')}`, 'Light the lantern first!'], [`lore:${id(p, 'The Drowned Order')}`, '  ']]);
    expect(codexText(p, world, '', '', '', new Set(), notes)).toContain('\n\nEEL SWARM (won)\nEnemies: Eels, a dozen or so\nWeak to: Lantern light\nEels in the deep channels. They scatter from lantern light.\nNote: Light the lantern first!');
    // A blank note is no note.
    expect(codexText(p, world, '', 'lore', '', new Set(), notes)).not.toContain('Note:');
    // The search looks in the notes too (not in the label).
    expect(codexText(p, world, 'first!', '', '', new Set(), notes)).toContain('EEL SWARM (won)');
    expect(codexText(p, world, 'note:', '', '', new Set(), notes)).toBe('CODEX\n\nNothing matches "note:".');
    // With a bookmark too: the star on the first line, the note last.
    const both = codexText(p, world, '', 'bookmarks', '', new Set([`encounters:${id(p, 'Eel swarm')}`]), notes);
    expect(both).toContain('\n\nEEL SWARM (won) ★\nEnemies:');
    expect(both.endsWith('\nNote: Light the lantern first!')).toBe(true);
  });

  it('exports the player\'s notes: each entry with a note, in the codex\'s order', async () => {
    const { codexNotesText } = await import('../play');
    const world = toTheVault(p).world;
    expect(codexNotesText(p, world, new Map())).toBe(`CODEX NOTES · ${p.name}\n\nNo notes yet.`);
    const notes = new Map([
      [`lore:${id(p, 'The Drowned Order')}`, 'Priests, not monks'],
      [`quests:${id(p, 'Open the vault')}`, 'Key first, then the lever'],
      [`encounters:${id(p, 'Eel swarm')}`, ' '],
    ]);
    expect(codexNotesText(p, world, notes)).toBe(
      `CODEX NOTES · ${p.name}\n\nQUESTS · Open the vault — Reach the vault chamber and open the door\nKey first, then the lever\n\nLORE · THE DROWNED ORDER\nPriests, not monks`,
    );
  });

  it('imports exported notes: matched by section and name, whatever the entry\'s state', async () => {
    const { codexNotesFrom, codexNotesText, codexNameOf } = await import('../play');
    expect(codexNameOf('• Open the vault — Reach the vault chamber')).toBe('open the vault');
    expect(codexNameOf('VAULT KEY (carried ×2)')).toBe('vault key');
    expect(codexNameOf('EEL SWARM (won)')).toBe('eel swarm');
    const world = toTheVault(p).world;
    const exported = [
      `CODEX NOTES · ${p.name}`,
      // Written before the eels were beaten, and the key used up: still theirs.
      'ENCOUNTERS · EEL SWARM\nLight the lantern first',
      'ITEMS · VAULT KEY\nFor the vault door',
      'QUESTS · Open the vault\nKey first,\nthen the lever',
      // Not met yet in this play-through, or from another story.
      'LORE · THE LAST EXPEDITION\nWho were they?',
      'LORE · SOMETHING ELSE\n',
    ].join('\r\n\r\n');
    const read = codexNotesFrom(p, world, exported);
    expect([...read.notes]).toEqual([
      [`encounters:${id(p, 'Eel swarm')}`, 'Light the lantern first'],
      [`items:${id(p, 'Vault Key')}`, 'For the vault door'],
      [`quests:${id(p, 'Open the vault')}`, 'Key first,\nthen the lever'],
    ]);
    expect(read.skipped).toEqual(['LORE · THE LAST EXPEDITION']);
    // An export read back gives the same notes.
    const again = codexNotesFrom(p, world, codexNotesText(p, world, read.notes));
    expect([...again.notes].sort()).toEqual([...read.notes].sort());
    expect(again.skipped).toEqual([]);
  });

  it('lists a character once heard, and only one with a codex entry', async () => {
    const { codexText, codexProgress } = await import('../play');
    const mara = id(p, 'Mara');
    const explorer = id(p, 'The Explorer');
    const both = { ...startWorld(p), metCharacters: { [explorer]: true, [mara]: true } };
    // The Explorer has no codex entry, so only Mara shows and counts.
    expect(codexText(p, both)).toContain('CHARACTERS · 1 of 1 met\n\nMARA\nA guide who knows the flooded caves');
    expect(codexText(p, both)).not.toContain('THE EXPLORER');
    expect(codexProgress(p, both) - codexProgress(p, startWorld(p))).toBe(1);
    // She is met by speaking: at the vault she has.
    expect(toTheVault(p).world.metCharacters[mara]).toBe(true);
  });

  it('lists an item once found, with how many are carried, and only one with a codex entry', async () => {
    const { codexText, codexProgress } = await import('../play');
    const key = id(p, 'Vault Key');
    const two = settleWorld(p, { ...startWorld(p), items: { [key]: 2 } }).world;
    expect(two.found[key]).toBe(true);
    expect(codexText(p, two)).toContain('ITEMS · 1 of 3 found\n\nVAULT KEY (carried ×2)\nA heavy bronze key');
    expect(codexProgress(p, two) - codexProgress(p, startWorld(p))).toBe(1);
    // Without an entry the key stays out of the codex.
    const plain = { ...p, objects: { ...p.objects, [key]: { ...p.objects[key]!, data: { ...p.objects[key]!.data, codex: '' } } } };
    expect(codexText(plain, two)).toContain('ITEMS · 0 of 2 found\nNone yet.');
  });

  it('marks an item equipped, and the slot it is in', async () => {
    const { codexText, codexOf, gearIn } = await import('../play');
    const knife = id(p, 'Diving Knife');
    const carried = settleWorld(p, { ...startWorld(p), items: { [knife]: 2 } }).world;
    expect(codexText(p, carried)).toContain('DIVING KNIFE (carried ×2)\nA short diving knife');
    const armed = gearIn(p, carried, knife, 'equip').world;
    expect(codexOf(p, armed).items.find((i) => i.id === knife)).toMatchObject({ carried: 2, equipped: 'Hand' });
    expect(codexText(p, armed)).toContain('DIVING KNIFE (carried ×2, equipped · Hand)\nA short diving knife');
    const one = gearIn(p, { ...armed, items: { ...armed.items, [knife]: 1 } }, knife, 'unequip').world;
    expect(codexText(p, gearIn(p, one, knife, 'equip').world)).toContain('DIVING KNIFE (carried, equipped · Hand)\n');
    expect(codexText(p, one)).toContain('DIVING KNIFE (carried)\n');
  });

  it('lists a location once a scene set there plays, and only one with a codex entry', async () => {
    const { codexText } = await import('../play');
    const chamber = id(p, 'Vault Chamber');
    expect(startPlay(p).world.been[chamber]).toBeUndefined();
    const there = toTheVault(p).world;
    expect(there.been[chamber]).toBe(true);
    const plain = { ...p, objects: { ...p.objects, [chamber]: { ...p.objects[chamber]!, data: { ...p.objects[chamber]!.data, codex: '' } } } };
    expect(codexText(plain, there)).not.toContain('LOCATIONS');
  });

  it('lists an encounter once met, before it is won, and once however often it is retried', async () => {
    const { codexText, codexProgress } = await import('../play');
    // Without the lantern's oil the eels can't be beaten: lose, and they are met but not won.
    const dark = { ...p, events: p.events.filter((e) => !(e.effects ?? []).some((x) => x.kind === 'enableMechanic')) };
    let play = playToDecision(dark, choose(dark, playToDecision(dark, startPlay(dark)), 0));
    expect(play.cursor.at).toBe('encounter');
    const before = codexProgress(dark, play.world);
    expect(codexText(dark, play.world)).toContain('ENCOUNTERS · 1 met, 0 won\n\nEEL SWARM\nEnemies: Eels, a dozen or so\nWeak to: Lantern light');
    play = choose(dark, play, 1);
    play = choose(dark, play, 1);
    expect(play.cursor.at).toBe('encounter');
    expect(codexProgress(dark, play.world)).toBe(before);
    expect(codexText(dark, play.world)).toContain('ENCOUNTERS · 1 met, 0 won');
  });
});

describe('notesPrintHtml', () => {
  it('turns exported notes into a page to print, section by section', () => {
    const page = notesPrintHtml('CODEX NOTES · Tom & Jerry\n\nLORE · THE <OLD> ORDER\nPriests\n\nLORE · THE LAST EXPEDITION\nWho?\n\nITEMS · KEY\nFits the door');
    expect(page).toContain('<title>Tom &amp; Jerry · codex notes</title>');
    expect(page).toContain('<h1>Tom &amp; Jerry</h1>');
    expect(page.match(/<h2>Lore<\/h2>/g)).toHaveLength(1);
    expect(page).toContain('<div class="note"><h3>THE &lt;OLD&gt; ORDER</h3><p>Priests</p></div>');
    expect(page.indexOf('<h2>Items</h2>')).toBeGreaterThan(page.indexOf('Who?'));
    expect(notesPrintHtml('CODEX NOTES · X\n\nNo notes yet.')).toContain('<p>No notes yet.</p>');
  });

  it('is the page the engines print, byte for byte', () => {
    // The same notes and page as scripts/godot-check/check.gd expects.
    expect(notesPrintHtml('CODEX NOTES · The Sunken Vault\n\nQUESTS · Open the vault — Reach the vault chamber and open the door\nKey first, then the lever\n\nLORE · THE DROWNED ORDER\nPriests, not monks')).toBe(
      `<!doctype html>\n<html><head><meta charset="utf-8"><title>The Sunken Vault · codex notes</title><style>${NOTES_PRINT_STYLE}</style></head>\n<body><h1>The Sunken Vault</h1><p class="sub">Codex notes</p>\n<h2>Quests</h2>\n<div class="note"><h3>Open the vault — Reach the vault chamber and open the door</h3><p>Key first, then the lever</p></div>\n<h2>Lore</h2>\n<div class="note"><h3>THE DROWNED ORDER</h3><p>Priests, not monks</p></div>\n</body></html>\n`,
    );
  });
});

describe('notesMailto', () => {
  it('is a mail link with the story in the subject and the notes as the body', () => {
    // The same link as the engines' checks expect.
    expect(notesMailto('CODEX NOTES · The Sunken Vault\n\nLORE · THE DROWNED ORDER\nPriests, not monks')).toEqual({
      url: 'mailto:?subject=The%20Sunken%20Vault%20codex%20notes&body=CODEX%20NOTES%20%C2%B7%20The%20Sunken%20Vault%0D%0A%0D%0ALORE%20%C2%B7%20THE%20DROWNED%20ORDER%0D%0APriests%2C%20not%20monks',
      whole: true,
    });
  });

  it('says the notes are on the clipboard when they are too long for a link', () => {
    const long = notesMailto(`CODEX NOTES · The Sunken Vault\n\nLORE · THE DROWNED ORDER\n${'x'.repeat(MAILTO_LIMIT)}`);
    expect(long.whole).toBe(false);
    expect(long.url).toBe('mailto:?subject=The%20Sunken%20Vault%20codex%20notes&body=The%20notes%20are%20on%20the%20clipboard%3A%20paste%20them%20here.');
  });
});

describe('notesSms', () => {
  it('is a text-message link with the notes as the message', () => {
    // The same link as the engines' checks expect.
    expect(notesSms('CODEX NOTES · The Sunken Vault\r\n\r\nLORE · THE DROWNED ORDER\r\nPriests, not monks')).toEqual({
      url: 'sms:?&body=CODEX%20NOTES%20%C2%B7%20The%20Sunken%20Vault%0A%0ALORE%20%C2%B7%20THE%20DROWNED%20ORDER%0APriests%2C%20not%20monks',
      whole: true,
    });
    expect(notesSms(`CODEX NOTES · X\n\nLORE · Y\n${'x'.repeat(MAILTO_LIMIT)}`)).toEqual({ url: 'sms:?&body=The%20notes%20are%20on%20the%20clipboard%3A%20paste%20them%20here.', whole: false });
  });
});

