import { startWorld } from '../play';
import { isEmpty } from '../rules';
import type { Project } from '../types';
import { doorRules, type DoorRules } from './doors';
import { assetOf, frameOf, paramOf, spaceAt } from './geometry';
import { levelsOf } from './level';
import { floorCodes, OUTSIDE, structureGraph, type StructureEdge, type StructureIssue } from './structure';
import type { AssetDefinition, LevelItem } from './types';

/**
 * Can a structure be finished? (structure spec §11, §15.) A walk through it
 * as a player would go: from the way in, through every door that will open,
 * picking up what is lying in each room reached, opening locked doors once
 * their key is in hand (or breaking them), finding secret doors, then round
 * again until nothing more opens. What it reached, in the order it got
 * there, is the walkthrough; what it couldn't, and why, are the issues:
 *
 * - a key behind the door it opens, or keys behind each other's doors (a cycle);
 * - a locked door whose key is nowhere in the structure (the player must bring it);
 * - a one-way door with no way back and no way out beyond it (a softlock);
 * - an objective, a pickup or a trigger that can't be reached, or does nothing;
 * - a transition that leads nowhere.
 *
 * A door kept shut by a condition or a puzzle counts as open: the puzzle's
 * own check says whether it can be solved.
 */

export interface WalkStep {
  kind: 'enter' | 'reach' | 'take' | 'unlock' | 'break' | 'find' | 'objective';
  text: string;
  /** The item it is about: the room, the pickup, the door. */
  id?: string;
}

export interface Walkthrough {
  steps: WalkStep[];
  /** Rooms the walk reached (and OUTSIDE, if it started there). */
  reached: string[];
  /** Items the player holds at the end: what they came with and what they found. */
  held: string[];
  issues: StructureIssue[];
}

interface Source {
  /** The inventory item it gives. */
  gives: string;
  /** The pickup (or item with a rule) that gives it. */
  id: string;
  name: string;
  /** The room it is in. */
  room: string | undefined;
}

const PICKUP_ROLES = new Set(['pickup', 'inventory', 'weapon', 'ammo', 'health']);

export const walkStructure = (project: Project, levelId: string, global?: readonly AssetDefinition[]): Walkthrough => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  const empty: Walkthrough = { steps: [], reached: [], held: [], issues: [] };
  if (!level) return empty;
  const graph = structureGraph(set, levelId, global);
  const items = set.items.filter((i) => i.levelId === levelId && !i.hidden);
  const byId = new Map(items.map((i) => [i.id, i]));
  const role = (i: LevelItem) => assetOf(set, i, global).role;
  const label = (id: string) => (id === OUTSIDE ? 'Outside' : (byId.get(id)?.name ?? project.objects[id]?.name ?? '?'));
  // With more than one floor, a room says which it is on.
  const codes = floorCodes(level);
  const place = (id: string) => {
    const i = byId.get(id);
    return i && level.floors.length > 1 && assetOf(set, i, global).kind === 'space' ? `${i.name} (${codes.get(i.floorId) ?? '?'})` : label(id);
  };
  const thing = (id: string) => project.objects[id]?.name ?? 'an item that no longer exists';
  const roomOf = (i: LevelItem) => (assetOf(set, i, global).kind === 'space' ? i.id : spaceAt(set, levelId, i.floorId, { x: frameOf(set, i, global).x, y: frameOf(set, i, global).y }, global)?.id);
  const out: StructureIssue[] = [];
  const say = (severity: StructureIssue['severity'], id: string, message: string) => out.push({ severity, id, message });

  // What gives what, and where: pickups, and items whose rules give something.
  const sources: Source[] = [];
  for (const i of items) {
    const gives = PICKUP_ROLES.has(role(i)) ? String(paramOf(set, i, 'item', global) ?? '').trim() : '';
    if (gives) sources.push({ gives, id: i.id, name: i.name, room: roomOf(i) });
    for (const rule of i.rules ?? []) {
      if (rule.on !== 'pickup' && rule.on !== 'interact' && rule.on !== 'enter' && rule.on !== 'use') continue;
      for (const e of rule.effects ?? []) if (e.kind === 'give' && e.ref && e.ref !== gives) sources.push({ gives: e.ref, id: i.id, name: i.name, room: roomOf(i) });
    }
  }

  const doors = new Map<string, DoorRules>();
  for (const e of graph.edges) {
    const d = byId.get(e.via);
    if (e.kind === 'door' && d && !doors.has(d.id)) doors.set(d.id, doorRules(set, d, global));
  }

  // Switches: items whose rules open a door.
  const openers = new Map<string, LevelItem[]>();
  for (const i of items) for (const rule of i.rules ?? []) for (const a of rule.actions ?? []) if (a.kind === 'open' && doors.has(a.target)) openers.set(a.target, [...(openers.get(a.target) ?? []), i]);

  const startHeld = new Set(Object.entries(startWorld(project).items).filter(([, n]) => n > 0).map(([k]) => k));

  /** How the walk gets through an edge with these items in hand, or null if it can't. */
  const through = (e: StructureEdge, held: ReadonlySet<string>, reached: ReadonlySet<string>, force?: ReadonlySet<string>): 'open' | 'unlock' | 'break' | 'switch' | null => {
    const rules = doors.get(e.via);
    if (!rules || !rules.locked || force?.has(e.via)) return 'open';
    if ((openers.get(e.via) ?? []).some((i) => reached.has(roomOf(i) ?? ''))) return 'switch';
    if (rules.key && held.has(rules.key)) return 'unlock';
    if (rules.breakable && (!rules.breakWith || held.has(rules.breakWith))) return 'break';
    return null;
  };

  /** The walk to a standstill: from the start, round and round until nothing more opens. */
  const walk = (opts: { force?: ReadonlySet<string>; block?: ReadonlySet<string>; from?: string; held?: ReadonlySet<string>; record?: boolean } = {}) => {
    const start = opts.from ?? graph.start;
    const reached = new Set<string>();
    const held = new Set(opts.held ?? startHeld);
    const taken = new Set<string>();
    const steps: WalkStep[] = [];
    const used = new Set<string>();
    if (!start) return { reached, held, steps, used };
    reached.add(start);
    if (opts.record) steps.push(start === OUTSIDE ? { kind: 'enter', text: 'Come in from outside.' } : { kind: 'enter', text: `Start in ${place(start)}.`, id: start });
    for (let round = 0; round < 200; round++) {
      // Take what lies in every room reached.
      for (const src of sources) {
        if (taken.has(src.id + src.gives) || !src.room || !reached.has(src.room)) continue;
        taken.add(src.id + src.gives);
        if (!held.has(src.gives)) {
          held.add(src.gives);
          if (opts.record) steps.push({ kind: 'take', text: `Take ${thing(src.gives)} (${src.name}) in ${place(src.room)}.`, id: src.id });
        }
      }
      let grew = false;
      const queue = [...reached];
      while (queue.length) {
        const here = queue.shift()!;
        for (const e of graph.edges) {
          const there = e.from === here ? e.to : e.to === here && !e.oneWay ? e.from : null;
          if (!there || reached.has(there) || opts.block?.has(e.via)) continue;
          const how = through(e, held, reached, opts.force);
          if (!how) continue;
          if (opts.record && !used.has(e.via)) {
            const d = byId.get(e.via);
            const rules = doors.get(e.via);
            if (rules?.secret) steps.push({ kind: 'find', text: `Search the wall of ${place(here)}: ${d?.name ?? 'a secret door'}.`, id: e.via });
            if (how === 'unlock') steps.push({ kind: 'unlock', text: `Unlock ${d?.name} with ${thing(rules!.key)}.`, id: e.via });
            if (how === 'switch') steps.push({ kind: 'unlock', text: `Open ${d?.name} with ${(openers.get(e.via) ?? []).find((i) => reached.has(roomOf(i) ?? ''))?.name}.`, id: e.via });
            if (how === 'break') steps.push({ kind: 'break', text: `Break ${d?.name} open${rules!.breakWith ? ` with ${thing(rules!.breakWith)}` : ''}.`, id: e.via });
          }
          used.add(e.via);
          reached.add(there);
          queue.push(there);
          grew = true;
          if (opts.record && there !== OUTSIDE) steps.push({ kind: 'reach', text: `Reach ${place(there)}${e.vertical ? ` (${e.kind === 'elevator' ? 'lift' : e.kind})` : e.oneWay ? ' (one way)' : ''}.`, id: there });
        }
      }
      // Something new in hand may open a door on the next round.
      if (!grew && !sources.some((src) => !taken.has(src.id + src.gives) && src.room && reached.has(src.room))) break;
    }
    return { reached, held, steps, used };
  };

  if (!graph.start) return empty;
  const main = walk({ record: true });

  // Objectives (structure spec §10): in order, each where the walk can get to.
  for (const o of level.structure?.objectives ?? []) {
    const target = o.at ? byId.get(o.at) : undefined;
    const room = target ? roomOf(target) : undefined;
    if (o.at && !target) {
      say('error', level.id, `Objective “${o.text}” is at something no longer in ${level.name}.`);
      continue;
    }
    if (room && !main.reached.has(room)) say(o.optional ? 'warning' : 'error', target!.id, `Objective “${o.text}” can’t be reached: ${label(room)} is shut off.`);
    else if (room || (o.when && !isEmpty(o.when))) main.steps.push({ kind: 'objective', text: `${o.optional ? 'Optional: ' : ''}${o.text}${room ? ` (${label(room)})` : ''}.`, id: target?.id });
    if (!o.at && (!o.when || isEmpty(o.when))) say('warning', level.id, `Objective “${o.text}” has nowhere to be done and no condition: give it a room, an item or a condition.`);
  }

  // Locked doors the walk couldn't get through, and why.
  const shut = [...doors.entries()].filter(([id, r]) => r.locked && !main.used.has(id) && graph.edges.some((e) => e.via === id && (main.reached.has(e.from) || (!e.oneWay && main.reached.has(e.to)))));
  const shutIds = shut.map(([id]) => id);
  /** For each door the walk couldn't open, the doors its key is behind. */
  const behind = new Map<string, string[]>();
  for (const [id, r] of shut) {
    const name = label(id);
    if (!r.key) {
      say('warning', id, `${name} is locked and nothing opens it: set what it Needs, or make it breakable.`);
      continue;
    }
    if (!project.objects[r.key]) {
      say('error', id, `${name} needs an item that no longer exists.`);
      continue;
    }
    const keys = sources.filter((src) => src.gives === r.key);
    if (!keys.length) {
      say('warning', id, `${name} needs ${thing(r.key)}, which isn’t anywhere in ${level.name}: the player has to bring it in.`);
      continue;
    }
    const reachable = (w: ReturnType<typeof walk>) => keys.some((k) => k.room && w.reached.has(k.room));
    // With every other shut door open, is the key still out of reach without this one? Then it is behind it.
    const others = shutIds.filter((o) => o !== id);
    if (!reachable(walk({ force: new Set(others), block: new Set([id]) })) && reachable(walk({ force: new Set(shutIds) }))) {
      say('error', id, `${thing(r.key)} is behind ${name}, the door it opens: the player can never get it.`);
      continue;
    }
    // The shut doors every way to the key goes through.
    behind.set(
      id,
      others.filter((other) => !reachable(walk({ force: new Set(others.filter((o) => o !== other)), block: new Set([id, other]) }))),
    );
  }
  // Keys behind each other's doors: a cycle.
  const inCycle = new Set<string>();
  for (const [id] of behind) {
    const path: string[] = [];
    const visit = (d: string): string[] | null => {
      if (path.includes(d)) return path.slice(path.indexOf(d));
      path.push(d);
      for (const next of behind.get(d) ?? []) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
      path.pop();
      return null;
    };
    const cycle = visit(id);
    if (cycle && cycle[0] === id && !inCycle.has(id)) {
      cycle.forEach((d) => inCycle.add(d));
      const chain = cycle.map((d, n) => `${label(d)} needs ${thing(doors.get(d)!.key)}, behind ${label(cycle[(n + 1) % cycle.length]!)}`).join('; ');
      say('error', id, `Locked doors wait on each other: ${chain}.`);
    }
  }
  for (const [id, others] of behind) {
    if (inCycle.has(id)) continue;
    const r = doors.get(id)!;
    if (others.length) say('warning', id, `${label(id)} stays shut: ${thing(r.key)} is behind ${others.map(label).join(' or ')}, which the player can’t open.`);
    else say('warning', id, `${label(id)} stays shut: the player can’t get to ${thing(r.key)}.`);
  }

  // One-way doors: beyond one, is there a way back or a way out?
  const exits = new Set(graph.edges.filter((e) => e.kind === 'portal').map((e) => e.from));
  for (const i of items) if ((i.rules ?? []).some((r) => (r.actions ?? []).some((a) => a.kind === 'goToLevel'))) exits.add(roomOf(i) ?? '');
  for (const e of graph.edges) {
    if (!e.oneWay || !main.used.has(e.via) || e.to === OUTSIDE) continue;
    const beyond = walk({ from: e.to, held: main.held, block: new Set([e.via]) });
    const back = graph.start && beyond.reached.has(graph.start);
    const out1 = [...beyond.reached].some((r) => exits.has(r) || r === OUTSIDE);
    const done = (level.structure?.objectives ?? []).some((o) => !o.optional && o.at && byId.get(o.at) && beyond.reached.has(roomOf(byId.get(o.at)!) ?? ''));
    if (!back && !out1 && !done) say('warning', e.via, `Through ${label(e.via)} (one way) there’s no way back and no way out: the player is stuck in ${[...beyond.reached].map(label).join(', ')}.`);
  }

  // Secret doors the only way somewhere.
  for (const [id, r] of doors) {
    if (!r.secret || !main.used.has(id)) continue;
    const without = walk({ block: new Set([id]) });
    const only = [...main.reached].filter((x) => !without.reached.has(x) && x !== OUTSIDE);
    if (only.length) say('info', id, `Only the secret door ${label(id)} leads to ${only.map(label).join(', ')}.`);
  }

  // Keyed doors that aren't locked open for anyone.
  for (const [id, r] of doors) if (r.key && !r.locked) say('info', id, `${label(id)} names a key but isn’t locked: tick Locked to make it need ${thing(r.key)}.`);

  // Pickups and triggers: reachable, and doing something.
  for (const i of items) {
    const ro = role(i);
    const room = roomOf(i);
    if (PICKUP_ROLES.has(ro)) {
      if (!String(paramOf(set, i, 'item', global) ?? '').trim() && !(i.rules ?? []).length && ro !== 'health') say('info', i.id, `${i.name} gives nothing: set what it Gives.`);
      else if (room && !main.reached.has(room)) say('warning', i.id, `${i.name} can’t be reached: the player will never get it.`);
    }
    if (ro === 'trigger') {
      if (!(i.rules ?? []).length && !(i.links ?? []).length) say('info', i.id, `${i.name} does nothing: give it rules.`);
      else if (room && !main.reached.has(room)) say('warning', i.id, `${i.name} can’t be reached: it will never go off.`);
    }
    if (ro === 'portal') {
      const to = String(paramOf(set, i, 'to', global) ?? '').trim();
      if (!to) say('error', i.id, `${i.name} leads nowhere: set where it Leads to.`);
      else if (!set.levels.some((l) => l.id !== levelId && l.name.toLowerCase() === to.toLowerCase())) say('error', i.id, `${i.name} leads to “${to}”, which isn’t a map here.`);
    }
  }
  for (const i of items) {
    for (const rule of i.rules ?? []) {
      for (const a of rule.actions ?? []) {
        if (a.kind === 'goToLevel' && !set.levels.some((l) => l.id === a.target)) say('error', i.id, `${i.name} sends the player to a map that no longer exists.`);
      }
    }
  }

  return { steps: main.steps, reached: [...main.reached], held: [...main.held], issues: out };
};
