import { spineSequence } from './layout';
import { newId } from './project';
import { addElement, addLine, inScene, removeLine, sceneElements, sceneLines } from './scene';
import type { DialogueLine, EventKind, ObjectType, Project, TimelineBranch, TimelineEvent } from './types';

/**
 * A scene's timeline (spec §13): how it plays from entry to exit. Events sit
 * on the main track or on a choice's branch; order along a track is playing
 * order. Dialogue lines are on it from the moment they are written: an
 * unmoved line is placed after the stored events, in script order, and is
 * stored only once the user moves it. Its id is always `dlg_<line id>`.
 */

export const MAIN = 'main';

const dialogueId = (lineId: string): string => `dlg_${lineId}`;
const lineOf = (project: Project, event: TimelineEvent): DialogueLine | undefined =>
  event.kind === 'dialogue' && event.refId ? project.lines.find((l) => l.id === event.refId) : undefined;

/** Which kind of event an element becomes when it joins the timeline. */
export const eventKindFor = (type: ObjectType): EventKind | null => {
  switch (type) {
    case 'cinematic':
      return 'cinematic';
    case 'choice':
      return 'choice';
    case 'trigger':
    case 'gate':
    case 'state':
      return 'trigger';
    case 'object':
    case 'puzzle':
    case 'inventory':
      return 'interaction';
    case 'dialogue':
      return 'dialogue';
    default:
      return null;
  }
};

export interface Track {
  id: string;
  branch?: TimelineBranch;
  events: TimelineEvent[];
}

/** Every event of a scene, stored and implicit, still pointing at something that exists. */
const allEvents = (project: Project, sceneId: string): TimelineEvent[] => {
  const stored = project.events.filter(
    (e) => e.sceneId === sceneId && (!e.refId || (e.kind === 'dialogue' ? project.lines.some((l) => l.id === e.refId) : !!project.objects[e.refId])),
  );
  const placed = new Set(stored.filter((e) => e.kind === 'dialogue').map((e) => e.refId));
  let order = Math.max(0, ...stored.filter((e) => e.track === MAIN).map((e) => e.order));
  const implicit: TimelineEvent[] = sceneLines(project, sceneId)
    .filter((l) => l.kind === 'dialogue' && !placed.has(l.id))
    .map((l) => ({ id: dialogueId(l.id), sceneId, kind: 'dialogue', track: MAIN, order: ++order, refId: l.id, label: '', detail: '' }));
  return [...stored, ...implicit];
};

/** The main track first, then each branch, events in playing order. */
export const sceneTimeline = (project: Project, sceneId: string): Track[] => {
  const events = allEvents(project, sceneId);
  const byOrder = (a: TimelineEvent, b: TimelineEvent) => a.order - b.order;
  const choices = new Set(events.filter((e) => e.kind === 'choice').map((e) => e.id));
  const branches = project.branches.filter((b) => b.sceneId === sceneId && choices.has(b.choiceEventId));
  return [
    { id: MAIN, events: events.filter((e) => e.track === MAIN).sort(byOrder) },
    ...branches.map((branch) => ({ id: branch.id, branch, events: events.filter((e) => e.track === branch.id).sort(byOrder) })),
  ];
};

export const findEvent = (project: Project, sceneId: string, id: string): TimelineEvent | undefined =>
  allEvents(project, sceneId).find((e) => e.id === id);

export interface TimelineSummary {
  events: number;
  branches: number;
  freePlay: number;
  kinds: EventKind[];
}

/** For the collapsed timeline strip under the writing box. */
export const timelineSummary = (project: Project, sceneId: string): TimelineSummary => {
  const tracks = sceneTimeline(project, sceneId);
  const all = tracks.flatMap((t) => t.events);
  return {
    events: all.length,
    branches: tracks.length - 1,
    freePlay: all.filter((e) => e.kind === 'freePlay').length,
    kinds: (tracks[0]?.events ?? []).map((e) => e.kind),
  };
};

/** Store an implicit dialogue event so it can be moved; a stored event is returned as it is. */
const materialize = (project: Project, event: TimelineEvent): Project =>
  project.events.some((e) => e.id === event.id) ? project : { ...project, events: [...project.events, event] };

/** Give a track's events whole-number orders in their current sequence. */
const renumber = (project: Project, sceneId: string, trackId: string, sequence: string[]): Project => {
  let next = project;
  const current = allEvents(next, sceneId);
  for (const id of sequence) {
    const event = current.find((e) => e.id === id);
    if (event) next = materialize(next, event);
  }
  const order = new Map(sequence.map((id, i) => [id, i + 1]));
  return {
    ...next,
    events: next.events.map((e) => (order.has(e.id) ? { ...e, track: trackId, order: order.get(e.id)! } : e)),
  };
};

/** Move an event to `index` on a track (the same track, or another). */
export const moveEvent = (project: Project, sceneId: string, id: string, trackId: string, index: number): Project => {
  const tracks = sceneTimeline(project, sceneId);
  const event = tracks.flatMap((t) => t.events).find((e) => e.id === id);
  const target = tracks.find((t) => t.id === trackId);
  if (!event || !target) return project;
  // A choice's own branches hang off it; it can't move onto one of them.
  if (event.kind === 'choice' && target.branch?.choiceEventId === event.id) return project;
  const sequence = target.events.map((e) => e.id).filter((e) => e !== id);
  const at = Math.max(0, Math.min(index, sequence.length));
  sequence.splice(at, 0, id);
  const before = target.events.map((e) => e.id);
  if (event.track === trackId && before.join() === sequence.join()) return project;
  let next = renumber(project, sceneId, trackId, sequence);
  if (event.track !== trackId) {
    const source = tracks.find((t) => t.id === event.track);
    if (source) next = renumber(next, sceneId, source.id, source.events.map((e) => e.id).filter((e) => e !== id));
  }
  return next;
};

const DEFAULT_LABEL: Record<EventKind, string> = {
  cinematic: 'Cinematic',
  dialogue: '',
  action: 'Action',
  interaction: 'Interaction',
  trigger: 'Trigger',
  choice: 'Choice',
  freePlay: 'Free play',
};

/**
 * Add an event at `index` on a track (the end by default). An element from
 * the scene becomes its event; a new cinematic, choice or trigger is created
 * in the scene first; a dialogue event adds a script line.
 */
export const addEvent = (
  project: Project,
  sceneId: string,
  kind: EventKind,
  options: { refId?: string; track?: string; index?: number; label?: string } = {},
): { project: Project; id: string } | null => {
  const track = options.track ?? MAIN;
  let next = project;
  let refId = options.refId;
  if (kind === 'dialogue') {
    const lines = sceneLines(project, sceneId);
    const speaker = sceneElements(project, sceneId).find((e) => e.type === 'character')?.id ?? null;
    const added = addLine(project, sceneId, 'dialogue', lines[lines.length - 1]?.id, speaker);
    next = added.project;
    refId = added.id;
  } else if (!refId && (kind === 'cinematic' || kind === 'choice' || kind === 'trigger')) {
    const made = addElement(next, sceneId, kind);
    if (!made) return null;
    next = made.project;
    refId = made.id;
  }
  if (refId && kind !== 'dialogue' && !inScene(next, sceneId, refId)) return null;
  const event: TimelineEvent =
    kind === 'dialogue'
      ? { id: dialogueId(refId!), sceneId, kind, track, order: 0, refId, label: '', detail: '' }
      : {
          id: newId('evt'),
          sceneId,
          kind,
          track,
          order: 0,
          ...(refId ? { refId } : {}),
          label: options.label ?? (refId ? '' : DEFAULT_LABEL[kind]),
          detail: kind === 'action' ? 'scripted' : '',
          ...(kind === 'cinematic' ? { seconds: 6, shots: 1 } : {}),
          ...(kind === 'freePlay' ? { endsWhen: '' } : {}),
          ...(kind === 'choice' ? { mainLabel: 'Option 1' } : {}),
        };
  next = { ...next, events: [...next.events, event] };
  const sequence = sceneTimeline(next, sceneId).find((t) => t.id === track)?.events.map((e) => e.id).filter((e) => e !== event.id) ?? [];
  sequence.splice(Math.max(0, Math.min(options.index ?? sequence.length, sequence.length)), 0, event.id);
  return { project: renumber(next, sceneId, track, sequence), id: event.id };
};

export type EventPatch = Partial<Pick<TimelineEvent, 'label' | 'detail' | 'seconds' | 'shots' | 'endsWhen' | 'condition' | 'mainLabel'>>;

export const updateEvent = (project: Project, sceneId: string, id: string, patch: EventPatch): Project => {
  const event = findEvent(project, sceneId, id);
  if (!event) return project;
  const next = { ...event, ...patch };
  if (JSON.stringify(next) === JSON.stringify(event)) return project;
  const stored = materialize(project, event);
  return { ...stored, events: stored.events.map((e) => (e.id === id ? next : e)) };
};

/**
 * Take an event off the timeline. A dialogue event is its script line, so the
 * line is deleted; a choice takes its branches, and their events, with it.
 */
export const removeEvent = (project: Project, sceneId: string, id: string): Project => {
  const event = findEvent(project, sceneId, id);
  if (!event) return project;
  let next = project;
  if (event.kind === 'dialogue' && event.refId) next = removeLine(next, event.refId);
  const gone = new Set(next.branches.filter((b) => b.choiceEventId === id).map((b) => b.id));
  return {
    ...next,
    events: next.events.filter((e) => e.id !== id && !gone.has(e.track)),
    branches: next.branches
      .filter((b) => !gone.has(b.id))
      .map((b) => (b.rejoinEventId === id ? { ...b, rejoinEventId: null } : b)),
  };
};

// ---------------------------------------------------------------- branches

/** Give a choice another option: a branch track of its own. */
export const addBranch = (project: Project, sceneId: string, choiceEventId: string, label?: string): { project: Project; id: string } | null => {
  const choice = findEvent(project, sceneId, choiceEventId);
  if (choice?.kind !== 'choice') return null;
  const count = project.branches.filter((b) => b.choiceEventId === choiceEventId).length;
  const branch: TimelineBranch = { id: newId('branch'), sceneId, choiceEventId, label: label ?? `Option ${count + 2}`, rejoinEventId: null };
  return { project: materialize({ ...project, branches: [...project.branches, branch] }, choice), id: branch.id };
};

export const updateBranch = (project: Project, id: string, patch: Partial<Pick<TimelineBranch, 'label' | 'rejoinEventId'>>): Project => {
  const branch = project.branches.find((b) => b.id === id);
  if (!branch) return project;
  const next = { ...branch, ...patch };
  if (patch.label !== undefined) next.label = patch.label.trim() || branch.label;
  if (JSON.stringify(next) === JSON.stringify(branch)) return project;
  return { ...project, branches: project.branches.map((b) => (b.id === id ? next : b)) };
};

/** Remove a branch; its events go back onto the main track after the choice rather than vanish. */
export const removeBranch = (project: Project, sceneId: string, id: string): Project => {
  const branch = project.branches.find((b) => b.id === id);
  if (!branch) return project;
  const tracks = sceneTimeline(project, sceneId);
  const main = tracks[0]!.events.map((e) => e.id);
  const own = tracks.find((t) => t.id === id)?.events.map((e) => e.id) ?? [];
  const at = main.indexOf(branch.choiceEventId) + 1;
  main.splice(at, 0, ...own);
  const next = { ...project, branches: project.branches.filter((b) => b.id !== id) };
  return renumber(next, sceneId, MAIN, main);
};

/** Main-track events after a choice: the places its branch can reconnect to. */
export const rejoinTargets = (project: Project, sceneId: string, choiceEventId: string): TimelineEvent[] => {
  const main = sceneTimeline(project, sceneId)[0]!.events;
  const at = main.findIndex((e) => e.id === choiceEventId);
  // Reconnecting before the choice would loop back; that's allowed (retry a puzzle), so offer everything but the choice.
  return main.filter((_, i) => i !== at);
};

// ---------------------------------------------------------------- reading

/** How an event reads on its block: its element's name, its line, or its own label. */
export const eventTitle = (project: Project, event: TimelineEvent): string => {
  if (event.kind === 'dialogue') {
    const line = lineOf(project, event);
    return line?.speakerId ? (project.objects[line.speakerId]?.name.toUpperCase() ?? '?') : 'NO SPEAKER';
  }
  if (event.refId) return project.objects[event.refId]?.name ?? event.label;
  return event.label;
};

export const eventDetail = (project: Project, event: TimelineEvent): string => {
  switch (event.kind) {
    case 'dialogue':
      return lineOf(project, event)?.text || '…';
    case 'cinematic':
      return `${event.seconds ?? 0}s · ${event.shots ?? 1} shot${event.shots === 1 ? '' : 's'}`;
    case 'freePlay':
      return event.endsWhen ? `Ends when: ${event.endsWhen}` : 'Ends when…';
    default:
      return event.condition ? `If ${event.condition}` : event.detail;
  }
};

/** The script line behind a dialogue event. */
export const eventLine = lineOf;

/** Where the scene goes when it ends: the next node on its track, or what it branches to. */
export const sceneExit = (project: Project, sceneId: string): string | null => {
  const placement = project.placements[sceneId];
  if (!placement) return null;
  const out = project.connections.find((c) => c.kind === 'branch' && c.sourceId === sceneId);
  if (out) return project.objects[out.targetId]?.name ?? null;
  if (placement.laneId === null) return null;
  const spine = spineSequence(project);
  const at = spine.indexOf(sceneId);
  if (at < 0) return null;
  const next = project.objects[spine[at + 1] ?? ''];
  if (!next) return null;
  return next.type === 'end' ? 'Ending' : `${next.data.code ?? next.name} on the spine`;
};

/** Consecutive dialogue on a track, for "Group dialogue exchanges". */
export const exchanges = (events: TimelineEvent[]): TimelineEvent[][] => {
  const groups: TimelineEvent[][] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (event.kind === 'dialogue' && last?.[0]?.kind === 'dialogue') last.push(event);
    else groups.push([event]);
  }
  return groups;
};
