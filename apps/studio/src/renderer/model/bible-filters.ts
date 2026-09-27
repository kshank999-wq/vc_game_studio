import type { Entry, Group } from './bible';
import { everyRule } from './rules';
import { TYPE_LABEL } from './semantics';
import type { ObjectType, Project } from './types';

/**
 * The Bible's filter chips (mockup 06: "Group: Role", "Has VO", "Scene: any",
 * "+ Filter"). Filters narrow a view's entries, all of them at once; the
 * grouping chip regroups them. Both read the same objects as everything else.
 */

export type Filter =
  | { kind: 'scene'; sceneId: string }
  | { kind: 'status'; value: 'attention' | 'unused' | 'complete' }
  | { kind: 'tag'; tag: string }
  | { kind: 'vo'; value: 'has' | 'todo' | 'recorded' | 'none' }
  | { kind: 'type'; type: ObjectType }
  | { kind: 'role'; role: string }
  | { kind: 'rules' };

export type GroupBy = 'view' | 'type' | 'scene' | 'status' | 'role' | 'tag' | 'speaker' | 'none';

export const GROUP_LABEL: Record<GroupBy, string> = {
  view: 'As the view groups it',
  type: 'Type',
  scene: 'Scene',
  status: 'Status',
  role: 'Role',
  tag: 'Production tag',
  speaker: 'Speaker',
  none: 'Nothing',
};

const scenesOf = (project: Project, entry: Entry): string[] =>
  entry.kind === 'line'
    ? [entry.line.sceneId]
    : entry.object.type === 'scene'
      ? [entry.id]
      : project.connections.filter((c) => c.kind === 'contains' && c.targetId === entry.id && project.objects[c.sourceId]).map((c) => c.sourceId);

const tagsOf = (entry: Entry): string[] => (entry.kind === 'object' ? ((entry.object.data.production as string[] | undefined) ?? []) : []);

/** Used anywhere: on the graph, in a scene, speaking, or followed by an arc lane. */
const isUsed = (project: Project, entry: Entry): boolean => {
  if (entry.kind === 'line') return true;
  const id = entry.id;
  return (
    !!project.placements[id] ||
    project.connections.some((c) => c.kind === 'contains' && c.targetId === id) ||
    project.lines.some((l) => l.speakerId === id) ||
    project.lanes.some((l) => l.characterId === id)
  );
};

export const statusOf = (project: Project, entry: Entry, issues: ReadonlyMap<string, string>): 'attention' | 'unused' | 'complete' =>
  issues.has(entry.id) ? 'attention' : isUsed(project, entry) ? 'complete' : 'unused';

const STATUS_LABEL = { attention: 'Needs a look', unused: 'Not used yet', complete: 'Complete' } as const;

const voOf = (project: Project, entry: Entry): Set<string> => {
  if (entry.kind === 'line') return new Set<string>(entry.line.vo === 'none' ? ['none'] : [entry.line.vo, 'has']);
  if (entry.object.type !== 'character') return new Set();
  const lines = project.lines.filter((l) => l.speakerId === entry.id && l.kind === 'dialogue');
  const out = new Set<string>(lines.map((l) => l.vo));
  if (lines.some((l) => l.vo !== 'none')) out.add('has');
  return out;
};

const hasRules = (project: Project, id: string) => everyRule(project).some((r) => r.owner === id && (r.rule?.items.length || r.effects?.length));

export const matchesFilter = (project: Project, entry: Entry, filter: Filter, issues: ReadonlyMap<string, string>): boolean => {
  switch (filter.kind) {
    case 'scene':
      return scenesOf(project, entry).includes(filter.sceneId);
    case 'status':
      return statusOf(project, entry, issues) === filter.value;
    case 'tag':
      return tagsOf(entry).includes(filter.tag);
    case 'vo':
      return voOf(project, entry).has(filter.value);
    case 'type':
      return entry.kind === 'object' ? entry.object.type === filter.type : filter.type === 'dialogue';
    case 'role':
      return entry.kind === 'object' && (entry.object.data.role ?? 'Unassigned') === filter.role;
    case 'rules':
      return entry.kind === 'object' && (hasRules(project, entry.id) || !!entry.object.data.rule || !!entry.object.data.effects);
  }
};

const VO_LABEL = { has: 'Has VO', todo: 'VO to record', recorded: 'VO recorded', none: 'No VO' } as const;

export const filterLabel = (project: Project, filter: Filter): string => {
  switch (filter.kind) {
    case 'scene': {
      const s = project.objects[filter.sceneId];
      return `Scene: ${s ? `${s.data.code ? `${s.data.code} ` : ''}${s.name}` : '?'}`;
    }
    case 'status':
      return STATUS_LABEL[filter.value];
    case 'tag':
      return `Needs ${filter.tag}`;
    case 'vo':
      return VO_LABEL[filter.value];
    case 'type':
      return TYPE_LABEL[filter.type];
    case 'role':
      return `Role: ${filter.role}`;
    case 'rules':
      return 'Has conditions or effects';
  }
};

export const sameKind = (a: Filter, b: Filter) => a.kind === b.kind;

/** Apply every filter; empty groups go. */
export const applyFilters = (project: Project, groups: Group[], filters: Filter[], issues: ReadonlyMap<string, string>): Group[] =>
  filters.length
    ? groups
        .map((g) => ({ ...g, entries: g.entries.filter((e) => filters.every((f) => matchesFilter(project, e, f, issues))) }))
        .filter((g) => g.entries.length > 0)
    : groups;

/** The filters worth offering for these entries, with how many each keeps. */
export const filterChoices = (project: Project, entries: Entry[], issues: ReadonlyMap<string, string>): { heading: string; options: { filter: Filter; count: number }[] }[] => {
  const count = (f: Filter) => entries.filter((e) => matchesFilter(project, e, f, issues)).length;
  // Only filters that narrow the list: each keeps some entries, but not all of them.
  const offer = (filters: Filter[]) => filters.map((filter) => ({ filter, count: count(filter) })).filter((o) => o.count > 0 && o.count < entries.length);
  const types = [...new Set(entries.map((e) => (e.kind === 'object' ? e.object.type : 'dialogue')))] as ObjectType[];
  const roles = [...new Set(entries.flatMap((e) => (e.kind === 'object' && e.object.type === 'character' ? [String(e.object.data.role ?? 'Unassigned')] : [])))];
  const tags = [...new Set(entries.flatMap(tagsOf))].sort();
  const sections = [
    { heading: 'STATUS', options: offer((['attention', 'unused', 'complete'] as const).map((value) => ({ kind: 'status', value }))) },
    { heading: 'TYPE', options: types.length > 1 ? offer(types.map((type) => ({ kind: 'type', type }))) : [] },
    { heading: 'ROLE', options: roles.length > 1 ? offer(roles.map((role) => ({ kind: 'role', role }))) : [] },
    { heading: 'VOICE', options: offer((['has', 'todo', 'recorded', 'none'] as const).map((value) => ({ kind: 'vo', value }))) },
    { heading: 'PRODUCTION', options: offer(tags.map((tag) => ({ kind: 'tag', tag }))) },
    { heading: 'LOGIC', options: offer([{ kind: 'rules' }]) },
  ];
  return sections.filter((s) => s.options.length);
};

/** The scenes an entry list touches, for the Scene chip. */
export const scenesIn = (project: Project, entries: Entry[]) => {
  const ids = new Set(entries.flatMap((e) => scenesOf(project, e)));
  return [...ids]
    .map((id) => project.objects[id]!)
    .filter(Boolean)
    .sort((a, b) => String(a.data.code ?? a.name).localeCompare(String(b.data.code ?? b.name), undefined, { numeric: true }));
};

/** The groupings that make sense for these entries. */
export const groupChoices = (entries: Entry[]): GroupBy[] => {
  const lines = entries.some((e) => e.kind === 'line');
  const objects = entries.some((e) => e.kind === 'object');
  const types = new Set(entries.map((e) => (e.kind === 'object' ? e.object.type : 'dialogue')));
  const characters = entries.some((e) => e.kind === 'object' && e.object.type === 'character');
  return [
    'view',
    ...(types.size > 1 ? (['type'] as const) : []),
    'scene',
    'status',
    ...(characters ? (['role'] as const) : []),
    ...(objects ? (['tag'] as const) : []),
    ...(lines ? (['speaker'] as const) : []),
    'none',
  ];
};

/** Regroup entries (the view's own grouping is kept for 'view'). An entry in several scenes or tags shows under each. */
export const regroup = (project: Project, groups: Group[], by: GroupBy, issues: ReadonlyMap<string, string>): Group[] => {
  if (by === 'view') return groups;
  const entries = [...new Map(groups.flatMap((g) => g.entries).map((e) => [e.id, e])).values()];
  if (by === 'none') return entries.length ? [{ label: 'Everything', entries }] : [];
  const buckets = new Map<string, Entry[]>();
  const put = (label: string, e: Entry) => buckets.set(label, [...(buckets.get(label) ?? []), e]);
  for (const e of entries) {
    if (by === 'type') put(e.kind === 'object' ? TYPE_LABEL[e.object.type] : 'Dialogue lines', e);
    if (by === 'status') put(STATUS_LABEL[statusOf(project, e, issues)], e);
    if (by === 'role') put(e.kind === 'object' && e.object.type === 'character' ? String(e.object.data.role ?? 'Unassigned') : 'Not a character', e);
    if (by === 'speaker') put(e.kind === 'line' && e.line.speakerId ? (project.objects[e.line.speakerId]?.name ?? 'No speaker') : 'No speaker', e);
    if (by === 'scene') {
      const scenes = scenesOf(project, e);
      if (!scenes.length) put('In no scene', e);
      for (const id of scenes) {
        const s = project.objects[id]!;
        put(`${s.data.code ? `${s.data.code} ` : ''}${s.name}`, e);
      }
    }
    if (by === 'tag') {
      const tags = tagsOf(e);
      if (!tags.length) put('No production tags', e);
      for (const t of tags) put(t, e);
    }
  }
  const last = new Set(['In no scene', 'No production tags', 'No speaker', 'Not a character', 'Not used yet']);
  return [...buckets.entries()]
    .sort(([a], [b]) => Number(last.has(a)) - Number(last.has(b)) || a.localeCompare(b, undefined, { numeric: true }))
    .map(([label, list]) => ({ label, entries: list }));
};
