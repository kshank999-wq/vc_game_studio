import { parseLevel, type BlockGame } from '../blocks/blocks';
import { difficulty, solveLevel } from '../blocks/solver';
import { fingerprint, type EngineAdapter, type ElementOutput, type GeneratedFile } from './engines';

/**
 * A puzzle game for the engine (game modules): puzzles.json, every level in
 * the standard text format with the studio's solution, its par and
 * difficulty, and PUZZLES.md, the rules and how to build them in the engine.
 * The solutions are there for a hint button, and for the engine team to
 * test the levels still solve after they change the rules.
 */

export const BLOCKS_FORMAT = 'vcgs-puzzles';

/** puzzles.json's content. */
export const blockData = (g: BlockGame) => ({
  format: BLOCKS_FORMAT,
  version: 1,
  concept: g.concept,
  rules: { crate_word: g.rules.crateWord, target_word: g.rules.targetWord, undo: g.rules.undo, two_star_slack: g.rules.twoStarSlack },
  legend: { '#': 'wall', ' ': 'floor', '.': 'target', $: 'crate', '*': 'crate on a target', '@': 'player', '+': 'player on a target' },
  levels: g.levels.map((l, i) => {
    const s = solveLevel(l);
    const b = parseLevel(l.rows);
    return {
      number: i + 1,
      name: l.name,
      width: b.cols,
      height: b.rows,
      rows: l.rows,
      par: l.par || s.moves,
      solution: s.status === 'solved' ? s.path : null,
      best_moves: s.status === 'solved' ? s.moves : null,
      pushes: s.status === 'solved' ? s.pushes : null,
      difficulty: difficulty(s),
    };
  }),
});

const LOAD: Record<string, string> = {
  godot: '`var game = JSON.parse_string(FileAccess.get_file_as_string("res://<dir>/puzzles.json"))`. Fill a TileMap from each level\'s `rows`; the crates and the player are sprites that move a cell at a time (a Tween for the slide).',
  unity: '`var game = JsonUtility.FromJson<…>(Resources.Load<TextAsset>("VCGS/puzzles").text)` (or Newtonsoft). Fill a Tilemap from each level\'s `rows`; the crates and the player are GameObjects that move a cell at a time.',
  unreal: 'Read it with `FFileHelper::LoadFileToString` and `FJsonSerializer`. Spawn a grid of actors (or a Paper2D tile map) from each level\'s `rows`; crates and the player move a cell at a time.',
  custom: "Read it with your engine's JSON reader.",
};

/** PUZZLES.md: what puzzles.json holds and the rules the studio plays and solves by. */
export const blockMarkdown = (g: BlockGame, engine: string, dir: string) => {
  const load = (LOAD[engine] ?? LOAD.custom!).replace('<dir>', dir);
  const crate = g.rules.crateWord || 'crate';
  const target = g.rules.targetWord || 'target';
  return `# Puzzle game

${g.concept.premise ? `${g.concept.premise}\n\n` : ''}The levels are in \`puzzles.json\`, as designed in VC Game Studio and solved by it. Build the engine's version to the same rules and every level plays, and solves, the same.

## Loading it

${load}

## The data

- \`levels\`: in order. \`rows\` is the level in the standard text format: \`#\` wall, a space floor, \`.\` ${target}, \`$\` ${crate}, \`*\` ${crate} on a ${target}, \`@\` the player, \`+\` the player on a ${target}. Row 0 is the top.
- \`solution\`: the studio's, in the fewest moves: \`u d l r\` a step, \`U D L R\` a push. Use it for hints, and to check a level still solves.
- \`par\`: moves for three stars. Two stars within ${Math.round(g.rules.twoStarSlack * 100)}% over par; one for finishing.
- \`difficulty\`: 1 to 5, from how much the solver had to search and how many pushes it takes.

## The rules

1. The player steps up, down, left or right, onto floor or a ${target}; never into a wall.
2. Stepping into a ${crate} pushes it a cell the same way, if that cell is floor or a ${target} with nothing on it. Never two ${crate}s at once; never pulled.
3. The level is done when every ${crate} is on a ${target}.
4. ${g.rules.undo ? 'The player can undo moves and restart the level.' : 'There is no undo; the player can restart the level.'}

## Levels

${g.levels.map((l, i) => `${i + 1}. ${l.name}`).join('\n')}
`;
};

const dirFor = (adapter: EngineAdapter, outputPath: string) => (adapter.id === 'unreal' ? 'VCGS/Data' : (adapter.takesDir?.(outputPath) ?? 'vcgs').replace(/\/+$/, ''));

/** puzzles.json and PUZZLES.md for a puzzle game project, and the handoff screen's row for them. None for other projects. */
export const blockFiles = (game: BlockGame | undefined, adapter: EngineAdapter, outputPath: string): { files: GeneratedFile[]; row: ElementOutput | null } => {
  if (!game) return { files: [], row: null };
  const dir = dirFor(adapter, outputPath);
  const data = `${JSON.stringify(blockData(game), null, 2)}\n`;
  const files: GeneratedFile[] = [
    { path: `${dir}/puzzles.json`, content: data, kind: 'generated' },
    { path: `${dir}/PUZZLES.md`, content: blockMarkdown(game, adapter.id, dir), kind: 'generated' },
  ];
  return {
    files,
    row: {
      id: 'blocks',
      label: 'Puzzle game',
      symbol: 'puzzle',
      group: 'World',
      generates: `puzzles.json · ${game.levels.length} levels with solutions + PUZZLES.md → ${dir}/`,
      files: files.map((f) => f.path),
      fingerprint: fingerprint(data),
    },
  };
};
