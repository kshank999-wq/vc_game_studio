import { ARENA, laneXs, type ArenaGame } from '../arena/arena';
import { fingerprint, type EngineAdapter, type ElementOutput, type GeneratedFile } from './engines';

/**
 * A head-to-head arena for the engine (game modules): arena.json, the whole
 * game as data (field, lanes, towers, units, match rules, decks), and
 * ARENA.md, the rules the studio's play preview runs by and how to build
 * them in the engine, so what the designer balanced is what the engine plays.
 */

export const ARENA_FORMAT = 'vcgs-arena';

const key = (name: string, taken: Set<string>) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'item';
  let k = base;
  for (let n = 2; taken.has(k); n++) k = `${base}_${n}`;
  taken.add(k);
  return k;
};

/** arena.json's content: keys for units instead of ids; positions in field units, y down from the opponent's edge. */
export const arenaData = (g: ArenaGame) => {
  const taken = new Set<string>();
  const keys = new Map(g.units.map((u) => [u.id, key(u.name, taken)]));
  const tower = (t: ArenaGame['keep']) => ({ health: t.health, damage: t.damage, rate: t.rate, range: t.range });
  return {
    format: ARENA_FORMAT,
    version: 1,
    concept: g.concept,
    field: { width: ARENA.width, length: ARENA.length, lanes: laneXs(g.match.lanes), keep_from_edge: ARENA.keepY, guard_from_edge: ARENA.guardY },
    towers: { keep: tower(g.keep), guard: tower(g.guard) },
    units: g.units.map((u) => ({ key: keys.get(u.id), name: u.name, cost: u.cost, count: u.count, health: u.health, damage: u.damage, rate: u.rate, range: u.range, speed: u.speed, splash: u.splash, buildings_only: u.buildingsOnly, flying: u.flying, hits_air: u.hitsAir })),
    match: { length: g.match.length, energy_start: g.match.energyStart, energy_max: g.match.energyMax, energy_rate: g.match.energyRate },
    decks: { player: g.decks.blue.filter((id) => keys.has(id)).map((id) => keys.get(id)), opponent: g.decks.red.filter((id) => keys.has(id)).map((id) => keys.get(id)) },
  };
};

const LOAD: Record<string, string> = {
  godot: '`var game = JSON.parse_string(FileAccess.get_file_as_string("res://<dir>/arena.json"))`. A CharacterBody2D (or NavigationAgent) a unit, a StaticBody2D a tower, a Control for the hand of cards and the energy bar.',
  unity: '`var game = JsonUtility.FromJson<…>(Resources.Load<TextAsset>("VCGS/arena").text)` (or Newtonsoft). A NavMeshAgent a unit, a MonoBehaviour a tower, a UI Canvas for the cards and energy.',
  unreal: 'Read it with `FFileHelper::LoadFileToString` and `FJsonSerializer`, or import units as a Data Table. A Character with an AI Controller a unit, an Actor a tower, UMG for the cards and energy.',
  custom: "Read it with your engine's JSON reader.",
};

/** ARENA.md: what arena.json holds and the rules the studio plays it by. */
export const arenaMarkdown = (g: ArenaGame, engine: string, dir: string) => {
  const load = (LOAD[engine] ?? LOAD.custom!).replace('<dir>', dir);
  return `# Head-to-head arena

${g.concept.premise ? `${g.concept.premise}\n\n` : ''}The game is in \`arena.json\`, as designed and balanced in VC Game Studio's play preview. Build the engine's version to the same rules and it plays the same.

## Loading it

${load}

## The data

- \`field\`: \`width\` × \`length\` units. The opponent's edge is y 0, the player's is y \`length\`. \`lanes\` are the x of each lane. Each side has a keep at the middle, \`keep_from_edge\` in from its edge, and a guard tower in each lane, \`guard_from_edge\` in.
- \`towers\`: the keep's and the guards' \`health\`, \`damage\` a hit, \`rate\` (hits a second), \`range\`.
- \`units\`: \`cost\` (energy), \`count\` (how many come when played), \`health\`, \`damage\`, \`rate\`, \`range\`, \`speed\` (units a second), \`splash\` (radius; 0 is one target), \`buildings_only\`, \`flying\`, \`hits_air\`.
- \`match\`: \`length\` seconds, \`energy_start\`, \`energy_max\`, \`energy_rate\` (energy a second).
- \`decks\`: the player's cards and the opponent's, in the order the studio's opponent plays them.

## The rules

1. Energy builds at \`energy_rate\` to \`energy_max\`. Playing a unit costs its \`cost\`; it can be played anywhere on your own half.
2. A unit goes for the nearest enemy unit it can hit within 5 units (flying units only by those that hit air), else the nearest enemy tower. \`buildings_only\` units go only for towers. It walks straight there, stops in range, and hits every 1 / \`rate\` seconds.
3. Splash does the same damage to every enemy unit within \`splash\` of the target.
4. A tower hits the nearest enemy unit in range, flying or not.
5. Knocking down a keep wins at once. At \`length\` seconds, the side that has knocked down more towers wins; level is a draw.

## The studio's opponent

It plays its deck in order, as soon as it can afford the next card. With enemy units on its half, it plays in their lane, between them and its towers. Otherwise it plays at its back, in the lane whose enemy guard is weakest.

## Balanced as

${g.units.length} units; ${laneXs(g.match.lanes).length} lane${g.match.lanes === 1 ? '' : 's'}; ${g.match.length}-second matches.
`;
};

const dirFor = (adapter: EngineAdapter, outputPath: string) => (adapter.id === 'unreal' ? 'VCGS/Data' : (adapter.takesDir?.(outputPath) ?? 'vcgs').replace(/\/+$/, ''));

/** arena.json and ARENA.md for a head-to-head arena project, and the handoff screen's row for them. None for other projects. */
export const arenaFiles = (game: ArenaGame | undefined, adapter: EngineAdapter, outputPath: string): { files: GeneratedFile[]; row: ElementOutput | null } => {
  if (!game) return { files: [], row: null };
  const dir = dirFor(adapter, outputPath);
  const data = `${JSON.stringify(arenaData(game), null, 2)}\n`;
  const files: GeneratedFile[] = [
    { path: `${dir}/arena.json`, content: data, kind: 'generated' },
    { path: `${dir}/ARENA.md`, content: arenaMarkdown(game, adapter.id, dir), kind: 'generated' },
  ];
  return {
    files,
    row: {
      id: 'arena',
      label: 'Head-to-head arena',
      symbol: 'environment',
      group: 'World',
      generates: `arena.json · ${game.units.length} units, ${laneXs(game.match.lanes).length} lanes + ARENA.md → ${dir}/`,
      files: files.map((f) => f.path),
      fingerprint: fingerprint(data),
    },
  };
};
