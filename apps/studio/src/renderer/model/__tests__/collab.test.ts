import { describe, expect, it } from 'vitest';
import {
  addComment,
  allComments,
  canRestore,
  changedSinceExport,
  commentsOn,
  describeRevision,
  describeTarget,
  historyOf,
  lastChange,
  MERGE_MS,
  openCount,
  recordEdits,
  removeComment,
  replyTo,
  restoreBefore,
  setDone,
  type Who,
} from '../collab';
import { levelsOf } from '../level/level';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const ana: Who = { name: 'Ana', role: 'writer' };
const ben: Who = { name: 'Ben', role: 'level' };

const byName = (p: Project, name: string) => Object.values(p.objects).find((o) => o.name === name)!;
const rename = (p: Project, id: string, name: string): Project => ({ ...p, objects: { ...p.objects, [id]: { ...p.objects[id]!, name, modified: 'x' } } });
const setData = (p: Project, id: string, key: string, value: unknown): Project => ({ ...p, objects: { ...p.objects, [id]: { ...p.objects[id]!, data: { ...p.objects[id]!.data, [key]: value } } } });

describe('edit history', () => {
  it('records who changed what in each thing, and brings back an earlier version', () => {
    const p0 = sunkenVault();
    const key = byName(p0, 'Vault Key');
    const t = { kind: 'object' as const, id: key.id };
    const p1 = recordEdits(p0, rename(p0, key.id, 'Bronze Key'), ana, 1_000_000);
    expect(historyOf(p1, t)).toHaveLength(1);
    expect(historyOf(p1, t)[0]).toMatchObject({ kind: 'changed', changes: ['name'], by: ana, at: 1_000_000 });
    expect(describeRevision(historyOf(p1, t)[0]!)).toBe('Changed name');
    // The same person again, soon after: one revision, what changed added, what it was before kept.
    const p2 = recordEdits(p1, setData(p1, key.id, 'summary', 'Heavy.'), ana, 1_000_000 + 60_000);
    expect(historyOf(p2, t)).toHaveLength(1);
    expect(historyOf(p2, t)[0]!.changes).toEqual(['name', 'summary']);
    // Someone else: a revision of their own.
    const p3 = recordEdits(p2, rename(p2, key.id, 'Old Key'), ben, 1_000_000 + 120_000);
    expect(historyOf(p3, t).map((r) => r.by.name)).toEqual(['Ben', 'Ana']);
    expect(lastChange(p3, t)!.by).toEqual(ben);
    // Later, the same person: a new revision.
    const p4 = recordEdits(p3, rename(p3, key.id, 'Key'), ben, 1_000_000 + 120_000 + MERGE_MS + 1);
    expect(historyOf(p4, t)).toHaveLength(3);
    // Bring back what it was before Ana's edits: the original name and no summary.
    const ana1 = historyOf(p4, t).at(-1)!;
    expect(canRestore(p4, t, ana1)).toBe(true);
    const back = restoreBefore(p4, t, ana1.id);
    expect(back.objects[key.id]!.name).toBe('Vault Key');
    expect(back.objects[key.id]!.data.summary).toBe(key.data.summary);
    // Nothing else changed: only modified.
    expect(recordEdits(p0, { ...p0, objects: { ...p0.objects, [key.id]: { ...key, modified: 'later' } } }, ana).revisions).toBeUndefined();
  });

  it('follows creation and deletion, connections, level items and a scene’s script', () => {
    const p0 = sunkenVault();
    const set = levelsOf(p0);
    const item = set.items.find((i) => i.name === 'Mara')!;
    const moved: Project = { ...p0, levels: { ...set, items: set.items.map((i) => (i.id === item.id ? { ...i, x: i.x + 1, params: { ...i.params, speed: 2 } } : i)) } };
    const p1 = recordEdits(p0, moved, ben, 5);
    expect(historyOf(p1, { kind: 'levelItem', id: item.id })[0]!.changes).toEqual(['position', 'speed']);

    const branch = p0.connections.find((c) => c.kind === 'branch' && c.label)!;
    const p2 = recordEdits(p1, { ...p1, connections: p1.connections.filter((c) => c.id !== branch.id) }, ana, 10);
    const ct = { kind: 'connection' as const, id: branch.id };
    expect(historyOf(p2, ct)[0]!.kind).toBe('deleted');
    expect(describeTarget(p2, ct)).toMatchObject({ exists: false });
    const back = restoreBefore(p2, ct, historyOf(p2, ct)[0]!.id);
    expect(back.connections.find((c) => c.id === branch.id)).toEqual(branch);

    const newObj = { ...byName(p0, 'Vault Key'), id: 'obj_new', name: 'Rope' };
    const p3 = recordEdits(p2, { ...p2, objects: { ...p2.objects, obj_new: newObj } }, ana, 20);
    const created = historyOf(p3, { kind: 'object', id: 'obj_new' })[0]!;
    expect(created.kind).toBe('created');
    expect(canRestore(p3, { kind: 'object', id: 'obj_new' }, created)).toBe(false);

    const line = p0.lines[0]!;
    const p4 = recordEdits(p3, { ...p3, lines: p3.lines.map((l) => (l.id === line.id ? { ...l, text: 'Changed.' } : l)) }, ana, 30);
    expect(historyOf(p4, { kind: 'object', id: line.sceneId })[0]!.changes).toEqual(['script']);
  });

  it('says what changed since the last export', () => {
    const p0 = { ...sunkenVault(), handoff: { target: { engine: 'godot' as const, projectFolder: '', outputPath: 'vcgs', exportOnSave: false }, last: { at: new Date(1000).toISOString(), engine: 'godot' as const, fingerprints: {}, files: 1 } } };
    const key = byName(p0, 'Vault Key');
    const before = recordEdits(p0, rename(p0, key.id, 'A'), ana, 500);
    expect(changedSinceExport(before)).toEqual([]);
    const after = recordEdits(before, rename(before, key.id, 'B'), ben, 2000);
    expect(changedSinceExport(after).map((e) => e.target.id)).toEqual([key.id]);
  });
});

describe('comments and tasks', () => {
  it('come with the sample: a task on the key, a comment on a branch with a reply, a task on a level item', () => {
    const p = sunkenVault();
    expect(allComments(p).map((c) => [c.kind, describeTarget(p, c.target).label])).toEqual([
      ['task', 'Mara'],
      ['comment', 'Pocket it (Pocket the ring → Heavy Pockets)'],
      ['task', 'ITM-01 Vault Key'],
    ]);
  });

  it('hang off anything, take replies, and are done or opened again', () => {
    const p0 = { ...sunkenVault(), comments: [] };
    const scene = byName(p0, 'The Vault Door');
    const t = { kind: 'object' as const, id: scene.id };
    const a = addComment(p0, t, '  Is the door too easy?  ', ana, {}, 1);
    const b = addComment(a.project, t, 'Add a creak to the door', ana, { kind: 'task', for: 'audio' }, 2);
    const c = addComment(b.project, { kind: 'code', id: 'vcgs/scripts/sc_03.gd' }, 'Hand-tuned timing here', ben, { kind: 'task', for: 'gameplay' }, 3);
    let p = replyTo(c.project, a.id, 'A little.', ben, 4);
    expect(commentsOn(p, t).map((x) => x.text)).toEqual(['Is the door too easy?', 'Add a creak to the door']);
    expect(commentsOn(p, t)[0]!.replies![0]).toMatchObject({ text: 'A little.', by: ben });
    expect(openCount(p, t)).toBe(2);
    // Tasks for audio: the audio task, and comments; not the gameplay task.
    expect(allComments(p, { role: 'audio', tasksOnly: true }).map((x) => x.text)).toEqual(['Add a creak to the door']);
    expect(allComments(p).map((x) => x.text)).toEqual(['Hand-tuned timing here', 'Add a creak to the door', 'Is the door too easy?']);
    p = setDone(p, b.id, true, { name: 'Cai', role: 'audio' }, 5);
    expect(openCount(p, t)).toBe(1);
    expect(allComments(p).map((x) => x.id)).not.toContain(b.id);
    expect(allComments(p, { done: true }).at(-1)!.id).toBe(b.id);
    p = setDone(p, b.id, false, ana, 6);
    expect(p.comments!.find((x) => x.id === b.id)!.done).toBeUndefined();
    expect(describeTarget(p, { kind: 'code', id: 'vcgs/scripts/sc_03.gd' })).toMatchObject({ label: 'sc_03.gd', exists: true });
    expect(removeComment(p, c.id).comments).toHaveLength(2);
    // Comments are not edits to the thing: they add nothing to its history.
    expect(recordEdits(p0, p, ana).revisions).toBeUndefined();
  });
});

describe('comments and tasks in the engines', () => {
  it('go to every engine as TASKS.md and TODO lines beside what they are about; comments on a file go at its top', async () => {
    const { buildIR } = await import('../handoff/ir');
    const { generateGodot } = await import('../handoff/godot');
    const { generateUnity } = await import('../handoff/unity');
    const { generateUnreal } = await import('../handoff/unreal');
    const { json } = await import('../handoff/json');
    let p = sunkenVault();
    // A done task stays out; a comment on a generated file goes in it.
    const done = addComment(p, { kind: 'object', id: byName(p, 'Mara').id }, 'Done already', ana, { kind: 'task' }, 2);
    p = setDone(done.project, done.id, true, ana);
    p = addComment(p, { kind: 'code', id: 'vcgs/generated/levels/sunken_vault.gd' }, 'Hand-tuned: keep the patrol speed', ben, { kind: 'task', for: 'gameplay' }, 3).project;
    const ir = buildIR(p);
    expect(ir.notes.map((n) => n.text)).not.toContain('Done already');
    const key = ir.notes.find((n) => n.on.kind === 'object' && n.on.key === 'vault_key')!;
    expect(key).toMatchObject({ kind: 'task', for: 'audio', by: 'Ana (Writer)', on: { type: 'VaultKey', name: 'ITM-01 Vault Key' } });
    expect(ir.notes.find((n) => n.on.kind === 'connection')!.replies).toEqual([{ by: 'Ana (Writer)', text: 'That is the point: it should cost them later.' }]);

    const godot = generateGodot(ir, 'res://vcgs/generated');
    const tasks = godot.files.find((f) => f.path === 'vcgs/generated/TASKS.md')!.content;
    expect(tasks).toContain('- [ ] Task for Audio: The key needs a heavy bronze clink when it is picked up. (Ana (Writer)) · 2026-09-02');
    expect(tasks).toContain('  - Ana (Writer): That is the point: it should cost them later.');
    const level = godot.files.find((f) => f.path === 'vcgs/generated/levels/sunken_vault.gd')!.content;
    expect(level.split('\n')[0]).toBe('# TODO(VCGS) Task for Gameplay programmer: Hand-tuned: keep the patrol speed (Ben (Level designer))');
    expect(level).toMatch(/# NPC_\w+_Mara_\d+: TODO\(VCGS\) Task for Gameplay programmer: Mara should turn to face the player when spoken to\. \(Ben \(Level designer\)\)/);
    expect(godot.elements.find((e) => e.id === 'tasks')!.label).toBe('Comments and tasks (4)');

    const unity = generateUnity(ir, 'Assets/VCGS/Generated');
    const keys = unity.files.find((f) => f.path.endsWith('StoryKeys.cs'))!.content;
    expect(keys).toMatch(/\/\/ TODO\(VCGS\) Task for Audio: The key needs a heavy bronze clink when it is picked up\. \(Ana \(Writer\)\)\n\s+public const string VaultKey = "vault_key";/);
    expect(JSON.parse(unity.files.find((f) => f.path.endsWith('story.json'))!.content).notes).toEqual([]);
    expect(unity.files.some((f) => f.path === 'Assets/VCGS/Generated/TASKS.md')).toBe(true);

    const unreal = generateUnreal(ir, 'Content/VCGS/Generated');
    expect(unreal.files.find((f) => f.path.endsWith('VcgsStoryKeys.h'))!.content).toMatch(/\/\/ TODO\(VCGS\) Task for Audio: .+\n\s+constexpr const TCHAR\* VaultKey/);
    expect(unreal.files.find((f) => f.path.endsWith('TASKS.md'))!.content).toMatch(/Mara · `NPC_\w+ \(AVcgsLevelItem, Guid /);

    const story = JSON.parse(json.generate!(ir, 'vcgs').files[0]!.content);
    expect(story.notes).toHaveLength(4);

    // A comment changes TASKS.md and the TODO lines, not what the story rows say changed.
    const plain = buildIR({ ...p, comments: [] });
    const rows = (out: typeof unity) => Object.fromEntries(out.elements.filter((e) => e.id !== 'tasks').map((e) => [e.id, e.fingerprint]));
    expect(rows(generateUnity(plain, 'Assets/VCGS/Generated'))).toEqual(rows(unity));
  });
});
