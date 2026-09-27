import { laneSequence, spineSequence } from './layout';
import { setterNames } from './details';
import { brokenReferences } from './rules';
import type { Project } from './types';

/**
 * What needs a look (spec §25). Shown as a compact red "!" on the node until
 * the user asks for the detail; nothing here blocks editing.
 */
export interface Issue {
  id: string;
  message: string;
}

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
  // A line nobody speaks (spec §25: dialogue speaker missing).
  for (const line of project.lines) {
    if (line.kind !== 'dialogue' || !project.objects[line.sceneId] || (line.speakerId && project.objects[line.speakerId])) continue;
    if (!issues.some((i) => i.id === line.sceneId)) issues.push({ id: line.sceneId, message: `Line ${line.order} has no speaker.` });
  }
  return issues;
};
