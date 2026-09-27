import { describeEffect, describeRule, isEmpty } from './rules';
import { categoryCounts } from './scene';
import { cinematicTiming } from './shots';
import { sceneTimeline } from './timeline';
import type { Project } from './types';

/**
 * A scene card's quick preview on the story graph (spec §9: summary,
 * environment and key flags only): where it's set, what happens, what is in
 * it, what it changes and what it waits on.
 */
export interface ScenePreview {
  title: string;
  slug: string;
  summary: string;
  counts: string;
  /** What playing it changes: states set, items given or taken. */
  sets: string[];
  /** What parts of it wait on. */
  needs: string[];
  outcome?: 'ending' | 'gameOver';
}

const unique = (list: string[], max = 4) => {
  const out = [...new Set(list.filter(Boolean))];
  return out.length > max ? [...out.slice(0, max - 1), `and ${out.length - max + 1} more`] : out;
};

export const scenePreview = (project: Project, id: string): ScenePreview | null => {
  const scene = project.objects[id];
  if (!scene || scene.type !== 'scene') return null;
  const location = scene.data.locationId ? project.objects[scene.data.locationId as string]?.name : undefined;
  const counts = categoryCounts(project, id);
  const tracks = sceneTimeline(project, id);
  const events = tracks.flatMap((t) => t.events);
  const cinematic = events.filter((e) => e.kind === 'cinematic' && e.refId).reduce((t, e) => t + cinematicTiming(project, e.refId!, e).seconds, 0);
  const contained = project.connections.filter((c) => c.kind === 'contains' && c.sourceId === id).map((c) => project.objects[c.targetId]).filter((o) => !!o);
  const effects = [
    ...events.flatMap((e) => e.effects ?? []),
    ...tracks.flatMap((t) => t.branch?.effects ?? []),
    ...contained.flatMap((o) => (o.type === 'trigger' || o.type === 'puzzle' ? ((o.data.effects as never[] | undefined) ?? []) : [])),
  ];
  const rules = [
    ...events.filter((e) => !isEmpty(e.when)).map((e) => e.when),
    ...events.filter((e) => !isEmpty(e.ends)).map((e) => e.ends),
    ...tracks.filter((t) => !isEmpty(t.branch?.when)).map((t) => t.branch!.when),
    ...contained.filter((o) => o.type === 'choice' && !isEmpty(o.data.rule as never)).map((o) => o.data.rule as never),
  ];
  const parts = [
    counts.characters && `${counts.characters} character${counts.characters === 1 ? '' : 's'}`,
    counts.dialogue && `${counts.dialogue} line${counts.dialogue === 1 ? '' : 's'}`,
    counts.objects && `${counts.objects} object${counts.objects === 1 ? '' : 's'}`,
    events.length && `${events.length} timeline event${events.length === 1 ? '' : 's'}`,
    tracks.length > 1 && `${tracks.length - 1} branch${tracks.length === 2 ? '' : 'es'}`,
    cinematic && `${cinematic}s of cinematics`,
  ].filter(Boolean);
  return {
    title: `${scene.data.code ? `${scene.data.code} ` : ''}${scene.name}`,
    slug: `${scene.data.intExt ?? 'INT.'} ${(location ?? 'somewhere').toUpperCase()} — ${scene.data.time ?? 'DAY'}`,
    summary: String(scene.data.summary ?? ''),
    counts: parts.join(' · ') || 'Nothing in it yet',
    sets: unique(effects.map((e) => describeEffect(project, e))),
    needs: unique(rules.map((r) => describeRule(project, r))),
    ...(scene.data.outcome ? { outcome: scene.data.outcome } : {}),
  };
};
