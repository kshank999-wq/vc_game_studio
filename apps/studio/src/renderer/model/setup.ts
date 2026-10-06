import { createProject, makeObject, nextCode, placeNew, renameObject } from './project';

const stamp = (): string => new Date().toISOString();
import { spineLane, spineSequence } from './layout';
import type { ObjectType, Project } from './types';

/**
 * The Game Setup Wizard's answers (Writer spec §3): what kind of game, its
 * premise and player, world, tone and themes, how it ends, its main loop, how
 * it is divided, and the resources it keeps coming back to. Kept with the
 * project, shown in the Bible's overview, and editable later from Project ›
 * Game setup. None of it is required; a blank answer is just left out.
 */
export interface GameSetup {
  kind: GameKind;
  /** When the kind is 'custom': the designer's own word for it. */
  customKind?: string;
  premise?: string;
  playerFantasy?: string;
  /** Who the player is in the story. */
  protagonist?: string;
  world?: string;
  tone?: string;
  themes?: string[];
  endings?: EndingStructure;
  /** The main gameplay and narrative loop, in a sentence. */
  loop?: string;
  progression: Progression;
  /** When progression is 'custom': what one container is called ("Day", "Heist"). */
  customUnit?: string;
  /** How many containers the spine starts with (2–12). */
  units: number;
  resources: string[];
}

export type GameKind = 'linear' | 'branching' | 'rpg' | 'action' | 'shooter' | 'puzzle' | 'survival' | 'hybrid' | 'custom';
export type EndingStructure = 'single' | 'multiple' | 'branching' | 'open';
export type Progression = 'acts' | 'chapters' | 'levels' | 'missions' | 'quests' | 'regions' | 'custom';

export const GAME_KINDS: { value: GameKind; label: string }[] = [
  { value: 'linear', label: 'Linear story' },
  { value: 'branching', label: 'Branching narrative' },
  { value: 'rpg', label: 'RPG' },
  { value: 'action', label: 'Action / adventure' },
  { value: 'shooter', label: 'First-person shooter' },
  { value: 'puzzle', label: 'Puzzle' },
  { value: 'survival', label: 'Survival' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'custom', label: 'Something else…' },
];

export const ENDINGS: { value: EndingStructure; label: string }[] = [
  { value: 'single', label: 'One ending' },
  { value: 'multiple', label: 'Several endings' },
  { value: 'branching', label: 'Endings that branch from choices' },
  { value: 'open', label: 'Open-ended' },
];

export const PROGRESSIONS: { value: Progression; label: string; unit: string }[] = [
  { value: 'acts', label: 'Acts', unit: 'Act' },
  { value: 'chapters', label: 'Chapters', unit: 'Chapter' },
  { value: 'levels', label: 'Levels', unit: 'Level' },
  { value: 'missions', label: 'Missions', unit: 'Mission' },
  { value: 'quests', label: 'Quests', unit: 'Quest' },
  { value: 'regions', label: 'Open-world regions', unit: 'Region' },
  { value: 'custom', label: 'Something else…', unit: 'Part' },
];

/** Resources many games keep coming back to; the wizard offers them as ticks. */
export const COMMON_RESOURCES = ['Health', 'Ammunition', 'Currency', 'Keys', 'Quest items', 'Crafting materials', 'Collectibles', 'Powers'] as const;

/** A sensible start for each kind of game: how it divides and what it keeps track of. */
export const defaultsFor = (kind: GameKind): Pick<GameSetup, 'progression' | 'units' | 'resources' | 'endings'> => {
  switch (kind) {
    case 'rpg':
      return { progression: 'quests', units: 5, resources: ['Health', 'Currency', 'Quest items', 'Crafting materials'], endings: 'multiple' };
    case 'shooter':
      return { progression: 'missions', units: 6, resources: ['Health', 'Ammunition'], endings: 'single' };
    case 'action':
      return { progression: 'levels', units: 5, resources: ['Health', 'Keys', 'Collectibles'], endings: 'single' };
    case 'puzzle':
      return { progression: 'chapters', units: 4, resources: ['Keys', 'Collectibles'], endings: 'single' };
    case 'survival':
      return { progression: 'regions', units: 4, resources: ['Health', 'Crafting materials', 'Ammunition'], endings: 'open' };
    case 'branching':
      return { progression: 'chapters', units: 4, resources: [], endings: 'branching' };
    default:
      return { progression: 'acts', units: 3, resources: [], endings: 'single' };
  }
};

export const blankSetup = (kind: GameKind = 'linear'): GameSetup => ({ kind, ...defaultsFor(kind) });

export const unitName = (setup: Pick<GameSetup, 'progression' | 'customUnit'>): string =>
  setup.progression === 'custom' ? setup.customUnit?.trim() || 'Part' : PROGRESSIONS.find((p) => p.value === setup.progression)!.unit;

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** What one container on the spine is called: "Act I", "Chapter 2". */
export const containerName = (setup: GameSetup, index: number): string =>
  `${unitName(setup)} ${setup.progression === 'acts' ? ROMAN[index] ?? index + 1 : index + 1}`;

const clean = (setup: GameSetup): GameSetup => {
  const text = (s?: string) => s?.trim() || undefined;
  const out: GameSetup = {
    kind: setup.kind,
    progression: setup.progression,
    units: Math.min(12, Math.max(2, Math.round(setup.units) || 3)),
    resources: [...new Set(setup.resources.map((r) => r.trim()).filter(Boolean))],
  };
  const optional = { customKind: text(setup.customKind), premise: text(setup.premise), playerFantasy: text(setup.playerFantasy), protagonist: text(setup.protagonist), world: text(setup.world), tone: text(setup.tone), loop: text(setup.loop), customUnit: text(setup.customUnit) };
  for (const [k, v] of Object.entries(optional)) if (v) (out as unknown as Record<string, unknown>)[k] = v;
  const themes = (setup.themes ?? []).map((t) => t.trim()).filter(Boolean);
  if (themes.length) out.themes = themes;
  if (setup.endings) out.endings = setup.endings;
  return out;
};

/**
 * A new project from the wizard: the spine divided into the chosen
 * containers (Beginning, one plot point per act or chapter, Ending), the
 * premise written into the Beginning, and each recurring resource in the
 * Bible as an inventory entry to fill in.
 */
export const createFromSetup = (name: string, answers: GameSetup, now = stamp()): Project => {
  const setup = clean(answers);
  let p: Project = { ...createProject(name.trim() || 'Untitled Game', now), setup };
  const spine = spineLane(p).id;
  const [beginId, firstPoint] = spineSequence(p);
  p = renameObject(p, firstPoint!, containerName(setup, 0));
  for (let i = 1; i < setup.units; i++) {
    const sequence = spineSequence(p);
    const before = p.placements[sequence[sequence.length - 2]!]!.x;
    const placed = placeNew(p, 'plotPoint', spine, before + 300, 0, now);
    if (!placed) break;
    p = renameObject(placed.project, placed.id, containerName(setup, i));
  }
  if (setup.premise && beginId) {
    const begin = p.objects[beginId]!;
    p = { ...p, objects: { ...p.objects, [beginId]: { ...begin, data: { ...begin.data, summary: setup.premise } } } };
  }
  for (const resource of setup.resources) {
    const type: ObjectType = 'inventory';
    const item = makeObject(type, resource, now, { code: nextCode(p, { prefix: 'ITM-', pad: 2 }) });
    p = { ...p, objects: { ...p.objects, [item.id]: item } };
  }
  return p;
};

/** Change the answers on an open project. Nothing already made from them is touched. */
export const updateSetup = (project: Project, answers: GameSetup): Project => ({ ...project, setup: clean(answers) });

/** The answers as short lines, for the Bible's overview and reports. */
export const setupSummary = (setup: GameSetup): { label: string; value: string }[] => {
  const kind = setup.kind === 'custom' ? setup.customKind || 'Custom' : GAME_KINDS.find((k) => k.value === setup.kind)!.label;
  const rows: { label: string; value: string | undefined }[] = [
    { label: 'Kind of game', value: kind },
    { label: 'Premise', value: setup.premise },
    { label: 'Player fantasy', value: setup.playerFantasy },
    { label: 'The player is', value: setup.protagonist },
    { label: 'World', value: setup.world },
    { label: 'Tone', value: setup.tone },
    { label: 'Themes', value: setup.themes?.join(', ') },
    { label: 'Endings', value: setup.endings && ENDINGS.find((e) => e.value === setup.endings)!.label },
    { label: 'Core loop', value: setup.loop },
    { label: 'Divided into', value: `${setup.units} ${unitName(setup).toLowerCase()}${setup.units === 1 ? '' : 's'}` },
    { label: 'Recurring resources', value: setup.resources.join(', ') || undefined },
  ];
  return rows.filter((r): r is { label: string; value: string } => Boolean(r.value));
};
