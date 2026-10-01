/**
 * Write the sample project's Godot handoff into a folder, for checking the
 * generated code with a real engine (custom code already in the files is kept): `npx vite-node scripts/export-sample.ts <dir> [godot|unity|custom] [puzzles]`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { keepCustom, planHandoff, setTarget } from '../src/renderer/model/handoff';
import type { EngineId } from '../src/renderer/model/types';
import { sunkenVault } from '../src/renderer/model/sample';
import { BUILT_IN_TEMPLATES, puzzleFromTemplate } from '../src/renderer/model/puzzle/templates';
import { nodesOf, updateNode } from '../src/renderer/model/puzzle/design';
import type { Project } from '../src/renderer/model/types';

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

const dir = process.argv[2];
if (!dir) throw new Error('Usage: export-sample.ts <godot project folder>');
const engine = (process.argv[3] ?? 'godot') as EngineId;
const base = process.argv[4] === 'puzzles' ? withPuzzles(sunkenVault()) : sunkenVault();
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
