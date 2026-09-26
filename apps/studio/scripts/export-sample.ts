/**
 * Write the sample project's Godot handoff into a folder, for checking the
 * generated code with a real Godot: `npx vite-node scripts/export-sample.ts <dir>`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { planHandoff } from '../src/renderer/model/handoff';
import { sunkenVault } from '../src/renderer/model/sample';

const dir = process.argv[2];
if (!dir) throw new Error('Usage: export-sample.ts <godot project folder>');
const plan = planHandoff(sunkenVault());
for (const file of plan.output!.files) {
  const path = join(dir, file.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.content);
}
console.log(`${plan.output!.files.length} files, ${plan.rows.length} elements, ${plan.issues.length} issues`);
for (const r of plan.rows) console.log(`${r.status.padEnd(8)} ${r.group.padEnd(15)} ${r.label.padEnd(26)} ${r.generates}`);
