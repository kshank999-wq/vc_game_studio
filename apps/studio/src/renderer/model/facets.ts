import { describeInteraction, interactionsOf, sceneUse, setterNames, statesOf } from './details';
import { conditionsIn, describeEffects, describeRule, everyRule, isEmpty, type Effect, type Rule } from './rules';
import { sceneLines } from './scene';
import { describeShot, runningTime, shotsOf } from './shots';
import { sceneTimeline } from './timeline';
import type { ObjectType, Project, StoryObject } from './types';

/**
 * The second level of the mind map (spec §11): what one element exposes when
 * opened in its scene. Characters show their lines here and what they do;
 * objects their states and interactions; choices their options and where
 * they lead; logic its rules. Each facet is a line of words, not a copy.
 */
export interface Facet {
  label: string;
  detail?: string;
  symbol?: ObjectType;
}

const MAX = 6;
const cap = (list: Facet[]): Facet[] => (list.length > MAX ? [...list.slice(0, MAX - 1), { label: `+ ${list.length - MAX + 1} more`, detail: 'in the detail panel' }] : list);

const naming = (project: Project, id: string) =>
  everyRule(project).filter(({ rule, effects }) => conditionsIn(rule).some((c) => c.ref === id) || (effects ?? []).some((e) => e.ref === id));

export const facetsOf = (project: Project, sceneId: string, object: StoryObject): Facet[] => {
  const use = sceneUse(project, sceneId, object.id);
  const useFacets = Object.entries(use)
    .filter(([, v]) => v)
    .map(([k, v]): Facet => ({ label: k[0]!.toUpperCase() + k.slice(1), detail: v }));
  const rule = object.data.rule as Rule | undefined;
  const effects = object.data.effects as Effect[] | undefined;
  switch (object.type) {
    case 'character': {
      const lines = sceneLines(project, sceneId).filter((l) => l.speakerId === object.id);
      return cap([
        ...useFacets,
        ...lines.map((l): Facet => ({ label: `“${l.text || '…'}”`, detail: l.direction || undefined, symbol: 'dialogue' })),
        ...(lines.length ? [] : [{ label: 'No lines here' }]),
      ]);
    }
    case 'object':
      return cap([
        ...(statesOf(object).length ? [{ label: 'States', detail: statesOf(object).join(' → ') }] : []),
        ...interactionsOf(object).map((i): Facet => ({ label: i.verb || 'Use', detail: describeInteraction(project, i).replace(/^[^·]*· ?/, '') || undefined })),
        ...useFacets,
      ]);
    case 'inventory': {
      const moves = naming(project, object.id)
        .flatMap(({ effects: list, where }) => (list ?? []).filter((e) => e.ref === object.id).map((e): Facet => ({ label: e.kind === 'give' ? 'Given' : e.kind === 'take' ? 'Taken' : 'Changed', detail: where })));
      const needed = naming(project, object.id).filter(({ rule: r }) => conditionsIn(r).some((c) => c.ref === object.id)).map(({ where }): Facet => ({ label: 'Needed by', detail: where }));
      return cap([...(object.data.use ? [{ label: 'Use', detail: String(object.data.use) }] : []), ...moves, ...needed, ...useFacets]);
    }
    case 'choice': {
      const event = project.events.find((e) => e.sceneId === sceneId && e.kind === 'choice' && e.refId === object.id);
      const out: Facet[] = [];
      if (!isEmpty(rule)) out.push({ label: 'Available when', detail: describeRule(project, rule) });
      if (event) {
        const main = sceneTimeline(project, sceneId)[0]!.events;
        out.push({ label: event.mainLabel || 'Carry on', detail: event.effects?.length ? `carries on · ${describeEffects(project, event.effects)}` : 'carries on', symbol: 'choice' });
        for (const b of project.branches.filter((x) => x.choiceEventId === event.id)) {
          const rejoin = b.rejoinEventId ? main.find((e) => e.id === b.rejoinEventId) : undefined;
          out.push({ label: b.label, detail: rejoin ? `back to ${rejoin.label || rejoin.kind}` : 'leaves the scene', symbol: 'choice' });
        }
      }
      for (const c of project.connections.filter((x) => x.kind === 'branch' && x.sourceId === object.id)) {
        out.push({ label: c.label || 'Route', detail: `to ${project.objects[c.targetId]?.name ?? '?'}`, symbol: 'scene' });
      }
      return cap(out.length ? out : [{ label: 'No options yet' }]);
    }
    case 'puzzle':
      return cap([
        ...(object.data.solution ? [{ label: 'Solution', detail: String(object.data.solution) }] : []),
        ...(!isEmpty(rule) ? [{ label: 'Solved when', detail: describeRule(project, rule) }] : []),
        ...(effects?.length ? [{ label: 'When solved', detail: describeEffects(project, effects) }] : []),
        ...(object.data.failState ? [{ label: 'Fail state', detail: String(object.data.failState) }] : []),
      ]);
    case 'trigger':
      return cap([
        { label: 'Fires when', detail: !isEmpty(rule) ? describeRule(project, rule) : String(object.data.when ?? 'not set') },
        ...(effects?.length ? [{ label: 'Then', detail: describeEffects(project, effects) }] : object.data.does ? [{ label: 'Does', detail: String(object.data.does) }] : []),
      ]);
    case 'gate':
      return cap([{ label: 'Opens when', detail: !isEmpty(rule) ? describeRule(project, rule) : String(object.data.needs ?? 'not set') }, ...(object.data.holds ? [{ label: 'Holds back', detail: String(object.data.holds) }] : [])]);
    case 'state': {
      const readers = naming(project, object.id).filter(({ rule: r }) => conditionsIn(r).some((c) => c.ref === object.id));
      return cap([
        { label: 'Values', detail: statesOf(object).join(' / ') },
        ...setterNames(project, object.id).map((n): Facet => ({ label: 'Set by', detail: n })),
        ...readers.map(({ where }): Facet => ({ label: 'Read by', detail: where })),
      ]);
    }
    case 'cinematic': {
      const shots = shotsOf(object);
      return cap([
        ...(shots.length ? [{ label: `${shots.length} shots · ${runningTime(shots)}s` }] : []),
        ...shots.map((s, i): Facet => ({ label: `${i + 1}. ${s.framing}`, detail: describeShot(project, s).split(' — ').slice(1).join(' — ') || undefined, symbol: 'cinematic' })),
        ...(object.data.camera && !shots.length ? [{ label: 'Camera', detail: String(object.data.camera) }] : []),
      ]);
    }
    case 'environment':
      return cap(
        (['appearance', 'lighting', 'ambience', 'traversal'] as const)
          .filter((k) => object.data[k])
          .map((k): Facet => ({ label: k[0]!.toUpperCase() + k.slice(1), detail: String(object.data[k]) }))
          .concat(useFacets),
      );
    default:
      return cap(useFacets);
  }
};
