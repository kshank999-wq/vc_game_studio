import { interactionsOf, initialState, statesOf } from '../details';
import { laneSequence, spineSequence } from '../layout';
import { CATEGORIES, elementsIn, sceneLines } from '../scene';
import { eventTitle, sceneTimeline } from '../timeline';
import type { ObjectType, Project, StoryObject } from '../types';

/**
 * The engine-neutral handoff model. The project is flattened once into plain
 * data with stable engine identifiers; every engine adapter reads this and
 * nothing else, so adding Unity, Unreal or a custom engine never touches the
 * story model. Code is generated from it and is never the source of truth.
 */

export interface Ident {
  /** snake_case, for files and data keys: rusted_lever. */
  key: string;
  /** PascalCase, for class names: RustedLever. */
  type: string;
}

const words = (text: string): string[] =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

export const toKey = (text: string): string => {
  const key = words(text).join('_').toLowerCase();
  return /^[0-9]/.test(key) ? `n_${key}` : key || 'unnamed';
};

export const toType = (text: string): string => {
  const type = words(text)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('');
  return /^[0-9]/.test(type) ? `N${type}` : type || 'Unnamed';
};

/**
 * One identifier per object, unique within its type: the code and name when
 * it has a code (sc_01_the_vault_door), else the name, numbered on collision.
 */
export const identifiers = (project: Project): Map<string, Ident> => {
  const out = new Map<string, Ident>();
  const used = new Set<string>();
  const objects = Object.values(project.objects).sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
  for (const o of objects) {
    const base = o.type === 'scene' || o.type === 'plotPoint' ? `${o.data.code ?? ''} ${o.name}` : o.name;
    let key = toKey(base);
    let n = 2;
    while (used.has(`${o.type}:${key}`)) key = `${toKey(base)}_${n++}`;
    used.add(`${o.type}:${key}`);
    out.set(o.id, { key, type: toType(key) });
  }
  return out;
};

export interface IrCharacter {
  id: string;
  ident: Ident;
  code: string;
  name: string;
  role: string;
  arc: string;
  color: string;
  description: string;
}

export interface IrInteraction {
  verb: string;
  when?: string;
  becomes?: string;
  sets?: { flag: string; value: string };
  fires?: string;
}

export interface IrObject {
  id: string;
  ident: Ident;
  code: string;
  name: string;
  kind: 'object' | 'puzzle';
  states: string[];
  initial?: string;
  interactions: IrInteraction[];
  notes: string;
  fields: Record<string, string>;
}

export interface IrThing {
  id: string;
  ident: Ident;
  code: string;
  name: string;
  type: ObjectType;
  notes: string;
  fields: Record<string, string>;
}

export interface IrFlag {
  id: string;
  ident: Ident;
  name: string;
  values: string[];
  initial: string;
  setBy: string[];
}

export interface IrTrigger {
  id: string;
  ident: Ident;
  name: string;
  kind: 'trigger' | 'gate';
  /** The condition as written; conditions are plain words until they become structured rules. */
  condition: string;
  effect: string;
  sets?: { flag: string; value: string };
}

export interface IrLine {
  id: string;
  scene: string;
  speaker: string | null;
  text: string;
  direction: string;
  vo: string;
  order: number;
}

export interface IrEvent {
  kind: string;
  ref?: string;
  label: string;
  seconds?: number;
  shots?: number;
  endsWhen?: string;
  condition?: string;
  line?: string;
  /** A choice's option that carries on along the main track. */
  mainLabel?: string;
}

export interface IrScene {
  id: string;
  ident: Ident;
  code: string;
  name: string;
  slug: string;
  summary: string;
  contents: Record<string, string[]>;
  main: IrEvent[];
  branches: { label: string; from: number; events: IrEvent[]; rejoin: number | null }[];
  next: string | null;
}

export interface IrChoice {
  id: string;
  ident: Ident;
  code: string;
  name: string;
  prompt: string;
  scene: string | null;
  options: { label: string; to: string | null }[];
}

export interface IrStoryNode {
  key: string;
  kind: ObjectType;
  name: string;
}

export interface HandoffIR {
  project: { id: string; name: string; key: string };
  spine: IrStoryNode[];
  branches: { from: string; to: string; label: string }[];
  subplots: { key: string; name: string; from: string; to: string; beats: IrStoryNode[] }[];
  arcs: { character: string; name: string; events: { polarity: string; name: string; tiedTo: string | null }[] }[];
  characters: IrCharacter[];
  objects: IrObject[];
  items: IrThing[];
  locations: IrThing[];
  cinematics: IrThing[];
  flags: IrFlag[];
  triggers: IrTrigger[];
  choices: IrChoice[];
  scenes: IrScene[];
  lines: IrLine[];
}

const fieldsOf = (o: StoryObject): Record<string, string> =>
  Object.fromEntries(Object.entries(o.data).filter(([k, v]) => typeof v === 'string' && !['code', 'color', 'initialState', 'setsFlag'].includes(k)) as [string, string][]);

export const buildIR = (project: Project): HandoffIR => {
  const ids = identifiers(project);
  const key = (id: string | undefined | null): string | null => (id && ids.get(id)?.key) || null;
  const all = Object.values(project.objects).sort((a, b) => (a.data.code ?? a.name).localeCompare(b.data.code ?? b.name, undefined, { numeric: true }));
  const of = (...types: ObjectType[]) => all.filter((o) => types.includes(o.type));
  const node = (id: string): IrStoryNode => ({ key: key(id)!, kind: project.objects[id]!.type, name: project.objects[id]!.name });
  const lineId = (sceneCode: string, order: number) => `${toKey(sceneCode || 'scene')}_line_${String(order).padStart(2, '0')}`;
  const sceneOf = (id: string) => project.connections.find((c) => c.kind === 'contains' && c.targetId === id)?.sourceId;

  const scenes: IrScene[] = of('scene').map((s) => {
    const tracks = sceneTimeline(project, s.id);
    const code = s.data.code ?? '';
    const toEvent = (e: (typeof tracks)[number]['events'][number]): IrEvent => {
      const line = e.kind === 'dialogue' && e.refId ? project.lines.find((l) => l.id === e.refId) : undefined;
      return {
        kind: e.kind,
        ...(e.refId && e.kind !== 'dialogue' ? { ref: key(e.refId)! } : {}),
        ...(line ? { line: lineId(code, line.order) } : {}),
        label: eventTitle(project, e),
        ...(e.seconds !== undefined ? { seconds: e.seconds } : {}),
        ...(e.shots !== undefined ? { shots: e.shots } : {}),
        ...(e.endsWhen ? { endsWhen: e.endsWhen } : {}),
        ...(e.condition ? { condition: e.condition } : {}),
        ...(e.kind === 'choice' ? { mainLabel: e.mainLabel ?? '' } : {}),
      };
    };
    const main = tracks[0]!.events;
    const spine = spineSequence(project);
    const at = spine.indexOf(s.id);
    const out = project.connections.find((c) => c.kind === 'branch' && c.sourceId === s.id);
    const location = s.data.locationId ? project.objects[s.data.locationId as string]?.name : undefined;
    return {
      id: s.id,
      ident: ids.get(s.id)!,
      code,
      name: s.name,
      slug: `${s.data.intExt ?? 'INT.'} ${(location ?? 'SOMEWHERE').toUpperCase()} — ${s.data.time ?? 'DAY'}`,
      summary: String(s.data.summary ?? ''),
      contents: Object.fromEntries(
        CATEGORIES.filter((c) => c.key !== 'dialogue').map((c) => [c.key, elementsIn(project, s.id, c.key).map((o) => key(o.id)!)]),
      ),
      main: main.map(toEvent),
      branches: tracks.slice(1).map((t) => ({
        label: t.branch!.label,
        from: main.findIndex((e) => e.id === t.branch!.choiceEventId),
        events: t.events.map(toEvent),
        rejoin: t.branch!.rejoinEventId ? main.findIndex((e) => e.id === t.branch!.rejoinEventId) : null,
      })),
      next: out ? key(out.targetId) : at >= 0 && spine[at + 1] ? key(spine[at + 1]) : null,
    };
  });

  return {
    project: { id: project.id, name: project.name, key: toKey(project.name) },
    spine: spineSequence(project).map(node),
    branches: project.connections
      .filter((c) => c.kind === 'branch' && project.objects[c.sourceId] && project.objects[c.targetId])
      .map((c) => ({ from: key(c.sourceId)!, to: key(c.targetId)!, label: c.label ?? '' })),
    subplots: project.lanes
      .filter((l) => l.kind === 'subplot' && l.span)
      .map((l) => ({ key: toKey(l.name), name: l.name, from: key(l.span!.startRef)!, to: key(l.span!.endRef)!, beats: laneSequence(project, l.id).map(node) })),
    arcs: project.lanes
      .filter((l) => l.kind === 'character')
      .map((l) => ({
        character: key(l.characterId) ?? toKey(l.name),
        name: l.name,
        events: laneSequence(project, l.id).map((id) => ({
          polarity: String(project.objects[id]!.data.polarity ?? 'up'),
          name: project.objects[id]!.name,
          tiedTo: key(project.connections.find((c) => c.kind === 'arcEvent' && c.sourceId === id)?.targetId),
        })),
      })),
    characters: of('character').map((c) => ({
      id: c.id,
      ident: ids.get(c.id)!,
      code: c.data.code ?? '',
      name: c.name,
      role: String(c.data.role ?? ''),
      arc: String(c.data.arc ?? ''),
      color: String(c.data.color ?? '#D9607A'),
      description: c.notes,
    })),
    objects: of('object', 'puzzle').map((o) => ({
      id: o.id,
      ident: ids.get(o.id)!,
      code: o.data.code ?? '',
      name: o.name,
      kind: o.type as 'object' | 'puzzle',
      states: statesOf(o),
      ...(initialState(o) ? { initial: initialState(o) } : {}),
      interactions: interactionsOf(o).map((i) => ({
        verb: i.verb,
        ...(i.when ? { when: i.when } : {}),
        ...(i.becomes ? { becomes: i.becomes } : {}),
        ...(i.setsFlag && key(i.setsFlag) ? { sets: { flag: key(i.setsFlag)!, value: i.flagValue ?? '' } } : {}),
        ...(i.fires && key(i.fires) ? { fires: key(i.fires)! } : {}),
      })),
      notes: o.notes,
      fields: fieldsOf(o),
    })),
    items: of('inventory').map((o) => ({ id: o.id, ident: ids.get(o.id)!, code: o.data.code ?? '', name: o.name, type: o.type, notes: o.notes, fields: fieldsOf(o) })),
    locations: of('environment').map((o) => ({ id: o.id, ident: ids.get(o.id)!, code: o.data.code ?? '', name: o.name, type: o.type, notes: o.notes, fields: fieldsOf(o) })),
    cinematics: of('cinematic').map((o) => {
      const timing = project.events.find((e) => e.refId === o.id);
      return {
        id: o.id,
        ident: ids.get(o.id)!,
        code: o.data.code ?? '',
        name: o.name,
        type: o.type,
        notes: o.notes,
        fields: { ...fieldsOf(o), ...(timing ? { seconds: String(timing.seconds ?? 0), shots: String(timing.shots ?? 1) } : {}) },
      };
    }),
    flags: of('state').map((o) => {
      const values = statesOf(o);
      const setBy = all.filter((x) => interactionsOf(x).some((i) => i.setsFlag === o.id) || (x.type === 'trigger' && x.data.setsFlag === o.id)).map((x) => key(x.id)!);
      return { id: o.id, ident: ids.get(o.id)!, name: o.name, values, initial: initialState(o) ?? values[0] ?? '', setBy };
    }),
    triggers: of('trigger', 'gate').map((o) => ({
      id: o.id,
      ident: ids.get(o.id)!,
      name: o.name,
      kind: o.type as 'trigger' | 'gate',
      condition: String(o.data.when ?? o.data.needs ?? ''),
      effect: String(o.data.does ?? o.data.holds ?? ''),
      ...(o.data.setsFlag && key(o.data.setsFlag as string) ? { sets: { flag: key(o.data.setsFlag as string)!, value: statesOf(project.objects[o.data.setsFlag as string]).at(-1) ?? '' } } : {}),
    })),
    choices: of('choice').map((o) => {
      const scene = sceneOf(o.id);
      const graph = project.connections.filter((c) => c.kind === 'branch' && c.sourceId === o.id).map((c) => ({ label: c.label ?? '', to: key(c.targetId) }));
      const inScene = project.events
        .filter((e) => e.refId === o.id && e.kind === 'choice')
        .flatMap((e) => [
          { label: e.mainLabel ?? 'Continue', to: null as string | null },
          ...project.branches.filter((b) => b.choiceEventId === e.id).map((b) => ({ label: b.label, to: null as string | null })),
        ]);
      // A choice on a track also carries on along it: that is its first option.
      const spine = spineSequence(project);
      const at = spine.indexOf(o.id);
      const onward = at >= 0 && spine[at + 1] ? [{ label: 'Carry on', to: key(spine[at + 1]) }] : [];
      return { id: o.id, ident: ids.get(o.id)!, code: o.data.code ?? '', name: o.name, prompt: String(o.data.prompt ?? ''), scene: key(scene), options: [...onward, ...graph, ...inScene] };
    }),
    scenes,
    lines: project.lines
      .filter((l) => l.kind === 'dialogue' && project.objects[l.sceneId])
      .map((l) => ({
        id: lineId(project.objects[l.sceneId]!.data.code ?? '', l.order),
        scene: key(l.sceneId)!,
        speaker: key(l.speakerId),
        text: l.text,
        direction: l.direction,
        vo: l.vo,
        order: l.order,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
};

export { sceneLines };
