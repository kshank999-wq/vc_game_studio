import type { Project } from '../types';
import { createGroup, groupsOf } from './groups';
import { characters, createCharacter, patchAI, patchRole } from './profile';

/**
 * The packaged working samples (Character Creator spec §8): a strolling
 * villager, a talking NPC, a patrol guard, a proximity-aggro orc, a
 * sight-aggro orc and a companion follower, each set up to work in the
 * graybox, plus two groups to put in a level: Village Market (twenty
 * villagers strolling and chatting) and Orc Patrol (six sword-carrying orc
 * sentries on a route named "Orc Route"). Adding them twice adds nothing.
 */

export const SAMPLE_NAMES = ['Strolling Villager', 'Market Gossip', 'Patrol Guard', 'Lurking Orc', 'Orc Sentry', 'Loyal Hound'] as const;

export const addSampleCast = (project: Project): { project: Project; added: string[] } => {
  let p = project;
  const added: string[] = [];
  const have = (name: string) => characters(p).find((c) => c.name === name)?.id;
  const make = (name: string, roles: Parameters<typeof createCharacter>[1]['roles'], archetype: string, then?: (id: string) => void): string => {
    const known = have(name);
    if (known) return known;
    const made = createCharacter(p, { name, roles, archetype });
    p = made.project;
    added.push(name);
    then?.(made.id);
    return made.id;
  };

  const villager = make('Strolling Villager', ['extra'], 'villager', (id) => {
    p = patchRole(p, id, 'extra', { loops: ['walk', 'idle', 'talk', 'flee'], wanderRadius: 6, fleeFrom: 'combat', bark: 'Fine day for it.' });
  });
  const gossip = make('Market Gossip', ['npc', 'extra'], 'villager', (id) => {
    p = patchRole(p, id, 'npc', { services: ['talk', 'info'], greeting: 'Heard the news?', topics: [{ id: 'topic_orcs', name: 'The orcs', knowledge: 'Orcs camp past the north gate and walk the road at dusk.', lines: [] }] });
    p = patchRole(p, id, 'extra', { loops: ['talk', 'idle'], wanderRadius: 2, fleeFrom: 'combat', bark: '' });
  });
  make('Patrol Guard', ['enemy'], 'guard', (id) => {
    // Watches its route: sees well, slow to give up.
    p = patchAI(p, id, { viewDistance: 14, visionAngle: 120, chaseTimeout: 6, disengageDistance: 30 });
  });
  make('Lurking Orc', ['enemy'], 'orc', (id) => {
    // Proximity aggro: half blind, but anything close sets it off.
    p = patchAI(p, id, { start: 'idle', viewDistance: 4, visionAngle: 90, proximityRadius: 5, hearingRadius: 8, disengageDistance: 15 });
  });
  const sentry = make('Orc Sentry', ['enemy'], 'orc', (id) => {
    // Sight aggro: a long, wide view.
    p = patchAI(p, id, { viewDistance: 18, visionAngle: 140, proximityRadius: 1.5, disengageDistance: 25 });
  });
  make('Loyal Hound', ['ally'], 'creature', (id) => {
    p = patchRole(p, id, 'ally', { followDistance: 2, support: 'defend', talksWhileFollowing: false });
  });

  const groupNames = new Set(groupsOf(p).map((g) => g.name));
  if (!groupNames.has('Village Market')) {
    const g = createGroup(p, 'Village Market', [
      { character: villager, min: 14, max: 14, weight: 2, activity: 'wander' },
      { character: gossip, min: 6, max: 6, weight: 1, activity: 'talk' },
    ]);
    p = { ...g.project, characterGroups: groupsOf(g.project).map((x) => (x.id === g.id ? { ...x, formation: 'cluster', spacing: 1.2, wanderRadius: 5, seed: 1207 } : x)) };
    added.push('Village Market');
  }
  if (!groupNames.has('Orc Patrol')) {
    const g = createGroup(p, 'Orc Patrol', [{ character: sentry, min: 6, max: 6, weight: 1, activity: 'patrol' }]);
    p = { ...g.project, characterGroups: groupsOf(g.project).map((x) => (x.id === g.id ? { ...x, formation: 'column', spacing: 1.6, route: 'Orc Route', faction: 'Orcs', seed: 6006 } : x)) };
    added.push('Orc Patrol');
  }
  return { project: p, added };
};
