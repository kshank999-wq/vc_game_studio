import { laneSequence, spineSequence } from './layout';
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
  return issues;
};
