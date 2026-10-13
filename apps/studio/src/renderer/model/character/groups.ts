import { newId } from '../project';
import type { Project } from '../types';
import { profileOf } from './profile';

/**
 * Character groups and the population generator (Character Creator spec
 * §7): reusable named recipes (Village Market, Orc Patrol, Temple Priests),
 * each a list of entries (a character or one of its variants, a count or a
 * count range, a weight, what it does there) with how they spread over the
 * area they are put in: a formation, spacing, a wander radius, a route,
 * a density cap and a seed, so the same recipe in the same place always
 * gives the same people. A group is put in a level as a Character group
 * area; `populate` turns it into placeholder actors, the same on the 2D
 * map, in the 3D graybox and in Play Mode.
 */

export type Activity = 'wander' | 'idle' | 'talk' | 'work' | 'patrol' | 'guard';
export const ACTIVITIES: { id: Activity; label: string; hint: string }[] = [
  { id: 'wander', label: 'Wanders', hint: 'Strolls about within its wander radius' },
  { id: 'idle', label: 'Idles', hint: 'Stands, looking about' },
  { id: 'talk', label: 'Chats', hint: 'Faces the nearest of its group and talks' },
  { id: 'work', label: 'Works', hint: 'Stays at its spot, busy' },
  { id: 'patrol', label: 'Patrols', hint: 'Walks the group’s route, in formation' },
  { id: 'guard', label: 'Guards', hint: 'Holds its post; an enemy with AI reacts as its AI says' },
];

export type Formation = 'scatter' | 'cluster' | 'line' | 'column' | 'circle' | 'grid';
export const FORMATIONS: { id: Formation; label: string }[] = [
  { id: 'scatter', label: 'Scattered' },
  { id: 'cluster', label: 'In clusters' },
  { id: 'line', label: 'In a line' },
  { id: 'column', label: 'In a column' },
  { id: 'circle', label: 'In a ring' },
  { id: 'grid', label: 'In rows' },
];

export interface GroupEntry {
  id: string;
  character: string;
  /** One of the character's enemy variants; the base when absent. */
  variant?: string;
  min: number;
  max: number;
  /** How likely, against the other entries, a place the density cap leaves short goes to this one. */
  weight: number;
  activity: Activity;
}

export interface CharacterGroup {
  id: string;
  name: string;
  entries: GroupEntry[];
  formation: Formation;
  /** Metres between people, at least. */
  spacing: number;
  /** Metres each may wander from where it starts. */
  wanderRadius: number;
  /** The patrol (patrol nodes of that name in the level) a patrolling entry walks. */
  route: string;
  /** People per 100 m², at most; 0 for no cap. */
  density: number;
  /** When it is there: always, by day, by night, or when its rule holds (the story decides). */
  schedule: 'always' | 'day' | 'night';
  /** The faction they belong to, for allies, enemies and reactions. */
  faction: string;
  /** Kept as they are when the player leaves and comes back (killed stay killed). */
  persists: boolean;
  seed: number;
  notes: string;
}

export const groupsOf = (project: Project): CharacterGroup[] => project.characterGroups ?? [];

export const groupById = (project: Project, id: string): CharacterGroup | undefined => groupsOf(project).find((g) => g.id === id);

export const createGroup = (project: Project, name: string, entries: Omit<GroupEntry, 'id'>[] = []): { project: Project; id: string } => {
  const group: CharacterGroup = {
    id: newId('grp'),
    name: name.trim() || 'New group',
    entries: entries.map((e) => ({ ...e, id: newId('ge') })),
    formation: 'scatter',
    spacing: 1.2,
    wanderRadius: 6,
    route: '',
    density: 0,
    schedule: 'always',
    faction: '',
    persists: true,
    seed: 1 + Math.floor(Math.random() * 99999),
    notes: '',
  };
  return { project: { ...project, characterGroups: [...groupsOf(project), group] }, id: group.id };
};

export const updateGroup = (project: Project, id: string, patch: Partial<CharacterGroup>): Project => ({
  ...project,
  characterGroups: groupsOf(project).map((g) => (g.id === id ? { ...g, ...patch } : g)),
});

export const removeGroup = (project: Project, id: string): Project => ({ ...project, characterGroups: groupsOf(project).filter((g) => g.id !== id) });

export const duplicateGroup = (project: Project, id: string): { project: Project; id: string } | undefined => {
  const g = groupById(project, id);
  if (!g) return undefined;
  const copy: CharacterGroup = { ...structuredClone(g), id: newId('grp'), name: `${g.name} copy`, entries: g.entries.map((e) => ({ ...e, id: newId('ge') })) };
  return { project: { ...project, characterGroups: [...groupsOf(project), copy] }, id: copy.id };
};

export const addEntry = (project: Project, id: string, entry: Omit<GroupEntry, 'id'>): Project => {
  const g = groupById(project, id);
  return g ? updateGroup(project, id, { entries: [...g.entries, { ...entry, id: newId('ge') }] }) : project;
};

export const updateEntry = (project: Project, id: string, entryId: string, patch: Partial<GroupEntry>): Project => {
  const g = groupById(project, id);
  return g ? updateGroup(project, id, { entries: g.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)) }) : project;
};

export const removeEntry = (project: Project, id: string, entryId: string): Project => {
  const g = groupById(project, id);
  return g ? updateGroup(project, id, { entries: g.entries.filter((e) => e.id !== entryId) }) : project;
};

/** The fewest and most people it makes. */
export const headcount = (g: CharacterGroup): { min: number; max: number } => ({
  min: g.entries.reduce((n, e) => n + Math.max(0, e.min), 0),
  max: g.entries.reduce((n, e) => n + Math.max(0, e.max), 0),
});

export const groupProblems = (project: Project, g: CharacterGroup): { severity: 'error' | 'warning'; text: string }[] => {
  const out: { severity: 'error' | 'warning'; text: string }[] = [];
  if (!g.name.trim()) out.push({ severity: 'error', text: 'A group needs a name.' });
  if (!g.entries.length) out.push({ severity: 'warning', text: `${g.name}: no one in it yet.` });
  for (const e of g.entries) {
    const c = project.objects[e.character];
    if (c?.type !== 'character') {
      out.push({ severity: 'error', text: `${g.name}: a character in it is no longer in the registry.` });
      continue;
    }
    const p = profileOf(c);
    if (e.variant && !p.variants.some((v) => v.id === e.variant)) out.push({ severity: 'error', text: `${g.name}: ${c.name}’s variant is gone.` });
    if (e.min > e.max) out.push({ severity: 'error', text: `${g.name}: ${c.name} from ${e.min} to ${e.max}.` });
    if (e.max <= 0) out.push({ severity: 'warning', text: `${g.name}: ${c.name} with a count of 0.` });
    if (!p.enabled) out.push({ severity: 'warning', text: `${g.name}: ${c.name} is retired, so none appear.` });
    if (e.activity === 'patrol' && !g.route.trim()) out.push({ severity: 'warning', text: `${g.name}: ${c.name} patrols, but the group has no route: name a patrol.` });
    if (e.activity === 'guard' && !p.roles.includes('enemy') && !p.roles.includes('ally')) out.push({ severity: 'warning', text: `${g.name}: ${c.name} guards but has no AI (it isn’t an enemy or an ally), so it just stands.` });
  }
  if (g.spacing <= 0) out.push({ severity: 'warning', text: `${g.name}: a spacing of 0 lets people stand inside each other.` });
  return out;
};

// ---------------------------------------------------------------- the population generator

/** A small, fast, seeded random number generator (mulberry32): the same seed, the same people. */
export const rng = (seed: number) => {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Where a group is put: an area on the plan, a rectangle or an outline. */
export interface PlacementArea {
  x: number;
  y: number;
  w: number;
  d: number;
  /** Degrees, as level items turn. */
  rotation: number;
  /** Corners in the area's own frame, when it is freeform. */
  outline?: { x: number; y: number }[];
}

export interface CrowdMember {
  /** Stable while the group, the seed and the area stay the same: the place item's id with a number. */
  key: string;
  entryId: string;
  character: string;
  variant?: string;
  activity: Activity;
  x: number;
  y: number;
  /** Radians: 0 faces north (−y), clockwise, as the player's yaw. */
  yaw: number;
  /** For patrols: where it walks relative to the route (its place in the formation). */
  offset?: { x: number; y: number };
}

export interface Population {
  members: CrowdMember[];
  /** What it couldn't do: the density cap, places it couldn't fit people. */
  notes: string[];
}

const area = (a: PlacementArea): number => {
  if (!a.outline) return a.w * a.d;
  let s = 0;
  for (let i = 0; i < a.outline.length; i++) {
    const p = a.outline[i]!;
    const q = a.outline[(i + 1) % a.outline.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
};

const inside = (a: PlacementArea, lx: number, ly: number): boolean => {
  if (!a.outline) return Math.abs(lx) <= a.w / 2 && Math.abs(ly) <= a.d / 2;
  let hit = false;
  const pts = a.outline;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const p = pts[i]!;
    const q = pts[j]!;
    if (p.y > ly !== q.y > ly && lx < ((q.x - p.x) * (ly - p.y)) / (q.y - p.y) + p.x) hit = !hit;
  }
  return hit;
};

/** Whether a plan point is inside the area. */
export const insideArea = (a: PlacementArea, p: { x: number; y: number }): boolean => {
  const r = (-a.rotation * Math.PI) / 180;
  const dx = p.x - a.x;
  const dy = p.y - a.y;
  return inside(a, dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r));
};

const toPlan = (a: PlacementArea, lx: number, ly: number) => {
  const r = (a.rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: a.x + lx * c - ly * s, y: a.y + lx * s + ly * c };
};

/**
 * The people a group makes in an area. Counts come from each entry's range
 * (seeded), are capped by the density, and are placed by the formation with
 * at least the spacing between them, never where `blocked` says (a wall, a
 * solid), trying a few times before giving up on one and saying so.
 */
export const populate = (project: Project, g: CharacterGroup, at: PlacementArea, placeKey: string, blocked?: (p: { x: number; y: number }) => boolean): Population => {
  const random = rng(g.seed ^ hash(placeKey));
  const notes: string[] = [];
  const live = g.entries.filter((e) => project.objects[e.character]?.type === 'character' && profileOf(project.objects[e.character]!).enabled);
  let counts = live.map((e) => {
    const lo = Math.max(0, Math.min(e.min, e.max));
    const hi = Math.max(lo, e.max);
    return lo + Math.floor(random() * (hi - lo + 1));
  });
  const total = counts.reduce((n, c) => n + c, 0);
  const m2 = area(at);
  const cap = g.density > 0 ? Math.floor((m2 * g.density) / 100) : Infinity;
  if (total > cap) {
    // Trim by weight: the lighter an entry, the more it gives up.
    let over = total - cap;
    const order = live.map((e, i) => ({ i, w: Math.max(0.01, e.weight) })).sort((a, b) => a.w - b.w);
    while (over > 0) {
      let cut = false;
      for (const { i } of order) {
        if (over <= 0) break;
        if (counts[i]! > 0) {
          counts[i]!--;
          over--;
          cut = true;
        }
      }
      if (!cut) break;
    }
    notes.push(`The density cap (${g.density} per 100 m² of ${Math.round(m2)} m²) keeps it to ${cap} of ${total}.`);
  }
  counts = counts.map((c) => Math.max(0, c));
  const people = live.flatMap((e, i) => Array.from({ length: counts[i]! }, () => e));
  const placed: CrowdMember[] = [];
  const far = (p: { x: number; y: number }) => placed.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= g.spacing);
  const ok = (p: { x: number; y: number }) => far(p) && !blocked?.(p);
  const hw = at.outline ? Math.max(...at.outline.map((p) => Math.abs(p.x))) : at.w / 2;
  const hd = at.outline ? Math.max(...at.outline.map((p) => Math.abs(p.y))) : at.d / 2;
  const n = people.length;
  // Cluster centres, for clusters.
  const centres = Array.from({ length: Math.max(1, Math.round(n / 5)) }, () => ({ x: (random() * 2 - 1) * hw * 0.7, y: (random() * 2 - 1) * hd * 0.7 }));
  const facing = (at.rotation * Math.PI) / 180;
  let missed = 0;
  people.forEach((e, k) => {
    let spot: { x: number; y: number } | undefined;
    let local: { x: number; y: number } | undefined;
    const tryAt = (lx: number, ly: number) => {
      if (spot || !inside(at, lx, ly)) return;
      const p = toPlan(at, lx, ly);
      if (ok(p)) {
        spot = p;
        local = { x: lx, y: ly };
      }
    };
    const fixed = (): { x: number; y: number } => {
      const t = n > 1 ? k / (n - 1) : 0.5;
      switch (g.formation) {
        case 'line':
          return { x: (t - 0.5) * Math.min(at.w, g.spacing * 1.5 * n), y: 0 };
        case 'column':
          return { x: 0, y: (t - 0.5) * Math.min(at.d, g.spacing * 1.5 * n) };
        case 'circle': {
          const a = (k / Math.max(1, n)) * Math.PI * 2;
          const r = Math.min(hw, hd) * 0.8;
          return { x: Math.cos(a) * r, y: Math.sin(a) * r };
        }
        case 'grid': {
          const cols = Math.max(1, Math.ceil(Math.sqrt(n * (at.w / Math.max(0.1, at.d)))));
          const rows = Math.ceil(n / cols);
          return { x: ((k % cols) + 0.5 - cols / 2) * Math.min(at.w / cols, g.spacing * 1.5), y: (Math.floor(k / cols) + 0.5 - rows / 2) * Math.min(at.d / rows, g.spacing * 1.5) };
        }
        default:
          return { x: 0, y: 0 };
      }
    };
    if (g.formation !== 'scatter' && g.formation !== 'cluster') {
      const f = fixed();
      tryAt(f.x, f.y);
      for (let i = 0; i < 12 && !spot; i++) tryAt(f.x + (random() - 0.5) * g.spacing * 2, f.y + (random() - 0.5) * g.spacing * 2);
    }
    for (let i = 0; i < 40 && !spot; i++) {
      if (g.formation === 'cluster') {
        const c = centres[k % centres.length]!;
        const r = g.spacing * (1 + random() * 2.5);
        const a = random() * Math.PI * 2;
        tryAt(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
      } else tryAt((random() * 2 - 1) * hw, (random() * 2 - 1) * hd);
    }
    if (!spot || !local) {
      missed++;
      return;
    }
    const yaw = g.formation === 'scatter' || g.formation === 'cluster' ? random() * Math.PI * 2 : facing;
    placed.push({ key: `${placeKey}#${placed.length + 1}`, entryId: e.id, character: e.character, ...(e.variant ? { variant: e.variant } : {}), activity: e.activity, x: spot.x, y: spot.y, yaw, ...(e.activity === 'patrol' ? { offset: { x: spot.x - at.x, y: spot.y - at.y } } : {}) });
  });
  if (missed) notes.push(`${missed} couldn’t be fitted ${g.spacing} m apart in the space left; give it more room or less spacing.`);
  // Chatting people pair up to face each other.
  for (const m of placed) {
    if (m.activity !== 'talk') continue;
    const near = placed.filter((o) => o !== m).sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0];
    if (near && Math.hypot(near.x - m.x, near.y - m.y) < 4) m.yaw = Math.atan2(near.x - m.x, -(near.y - m.y));
  }
  return { members: placed, notes };
};
