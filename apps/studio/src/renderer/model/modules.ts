import type { Project } from './types';
import { defenseIssues } from './defense/defense';
import { runDefense } from './defense/sim';
import { shooterIssues } from './shooter/shooter';
import { arenaIssues } from './arena/arena';
import { cardIssues } from './cards/cards';
import { levelIssues, parseLevel } from './blocks/blocks';
import { solveLevel } from './blocks/solver';
import { levelIssues as matchLevelIssues } from './match/match';
import { speedRange } from './runner/runner';
import { passable } from './runner/sim';
import { platformIssues } from './platformer/platformer';
import { mapLevel } from './platformer/sim';

/**
 * Game modules: what kind of game a project is, which parts of the studio it
 * uses, and the set path to make one. Every path has the same shape, rough to
 * fine: say what the game is, rough in its main parts, play it, refine, hand
 * it off. A step ticks itself when the project shows it is done, or the
 * designer ticks it.
 */

export type ModuleId = 'story' | 'defense' | 'shooter' | 'arena' | 'cards' | 'blocks' | 'match' | 'runner' | 'platformer';

/** Where a step takes the designer: a part of the studio, the setup questions, or a tab of a module's own workspace ('tab:<id>'). */
export type StepGo = 'setup' | 'graph' | 'characters' | 'level' | 'play' | 'engine' | 'bible' | `tab:${DefenseTab | ShooterTab | ArenaTab | CardTab | BlockTab | MatchTab | RunnerTab | PlatformTab}`;

export type DefenseTab = 'concept' | 'map' | 'towers' | 'enemies' | 'waves' | 'economy' | 'play';
export type ShooterTab = 'concept' | 'ship' | 'invaders' | 'waves' | 'shields' | 'play';
export type ArenaTab = 'concept' | 'field' | 'units' | 'match' | 'decks' | 'play';
export type CardTab = 'concept' | 'rules' | 'cards' | 'decks' | 'play';
export type BlockTab = 'concept' | 'rules' | 'levels' | 'order' | 'play';
export type MatchTab = 'concept' | 'rules' | 'levels' | 'balance' | 'play';
export type RunnerTab = 'concept' | 'runner' | 'chunks' | 'mix' | 'play';
export type PlatformTab = 'concept' | 'hero' | 'levels' | 'flow' | 'play';

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

const ARENA: GameModule = {
  id: 'arena',
  name: 'Head-to-head arena',
  blurb: 'Two sides on one field: each spends energy to send units down the lanes and knock down the other’s towers. The studio plays the opponent. Mobile, PC or console.',
  workspaces: ['graph', 'bible', 'notes', 'engine'],
  steps: [
    { id: 'concept', title: 'Concept', hint: 'What it is and where it plays: the premise, the theme, the platform.', go: 'tab:concept', done: (p) => !!p.arena?.concept.premise?.trim() },
    { id: 'field', title: 'Field and towers', hint: 'How many lanes, and how tough the keep and guard towers are.', go: 'tab:field', done: (p) => !!p.arena && p.arena.keep.health > 0 && p.arena.guard.health > 0 },
    { id: 'units', title: 'Units', hint: 'Four or five units that beat each other in a circle: tanky, ranged, swarm, splash, flying.', go: 'tab:units', done: (p) => (p.arena?.units.length ?? 0) >= 3 },
    { id: 'match', title: 'Energy and time', hint: 'How fast energy builds, how much a player can hold, how long a match runs.', go: 'tab:match', done: (p) => !!p.arena && p.arena.match.energyRate > 0 && p.arena.match.length > 0 },
    { id: 'decks', title: 'Decks', hint: 'The cards the player brings, and the opponent’s.', go: 'tab:decks', done: (p) => !!p.arena && !arenaIssues(p.arena).some((i) => i.severity === 'error') },
    { id: 'play', title: 'Play and balance', hint: 'Play the studio’s opponent and read the matchups. Tick this when no unit wins everything.', go: 'tab:play' },
    { id: 'handoff', title: 'Hand off', hint: 'Send it to Godot, Unity or Unreal as data the engine team builds on.', go: 'engine', done: (p) => !!p.handoff?.last },
  ],
};

const CARDS: GameModule = {
  id: 'cards',
  name: 'Card game',
  blurb: 'A one-on-one card duel: two heroes, a deck each, mana that grows every turn, minions on the board and spells. The studio plays the opponent. Mobile, PC or console.',
  workspaces: ['graph', 'bible', 'notes', 'engine'],
  steps: [
    { id: 'concept', title: 'Concept', hint: 'What it is and where it plays: the premise, the theme, the platform.', go: 'tab:concept', done: (p) => !!p.cards?.concept.premise?.trim() },
    { id: 'rules', title: 'Rules', hint: 'Hero health, how mana grows, the opening hand, how big the board is.', go: 'tab:rules', done: (p) => !!p.cards && p.cards.rules.heroHealth > 0 && p.cards.rules.manaMax > 0 },
    { id: 'cards', title: 'Cards', hint: 'A dozen cards across the costs: cheap minions, big ones, a few spells. Rough numbers; the curve tells you what’s off.', go: 'tab:cards', done: (p) => (p.cards?.cards.length ?? 0) >= 8 },
    { id: 'decks', title: 'Decks', hint: 'The cards the player brings, and the opponent’s.', go: 'tab:decks', done: (p) => !!p.cards && !cardIssues(p.cards).some((i) => i.severity === 'error') },
    { id: 'play', title: 'Play and balance', hint: 'Play the studio’s opponent and read a hundred games. Tick this when no card wins everything.', go: 'tab:play' },
    { id: 'handoff', title: 'Hand off', hint: 'Send it to Godot, Unity or Unreal as data the engine team builds on.', go: 'engine', done: (p) => !!p.handoff?.last },
  ],
};

const BLOCKS: GameModule = {
  id: 'blocks',
  name: 'Puzzle game',
  blurb: 'A push-block puzzle, level after level: the player pushes crates onto targets. The studio solves every level, so you know each can be done and how hard it is. Mobile, PC or console.',
  workspaces: ['graph', 'bible', 'notes', 'engine'],
  steps: [
    { id: 'concept', title: 'Concept', hint: 'What it is and where it plays: the premise, the theme, the platform.', go: 'tab:concept', done: (p) => !!p.blocks?.concept.premise?.trim() },
    { id: 'rules', title: 'Rules', hint: 'What the pieces are called, whether the player can undo, how stars are earned.', go: 'tab:rules', done: (p) => !!p.blocks?.rules.crateWord.trim() },
    { id: 'levels', title: 'Levels', hint: 'Draw five or more levels. Start tiny: one crate, one push. Each new level teaches one thing.', go: 'tab:levels', done: (p) => (p.blocks?.levels.length ?? 0) >= 5 && p.blocks!.levels.every((l) => !levelIssues(parseLevel(l.rows)).some((i) => i.severity === 'error')) },
    { id: 'order', title: 'Order and difficulty', hint: 'Put the levels in order, easy to hard. Ticks itself when the studio has solved every one.', go: 'tab:order', done: (p) => (p.blocks?.levels.length ?? 0) > 0 && p.blocks!.levels.every((l) => solveLevel(l).status === 'solved') },
    { id: 'play', title: 'Play and test', hint: 'Play every level yourself, against par. Tick this when each feels right.', go: 'tab:play' },
    { id: 'handoff', title: 'Hand off', hint: 'Send it to Godot, Unity or Unreal as data the engine team builds on.', go: 'engine', done: (p) => !!p.handoff?.last },
  ],
};

const MATCH: GameModule = {
  id: 'match',
  name: 'Match-3',
  blurb: 'Swap gems to line up three or more; chains, line gems and bombs. Levels with a move limit and a goal. The studio plays each level many times to say how hard it is. Mobile, PC or console.',
  workspaces: ['graph', 'bible', 'notes', 'engine'],
  steps: [
    { id: 'concept', title: 'Concept', hint: 'What it is and where it plays: the premise, the theme, the platform.', go: 'tab:concept', done: (p) => !!p.match?.concept.premise?.trim() },
    { id: 'rules', title: 'Rules', hint: 'What the gems are, the points, the chain bonus, whether specials are on.', go: 'tab:rules', done: (p) => (p.match?.rules.gems.length ?? 0) >= 3 },
    { id: 'levels', title: 'Levels', hint: 'Five or more levels: a board shape, how many colours, a move limit and a goal each.', go: 'tab:levels', done: (p) => (p.match?.levels.length ?? 0) >= 5 && p.match!.levels.every((l) => !matchLevelIssues(p.match!, l).some((i) => i.severity === 'error')) },
    { id: 'balance', title: 'Balance', hint: 'Read how often the studio’s player beats each level, and set the move limits. Tick this when the climb looks right.', go: 'tab:balance' },
    { id: 'play', title: 'Play and test', hint: 'Play every level yourself. Tick this when each feels right.', go: 'tab:play' },
    { id: 'handoff', title: 'Hand off', hint: 'Send it to Godot, Unity or Unreal as data the engine team builds on.', go: 'engine', done: (p) => !!p.handoff?.last },
  ],
};

const RUNNER: GameModule = {
  id: 'runner',
  name: 'Runner',
  blurb: 'An endless side-scrolling runner: the player runs on their own, faster and faster, jumping and sliding past blocks, bars and pits. You draw the track in chunks; the studio checks each can be got through. Mobile, PC or console.',
  workspaces: ['graph', 'bible', 'notes', 'engine'],
  steps: [
    { id: 'concept', title: 'Concept', hint: 'What it is and where it plays: the premise, the theme, the platform.', go: 'tab:concept', done: (p) => !!p.runner?.concept.premise?.trim() },
    { id: 'runner', title: 'The runner', hint: 'How fast the run starts and gets, how high the jump goes, how long a slide lasts.', go: 'tab:runner', done: (p) => !!p.runner && p.runner.rules.physics.startSpeed > 0 && p.runner.rules.physics.jumpSpeed > 0 },
    { id: 'chunks', title: 'Chunks', hint: 'Six or more short stretches of track across three tiers. Ticks itself when every one can be got through at the speeds it comes at.', go: 'tab:chunks', done: (p) => !!p.runner && p.runner.chunks.length >= 6 && p.runner.chunks.every((c) => speedRange(p.runner!.rules, c.tier).every((v) => passable(p.runner!.rules, c, v))) },
    { id: 'mix', title: 'Mix and pace', hint: 'When the harder tiers come in, how often each chunk comes up, and how far the studio’s runs get. Tick this when runs end where you want.', go: 'tab:mix' },
    { id: 'play', title: 'Play and test', hint: 'Run it yourself. Tick this when it feels right.', go: 'tab:play' },
    { id: 'handoff', title: 'Hand off', hint: 'Send it to Godot, Unity or Unreal as data the engine team builds on.', go: 'engine', done: (p) => !!p.handoff?.last },
  ],
};

const PLATFORMER: GameModule = {
  id: 'platformer',
  name: 'Platformer',
  blurb: 'A side-scrolling platformer, level by level: run and jump to the flag past spikes, pits and enemies (stomp them). The studio maps where the hero can get to, so you know every goal and coin can be reached. PC, console or mobile.',
  workspaces: ['graph', 'bible', 'notes', 'engine'],
  steps: [
    { id: 'concept', title: 'Concept', hint: 'What it is and where it plays: the premise, the theme, the platform.', go: 'tab:concept', done: (p) => !!p.platformer?.concept.premise?.trim() },
    { id: 'hero', title: 'The hero', hint: 'How fast the hero runs, how high and far a jump carries, how fast enemies walk.', go: 'tab:hero', done: (p) => !!p.platformer && p.platformer.rules.hero.runSpeed > 0 && p.platformer.rules.hero.jumpSpeed > 0 },
    { id: 'levels', title: 'Levels', hint: 'Three or more levels, a start and a goal each. Ticks itself when the studio can reach every goal.', go: 'tab:levels', done: (p) => !!p.platformer && p.platformer.levels.length >= 3 && p.platformer.levels.every((l) => !platformIssues(l).length && mapLevel(p.platformer!.rules, l).reachable) },
    { id: 'flow', title: 'Flow', hint: 'The levels in order, each with its jumps, tight jumps, time and coins. Tick this when they build the way you want.', go: 'tab:flow' },
    { id: 'play', title: 'Play and test', hint: 'Play every level yourself. Tick this when each feels right.', go: 'tab:play' },
    { id: 'handoff', title: 'Hand off', hint: 'Send it to Godot, Unity or Unreal as data the engine team builds on.', go: 'engine', done: (p) => !!p.handoff?.last },
  ],
};

export const MODULES: readonly GameModule[] = [STORY, DEFENSE, SHOOTER, ARENA, CARDS, BLOCKS, MATCH, RUNNER, PLATFORMER];

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
