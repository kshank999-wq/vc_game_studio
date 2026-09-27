import { interactionsOf } from './details';
import { spanDependents } from './project';
import { conditionsIn, everyRule } from './rules';
import { inScene } from './scene';
import type { Project } from './types';

/**
 * What deleting something takes with it or leaves pointing at nothing, in
 * words, so the studio can say so before it happens (spec §25: no silent
 * breakage). Empty means nothing else depends on it.
 */

const code = (project: Project, id: string) => {
  const o = project.objects[id];
  return o ? `${o.data.code ? `${o.data.code} ` : ''}${o.name}` : '?';
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const list = (names: string[], max = 3) =>
  names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;

/** Rules and effects anywhere that name this element (they would be left broken). */
const rulesNaming = (project: Project, id: string, except?: string): string[] => {
  const where = new Set<string>();
  for (const { rule, effects, where: w, owner } of everyRule(project)) {
    if (owner === except) continue;
    if (conditionsIn(rule).some((c) => c.ref === id) || (effects ?? []).some((e) => e.ref === id)) where.add(w);
  }
  // The older, one-field links: an interaction that sets a state or fires a trigger, a trigger that sets a state.
  for (const o of Object.values(project.objects)) {
    if (o.id === id || o.id === except) continue;
    if (o.data.setsFlag === id) where.add(o.name);
    for (const i of interactionsOf(o)) if (i.setsFlag === id || i.fires === id) where.add(`${o.name} · ${i.verb}`);
  }
  return [...where];
};

export const deletionImpact = (project: Project, id: string): string[] => {
  const object = project.objects[id];
  if (!object) return [];
  const out: string[] = [];

  const scenes = project.connections.filter((c) => c.kind === 'contains' && c.targetId === id && project.objects[c.sourceId]).map((c) => code(project, c.sourceId));
  if (scenes.length) out.push(`It is used in ${plural(scenes.length, 'scene')}: ${list(scenes)}.`);

  const spoken = project.lines.filter((l) => l.speakerId === id);
  if (spoken.length) out.push(`${plural(spoken.length, 'line')} spoken by ${object.name} keep their words and lose their speaker.`);

  const lane = project.lanes.find((l) => l.characterId === id);
  if (lane) out.push(`The arc lane “${lane.name}” stays, no longer tied to a character.`);

  const locations = Object.values(project.objects).filter((o) => o.type === 'scene' && o.data.locationId === id);
  if (locations.length) out.push(`${list(locations.map((s) => code(project, s.id)))} ${locations.length === 1 ? 'is' : 'are'} set here and will have no location.`);

  const events = project.events.filter((e) => e.refId === id && e.sceneId !== id);
  if (events.length) out.push(`${plural(events.length, 'timeline event')} for it ${events.length === 1 ? 'goes' : 'go'}.`);

  if (object.type === 'scene') {
    const lines = project.lines.filter((l) => l.sceneId === id).length;
    const timeline = project.events.filter((e) => e.sceneId === id).length;
    if (lines || timeline) out.push(`Its script${lines ? ` (${plural(lines, 'line')})` : ''} and timeline${timeline ? ` (${plural(timeline, 'event')})` : ''} go with it.`);
    const onlyHere = project.connections.filter(
      (c) =>
        c.kind === 'contains' &&
        c.sourceId === id &&
        project.objects[c.targetId]?.type !== 'character' &&
        !project.connections.some((d) => d.kind === 'contains' && d.targetId === c.targetId && d.sourceId !== id),
    ).length;
    if (onlyHere) out.push(`${plural(onlyHere, 'element')} only this scene used ${onlyHere === 1 ? 'stays' : 'stay'} in the Bible.`);
  }

  const links = project.connections.filter((c) => (c.sourceId === id || c.targetId === id) && (c.kind === 'branch' || c.kind === 'arcEvent' || c.kind === 'laneTie')).length;
  if (links) out.push(`${plural(links, 'connection')} on the story graph ${links === 1 ? 'goes' : 'go'}.`);

  const spans = spanDependents(project, id);
  if (spans.length) out.push(`${list(spans.map((l) => `“${l.name}”`))} will branch off or rejoin at the neighbouring spine node.`);

  const rules = rulesNaming(project, id);
  if (rules.length) out.push(`${plural(rules.length, 'condition or effect', 'conditions or effects')} will point at nothing: ${list(rules)}.`);

  return out;
};

/**
 * Taking an element out of one scene: nothing to say unless it goes from the
 * project too (it was only used here), or a character's lines here lose
 * their speaker.
 */
export const removalImpact = (project: Project, sceneId: string, id: string): { deletes: boolean; impact: string[] } => {
  const object = project.objects[id];
  if (!object || !inScene(project, sceneId, id)) return { deletes: false, impact: [] };
  const elsewhere = project.connections.some((c) => c.kind === 'contains' && c.targetId === id && c.sourceId !== sceneId);
  const canonical = object.type === 'character' || project.lanes.some((l) => l.characterId === id);
  if (!elsewhere && !canonical) {
    const inThisScene = code(project, sceneId);
    return { deletes: true, impact: deletionImpact(project, id).filter((line) => !line.startsWith('It is used in 1 scene: ' + inThisScene)) };
  }
  const here = project.lines.filter((l) => l.sceneId === sceneId && l.speakerId === id).length;
  return { deletes: false, impact: here ? [`${plural(here, 'line')} ${object.name} speaks in this scene lose their speaker.`] : [] };
};
