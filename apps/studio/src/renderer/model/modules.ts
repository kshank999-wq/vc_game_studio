import type { Project } from './types';
import { defenseIssues } from './defense/defense';
import { runDefense } from './defense/sim';
import { shooterIssues } from './shooter/shooter';

/**
 * Game modules: what kind of game a project is, which parts of the studio it
 * uses, and the set path to make one. Every path has the same shape, rough to
 * fine: say what the game is, rough in its main parts, play it, refine, hand
 * it off. A step ticks itself when the project shows it is done, or the
 * designer ticks it.
 */

export type ModuleId = 'story' | 'defense' | 'shooter';

/** Where a step takes the designer: a part of the studio, the setup questions, or a tab of a module's own workspace ('tab:<id>'). */
export type StepGo = 'setup' | 'graph' | 'characters' | 'level' | 'play' | 'engine' | 'bible' | `tab:${DefenseTab | ShooterTab}`;

export type DefenseTab = 'concept' | 'map' | 'towers' | 'enemies' | 'waves' | 'economy' | 'play';
export type ShooterTab = 'concept' | 'ship' | 'invaders' | 'waves' | 'shields' | 'play';

export interface PathStep {
  id: string;
  title: string;
  /** What to do, and what done looks like, in a line. */
  hint: string;
  go: StepGo;
  /** Done by what is in the project. Steps without one are ticked by hand. */
  done?: (p: Project) => boolean;
}

export interface GameModule {
  id: ModuleId;
  name: string;
  /** For the new-game chooser. */
  blurb: string;
  /** The parts of the studio it shows, in order. 'graph' is the module's home: the story graph, or its own workspace. */
  workspaces: string[];
  steps: PathStep[];
}

const count = (p: Project, type: string) => Object.values(p.objects).filter((o) => o.type === type).length;

const STORY: GameModule = {
  id: 'story',
  name: 'Story game',
  blurb: 'A narrative game for console or PC: a plot with choices and endings, characters, scenes, levels to walk through.',
  workspaces: ['graph', 'bible', 'notes', 'characters', 'puzzles', 'level', 'engine', 'play'],
  steps: [
    { id: 'setup', title: 'Concept', hint: 'Name it, say what kind of game it is, its premise and who the player is.', go: 'setup', done: (p) => !!p.setup?.premise?.trim() },
    { id: 'spine', title: 'Plot and endings', hint: 'Rough in the main plot points along the spine and how it can end. Three plot points and an ending will do for now.', go: 'graph', done: (p) => count(p, 'plotPoint') >= 3 && count(p, 'end') >= 1 },
    { id: 'characters', title: 'Main characters', hint: 'The player and the two or three people the story turns on. A name and a line each is enough.', go: 'characters', done: (p) => count(p, 'character') >= 2 },
    { id: 'scenes', title: 'Scenes and choices', hint: 'Drop a scene or two under each plot point and the big choices between them.', go: 'graph', done: (p) => count(p, 'scene') >= 3 },
    { id: 'levels', title: 'Levels', hint: 'Block out where it happens: a level with a few rooms, in the graybox.', go: 'level', done: (p) => (p.levels?.items.length ?? 0) > 0 },
    { id: 'play', title: 'Play it', hint: 'Play it through, start to end. Note what feels thin. Tick this when you have.', go: 'play' },
    { id: 'refine', title: 'Refine', hint: 'Now the detail: dialogue, puzzles, items, skills, the Bible. Everything is open. Tick this when it feels right.', go: 'bible' },
    { id: 'handoff', title: 'Hand off', hint: 'Send it to Godot, Unity or Unreal.', go: 'engine', done: (p) => !!p.handoff?.last },
  ],
};

const DEFENSE: GameModule = {
  id: 'defense',
  name: 'Castle defense',
  blurb: 'Hold the castle: enemies come down a path in waves, the player builds and upgrades towers beside it. Mobile, PC or console.',
  workspaces: ['graph', 'bible', 'notes', 'engine'],
  steps: [
    { id: 'concept', title: 'Concept', hint: 'What it is and where it plays: the premise, the theme, the platform.', go: 'tab:concept', done: (p) => !!p.defense?.concept.premise?.trim() },
    { id: 'map', title: 'Map and path', hint: 'Lay the path the enemies walk to the castle, and the spots towers can go.', go: 'tab:map', done: (p) => (p.defense?.map.path.length ?? 0) >= 2 && (p.defense?.map.spots.length ?? 0) >= 3 },
    { id: 'towers', title: 'Towers', hint: 'Two or three towers that do different jobs: fast, heavy, slowing, anti-air.', go: 'tab:towers', done: (p) => (p.defense?.towers.length ?? 0) >= 2 },
    { id: 'enemies', title: 'Enemies', hint: 'Two or three enemies that ask different things of the towers: many and weak, few and armored, flying.', go: 'tab:enemies', done: (p) => (p.defense?.enemies.length ?? 0) >= 2 },
    { id: 'waves', title: 'Waves', hint: 'Five waves or so, each a little harder, mixing the enemies.', go: 'tab:waves', done: (p) => (p.defense?.waves.length ?? 0) >= 3 },
    { id: 'economy', title: 'Gold and lives', hint: 'What the player starts with, and what selling gives back.', go: 'tab:economy', done: (p) => !!p.defense && !defenseIssues(p.defense).some((i) => i.severity === 'error') },
    { id: 'play', title: 'Play and balance', hint: 'Place towers and watch the waves. Ticks itself when the test layout wins.', go: 'tab:play', done: (p) => !!p.defense && runDefense(p.defense).outcome === 'won' },
    { id: 'handoff', title: 'Hand off', hint: 'Send it to Godot, Unity or Unreal as data the engine team builds on.', go: 'engine', done: (p) => !!p.handoff?.last },
  ],
};

const SHOOTER: GameModule = {
  id: 'shooter',
  name: 'Arcade shooter',
  blurb: 'Classic arcade invaders: rows of them sweep and step down, the player’s ship slides along the bottom and fires up. Mobile, PC or console.',
  workspaces: ['graph', 'bible', 'notes', 'engine'],
  steps: [
    { id: 'concept', title: 'Concept', hint: 'What it is and where it plays: the premise, the theme, the platform.', go: 'tab:concept', done: (p) => !!p.shooter?.concept.premise?.trim() },
    { id: 'ship', title: 'The ship', hint: 'How fast the ship moves and fires, and how many lives it has.', go: 'tab:ship', done: (p) => !!p.shooter && p.shooter.ship.speed > 0 && p.shooter.ship.fireRate > 0 && p.shooter.ship.lives > 0 },
    { id: 'invaders', title: 'Invaders', hint: 'Two or three invaders: weak and many, quick to fire, tough and worth more.', go: 'tab:invaders', done: (p) => (p.shooter?.invaders.length ?? 0) >= 2 },
    { id: 'waves', title: 'Waves', hint: 'Three or four formations, each a little bigger, faster or quicker to fire.', go: 'tab:waves', done: (p) => (p.shooter?.waves.length ?? 0) >= 3 },
    { id: 'shields', title: 'Shields and scoring', hint: 'The shields to hide behind, extra lives, how fast the formation speeds up.', go: 'tab:shields', done: (p) => !!p.shooter && !shooterIssues(p.shooter).some((i) => i.severity === 'error') },
    { id: 'play', title: 'Play and tune', hint: 'Play it yourself and watch the autopilot. Tick this when it feels right: hard by the end, never unfair.', go: 'tab:play' },
    { id: 'handoff', title: 'Hand off', hint: 'Send it to Godot, Unity or Unreal as data the engine team builds on.', go: 'engine', done: (p) => !!p.handoff?.last },
  ],
};

export const MODULES: readonly GameModule[] = [STORY, DEFENSE, SHOOTER];

export const moduleOf = (p: Project): GameModule => MODULES.find((m) => m.id === (p.module ?? 'story')) ?? STORY;

export interface StepState {
  step: PathStep;
  done: boolean;
  /** Ticked by hand, rather than seen in the project. */
  manual: boolean;
}

/** Where the project is on its path: each step and whether it is done. */
export const pathOf = (p: Project): StepState[] => {
  const ticked = new Set(p.path?.done ?? []);
  return moduleOf(p).steps.map((step) => {
    let auto = false;
    try {
      auto = step.done?.(p) ?? false;
    } catch {
      auto = false;
    }
    return { step, done: auto || ticked.has(step.id), manual: !auto && ticked.has(step.id) };
  });
};

/** The first step not done: where to go next. Null when the whole path is done. */
export const nextStep = (p: Project): PathStep | null => pathOf(p).find((s) => !s.done)?.step ?? null;

/** Tick a step done by hand, or untick it. */
export const tickStep = (p: Project, id: string, done: boolean): Project => {
  const now = new Set(p.path?.done ?? []);
  if (done) now.add(id);
  else now.delete(id);
  return { ...p, path: { ...p.path, done: [...now] } };
};
