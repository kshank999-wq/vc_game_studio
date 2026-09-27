import { laneSequence, spineSequence } from './layout';
import { setterNames } from './details';
import { brokenReferences } from './rules';
import type { ObjectType, Project, StoryObject } from './types';

/**
 * What needs a look (spec §25). Shown as a compact red "!" on the node until
 * the user asks for the detail; nothing here blocks editing.
 */
export interface Issue {
  id: string;
  message: string;
}

/** What each kind of element needs in the Bible once a scene uses it, in words for the warning. */
const CANONICAL: Partial<Record<ObjectType, string>> = {
  character: 'has no role or description',
  object: 'has no states, interactions or description',
  environment: 'has no description',
  inventory: 'has no description or use',
  puzzle: 'has no solution or description',
};

const hasCanonicalData = (o: StoryObject): boolean => {
  if (o.notes.trim()) return true;
  const filled = (k: string) => String(o.data[k] ?? '').trim() !== '';
  switch (o.type) {
    case 'character':
      return filled('role') || filled('arc');
    case 'object':
      return ((o.data.states as string[] | undefined) ?? []).length > 0 || ((o.data.interactions as unknown[] | undefined) ?? []).length > 0 || filled('location');
    case 'environment':
      return ['appearance', 'lighting', 'ambience', 'traversal'].some(filled);
    case 'inventory':
      return filled('use') || filled('persists');
    case 'puzzle':
      return filled('solution') || !!o.data.rule;
    default:
      return true;
  }
};

export const findIssues = (project: Project): Issue[] => {
  const issues: Issue[] = [];
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const c of project.connections) {
    if (c.kind === 'arcEvent') continue;
    outgoing.set(c.sourceId, (outgoing.get(c.sourceId) ?? 0) + 1);
    incoming.set(c.targetId, (incoming.get(c.targetId) ?? 0) + 1);
  }
  const tied = new Set(project.connections.filter((c) => c.kind === 'arcEvent').map((c) => c.sourceId));
  const spine = new Set(spineSequence(project));
  const onSubplot = new Set(
    project.lanes.filter((l) => l.kind === 'subplot').flatMap((l) => laneSequence(project, l.id)),
  );

  for (const [id, placement] of Object.entries(project.placements)) {
    const object = project.objects[id];
    if (!object) continue;
    if (object.type === 'arcEvent') {
      if (!tied.has(id)) issues.push({ id, message: 'Tie this arc event to the story moment that causes it' });
      continue;
    }
    if (placement.laneId === null) {
      if (!incoming.get(id)) issues.push({ id, message: 'Nothing leads here. Connect a choice or node to it.' });
      else if (!outgoing.get(id) && !object.data.outcome) {
        issues.push({ id, message: 'Dead end. Connect it onward, or mark it as an ending or game over.' });
      } else if (object.type === 'choice' && (outgoing.get(id) ?? 0) < 2 && !object.data.outcome) {
        issues.push({ id, message: 'A choice needs at least two options' });
      }
      continue;
    }
    // On a track the next node is implicit, so a choice needs at least one branch off it.
    if (object.type === 'choice' && (spine.has(id) || onSubplot.has(id)) && !outgoing.get(id)) {
      issues.push({ id, message: 'This choice has one way forward. Drag from its ring to add a branch.' });
    }
  }
  // A state the game remembers but nothing ever changes (mockup 04: door_solved).
  for (const object of Object.values(project.objects)) {
    if (object.type !== 'state') continue;
    const used = project.connections.some((c) => c.kind === 'contains' && c.targetId === object.id);
    if (used && setterNames(project, object.id).length === 0) {
      issues.push({ id: object.id, message: 'Nothing sets this state. Give an interaction or trigger “sets” it.' });
    }
  }
  // A condition or effect that points at something deleted (spec §25).
  for (const b of brokenReferences(project)) {
    if (!issues.some((i) => i.id === b.owner)) issues.push({ id: b.owner, message: `A condition or effect in ${b.where} points at something that no longer exists.` });
  }
  // Scenes (spec §25: orphaned or incomplete scene).
  for (const scene of Object.values(project.objects)) {
    if (scene.type !== 'scene') continue;
    if (!project.placements[scene.id]) {
      issues.push({ id: scene.id, message: 'Not on the story graph: drag it onto the spine or a branch.' });
      continue;
    }
    const written =
      String(scene.data.summary ?? '').trim() ||
      project.lines.some((l) => l.sceneId === scene.id && l.text.trim()) ||
      project.events.some((e) => e.sceneId === scene.id) ||
      project.connections.some((c) => c.kind === 'contains' && c.sourceId === scene.id);
    if (!written && !issues.some((i) => i.id === scene.id)) issues.push({ id: scene.id, message: 'Nothing written yet: give it a summary or a first line.' });
  }
  // Something used in a scene with nothing about it in the Bible (spec §25: missing canonical data).
  for (const object of Object.values(project.objects)) {
    if (!CANONICAL[object.type] || issues.some((i) => i.id === object.id)) continue;
    const scenes = project.connections.filter((c) => c.kind === 'contains' && c.targetId === object.id && project.objects[c.sourceId]);
    if (!scenes.length || hasCanonicalData(object)) continue;
    const where = project.objects[scenes[0]!.sourceId]!;
    issues.push({ id: object.id, message: `Used in ${where.data.code ?? where.name} but ${CANONICAL[object.type]} in the Bible.` });
  }
  // Timeline choices and branches (spec §25: branch that cannot resolve, choice with no valid outcome).
  for (const branch of project.branches) {
    if (branch.rejoinEventId && !project.events.some((e) => e.id === branch.rejoinEventId) && !project.lines.some((l) => `dlg_${l.id}` === branch.rejoinEventId)) {
      if (!issues.some((i) => i.id === branch.sceneId)) issues.push({ id: branch.sceneId, message: `The option “${branch.label}” reconnects to an event that is gone.` });
    }
  }
  for (const event of project.events) {
    if (event.kind !== 'choice' || !project.objects[event.sceneId]) continue;
    const others = project.branches.filter((b) => b.choiceEventId === event.id).length;
    if (!others && !issues.some((i) => i.id === event.sceneId)) {
      issues.push({ id: event.sceneId, message: `The choice ${event.refId ? `“${project.objects[event.refId]?.name ?? ''}” ` : ''}on its timeline has only one option.` });
    }
  }
  // A line nobody speaks (spec §25: dialogue speaker missing).
  for (const line of project.lines) {
    if (line.kind !== 'dialogue' || !project.objects[line.sceneId] || (line.speakerId && project.objects[line.speakerId])) continue;
    if (!issues.some((i) => i.id === line.sceneId)) issues.push({ id: line.sceneId, message: `Line ${line.order} has no speaker.` });
  }
  return issues;
};
