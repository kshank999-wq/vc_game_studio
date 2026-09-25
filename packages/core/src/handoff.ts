/**
 * VC Writer → VC Game Studio handoff contract.
 *
 * Game Studio binds authored nodes to engine constructs. Each binding keeps
 * a hash of the authored node as it was when bound, so later narrative edits
 * surface as "needs-update" instead of silently breaking the implementation.
 */

import { indexProject, type NodeKind } from "./project-index.js";
import type { GameProject, Id } from "./schema.js";

export type EngineId = "godot" | "unity" | "unreal" | (string & {});

export type BindingStatus = "unbound" | "partial" | "implemented" | "needs-update" | "conflict";

export interface ImplementationBinding {
  /** Id of the authored node (scene, item, object, puzzle, ...). */
  source: Id;
  sourceKind: NodeKind;
  engine: EngineId;
  /** Engine-side reference: a node path, prefab GUID, Blueprint path, ... */
  target: string;
  /** `contentHash` of the source node when it was bound. */
  sourceHash: string;
  complete: boolean;
}

/** Authored node kinds Game Studio must implement. */
export const HOOK_KINDS: NodeKind[] = [
  "scene", "character", "item", "ability", "object", "verb", "puzzle", "trigger",
  "objective", "cinematic", "location", "ending",
];

export interface Hook {
  id: Id;
  kind: NodeKind;
  name: string;
  status: BindingStatus;
}

/** Every authored hook and its implementation status. */
export function implementationHooks(project: GameProject, bindings: ImplementationBinding[] = []): Hook[] {
  const index = indexProject(project);
  const bySource = new Map<Id, ImplementationBinding[]>();
  for (const b of bindings) bySource.set(b.source, [...(bySource.get(b.source) ?? []), b]);

  const hooks: Hook[] = [];
  for (const [id, entry] of index.byId) {
    if (!HOOK_KINDS.includes(entry.kind)) continue;
    const bs = bySource.get(id) ?? [];
    let status: BindingStatus = "unbound";
    if (bs.length) {
      const hash = contentHash(entry.node);
      if (bs.some((b) => b.sourceKind !== entry.kind)) status = "conflict";
      else if (bs.some((b) => b.sourceHash !== hash)) status = "needs-update";
      else status = bs.every((b) => b.complete) ? "implemented" : "partial";
    }
    hooks.push({ id, kind: entry.kind, name: entry.node.name ?? id, status });
  }
  // Bindings whose authored node was deleted.
  for (const [id] of bySource) {
    if (!index.get(id)) hooks.push({ id, kind: bySource.get(id)![0]!.sourceKind, name: id, status: "conflict" });
  }
  return hooks;
}

/** Stable hash of a node's content (key order independent). */
export function contentHash(value: unknown): string {
  const s = stableStringify(value);
  // cyrb53: fast, well-distributed, no crypto dependency.
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableStringify(x)}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Engine adapters (implemented in VC Game Studio; declared here so the
// contract lives next to the data it consumes).
// ---------------------------------------------------------------------------

export type Capability = "generated" | "needs-binding" | "unsupported";

export interface GeneratedFile {
  path: string;
  contents: string;
  /** Authored node ids this file implements, for traceability. */
  sources: Id[];
}

export interface EngineAdapter {
  engine: EngineId;
  /** What this adapter can generate per node kind. */
  capabilities(): Partial<Record<NodeKind, Capability>>;
  /**
   * Generate engine code/scaffolding. Generated regions must be marked so
   * hand-written code outside them survives regeneration.
   */
  generate(project: GameProject, bindings: ImplementationBinding[]): GeneratedFile[];
}
