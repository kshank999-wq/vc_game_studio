import { HERO, parseGrid, type PlatformGame } from '../platformer/platformer';
import { DT, mapLevel } from '../platformer/sim';
import { fingerprint, type EngineAdapter, type ElementOutput, type GeneratedFile } from './engines';

/**
 * A platformer for the engine (game modules): platformer.json, the hero's
 * physics and every level as tile rows with what the studio found (the
 * route's jumps and time, the coins in reach), and PLATFORMER.md, the rules
 * the studio's play preview runs by and how to build them in the engine,
 * so every goal the studio reached the engine's hero can reach too.
 */

export const PLATFORMER_FORMAT = 'vcgs-platformer';

/** platformer.json's content. */
export const platformerData = (g: PlatformGame) => {
  const h = g.rules.hero;
  return {
    format: PLATFORMER_FORMAT,
    version: 1,
    concept: g.concept,
    hero: { run_speed: h.runSpeed, jump_speed: h.jumpSpeed, gravity: h.gravity, coyote_time: h.coyoteTime, width: HERO.width, height: HERO.height, frame: DT },
    rules: { enemy_speed: g.rules.enemySpeed, coin_value: g.rules.coinValue, lives: g.rules.lives },
    legend: { '#': 'solid', '=': 'one-way platform', '^': 'spikes', o: 'coin', e: 'walking enemy', S: 'start', G: 'goal', '.': 'empty' },
    levels: g.levels.map((l, i) => {
      const grid = parseGrid(l.rows);
      const m = mapLevel(g.rules, l);
      return { number: i + 1, name: l.name, width: grid.cols, height: grid.rows, rows: l.rows, par: l.par, checked: { goal_reachable: m.reachable, jumps: m.jumps, tight_jumps: m.tight, route_seconds: m.seconds, coins: m.coins, coins_reachable: m.reachableCoins } };
    }),
  };
};

const LOAD: Record<string, string> = {
  godot: '`var game = JSON.parse_string(FileAccess.get_file_as_string("res://<dir>/platformer.json"))`. Fill a TileMap from each level\'s `rows` (one-way platforms as one-way collision tiles); a CharacterBody2D hero moved to the same numbers; enemies as their own small bodies.',
  unity: '`var game = JsonUtility.FromJson<…>(Resources.Load<TextAsset>("VCGS/platformer").text)` (or Newtonsoft). Fill a Tilemap from each level\'s `rows` (a PlatformEffector2D for one-way tiles); a kinematic Rigidbody2D hero moved in FixedUpdate to the same numbers.',
  unreal: 'Read it with `FFileHelper::LoadFileToString` and `FJsonSerializer`. A Paper2D tile map (or instanced cubes) from each level\'s `rows`; a constrained Character with its movement set to the same numbers.',
  custom: "Read it with your engine's JSON reader.",
};

/** PLATFORMER.md: what platformer.json holds and the rules the studio plays by. */
export const platformerMarkdown = (g: PlatformGame, engine: string, dir: string) => {
  const load = (LOAD[engine] ?? LOAD.custom!).replace('<dir>', dir);
  const h = g.rules.hero;
  return `# Platformer

${g.concept.premise ? `${g.concept.premise}\n\n` : ''}The levels and the hero are in \`platformer.json\`, as designed in VC Game Studio and checked by it. Build the engine's version to the same numbers and every goal the studio reached can be reached.

## Loading it

${load}

## The data

- \`hero\`: \`run_speed\` (tiles a second), \`jump_speed\` (tiles a second, up), \`gravity\` (tiles a second, a second), \`coyote_time\` (seconds after running off an edge that a jump still works), the box \`width\` × \`height\` in tiles; \`frame\`: the studio steps the physics at this many seconds a frame.
- \`rules\`: \`enemy_speed\`, \`coin_value\`, \`lives\`.
- \`levels\`: in order. \`rows\` are tiles, row 0 at the top, a tile a unit square; see \`legend\`. \`checked\` is what the studio found: whether the goal can be reached, the jumps and tight jumps on its route, how long the route takes, and how many coins are in reach.

## The rules

1. Each frame: the hero moves across at \`run_speed\` (left, right or not at all; no run-up), stopped by solid tiles. Gravity adds to its fall (at most 20 tiles a second), and it moves down or up, landing on solid tiles, and on one-way platforms only from above. A solid tile overhead stops it rising.
2. A jump starts on the ground, or within \`coyote_time\` of leaving it: fall speed becomes \`jump_speed\` upward.
3. Spikes end a try when the hero's feet reach the lower half of their tile. So does falling below the level.
4. An enemy walks at \`enemy_speed\`, turning at walls and at edges. Touching it ends a try, unless the hero is falling and its feet are within 0.45 of the enemy's top: then the enemy is stomped and the hero bounces up at 0.55 × \`jump_speed\`.
5. Touching a coin takes it. Touching the goal finishes the level.

## Levels

${g.levels.map((l, i) => `${i + 1}. ${l.name}`).join('\n')}

Hero: runs ${h.runSpeed} tiles a second; a jump rises ${((h.jumpSpeed * h.jumpSpeed) / (2 * h.gravity)).toFixed(2)} tiles.
`;
};

const dirFor = (adapter: EngineAdapter, outputPath: string) => (adapter.id === 'unreal' ? 'VCGS/Data' : (adapter.takesDir?.(outputPath) ?? 'vcgs').replace(/\/+$/, ''));

/** platformer.json and PLATFORMER.md for a platformer project, and the handoff screen's row for them. None for other projects. */
export const platformerFiles = (game: PlatformGame | undefined, adapter: EngineAdapter, outputPath: string): { files: GeneratedFile[]; row: ElementOutput | null } => {
  if (!game) return { files: [], row: null };
  const dir = dirFor(adapter, outputPath);
  const data = `${JSON.stringify(platformerData(game), null, 2)}\n`;
  const files: GeneratedFile[] = [
    { path: `${dir}/platformer.json`, content: data, kind: 'generated' },
    { path: `${dir}/PLATFORMER.md`, content: platformerMarkdown(game, adapter.id, dir), kind: 'generated' },
  ];
  return {
    files,
    row: { id: 'platformer', label: 'Platformer', symbol: 'environment', group: 'World', generates: `platformer.json · ${game.levels.length} levels + PLATFORMER.md → ${dir}/`, files: files.map((f) => f.path), fingerprint: fingerprint(data) },
  };
};
