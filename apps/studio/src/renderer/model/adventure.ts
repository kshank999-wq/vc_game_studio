import { captureIssues, captureOn, setUpCapture } from './capture';
import { addLevelBand, levelBands } from './level-lane';
import { missionGaps } from './missions';
import { makeObject, nextCode } from './project';
import { containerName, createFromSetup, type GameSetup } from './setup';
import type { Project, StoryObject } from './types';

/**
 * Adventure story (game modules): a story game for one hero, played in first
 * or third person, level by level. Each level has a mission that opens the
 * next, a puzzle in the way, someone who gives the clue, something gained;
 * the hero has items, powers and health, and can be captured and escape. The
 * story comes first, all of it, with every ending known.
 */

/** Where the wizard starts an adventure: missions, several endings, keys and quest items (health and powers are made their own way). */
export const ADVENTURE_SETUP: Pick<GameSetup, 'kind' | 'progression' | 'units' | 'resources' | 'endings'> = { kind: 'action', progression: 'missions', units: 4, resources: ['Keys', 'Quest items', 'Powers'], endings: 'multiple' };

/**
 * A new adventure from the wizard: the story as a story game makes it (its
 * missions along the spine, its endings waiting), a level for each mission
 * on the Level lane (each with a mission card to fill in), capture set up
 * (a holding cell, a locker, Times captured and Health), and the first power
 * as a skill when the game has powers.
 */
export const createAdventureFromSetup = (name: string, answers: GameSetup, now = new Date().toISOString()): Project => {
  const powers = answers.resources.includes('Powers');
  let p: Project = { ...createFromSetup(name, { ...answers, resources: answers.resources.filter((r) => r !== 'Powers' && r !== 'Health') }, now), module: 'adventure' };
  const units = Math.min(12, Math.max(2, Math.round(answers.units) || 3));
  for (let i = 0; i < units; i++) {
    const made = addLevelBand(p, containerName(p.setup ?? answers, i).replace(/^Mission/, 'Level'));
    if (!made) break;
    p = made.project;
  }
  p = setUpCapture(p, now);
  if (powers) {
    const power = makeObject('skill', 'First power', now, { code: nextCode(p, { prefix: 'SK-', pad: 2 }), summary: 'A power the hero gains. Say what it does, and where it is gained.' });
    p = { ...p, objects: { ...p.objects, [power.id]: power } };
  }
  return p;
};

const all = (p: Project, ...types: string[]) => Object.values(p.objects).filter((o) => types.includes(o.type));

/** The story's endings: the Ending nodes, and branches marked an ending. */
export const endingsOf = (p: Project): StoryObject[] => Object.values(p.objects).filter((o) => o.type === 'end' || o.data.outcome === 'ending');

/** How the play-through names an ending when it gets there. */
export const endingText = (o: StoryObject): string => (o.type === 'end' ? o.name || 'The End' : `An ending: ${o.name}`);

/**
 * Whether every ending is known: two or more, each with a way in (on the
 * spine, or a route to it), and each but at most one reached only when
 * something holds (a condition says what earns it).
 */
export const endingsKnown = (p: Project): boolean => {
  const endings = endingsOf(p);
  if (endings.length < 2) return false;
  let open = 0;
  for (const e of endings) {
    const into = p.connections.filter((c) => c.kind === 'branch' && c.targetId === e.id);
    const onSpine = !!p.placements[e.id]?.laneId;
    if (!into.length && !onSpine) return false;
    if (!into.some((c) => c.conditions && c.conditions.items.length)) open++;
  }
  return open <= 1;
};

/** Whether the saved expected paths reach every ending, and (with capture) one goes through the holding cell. */
export const endingsPlayed = (p: Project): boolean => {
  const paths = p.paths ?? [];
  const endings = endingsOf(p);
  if (!endings.length || !endings.every((e) => paths.some((path) => path.ending?.text === endingText(e) || path.through.includes(e.id)))) return false;
  return !captureOn(p) || paths.some((path) => path.through.includes(p.capture!.cellId!));
};

/** The adventure path's checks, by step. */
export const adventureDone = {
  story: (p: Project) => all(p, 'plotPoint').length >= 3 && endingsKnown(p),
  levels: (p: Project) => levelBands(p).length >= 2 && levelBands(p).every((b) => !!b.mission?.questId && !!p.objects[b.mission.questId]),
  characters: (p: Project) => all(p, 'character').length >= 3,
  systems: (p: Project) => all(p, 'inventory').length >= 1 && all(p, 'skill').length >= 1 && captureOn(p) && !captureIssues(p).length,
  first: (p: Project) => {
    const first = levelBands(p)[0];
    return !!first && !missionGaps(p, first).length;
  },
  paths: endingsPlayed,
  every: (p: Project) => levelBands(p).length >= 1 && levelBands(p).every((b) => !missionGaps(p, b).length),
};
