import { goalText, parseShape, type MatchGame } from '../match/match';
import { fingerprint, type EngineAdapter, type ElementOutput, type GeneratedFile } from './engines';

/**
 * A match-3 game for the engine (game modules): match3.json, the rules and
 * every level (shape, colours, moves, goal), and MATCH3.md, the rules the
 * studio's play preview runs by and how to build them in the engine, so what
 * the designer balanced is what the engine plays.
 */

export const MATCH_FORMAT = 'vcgs-match3';

/** match3.json's content. */
export const matchData = (g: MatchGame) => ({
  format: MATCH_FORMAT,
  version: 1,
  concept: g.concept,
  rules: { gems: g.rules.gems, points: g.rules.points, chain_bonus: g.rules.chainBonus, specials: g.rules.specials, star_steps: g.rules.starSteps },
  legend: { '.': 'cell', '#': 'no cell', j: 'cell with jelly' },
  levels: g.levels.map((l, i) => {
    const s = parseShape(l.rows);
    return {
      number: i + 1,
      name: l.name,
      width: s.cols,
      height: s.rows,
      rows: l.rows,
      colors: l.colors,
      moves: l.moves,
      goal: { kind: l.goal.kind, ...(l.goal.kind === 'jelly' ? {} : { amount: l.goal.amount }), ...(l.goal.kind === 'collect' ? { gem: g.rules.gems[l.goal.color] } : {}) },
      goal_text: goalText(g, l),
    };
  }),
});

const LOAD: Record<string, string> = {
  godot: '`var game = JSON.parse_string(FileAccess.get_file_as_string("res://<dir>/match3.json"))`. A GridContainer (or a TileMap) for the board from each level\'s `rows`; gems as sprites tweened as they swap and fall.',
  unity: '`var game = JsonUtility.FromJson<…>(Resources.Load<TextAsset>("VCGS/match3").text)` (or Newtonsoft). A grid of prefabs from each level\'s `rows`; gems tweened (DOTween or a coroutine) as they swap and fall.',
  unreal: 'Read it with `FFileHelper::LoadFileToString` and `FJsonSerializer`. A UMG UniformGridPanel (or a grid of actors) from each level\'s `rows`; gems animated as they swap and fall.',
  custom: "Read it with your engine's JSON reader.",
};

/** MATCH3.md: what match3.json holds and the rules the studio plays it by. */
export const matchMarkdown = (g: MatchGame, engine: string, dir: string) => {
  const load = (LOAD[engine] ?? LOAD.custom!).replace('<dir>', dir);
  return `# Match-3

${g.concept.premise ? `${g.concept.premise}\n\n` : ''}The levels are in \`match3.json\`, as designed and balanced in VC Game Studio. Build the engine's version to the same rules and every level plays the same.

## Loading it

${load}

## The data

- \`rules\`: \`gems\` (the colours, in order), \`points\` a gem, \`chain_bonus\` (each step of a chain scores this much more), \`specials\` (on or off), \`star_steps\` (two and three stars at these times the first star's score).
- \`levels\`: in order. \`rows\` is the board: \`.\` a cell, \`#\` no cell, \`j\` a cell with jelly under it; row 0 at the top. \`colors\`: how many of the gems (the first so many) fall on it. \`moves\`: the limit. \`goal\`: \`score\` (reach \`amount\`), \`collect\` (clear \`amount\` of \`gem\`) or \`jelly\` (clear every jelly cell).

## The rules

1. Fill the board at random from the level's colours, with no line of three to start and at least one move.
2. A move swaps two side-by-side gems, and only counts if it lines up three or more of a colour, across or down. Otherwise the gems swap back.
3. Every line of three or more clears. Each gem scores \`points × (1 + chain_bonus × (step − 1))\`: the first clear is step 1, each clear the falling gems set off is the next step.
${g.rules.specials ? '4. Four in a line leaves a line gem where the swap was (or the middle): across for an across line, down for a down line. Five in a line, or a gem in two lines at once (an L or T), leaves a bomb. When cleared, a line gem clears its whole row or column, and a bomb the 3×3 round it; these can set each other off.\n5.' : '4.'} Gems fall straight down through the cells below; new gems drop in at the top. Clearing a gem over jelly clears the jelly.
${g.rules.specials ? '6.' : '5.'} With no move left, shuffle the gems on the board.
${g.rules.specials ? '7.' : '6.'} The level is won when the goal is met, lost when the moves run out first.

## Levels

${g.levels.map((l, i) => `${i + 1}. ${l.name}: ${goalText(g, l)} in ${l.moves} moves, ${l.colors} colours.`).join('\n')}
`;
};

const dirFor = (adapter: EngineAdapter, outputPath: string) => (adapter.id === 'unreal' ? 'VCGS/Data' : (adapter.takesDir?.(outputPath) ?? 'vcgs').replace(/\/+$/, ''));

/** match3.json and MATCH3.md for a match-3 project, and the handoff screen's row for them. None for other projects. */
export const matchFiles = (game: MatchGame | undefined, adapter: EngineAdapter, outputPath: string): { files: GeneratedFile[]; row: ElementOutput | null } => {
  if (!game) return { files: [], row: null };
  const dir = dirFor(adapter, outputPath);
  const data = `${JSON.stringify(matchData(game), null, 2)}\n`;
  const files: GeneratedFile[] = [
    { path: `${dir}/match3.json`, content: data, kind: 'generated' },
    { path: `${dir}/MATCH3.md`, content: matchMarkdown(game, adapter.id, dir), kind: 'generated' },
  ];
  return {
    files,
    row: { id: 'match', label: 'Match-3', symbol: 'puzzle', group: 'World', generates: `match3.json · ${game.levels.length} levels + MATCH3.md → ${dir}/`, files: files.map((f) => f.path), fingerprint: fingerprint(data) },
  };
};
