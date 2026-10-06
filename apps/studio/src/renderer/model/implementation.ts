import { changedSinceExport } from './collab';
import type { Project } from './types';

/**
 * How far each story node is in the engine (spec §3, implementation status):
 * not sent yet, in the engine as it is now, or edited since it was sent.
 * Read from the last export's record and the edit history, so the graph can
 * show it without generating any engine code. Before the first export there
 * is nothing to say, and the graph shows no badges.
 */
export type ImplementationStatus = 'unbound' | 'implemented' | 'needsUpdate';

export const IMPLEMENTATION_LABEL: Record<ImplementationStatus, string> = {
  unbound: 'Not in the engine yet: export to send it',
  implemented: 'In the engine, as it is here',
  needsUpdate: 'Changed since the last export: export again to update the engine',
};

/** Every node's status, for the types the engine export makes something of. */
export const implementationStatuses = (project: Project): Map<string, ImplementationStatus> => {
  const out = new Map<string, ImplementationStatus>();
  const last = project.handoff?.last;
  if (!last) return out;
  const sent = new Set(Object.keys(last.fingerprints));
  // Only kinds of node the export writes something for (plot points, say, generate nothing of their own).
  const exportable = new Set([...sent].map((id) => project.objects[id]?.type).filter(Boolean));
  const since = Date.parse(last.at);
  const edited = new Set(changedSinceExport(project).filter((c) => c.target.kind === 'object').map((c) => c.target.id));
  for (const [id, object] of Object.entries(project.objects)) {
    if (!exportable.has(object.type) || !project.placements[id]) continue;
    if (!sent.has(id)) out.set(id, 'unbound');
    else if (edited.has(id) || Date.parse(object.modified) > since) out.set(id, 'needsUpdate');
    else out.set(id, 'implemented');
  }
  return out;
};
