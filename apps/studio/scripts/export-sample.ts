/**
 * Write the sample project's Godot handoff into a folder, for checking the
 * generated code with a real engine (custom code already in the files is kept): `npx vite-node scripts/export-sample.ts <dir> [godot|unity|custom]`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { keepCustom, planHandoff, setTarget } from '../src/renderer/model/handoff';
import type { EngineId } from '../src/renderer/model/types';
import { sunkenVault } from '../src/renderer/model/sample';

const dir = process.argv[2];
if (!dir) throw new Error('Usage: export-sample.ts <godot project folder>');
const engine = (process.argv[3] ?? 'godot') as EngineId;
const plan = planHandoff(setTarget(sunkenVault(), { engine }));
for (const file of plan.output!.files) {
  const path = join(dir, file.path);
  mkdirSync(dirname(path), { recursive: true });
  // As the studio sends to a folder: the custom code already in a generated file is kept.
  const before = file.kind === 'generated' && existsSync(path) ? readFileSync(path, 'utf8') : null;
  writeFileSync(path, keepCustom(file.content, before).content);
}
console.log(`${plan.output!.files.length} files, ${plan.rows.length} elements, ${plan.issues.length} issues`);
for (const r of plan.rows) console.log(`${r.status.padEnd(8)} ${r.group.padEnd(15)} ${r.label.padEnd(26)} ${r.generates}`);
