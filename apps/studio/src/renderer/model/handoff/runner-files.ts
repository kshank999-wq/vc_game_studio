import { HEIGHTS, PLAYER, chunkLength, speedRange, type RunnerGame } from '../runner/runner';
import { DT, passable } from '../runner/sim';
import { fingerprint, type EngineAdapter, type ElementOutput, type GeneratedFile } from './engines';

/**
 * A runner for the engine (game modules): runner.json, the physics, the
 * pacing and every chunk, and RUNNER.md, the rules the studio's play preview
 * runs by and how to build them in the engine, so what the designer checked
 * can be got through is what the engine plays.
 */

export const RUNNER_FORMAT = 'vcgs-runner';

/** runner.json's content. */
export const runnerData = (g: RunnerGame) => {
  const p = g.rules.physics;
  return {
    format: RUNNER_FORMAT,
    version: 1,
    concept: g.concept,
    physics: { start_speed: p.startSpeed, speed_up_per_100: p.speedUp, max_speed: p.maxSpeed, jump_speed: p.jumpSpeed, gravity: p.gravity, slide_time: p.slideTime, frame: DT },
    player: { width: PLAYER.width, height: PLAYER.height, slide_height: PLAYER.slideHeight },
    pacing: { tier_2_at: g.rules.tierAt[0], tier_3_at: g.rules.tierAt[1], coin_value: g.rules.coinValue },
    legend: { rows: `${HEIGHTS} rows, heights ${HEIGHTS - 1} (top) down to 0 (on the ground): # solid, o a coin, . empty`, ground: '_ ground, . a pit' },
    chunks: g.chunks.map((c) => {
      const [slow, fast] = speedRange(g.rules, c.tier);
      return { name: c.name, tier: c.tier, weight: c.weight, length: chunkLength(c), rows: c.rows, ground: c.ground, checked: { slowest: slow, fastest: fast, passable: passable(g.rules, c, slow) && passable(g.rules, c, fast) } };
    }),
  };
};

const LOAD: Record<string, string> = {
  godot: '`var game = JSON.parse_string(FileAccess.get_file_as_string("res://<dir>/runner.json"))`. A CharacterBody2D for the runner (move it on x at the track speed, apply gravity yourself to match), each chunk a scene of StaticBody2D cells instanced end to end ahead of the camera.',
  unity: '`var game = JsonUtility.FromJson<…>(Resources.Load<TextAsset>("VCGS/runner").text)` (or Newtonsoft). A kinematic Rigidbody2D runner moved in FixedUpdate to the same numbers; chunks as prefabs (or Tilemaps) spawned ahead and recycled behind.',
  unreal: 'Read it with `FFileHelper::LoadFileToString` and `FJsonSerializer`. A Paper2D (or a constrained 3D) Character moved to the same numbers; chunks as actors spawned ahead of the camera and destroyed behind.',
  custom: "Read it with your engine's JSON reader.",
};

/** RUNNER.md: what runner.json holds and the rules the studio runs by. */
export const runnerMarkdown = (g: RunnerGame, engine: string, dir: string) => {
  const load = (LOAD[engine] ?? LOAD.custom!).replace('<dir>', dir);
  const p = g.rules.physics;
  return `# Runner

${g.concept.premise ? `${g.concept.premise}\n\n` : ''}The track pieces and the physics are in \`runner.json\`, as designed in VC Game Studio and checked by it. Build the engine's version to the same numbers and every chunk can be got through at the speeds it comes at.

## Loading it

${load}

## The data

- \`physics\`: \`start_speed\` (units a second), \`speed_up_per_100\` (added for every 100 units run), \`max_speed\`; \`jump_speed\` (up, units a second), \`gravity\` (units a second, a second); \`slide_time\` (seconds); \`frame\`: the studio steps the physics at this many seconds a frame.
- \`player\`: the runner's box, \`width\` × \`height\` standing, \`slide_height\` sliding. Its bottom is at height 0 on the ground.
- \`pacing\`: tier 2 chunks join at \`tier_2_at\` units into the run, tier 3 at \`tier_3_at\`; \`coin_value\` points a coin.
- \`chunks\`: each a stretch of track a \`length\` of units long. \`rows\` are its cells top first, heights ${HEIGHTS - 1} down to 0, a cell a unit square: \`#\` solid, \`o\` a coin. \`ground\`: \`_\` ground, \`.\` a pit. \`checked\` says the studio found a way through at its \`slowest\` and \`fastest\`.

## The rules

1. The run starts with a 10-unit runway. Then chunks follow end to end, each picked at random by \`weight\` from those whose tier has come in, never the same one twice running. A chunk is run at the speed for the distance where it starts: \`min(max_speed, start_speed + speed_up_per_100 × distance / 100)\`.
2. Each frame: move on by speed × frame; add velocity to height, then take gravity × frame off the velocity. Landing on ground stops the fall.
3. Jump: only on the ground; velocity becomes \`jump_speed\`. Slide: only on the ground; for \`slide_time\` the box is \`slide_height\` tall. Jumping ends a slide.
4. Touching a solid cell ends the run. So does falling into a pit (more than 1.2 units below the ground).
5. A coin is taken by touching it. Score: distance plus coins × \`coin_value\`.

## Chunks

${g.chunks.map((c) => `- ${c.name} (tier ${c.tier}, ${chunkLength(c)} units)`).join('\n')}

Speeds: ${p.startSpeed} to ${p.maxSpeed} units a second.
`;
};

const dirFor = (adapter: EngineAdapter, outputPath: string) => (adapter.id === 'unreal' ? 'VCGS/Data' : (adapter.takesDir?.(outputPath) ?? 'vcgs').replace(/\/+$/, ''));

/** runner.json and RUNNER.md for a runner project, and the handoff screen's row for them. None for other projects. */
export const runnerFiles = (game: RunnerGame | undefined, adapter: EngineAdapter, outputPath: string): { files: GeneratedFile[]; row: ElementOutput | null } => {
  if (!game) return { files: [], row: null };
  const dir = dirFor(adapter, outputPath);
  const data = `${JSON.stringify(runnerData(game), null, 2)}\n`;
  const files: GeneratedFile[] = [
    { path: `${dir}/runner.json`, content: data, kind: 'generated' },
    { path: `${dir}/RUNNER.md`, content: runnerMarkdown(game, adapter.id, dir), kind: 'generated' },
  ];
  return {
    files,
    row: { id: 'runner', label: 'Runner', symbol: 'environment', group: 'World', generates: `runner.json · ${game.chunks.length} chunks + RUNNER.md → ${dir}/`, files: files.map((f) => f.path), fingerprint: fingerprint(data) },
  };
};
