/**
 * Read an engine's vcgs-changes.json against the sample, as the studio's
 * Bring back changes does, and check it finds what the engine check changed
 * there: Mara moved 2 m east and turned, the Vault Key renamed, the Camp
 * embers deleted, a CameraHint added. `npx vite-node scripts/read-changes.ts <changes.json> <project.json>`.
 */
import { readFileSync } from 'node:fs';
import { applyChanges, changesFrom, describeChange, parseChanges } from '../src/renderer/model/handoff/changes';
import { itemById, levelsOf } from '../src/renderer/model/level/level';
import type { Project } from '../src/renderer/model/types';

const file = parseChanges(readFileSync(process.argv[2]!, 'utf8'));
if (typeof file === 'string') throw new Error(file);
// The project as export-sample.ts exported it (beside the changes file).
const project = JSON.parse(readFileSync(process.argv[3]!, 'utf8')) as Project;
const changes = changesFrom(project, file);
for (const c of changes) console.log(`changes: ${c.kind} · ${describeChange(c)}`);
const fail = (why: string) => {
  console.error(`FAIL: ${why}`);
  process.exit(1);
};
const of = (kind: string, name: string) => changes.find((c) => c.kind === kind && c.name === name);
const moved = of('moved', 'Mara');
if (!moved || moved.kind !== 'moved') fail('Mara should have moved');
else {
  const was = itemById(project, moved.id)!;
  if (Math.abs(moved.to.x - was.x - 2) > 0.01 || Math.abs(moved.to.y - was.y) > 0.01) fail(`Mara should be 2 m east, got ${JSON.stringify(moved.to)} from ${was.x}, ${was.y}`);
  if (Math.abs(((((moved.to.rotation - was.rotation) % 360) + 360) % 360) - 270) > 0.5) fail(`Mara should have turned 90° counter-clockwise (rotation −90), got ${moved.to.rotation} from ${was.rotation}`);
}
const renamed = of('renamed', 'Vault Key');
if (!renamed || renamed.kind !== 'renamed' || renamed.to !== 'KeyOfTheVault') fail('the Vault Key should be renamed KeyOfTheVault');
if (!of('deleted', 'Camp embers')) fail('the Camp embers should be deleted');
if (!of('added', 'CameraHint')) fail('the CameraHint should be added');
if (changes.length !== 4) fail(`exactly four changes, got ${changes.length}`);
const after = applyChanges(project, changes);
if (!levelsOf(after).items.some((i) => i.name === 'CameraHint')) fail('the CameraHint should come in');
console.log('changes OK');
