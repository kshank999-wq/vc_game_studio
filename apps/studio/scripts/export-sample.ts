/**
 * Write the sample project's Godot handoff into a folder, for checking the
 * generated code with a real engine (custom code already in the files is kept): `npx vite-node scripts/export-sample.ts <dir> [godot|unity|custom] [puzzles]`.
 */
import { addTransition, levelBands } from '../src/renderer/model/level-lane';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { keepCustom, planHandoff, setTarget } from '../src/renderer/model/handoff';
import type { EngineId } from '../src/renderer/model/types';
import { sunkenVault } from '../src/renderer/model/sample';
import { BUILT_IN_TEMPLATES, puzzleFromTemplate } from '../src/renderer/model/puzzle/templates';
import { nodesOf, updateNode } from '../src/renderer/model/puzzle/design';
import type { Project } from '../src/renderer/model/types';
import { addSubScene } from '../src/renderer/model/subscene';
import { addSampleCast } from '../src/renderer/model/character/samples';
import { groupsOf } from '../src/renderer/model/character/groups';
import { characters, profileOf, updateProfile } from '../src/renderer/model/character/profile';
import { generateVariants } from '../src/renderer/model/character/variants';
import { frameOf } from '../src/renderer/model/level/geometry';
import { buildCell } from '../src/renderer/model/level/holding';
import { levelsOf, placeAsset, resizeItem, setParam } from '../src/renderer/model/level/level';
import { buildIR } from '../src/renderer/model/handoff/ir';
import { runScenario } from '../src/renderer/model/handoff/cast';
import { tombWalk, withTomb } from '../src/renderer/model/level/sample-structure';
import { setCapture, setUpCapture } from '../src/renderer/model/capture';
import { setData } from '../src/renderer/model/details';

/**
 * With "puzzles": the sample and the built-in puzzle templates (puzzle spec
 * §7–§10), to check the runtimes' puzzle steps, hints, cues and screens: the
 * Safe code (a keypad, clues, hints), Plates in order (a sequence, given 10
 * seconds) and Lever and door (a step needing another first).
 */
const withPuzzles = (project: Project): Project => {
  let p = project;
  for (const id of ['builtin.safe', 'builtin.plates', 'builtin.lever']) {
    const made = puzzleFromTemplate(p, BUILT_IN_TEMPLATES.find((t) => t.id === id)!);
    p = made.project;
    if (id === 'builtin.plates') {
      const seq = nodesOf(p.objects[made.id]).find((n) => n.gate === 'sequence')!;
      p = updateNode(p, made.id, seq.id, { within: 10 });
    }
  }
  return p;
};

/**
 * With "rooms": the sample with rooms in SC-01 The Cave Mouth (The Study,
 * and The Closet inside it), to check the runtimes play rooms: Where now?,
 * into a room and back, and out; and a transition cinematic between its
 * two levels, to check the runtimes play it as the player crosses.
 */
const withRooms = (project: Project): Project => {
  const cave = Object.values(project.objects).find((o) => o.type === 'scene' && o.name === 'The Cave Mouth')!;
  const study = addSubScene(project, cave.id, 'The Study')!;
  const rooms = addSubScene(study.project, study.id, 'The Closet')!.project;
  // And the transition between the sample's two levels: a cinematic as the player crosses from the cave into the vault.
  return addTransition(rooms, levelBands(rooms)[0]!.id)!.project;
};

/**
 * With "cast": the sample with the Character Creator's sample cast (character
 * spec §8): Village Market spread over The Cave Mouth, and an Orc Sentry on a
 * patrol beside it; and cast_expect.json, the studio's own AI machine run on
 * set scenarios, for each engine's port to match line for line.
 */
const withCast = (project: Project): Project => {
  let p = addSampleCast(project).project;
  const set = levelsOf(p);
  const level = set.levels[0]!;
  const floor = level.floors[0]!.id;
  const cave = set.items.find((i) => i.levelId === level.id && i.name === 'Cave Mouth') ?? set.items.find((i) => i.levelId === level.id)!;
  const f = frameOf(set, cave);
  const area = placeAsset(p, level.id, floor, 'actor.group', { x: f.x, y: f.y });
  p = setParam(area.project, area.ids[0]!, 'group', groupsOf(area.project).find((g) => g.name === 'Village Market')!.id);
  p = resizeItem(p, area.ids[0]!, { w: 10, d: 10 });
  const orc = placeAsset(p, level.id, floor, 'actor.enemy', { x: f.x + 3, y: f.y + 3 });
  p = setParam(orc.project, orc.ids[0]!, 'character', characters(orc.project).find((c) => c.name === 'Orc Sentry')!.id);
  p = setParam(p, orc.ids[0]!, 'patrol', 'Yard');
  for (const [i, at] of [{ x: f.x + 3, y: f.y + 3 }, { x: f.x + 3, y: f.y - 2 }].entries()) {
    const node = placeAsset(p, level.id, floor, 'actor.patrol', at);
    p = setParam(node.project, node.ids[0]!, 'path', 'Yard');
    p = setParam(p, node.ids[0]!, 'order', i + 1);
  }
  // Two variants of the Orc Sentry (an Elite and a Champion), resolved as whole characters in characters.json.
  const sentry = characters(p).find((c) => c.name === 'Orc Sentry')!;
  p = updateProfile(p, sentry.id, (prof) => ({ ...prof, variants: generateVariants(p, profileOf(sentry), 'Orc Sentry', 2) }));
  return p;
};

const scenarios = (project: Project) => {
  const cast = buildIR(project).cast!;
  const orc = cast.characters.find((c) => c.name === 'Orc Sentry')!;
  const lurker = cast.characters.find((c) => c.name === 'Lurking Orc')!;
  const base = { patrol: [[0, 0], [10, 0]] as [number, number][], walls: [] as [[number, number], [number, number]][], dt: 0.1 };
  return [
    runScenario(orc, { ...base, name: 'sees, reacts, chases, attacks', target: { x: 8, y: 0, vx: 0, vy: 0, noisy: false }, steps: 60 }),
    runScenario(orc, { ...base, name: 'disengages when outrun', target: { x: 8, y: 0, vx: 0.75, vy: 0, noisy: false }, steps: 300 }),
    runScenario(orc, { ...base, name: 'hears behind it, investigates', target: { x: -5, y: 0, vx: 0, vy: 0, noisy: true }, steps: 80 }),
    runScenario(orc, { ...base, name: 'blind behind a wall', walls: [[[4, -3], [4, 3]]], target: { x: 8, y: 0, vx: 0, vy: 0, noisy: false }, steps: 30 }),
    runScenario(lurker, { ...base, name: 'proximity aggro', target: { x: -1.5, y: 1, vx: 0, vy: 0, noisy: false }, steps: 40 }),
  ];
};

/**
 * With "capture": the sample with capture set up (a Holding cell off the
 * spine, the Evidence locker in it, Times captured and Health), the Eel swarm
 * capturing the player who loses to it, and the Orc Sentry a captor. To check
 * the runtimes: captured, searched, out of the cell, things back from the
 * locker, and back in The Key past the fight.
 */
const withCapture = (project: Project): Project => {
  let p = addSampleCast(setUpCapture(project)).project;
  p = setData(p, Object.values(p.objects).find((o) => o.name === 'Eel swarm')!.id, { onLose: 'Captured' });
  p = setCapture(p, { captors: [characters(p).find((c) => c.name === 'Orc Sentry')!.id] });
  // The cell built in the first level (level/holding.ts): a room linked to the holding cell, its door the escape puzzle's Cell door, the Orc Sentry patrolling outside.
  return buildCell(p, levelsOf(p).levels[0]!.id);
};

const dir = process.argv[2];
if (!dir) throw new Error('Usage: export-sample.ts <godot project folder>');
const engine = (process.argv[3] ?? 'godot') as EngineId;
const tomb = process.argv[4] === 'structure' ? withTomb(sunkenVault()) : null;
const base = process.argv[4] === 'puzzles' ? withPuzzles(sunkenVault()) : process.argv[4] === 'rooms' ? withRooms(sunkenVault()) : process.argv[4] === 'cast' ? withCast(sunkenVault()) : process.argv[4] === 'capture' ? withCapture(sunkenVault()) : tomb ? tomb.project : sunkenVault();
// The project exactly as exported (its GUIDs are new each time the sample is made), for the round-trip check to read changes against.
mkdirSync(dir!, { recursive: true });
writeFileSync(join(dir!, 'project.json'), JSON.stringify(base));
if (process.argv[4] === 'cast') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cast_expect.json'), JSON.stringify({ scenarios: scenarios(base) }, null, 2));
}
if (tomb) {
  // The walk through the Old Tomb, as the studio's Play Mode plays it: each engine must say and do the same.
  const level = buildIR(tomb.project).levels.find((l) => l.guid === tomb.id)!;
  const flag = String(level.structure!.on_complete![0]!.ref);
  mkdirSync(dir, { recursive: true });
  // The story's keys the engines use: the flag's from the tomb's completion, the items' from what gives them.
  const itemKey = (guid: string) => String(level.items.find((i) => i.guid === guid)!.params.item);
  const keys: Record<string, string> = { [tomb.plundered]: flag, [tomb.key]: itemKey(tomb.keyPickup), [tomb.idol]: itemKey(tomb.parts.chest) };
  writeFileSync(join(dir, 'structure_expect.json'), JSON.stringify({ level: level.key, scene: `${level.key}.tscn`, export_name: level.export_name, steps: tombWalk(tomb, (id) => keys[id] ?? id) }, null, 2));
}
const plan = planHandoff(setTarget(base, { engine }));
for (const file of plan.output!.files) {
  const path = join(dir, file.path);
  mkdirSync(dirname(path), { recursive: true });
  // As the studio sends to a folder: the custom code already in a generated file is kept.
  const before = file.kind === 'generated' && existsSync(path) ? readFileSync(path, 'utf8') : null;
  writeFileSync(path, keepCustom(file.content, before).content);
}
console.log(`${plan.output!.files.length} files, ${plan.rows.length} elements, ${plan.issues.length} issues`);
for (const r of plan.rows) console.log(`${r.status.padEnd(8)} ${r.group.padEnd(15)} ${r.label.padEnd(26)} ${r.generates}`);
