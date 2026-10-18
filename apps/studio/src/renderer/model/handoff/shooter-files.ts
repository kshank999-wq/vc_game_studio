import { FIELD, type ShooterGame } from '../shooter/shooter';
import { fingerprint, type EngineAdapter, type ElementOutput, type GeneratedFile } from './engines';

/**
 * An arcade shooter for the engine (game modules): shooter.json, the whole
 * game as data (field, ship, invaders, waves, shields, rules), and SHOOTER.md,
 * the rules the studio's play preview runs by and how to build them in the
 * engine, so what the designer tuned is what the engine plays.
 */

export const SHOOTER_FORMAT = 'vcgs-shooter';

const key = (name: string, taken: Set<string>) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'item';
  let k = base;
  for (let n = 2; taken.has(k); n++) k = `${base}_${n}`;
  taken.add(k);
  return k;
};

/** shooter.json's content: keys for invaders instead of ids; positions in field units, y down from the top. */
export const shooterData = (g: ShooterGame) => {
  const taken = new Set<string>();
  const keys = new Map(g.invaders.map((v) => [v.id, key(v.name, taken)]));
  return {
    format: SHOOTER_FORMAT,
    version: 1,
    concept: g.concept,
    field: { width: FIELD.width, height: FIELD.height, ship_y: FIELD.shipY, shield_y: FIELD.shieldY, formation_top: FIELD.formationTop, col_gap: FIELD.colGap, row_gap: FIELD.rowGap },
    ship: { speed: g.ship.speed, fire_rate: g.ship.fireRate, shot_speed: g.ship.shotSpeed, lives: g.ship.lives },
    invaders: g.invaders.map((v) => ({ key: keys.get(v.id), name: v.name, health: v.health, points: v.points, fire_per_minute: v.fire })),
    waves: g.waves.map((w, i) => ({ number: i + 1, rows: w.rows.filter((r) => keys.has(r)).map((r) => keys.get(r)), cols: w.cols, speed: w.speed, drop: w.drop, fire_scale: w.fireScale, bonus: w.bonus })),
    shields: { count: g.shields.count, health: g.shields.health },
    rules: { speed_up: g.rules.speedUp, enemy_shot_speed: g.rules.enemyShotSpeed, extra_life_every: g.rules.extraLifeEvery, breather: g.rules.breather },
  };
};

const LOAD: Record<string, string> = {
  godot: '`var game = JSON.parse_string(FileAccess.get_file_as_string("res://<dir>/shooter.json"))`. A Node2D for the formation (move it, not each invader), Area2D invaders, ship and shots, StaticBody2D shields.',
  unity: '`var game = JsonUtility.FromJson<…>(Resources.Load<TextAsset>("VCGS/shooter").text)` (or Newtonsoft). A parent transform for the formation, a MonoBehaviour each for the ship, invaders, shots and shields, with trigger colliders.',
  unreal: 'Read it with `FFileHelper::LoadFileToString` and `FJsonSerializer`, or import invaders and waves as Data Tables. An actor for the formation that moves its invader children; a Pawn for the ship.',
  custom: "Read it with your engine's JSON reader.",
};

/** SHOOTER.md: what shooter.json holds and the rules the studio plays it by. */
export const shooterMarkdown = (g: ShooterGame, engine: string, dir: string) => {
  const load = (LOAD[engine] ?? LOAD.custom!).replace('<dir>', dir);
  return `# Arcade shooter

${g.concept.premise ? `${g.concept.premise}\n\n` : ''}The game is in \`shooter.json\`, as designed and tuned in VC Game Studio's play preview. Build the engine's version to the same rules and it plays the same.

## Loading it

${load}

## The data

- \`field\`: the playfield in units, \`width\` × \`height\`, y down from the top. Scale it to the screen. The ship slides along \`ship_y\`; shields sit on \`shield_y\`; a formation's top row starts at \`formation_top\`, its invaders \`col_gap\` apart in a row and \`row_gap\` apart in a column, centred.
- \`ship\`: \`speed\` (units a second), \`fire_rate\` (shots a second at most), \`shot_speed\`, \`lives\`.
- \`invaders\`: \`health\` (hits), \`points\`, \`fire_per_minute\` (while lowest in its column).
- \`waves\`: in order; \`rows\` names the invader filling each row, top first, \`cols\` a row; \`speed\` (units a second sideways at the start), \`drop\` (units down at each side), \`fire_scale\` (times every invader's fire), \`bonus\` points for clearing it.
- \`shields\`: \`count\` evenly spaced across the field, each taking \`health\` hits.
- \`rules\`: \`speed_up\`, \`enemy_shot_speed\`, \`extra_life_every\` points (0: none), \`breather\` seconds between waves.

## The rules

1. The formation moves sideways at \`speed × (1 + speed_up × share destroyed)\`. When an invader reaches a side (half a unit in), it reverses and steps down \`drop\`.
2. Only the lowest invader in each column fires, at random, on average \`fire_per_minute × fire_scale\` times a minute. Its shots fall at \`enemy_shot_speed\`.
3. One ship shot takes one health off the first invader it meets. At 0 it is destroyed and scores its points.
4. Shots from either side that hit a standing shield take one of its health and stop.
5. A hit on the ship costs a life, clears the falling shots, and gives 1.5 seconds without hits. At 0 lives the game is lost. So is a formation that reaches the ship's row.
6. Clearing a wave scores its bonus; after the breather, the next wave. Clearing the last wins. A life every \`extra_life_every\` points.

## Tuned as

${g.waves.length} waves, ${g.invaders.length} invaders; the player has ${g.ship.lives} lives and ${g.shields.count} shields.
`;
};

const dirFor = (adapter: EngineAdapter, outputPath: string) => (adapter.id === 'unreal' ? 'VCGS/Data' : (adapter.takesDir?.(outputPath) ?? 'vcgs').replace(/\/+$/, ''));

/** shooter.json and SHOOTER.md for an arcade shooter project, and the handoff screen's row for them. None for other projects. */
export const shooterFiles = (game: ShooterGame | undefined, adapter: EngineAdapter, outputPath: string): { files: GeneratedFile[]; row: ElementOutput | null } => {
  if (!game) return { files: [], row: null };
  const dir = dirFor(adapter, outputPath);
  const data = `${JSON.stringify(shooterData(game), null, 2)}\n`;
  const files: GeneratedFile[] = [
    { path: `${dir}/shooter.json`, content: data, kind: 'generated' },
    { path: `${dir}/SHOOTER.md`, content: shooterMarkdown(game, adapter.id, dir), kind: 'generated' },
  ];
  return {
    files,
    row: {
      id: 'shooter',
      label: 'Arcade shooter',
      symbol: 'environment',
      group: 'World',
      generates: `shooter.json · ${game.invaders.length} invaders, ${game.waves.length} waves + SHOOTER.md → ${dir}/`,
      files: files.map((f) => f.path),
      fingerprint: fingerprint(data),
    },
  };
};
