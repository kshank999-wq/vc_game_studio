import { laneSequence, spineSequence } from './layout';
import { TYPE_LABEL } from './semantics';
import type { DialogueLine, ObjectType, Project, StoryObject } from './types';

/**
 * The Game Bible (spec §19): the project catalogue, as views over the same
 * objects the graph and scenes use. Nothing here is a copy.
 */

export type ViewKey =
  | 'all'
  | 'characters'
  | 'scenes'
  | 'plot'
  | 'arcs'
  | 'choices'
  | 'dialogue'
  | 'locations'
  | 'objects'
  | 'cinematics'
  | 'puzzles'
  | 'logic'
  | 'production';

export interface BibleView {
  key: ViewKey;
  label: string;
  symbol: ObjectType;
  types?: readonly ObjectType[];
}

export const VIEWS: readonly BibleView[] = [
  { key: 'all', label: 'All Elements', symbol: 'state' },
  { key: 'characters', label: 'Characters / NPCs', symbol: 'character', types: ['character'] },
  { key: 'scenes', label: 'Scenes', symbol: 'scene', types: ['scene'] },
  { key: 'plot', label: 'Plot Points / Subplots', symbol: 'plotPoint', types: ['begin', 'plotPoint', 'end'] },
  { key: 'arcs', label: 'Character Arcs', symbol: 'arcEvent', types: ['arcEvent'] },
  { key: 'choices', label: 'Choices / Outcomes', symbol: 'choice', types: ['choice'] },
  { key: 'dialogue', label: 'Dialogue / Voice', symbol: 'dialogue' },
  { key: 'locations', label: 'Locations / Environments', symbol: 'environment', types: ['environment'] },
  { key: 'objects', label: 'Objects / Inventory', symbol: 'object', types: ['object', 'inventory'] },
  { key: 'cinematics', label: 'Cinematics', symbol: 'cinematic', types: ['cinematic'] },
  { key: 'puzzles', label: 'Puzzles', symbol: 'puzzle', types: ['puzzle'] },
  { key: 'logic', label: 'Triggers / Gates / State', symbol: 'trigger', types: ['trigger', 'gate', 'state'] },
  { key: 'production', label: 'Production Requirements', symbol: 'object' },
];

/** A row in a Bible list: an object, or (in Dialogue / Voice) a script line. */
export type Entry = { kind: 'object'; id: string; object: StoryObject } | { kind: 'line'; id: string; line: DialogueLine };

export interface Group {
  label: string;
  entries: Entry[];
}

const code = (o: StoryObject) => o.data.code ?? '';
const byName = (a: StoryObject, b: StoryObject) => code(a).localeCompare(code(b), undefined, { numeric: true }) || a.name.localeCompare(b.name);

const matches = (project: Project, entry: Entry, query: string): boolean => {
  if (!query) return true;
  const q = query.toLowerCase();
  if (entry.kind === 'line') {
    const speaker = entry.line.speakerId ? project.objects[entry.line.speakerId]?.name ?? '' : '';
    return `${speaker} ${entry.line.text} ${entry.line.direction}`.toLowerCase().includes(q);
  }
  const o = entry.object;
  const fields = Object.values(o.data).filter((v) => typeof v === 'string').join(' ');
  return `${o.name} ${code(o)} ${o.notes} ${fields} ${TYPE_LABEL[o.type]}`.toLowerCase().includes(q);
};

/** Lines to record, per the VO status on each dialogue line. */
export const voProgress = (lines: DialogueLine[]): { recorded: number; total: number } => {
  const spoken = lines.filter((l) => l.kind === 'dialogue' && l.vo !== 'none');
  return { recorded: spoken.filter((l) => l.vo === 'recorded').length, total: spoken.length };
};

/** Where an object sits, for grouping: spine, a subplot, a branch, or inside a scene. */
const placeLabel = (project: Project, id: string): string => {
  const placement = project.placements[id];
  if (!placement) return project.connections.some((c) => c.kind === 'contains' && c.targetId === id) ? 'In scenes' : 'Not used yet';
  if (placement.laneId === null) return 'Branches';
  const lane = project.lanes.find((l) => l.id === placement.laneId);
  return lane?.kind === 'spine' ? 'On the spine' : lane?.kind === 'subplot' ? `Subplot · ${lane.name}` : `Arc · ${lane?.name ?? ''}`;
};

/** The entries of a view, grouped as the Bible shows them, filtered by a search. */
export const viewGroups = (project: Project, key: ViewKey, query = ''): Group[] => {
  const view = VIEWS.find((v) => v.key === key)!;
  const objects = Object.values(project.objects);
  const wrap = (list: StoryObject[]): Entry[] => list.sort(byName).map((object) => ({ kind: 'object' as const, id: object.id, object }));
  const keep = (groups: Group[]) =>
    groups
      .map((g) => ({ ...g, entries: g.entries.filter((e) => matches(project, e, query)) }))
      .filter((g) => g.entries.length > 0);

  switch (key) {
    case 'all': {
      const order: ObjectType[] = ['begin', 'plotPoint', 'end', 'scene', 'cinematic', 'choice', 'character', 'environment', 'object', 'inventory', 'puzzle', 'trigger', 'gate', 'state', 'arcEvent', 'dialogue'];
      return keep(order.map((type) => ({ label: TYPE_LABEL[type], entries: wrap(objects.filter((o) => o.type === type)) })));
    }
    case 'characters': {
      const role = (o: StoryObject) => (o.data.role as string | undefined) ?? 'Unassigned';
      const roles = ['Main', 'Player character', 'NPC', 'Minor', 'Unassigned'];
      const characters = objects.filter((o) => o.type === 'character');
      return keep(roles.map((r) => ({ label: r, entries: wrap(characters.filter((o) => role(o) === r)) })));
    }
    case 'plot': {
      const spine = spineSequence(project).map((id) => project.objects[id]!).filter((o) => o.type !== 'scene' && o.type !== 'cinematic' && o.type !== 'choice');
      const groups: Group[] = [{ label: 'Spine', entries: spine.map((object) => ({ kind: 'object', id: object.id, object })) }];
      for (const lane of project.lanes.filter((l) => l.kind === 'subplot')) {
        const beats = laneSequence(project, lane.id).map((id) => project.objects[id]!);
        groups.push({ label: `Subplot · ${lane.name}`, entries: beats.map((object) => ({ kind: 'object', id: object.id, object })) });
      }
      const loose = objects.filter((o) => o.type === 'plotPoint' && project.placements[o.id]?.laneId === null);
      if (loose.length) groups.push({ label: 'Branches', entries: wrap(loose) });
      return keep(groups);
    }
    case 'arcs':
      return keep(
        project.lanes
          .filter((l) => l.kind === 'character')
          .map((lane) => ({
            label: `${lane.name}${lane.subtitle ? ` · ${lane.subtitle}` : ''}`,
            entries: laneSequence(project, lane.id).map((id) => ({ kind: 'object' as const, id, object: project.objects[id]! })),
          })),
      );
    case 'dialogue': {
      const speakers = new Map<string, DialogueLine[]>();
      for (const line of project.lines.filter((l) => l.kind === 'dialogue' && project.objects[l.sceneId])) {
        const who = line.speakerId && project.objects[line.speakerId] ? project.objects[line.speakerId]!.name : 'No speaker';
        speakers.set(who, [...(speakers.get(who) ?? []), line]);
      }
      return keep(
        [...speakers.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([who, lines]) => ({
            label: who,
            entries: lines
              .sort((a, b) => (project.objects[a.sceneId]?.data.code ?? '').localeCompare(project.objects[b.sceneId]?.data.code ?? '') || a.order - b.order)
              .map((line) => ({ kind: 'line' as const, id: line.id, line })),
          })),
      );
    }
    case 'production': {
      const tagged = objects.filter((o) => ((o.data.production as string[] | undefined) ?? []).length > 0);
      const tags = [...new Set(tagged.flatMap((o) => o.data.production as string[]))].sort();
      return keep(tags.map((tag) => ({ label: tag, entries: wrap(tagged.filter((o) => (o.data.production as string[]).includes(tag))) })));
    }
    default: {
      const list = objects.filter((o) => view.types?.includes(o.type));
      if (key === 'scenes' || key === 'choices' || key === 'cinematics') {
        const labels = [...new Set(list.map((o) => placeLabel(project, o.id)))];
        return keep(labels.map((label) => ({ label, entries: wrap(list.filter((o) => placeLabel(project, o.id) === label)) })));
      }
      const types = [...new Set(list.map((o) => o.type))];
      return keep(types.map((type) => ({ label: TYPE_LABEL[type], entries: wrap(list.filter((o) => o.type === type)) })));
    }
  }
};

export const viewCount = (project: Project, key: ViewKey): number => viewGroups(project, key).reduce((n, g) => n + g.entries.length, 0);
