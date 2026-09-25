/**
 * Static validation: finds structural problems without running the story.
 * For problems that depend on state (a gate that can never open on any
 * actual playthrough), use `explorePaths` from simulate.ts.
 */

import { parseExpr, walk } from "./expr.js";
import {
  collectReferences, indexProject, usageIndex, type NodeKind, type ProjectIndex, type Reference,
} from "./project-index.js";
import type { GameProject, Id, Mutation, Target } from "./schema.js";

export type Severity = "error" | "warning" | "info";

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  /** Node the issue is attached to. */
  node: Id;
}

export interface ValidationReport {
  issues: Issue[];
  errors: number;
  warnings: number;
  /** Bible/variable ids with no references (the "Unused" indicator). */
  unused: Id[];
}

const BIBLE_KINDS: NodeKind[] = ["character", "faction", "location", "item", "ability", "object", "puzzle", "quest", "lore", "variable", "relationship"];

export function validateProject(project: GameProject): ValidationReport {
  const index = indexProject(project);
  const { refs, exprProblems } = collectReferences(project);
  const issues: Issue[] = [];
  const add = (severity: Severity, code: string, node: Id, message: string) =>
    issues.push({ severity, code, node, message });
  const L = (id: Id) => `"${index.label(id)}"`;

  for (const id of index.duplicates) add("error", "duplicate-id", id, `Id "${id}" is used by more than one node`);
  for (const p of exprProblems) add("error", "expression", p.from, `Invalid ${p.via}: ${p.message}`);

  for (const r of refs) {
    const target = index.get(r.to);
    if (!target) add("error", "dangling-ref", r.from, `${r.via} refers to missing id "${r.to}"`);
    else if (r.expects.length && !r.expects.includes(target.kind)) {
      add("error", "wrong-kind", r.from, `${r.via} expects ${r.expects.join("/")} but "${r.to}" is a ${target.kind}`);
    }
  }

  checkFlow(index, add, L);
  checkState(index, refs, add, L);

  for (const scene of project.scenes) {
    if (!scene.beats.some((b) => b.id === scene.entry)) {
      add("error", "entry-outside-scene", scene.id, `Scene ${L(scene.id)} entry beat is not one of its beats`);
    }
    if (scene.level) {
      const level = project.levels.find((l) => l.id === scene.level);
      if (level && !level.scenes.includes(scene.id)) {
        add("warning", "level-mismatch", scene.id, `Scene ${L(scene.id)} names level ${L(level.id)} but the level does not list it`);
      }
    }
  }

  const usage = usageIndex(refs);
  const unused = [...index.byId.values()]
    .filter((e) => BIBLE_KINDS.includes(e.kind) && !usage.has(e.node.id))
    .map((e) => e.node.id);
  for (const id of unused) add("info", "unused", id, `${index.get(id)!.kind} ${L(id)} is never used`);

  return {
    issues,
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    unused,
  };
}

type Add = (severity: Severity, code: string, node: Id, message: string) => void;

/** Flow graph over beats; endings are nodes "end:<id>". */
export function flowGraph(index: ProjectIndex): { start?: Id; edges: Map<Id, Id[]> } {
  const edges = new Map<Id, Id[]>();
  const resolve = (t: Target): Id | undefined => {
    if ("end" in t) return `end:${t.end}`;
    if ("scene" in t) return index.scene(t.scene)?.entry;
    return t.beat;
  };
  for (const scene of index.project.scenes) {
    for (const beat of scene.beats) {
      const out = [
        ...(beat.next ?? []).map((t) => resolve(t.to)),
        ...(beat.choices ?? []).map((c) => resolve(c.to)),
      ].filter((x): x is Id => x !== undefined);
      edges.set(beat.id, out);
    }
  }
  return { start: index.scene(index.project.start.scene)?.entry, edges };
}

function reachable(edges: Map<Id, Id[]>, from: Id, blocked?: Id): Set<Id> {
  const seen = new Set<Id>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || id === blocked) continue;
    seen.add(id);
    for (const n of edges.get(id) ?? []) stack.push(n);
  }
  return seen;
}

function checkFlow(index: ProjectIndex, add: Add, L: (id: Id) => string): void {
  const p = index.project;
  const { start, edges } = flowGraph(index);
  if (!start) return; // dangling start already reported

  const fromStart = reachable(edges, start);
  const reachesEnd = new Set<Id>();
  // Reverse reachability from all endings.
  const reverse = new Map<Id, Id[]>();
  for (const [from, tos] of edges) for (const to of tos) reverse.set(to, [...(reverse.get(to) ?? []), from]);
  for (const e of p.endings) for (const id of reachable(reverse, `end:${e.id}`)) reachesEnd.add(id);

  for (const scene of p.scenes) {
    if (!fromStart.has(scene.entry)) {
      add("warning", "unreachable-scene", scene.id, `Scene ${L(scene.id)} cannot be reached from the start`);
      continue;
    }
    for (const beat of scene.beats) {
      if (!fromStart.has(beat.id)) {
        add("warning", "unreachable-beat", beat.id, `Beat ${L(beat.id)} in ${L(scene.id)} cannot be reached`);
      } else if (!edges.get(beat.id)?.length) {
        add("error", "dead-end", beat.id, `Beat ${L(beat.id)} in ${L(scene.id)} has no choices or next step`);
      } else if (!reachesEnd.has(beat.id)) {
        add("error", "no-ending", beat.id, `No path from beat ${L(beat.id)} ever reaches an ending`);
      }
    }
  }

  for (const e of p.endings) {
    if (!fromStart.has(`end:${e.id}`)) add("warning", "unreachable-ending", e.id, `Ending ${L(e.id)} cannot be reached`);
  }

  for (const m of p.spine) {
    const anchor = index.scene(m.anchor)?.entry ?? m.anchor;
    if (!fromStart.has(anchor)) {
      add(m.required ? "error" : "warning", "unreachable-milestone", m.id, `Milestone ${L(m.id)} cannot be reached`);
      continue;
    }
    if (!m.required || anchor === start) continue;
    const bypass = reachable(edges, start, anchor);
    const skipped = p.endings.find((e) => !e.failure && bypass.has(`end:${e.id}`));
    if (skipped) {
      add("error", "milestone-bypassed", m.id,
        `Required milestone ${L(m.id)} can be skipped: ending ${L(skipped.id)} is reachable without it (unmerged branch)`);
    }
  }
}

function checkState(index: ProjectIndex, refs: Reference[], add: Add, L: (id: Id) => string): void {
  const p = index.project;

  // Items that are required somewhere but never given.
  const given = new Set<Id>();
  const needed = new Map<Id, Id>();
  eachMutation(p, (m, owner) => {
    if (m.op === "give") given.add(m.item);
    if (m.op === "take" && !needed.has(m.item)) needed.set(m.item, owner);
  });
  for (const r of refs) {
    if (r.use === "read" && index.get(r.to)?.kind === "item" && !needed.has(r.to)) needed.set(r.to, r.from);
  }
  for (const [item, from] of needed) {
    if (index.item(item) && !given.has(item)) {
      add("error", "impossible-item", from, `${L(item)} is required but never acquired anywhere`);
    }
  }

  // Variables that gates read but nothing ever changes.
  const written = new Set(refs.filter((r) => r.use === "write").map((r) => r.to));
  const readVars = new Map<Id, Id>();
  for (const r of refs) if (r.use === "read" && index.variable(r.to) && !readVars.has(r.to)) readVars.set(r.to, r.from);
  for (const [v, from] of readVars) {
    if (!written.has(v)) add("warning", "constant-variable", from, `Condition reads ${L(v)}, which is never changed`);
  }

  // Values that don't fit their declared type/states.
  eachMutation(p, (m, owner) => {
    if (m.op === "object") {
      const obj = index.object(m.object);
      if (obj && !obj.states.includes(m.state)) add("error", "invalid-state", owner, `${L(obj.id)} has no state "${m.state}"`);
    }
    if (m.op === "set") {
      const def = index.variable(m.var);
      if (def?.type === "enum" && def.values) {
        try {
          const e = parseExpr(m.value);
          if (e.k === "lit" && typeof e.v === "string" && !def.values.includes(e.v)) {
            add("error", "invalid-enum", owner, `${L(def.id)} cannot be "${e.v}" (allowed: ${def.values.join(", ")})`);
          }
        } catch { /* reported as expression error */ }
      }
    }
    if (m.op === "add") {
      const def = index.variable(m.var);
      if (def && def.type !== "int" && def.type !== "float") add("error", "non-numeric-add", owner, `Cannot add to ${def.type} variable ${L(def.id)}`);
    }
  });

  // Comparisons like state(obj) == "x" where "x" is not a state of obj.
  const conditionSources: [Id, string | undefined][] = [];
  for (const s of p.scenes) {
    conditionSources.push([s.id, s.narrative.prerequisites], [s.id, s.systemic.completion]);
    s.systemic.triggers.forEach((t) => conditionSources.push([t.id, t.when]));
    for (const b of s.beats) {
      b.next?.forEach((t) => conditionSources.push([b.id, t.when]));
      b.choices?.forEach((c) => conditionSources.push([c.id, c.availableWhen]));
    }
  }
  p.bible.objects.forEach((o) => o.verbs.forEach((v) => conditionSources.push([v.id, v.availableWhen])));
  for (const [owner, src] of conditionSources) {
    if (!src) continue;
    let expr;
    try { expr = parseExpr(src); } catch { continue; }
    walk(expr, (e) => {
      if (e.k !== "bin" || (e.op !== "==" && e.op !== "!=")) return;
      const [call, lit] = e.a.k === "call" ? [e.a, e.b] : [e.b, e.a];
      if (call.k !== "call" || lit.k !== "lit" || typeof lit.v !== "string") return;
      if (call.fn === "state") {
        const obj = index.object(call.arg);
        if (obj && !obj.states.includes(lit.v)) add("error", "invalid-state", owner, `${L(obj.id)} has no state "${lit.v}"`);
      }
      if (call.fn === "objective" && !["inactive", "active", "done", "failed"].includes(lit.v)) {
        add("error", "invalid-state", owner, `Objectives have no status "${lit.v}"`);
      }
    });
  }
}

/** Visit every mutation in the project with the id of the node that owns it. */
export function eachMutation(p: GameProject, fn: (m: Mutation, owner: Id) => void): void {
  for (const s of p.scenes) {
    (s.systemic.onEnter ?? []).forEach((m) => fn(m, s.id));
    s.systemic.triggers.forEach((t) => (t.effects ?? []).forEach((m) => fn(m, t.id)));
    for (const b of s.beats) {
      (b.onEnter ?? []).forEach((m) => fn(m, b.id));
      b.choices?.forEach((c) => (c.effects ?? []).forEach((m) => fn(m, c.id)));
    }
  }
  p.bible.objects.forEach((o) => o.verbs.forEach((v) => (v.effects ?? []).forEach((m) => fn(m, v.id))));
  p.bible.puzzles.forEach((pz) => [...(pz.onSolve ?? []), ...(pz.onFail ?? [])].forEach((m) => fn(m, pz.id)));
  p.cinematics.forEach((c) => (c.onComplete ?? []).forEach((m) => fn(m, c.id)));
}
