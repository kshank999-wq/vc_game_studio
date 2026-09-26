import { laneSequence, spineSequence } from './layout';
import { newId } from './project';
import { inScene } from './scene';
import type { Connection, ObjectType, Project, StoryObject } from './types';

/**
 * What an element holds beyond its name (step 6: element detail). Every
 * field lives on the one canonical object; what differs from scene to scene
 * lives on the scene's 'contains' connection as its use.
 */

export interface FieldSpec {
  key: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  options?: readonly string[];
}

/** The fields each type has, besides description and asset notes. */
export const FIELDS: Partial<Record<ObjectType, readonly FieldSpec[]>> = {
  character: [
    { key: 'role', label: 'Role', options: ['Main', 'Player character', 'NPC', 'Minor'] },
    { key: 'arc', label: 'Arc', placeholder: 'Guarded → trusting' },
    { key: 'voice', label: 'Voice / casting', placeholder: 'Low, dry, local accent' },
  ],
  object: [{ key: 'location', label: 'Where it is', placeholder: 'Half-buried by the door' }],
  environment: [
    { key: 'appearance', label: 'Appearance', multiline: true, placeholder: 'Ankle-deep water, green bronze door' },
    { key: 'lighting', label: 'Lighting / weather', placeholder: 'Lantern only' },
    { key: 'ambience', label: 'Ambient audio', placeholder: 'Dripping, a low echo' },
    { key: 'traversal', label: 'Traversable areas / obstacles', multiline: true },
  ],
  inventory: [
    { key: 'persists', label: 'Carried', options: ['Between scenes', 'This scene only'] },
    { key: 'use', label: 'How it’s used', placeholder: 'Opens the vault door; consumed' },
  ],
  puzzle: [
    { key: 'solution', label: 'Solution', multiline: true, placeholder: 'Drain the seam, then turn the key' },
    { key: 'hints', label: 'Hints', multiline: true },
    { key: 'failState', label: 'Fail state', placeholder: 'The chamber floods' },
  ],
  trigger: [
    { key: 'when', label: 'Fires when', placeholder: 'lever = up' },
    { key: 'does', label: 'What it does', placeholder: 'Water drains from the seam' },
  ],
  gate: [
    { key: 'needs', label: 'Needs', placeholder: 'Vault Key and lever up' },
    { key: 'holds', label: 'What it holds back', placeholder: 'The Turn the key choice' },
  ],
  choice: [
    { key: 'prompt', label: 'Player-facing prompt', placeholder: 'Turn the key?' },
    { key: 'consequences', label: 'Consequences', multiline: true },
  ],
  cinematic: [
    { key: 'camera', label: 'Camera / framing', multiline: true, placeholder: 'Slow push in on the seam' },
    { key: 'audio', label: 'Audio', placeholder: 'Grind of bronze, water rush' },
    { key: 'transition', label: 'Back to gameplay', placeholder: 'Cut to the explorer, control returns' },
  ],
  plotPoint: [{ key: 'turn', label: 'What turns here', placeholder: 'The way down is found' }],
  scene: [
    { key: 'summary', label: 'Summary', multiline: true },
    { key: 'purpose', label: 'Purpose', placeholder: 'Open the vault' },
  ],
};

/** What an element is in one scene (SceneUse). */
export const USE_FIELDS: Partial<Record<ObjectType, readonly FieldSpec[]>> = {
  character: [
    { key: 'presence', label: 'Presence', options: ['Present', 'Enters', 'Leaves', 'Mentioned', 'Off-screen voice'] },
    { key: 'behaviour', label: 'Behaviour', placeholder: 'Leads if trust ≥ 1' },
    { key: 'objective', label: 'Objective here', placeholder: 'Find the lever' },
    { key: 'equipment', label: 'Carrying', placeholder: 'Lantern' },
  ],
  object: [{ key: 'placement', label: 'Placement in this scene', placeholder: 'By the door, underwater' }],
  environment: [{ key: 'variation', label: 'Variation in this scene', placeholder: 'Flooded to the knee' }],
  inventory: [{ key: 'here', label: 'In this scene', options: ['Picked up', 'Used', 'Consumed', 'Carried'] }],
};

/** Things with a physical asset get asset notes and production tags. */
export const HAS_ASSETS: readonly ObjectType[] = ['character', 'object', 'environment', 'inventory', 'puzzle', 'cinematic', 'scene'];

export const PRODUCTION_TAGS = ['Art', 'Model', 'Rig', 'Animation', 'VFX', 'Audio', 'VO', 'Music', 'UI'] as const;

const setData = (project: Project, id: string, patch: Record<string, unknown>): Project => {
  const object = project.objects[id];
  if (!object) return project;
  const data = { ...object.data };
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
    if (empty) {
      if (key in data) {
        delete data[key];
        changed = true;
      }
    } else if (JSON.stringify(data[key]) !== JSON.stringify(value)) {
      data[key] = value;
      changed = true;
    }
  }
  if (!changed) return project;
  return { ...project, objects: { ...project.objects, [id]: { ...object, data, modified: new Date().toISOString() } } };
};

export const setField = (project: Project, id: string, key: string, value: string): Project => setData(project, id, { [key]: value.trim() });

export const setNotes = (project: Project, id: string, notes: string): Project => {
  const object = project.objects[id];
  if (!object || object.notes === notes) return project;
  return { ...project, objects: { ...project.objects, [id]: { ...object, notes, modified: new Date().toISOString() } } };
};

export const toggleTag = (project: Project, id: string, tag: string): Project => {
  const tags = (project.objects[id]?.data.production as string[] | undefined) ?? [];
  return setData(project, id, { production: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag] });
};

// ---------------------------------------------------------------- scene use

const containsLink = (project: Project, sceneId: string, id: string): Connection | undefined =>
  project.connections.find((c) => c.kind === 'contains' && c.sourceId === sceneId && c.targetId === id);

export const sceneUse = (project: Project, sceneId: string, id: string): Record<string, string> => containsLink(project, sceneId, id)?.use ?? {};

export const setSceneUse = (project: Project, sceneId: string, id: string, key: string, value: string): Project => {
  const link = containsLink(project, sceneId, id);
  if (!link) return project;
  const use = { ...(link.use ?? {}) };
  const clean = value.trim();
  if ((use[key] ?? '') === clean) return project;
  if (clean) use[key] = clean;
  else delete use[key];
  return { ...project, connections: project.connections.map((c) => (c === link ? { ...c, use } : c)) };
};

// ---------------------------------------------------------------- states and interactions

/** An interaction with an object: a verb, when it's allowed, and what it changes. */
export interface Interaction {
  id: string;
  verb: string;
  /** Only allowed while the object is in this state. */
  when?: string;
  /** The object's state afterwards. */
  becomes?: string;
  /** A state element this sets, and to which value. */
  setsFlag?: string;
  flagValue?: string;
  /** A trigger this fires. */
  fires?: string;
}

export const statesOf = (object: StoryObject | undefined): string[] => {
  if (!object) return [];
  const states = object.data.states as string[] | undefined;
  if (states) return states;
  return object.type === 'state' ? ['no', 'yes'] : [];
};

export const initialState = (object: StoryObject | undefined): string | undefined =>
  (object?.data.initialState as string | undefined) ?? statesOf(object)[0];

export const interactionsOf = (object: StoryObject | undefined): Interaction[] => (object?.data.interactions as Interaction[] | undefined) ?? [];

export const setStates = (project: Project, id: string, states: string[]): Project => {
  const clean = [...new Set(states.map((s) => s.trim()).filter(Boolean))];
  const object = project.objects[id];
  const initial = initialState(object);
  // Interactions that named a state that is gone lose that part; nothing else changes.
  const interactions = interactionsOf(object).map((i) => {
    const next = { ...i };
    if (next.when && !clean.includes(next.when)) delete next.when;
    if (next.becomes && !clean.includes(next.becomes)) delete next.becomes;
    return next;
  });
  return setData(project, id, {
    states: clean,
    initialState: initial && clean.includes(initial) ? initial : clean[0],
    interactions: interactions.length ? interactions : undefined,
  });
};

export const setInitialState = (project: Project, id: string, state: string): Project => setData(project, id, { initialState: state });

export const addInteraction = (project: Project, id: string): Project => {
  const object = project.objects[id];
  const states = statesOf(object);
  const interaction: Interaction = { id: newId('act'), verb: 'Use', ...(states[0] ? { when: states[0] } : {}), ...(states[1] ? { becomes: states[1] } : {}) };
  return setData(project, id, { interactions: [...interactionsOf(object), interaction] });
};

export const updateInteraction = (project: Project, id: string, interactionId: string, patch: Partial<Interaction>): Project => {
  const list = interactionsOf(project.objects[id]).map((i) => {
    if (i.id !== interactionId) return i;
    const next: Interaction = { ...i, ...patch };
    for (const key of Object.keys(next) as (keyof Interaction)[]) if (next[key] === '' || next[key] === undefined) delete next[key];
    return next;
  });
  return setData(project, id, { interactions: list });
};

export const removeInteraction = (project: Project, id: string, interactionId: string): Project =>
  setData(project, id, { interactions: interactionsOf(project.objects[id]).filter((i) => i.id !== interactionId) });

/** How an interaction reads: "Pull · only when down → up · sets door_solved = yes · fires Seam drains". */
export const describeInteraction = (project: Project, i: Interaction): string => {
  const parts = [i.verb || 'Use'];
  if (i.when) parts.push(`only when ${i.when}`);
  const effects: string[] = [];
  if (i.becomes) effects.push(`becomes ${i.becomes}`);
  if (i.setsFlag) effects.push(`sets ${project.objects[i.setsFlag]?.name ?? '?'}${i.flagValue ? ` = ${i.flagValue}` : ''}`);
  if (i.fires) effects.push(`fires ${project.objects[i.fires]?.name ?? '?'}`);
  return [...parts, ...effects].join(' · ');
};

/** What sets a state element: interactions on objects, and triggers that set it. */
export const settersOf = (project: Project, stateId: string): StoryObject[] =>
  Object.values(project.objects).filter(
    (o) => interactionsOf(o).some((i) => i.setsFlag === stateId) || (o.type === 'trigger' && o.data.setsFlag === stateId),
  );

// ---------------------------------------------------------------- where used

export type Destination =
  | { kind: 'scene'; sceneId: string; mode: 'open' | 'exploded' | 'timeline' }
  | { kind: 'graph'; id: string };

export interface Usage {
  label: string;
  detail: string;
  symbol: ObjectType;
  to: Destination;
}

/** Every place an element appears, each a way back to it (spec §19: where used). */
export const whereUsed = (project: Project, id: string): Usage[] => {
  const object = project.objects[id];
  if (!object) return [];
  const uses: Usage[] = [];
  const name = (oid: string) => {
    const o = project.objects[oid];
    return o ? `${o.data.code ? `${o.data.code} ` : ''}${o.name}` : '?';
  };

  const placement = project.placements[id];
  if (placement) {
    const lane = project.lanes.find((l) => l.id === placement.laneId);
    const where = lane ? (lane.kind === 'spine' ? 'on the spine' : `on ${lane.kind === 'subplot' ? 'the subplot' : 'the arc'} “${lane.name}”`) : 'a branch above the spine';
    let at = '';
    if (lane?.kind === 'spine') at = ` · ${spineSequence(project).indexOf(id) + 1} of ${spineSequence(project).length}`;
    if (lane?.kind === 'subplot') at = ` · beat ${laneSequence(project, lane.id).indexOf(id) + 1}`;
    uses.push({ label: 'Story graph', detail: `${where}${at}`, symbol: object.type, to: { kind: 'graph', id } });
  }

  // Scenes that hold it, with what it does there.
  for (const c of project.connections) {
    if (c.kind !== 'contains' || c.targetId !== id || !project.objects[c.sourceId]) continue;
    const lines = project.lines.filter((l) => l.sceneId === c.sourceId && l.speakerId === id).length;
    const use = c.use ?? {};
    const detail = [
      use.presence ?? (object.type === 'character' ? 'present' : ''),
      lines ? `${lines} line${lines === 1 ? '' : 's'}` : '',
      use.behaviour ? `behaviour: ${use.behaviour}` : '',
      use.here ?? '',
      project.objects[c.sourceId]?.data.locationId === id ? 'where it’s set' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    uses.push({ label: name(c.sourceId), detail: detail || 'in the scene', symbol: 'scene', to: { kind: 'scene', sceneId: c.sourceId, mode: 'exploded' } });
  }

  // Branches that lead to it or from it, and arc events tied to it.
  for (const c of project.connections) {
    if (c.kind === 'contains') continue;
    if (c.targetId === id && c.kind === 'branch') {
      uses.push({ label: name(c.sourceId), detail: c.label ? `“${c.label}” leads here` : 'leads here', symbol: project.objects[c.sourceId]?.type ?? 'choice', to: { kind: 'graph', id: c.sourceId } });
    }
    if (c.kind === 'arcEvent' && c.targetId === id) {
      const lane = project.lanes.find((l) => l.id === project.placements[c.sourceId]?.laneId);
      uses.push({ label: `Arc · ${lane?.name ?? '?'}`, detail: project.objects[c.sourceId]?.name ?? '', symbol: 'arcEvent', to: { kind: 'graph', id: c.sourceId } });
    }
  }

  // A character's arc lane.
  for (const lane of project.lanes) {
    if (lane.characterId !== id) continue;
    const events = laneSequence(project, lane.id).length;
    uses.push({ label: `Arc lane · ${lane.name}`, detail: `${events} event${events === 1 ? '' : 's'}`, symbol: 'arcEvent', to: { kind: 'graph', id: laneSequence(project, lane.id)[0] ?? id } });
  }

  // Timeline events that stand for it.
  for (const e of project.events) {
    if (e.refId !== id || !project.objects[e.sceneId]) continue;
    uses.push({ label: `${name(e.sceneId)} · timeline`, detail: `${e.kind === 'freePlay' ? 'free play' : e.kind} event`, symbol: 'scene', to: { kind: 'scene', sceneId: e.sceneId, mode: 'timeline' } });
  }

  // Interactions and triggers that set or fire it.
  for (const o of Object.values(project.objects)) {
    for (const i of interactionsOf(o)) {
      if (i.setsFlag === id || i.fires === id) {
        uses.push({ label: name(o.id), detail: `${i.verb} ${i.setsFlag === id ? 'sets it' : 'fires it'}`, symbol: o.type, to: firstScene(project, o.id) });
      }
    }
  }
  return uses;
};

const firstScene = (project: Project, id: string): Destination => {
  const c = project.connections.find((x) => x.kind === 'contains' && x.targetId === id);
  return c ? { kind: 'scene', sceneId: c.sourceId, mode: 'exploded' } : { kind: 'graph', id };
};

export { inScene };
