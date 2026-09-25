/**
 * Product editions and the features each one unlocks.
 *
 *   lite    — the game-writing mode built into VC Writer
 *   writer  — VC Game Writer, the full standalone game-writing tool
 *   studio  — VC Game Studio: everything, plus engine implementation
 *
 * Every edition reads and writes the same project file. Content that uses a
 * feature the current edition lacks is shown locked and read-only, never
 * dropped, so upgrading loses nothing.
 */

import { parseExpr, walk, type Expr } from "./expr.js";
import type { GameProject, Id, Mutation } from "./schema.js";
import type { Issue } from "./validate.js";

export type Edition = "lite" | "writer" | "studio";

export const EDITIONS: Record<Edition, { name: string; tagline: string }> = {
  lite: { name: "VC Writer (game mode)", tagline: "Write branching game stories" },
  writer: { name: "VC Game Writer", tagline: "Full interactive narrative design" },
  studio: { name: "VC Game Studio", tagline: "From story to engine" },
};

export type Feature =
  // lite and above
  | "bible" | "research" | "spine" | "scenes" | "dialogue" | "choices"
  | "simple-conditions" | "items" | "play"
  // writer and above
  | "advanced-conditions" | "relationships" | "inventory-rules" | "objects"
  | "puzzles" | "triggers" | "cinematics" | "behavioral-layer"
  | "systemic-layer" | "state-inspector" | "path-explorer" | "full-validation"
  // studio only
  | "implementation" | "engine-export";

const LITE: Feature[] = [
  "bible", "research", "spine", "scenes", "dialogue", "choices", "simple-conditions", "items", "play",
];
const WRITER: Feature[] = [
  ...LITE, "advanced-conditions", "relationships", "inventory-rules", "objects", "puzzles",
  "triggers", "cinematics", "behavioral-layer", "systemic-layer", "state-inspector",
  "path-explorer", "full-validation",
];
const STUDIO: Feature[] = [...WRITER, "implementation", "engine-export"];

const FEATURES: Record<Edition, ReadonlySet<Feature>> = {
  lite: new Set(LITE),
  writer: new Set(WRITER),
  studio: new Set(STUDIO),
};

export const FEATURE_LABELS: Record<Feature, string> = {
  bible: "Game Bible", research: "Research", spine: "Narrative spine", scenes: "Scenes",
  dialogue: "Dialogue", choices: "Choices", "simple-conditions": "Simple conditions",
  items: "Items", play: "Play-through",
  "advanced-conditions": "Advanced conditions", relationships: "Relationships",
  "inventory-rules": "Inventory rules", objects: "Interactive objects", puzzles: "Puzzles",
  triggers: "Triggers", cinematics: "Cinematics", "behavioral-layer": "Behavioral layer",
  "systemic-layer": "Systemic layer", "state-inspector": "State inspector",
  "path-explorer": "Path explorer", "full-validation": "Full validation",
  implementation: "Implementation tracking", "engine-export": "Engine export",
};

export function hasFeature(edition: Edition, feature: Feature): boolean {
  return FEATURES[edition].has(feature);
}

/** The cheapest edition that includes a feature, for upgrade prompts. */
export function editionFor(feature: Feature): Edition {
  return (["lite", "writer", "studio"] as const).find((e) => hasFeature(e, feature))!;
}

/**
 * Simple conditions use only item checks, past choices, visits and boolean
 * variables combined with and/or/not. Anything else (numeric comparisons,
 * relationships, object and puzzle state) is advanced.
 */
export function conditionFeature(source: string, project: GameProject): Feature {
  let expr: Expr;
  try { expr = parseExpr(source); } catch { return "simple-conditions"; }
  const bools = new Set(project.variables.filter((v) => v.type === "bool").map((v) => v.id));
  let advanced = false;
  walk(expr, (e) => {
    if (e.k === "call" && !["has", "chose", "visited"].includes(e.fn)) advanced = true;
    if (e.k === "var" && !bools.has(e.id)) advanced = true;
    if (e.k === "neg" || (e.k === "bin" && e.op !== "&&" && e.op !== "||")) advanced = true;
  });
  return advanced ? "advanced-conditions" : "simple-conditions";
}

export function mutationFeature(m: Mutation): Feature {
  switch (m.op) {
    case "give": case "take": return "items";
    case "set": case "add": return "systemic-layer";
    case "relationship": return "relationships";
    case "object": return "objects";
    case "puzzle": return "puzzles";
    case "objective": case "event": return "systemic-layer";
  }
}

export interface LockedContent {
  id: Id;
  feature: Feature;
}

/**
 * Every node in a project that uses a feature `edition` lacks. The UI shows
 * these read-only with an upgrade prompt; they are never removed.
 */
export function lockedContent(project: GameProject, edition: Edition): LockedContent[] {
  const out: LockedContent[] = [];
  const lock = (id: Id, feature: Feature) => {
    if (!hasFeature(edition, feature)) out.push({ id, feature });
  };
  const cond = (id: Id, src: string | undefined) => { if (src) lock(id, conditionFeature(src, project)); };
  const muts = (id: Id, ms: Mutation[] | undefined) => {
    const features = new Set((ms ?? []).map(mutationFeature));
    features.forEach((f) => lock(id, f));
  };

  const b = project.bible;
  b.relationships.forEach((r) => lock(r.id, "relationships"));
  b.objects.forEach((o) => lock(o.id, "objects"));
  b.puzzles.forEach((p) => lock(p.id, "puzzles"));
  b.items.forEach((i) => {
    if (i.stackable || i.maxStack || i.equippable || i.consumable || i.stats) lock(i.id, "inventory-rules");
  });
  project.cinematics.forEach((c) => lock(c.id, "cinematics"));
  for (const s of project.scenes) {
    cond(s.id, s.narrative.prerequisites);
    s.behavioral.notes.forEach((n) => lock(n.id, "behavioral-layer"));
    s.systemic.triggers.forEach((t) => lock(t.id, "triggers"));
    s.systemic.objectives.forEach((o) => lock(o.id, "systemic-layer"));
    muts(s.id, s.systemic.onEnter);
    for (const beat of s.beats) {
      muts(beat.id, beat.onEnter);
      beat.next?.forEach((t) => cond(beat.id, t.when));
      if (beat.cinematic) lock(beat.id, "cinematics");
      if (beat.puzzle) lock(beat.id, "puzzles");
      for (const c of beat.choices ?? []) {
        cond(c.id, c.availableWhen);
        muts(c.id, c.effects);
      }
    }
  }
  // One entry per (id, feature).
  const seen = new Set<string>();
  return out.filter((l) => {
    const k = `${l.id}|${l.feature}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Validation codes shown without the full-validation feature. */
const BASIC_CHECKS = new Set([
  "duplicate-id", "expression", "dangling-ref", "wrong-kind", "dead-end", "no-ending",
  "unreachable-scene", "unreachable-beat", "unreachable-ending", "entry-outside-scene", "unused",
]);

export function issuesForEdition(issues: Issue[], edition: Edition): Issue[] {
  return hasFeature(edition, "full-validation") ? issues : issues.filter((i) => BASIC_CHECKS.has(i.code));
}

/** True if `id` or anything it belongs to is locked. */
export function isLocked(locked: LockedContent[], id: Id): Feature | undefined {
  return locked.find((l) => l.id === id)?.feature;
}

