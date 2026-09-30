import { describeCost, kindOf, learnCheck, payFor, ranksOf, treeOf } from './skills';
import { initialState, interactionsOf, statesOf } from './details';
import { spineSequence } from './layout';
import { apply, describeEffect, describeRule, evaluate, isEmpty, type Effect, type PlayState, type QuestState, type Rule } from './rules';
import { dualWith, elementsIn, spokenTogether } from './scene';
import { cinematicTiming, describeShot, shotsOf } from './shots';
import { eventLine, eventTitle, loseOf, MAIN, sceneTimeline } from './timeline';
import type { DialogueLine, ObjectType, OptionBehaviour, Project, StoryObject, TimelineEvent } from './types';

/**
 * Play the story inside the studio, the way the generated engine code plays
 * it: from the Beginning along the spine, through each scene's timeline,
 * taking the options and routes whose conditions hold and doing what they
 * say. Triggers fire and puzzles solve themselves as their conditions come
 * true; a free play ends when its rule holds. Quests start and complete by
 * their rules; an encounter on a timeline is won or lost by the player. Pure functions over the
 * project: every step returns a new playthrough, so the player can step back.
 */

export interface PlayWorld extends PlayState {
  /** Triggers that have fired (each fires once by its rule). */
  fired: Record<string, boolean>;
  /** How many times each option has been picked, by option key. */
  picked: Record<string, number>;
  /** Encounters won. */
  won: Record<string, boolean>;
  /** Encounters the player has come to, in the order met (for the codex). */
  met: Record<string, boolean>;
  /** Characters the player has met (heard speak), in the order met (for the codex). */
  metCharacters: Record<string, boolean>;
  /** Items the player has ever held, in the order found (for the codex). */
  found: Record<string, boolean>;
  /** Locations the player has been to (a scene set there played), in the order visited (for the codex). */
  been: Record<string, boolean>;
  /** Objects the player has used, in the order first used (for the codex). */
  used: Record<string, boolean>;
}

export type { QuestState };

/** A second voice on a line: dual dialogue, spoken at the same time. */
export interface Voice {
  speaker: string | null;
  text: string;
  direction?: string;
  lineId: string;
}

export type Entry =
  | { kind: 'heading'; text: string; sub?: string; id: string }
  | { kind: 'line'; speaker: string | null; text: string; direction?: string; sceneId: string; lineId: string; with?: Voice }
  | { kind: 'action'; text: string; detail?: string }
  | { kind: 'cinematic'; text: string; detail?: string; shots?: string[]; skippable?: boolean }
  | { kind: 'picked'; text: string }
  | { kind: 'did'; text: string }
  | { kind: 'effect'; text: string }
  | { kind: 'fired'; text: string }
  | { kind: 'quest'; text: string; state: QuestState; detail?: string }
  | { kind: 'encounter'; text: string; detail?: string }
  | { kind: 'lore'; text: string }
  | { kind: 'mechanic'; text: string }
  /** A skill, ability or upgrade learned: its new rank of how many (spec §8). */
  | { kind: 'skill'; text: string; rank: number; ranks: number }
  | { kind: 'skip'; text: string; needs: string }
  | { kind: 'end'; text: string };

export type Cursor =
  | { at: 'node'; id: string }
  | { at: 'after'; id: string }
  | { at: 'event'; sceneId: string; track: string; index: number }
  | { at: 'wait'; next: Cursor }
  | { at: 'graphChoice'; id: string }
  | { at: 'sceneChoice'; sceneId: string; track: string; index: number }
  | { at: 'freePlay'; sceneId: string; track: string; index: number }
  | { at: 'encounter'; sceneId: string; track: string; index: number }
  | { at: 'end'; outcome: Outcome; text: string };

export type Outcome = 'ending' | 'gameOver' | 'deadEnd' | 'loop';

/**
 * A decision the player made, by what it was made at (spec §15): a choice's
 * option by its words, an encounter won or lost, an object used in free play,
 * a free play left. `at` is the choice or encounter, or the free play's event.
 */
export type Decision =
  | { kind: 'choice'; at: string; option: string }
  | { kind: 'encounter'; at: string; won: boolean }
  | { kind: 'use'; at: string; object: string; interaction: string }
  | { kind: 'skip'; at: string }
  /** A rank of a skill learned (whenever: it isn't made at a place in the story). */
  | { kind: 'learn'; at: string };

export interface Play {
  world: PlayWorld;
  cursor: Cursor;
  log: Entry[];
  /** Every decision so far, in order: the path taken (a replay makes the same ones). */
  decisions?: Decision[];
  /** The graph node and scene event being played, for "show in the studio". */
  where: { nodeId: string | null; sceneId: string | null; eventId: string | null };
}

export interface PlayOption {
  label: string;
  available: boolean;
  /** Why not, in words, when it is not on offer. */
  needs?: string;
}

export interface PlayVerb {
  id: string;
  verb: string;
  available: boolean;
  needs?: string;
  /** What it will do, in words. */
  does: string;
}

export type Prompt =
  | { kind: 'continue' }
  /** A choice, or an encounter (`symbol` says which): its options are Win and Lose. */
  | { kind: 'choice'; title: string; prompt: string; options: PlayOption[]; symbol?: ObjectType }
  | { kind: 'freePlay'; title: string; ends: string; endsByRule: boolean; objects: { id: string; name: string; state?: string; verbs: PlayVerb[] }[] }
  | { kind: 'end'; outcome: Outcome; text: string };

const MAX_STEPS = 2000;

// ---------------------------------------------------------------- the world

export const startWorld = (project: Project): PlayWorld => {
  const world: PlayWorld = { flags: {}, items: {}, objects: {}, chosen: {}, arcs: {}, solved: {}, visited: {}, fired: {}, picked: {}, quests: {}, won: {}, met: {}, metCharacters: {}, found: {}, been: {}, used: {}, lore: {}, mechanics: {}, skills: {} };
  for (const o of Object.values(project.objects)) {
    const initial = initialState(o);
    if (o.type === 'state' && initial !== undefined) world.flags[o.id] = initial;
    if (o.type === 'object' && initial !== undefined) world.objects[o.id] = initial;
  }
  return world;
};

const name = (project: Project, id: string) => project.objects[id]?.name ?? '?';
const ruleOf = (o: StoryObject | undefined) => o?.data.rule as Rule | undefined;
const effectsOf = (o: StoryObject | undefined) => o?.data.effects as Effect[] | undefined;

/** Both rules must hold (either may be empty). */
const both = (a: Rule | undefined, b: Rule | undefined): Rule | undefined => (isEmpty(a) ? b : isEmpty(b) ? a : { match: 'all', items: [a!, b!] });

interface Doing {
  project: Project;
  world: PlayWorld;
  log: Entry[];
}

const doEffects = (d: Doing, effects: Effect[] | undefined) => {
  for (const e of effects ?? []) {
    if (e.kind === 'fire') fire(d, e.ref);
    else if (e.kind === 'solve') solve(d, e.ref);
    else if (e.kind === 'startQuest') {
      const quest = d.project.objects[e.ref];
      if (quest && !d.world.quests[e.ref]) setQuest(d, quest, 'active');
    } else if (e.kind === 'completeQuest') {
      // Done at once, started or not, and its reward is paid.
      const quest = d.project.objects[e.ref];
      if (quest && d.world.quests[e.ref] !== 'done') setQuest(d, quest, 'done');
    } else if (e.kind === 'enableMechanic') {
      if (d.project.objects[e.ref] && !d.world.mechanics[e.ref]) {
        d.world = { ...d.world, mechanics: { ...d.world.mechanics, [e.ref]: true } };
        d.log.push({ kind: 'mechanic', text: name(d.project, e.ref) });
      }
    } else if (e.kind === 'learnSkill') gainRank(d, e.ref);
    else if (e.kind === 'revealLore') {
      if (d.project.objects[e.ref] && !d.world.lore[e.ref]) {
        d.world = { ...d.world, lore: { ...d.world.lore, [e.ref]: true } };
        d.log.push({ kind: 'lore', text: name(d.project, e.ref) });
      }
    }
    else {
      d.world = { ...d.world, ...apply([e], d.world) };
      d.log.push({ kind: 'effect', text: describeEffect(d.project, e) });
    }
  }
};

/** A rank of a skill, up to its ranks: logged, and what learning it does is done. */
const gainRank = (d: Doing, id: string) => {
  const skill = d.project.objects[id];
  if (!skill || skill.type !== 'skill') return;
  const ranks = ranksOf(skill);
  const rank = d.world.skills?.[id] ?? 0;
  if (rank >= ranks) return;
  d.world = { ...d.world, skills: { ...(d.world.skills ?? {}), [id]: rank + 1 } };
  d.log.push({ kind: 'skill', text: skill.name, rank: rank + 1, ranks });
  doEffects(d, effectsOf(skill));
};

const fire = (d: Doing, id: string) => {
  const trigger = d.project.objects[id];
  if (!trigger) return;
  d.world = { ...d.world, fired: { ...d.world.fired, [id]: true } };
  d.log.push({ kind: 'fired', text: `${trigger.name} fires` });
  // The older one-field link: a trigger that sets a state to its last value.
  const flag = trigger.data.setsFlag as string | undefined;
  if (flag && d.project.objects[flag]) {
    d.world = { ...d.world, flags: { ...d.world.flags, [flag]: statesOf(d.project.objects[flag]).at(-1) ?? '' } };
    d.log.push({ kind: 'effect', text: `${name(d.project, flag)} → ${d.world.flags[flag]}` });
  }
  doEffects(d, effectsOf(trigger));
};

const solve = (d: Doing, id: string) => {
  if (d.world.solved[id] || !d.project.objects[id]) return;
  d.world = { ...d.world, solved: { ...d.world.solved, [id]: true } };
  d.log.push({ kind: 'fired', text: `${name(d.project, id)} is solved` });
  doEffects(d, effectsOf(d.project.objects[id]));
};

const setQuest = (d: Doing, quest: StoryObject, state: QuestState) => {
  d.world = { ...d.world, quests: { ...d.world.quests, [quest.id]: state } };
  d.log.push({ kind: 'quest', text: quest.name, state, ...(state === 'active' && quest.data.goal ? { detail: String(quest.data.goal) } : {}) });
  if (state === 'done') doEffects(d, effectsOf(quest));
};

/**
 * Fire every trigger, and solve every puzzle, whose rule now holds (as the
 * engine runtime does after each change). A quest starts when its start rule
 * holds (at once, with none) and is done when its rule holds; its reward is
 * its effects. A quest with no rule to complete it stays under way.
 */
const settle = (d: Doing) => {
  // Anything now carried has been found.
  for (const [id, n] of Object.entries(d.world.items)) if (n > 0 && !d.world.found[id]) d.world = { ...d.world, found: { ...d.world.found, [id]: true } };
  for (let round = 0; round < 8; round++) {
    let moved = false;
    for (const o of Object.values(d.project.objects)) {
      if (o.type === 'trigger' && !isEmpty(ruleOf(o)) && !d.world.fired[o.id] && evaluate(ruleOf(o), d.world)) {
        fire(d, o.id);
        moved = true;
      }
      if (o.type === 'puzzle' && !isEmpty(ruleOf(o)) && !d.world.solved[o.id] && evaluate(ruleOf(o), d.world)) {
        solve(d, o.id);
        moved = true;
      }
      // Lore is discovered, and a mechanic becomes available, once its rule holds (at once with none).
      // (One set "Only by an effect" waits for an effect to do it.)
      if ((o.type === 'lore' || o.type === 'mechanic') && !o.data.byEffect && !d.world[o.type === 'lore' ? 'lore' : 'mechanics'][o.id] && evaluate(ruleOf(o), d.world)) {
        const key = o.type === 'lore' ? 'lore' : 'mechanics';
        d.world = { ...d.world, [key]: { ...d.world[key], [o.id]: true } };
        d.log.push({ kind: o.type, text: o.name });
        moved = true;
      }
      if (o.type === 'quest') {
        const state = d.world.quests[o.id];
        if (!state && !o.data.byEffect && evaluate(o.data.starts as Rule | undefined, d.world)) {
          setQuest(d, o, 'active');
          moved = true;
        } else if (state === 'active' && !isEmpty(ruleOf(o)) && evaluate(ruleOf(o), d.world)) {
          setQuest(d, o, 'done');
          moved = true;
        }
      }
    }
    if (!moved) return;
  }
};

/** A cinematic as it plays: its running time and camera notes, and each shot of its shot list. */
const cinematicEntry = (project: Project, id: string, text: string, event?: TimelineEvent): Entry => {
  const o = project.objects[id]!;
  const timing = cinematicTiming(project, id, event);
  const shots = shotsOf(o).map((s, i) => `${i + 1}. ${describeShot(project, s)} (${s.seconds}s${i < shotsOf(o).length - 1 && s.transition !== 'Cut' ? ` · ${s.transition.toLowerCase()}` : ''})`);
  return {
    kind: 'cinematic',
    text,
    detail: [`${timing.seconds}s · ${timing.shots} shot${timing.shots === 1 ? '' : 's'}`, (o.data.camera as string | undefined) ?? ''].filter(Boolean).join(' · '),
    ...(shots.length ? { shots } : {}),
    skippable: o.data.skippable !== 'Not skippable',
  };
};

// ---------------------------------------------------------------- where the story goes

const spineNext = (project: Project, id: string): string | null => {
  const spine = spineSequence(project);
  const at = spine.indexOf(id);
  return at >= 0 ? (spine[at + 1] ?? null) : null;
};

const eventRule = (project: Project, event: TimelineEvent): Rule | undefined =>
  both(both(event.when, eventLine(project, event)?.conditions), event.kind === 'choice' && event.refId ? ruleOf(project.objects[event.refId]) : undefined);

const trackOf = (project: Project, sceneId: string, track: string) => sceneTimeline(project, sceneId).find((t) => t.id === track);

/** A choice with nothing left to pick: every option gone, locked or not on offer. */
const stuck = (d: Doing, label: string): Cursor => {
  const text = `Stuck at ${label}: no option is left to pick.`;
  d.log.push({ kind: 'end', text });
  return { at: 'end', outcome: 'deadEnd', text };
};

/** One unit of the story: move the cursor on, writing what happened. */
const step = (d: Doing, cursor: Cursor, where: Play['where']): Cursor => {
  const { project } = d;
  if (cursor.at === 'node') {
    const o = project.objects[cursor.id];
    if (!o) return { at: 'end', outcome: 'deadEnd', text: 'The story points at something that is not there any more.' };
    where.nodeId = o.id;
    where.sceneId = null;
    where.eventId = null;
    const label = `${o.data.code ? `${o.data.code} ` : ''}${o.name}`;
    switch (o.type) {
      case 'begin':
        return { at: 'after', id: o.id };
      case 'end':
        d.log.push({ kind: 'end', text: o.name || 'The End' });
        return { at: 'end', outcome: 'ending', text: o.name || 'The End' };
      case 'scene': {
        d.world = { ...d.world, visited: { ...d.world.visited, [o.id]: true } };
        const at = o.data.locationId as string | undefined;
        if (at && project.objects[at] && !d.world.been[at]) d.world = { ...d.world, been: { ...d.world.been, [at]: true } };
        const location = o.data.locationId ? name(project, o.data.locationId as string).toUpperCase() : '';
        d.log.push({ kind: 'heading', id: o.id, text: label, sub: [location && `${o.data.intExt ?? 'INT.'} ${location} — ${o.data.time ?? 'DAY'}`, o.data.summary as string | undefined].filter(Boolean).join(' · ') });
        settle(d);
        where.sceneId = o.id;
        if (sceneTimeline(project, o.id)[0]!.events.length) return { at: 'event', sceneId: o.id, track: MAIN, index: 0 };
        return { at: 'wait', next: { at: 'after', id: o.id } };
      }
      case 'choice': {
        if (!evaluate(ruleOf(o), d.world)) {
          d.log.push({ kind: 'skip', text: label, needs: describeRule(project, ruleOf(o)) });
          return { at: 'after', id: o.id };
        }
        if (!graphOptions(project, d.world, o.id).some((x) => x.available)) return stuck(d, label);
        return { at: 'graphChoice', id: o.id };
      }
      case 'cinematic':
        d.log.push(cinematicEntry(project, o.id, label));
        return { at: 'wait', next: { at: 'after', id: o.id } };
      default:
        d.log.push({ kind: 'heading', id: o.id, text: label, sub: (o.data.summary as string | undefined) || o.notes || undefined });
        return { at: 'wait', next: { at: 'after', id: o.id } };
    }
  }

  if (cursor.at === 'after') {
    const o = project.objects[cursor.id];
    if (o?.data.outcome) {
      const text = o.data.outcome === 'gameOver' ? `Game over: ${o.name}` : `An ending: ${o.name}`;
      d.log.push({ kind: 'end', text });
      return { at: 'end', outcome: o.data.outcome, text };
    }
    // A route out whose conditions hold, in order; else on along the spine.
    const routes = project.connections.filter((c) => c.kind === 'branch' && c.sourceId === cursor.id && project.objects[c.targetId]);
    const route = routes.find((c) => evaluate(c.conditions, d.world));
    if (route) {
      if (route.label) d.log.push({ kind: 'picked', text: route.label });
      doEffects(d, route.effects);
      settle(d);
      return { at: 'node', id: route.targetId };
    }
    const next = spineNext(project, cursor.id);
    if (next) return { at: 'node', id: next };
    const text = routes.length ? `No way on from ${o?.name ?? 'here'}: no route out has its conditions met.` : `The story stops at ${o?.name ?? 'here'}: nothing comes after it.`;
    d.log.push({ kind: 'end', text });
    return { at: 'end', outcome: 'deadEnd', text };
  }

  if (cursor.at === 'event') {
    const track = trackOf(project, cursor.sceneId, cursor.track);
    const events = track?.events ?? [];
    if (cursor.index >= events.length) {
      if (track?.branch?.rejoinEventId) {
        const main = sceneTimeline(project, cursor.sceneId)[0]!.events;
        const at = main.findIndex((e) => e.id === track.branch!.rejoinEventId);
        if (at >= 0) return { at: 'event', sceneId: cursor.sceneId, track: MAIN, index: at };
      }
      return { at: 'after', id: cursor.sceneId };
    }
    const event = events[cursor.index]!;
    where.sceneId = cursor.sceneId;
    where.eventId = event.id;
    const onward: Cursor = { ...cursor, index: cursor.index + 1 };
    const rule = eventRule(project, event);
    if (!evaluate(rule, d.world)) {
      d.log.push({ kind: 'skip', text: event.kind === 'dialogue' ? `${eventTitle(project, event)}: ${eventLine(project, event)?.text ?? ''}` : eventTitle(project, event), needs: describeRule(project, rule) });
      return onward;
    }
    let next: Cursor;
    switch (event.kind) {
      case 'dialogue': {
        const line = eventLine(project, event);
        if (!line) {
          next = onward;
          break;
        }
        // Dual dialogue: the next event, if it is the speech set beside this one
        // (and may be spoken), is spoken at the same time — one beat, two voices.
        const after = events[cursor.index + 1];
        const other = after?.kind === 'dialogue' ? eventLine(project, after) : undefined;
        const together = !!other && spokenTogether(project, line.id, other.id) && evaluate(eventRule(project, after!), d.world);
        const voice = (l: DialogueLine): Voice => ({ speaker: l.speakerId ? name(project, l.speakerId) : null, text: l.text, direction: l.direction || undefined, lineId: l.id });
        // The speech on the left of the pair (the one the other is beside) reads first.
        const [first, second] = together && dualWith(project, line.id)?.id === other!.id ? [other!, line] : [line, other];
        d.log.push({ kind: 'line', ...voice(first), sceneId: first.sceneId, ...(together ? { with: voice(second!) } : {}) });
        for (const l of together ? [first, second!] : [first])
          if (l.speakerId && project.objects[l.speakerId] && !d.world.metCharacters[l.speakerId]) d.world = { ...d.world, metCharacters: { ...d.world.metCharacters, [l.speakerId]: true } };
        next = { at: 'wait', next: together ? { ...cursor, index: cursor.index + 2 } : onward };
        break;
      }
      case 'trigger':
        if (event.refId) fire(d, event.refId);
        next = onward;
        break;
      case 'cinematic':
        d.log.push(event.refId && project.objects[event.refId] ? cinematicEntry(project, event.refId, eventTitle(project, event), event) : { kind: 'cinematic', text: eventTitle(project, event), detail: event.detail });
        next = { at: 'wait', next: onward };
        break;
      case 'freePlay':
        next = { ...cursor, at: 'freePlay' };
        break;
      case 'encounter': {
        const o = event.refId ? project.objects[event.refId] : undefined;
        if (!o) {
          next = onward;
          break;
        }
        d.log.push({ kind: 'encounter', text: eventTitle(project, event), detail: [o.data.enemies, o.data.weakness && `weak to ${String(o.data.weakness).toLowerCase()}`].filter(Boolean).join(' · ') || undefined });
        if (!d.world.met[o.id]) d.world = { ...d.world, met: { ...d.world.met, [o.id]: true } };
        next = { ...cursor, at: 'encounter' };
        break;
      }
      case 'choice':
        // A choice's effects belong to its options.
        if (!sceneOptions(project, d.world, cursor.sceneId, event).some((x) => x.available)) return stuck(d, eventTitle(project, event));
        return { ...cursor, at: 'sceneChoice' };
      default:
        d.log.push({ kind: 'action', text: eventTitle(project, event), detail: event.detail || undefined });
        next = { at: 'wait', next: onward };
    }
    // What the event does happens as it plays, and may end a free play before it starts.
    doEffects(d, event.effects);
    settle(d);
    if (next.at === 'freePlay' && !isEmpty(event.ends) && evaluate(event.ends, d.world)) {
      d.log.push({ kind: 'action', text: `${event.label || 'Free play'} ends`, detail: describeRule(project, event.ends) });
      return onward;
    }
    return next;
  }
  return cursor;
};

/** Play on until the story needs the player: a Continue, a choice, a free play, or the end. */
const run = (project: Project, play: Play, log: Entry[] = []): Play => {
  const d: Doing = { project, world: play.world, log: [...play.log, ...log] };
  const where = { ...play.where };
  let cursor = play.cursor;
  const seen = new Map<string, number>();
  for (let n = 0; n < MAX_STEPS; n++) {
    if (cursor.at !== 'node' && cursor.at !== 'after' && cursor.at !== 'event') return { world: d.world, cursor, log: d.log, where, ...(play.decisions ? { decisions: play.decisions } : {}) };
    // A loop with nothing for the player to do would never end.
    const key = JSON.stringify(cursor);
    const times = (seen.get(key) ?? 0) + 1;
    seen.set(key, times);
    if (times > 50) break;
    cursor = step(d, cursor, where);
  }
  const text = 'The story goes round without stopping for the player here.';
  d.log.push({ kind: 'end', text });
  return { world: d.world, cursor: { at: 'end', outcome: 'loop', text }, log: d.log, where, ...(play.decisions ? { decisions: play.decisions } : {}) };
};

// ---------------------------------------------------------------- playing

/** Start at the Beginning, or at a node on the graph (a scene, say) with a fresh world. */
export const startPlay = (project: Project, from?: string): Play => {
  const begin = from && project.objects[from] ? from : Object.values(project.objects).find((o) => o.type === 'begin')?.id;
  // Quests with nothing to wait for are under way from the first moment.
  const d: Doing = { project, world: startWorld(project), log: [] };
  settle(d);
  const play: Play = { world: d.world, cursor: begin ? { at: 'node', id: begin } : { at: 'end', outcome: 'deadEnd', text: 'There is no Beginning.' }, log: d.log, where: { nodeId: null, sceneId: null, eventId: null } };
  return run(project, play);
};

/** Carry on past a line, an action or a cinematic. */
export const advance = (project: Project, play: Play): Play => (play.cursor.at === 'wait' ? run(project, { ...play, cursor: play.cursor.next }) : play);

/** Carry on until the next thing the player has to decide. */
export const playToDecision = (project: Project, play: Play): Play => {
  let next = play;
  for (let n = 0; n < 500 && next.cursor.at === 'wait'; n++) next = advance(project, next);
  return next;
};

/**
 * One option as the player sees it now, or null when it is not in the list:
 * gone once picked, or hidden until its conditions hold.
 */
const offer = (project: Project, world: PlayWorld, key: string, label: string, rule: Rule | undefined, behaviour: OptionBehaviour): (PlayOption & { key: string }) | null => {
  const picked = (world.picked[key] ?? 0) > 0;
  if (picked && behaviour.after === 'gone') return null;
  if (picked && behaviour.after === 'locked') return { key, label, available: false, needs: 'already chosen' };
  const available = evaluate(rule, world);
  if (!available && behaviour.hideUnavailable) return null;
  return { key, label, available, ...(available ? {} : { needs: describeRule(project, rule) }) };
};

/** The option keys the play-through remembers picks by (the engine code uses its own, from the same rules). */
export const optionKey = {
  onward: (choiceId: string) => `${choiceId}:onward`,
  main: (eventId: string) => `${eventId}:main`,
};

interface GraphOption extends PlayOption {
  key: string;
  to: string | null;
  effects?: Effect[];
}

const graphOptions = (project: Project, world: PlayWorld, id: string): GraphOption[] => {
  const onward = spineNext(project, id);
  const list: GraphOption[] = [];
  if (onward) list.push({ key: optionKey.onward(id), label: 'Carry on', available: true, to: onward });
  for (const c of project.connections) {
    if (c.kind !== 'branch' || c.sourceId !== id || !project.objects[c.targetId]) continue;
    const o = offer(project, world, c.id, c.label || name(project, c.targetId), c.conditions, c);
    if (o) list.push({ ...o, to: c.targetId, effects: c.effects });
  }
  return list;
};

interface SceneOption extends PlayOption {
  key: string;
  branchId: string | null;
  effects?: Effect[];
}

const sceneOptions = (project: Project, world: PlayWorld, sceneId: string, event: TimelineEvent): SceneOption[] => {
  const list: SceneOption[] = [];
  const main = offer(project, world, optionKey.main(event.id), event.mainLabel || 'Carry on', undefined, { after: event.mainAfter });
  if (main) list.push({ ...main, branchId: null, effects: event.effects });
  for (const b of project.branches) {
    if (b.sceneId !== sceneId || b.choiceEventId !== event.id) continue;
    const o = offer(project, world, b.id, b.label, b.when, b);
    if (o) list.push({ ...o, branchId: b.id, effects: b.effects });
  }
  return list;
};

/** An encounter's two outcomes: Win (only when its rule holds) and Lose, saying what losing leads to. */
const encounterOptions = (project: Project, world: PlayWorld, o: StoryObject): PlayOption[] => {
  const win = evaluate(ruleOf(o), world);
  return [
    { label: 'Win', available: win, ...(win ? {} : { needs: describeRule(project, ruleOf(o)) }) },
    { label: `Lose · ${loseOf(o).toLowerCase()}`, available: true },
  ];
};

const remember = (d: Doing, key: string) => {
  d.world = { ...d.world, picked: { ...d.world.picked, [key]: (d.world.picked[key] ?? 0) + 1 } };
};

const eventAt = (project: Project, c: { sceneId: string; track: string; index: number }) => trackOf(project, c.sceneId, c.track)?.events[c.index];

const chooseHere = (project: Project, play: Play, index: number): Play => {
  const c = play.cursor;
  const d: Doing = { project, world: play.world, log: [...play.log] };
  if (c.at === 'graphChoice') {
    const option = graphOptions(project, play.world, c.id)[index];
    if (!option?.available || !option.to) return play;
    d.log.push({ kind: 'picked', text: option.label });
    remember(d, option.key);
    d.world = { ...d.world, chosen: { ...d.world.chosen, [c.id]: option.label } };
    doEffects(d, option.effects);
    settle(d);
    return run(project, { ...play, world: d.world, log: d.log, cursor: { at: 'node', id: option.to } });
  }
  if (c.at === 'encounter') {
    const event = eventAt(project, c);
    const o = event?.refId ? project.objects[event.refId] : undefined;
    if (!o || !encounterOptions(project, play.world, o)[index]?.available) return play;
    const onward: Cursor = { at: 'event', sceneId: c.sceneId, track: c.track, index: c.index + 1 };
    if (index === 0) {
      d.log.push({ kind: 'picked', text: `Won: ${o.name}` });
      d.world = { ...d.world, won: { ...d.world.won, [o.id]: true }, met: d.world.met[o.id] ? d.world.met : { ...d.world.met, [o.id]: true } };
      doEffects(d, effectsOf(o));
      settle(d);
      return run(project, { ...play, world: d.world, log: d.log, cursor: onward });
    }
    d.log.push({ kind: 'picked', text: `Lost: ${o.name}` });
    doEffects(d, o.data.loseEffects as Effect[] | undefined);
    settle(d);
    const loss = loseOf(o);
    if (loss === 'Game over') {
      const text = `Game over: lost to ${o.name}`;
      d.log.push({ kind: 'end', text });
      return { ...play, world: d.world, log: d.log, cursor: { at: 'end', outcome: 'gameOver', text } };
    }
    if (loss === 'Carry on') return run(project, { ...play, world: d.world, log: d.log, cursor: onward });
    d.log.push({ kind: 'action', text: `${o.name}: try again` });
    return { ...play, world: d.world, log: d.log };
  }
  if (c.at === 'sceneChoice') {
    const event = eventAt(project, c);
    if (!event) return play;
    const option = sceneOptions(project, play.world, c.sceneId, event)[index];
    if (!option?.available) return play;
    d.log.push({ kind: 'picked', text: option.label });
    remember(d, option.key);
    if (event.refId) d.world = { ...d.world, chosen: { ...d.world.chosen, [event.refId]: option.label } };
    doEffects(d, option.effects);
    settle(d);
    const cursor: Cursor = option.branchId ? { at: 'event', sceneId: c.sceneId, track: option.branchId, index: 0 } : { at: 'event', sceneId: c.sceneId, track: c.track, index: c.index + 1 };
    return run(project, { ...play, world: d.world, log: d.log, cursor });
  }
  return play;
};

const interactionAllowed = (project: Project, world: PlayWorld, object: StoryObject, i: ReturnType<typeof interactionsOf>[number]) => {
  const state = world.objects[object.id];
  if (i.when && i.when !== state) return { ok: false, needs: `${object.name} is ${i.when}` };
  if (!evaluate(i.requires, world)) return { ok: false, needs: describeRule(project, i.requires) };
  return { ok: true };
};

const interactionDoes = (project: Project, object: StoryObject, i: ReturnType<typeof interactionsOf>[number]) =>
  [
    i.becomes && `${object.name} → ${i.becomes}`,
    i.setsFlag && project.objects[i.setsFlag] && `${name(project, i.setsFlag)} → ${i.flagValue ?? ''}`,
    i.fires && project.objects[i.fires] && `fires ${name(project, i.fires)}`,
    ...(i.effects ?? []).map((e) => describeEffect(project, e)),
  ]
    .filter(Boolean)
    .join(' · ') || 'nothing else';

const useInteraction = (d: Doing, object: StoryObject, i: ReturnType<typeof interactionsOf>[number]) => {
  if (!d.world.used[object.id]) d.world = { ...d.world, used: { ...d.world.used, [object.id]: true } };
  if (i.becomes) {
    d.world = { ...d.world, objects: { ...d.world.objects, [object.id]: i.becomes } };
    d.log.push({ kind: 'effect', text: `${object.name} → ${i.becomes}` });
  }
  if (i.setsFlag && d.project.objects[i.setsFlag]) {
    d.world = { ...d.world, flags: { ...d.world.flags, [i.setsFlag]: i.flagValue ?? '' } };
    d.log.push({ kind: 'effect', text: `${name(d.project, i.setsFlag)} → ${i.flagValue ?? ''}` });
  }
  if (i.fires) fire(d, i.fires);
  doEffects(d, i.effects);
  settle(d);
};

// ---------------------------------------------------------------- the codex

export interface Codex {
  /** Quests under way, each with its goal, in the order they started. */
  underWay: { id: string; name: string; goal: string }[];
  /** Quests done, in the order they started. */
  done: { id: string; name: string }[];
  /** Characters met (heard speak) who have a codex entry, in the order met. */
  characters: { id: string; name: string; text: string }[];
  /** Objects used that have a codex entry, in the order first used, with their state now. */
  objects: { id: string; name: string; text: string; state: string }[];
  /** Locations visited that have a codex entry, in the order visited. */
  locations: { id: string; name: string; text: string }[];
  /** Items found that have a codex entry, in the order found, with how many are carried now. */
  items: { id: string; name: string; text: string; carried: number }[];
  /** Mechanics available, in the order they became available: how to use each. */
  mechanics: { id: string; name: string; controls: string; text: string }[];
  /** Skills, abilities and upgrades learned, in the order first learned: their rank, kind and tree, and what they do. */
  skills: { id: string; name: string; rank: number; ranks: number; kind: string; tree: string; effect: string; text: string }[];
  /** Encounters met, in the order met: who they are, what they are weak to, and whether they were won. */
  encounters: { id: string; name: string; enemies: string; weakness: string; text: string; won: boolean }[];
  /** Lore found, in the order found, with its text. */
  lore: { id: string; name: string; text: string }[];
  /** How many quests, mechanics, encounters and lore entries the project has (a section shows only when it has some). */
  quests: number;
  /** Characters with a codex entry (the others stay out of it). */
  charactersTotal: number;
  /** Locations, items and objects with a codex entry. */
  locationsTotal: number;
  itemsTotal: number;
  objectsTotal: number;
  mechanicsTotal: number;
  skillsTotal: number;
  encountersTotal: number;
  loreTotal: number;
}

/** A character's, location's, item's or object's codex entry, or undefined for anything else (or one without an entry). */
const CODEX_TYPES: readonly ObjectType[] = ['character', 'environment', 'inventory', 'object'];
const codexEntry = (o: StoryObject | undefined): string | undefined => (o && CODEX_TYPES.includes(o.type) && String(o.data.codex ?? '').trim() ? String(o.data.codex).trim() : undefined);

/** Encounters met, in the order met (one won counts as met). */
const metOf = (world: PlayWorld): string[] => [...new Set([...Object.keys(world.met).filter((id) => world.met[id]), ...Object.keys(world.won).filter((id) => world.won[id])])];

/** The codex as the player reads it, the same as the engines' codex screens show it. */
export const codexOf = (project: Project, world: PlayWorld): Codex => {
  const all = Object.values(project.objects);
  const known = (id: string) => project.objects[id];
  const quests = Object.keys(world.quests).filter(known);
  return {
    underWay: quests.filter((id) => world.quests[id] !== 'done').map((id) => ({ id, name: name(project, id), goal: String(project.objects[id]!.data.goal ?? '') })),
    done: quests.filter((id) => world.quests[id] === 'done').map((id) => ({ id, name: name(project, id) })),
    characters: Object.keys(world.metCharacters)
      .filter((id) => world.metCharacters[id] && codexEntry(project.objects[id]))
      .map((id) => ({ id, name: name(project, id), text: codexEntry(project.objects[id])! })),
    locations: Object.keys(world.been)
      .filter((id) => world.been[id] && codexEntry(project.objects[id]))
      .map((id) => ({ id, name: name(project, id), text: codexEntry(project.objects[id])! })),
    items: Object.keys(world.found)
      .filter((id) => world.found[id] && codexEntry(project.objects[id]))
      .map((id) => ({ id, name: name(project, id), text: codexEntry(project.objects[id])!, carried: world.items[id] ?? 0 })),
    objects: Object.keys(world.used)
      .filter((id) => world.used[id] && codexEntry(project.objects[id]))
      .map((id) => ({ id, name: name(project, id), text: codexEntry(project.objects[id])!, state: world.objects[id] ?? '' })),
    mechanics: Object.keys(world.mechanics)
      .filter((id) => world.mechanics[id] && known(id))
      .map((id) => ({ id, name: name(project, id), controls: String(project.objects[id]!.data.controls ?? ''), text: project.objects[id]!.notes })),
    skills: Object.keys(world.skills ?? {})
      .filter((id) => (world.skills[id] ?? 0) > 0 && project.objects[id]?.type === 'skill')
      .map((id) => {
        const o = project.objects[id]!;
        return { id, name: o.name, rank: world.skills[id]!, ranks: ranksOf(o), kind: kindOf(o), tree: treeOf(o), effect: String(o.data.effect ?? '').trim(), text: o.notes };
      }),
    encounters: metOf(world)
      .filter(known)
      .map((id) => {
        const o = project.objects[id]!;
        return { id, name: o.name, enemies: String(o.data.enemies ?? ''), weakness: String(o.data.weakness ?? ''), text: o.notes, won: !!world.won[id] };
      }),
    lore: Object.keys(world.lore)
      .filter((id) => world.lore[id] && known(id))
      .map((id) => ({ id, name: name(project, id), text: project.objects[id]!.notes })),
    quests: all.filter((o) => o.type === 'quest').length,
    charactersTotal: all.filter((o) => o.type === 'character' && codexEntry(o)).length,
    locationsTotal: all.filter((o) => o.type === 'environment' && codexEntry(o)).length,
    itemsTotal: all.filter((o) => o.type === 'inventory' && codexEntry(o)).length,
    objectsTotal: all.filter((o) => o.type === 'object' && codexEntry(o)).length,
    mechanicsTotal: all.filter((o) => o.type === 'mechanic').length,
    skillsTotal: all.filter((o) => o.type === 'skill').length,
    encountersTotal: all.filter((o) => o.type === 'encounter').length,
    loreTotal: all.filter((o) => o.type === 'lore').length,
  };
};

/** One section of the codex in words: its heading, and each entry as the codex writes it. */
export interface CodexSection {
  key: 'quests' | 'characters' | 'locations' | 'items' | 'objects' | 'mechanics' | 'skills' | 'encounters' | 'lore';
  heading: string;
  /** What an empty section says. */
  empty: string;
  /** Between the heading and each entry: quest lines sit close, the rest have a blank line. */
  sep: string;
  /** `key` names the entry for bookmarks: its section and its id ("lore:…"). */
  entries: { id: string; key: string; text: string; bookmarked?: boolean; note?: string }[];
}

/** How a player's note on an entry reads, on its own line after the entry. */
export const NOTE_LABEL = 'Note: ';

/** The mark on a bookmarked entry, at the end of its first line. */
export const BOOKMARK_MARK = ' ★';
/** A bookmarked entry as the codex writes it: the mark at the end of its first line. */
const marked = (text: string) => (text.includes('\n') ? text.replace('\n', `${BOOKMARK_MARK}\n`) : text + BOOKMARK_MARK);

/** Whether a search finds an entry: the query, ignoring case, anywhere in the entry as written (its heading and counts aside). */
export const codexMatches = (text: string, query: string) => !query.trim() || text.toLowerCase().includes(query.trim().toLowerCase());

/** Each section's name, for a filter by section and for "Nothing matches … in Lore" (and the bookmarks, a filter across them all). */
export const CODEX_SECTION_NAMES: Record<CodexSection['key'] | 'bookmarks', string> = {
  bookmarks: 'Bookmarks',
  quests: 'Quests',
  characters: 'Characters',
  locations: 'Locations',
  items: 'Items',
  objects: 'Objects',
  mechanics: 'Mechanics',
  skills: 'Skills',
  encounters: 'Encounters',
  lore: 'Lore',
};

/** How the codex orders each section's entries: as found (the default), newest first, or by name (A–Z, ignoring case). */
export type CodexSort = 'found' | 'newest' | 'name';
export const CODEX_SORTS: { key: CodexSort; label: string }[] = [
  { key: 'found', label: 'Order found' },
  { key: 'newest', label: 'Newest first' },
  { key: 'name', label: 'A–Z' },
];

/** Entries in a sort's order. Quests keep those under way before those done, each group in that order. */
const sortEntries = <T extends { text: string }>(entries: T[], sort: string): T[] =>
  sort === 'newest' ? [...entries].reverse() : sort === 'name' ? [...entries].sort((a, b) => (a.text.toLowerCase() < b.text.toLowerCase() ? -1 : a.text.toLowerCase() > b.text.toLowerCase() ? 1 : 0)) : entries;

/**
 * The codex's sections in words, the same as Godot, Unity and Unreal write
 * them. With a search, only the entries it finds, and only the sections with
 * any (their headings still count everything). With a section, only that one.
 * With a sort, each section's entries in that order. With bookmarks (entry
 * keys, "lore:…"), those entries are marked; the section "bookmarks" shows
 * only them, from every section. With notes (by entry key), each entry carries
 * the player's note, and a search looks in the notes too.
 */
export const codexSections = (
  project: Project,
  world: PlayWorld,
  query = '',
  section = '',
  sort = '',
  bookmarks: ReadonlySet<string> = new Set(),
  notes: ReadonlyMap<string, string> = new Map(),
): CodexSection[] => {
  const c = codexOf(project, world);
  type Raw = Omit<CodexSection, 'entries'> & { entries: { id: string; text: string }[] };
  const all: (Raw | false)[] = [
    !!c.quests && {
      key: 'quests',
      heading: `QUESTS · ${c.underWay.length} under way, ${c.done.length} done`,
      empty: 'None yet.',
      sep: '\n',
      entries: [
        ...sortEntries(c.underWay.map((q) => ({ id: q.id, text: `• ${q.name}${q.goal ? ` — ${q.goal}` : ''}` })), sort),
        ...sortEntries(c.done.map((q) => ({ id: q.id, text: `• ${q.name} (done)` })), sort),
      ],
    },
    !!c.charactersTotal && {
      key: 'characters',
      heading: `CHARACTERS · ${c.characters.length} of ${c.charactersTotal} met`,
      empty: 'None yet.',
      sep: '\n\n',
      entries: c.characters.map((ch) => ({ id: ch.id, text: `${ch.name.toUpperCase()}\n${ch.text}` })),
    },
    !!c.locationsTotal && {
      key: 'locations',
      heading: `LOCATIONS · ${c.locations.length} of ${c.locationsTotal} visited`,
      empty: 'None yet.',
      sep: '\n\n',
      entries: c.locations.map((l) => ({ id: l.id, text: `${l.name.toUpperCase()}\n${l.text}` })),
    },
    !!c.itemsTotal && {
      key: 'items',
      heading: `ITEMS · ${c.items.length} of ${c.itemsTotal} found`,
      empty: 'None yet.',
      sep: '\n\n',
      entries: c.items.map((i) => ({ id: i.id, text: `${i.name.toUpperCase()}${i.carried > 1 ? ` (carried ×${i.carried})` : i.carried ? ' (carried)' : ''}\n${i.text}` })),
    },
    !!c.objectsTotal && {
      key: 'objects',
      heading: `OBJECTS · ${c.objects.length} of ${c.objectsTotal} used`,
      empty: 'None yet.',
      sep: '\n\n',
      entries: c.objects.map((o) => ({ id: o.id, text: `${o.name.toUpperCase()}${o.state ? ` (${o.state})` : ''}\n${o.text}` })),
    },
    !!c.mechanicsTotal && {
      key: 'mechanics',
      heading: `MECHANICS · ${c.mechanics.length} of ${c.mechanicsTotal} available`,
      empty: 'None yet.',
      sep: '\n\n',
      entries: c.mechanics.map((m) => ({ id: m.id, text: `${m.name.toUpperCase()}${m.controls ? `\nControls: ${m.controls}` : ''}\n${m.text}` })),
    },
    !!c.skillsTotal && {
      key: 'skills',
      heading: `SKILLS · ${c.skills.length} of ${c.skillsTotal} learned`,
      empty: 'None yet.',
      sep: '\n\n',
      entries: c.skills.map((k) => ({
        id: k.id,
        text: `${k.name.toUpperCase()}${k.ranks > 1 ? ` (rank ${k.rank} of ${k.ranks})` : ''}\n${k.kind}${k.tree ? ` · ${k.tree}` : ''}${k.effect ? `\nWhat it does: ${k.effect}` : ''}\n${k.text}`,
      })),
    },
    !!c.encountersTotal && {
      key: 'encounters',
      heading: `ENCOUNTERS · ${c.encounters.length} met, ${c.encounters.filter((e) => e.won).length} won`,
      empty: 'None yet.',
      sep: '\n\n',
      entries: c.encounters.map((e) => ({
        id: e.id,
        text: `${e.name.toUpperCase()}${e.won ? ' (won)' : ''}${e.enemies ? `\nEnemies: ${e.enemies}` : ''}${e.weakness ? `\nWeak to: ${e.weakness}` : ''}\n${e.text}`,
      })),
    },
    !!c.loreTotal && {
      key: 'lore',
      heading: `LORE · ${c.lore.length} of ${c.loreTotal} found`,
      empty: 'Nothing found yet.',
      sep: '\n\n',
      entries: c.lore.map((l) => ({ id: l.id, text: `${l.name.toUpperCase()}\n${l.text}` })),
    },
  ];
  const onlyBookmarks = section === 'bookmarks';
  const sections = all
    .filter((x): x is Raw => !!x && (!section || onlyBookmarks || x.key === section))
    .map((x): CodexSection => {
      const entries = (x.key === 'quests' ? x.entries : sortEntries(x.entries, sort)).map((e) => {
        const key = `${x.key}:${e.id}`;
        const note = notes.get(key)?.trim();
        return { ...e, key, bookmarked: bookmarks.has(key), ...(note ? { note } : {}) };
      });
      return { ...x, entries: onlyBookmarks ? entries.filter((e) => e.bookmarked) : entries };
    })
    .filter((x) => !onlyBookmarks || x.entries.length);
  if (!query.trim()) return sections;
  return sections.map((s) => ({ ...s, entries: s.entries.filter((e) => codexMatches(e.text, query) || (!!e.note && codexMatches(e.note, query))) })).filter((s) => s.entries.length);
};

/** The sections this codex has (those with anything to find), in order: what a filter by section offers. */
export const codexSectionKeys = (project: Project, world: PlayWorld): CodexSection['key'][] => codexSections(project, world).map((s) => s.key);

/** The codex in words, exactly as Godot, Unity and Unreal write it; with a search, only what it finds; with a section, only that one; with a sort, in that order. */
export const codexText = (
  project: Project,
  world: PlayWorld,
  query = '',
  section = '',
  sort = '',
  bookmarks: ReadonlySet<string> = new Set(),
  notes: ReadonlyMap<string, string> = new Map(),
): string => {
  const sections = codexSections(project, world, query, section, sort, bookmarks, notes);
  const within = section in CODEX_SECTION_NAMES ? ` in ${CODEX_SECTION_NAMES[section as keyof typeof CODEX_SECTION_NAMES]}` : '';
  if (query.trim() && !sections.length) return `CODEX\n\nNothing matches "${query.trim()}"${within}.`;
  if (section === 'bookmarks' && !sections.length) return 'CODEX\n\nNo bookmarks yet.';
  const parts = sections.map((s) => s.heading + (s.entries.length ? s.entries.map((e) => s.sep + (e.bookmarked ? marked(e.text) : e.text) + (e.note ? `\n${NOTE_LABEL}${e.note}` : '')).join('') : `\n${s.empty}`));
  return ['CODEX', ...parts].join('\n\n');
};

/**
 * The player's notes in words, to export: each entry with a note, section by
 * section in the codex's order, under "SECTION · the entry's first line". The
 * same as the engines' notes export writes.
 */
export const codexNotesText = (project: Project, world: PlayWorld, notes: ReadonlyMap<string, string>): string => {
  const parts: string[] = [];
  for (const s of codexSections(project, world, '', '', '', new Set(), notes))
    for (const e of s.entries) if (e.note) parts.push(`${s.key.toUpperCase()} · ${e.text.split('\n')[0]!.replace(/^• /, '')}\n${e.note}`);
  return [`CODEX NOTES · ${project.name}`, ...(parts.length ? parts : ['No notes yet.'])].join('\n\n');
};

/** The style of the printable notes page (the same in the engines' printable page). */
export const NOTES_PRINT_STYLE =
  'body{font-family:Georgia,serif;margin:2em auto;max-width:40em;color:#111}h1{margin:0}.sub{margin:.2em 0 1.5em;color:#555}h2{border-bottom:1px solid #999;margin-top:1.5em}h3{margin:.8em 0 .2em;font-size:1em}p{margin:0 0 .4em}.note{break-inside:avoid}@page{margin:2cm}';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Exported notes (codexNotesText) as a page to print: the story's name, then
 * each section's notes under its name, entry by entry. The engines' codex
 * screens print the same page from the same text.
 */
export const notesPrintHtml = (notesText: string): string => {
  const [first = '', ...blocks] = notesText.replace(/\r\n?/g, '\n').split('\n\n');
  const name = first.replace(/^CODEX NOTES · /, '');
  const body: string[] = [];
  let section = '';
  for (const block of blocks) {
    const [head = '', ...rest] = block.split('\n');
    const at = head.indexOf(' · ');
    if (at < 0) {
      body.push(`<p>${escapeHtml(block)}</p>`);
      continue;
    }
    const s = head.slice(0, at);
    if (s !== section) body.push(`<h2>${escapeHtml(s.charAt(0) + s.slice(1).toLowerCase())}</h2>`);
    section = s;
    body.push(`<div class="note"><h3>${escapeHtml(head.slice(at + 3))}</h3><p>${rest.map(escapeHtml).join('<br>')}</p></div>`);
  }
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(name)} · codex notes</title><style>${NOTES_PRINT_STYLE}</style></head>\n<body><h1>${escapeHtml(name)}</h1><p class="sub">Codex notes</p>\n${body.join('\n')}\n</body></html>\n`;
};

/** The longest mail or text link the codex writes: longer ones are cut short by some apps and browsers. */
export const MAILTO_LIMIT = 2000;
/** A mail's or text's body when the notes are too long for its link: they go on the clipboard instead. */
export const MAIL_ON_CLIPBOARD = 'The notes are on the clipboard: paste them here.';

/** Percent-encoded as a mail or text link wants (UTF-8; letters, digits and - _ . ~ as they are). The same in the engines. */
const linkEncode = (s: string): string =>
  Array.from(new TextEncoder().encode(s), (b) => {
    const c = String.fromCharCode(b);
    return /[A-Za-z0-9\-_.~]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }).join('');

/** A link of head and body, or (whole false) of head and the clipboard note when that is too long. */
const notesLink = (head: string, body: string): { url: string; whole: boolean } => {
  const url = head + linkEncode(body);
  return url.length <= MAILTO_LIMIT ? { url, whole: true } : { url: head + linkEncode(MAIL_ON_CLIPBOARD), whole: false };
};

/**
 * A mail of exported notes (codexNotesText), as a link that opens the
 * player's mail app: "<story> codex notes" and the notes. When they are too
 * long for a link (whole false), its body says they are on the clipboard,
 * and the caller puts them there. The engines' codex screens write the same.
 */
export const notesMailto = (notesText: string): { url: string; whole: boolean } => {
  const text = notesText.replace(/\r\n?/g, '\n');
  return notesLink(`mailto:?subject=${linkEncode(`${text.split('\n')[0]!.replace(/^CODEX NOTES · /, '')} codex notes`)}&body=`, text.replace(/\n/g, '\r\n'));
};

/**
 * A text message of exported notes, as a link that opens the player's
 * messages app (sms:, which phones and most desktops with a messages app
 * take): the notes as the message, for the player to pick who to. Too long
 * for a link, as notesMailto. The engines' codex screens write the same.
 */
export const notesSms = (notesText: string): { url: string; whole: boolean } => notesLink('sms:?&body=', notesText.replace(/\r\n?/g, '\n'));

/**
 * An entry's name as notes are matched by: its first line without the quest
 * bullet, a quest's goal, or states in brackets ("(won)", "(carried ×2)"),
 * ignoring case. The same in the engines.
 */
export const codexNameOf = (firstLine: string): string => {
  let name = firstLine.trim().replace(/^• /, '');
  const dash = name.indexOf(' — ');
  if (dash >= 0) name = name.slice(0, dash);
  while (/ \([^()]*\)$/.test(name)) name = name.replace(/ \([^()]*\)$/, '');
  return name.trim().toLowerCase();
};

/**
 * Read notes exported from a codex (the studio's or an engine's): each
 * "SECTION · entry" block is matched to an entry in this codex by section and
 * name. Returns the notes matched, by entry key, and the headings of those
 * that match nothing here (not in the codex yet, or from another story).
 */
export const codexNotesFrom = (project: Project, world: PlayWorld, text: string): { notes: Map<string, string>; skipped: string[] } => {
  const byName = new Map<string, string>();
  for (const s of codexSections(project, world))
    for (const e of s.entries) byName.set(`${s.key}|${codexNameOf(e.text.split('\n')[0]!)}`, e.key);
  const notes = new Map<string, string>();
  const skipped: string[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const [head = '', ...rest] = block.trim().split('\n');
    const at = head.indexOf(' · ');
    if (at < 0 || head.startsWith('CODEX NOTES')) continue;
    const section = head.slice(0, at).trim().toLowerCase();
    const note = rest.join('\n').trim();
    if (!note) continue;
    const key = byName.get(`${section}|${codexNameOf(head.slice(at + 3))}`);
    if (key) notes.set(key, note);
    else skipped.push(head.trim());
  }
  return { notes, skipped };
};

/** How far the codex has come (quests started and done, characters met, locations visited, items found, objects used, mechanics available, encounters met and won, lore found), for counting what is new since it was read. */
export const codexProgress = (project: Project, world: PlayWorld): number =>
  Object.keys(world.metCharacters).filter((id) => world.metCharacters[id] && codexEntry(project.objects[id])).length +
  Object.keys(world.found).filter((id) => world.found[id] && codexEntry(project.objects[id])).length +
  Object.keys(world.been).filter((id) => world.been[id] && codexEntry(project.objects[id])).length +
  Object.keys(world.used).filter((id) => world.used[id] && codexEntry(project.objects[id])).length +
  Object.keys(world.lore).filter((id) => world.lore[id]).length +
  metOf(world).length + Object.keys(world.won).filter((id) => world.won[id]).length +
  Object.keys(world.mechanics).filter((id) => world.mechanics[id]).length +
  Object.keys(world.skills ?? {}).reduce((n, id) => n + (project.objects[id]?.type === 'skill' ? (world.skills[id] ?? 0) : 0), 0) +
  Object.values(world.quests).reduce((n, q) => n + (q === 'done' ? 2 : 1), 0);

// ---------------------------------------------------------------- for the level's play mode

/** What changed in words, for a log. */
export interface Changed {
  world: PlayWorld;
  log: Entry[];
}

/** Fire every trigger and solve every puzzle whose rule now holds (after a hand edit, say). */
export const settleWorld = (project: Project, world: PlayWorld): Changed => {
  const d: Doing = { project, world, log: [] };
  settle(d);
  return { world: d.world, log: d.log };
};

/** Do effects to the world, the way the timeline and choices do them, then settle. */
export const applyStoryEffects = (project: Project, world: PlayWorld, effects: Effect[] | undefined): Changed => {
  const d: Doing = { project, world, log: [] };
  doEffects(d, effects);
  settle(d);
  return { world: d.world, log: d.log };
};

/**
 * Use a story object the way free play does: its first interaction that is
 * allowed now. Returns what it needs instead when none is.
 */
export const useStoryObject = (project: Project, world: PlayWorld, objectId: string): Changed & { verb?: string; needs?: string } => {
  const object = project.objects[objectId];
  if (!object) return { world, log: [] };
  const all = interactionsOf(object);
  const i = all.find((x) => interactionAllowed(project, world, object, x).ok);
  if (!i) return { world, log: [], needs: all[0] ? interactionAllowed(project, world, object, all[0]).needs : undefined };
  const d: Doing = { project, world, log: [{ kind: 'did', text: `${i.verb} the ${object.name}` }] };
  useInteraction(d, object, i);
  return { world: d.world, log: d.log, verb: i.verb };
};

/** Use an object during free play; the free play ends by itself if that makes its rule hold. */
const interactHere = (project: Project, play: Play, objectId: string, interactionId: string): Play => {
  const c = play.cursor;
  const object = project.objects[objectId];
  if (c.at !== 'freePlay' || !object) return play;
  const i = interactionsOf(object).find((x) => x.id === interactionId);
  if (!i || !interactionAllowed(project, play.world, object, i).ok) return play;
  const d: Doing = { project, world: play.world, log: [...play.log, { kind: 'did', text: `${i.verb} the ${object.name}` }] };
  useInteraction(d, object, i);
  const event = eventAt(project, c);
  if (event && !isEmpty(event.ends) && evaluate(event.ends, d.world)) {
    d.log.push({ kind: 'action', text: `${event.label || 'Free play'} ends`, detail: describeRule(project, event.ends) });
    return run(project, { ...play, world: d.world, log: d.log, cursor: { at: 'event', sceneId: c.sceneId, track: c.track, index: c.index + 1 } });
  }
  return { ...play, world: d.world, log: d.log };
};

const endHere = (project: Project, play: Play): Play => {
  const c = play.cursor;
  if (c.at !== 'freePlay') return play;
  const event = eventAt(project, c);
  return run(project, { ...play, cursor: { at: 'event', sceneId: c.sceneId, track: c.track, index: c.index + 1 } }, [{ kind: 'action', text: `${event?.label || 'Free play'} ends (skipped)` }]);
};

/** What the decision on offer is made at: a graph choice, a scene's choice or encounter (by its story object), or a free play (by its event). */
export const decisionAt = (project: Project, play: Play): string | null => {
  const c = play.cursor;
  if (c.at === 'graphChoice') return c.id;
  if (c.at !== 'sceneChoice' && c.at !== 'encounter' && c.at !== 'freePlay') return null;
  const e = eventAt(project, c);
  return c.at !== 'freePlay' && e?.refId ? e.refId : (e?.id ?? `${c.sceneId}/${c.track}/${c.index}`);
};

/** The play after a decision, with the decision kept on its path (unless nothing happened). */
const noted = (before: Play, after: Play, decision: Decision | null): Play =>
  after === before || !decision ? after : { ...after, decisions: [...(before.decisions ?? []), decision] };

/** Pick an option of the choice on offer (by its place in the prompt's list). */
export const choose = (project: Project, play: Play, index: number): Play => {
  const at = decisionAt(project, play);
  const prompt = promptOf(project, play);
  const option = prompt.kind === 'choice' ? prompt.options[index] : undefined;
  const decision: Decision | null = !at || !option ? null : play.cursor.at === 'encounter' ? { kind: 'encounter', at, won: index === 0 } : { kind: 'choice', at, option: option.label };
  return noted(play, chooseHere(project, play, index), decision);
};

/** Use an object in free play (one of its verbs). */
export const interact = (project: Project, play: Play, objectId: string, interactionId: string): Play => {
  const at = decisionAt(project, play);
  return noted(play, interactHere(project, play, objectId, interactionId), at ? { kind: 'use', at, object: objectId, interaction: interactionId } : null);
};

/** Leave a free play now (the player moves on, or the designer skips ahead). */
export const endFreePlay = (project: Project, play: Play): Play => {
  const at = decisionAt(project, play);
  return noted(play, endHere(project, play), at ? { kind: 'skip', at } : null);
};

/** Learn the next rank of a skill: pay its cost, gain the rank, do what it does, settle. Returns why not instead when it can't be. */
export const learnSkillIn = (project: Project, world: PlayWorld, id: string): Changed & { needs?: string } => {
  const check = learnCheck(project, world, id);
  if (!check.ok) return { world, log: [], needs: check.needs };
  const d: Doing = { project, world: { ...world, items: payFor(project, world, id) }, log: [] };
  const cost = describeCost(project, project.objects[id]!);
  if (cost !== 'Free') d.log.push({ kind: 'effect', text: `pay ${cost}` });
  gainRank(d, id);
  settle(d);
  return { world: d.world, log: d.log };
};

/** Learn a skill during the play-through, kept on its path as a decision. */
export const learn = (project: Project, play: Play, id: string): Play => {
  const r = learnSkillIn(project, play.world, id);
  if (r.needs) return play;
  return { ...play, world: r.world, log: [...play.log, ...r.log], decisions: [...(play.decisions ?? []), { kind: 'learn', at: id }] };
};

/** Change the world by hand, to try a path (the prompt on offer updates with it). */
export const setWorld = (project: Project, play: Play, change: (world: PlayWorld) => PlayWorld): Play => {
  const d: Doing = { project, world: change(play.world), log: [...play.log] };
  settle(d);
  return { ...play, world: d.world, log: d.log };
};

/** What the player is asked now, worked out from where the story is and what the world holds. */
export const promptOf = (project: Project, play: Play): Prompt => {
  const c = play.cursor;
  switch (c.at) {
    case 'wait':
      return { kind: 'continue' };
    case 'end':
      return { kind: 'end', outcome: c.outcome, text: c.text };
    case 'graphChoice': {
      const o = project.objects[c.id]!;
      return { kind: 'choice', title: `${o.data.code ? `${o.data.code} ` : ''}${o.name}`, prompt: String(o.data.prompt ?? ''), options: graphOptions(project, play.world, c.id).map(({ label, available, needs }) => ({ label, available, needs })) };
    }
    case 'sceneChoice': {
      const event = eventAt(project, c)!;
      const o = event.refId ? project.objects[event.refId] : undefined;
      return { kind: 'choice', title: o?.name ?? eventTitle(project, event), prompt: String(o?.data.prompt ?? ''), options: sceneOptions(project, play.world, c.sceneId, event).map(({ label, available, needs }) => ({ label, available, needs })) };
    }
    case 'encounter': {
      const event = eventAt(project, c)!;
      const o = project.objects[event.refId!]!;
      return { kind: 'choice', symbol: 'encounter', title: o.name, prompt: `Encounter: ${o.name}`, options: encounterOptions(project, play.world, o) };
    }
    case 'freePlay': {
      const event = eventAt(project, c)!;
      const objects = elementsIn(project, c.sceneId, 'objects')
        .concat(elementsIn(project, c.sceneId, 'puzzles'))
        .filter((o) => interactionsOf(o).length)
        .map((o) => ({
          id: o.id,
          name: o.name,
          ...(play.world.objects[o.id] ? { state: play.world.objects[o.id] } : {}),
          verbs: interactionsOf(o).map((i) => {
            const allowed = interactionAllowed(project, play.world, o, i);
            return { id: i.id, verb: i.verb, available: allowed.ok, ...(allowed.needs ? { needs: allowed.needs } : {}), does: interactionDoes(project, o, i) };
          }),
        }));
      return {
        kind: 'freePlay',
        title: event.label || 'Free play',
        ends: !isEmpty(event.ends) ? describeRule(project, event.ends) : event.endsWhen || 'when the player moves on',
        endsByRule: !isEmpty(event.ends),
        objects,
      };
    }
    default:
      return { kind: 'continue' };
  }
};
