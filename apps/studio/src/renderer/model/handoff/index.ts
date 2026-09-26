import { findIssues } from '../validate';
import type { EngineId, EngineTarget, ExportRecord, Project } from '../types';
import type { EngineAdapter, ElementOutput, EngineOutput } from './engines';
import { godot } from './godot';
import { buildIR } from './ir';

/**
 * Every engine VC Game Studio will hand off to. Godot is first; the others
 * are listed with their plan so the picker, the target and the export record
 * already work for them. Adding one is one adapter file.
 */
export const ENGINES: readonly EngineAdapter[] = [
  godot,
  {
    id: 'unity',
    name: 'Unity 6',
    language: 'C# · ScriptableObjects',
    available: false,
    defaultOutputPath: 'Assets/VCGS/Generated',
    runtimeName: 'VCGS Runtime for Unity',
    setup: [],
    plan: 'ScriptableObject assets for characters, items and scenes; C# for choices and rules.',
  },
  {
    id: 'unreal',
    name: 'Unreal Engine 5',
    language: 'C++ · Data Assets + Blueprints',
    available: false,
    defaultOutputPath: 'Content/VCGS/Generated',
    runtimeName: 'VCGS Runtime plugin for Unreal',
    setup: [],
    plan: 'Data Assets and Data Tables, with Blueprint-callable functions for choices and rules.',
  },
  {
    id: 'custom',
    name: 'Custom engine',
    language: 'JSON + schema',
    available: false,
    defaultOutputPath: 'vcgs',
    runtimeName: 'JSON schema',
    setup: [],
    plan: 'The handoff model itself as JSON, with a schema, for any engine to read.',
  },
];

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
}

/** What handing the project to its engine would produce right now, and how that compares with last time. */
export const planHandoff = (project: Project): Handoff => {
  const target = targetOf(project);
  const adapter = engineById(target.engine);
  if (!adapter.available || !adapter.generate) return { adapter, target, output: null, rows: [], changed: 0, issues: [], blocking: [] };
  const output = adapter.generate(buildIR(project), target.outputPath);
  const last = project.handoff?.last?.engine === target.engine ? project.handoff.last : undefined;
  const found = findIssues(project);
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
  return { adapter, target, output, rows, changed: rows.filter((r) => r.status !== 'ready').length, issues, blocking };
};

/** Remember what was sent, so the next look can say what changed since. Not an undoable edit. */
export const recordExport = (project: Project, handoff: Handoff, at = new Date().toISOString()): Project => {
  if (!handoff.output) return project;
  const last: ExportRecord = {
    at,
    engine: handoff.target.engine,
    fingerprints: Object.fromEntries(handoff.output.elements.map((e) => [e.id, e.fingerprint])),
    files: handoff.output.files.length,
  };
  return { ...project, handoff: { target: handoff.target, last } };
};

export type { EngineAdapter, ElementOutput, EngineOutput } from './engines';
