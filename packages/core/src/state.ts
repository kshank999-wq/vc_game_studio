/**
 * Runtime state: the single state model shared by narrative and gameplay.
 *
 * Mutations are applied as a transaction: either every mutation in a group
 * succeeds or the state is left untouched. Every change is logged with the
 * id of the node that caused it, so any value can be traced back to its
 * authoring source.
 */

import { evaluate, explainFailure, parseExpr, truthy, type EvalContext } from "./expr.js";
import type { ProjectIndex } from "./project-index.js";
import type { ExprSource, Id, Mutation, ObjectiveStatus, PuzzleStatus, Value } from "./schema.js";

export interface RuntimeState {
  vars: Record<Id, Value>;
  inventory: Record<Id, number>;
  relationships: Record<Id, number>;
  objectives: Record<Id, ObjectiveStatus>;
  puzzles: Record<Id, PuzzleStatus>;
  objects: Record<Id, string>;
  /** How many times each choice has been taken. */
  choices: Record<Id, number>;
  /** How many times each scene or beat has been entered. */
  visited: Record<Id, number>;
  log: StateChange[];
}

export interface StateChange {
  key: string;
  before: Value;
  after: Value;
  /** Id of the node whose mutation caused the change. */
  source: Id;
  op: Mutation["op"];
}

export class MutationError extends Error {
  constructor(message: string, public readonly source: Id, public readonly mutation: Mutation) {
    super(message);
  }
}

export function initialState(index: ProjectIndex): RuntimeState {
  const p = index.project;
  const state: RuntimeState = {
    vars: {}, inventory: {}, relationships: {}, objectives: {}, puzzles: {},
    objects: {}, choices: {}, visited: {}, log: [],
  };
  for (const v of p.variables) state.vars[v.id] = v.initial;
  for (const r of p.bible.relationships) state.relationships[r.id] = r.initial;
  for (const o of p.bible.objects) state.objects[o.id] = o.initial;
  for (const pz of p.bible.puzzles) state.puzzles[pz.id] = "unsolved";
  for (const s of p.scenes) for (const o of s.systemic.objectives) state.objectives[o.id] = "inactive";
  return state;
}

export function cloneState(s: RuntimeState): RuntimeState {
  return {
    vars: { ...s.vars },
    inventory: { ...s.inventory },
    relationships: { ...s.relationships },
    objectives: { ...s.objectives },
    puzzles: { ...s.puzzles },
    objects: { ...s.objects },
    choices: { ...s.choices },
    visited: { ...s.visited },
    log: [...s.log],
  };
}

export function evalContext(index: ProjectIndex, state: RuntimeState): EvalContext {
  return {
    variable(id) {
      if (!(id in state.vars)) throw new Error(`Unknown variable "${id}"`);
      return state.vars[id]!;
    },
    call(fn, id) {
      switch (fn) {
        case "has": return (state.inventory[id] ?? 0) > 0;
        case "count": return state.inventory[id] ?? 0;
        case "rel": return state.relationships[id] ?? 0;
        case "chose": return (state.choices[id] ?? 0) > 0;
        case "visited": return state.visited[id] ?? 0;
        case "objective": return state.objectives[id] ?? "inactive";
        case "solved": return state.puzzles[id] === "solved";
        case "state": return state.objects[id] ?? null;
      }
    },
    label: (id) => index.label(id),
  };
}

export function check(index: ProjectIndex, state: RuntimeState, source: ExprSource | undefined): boolean {
  if (source === undefined) return true;
  return truthy(evaluate(parseExpr(source), evalContext(index, state)));
}

/** Failing sub-conditions of `source`, or [] if it holds. */
export function explain(index: ProjectIndex, state: RuntimeState, source: ExprSource | undefined): string[] {
  if (source === undefined) return [];
  return explainFailure(parseExpr(source), evalContext(index, state));
}

/**
 * Apply mutations atomically. Returns the new state; throws MutationError
 * (leaving `state` untouched) if any mutation is invalid.
 */
export function applyMutations(
  index: ProjectIndex,
  state: RuntimeState,
  mutations: Mutation[] | undefined,
  source: Id,
): RuntimeState {
  if (!mutations?.length) return state;
  const next = cloneState(state);
  for (const m of mutations) applyOne(index, next, m, source);
  return next;
}

function applyOne(index: ProjectIndex, s: RuntimeState, m: Mutation, source: Id): void {
  const fail = (msg: string): never => { throw new MutationError(msg, source, m); };
  const log = (key: string, before: Value, after: Value) => {
    if (before !== after) s.log.push({ key, before, after, source, op: m.op });
  };

  switch (m.op) {
    case "set": case "add": {
      const def = index.variable(m.var) ?? fail(`Unknown variable "${m.var}"`);
      const before = s.vars[m.var] ?? null;
      let after: Value;
      if (m.op === "set") {
        after = evaluate(parseExpr(m.value), evalContext(index, s));
      } else {
        if (typeof before !== "number") fail(`Cannot add to non-numeric variable "${def.name}"`);
        after = (before as number) + m.amount;
      }
      after = coerce(def.type, after, def.values) ?? fail(`Value ${JSON.stringify(after)} is not a valid ${def.type} for "${def.name}"`);
      if (typeof after === "number") after = clamp(after, def.min, def.max);
      s.vars[m.var] = after;
      log(`var:${m.var}`, before, after);
      return;
    }
    case "give": case "take": {
      const item = index.item(m.item) ?? fail(`Unknown item "${m.item}"`);
      const qty = m.qty ?? 1;
      const before = s.inventory[m.item] ?? 0;
      let after = m.op === "give" ? before + qty : before - qty;
      if (after < 0) fail(`Cannot take ${qty} × "${item.name}": only ${before} held`);
      if (m.op === "give") {
        const cap = item.stackable ? item.maxStack ?? Infinity : 1;
        after = Math.min(after, cap);
      }
      s.inventory[m.item] = after;
      log(`item:${m.item}`, before, after);
      return;
    }
    case "relationship": {
      const rel = index.relationship(m.relationship) ?? fail(`Unknown relationship "${m.relationship}"`);
      const before = s.relationships[m.relationship] ?? rel.initial;
      const after = clamp(before + m.delta, rel.min, rel.max);
      s.relationships[m.relationship] = after;
      log(`rel:${m.relationship}`, before, after);
      return;
    }
    case "objective": {
      if (index.get(m.objective)?.kind !== "objective") fail(`Unknown objective "${m.objective}"`);
      const before = s.objectives[m.objective] ?? "inactive";
      s.objectives[m.objective] = m.status;
      log(`objective:${m.objective}`, before, m.status);
      return;
    }
    case "puzzle": {
      const puzzle = index.puzzle(m.puzzle) ?? fail(`Unknown puzzle "${m.puzzle}"`);
      const before = s.puzzles[m.puzzle] ?? "unsolved";
      s.puzzles[m.puzzle] = m.status;
      log(`puzzle:${m.puzzle}`, before, m.status);
      if (before !== m.status) {
        const follow = m.status === "solved" ? puzzle.onSolve : m.status === "failed" ? puzzle.onFail : undefined;
        for (const f of follow ?? []) applyOne(index, s, f, puzzle.id);
      }
      return;
    }
    case "object": {
      const obj = index.object(m.object) ?? fail(`Unknown object "${m.object}"`);
      if (!obj.states.includes(m.state)) fail(`"${obj.name}" has no state "${m.state}"`);
      const before = s.objects[m.object] ?? obj.initial;
      s.objects[m.object] = m.state;
      log(`object:${m.object}`, before, m.state);
      return;
    }
    case "event":
      s.log.push({ key: `event:${m.name}`, before: null, after: null, source, op: "event" });
      return;
  }
}

function coerce(type: string, v: Value, values?: string[]): Value | undefined {
  switch (type) {
    case "bool": return typeof v === "boolean" ? v : undefined;
    case "int": return typeof v === "number" ? Math.trunc(v) : undefined;
    case "float": return typeof v === "number" ? v : undefined;
    case "string": return typeof v === "string" ? v : undefined;
    case "enum": return typeof v === "string" && (!values || values.includes(v)) ? v : undefined;
    default: return v;
  }
}

function clamp(n: number, min?: number, max?: number): number {
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}
