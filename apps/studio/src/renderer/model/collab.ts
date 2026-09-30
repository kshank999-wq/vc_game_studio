import type { Connection, Project, StoryObject } from './types';
import type { Level, LevelItem } from './level/types';

/**
 * Collaboration (spec §16): comments and tasks on anything in the project,
 * and each thing's own edit history.
 *
 * A comment or task hangs off a target: a story element (scene, node,
 * character, item, any Bible entry), a connection (a branch, a binding), a
 * level or level item, or a generated code file. A task has a role it is
 * for and is marked done; either kind takes replies.
 *
 * The history is recorded as edits are made: each commit is compared with the
 * project before it, and every element, connection, level and level item it
 * changed gets a revision saying who changed what, and when, with what it was
 * before, so an earlier version can be brought back. Edits by the same
 * person to the same thing within a few minutes are one revision.
 */

export type Role = 'writer' | 'narrative' | 'level' | 'gameplay' | 'cinematic' | 'audio' | 'reviewer';

export const ROLES: { id: Role; label: string }[] = [
  { id: 'writer', label: 'Writer' },
  { id: 'narrative', label: 'Narrative designer' },
  { id: 'level', label: 'Level designer' },
  { id: 'gameplay', label: 'Gameplay programmer' },
  { id: 'cinematic', label: 'Cinematic designer' },
  { id: 'audio', label: 'Audio' },
  { id: 'reviewer', label: 'Reviewer' },
];

export const roleLabel = (role?: Role | ''): string => ROLES.find((r) => r.id === role)?.label ?? '';

/** Who made a change or wrote a comment. */
export interface Who {
  name: string;
  role?: Role;
}

export const whoLabel = (who: Who): string => (who.role ? `${who.name} (${roleLabel(who.role)})` : who.name);

export type TargetKind = 'object' | 'connection' | 'level' | 'levelItem' | 'code';

/** What a comment or a history is about. A code target's id is the generated file's path. */
export interface Target {
  kind: TargetKind;
  id: string;
}

export const targetKey = (t: Target): string => `${t.kind}:${t.id}`;

export const parseTargetKey = (key: string): Target => {
  const at = key.indexOf(':');
  return { kind: key.slice(0, at) as TargetKind, id: key.slice(at + 1) };
};

export interface Reply {
  id: string;
  text: string;
  by: Who;
  at: number;
}

export interface Comment {
  id: string;
  target: Target;
  kind: 'comment' | 'task';
  text: string;
  by: Who;
  at: number;
  /** A task: the role it is for. */
  for?: Role;
  /** A task done, or a comment resolved: by whom and when. */
  done?: { by: Who; at: number };
  replies?: Reply[];
}

export interface Revision {
  id: string;
  at: number;
  by: Who;
  kind: 'created' | 'changed' | 'deleted';
  /** What changed, in words ("name", "summary", "position"). */
  changes: string[];
  /** The thing as it was before (absent when it was created). */
  before?: unknown;
}

/** Each thing's history keeps its latest revisions. */
export const HISTORY_LIMIT = 40;
/** Edits by one person to one thing within this long are one revision. */
export const MERGE_MS = 5 * 60 * 1000;

let serial = 0;
const newId = (prefix: string, at: number) => `${prefix}_${at.toString(36)}_${(serial++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// ─── What changed ────────────────────────────────────────────────────────

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** "startsOpen" → "starts open". */
const words = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

const OBJECT_FIELDS: Record<string, string> = { name: 'name', notes: 'description', type: 'kind' };
const ITEM_FIELDS: Record<string, string> = {
  x: 'position',
  y: 'position',
  z: 'height',
  rotation: 'turn',
  floorId: 'floor',
  levelId: 'level',
  assetId: 'asset',
  assetVersion: 'asset version',
  exportName: 'export name',
  host: 'host wall',
  links: 'story links',
  activeWhen: 'present only when',
};
const CONNECTION_FIELDS: Record<string, string> = { sourceId: 'from', targetId: 'to', label: 'label', conditions: 'conditions', effects: 'effects' };

/** The fields that differ between two versions of a thing, in words, each once. */
const changedFields = (a: Record<string, unknown>, b: Record<string, unknown>, labels: Record<string, string>, nested?: string): string[] => {
  const out = new Set<string>();
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 'modified' || key === 'created' || key === 'id') continue;
    if (same(a[key], b[key])) continue;
    if (key === nested) {
      const inA = (a[key] ?? {}) as Record<string, unknown>;
      const inB = (b[key] ?? {}) as Record<string, unknown>;
      for (const k of new Set([...Object.keys(inA), ...Object.keys(inB)])) if (!same(inA[k], inB[k])) out.add(k === 'code' ? 'code' : words(k));
    } else out.add(labels[key] ?? words(key));
  }
  return [...out];
};

/** Everything the history follows, by target key: story elements, connections, levels and level items. */
const tracked = (project: Project): Map<string, unknown> => {
  const out = new Map<string, unknown>();
  for (const [id, o] of Object.entries(project.objects)) out.set(`object:${id}`, o);
  for (const c of project.connections) out.set(`connection:${c.id}`, c);
  for (const l of project.levels?.levels ?? []) out.set(`level:${l.id}`, l);
  for (const i of project.levels?.items ?? []) out.set(`levelItem:${i.id}`, i);
  return out;
};

const fieldsOf = (kind: TargetKind, a: unknown, b: unknown): string[] => {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  if (kind === 'object') return changedFields(x, y, OBJECT_FIELDS, 'data');
  if (kind === 'levelItem') return changedFields(x, y, ITEM_FIELDS, 'params');
  if (kind === 'connection') return changedFields(x, y, CONNECTION_FIELDS);
  return changedFields(x, y, {});
};

/** Which scenes' scripts or timelines a commit changed: they count as changes to the scene. */
const sceneWork = (prev: Project, next: Project): Map<string, string[]> => {
  const out = new Map<string, Set<string>>();
  const note = (scene: string, what: string) => (out.get(scene) ?? out.set(scene, new Set()).get(scene)!).add(what);
  const diff = <T extends { id: string; sceneId: string }>(a: T[], b: T[], what: string) => {
    if (a === b) return;
    const before = new Map(a.map((x) => [x.id, x]));
    const after = new Map(b.map((x) => [x.id, x]));
    for (const [id, x] of after) if (before.get(id) !== x && !same(before.get(id), x)) note(x.sceneId, what);
    for (const [id, x] of before) if (!after.has(id)) note(x.sceneId, what);
  };
  diff(prev.lines, next.lines, 'script');
  diff(prev.events, next.events, 'timeline');
  diff(prev.branches, next.branches, 'timeline');
  return new Map([...out].map(([k, v]) => [k, [...v]]));
};

/**
 * Record what a commit changed in each thing's history. Returns the next
 * project with its revisions added (the same project when nothing that is
 * followed changed).
 */
export const recordEdits = (prev: Project, next: Project, by: Who, at = Date.now()): Project => {
  if (prev === next) return next;
  const before = tracked(prev);
  const after = tracked(next);
  const found: { key: string; kind: Revision['kind']; changes: string[]; before?: unknown }[] = [];
  for (const [key, value] of after) {
    const old = before.get(key);
    if (old === value) continue;
    const { kind } = parseTargetKey(key);
    if (old === undefined) found.push({ key, kind: 'created', changes: [] });
    else {
      const changes = fieldsOf(kind, old, value);
      if (changes.length) found.push({ key, kind: 'changed', changes, before: old });
    }
  }
  for (const [key, value] of before) if (!after.has(key)) found.push({ key, kind: 'deleted', changes: [], before: value });
  for (const [scene, what] of sceneWork(prev, next)) {
    const key = `object:${scene}`;
    if (!after.has(key)) continue;
    const entry = found.find((f) => f.key === key);
    if (entry) entry.changes = [...new Set([...entry.changes, ...what])];
    else found.push({ key, kind: 'changed', changes: what, before: before.get(key) });
  }
  if (!found.length) return next;
  const revisions = { ...(next.revisions ?? {}) };
  for (const f of found) {
    const list = revisions[f.key] ?? [];
    const last = list.at(-1);
    if (f.kind === 'changed' && last && last.kind !== 'deleted' && last.by.name === by.name && at - last.at < MERGE_MS) {
      // One sitting's edits: one revision, keeping what it was before the first of them.
      revisions[f.key] = [...list.slice(0, -1), { ...last, at, changes: [...new Set([...last.changes, ...f.changes])] }];
      continue;
    }
    const rev: Revision = { id: newId('rev', at), at, by, kind: f.kind, changes: f.changes, ...(f.before !== undefined ? { before: f.before } : {}) };
    revisions[f.key] = [...list, rev].slice(-HISTORY_LIMIT);
  }
  return { ...next, revisions };
};

/** Whether two projects differ only in the history recordEdits adds (so an editor holding one still holds the other). */
export const sameButHistory = (a: Project, b: Project): boolean => {
  if (a === b) return true;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Project>) if (key !== 'revisions' && a[key] !== b[key]) return false;
  return true;
};

/** A thing's history, newest first. */
export const historyOf = (project: Project, target: Target): Revision[] => [...(project.revisions?.[targetKey(target)] ?? [])].reverse();

/** Who changed it last, and when (its owner, for now). */
export const lastChange = (project: Project, target: Target): Revision | undefined => project.revisions?.[targetKey(target)]?.at(-1);

/** A revision in words: "Changed name, summary", "Created", "Deleted". */
export const describeRevision = (rev: Revision): string =>
  rev.kind === 'created' ? 'Created' : rev.kind === 'deleted' ? 'Deleted' : `Changed ${rev.changes.join(', ')}`;

/**
 * Put a thing back as it was before a revision: its fields as they were
 * then, or, before a deletion, the thing itself. Script and timeline changes
 * are not part of an element, so they stay. Returns the project unchanged
 * when there is nothing to bring back (before its creation).
 */
export const restoreBefore = (project: Project, target: Target, revisionId: string): Project => {
  const rev = project.revisions?.[targetKey(target)]?.find((r) => r.id === revisionId);
  if (!rev || rev.before === undefined) return project;
  const was = rev.before;
  switch (target.kind) {
    case 'object': {
      const o = was as StoryObject;
      return { ...project, objects: { ...project.objects, [target.id]: { ...o, modified: new Date().toISOString() } } };
    }
    case 'connection': {
      const c = was as Connection;
      const has = project.connections.some((x) => x.id === target.id);
      if (!project.objects[c.sourceId] || !project.objects[c.targetId]) return project;
      return { ...project, connections: has ? project.connections.map((x) => (x.id === target.id ? c : x)) : [...project.connections, c] };
    }
    case 'level':
    case 'levelItem': {
      const set = project.levels;
      if (!set) return project;
      if (target.kind === 'level') {
        const l = was as Level;
        const has = set.levels.some((x) => x.id === target.id);
        return { ...project, levels: { ...set, levels: has ? set.levels.map((x) => (x.id === target.id ? l : x)) : [...set.levels, l] } };
      }
      const i = was as LevelItem;
      if (!set.levels.some((l) => l.id === i.levelId)) return project;
      const has = set.items.some((x) => x.id === target.id);
      return { ...project, levels: { ...set, items: has ? set.items.map((x) => (x.id === target.id ? i : x)) : [...set.items, i] } };
    }
    case 'code':
      return project;
  }
};

/** Whether a revision can be undone by bringing back what was before it (and why not). */
export const canRestore = (project: Project, target: Target, rev: Revision): boolean => {
  if (rev.before === undefined) return false;
  if (target.kind === 'connection') {
    const c = rev.before as Connection;
    return !!project.objects[c.sourceId] && !!project.objects[c.targetId];
  }
  if (target.kind === 'levelItem') return !!project.levels?.levels.some((l) => l.id === (rev.before as LevelItem).levelId);
  return target.kind !== 'code';
};

/** Things that changed since the last export to an engine, story logic first (spec §16: changes after implementation). */
export const changedSinceExport = (project: Project): { target: Target; last: Revision }[] => {
  const since = project.handoff?.last?.at ? Date.parse(project.handoff.last.at) : NaN;
  if (!Number.isFinite(since)) return [];
  return Object.entries(project.revisions ?? {})
    .map(([key, list]) => ({ target: parseTargetKey(key), last: list.at(-1)! }))
    .filter((e) => e.last && e.last.at > since)
    .sort((a, b) => b.last.at - a.last.at);
};

// ─── Comments and tasks ─────────────────────────────────────────────────

export const commentsOn = (project: Project, target: Target): Comment[] => (project.comments ?? []).filter((c) => c.target.kind === target.kind && c.target.id === target.id);

export const addComment = (project: Project, target: Target, text: string, by: Who, opts: { kind?: Comment['kind']; for?: Role } = {}, at = Date.now()): { project: Project; id: string } => {
  const id = newId('cmt', at);
  const comment: Comment = { id, target, kind: opts.kind ?? 'comment', text: text.trim(), by, at, ...(opts.kind === 'task' && opts.for ? { for: opts.for } : {}) };
  return { project: { ...project, comments: [...(project.comments ?? []), comment] }, id };
};

const mapComment = (project: Project, id: string, f: (c: Comment) => Comment): Project => ({ ...project, comments: (project.comments ?? []).map((c) => (c.id === id ? f(c) : c)) });

export const replyTo = (project: Project, id: string, text: string, by: Who, at = Date.now()): Project =>
  mapComment(project, id, (c) => ({ ...c, replies: [...(c.replies ?? []), { id: newId('re', at), text: text.trim(), by, at }] }));

/** Mark a task done (or a comment resolved), or open it again. */
export const setDone = (project: Project, id: string, done: boolean, by: Who, at = Date.now()): Project =>
  mapComment(project, id, (c) => {
    if (done) return { ...c, done: { by, at } };
    const { done: _, ...rest } = c;
    return rest;
  });

export const editComment = (project: Project, id: string, changes: Partial<Pick<Comment, 'text' | 'kind' | 'for'>>): Project =>
  mapComment(project, id, (c) => {
    const next = { ...c, ...changes };
    if (next.kind !== 'task' || !next.for) delete next.for;
    return next;
  });

export const removeComment = (project: Project, id: string): Project => ({ ...project, comments: (project.comments ?? []).filter((c) => c.id !== id) });

export interface TaskFilter {
  /** Only tasks for this role (and tasks for anyone). */
  role?: Role;
  /** Include tasks done and comments resolved. */
  done?: boolean;
  /** Only tasks, not comments. */
  tasksOnly?: boolean;
}

/** Comments and tasks across the project, open ones first, newest first. */
export const allComments = (project: Project, filter: TaskFilter = {}): Comment[] =>
  (project.comments ?? [])
    .filter((c) => (filter.done || !c.done) && (!filter.tasksOnly || c.kind === 'task') && (!filter.role || c.kind !== 'task' || !c.for || c.for === filter.role))
    .sort((a, b) => Number(!!a.done) - Number(!!b.done) || b.at - a.at);

/** How many comments and tasks are open on a target. */
export const openCount = (project: Project, target: Target): number => commentsOn(project, target).filter((c) => !c.done).length;

/** What a target is, in words, and whether it is still in the project. */
export const describeTarget = (project: Project, target: Target): { label: string; detail: string; exists: boolean } => {
  switch (target.kind) {
    case 'object': {
      const o = project.objects[target.id];
      const was = (lastChange(project, target)?.before as StoryObject | undefined) ?? undefined;
      if (!o) return { label: was?.name ?? 'A deleted element', detail: 'deleted', exists: false };
      return { label: `${o.data.code ? `${o.data.code} ` : ''}${o.name}`, detail: words(o.type), exists: true };
    }
    case 'connection': {
      const c = project.connections.find((x) => x.id === target.id);
      if (!c) return { label: 'A deleted connection', detail: 'deleted', exists: false };
      const from = project.objects[c.sourceId]?.name ?? '?';
      const to = project.objects[c.targetId]?.name ?? '?';
      return { label: c.label ? `${c.label} (${from} → ${to})` : `${from} → ${to}`, detail: `${words(c.kind)} connection`, exists: true };
    }
    case 'level': {
      const l = project.levels?.levels.find((x) => x.id === target.id);
      return l ? { label: l.name, detail: 'level', exists: true } : { label: 'A deleted level', detail: 'deleted', exists: false };
    }
    case 'levelItem': {
      const set = project.levels;
      const i = set?.items.find((x) => x.id === target.id);
      if (!i) return { label: 'A deleted level item', detail: 'deleted', exists: false };
      return { label: i.name, detail: set!.levels.find((l) => l.id === i.levelId)?.name ?? 'level item', exists: true };
    }
    case 'code':
      return { label: target.id.split('/').pop() ?? target.id, detail: target.id, exists: true };
  }
};

/** A time in words, for comments and history ("5 Oct, 14:02"). */
export const whenLabel = (at: number): string => new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
