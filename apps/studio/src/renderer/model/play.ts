import { initialState, interactionsOf, statesOf } from './details';
import { spineSequence } from './layout';
import { apply, describeEffect, describeRule, evaluate, isEmpty, type Effect, type PlayState, type Rule } from './rules';
import { elementsIn } from './scene';
import { eventLine, eventTitle, MAIN, sceneTimeline } from './timeline';
import type { Project, StoryObject, TimelineEvent } from './types';

/**
 * Play the story inside the studio, the way the generated engine code plays
 * it: from the Beginning along the spine, through each scene's timeline,
 * taking the options and routes whose conditions hold and doing what they
 * say. Triggers fire and puzzles solve themselves as their conditions come
 * true; a free play ends when its rule holds. Pure functions over the
 * project: every step returns a new playthrough, so the player can step back.
 */

export interface PlayWorld extends PlayState {
  /** Triggers that have fired (each fires once by its rule). */
  fired: Record<string, boolean>;
}

export type Entry =
  | { kind: 'heading'; text: string; sub?: string; id: string }
  | { kind: 'line'; speaker: string | null; text: string; direction?: string; sceneId: string; lineId: string }
  | { kind: 'action'; text: string; detail?: string }
  | { kind: 'cinematic'; text: string; detail?: string }
  | { kind: 'picked'; text: string }
  | { kind: 'did'; text: string }
  | { kind: 'effect'; text: string }
  | { kind: 'fired'; text: string }
  | { kind: 'skip'; text: string; needs: string }
  | { kind: 'end'; text: string };

type Cursor =
  | { at: 'node'; id: string }
  | { at: 'after'; id: string }
  | { at: 'event'; sceneId: string; track: string; index: number }
  | { at: 'wait'; next: Cursor }
  | { at: 'graphChoice'; id: string }
  | { at: 'sceneChoice'; sceneId: string; track: string; index: number }
  | { at: 'freePlay'; sceneId: string; track: string; index: number }
  | { at: 'end'; outcome: Outcome; text: string };

export type Outcome = 'ending' | 'gameOver' | 'deadEnd' | 'loop';

export interface Play {
  world: PlayWorld;
  cursor: Cursor;
  log: Entry[];
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
  | { kind: 'choice'; title: string; prompt: string; options: PlayOption[] }
  | { kind: 'freePlay'; title: string; ends: string; endsByRule: boolean; objects: { id: string; name: string; state?: string; verbs: PlayVerb[] }[] }
  | { kind: 'end'; outcome: Outcome; text: string };

const MAX_STEPS = 2000;

// ---------------------------------------------------------------- the world

export const startWorld = (project: Project): PlayWorld => {
  const world: PlayWorld = { flags: {}, items: {}, objects: {}, chosen: {}, arcs: {}, solved: {}, visited: {}, fired: {} };
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
    else {
      d.world = { ...d.world, ...apply([e], d.world) };
      d.log.push({ kind: 'effect', text: describeEffect(d.project, e) });
    }
  }
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

/** Fire every trigger, and solve every puzzle, whose rule now holds (as the engine runtime does after each change). */
const settle = (d: Doing) => {
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
    }
    if (!moved) return;
  }
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
        return { at: 'graphChoice', id: o.id };
      }
      case 'cinematic':
        d.log.push({ kind: 'cinematic', text: label, detail: (o.data.camera as string | undefined) ?? o.notes });
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
        if (line) d.log.push({ kind: 'line', speaker: line.speakerId ? name(project, line.speakerId) : null, text: line.text, direction: line.direction || undefined, sceneId: line.sceneId, lineId: line.id });
        next = line ? { at: 'wait', next: onward } : onward;
        break;
      }
      case 'trigger':
        if (event.refId) fire(d, event.refId);
        next = onward;
        break;
      case 'cinematic':
        d.log.push({ kind: 'cinematic', text: eventTitle(project, event), detail: event.refId ? ((project.objects[event.refId]?.data.camera as string | undefined) ?? '') : event.detail });
        next = { at: 'wait', next: onward };
        break;
      case 'freePlay':
        next = { ...cursor, at: 'freePlay' };
        break;
      case 'choice':
        // A choice's effects belong to its options.
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
    if (cursor.at !== 'node' && cursor.at !== 'after' && cursor.at !== 'event') return { world: d.world, cursor, log: d.log, where };
    // A loop with nothing for the player to do would never end.
    const key = JSON.stringify(cursor);
    const times = (seen.get(key) ?? 0) + 1;
    seen.set(key, times);
    if (times > 50) break;
    cursor = step(d, cursor, where);
  }
  const text = 'The story goes round without stopping for the player here.';
  d.log.push({ kind: 'end', text });
  return { world: d.world, cursor: { at: 'end', outcome: 'loop', text }, log: d.log, where };
};

// ---------------------------------------------------------------- playing

/** Start at the Beginning, or at a node on the graph (a scene, say) with a fresh world. */
export const startPlay = (project: Project, from?: string): Play => {
  const begin = from && project.objects[from] ? from : Object.values(project.objects).find((o) => o.type === 'begin')?.id;
  const play: Play = { world: startWorld(project), cursor: begin ? { at: 'node', id: begin } : { at: 'end', outcome: 'deadEnd', text: 'There is no Beginning.' }, log: [], where: { nodeId: null, sceneId: null, eventId: null } };
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

interface GraphOption extends PlayOption {
  to: string | null;
  effects?: Effect[];
}

const graphOptions = (project: Project, world: PlayWorld, id: string): GraphOption[] => {
  const onward = spineNext(project, id);
  const routes = project.connections
    .filter((c) => c.kind === 'branch' && c.sourceId === id && project.objects[c.targetId])
    .map((c): GraphOption => {
      const available = evaluate(c.conditions, world);
      return { label: c.label || name(project, c.targetId), available, ...(available ? {} : { needs: describeRule(project, c.conditions) }), to: c.targetId, effects: c.effects };
    });
  return [...(onward ? [{ label: 'Carry on', available: true, to: onward }] : []), ...routes];
};

interface SceneOption extends PlayOption {
  branchId: string | null;
  effects?: Effect[];
}

const sceneOptions = (project: Project, world: PlayWorld, sceneId: string, event: TimelineEvent): SceneOption[] => [
  { label: event.mainLabel || 'Carry on', available: true, branchId: null, effects: event.effects },
  ...project.branches
    .filter((b) => b.sceneId === sceneId && b.choiceEventId === event.id)
    .map((b): SceneOption => {
      const available = evaluate(b.when, world);
      return { label: b.label, available, ...(available ? {} : { needs: describeRule(project, b.when) }), branchId: b.id, effects: b.effects };
    }),
];

const eventAt = (project: Project, c: { sceneId: string; track: string; index: number }) => trackOf(project, c.sceneId, c.track)?.events[c.index];

/** Pick an option of the choice on offer (by its place in the prompt's list). */
export const choose = (project: Project, play: Play, index: number): Play => {
  const c = play.cursor;
  const d: Doing = { project, world: play.world, log: [...play.log] };
  if (c.at === 'graphChoice') {
    const option = graphOptions(project, play.world, c.id)[index];
    if (!option?.available || !option.to) return play;
    d.log.push({ kind: 'picked', text: option.label });
    d.world = { ...d.world, chosen: { ...d.world.chosen, [c.id]: option.label } };
    doEffects(d, option.effects);
    settle(d);
    return run(project, { ...play, world: d.world, log: d.log, cursor: { at: 'node', id: option.to } });
  }
  if (c.at === 'sceneChoice') {
    const event = eventAt(project, c);
    if (!event) return play;
    const option = sceneOptions(project, play.world, c.sceneId, event)[index];
    if (!option?.available) return play;
    d.log.push({ kind: 'picked', text: option.label });
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

/** Use an object during free play; the free play ends by itself if that makes its rule hold. */
export const interact = (project: Project, play: Play, objectId: string, interactionId: string): Play => {
  const c = play.cursor;
  const object = project.objects[objectId];
  if (c.at !== 'freePlay' || !object) return play;
  const i = interactionsOf(object).find((x) => x.id === interactionId);
  if (!i || !interactionAllowed(project, play.world, object, i).ok) return play;
  const d: Doing = { project, world: play.world, log: [...play.log, { kind: 'did', text: `${i.verb} the ${object.name}` }] };
  if (i.becomes) {
    d.world = { ...d.world, objects: { ...d.world.objects, [object.id]: i.becomes } };
    d.log.push({ kind: 'effect', text: `${object.name} → ${i.becomes}` });
  }
  if (i.setsFlag && project.objects[i.setsFlag]) {
    d.world = { ...d.world, flags: { ...d.world.flags, [i.setsFlag]: i.flagValue ?? '' } };
    d.log.push({ kind: 'effect', text: `${name(project, i.setsFlag)} → ${i.flagValue ?? ''}` });
  }
  if (i.fires) fire(d, i.fires);
  doEffects(d, i.effects);
  settle(d);
  const event = eventAt(project, c);
  if (event && !isEmpty(event.ends) && evaluate(event.ends, d.world)) {
    d.log.push({ kind: 'action', text: `${event.label || 'Free play'} ends`, detail: describeRule(project, event.ends) });
    return run(project, { ...play, world: d.world, log: d.log, cursor: { at: 'event', sceneId: c.sceneId, track: c.track, index: c.index + 1 } });
  }
  return { ...play, world: d.world, log: d.log };
};

/** Leave a free play now (the player moves on, or the designer skips ahead). */
export const endFreePlay = (project: Project, play: Play): Play => {
  const c = play.cursor;
  if (c.at !== 'freePlay') return play;
  const event = eventAt(project, c);
  return run(project, { ...play, cursor: { at: 'event', sceneId: c.sceneId, track: c.track, index: c.index + 1 } }, [{ kind: 'action', text: `${event?.label || 'Free play'} ends (skipped)` }]);
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
