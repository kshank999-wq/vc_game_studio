import { levelBands, levelOf } from './level-of';
import { levelsOf } from './level/level';
import { isEmpty, type Rule } from './rules';
import type { LevelBand, Project } from './types';

/**
 * Mission cards (adventure games): one short card per level of the Level
 * lane, saying what the level is for before it is built. The mission that
 * opens the next level (a quest), the puzzle in the way, who gives the clue
 * and what it is, what the player gains (items, powers), and where they can
 * be captured. Filled in, a card is the level's checklist: build what it
 * names and the level plays.
 */
export interface MissionCard {
  /** The quest that, done, opens the next level. */
  questId?: string;
  /** The puzzle in the way. */
  puzzleId?: string;
  /** Who gives the clue (a character), and the clue in a line. */
  clueFromId?: string;
  clue?: string;
  /** What the player gains in the level: items, and powers (skills). */
  gains?: string[];
  /** Where (or by whom) the player can be captured here, in a line; "none" when nowhere. */
  capture?: string;
  notes?: string;
  /** The player may go on to the next level without the mission done (by default the mission holds them in the level). */
  open?: boolean;
}

export type MissionSlot = 'mission' | 'puzzle' | 'clue' | 'gains' | 'capture' | 'map';

export const MISSION_SLOTS: { slot: MissionSlot; label: string; hint: string }[] = [
  { slot: 'mission', label: 'Mission', hint: 'The quest that, done, opens the next level.' },
  { slot: 'puzzle', label: 'Puzzle', hint: 'The puzzle in the way.' },
  { slot: 'clue', label: 'Clue', hint: 'Who gives the clue, and what it is.' },
  { slot: 'gains', label: 'Gains', hint: 'What the player gains here: an item, a power.' },
  { slot: 'capture', label: 'Capture', hint: 'Where (or by whom) the player can be captured here, or “none”.' },
  { slot: 'map', label: 'Map', hint: 'The level’s map, with something built in it.' },
];

export const missionOf = (band: LevelBand): MissionCard => band.mission ?? {};

/**
 * Whether going from one node to another leaves a level whose mission holds
 * the player in it: the level's card has a mission (a quest), not marked
 * open, and the other node is in another level. Until the quest is done, the
 * way out is shut: the player goes back to the start of the level instead
 * (an option that would leave shows what it needs). Endings, and the holding
 * cell either way, are never held back.
 */
export const missionHolding = (project: Project, fromId: string, toId: string): { band: LevelBand; questId: string } | null => {
  if (fromId === toId) return null;
  const cell = project.capture?.cellId;
  if (cell && (fromId === cell || toId === cell)) return null;
  const from = levelOf(project, fromId);
  const card = from?.mission;
  if (!from || !card?.questId || card.open || project.objects[card.questId]?.type !== 'quest') return null;
  const to = levelOf(project, toId);
  return to && to.id !== from.id ? { band: from, questId: card.questId } : null;
};

/** Change a level's card. */
export const setMission = (project: Project, bandId: string, patch: Partial<MissionCard>): Project => ({
  ...project,
  lanes: project.lanes.map((l) =>
    l.kind !== 'level'
      ? l
      : {
          ...l,
          levels: (l.levels ?? []).map((b) => {
            if (b.id !== bandId) return b;
            const card: MissionCard = { ...b.mission, ...patch };
            for (const k of Object.keys(card) as (keyof MissionCard)[]) if (card[k] === undefined || card[k] === '' || (Array.isArray(card[k]) && !(card[k] as unknown[]).length)) delete card[k];
            return { ...b, mission: card };
          }),
        },
  ),
});

const is = (project: Project, id: string | undefined, ...types: string[]) => !!id && types.includes(project.objects[id]?.type ?? '');

/** Whether the level's map has anything built in it. */
const built = (project: Project, band: LevelBand) => !!band.mapId && levelsOf(project).items.some((i) => i.levelId === band.mapId);

/** What a card still needs, slot by slot (empty when it is complete). */
export const missionGaps = (project: Project, band: LevelBand): MissionSlot[] => {
  const c = missionOf(band);
  const out: MissionSlot[] = [];
  if (!is(project, c.questId, 'quest')) out.push('mission');
  if (!is(project, c.puzzleId, 'puzzle')) out.push('puzzle');
  if (!is(project, c.clueFromId, 'character') || !c.clue?.trim()) out.push('clue');
  if (!(c.gains ?? []).some((g) => is(project, g, 'inventory', 'skill'))) out.push('gains');
  if (!c.capture?.trim()) out.push('capture');
  if (!built(project, band)) out.push('map');
  return out;
};

/** Warnings beyond the gaps: a mission nothing can finish. */
export const missionWarnings = (project: Project, band: LevelBand): string[] => {
  const c = missionOf(band);
  const out: string[] = [];
  const quest = c.questId ? project.objects[c.questId] : undefined;
  if (quest?.type === 'quest') {
    const completes = !isEmpty(quest.data.rule as Rule | undefined) || JSON.stringify([project.events, project.branches, project.connections, project.levels, Object.values(project.objects).map((o) => o.data)]).includes(`"completeQuest","ref":"${quest.id}"`);
    if (!completes) out.push(`Nothing completes “${quest.name}” yet: give it a rule that completes it, or a Complete quest effect in the level.${c.open ? '' : ' Until then the player can never leave this level.'}`);
  }
  return out;
};

/** The levels in order, each with its card's gaps. */
export const missionBoard = (project: Project) =>
  levelBands(project).map((band) => ({ band, card: missionOf(band), gaps: missionGaps(project, band), warnings: missionWarnings(project, band) }));
