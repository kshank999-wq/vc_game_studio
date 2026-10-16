import { countLabel, METRICS } from '../level/budget';
import type { IrLevel } from './levels';

export type StreamingEngine = 'godot' | 'unity' | 'unreal' | 'json';

/** How each engine builds the partition from the plan. */
const howTo = (engine: StreamingEngine, cell: number, range: number): string[] => {
  switch (engine) {
    case 'unreal':
      return [
        `Turn on World Partition for the level (World Settings ▸ Enable Streaming) and set the runtime grid's Cell Size to ${cell * 100} and its Loading Range to ${range * 100} (centimetres). The grid's cells line up with these when its origin is at the plan's north-west corner.`,
        'Put what stays loaded in a level instance or a Data Layer that is always activated, or untick Is Spatially Loaded on it.',
      ];
    case 'unity':
      return [
        'Make one additive scene (or one Addressables group) per cell, holding the items listed for it, and keep what stays loaded in the main scene.',
        `Load a cell's scene with SceneManager.LoadSceneAsync(…, LoadSceneMode.Additive) when the player comes within ${range} m of its square, and unload it when they go farther. Unity's z is south-negative: a cell's [x0, z0, x1, z1] is [x0, -z1, x1, -z0] in Unity.`,
      ];
    case 'godot':
      return [
        'Make one scene per cell, holding the items listed for it, and keep what stays loaded in the level scene.',
        `Load a cell's scene with ResourceLoader.load_threaded_request and add it under the level when the player comes within ${range} m of its square; free it when they go farther.`,
      ];
    case 'json':
      return [`Load a cell when the player comes within ${range} m of its square, unload it when they go farther, and keep what stays loaded loaded throughout.`];
  }
};

/**
 * STREAMING.md (spec §19 world partition): each planned level's grid of
 * cells, what is in each, what stays loaded, and what is loaded at once at
 * its worst, with how to build it in the engine. Null when no level has a plan.
 */
export const streamingMarkdown = (ir: { levels: readonly IrLevel[] }, engine: StreamingEngine, nameOf: (level: IrLevel) => string): string | null => {
  const levels = ir.levels.filter((l) => l.streaming);
  if (!levels.length) return null;
  const out = [
    '# Streaming',
    '',
    'How each big map is cut into cells the game loads as the player nears them, as planned in VC Game Studio. Cell A1 is the north-west one: letters go east, numbers south. Positions are metres in the level’s space (x east, z south), as in the levels data. The counts are the studio’s estimates from the graybox; profile the real cells.',
    '',
  ];
  for (const l of levels) {
    const s = l.streaming!;
    const names = new Map(l.items.map((i) => [i.guid, i.export_name]));
    const list = (ids: readonly string[]) => (ids.length ? ids.map((id) => `\`${names.get(id) ?? id}\``).join(', ') : '—');
    out.push(`## ${l.name} · ${nameOf(l)}`, '', `${s.cols} × ${s.rows} cells of ${s.cell} m from (${s.origin[0]}, ${s.origin[1]}); cells within ${s.load_range} m of the player's cell stay loaded.`, '');
    for (const line of howTo(engine, s.cell, s.load_range)) out.push(`- ${line}`);
    out.push('', `**Always loaded:** ${list(s.always)}`, '', '**Loaded at once, at the worst:**', '');
    for (const w of s.worst) out.push(`- ${METRICS.find((m) => m.id === w.metric)?.label ?? w.metric}: ${countLabel(w.count)} (round ${w.around})`);
    out.push('', '| Cell | x0, z0 → x1, z1 | Items | Triangles |', '|---|---|---|---:|');
    for (const c of s.cells.filter((c) => c.items.length)) out.push(`| ${c.key} | ${c.bounds[0]}, ${c.bounds[1]} → ${c.bounds[2]}, ${c.bounds[3]} | ${list(c.items)} | ${countLabel(c.counts.triangles ?? 0)} |`);
    const empty = s.cells.filter((c) => !c.items.length).map((c) => c.key);
    if (empty.length) out.push('', `Empty cells: ${empty.join(', ')}.`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
};
