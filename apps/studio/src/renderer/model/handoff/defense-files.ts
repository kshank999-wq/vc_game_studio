import { costTo, type DefenseGame } from '../defense/defense';
import { fingerprint, type EngineAdapter, type ElementOutput, type GeneratedFile } from './engines';

/**
 * A castle defense game for the engine (game modules): defense.json, the whole
 * game as data (map, path, build spots, towers and their upgrades, enemies,
 * waves, economy, the test layout), and DEFENSE.md, the rules the studio's
 * play preview runs by and how to build them in the engine, so what the
 * designer balanced is what the engine plays.
 */

export const DEFENSE_FORMAT = 'vcgs-defense';

const key = (name: string, taken: Set<string>) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'item';
  let k = base;
  for (let n = 2; taken.has(k); n++) k = `${base}_${n}`;
  taken.add(k);
  return k;
};

/** defense.json's content: keys for towers and enemies instead of ids, cells as [column, row] from the top left. */
export const defenseData = (g: DefenseGame) => {
  const taken = new Set<string>();
  const towerKey = new Map(g.towers.map((t) => [t.id, key(t.name, taken)]));
  const enemyKey = new Map(g.enemies.map((e) => [e.id, key(e.name, taken)]));
  return {
    format: DEFENSE_FORMAT,
    version: 1,
    concept: g.concept,
    map: { cols: g.map.cols, rows: g.map.rows, path: g.map.path, spots: g.map.spots },
    towers: g.towers.map((t) => ({
      key: towerKey.get(t.id),
      name: t.name,
      levels: [{ cost: t.cost, damage: t.damage, range: t.range, rate: t.rate }, ...t.upgrades.map((u) => ({ cost: u.cost, damage: u.damage, range: u.range, rate: u.rate }))],
      splash: t.splash,
      slow: t.slow,
      hits_air: t.hitsAir,
    })),
    enemies: g.enemies.map((e) => ({ key: enemyKey.get(e.id), name: e.name, health: e.health, speed: e.speed, armor: e.armor, reward: e.reward, leak: e.leak, flying: e.flying })),
    waves: g.waves.map((w, i) => ({ number: i + 1, bonus: w.bonus, groups: w.groups.filter((grp) => enemyKey.has(grp.enemyId)).map((grp) => ({ enemy: enemyKey.get(grp.enemyId), count: grp.count, gap: grp.gap, delay: grp.delay })) })),
    economy: { start_gold: g.economy.startGold, lives: g.economy.lives, sell_back: g.economy.sellBack, breather: g.economy.breather },
    test_layout: g.layout.flatMap((p) => {
      const t = g.towers.find((x) => x.id === p.towerId);
      return t && g.map.spots[p.spot] ? [{ spot: p.spot, tower: towerKey.get(t.id), level: p.level, cost: costTo(t, p.level) }] : [];
    }),
  };
};

const LOAD: Record<string, string> = {
  godot: '`var game = JSON.parse_string(FileAccess.get_file_as_string("res://<dir>/defense.json"))`. A TileMap (or GridMap) for the grid, a Path2D through the path cells\' centres, and an Area2D a tower that finds its target as below.',
  unity: '`var game = JsonUtility.FromJson<…>(Resources.Load<TextAsset>("VCGS/defense").text)` (or Newtonsoft). A Tilemap for the grid, the path as waypoints, a MonoBehaviour a tower that finds its target as below.',
  unreal: 'Read it with `FFileHelper::LoadFileToString` and `FJsonSerializer`, or import towers, enemies and waves as Data Tables. A spline through the path cells for the enemies to follow, an actor a tower.',
  custom: 'Read it with your engine\'s JSON reader.',
};

/** DEFENSE.md: what defense.json holds and the rules the studio plays it by. */
export const defenseMarkdown = (g: DefenseGame, engine: string, dir: string) => {
  const load = (LOAD[engine] ?? LOAD.custom!).replace('<dir>', dir);
  return `# Castle defense

${g.concept.premise ? `${g.concept.premise}\n\n` : ''}The game is in \`defense.json\`, as designed and balanced in VC Game Studio's play preview. Build the engine's version to the same rules and it plays the same.

## Loading it

${load}

## The data

- \`map\`: a grid of \`cols\` × \`rows\` cells; a cell is \`[column, row]\`, row 0 at the top. \`path\` is the cells the enemies walk, in order, from where they come in to the castle (the last cell); each is next to the one before. \`spots\` are where towers can be built.
- \`towers\`: each with \`levels\` (level 1 as built, then each upgrade: its own \`cost\` and stats), \`splash\` (cells round the target that also take the damage; 0 is one target), \`slow\` (share of speed taken off what it hits, for 1 second), \`hits_air\`.
- \`enemies\`: \`health\`, \`speed\` (cells a second), \`armor\`, \`reward\` (gold for the kill), \`leak\` (lives lost if it reaches the castle), \`flying\`.
- \`waves\`: in order; each \`group\` sends \`count\` of one enemy, \`gap\` seconds apart, the first \`delay\` seconds into the wave; \`bonus\` gold for clearing it.
- \`economy\`: \`start_gold\`, \`lives\`, \`sell_back\` (share of what a tower cost that selling it returns), \`breather\` (seconds between waves).
- \`test_layout\`: the towers the designer tested with; a good first layout for the tutorial or an attract mode.

## The rules

1. Enemies walk the path centre line at their speed (times 1 − slow while slowed).
2. A tower fires every 1 / rate seconds at the enemy in range that is furthest along the path; it skips flying enemies unless it hits air.
3. A hit does max(1, damage − armor); splash does the same to every other enemy within \`splash\` cells of the target.
4. A kill pays its reward. An enemy that reaches the castle takes \`leak\` lives and is gone; at 0 lives the game is lost.
5. A wave is cleared when all its enemies have come and none is left; that pays its bonus, then the breather, then the next wave. Clearing the last wave wins.

## Balance as designed

${g.waves.length} waves, ${g.towers.length} towers, ${g.enemies.length} enemies; the player starts with ${g.economy.startGold} gold and ${g.economy.lives} lives.
`;
};

/** Where an engine's defense files go. */
const dirFor = (adapter: EngineAdapter, outputPath: string) => (adapter.id === 'unreal' ? 'VCGS/Data' : (adapter.takesDir?.(outputPath) ?? 'vcgs').replace(/\/+$/, ''));

/** defense.json and DEFENSE.md for a castle defense project, and the handoff screen's row for them. None for other projects. */
export const defenseFiles = (game: DefenseGame | undefined, adapter: EngineAdapter, outputPath: string): { files: GeneratedFile[]; row: ElementOutput | null } => {
  if (!game) return { files: [], row: null };
  const dir = dirFor(adapter, outputPath);
  const data = `${JSON.stringify(defenseData(game), null, 2)}\n`;
  const files: GeneratedFile[] = [
    { path: `${dir}/defense.json`, content: data, kind: 'generated' },
    { path: `${dir}/DEFENSE.md`, content: defenseMarkdown(game, adapter.id, dir), kind: 'generated' },
  ];
  return {
    files,
    row: {
      id: 'defense',
      label: 'Castle defense',
      symbol: 'environment',
      group: 'World',
      generates: `defense.json · ${game.towers.length} towers, ${game.enemies.length} enemies, ${game.waves.length} waves + DEFENSE.md → ${dir}/`,
      files: files.map((f) => f.path),
      fingerprint: fingerprint(data),
    },
  };
};
