import type { Project } from '../types';
import { assetOf, frameOf } from './geometry';
import { levelsOf } from './level';
import type { AssetDefinition, AssetRole, LevelItem, LevelSet } from './types';

/**
 * Multiplayer planning (spec §19 network spawn and replication metadata): how
 * many play a map at once, in which teams, where each team comes in, and what
 * every player has to see the same. The studio plays one player; it plans the
 * network for the engine team, who build it with Unreal's replication, Unity's
 * Netcode for GameObjects or Godot's multiplayer nodes.
 */

export interface NetworkPlan {
  /** Players at once, at most. */
  players: number;
  /** Team names, when players play in teams. Player starts say which team comes in there. */
  teams?: string[];
}

export const DEFAULT_NETWORK: NetworkPlan = { players: 4 };

/**
 * What the network does with an item:
 * - shared: the server holds its state and every player sees the same (a door, a pickup, an enemy);
 * - perPlayer: each player has their own (a collectible each player finds for themselves);
 * - server: only on the server, players never see it (a trigger, a spawner, game logic);
 * - local: built on every machine and never changes, so nothing to send (walls, props, lights).
 */
export type Replication = 'shared' | 'perPlayer' | 'server' | 'local';

export const REPLICATIONS: { id: Replication; label: string; hint: string }[] = [
  { id: 'shared', label: 'Shared', hint: 'The server holds its state; every player sees the same.' },
  { id: 'perPlayer', label: 'Each player’s own', hint: 'Every player has their own copy and state.' },
  { id: 'server', label: 'Server only', hint: 'Game logic on the server; players never see it.' },
  { id: 'local', label: 'Local', hint: 'Built on every machine and never changes: nothing to send.' },
];

/** An item's network settings, on the item. */
export interface ItemNet {
  replicate?: Replication;
  /** A player start's team. */
  team?: string;
}

const SHARED = new Set<AssetRole>(['door', 'elevator', 'pickup', 'inventory', 'weapon', 'ammo', 'health', 'container', 'gate', 'puzzle', 'interaction', 'npc', 'companion', 'enemy', 'neutral', 'crowd', 'hazard']);
const SERVER = new Set<AssetRole>(['playerStart', 'trigger', 'prerequisite', 'spawn', 'objective', 'checkpoint', 'damage']);
/** Actions that change what players see of their target. */
const CHANGES = new Set(['open', 'close', 'enable', 'disable', 'spawn', 'despawn']);

/** Items some rule changes the state of: they can't stay local. */
const changedBy = (set: LevelSet, levelId: string): Set<string> => {
  const out = new Set<string>();
  for (const i of set.items) if (i.levelId === levelId) for (const r of i.rules ?? []) for (const a of r.actions ?? []) if (CHANGES.has(a.kind)) out.add(a.target);
  return out;
};

/** What the network does with an item when the designer hasn't said: by what it is, and shared when a rule changes it. */
export const defaultReplication = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[], changed?: ReadonlySet<string>): Replication => {
  const role = assetOf(set, item, global).role;
  if (SHARED.has(role)) return 'shared';
  if (SERVER.has(role)) return 'server';
  if ((changed ?? changedBy(set, item.levelId)).has(item.id)) return 'shared';
  if (item.activeWhen) return 'shared';
  return 'local';
};

export const replicationOf = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[], changed?: ReadonlySet<string>): Replication => item.net?.replicate ?? defaultReplication(set, item, global, changed);

export interface NetworkLayout {
  plan: NetworkPlan;
  /** Player starts, with their team (null when the map has no teams or the start has none). */
  spawns: { id: string; team: string | null }[];
  /** Every shown item and what the network does with it. */
  items: { id: string; replicate: Replication; set: boolean }[];
}

/** The plan for a level, with its spawns and what each item does on the network; null when it has none. */
export const networkLayout = (project: Project, levelId: string, global?: readonly AssetDefinition[]): NetworkLayout | null => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  if (!level?.network) return null;
  const teams = (level.network.teams ?? []).filter(Boolean);
  const plan: NetworkPlan = { players: Math.max(1, Math.round(level.network.players)), ...(teams.length ? { teams } : {}) };
  const shown = set.items.filter((i) => i.levelId === levelId && !i.hidden);
  const changed = changedBy(set, levelId);
  return {
    plan,
    spawns: shown.filter((i) => assetOf(set, i, global).role === 'playerStart').map((i) => ({ id: i.id, team: teams.length && i.net?.team ? i.net.team : null })),
    items: shown.map((i) => ({ id: i.id, replicate: replicationOf(set, i, global, changed), set: !!i.net?.replicate })),
  };
};

export interface NetworkIssue {
  id: string;
  message: string;
  export: string;
}

/** Closer than this and two players come in inside each other. */
export const SPAWN_GAP = 1.5;

/**
 * Where the plan and the level disagree: too few places to come in for the
 * players (per team, when there are teams), starts in no team or one that
 * isn't there, starts on top of each other, a rule changing something that
 * isn't sent to the players, and something players have to see kept on the
 * server.
 */
export const networkIssues = (project: Project, levelId: string, global?: readonly AssetDefinition[]): NetworkIssue[] => {
  const layout = networkLayout(project, levelId, global);
  if (!layout) return [];
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId)!;
  const byId = new Map(set.items.map((i) => [i.id, i]));
  const name = (id: string) => byId.get(id)?.name ?? id;
  const out: NetworkIssue[] = [];
  const { players, teams } = layout.plan;
  const add = 'Place more player starts, or plan for fewer players.';
  if (teams) {
    const each = Math.ceil(players / teams.length);
    for (const team of teams) {
      const n = layout.spawns.filter((s) => s.team === team).length;
      if (n < each) out.push({ id: level.id, message: `Team ${team} has ${n} player ${n === 1 ? 'start' : 'starts'} for up to ${each} ${each === 1 ? 'player' : 'players'}.`, export: `${add} Each team needs a start for every player it can have: ${players} players in ${teams.length} teams is ${each} a team.` });
    }
    for (const s of layout.spawns) {
      const was = byId.get(s.id)?.net?.team;
      if (!was) out.push({ id: s.id, message: `${name(s.id)} is in no team.`, export: `Pick its team (${teams.join(', ')}) in its properties, or players of no team come in there.` });
      else if (!teams.includes(was)) out.push({ id: s.id, message: `${name(s.id)} is for team ${was}, which this map doesn’t have.`, export: `Pick one of its teams: ${teams.join(', ')}.` });
    }
  } else if (layout.spawns.length < players) {
    out.push({ id: level.id, message: `${level.name} has ${layout.spawns.length} player ${layout.spawns.length === 1 ? 'start' : 'starts'} for up to ${players} players.`, export: `${add} Players without a start of their own come in on top of each other.` });
  }
  // Starts on top of each other, on the same floor.
  const starts = layout.spawns.map((s) => byId.get(s.id)!);
  for (let a = 0; a < starts.length; a++)
    for (let b = a + 1; b < starts.length; b++) {
      const p = starts[a]!;
      const q = starts[b]!;
      if (p.floorId !== q.floorId) continue;
      const f = frameOf(set, p, global);
      const g = frameOf(set, q, global);
      const d = Math.hypot(f.x - g.x, f.y - g.y);
      if (d < SPAWN_GAP) out.push({ id: q.id, message: `${q.name} is ${d.toFixed(1)} m from ${p.name}: two players coming in at once land inside each other.`, export: `Keep player starts at least ${SPAWN_GAP} m apart.` });
    }
  // What rules change has to reach the players.
  const mode = new Map(layout.items.map((i) => [i.id, i.replicate]));
  const said = new Set<string>();
  for (const item of set.items.filter((i) => i.levelId === levelId && !i.hidden))
    for (const r of item.rules ?? [])
      for (const a of r.actions ?? []) {
        if (!CHANGES.has(a.kind) || said.has(a.target)) continue;
        const m = mode.get(a.target);
        if (m !== 'local') continue;
        said.add(a.target);
        out.push({ id: a.target, message: `${name(a.target)} is Local, but ${item.name} ${a.kind}s it: only the player who set it off would see that.`, export: 'Set it to Shared so the server sends the change to every player.' });
      }
  // Things players have to see, kept on the server.
  for (const i of layout.items) {
    if (i.replicate !== 'server' || !i.set) continue;
    const item = byId.get(i.id)!;
    const kind = assetOf(set, item, global).kind;
    if (kind === 'solid' || kind === 'hosted' || kind === 'space' || kind === 'light') out.push({ id: i.id, message: `${item.name} is Server only, so players won’t see it.`, export: 'Server only is for logic players never see. Set it to Shared, or Local if it never changes.' });
  }
  return out;
};
