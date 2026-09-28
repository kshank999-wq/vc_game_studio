import { interactionsOf, initialState, statesOf } from '../details';
import { laneSequence, spineSequence } from '../layout';
import { CATEGORIES, dualWith, elementsIn, sceneLines } from '../scene';
import { hasInline, plainInline } from '../inline';
import { eventTitle, sceneTimeline } from '../timeline';
import { isEmpty, isRule, type Effect, type Rule } from '../rules';
import { cinematicTiming, shotsOf } from '../shots';
import type { ObjectType, Project, StoryObject } from '../types';
import { buildLevels, type IrLevel } from './levels';
import { paramOf } from '../level/geometry';
import { placeOf, placeToOf } from '../level/places';

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

/** A condition with engine keys in place of ids: { kind: "flag", ref: "vault_door", op: "is", value: "open" }. */
export interface IrCondition {
  kind: string;
  ref: string;
  op: string;
  value?: string | number;
}

export interface IrRule {
  match: 'all' | 'any';
  items: (IrCondition | IrRule)[];
}

export interface IrEffect {
  kind: string;
  ref: string;
  value?: string;
  amount?: number;
}

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
  requires?: IrRule;
  effects?: IrEffect[];
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
  /** A puzzle: what solves it, and what solving it does. */
  solvedWhen?: IrRule;
  effects?: IrEffect[];
}

export interface IrThing {
  id: string;
  ident: Ident;
  code: string;
  name: string;
  type: ObjectType;
  notes: string;
  fields: Record<string, string>;
  /** A cinematic's shot list, in order. */
  shots?: IrShot[];
}

export interface IrShot {
  framing: string;
  move: string;
  lens: string;
  /** Character keys in frame. */
  characters: string[];
  action: string;
  /** The dialogue table id of the line spoken over it. */
  line?: string;
  audio: string;
  vfx: string;
  seconds: number;
  transition: string;
  notes: string;
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
  /** A trigger fires, and a gate opens, when this holds. */
  rule?: IrRule;
  effects?: IrEffect[];
}

export interface IrLine {
  id: string;
  scene: string;
  speaker: string | null;
  text: string;
  direction: string;
  vo: string;
  order: number;
  /** The line with its emphasis, as Fountain writes it (**bold**, *italic*, _underline_). Only when it has some; `text` is always plain. */
  styled?: string;
  /** Dual dialogue: the line this one is spoken at the same time as. */
  dual?: string;
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
  /**
   * Dual dialogue: the line this event's line is spoken at the same time as.
   * When the next event on the track is that line (or names this one), the two
   * play as one beat — the runtimes all do this.
   */
  dual?: string;
  /** A choice's option that carries on along the main track. */
  mainLabel?: string;
  /** What that option does once picked: disappears ('gone') or locks. */
  mainAfter?: 'gone' | 'locked';
  /** Plays only when this holds (a dialogue line's own condition included). */
  when?: IrRule;
  /** A free play ends when this holds. */
  ends?: IrRule;
  /** What happens when it plays; for a choice, when its main option is picked. */
  effects?: IrEffect[];
  /** The level item it happens at (its GUID), and where an actor moves to (spec §7.3). */
  place?: string;
  placeTo?: string;
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
  branches: { label: string; from: number; events: IrEvent[]; rejoin: number | null; when?: IrRule; effects?: IrEffect[]; after?: 'gone' | 'locked'; hide?: boolean }[];
  next: string | null;
  /** The routes out of this scene on the graph, taken in order: the first whose conditions hold. */
  exits: { to: string; label: string; when?: IrRule; effects?: IrEffect[] }[];
  /** Where the story goes when no route out applies: the next node on its track. */
  onward: string | null;
}

export interface IrChoice {
  id: string;
  ident: Ident;
  code: string;
  name: string;
  prompt: string;
  scene: string | null;
  /** `key` is stable for the option within its choice, for remembering picks. */
  options: { key: string; label: string; to: string | null; when?: IrRule; effects?: IrEffect[]; after?: 'gone' | 'locked'; hide?: boolean }[];
  /** The choice is offered at all only when this holds. */
  available?: IrRule;
}

export interface IrStoryNode {
  key: string;
  kind: ObjectType;
  name: string;
}

/** Every node on the story graph, with where it goes: routes in order (first whose conditions hold), else onward. */
export interface IrGraphNode extends IrStoryNode {
  onward: string | null;
  routes: { to: string; label: string; when?: IrRule; effects?: IrEffect[] }[];
  outcome?: 'ending' | 'gameOver';
}

export interface HandoffIR {
  project: { id: string; name: string; key: string };
  spine: IrStoryNode[];
  graph: IrGraphNode[];
  branches: { from: string; to: string; label: string; when?: IrRule; effects?: IrEffect[] }[];
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
  /** The Level Designer's levels (docs/LEVEL-DESIGNER.md). */
  levels: IrLevel[];
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
  const rule = (r: Rule | undefined): IrRule | undefined => {
    if (!r || isEmpty(r)) return undefined;
    const items = r.items.flatMap((i): (IrCondition | IrRule)[] => {
      if (isRule(i)) {
        const inner = rule(i);
        return inner ? [inner] : [];
      }
      const ref = key(i.ref);
      if (!ref) return [];
      return [{ kind: i.kind, ref, op: i.op, ...('value' in i && i.value !== '' ? { value: i.value } : {}) }];
    });
    return items.length ? { match: r.match, items } : undefined;
  };
  const effects = (list: Effect[] | undefined): IrEffect[] | undefined => {
    const out = (list ?? []).flatMap((e): IrEffect[] => {
      const ref = key(e.ref);
      if (!ref) return [];
      return [{ kind: e.kind, ref, ...('value' in e ? { value: e.value } : {}), ...('amount' in e ? { amount: e.amount } : {}) }];
    });
    return out.length ? out : undefined;
  };
  const both = (a: Rule | undefined, b: Rule | undefined): Rule | undefined =>
    isEmpty(a) ? b : isEmpty(b) ? a : { match: 'all', items: [a!, b!] };
  const ruled = (w: IrRule | undefined, e: IrEffect[] | undefined) => ({ ...(w ? { when: w } : {}), ...(e ? { effects: e } : {}) });
  const sceneOf = (id: string) => project.connections.find((c) => c.kind === 'contains' && c.targetId === id)?.sourceId;

  // A place goes to the engine only when its item does.
  const exported = (item: { id: string; hidden?: boolean } | null | undefined): boolean => {
    const set = project.levels;
    const full = item && set?.items.find((i) => i.id === item.id);
    return !!full && !full.hidden && paramOf(set!, full, 'export') !== false;
  };
  const scenes: IrScene[] = of('scene').map((s) => {
    const tracks = sceneTimeline(project, s.id);
    const code = s.data.code ?? '';
    const toEvent = (e: (typeof tracks)[number]['events'][number]): IrEvent => {
      const line = e.kind === 'dialogue' && e.refId ? project.lines.find((l) => l.id === e.refId) : undefined;
      return {
        kind: e.kind,
        ...(e.refId && e.kind !== 'dialogue' ? { ref: key(e.refId)! } : {}),
        ...(line ? { line: lineId(code, line.order) } : {}),
        ...((partner) => (partner ? { dual: lineId(code, partner.order) } : {}))(line && dualWith(project, line.id)),
        label: eventTitle(project, e),
        ...(e.seconds !== undefined ? { seconds: e.seconds } : {}),
        ...(e.shots !== undefined ? { shots: e.shots } : {}),
        ...(e.endsWhen ? { endsWhen: e.endsWhen } : {}),
        ...(e.condition ? { condition: e.condition } : {}),
        ...(e.kind === 'choice' ? { mainLabel: e.mainLabel ?? '' } : {}),
        ...(e.kind === 'choice' && e.mainAfter ? { mainAfter: e.mainAfter } : {}),
        ...ruled(rule(both(both(e.when, line?.conditions), e.kind === 'choice' && e.refId ? (project.objects[e.refId]?.data.rule as Rule | undefined) : undefined)), effects(e.effects)),
        ...(rule(e.ends) ? { ends: rule(e.ends) } : {}),
        ...(exported(placeOf(project, e)?.item) ? { place: placeOf(project, e)!.item.id } : {}),
        ...(exported(placeToOf(project, e)) ? { placeTo: placeToOf(project, e)!.id } : {}),
      };
    };
    const main = tracks[0]!.events;
    const spine = spineSequence(project);
    const at = spine.indexOf(s.id);
    const exits = project.connections.filter((c) => c.kind === 'branch' && c.sourceId === s.id && project.objects[c.targetId]);
    const onward = at >= 0 && spine[at + 1] ? key(spine[at + 1]) : null;
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
        ...ruled(rule(t.branch!.when), effects(t.branch!.effects)),
        ...(t.branch!.after ? { after: t.branch!.after } : {}),
        ...(t.branch!.hideUnavailable ? { hide: true } : {}),
      })),
      next: exits[0] ? key(exits[0].targetId) : onward,
      exits: exits.map((c) => ({ to: key(c.targetId)!, label: c.label ?? '', ...ruled(rule(c.conditions), effects(c.effects)) })),
      onward,
    };
  });

  return {
    project: { id: project.id, name: project.name, key: toKey(project.name) },
    spine: spineSequence(project).map(node),
    graph: Object.keys(project.placements)
      .filter((id) => project.objects[id] && project.objects[id]!.type !== 'arcEvent')
      .sort((a, b) => key(a)!.localeCompare(key(b)!))
      .map((id): IrGraphNode => {
        const spine = spineSequence(project);
        const at = spine.indexOf(id);
        const outcome = project.objects[id]!.data.outcome;
        return {
          ...node(id),
          onward: at >= 0 && spine[at + 1] ? key(spine[at + 1]) : null,
          routes: project.connections
            .filter((c) => c.kind === 'branch' && c.sourceId === id && project.objects[c.targetId])
            .map((c) => ({ to: key(c.targetId)!, label: c.label ?? '', ...ruled(rule(c.conditions), effects(c.effects)) })),
          ...(outcome ? { outcome } : {}),
        };
      }),
    branches: project.connections
      .filter((c) => c.kind === 'branch' && project.objects[c.sourceId] && project.objects[c.targetId])
      .map((c) => ({ from: key(c.sourceId)!, to: key(c.targetId)!, label: c.label ?? '', ...ruled(rule(c.conditions), effects(c.effects)) })),
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
        ...(rule(i.requires) ? { requires: rule(i.requires) } : {}),
        ...(effects(i.effects) ? { effects: effects(i.effects) } : {}),
      })),
      notes: o.notes,
      fields: fieldsOf(o),
      ...(o.type === 'puzzle' && rule(o.data.rule as Rule | undefined) ? { solvedWhen: rule(o.data.rule as Rule | undefined) } : {}),
      ...(o.type === 'puzzle' && effects(o.data.effects as Effect[] | undefined) ? { effects: effects(o.data.effects as Effect[] | undefined) } : {}),
    })),
    items: of('inventory').map((o) => ({ id: o.id, ident: ids.get(o.id)!, code: o.data.code ?? '', name: o.name, type: o.type, notes: o.notes, fields: fieldsOf(o) })),
    locations: of('environment').map((o) => ({ id: o.id, ident: ids.get(o.id)!, code: o.data.code ?? '', name: o.name, type: o.type, notes: o.notes, fields: fieldsOf(o) })),
    cinematics: of('cinematic').map((o) => {
      const event = project.events.find((e) => e.refId === o.id);
      const timing = event || shotsOf(o).length ? cinematicTiming(project, o.id, event) : undefined;
      const shots = shotsOf(o).map((s): IrShot => {
        const line = s.lineId ? project.lines.find((l) => l.id === s.lineId) : undefined;
        return {
          framing: s.framing,
          move: s.move,
          lens: s.lens,
          characters: s.characters.map((c) => key(c)).filter((k): k is string => !!k),
          action: s.action,
          ...(line && project.objects[line.sceneId] ? { line: lineId(project.objects[line.sceneId]!.data.code ?? '', line.order) } : {}),
          audio: s.audio,
          vfx: s.vfx,
          seconds: s.seconds,
          transition: s.transition,
          notes: s.notes,
        };
      });
      return {
        id: o.id,
        ident: ids.get(o.id)!,
        code: o.data.code ?? '',
        name: o.name,
        type: o.type,
        notes: o.notes,
        fields: { ...fieldsOf(o), ...(timing ? { seconds: String(timing.seconds), shots: String(timing.shots) } : {}) },
        ...(shots.length ? { shots } : {}),
      };
    }),
    flags: of('state').map((o) => {
      const values = statesOf(o);
      const sets = (list: unknown) => ((list as Effect[] | undefined) ?? []).some((e) => e.kind === 'setFlag' && e.ref === o.id);
      const setBy = all
        .filter((x) => interactionsOf(x).some((i) => i.setsFlag === o.id || sets(i.effects)) || (x.type === 'trigger' && x.data.setsFlag === o.id) || sets(x.data.effects))
        .map((x) => key(x.id)!);
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
      ...(rule(o.data.rule as Rule | undefined) ? { rule: rule(o.data.rule as Rule | undefined) } : {}),
      ...(effects(o.data.effects as Effect[] | undefined) ? { effects: effects(o.data.effects as Effect[] | undefined) } : {}),
    })),
    choices: of('choice').map((o) => {
      const scene = sceneOf(o.id);
      const behaviour = (b: { after?: 'gone' | 'locked'; hideUnavailable?: boolean }) => ({ ...(b.after ? { after: b.after } : {}), ...(b.hideUnavailable ? { hide: true } : {}) });
      const graph = project.connections
        .filter((c) => c.kind === 'branch' && c.sourceId === o.id)
        .map((c) => ({ label: c.label ?? '', to: key(c.targetId), ...ruled(rule(c.conditions), effects(c.effects)), ...behaviour(c) }));
      const inScene = project.events
        .filter((e) => e.refId === o.id && e.kind === 'choice')
        .flatMap((e) => [
          { label: e.mainLabel ?? 'Continue', to: null as string | null, ...ruled(undefined, effects(e.effects)), ...behaviour({ after: e.mainAfter }) },
          ...project.branches.filter((b) => b.choiceEventId === e.id).map((b) => ({ label: b.label, to: null as string | null, ...ruled(rule(b.when), effects(b.effects)), ...behaviour(b) })),
        ]);
      // A choice on a track also carries on along it: that is its first option.
      const spine = spineSequence(project);
      const at = spine.indexOf(o.id);
      const onward = at >= 0 && spine[at + 1] ? [{ label: 'Carry on', to: key(spine[at + 1]) }] : [];
      // Each option's key: its words as an identifier, numbered if two read the same.
      const used = new Set<string>();
      const options = [...onward, ...graph, ...inScene].map((opt) => {
        const base = toKey(opt.label || 'option');
        let k = base;
        for (let n = 2; used.has(k); n++) k = `${base}_${n}`;
        used.add(k);
        return { key: k, ...opt };
      });
      return { id: o.id, ident: ids.get(o.id)!, code: o.data.code ?? '', name: o.name, prompt: String(o.data.prompt ?? ''), scene: key(scene), options, ...(rule(o.data.rule as Rule | undefined) ? { available: rule(o.data.rule as Rule | undefined) } : {}) };
    }),
    scenes,
    lines: project.lines
      .filter((l) => l.kind === 'dialogue' && project.objects[l.sceneId])
      .map((l) => ({
        id: lineId(project.objects[l.sceneId]!.data.code ?? '', l.order),
        scene: key(l.sceneId)!,
        speaker: key(l.speakerId),
        text: plainInline(l.text),
        direction: l.direction,
        vo: l.vo,
        order: l.order,
        ...(hasInline(l.text) ? { styled: l.text } : {}),
        ...((partner) => (partner ? { dual: lineId(project.objects[l.sceneId]!.data.code ?? '', partner.order) } : {}))(dualWith(project, l.id)),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    levels: buildLevels(project, { key, rule, effects, toKey }),
  };
};

export { sceneLines };
