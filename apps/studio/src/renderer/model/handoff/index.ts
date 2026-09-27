import { findIssues } from '../validate';
import type { EngineId, EngineTarget, ExportRecord, Project } from '../types';
import { fingerprint, type EngineAdapter, type ElementOutput, type EngineOutput } from './engines';
import { godot } from './godot';
import { json } from './json';
import { unity } from './unity';
import { unreal } from './unreal';
import { buildIR } from './ir';
import { levelChanges, type IrLevel, type LevelChanges } from './levels';
import { levelIssues } from '../level/validate';

/**
 * Every engine VC Game Studio hands off to: Godot, Unity, Unreal, and plain
 * JSON for any other engine. Adding one is one adapter file.
 */
export const ENGINES: readonly EngineAdapter[] = [godot, unity, unreal, json];

export const engineById = (id: EngineId): EngineAdapter => ENGINES.find((e) => e.id === id) ?? godot;

export const defaultTarget = (engine: EngineId = 'godot'): EngineTarget => ({
  engine,
  projectFolder: '',
  outputPath: engineById(engine).defaultOutputPath,
  exportOnSave: false,
});

export const targetOf = (project: Project): EngineTarget => project.handoff?.target ?? defaultTarget();

export const setTarget = (project: Project, patch: Partial<EngineTarget>): Project => {
  const current = targetOf(project);
  let next = { ...current, ...patch };
  // Picking another engine moves the output to that engine's usual place.
  if (patch.engine && patch.engine !== current.engine && patch.outputPath === undefined) next = { ...next, outputPath: engineById(patch.engine).defaultOutputPath };
  if (JSON.stringify(next) === JSON.stringify(current)) return project;
  return { ...project, handoff: { ...(project.handoff ?? {}), target: next } };
};

export type Status = 'ready' | 'changed' | 'issue';

export interface Row extends ElementOutput {
  status: Status;
  issue?: string;
}

export interface Handoff {
  adapter: EngineAdapter;
  target: EngineTarget;
  output: EngineOutput | null;
  rows: Row[];
  changed: number;
  issues: { id: string; message: string; sceneId?: string }[];
  /** Problems that would break the generated code: two elements that come out with the same name. */
  blocking: string[];
  /** The levels as they go to the engine, and what changed in them since the last export. */
  levels: IrLevel[];
  levelChanges: LevelChanges;
}

/** What handing the project to its engine would produce right now, and how that compares with last time. */
export const planHandoff = (project: Project): Handoff => {
  const target = targetOf(project);
  const adapter = engineById(target.engine);
  if (!adapter.available || !adapter.generate) return { adapter, target, output: null, rows: [], changed: 0, issues: [], blocking: [], levels: [], levelChanges: { added: [], changed: [], removed: [], same: 0 } };
  const ir = buildIR(project);
  const output = adapter.generate(ir, target.outputPath, { placeholderScenes: target.placeholderScenes !== false });
  const last = project.handoff?.last?.engine === target.engine ? project.handoff.last : undefined;
  // The levels' preflight counts too: an item's issue is shown on its level's row.
  const levelOf = new Map(ir.levels.flatMap((l) => l.items.map((i) => [i.guid, l.guid] as const)));
  const found = [
    ...findIssues(project),
    ...levelIssues(project, undefined, target.engine)
      .filter((i) => i.severity === 'error' || i.engine)
      .map((i) => ({ id: levelOf.get(i.id) ?? i.levelId, message: i.message })),
  ];
  const issueOf = new Map(found.map((i) => [i.id, i.message]));
  const rows: Row[] = output.elements.map((e) => {
    const issue = issueOf.get(e.id);
    const status: Status = issue ? 'issue' : last?.fingerprints[e.id] === e.fingerprint ? 'ready' : 'changed';
    return { ...e, status, ...(issue ? { issue } : {}) };
  });
  const sceneOf = (id: string) => project.connections.find((c) => c.kind === 'contains' && c.targetId === id)?.sourceId;
  const issues = found
    .filter((i) => rows.some((r) => r.id === i.id) || project.objects[i.id])
    .map((i) => ({ ...i, ...(sceneOf(i.id) ? { sceneId: sceneOf(i.id) } : {}) }));
  // Two files at one path would overwrite each other; say so before sending.
  const seen = new Map<string, number>();
  for (const f of output.files) seen.set(f.path, (seen.get(f.path) ?? 0) + 1);
  const blocking = [...seen.entries()].filter(([, n]) => n > 1).map(([path]) => `Two elements would both write ${path}. Rename one of them.`);
  return {
    adapter,
    target,
    output,
    rows,
    changed: rows.filter((r) => r.status !== 'ready').length,
    issues,
    blocking,
    levels: ir.levels,
    levelChanges: levelChanges(ir.levels, last?.levelItems),
  };
};

/**
 * Generated files changed in the engine since the last export (spec §11.4):
 * what is on disk now is neither what was written last time nor what would
 * be written now. VC Game Studio owns these files; the choice to overwrite or
 * keep the engine's version is the person's, never silent.
 */
export const engineEdits = (handoff: Handoff, last: ExportRecord | undefined, onDisk: Record<string, string | null>): string[] => {
  if (!handoff.output || !last?.fileHashes) return [];
  return handoff.output.files
    .filter((f) => f.kind === 'generated')
    .filter((f) => {
      const was = last.fileHashes![f.path];
      const now = onDisk[f.path];
      return was !== undefined && typeof now === 'string' && fingerprint(now) !== was && now !== f.content;
    })
    .map((f) => f.path);
};

/**
 * Remember what was sent, so the next look can say what changed since. Not an
 * undoable edit. Files left as the engine had them keep the hash of what was
 * written before, so they are pointed out again next time.
 */
export const recordExport = (project: Project, handoff: Handoff, at = new Date().toISOString(), kept: readonly string[] = []): Project => {
  if (!handoff.output) return project;
  const before = project.handoff?.last?.fileHashes ?? {};
  const last: ExportRecord = {
    at,
    engine: handoff.target.engine,
    fingerprints: Object.fromEntries(handoff.output.elements.map((e) => [e.id, e.fingerprint])),
    files: handoff.output.files.length,
    levelItems: Object.fromEntries(handoff.levels.flatMap((l) => l.items.map((i) => [i.guid, i.revision]))),
    fileHashes: Object.fromEntries(
      handoff.output.files.filter((f) => f.kind === 'generated').map((f) => [f.path, kept.includes(f.path) && before[f.path] ? before[f.path]! : fingerprint(f.content)]),
    ),
  };
  return { ...project, handoff: { target: handoff.target, last } };
};

export type { EngineAdapter, ElementOutput, EngineOutput } from './engines';
