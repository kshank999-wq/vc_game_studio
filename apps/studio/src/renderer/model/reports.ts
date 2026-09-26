import { FIELDS, describeInteraction, interactionsOf, sceneUse, statesOf, whereUsed } from './details';
import { laneSequence } from './layout';
import { CATEGORIES, elementsIn, sceneLines } from './scene';
import { TYPE_LABEL } from './semantics';
import { eventDetail, eventTitle, sceneTimeline } from './timeline';
import type { ObjectType, Project, StoryObject } from './types';

/**
 * Production reports from the Bible (spec §20): organized breakdowns built
 * from the project as it stands, not screenshots.
 */

export type Block =
  | { kind: 'h2'; text: string; note?: string }
  | { kind: 'p'; text: string }
  | { kind: 'kv'; rows: [string, string][] }
  | { kind: 'table'; columns: string[]; rows: string[][] };

export interface Report {
  title: string;
  blocks: Block[];
}

export const REPORTS = [
  { key: 'characters', label: 'Character sheets' },
  { key: 'voByCharacter', label: 'Dialogue / VO — by character' },
  { key: 'voByScene', label: 'Dialogue / VO — by scene' },
  { key: 'scenes', label: 'Scene breakdowns' },
  { key: 'locations', label: 'Locations / environments' },
  { key: 'props', label: 'Props, objects, pickups, inventory' },
  { key: 'cinematics', label: 'Cinematics + camera notes' },
  { key: 'assets', label: 'Art / VFX / audio / animation' },
  { key: 'logic', label: 'Puzzles, triggers, interactions' },
  { key: 'choices', label: 'Choices + dependencies' },
  { key: 'arcs', label: 'Character arc summaries' },
] as const;

export type ReportKey = (typeof REPORTS)[number]['key'];

const VO_LABEL = { todo: 'to record', recorded: 'recorded', none: '—' } as const;

const of = (project: Project, ...types: ObjectType[]): StoryObject[] =>
  Object.values(project.objects)
    .filter((o) => types.includes(o.type))
    .sort((a, b) => (a.data.code ?? a.name).localeCompare(b.data.code ?? b.name, undefined, { numeric: true }));

const title = (o: StoryObject) => `${o.data.code ? `${o.data.code} · ` : ''}${o.name}`;

const fieldRows = (o: StoryObject): [string, string][] =>
  (FIELDS[o.type] ?? []).map((f) => [f.label, String(o.data[f.key] ?? '')] as [string, string]).filter(([, v]) => v);

const scenesOf = (project: Project, id: string): string =>
  project.connections
    .filter((c) => c.kind === 'contains' && c.targetId === id && project.objects[c.sourceId])
    .map((c) => title(project.objects[c.sourceId]!))
    .join(', ') || '—';

const slug = (project: Project, scene: StoryObject): string => {
  const location = scene.data.locationId ? project.objects[scene.data.locationId as string]?.name : undefined;
  return `${scene.data.intExt ?? 'INT.'} ${(location ?? 'SOMEWHERE').toUpperCase()} — ${scene.data.time ?? 'DAY'}`;
};

const speakerName = (project: Project, id: string | null) => (id ? project.objects[id]?.name ?? '?' : 'No speaker');

export const buildReport = (project: Project, key: ReportKey): Report => {
  const label = REPORTS.find((r) => r.key === key)!.label;
  const blocks: Block[] = [];
  const lines = project.lines.filter((l) => l.kind === 'dialogue' && project.objects[l.sceneId]);

  switch (key) {
    case 'characters':
      for (const c of of(project, 'character')) {
        const own = lines.filter((l) => l.speakerId === c.id);
        blocks.push({ kind: 'h2', text: c.name, note: c.data.code });
        blocks.push({ kind: 'kv', rows: [...fieldRows(c), ['Lines', `${own.length} (${own.filter((l) => l.vo === 'recorded').length} recorded)`]] });
        if (c.notes) blocks.push({ kind: 'p', text: c.notes });
        const uses = whereUsed(project, c.id);
        if (uses.length) blocks.push({ kind: 'table', columns: ['Where', 'What'], rows: uses.map((u) => [u.label, u.detail]) });
      }
      break;
    case 'voByCharacter':
      for (const c of [...of(project, 'character'), null]) {
        const own = lines.filter((l) => (c ? l.speakerId === c.id : !l.speakerId || !project.objects[l.speakerId]));
        if (!own.length) continue;
        blocks.push({ kind: 'h2', text: c?.name ?? 'No speaker', note: `${own.length} lines` });
        blocks.push({
          kind: 'table',
          columns: ['Scene', '#', 'Line', 'Direction', 'VO'],
          rows: own.map((l) => [project.objects[l.sceneId]?.data.code ?? '', String(l.order), l.text, l.direction, VO_LABEL[l.vo]]),
        });
      }
      break;
    case 'voByScene':
      for (const s of of(project, 'scene')) {
        const own = lines.filter((l) => l.sceneId === s.id);
        if (!own.length) continue;
        blocks.push({ kind: 'h2', text: title(s), note: slug(project, s) });
        blocks.push({
          kind: 'table',
          columns: ['#', 'Speaker', 'Line', 'Direction', 'VO'],
          rows: own.sort((a, b) => a.order - b.order).map((l) => [String(l.order), speakerName(project, l.speakerId), l.text, l.direction, VO_LABEL[l.vo]]),
        });
      }
      break;
    case 'scenes':
      for (const s of of(project, 'scene')) {
        blocks.push({ kind: 'h2', text: title(s), note: slug(project, s) });
        blocks.push({
          kind: 'kv',
          rows: [
            ['Summary', String(s.data.summary ?? '')],
            ['Purpose', String(s.data.purpose ?? '')],
            ['Status', s.data.status === 'complete' ? 'Complete' : s.data.status === 'inProgress' ? 'In progress' : 'Outline'],
          ].filter(([, v]) => v) as [string, string][],
        });
        const contents = CATEGORIES.filter((c) => c.key !== 'dialogue')
          .map((c) => [c.label, elementsIn(project, s.id, c.key).map((o) => o.name).join(', ')])
          .filter(([, v]) => v);
        const spoken = sceneLines(project, s.id).filter((l) => l.kind === 'dialogue').length;
        if (spoken) contents.push(['Dialogue', `${spoken} lines`]);
        if (contents.length) blocks.push({ kind: 'table', columns: ['Category', 'Contents'], rows: contents as string[][] });
        const tracks = sceneTimeline(project, s.id);
        if (tracks[0]!.events.length) {
          blocks.push({
            kind: 'table',
            columns: ['Track', '#', 'Event', 'Detail'],
            rows: tracks.flatMap((t) => t.events.map((e, i) => [t.branch ? `Branch · ${t.branch.label}` : 'Main', String(i + 1), eventTitle(project, e), eventDetail(project, e)])),
          });
        }
      }
      break;
    case 'locations':
      for (const e of of(project, 'environment')) {
        blocks.push({ kind: 'h2', text: e.name, note: e.data.code });
        blocks.push({ kind: 'kv', rows: [...fieldRows(e), ['Scenes', scenesOf(project, e.id)], ['Asset notes', String(e.data.assetNotes ?? '')]].filter(([, v]) => v) as [string, string][] });
        if (e.notes) blocks.push({ kind: 'p', text: e.notes });
      }
      break;
    case 'props':
      blocks.push({
        kind: 'table',
        columns: ['Item', 'Type', 'States', 'Interactions', 'Scenes', 'Asset notes'],
        rows: of(project, 'object', 'inventory').map((o) => [
          title(o),
          TYPE_LABEL[o.type],
          statesOf(o).join(' → '),
          interactionsOf(o).map((i) => describeInteraction(project, i)).join('; '),
          scenesOf(project, o.id),
          String(o.data.assetNotes ?? ''),
        ]),
      });
      break;
    case 'cinematics':
      for (const c of of(project, 'cinematic')) {
        const timing = project.events.find((e) => e.refId === c.id);
        blocks.push({ kind: 'h2', text: title(c), note: timing ? `${timing.seconds ?? 0}s · ${timing.shots ?? 1} shots` : undefined });
        blocks.push({ kind: 'kv', rows: [...fieldRows(c), ['Scenes', scenesOf(project, c.id)]].filter(([, v]) => v) as [string, string][] });
        if (c.notes) blocks.push({ kind: 'p', text: c.notes });
      }
      break;
    case 'assets': {
      const tagged = Object.values(project.objects).filter((o) => ((o.data.production as string[] | undefined) ?? []).length);
      const tags = [...new Set(tagged.flatMap((o) => o.data.production as string[]))].sort();
      for (const tag of tags) {
        blocks.push({ kind: 'h2', text: tag });
        blocks.push({
          kind: 'table',
          columns: ['Element', 'Type', 'Asset notes', 'Scenes'],
          rows: tagged.filter((o) => (o.data.production as string[]).includes(tag)).map((o) => [title(o), TYPE_LABEL[o.type], String(o.data.assetNotes ?? ''), scenesOf(project, o.id)]),
        });
      }
      const vo = lines.filter((l) => l.vo === 'todo').length;
      if (vo) blocks.push({ kind: 'p', text: `Voice-over: ${vo} line${vo === 1 ? '' : 's'} still to record (see the Dialogue / VO reports).` });
      break;
    }
    case 'logic':
      for (const p of of(project, 'puzzle')) {
        blocks.push({ kind: 'h2', text: title(p), note: 'Puzzle' });
        blocks.push({ kind: 'kv', rows: [...fieldRows(p), ['Scenes', scenesOf(project, p.id)]].filter(([, v]) => v) as [string, string][] });
      }
      blocks.push({ kind: 'h2', text: 'Triggers, gates and state' });
      blocks.push({
        kind: 'table',
        columns: ['Element', 'Type', 'Rule', 'Scenes'],
        rows: of(project, 'trigger', 'gate', 'state').map((o) => [
          title(o),
          TYPE_LABEL[o.type],
          o.type === 'state' ? `values: ${statesOf(o).join(' / ')}` : fieldRows(o).map(([k, v]) => `${k}: ${v}`).join(' · '),
          scenesOf(project, o.id),
        ]),
      });
      blocks.push({ kind: 'h2', text: 'Interactions' });
      blocks.push({
        kind: 'table',
        columns: ['Object', 'Interaction'],
        rows: Object.values(project.objects).flatMap((o) => interactionsOf(o).map((i) => [title(o), describeInteraction(project, i)])),
      });
      break;
    case 'choices':
      for (const c of of(project, 'choice')) {
        blocks.push({ kind: 'h2', text: title(c) });
        const options = project.connections
          .filter((x) => x.kind === 'branch' && x.sourceId === c.id)
          .map((x) => [x.label ?? '(unlabelled)', project.objects[x.targetId]?.name ?? '?']);
        const inScenes = project.events
          .filter((e) => e.refId === c.id && e.kind === 'choice')
          .flatMap((e) => [
            [e.mainLabel ?? 'Main option', 'carries on in the scene'],
            ...project.branches
              .filter((b) => b.choiceEventId === e.id)
              .map((b) => [b.label, b.rejoinEventId ? `reconnects to ${eventTitle(project, project.events.find((x) => x.id === b.rejoinEventId) ?? e)}` : 'leaves the scene']),
          ]);
        blocks.push({ kind: 'kv', rows: [...fieldRows(c), ['Scenes', scenesOf(project, c.id)]].filter(([, v]) => v) as [string, string][] });
        const rows = [...options, ...inScenes];
        if (rows.length) blocks.push({ kind: 'table', columns: ['Option', 'Leads to'], rows });
      }
      break;
    case 'arcs':
      for (const lane of project.lanes.filter((l) => l.kind === 'character')) {
        blocks.push({ kind: 'h2', text: lane.name, note: lane.subtitle || undefined });
        blocks.push({
          kind: 'table',
          columns: ['#', 'Change', 'Event', 'Tied to'],
          rows: laneSequence(project, lane.id).map((id, i) => {
            const o = project.objects[id]!;
            const tie = project.connections.find((c) => c.kind === 'arcEvent' && c.sourceId === id);
            const mark = o.data.polarity === 'down' ? '− setback' : o.data.polarity === 'turn' ? '◆ turning point' : '+ growth';
            return [String(i + 1), mark, o.name, tie ? title(project.objects[tie.targetId]!) : '—'];
          }),
        });
      }
      break;
  }
  if (blocks.length === 0) blocks.push({ kind: 'p', text: 'Nothing in the project for this report yet.' });
  return { title: label, blocks };
};

export { sceneUse };
