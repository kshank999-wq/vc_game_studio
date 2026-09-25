/**
 * Id lookup and reference graph for a project.
 *
 * `indexProject` resolves any id to the node it names. `collectReferences`
 * lists every id-to-id reference in the project (including ids inside
 * expressions), which drives dangling-reference checks, Used/Unused
 * indicators and dependency visualization.
 */

import { exprRefs, parseExpr, ExprError } from "./expr.js";
import type {
  Beat, Character, Choice, Cinematic, ExprSource, GameProject, Id, Item, Level,
  Location, Milestone, Mutation, Puzzle, Relationship, Scene,
  SmartObject, Target, Trigger, VariableDef, Verb,
} from "./schema.js";

export type NodeKind =
  | "project" | "character" | "faction" | "relationship" | "location" | "item"
  | "ability" | "object" | "verb" | "puzzle" | "quest" | "lore" | "variable"
  | "milestone" | "level" | "scene" | "beat" | "choice" | "objective"
  | "trigger" | "element" | "behavior" | "cinematic" | "shot" | "ending";

export interface IndexEntry {
  kind: NodeKind;
  node: { id: Id; name?: string };
  /** Scene containing this node, for scene-owned nodes. */
  scene?: Scene;
  /** Beat containing this node, for choices. */
  beat?: Beat;
  /** Smart object owning this node, for verbs. */
  object?: SmartObject;
}

export interface ProjectIndex {
  project: GameProject;
  byId: Map<Id, IndexEntry>;
  duplicates: Id[];
  get(id: Id): IndexEntry | undefined;
  label(id: Id): string;
  variable(id: Id): VariableDef | undefined;
  item(id: Id): Item | undefined;
  relationship(id: Id): Relationship | undefined;
  object(id: Id): SmartObject | undefined;
  puzzle(id: Id): Puzzle | undefined;
  scene(id: Id): Scene | undefined;
  beat(id: Id): Beat | undefined;
  choice(id: Id): Choice | undefined;
  cinematic(id: Id): Cinematic | undefined;
}

export function indexProject(project: GameProject): ProjectIndex {
  const byId = new Map<Id, IndexEntry>();
  const duplicates: Id[] = [];
  const add = (kind: NodeKind, node: { id: Id; name?: string }, extra: Partial<IndexEntry> = {}) => {
    if (byId.has(node.id)) duplicates.push(node.id);
    else byId.set(node.id, { kind, node, ...extra });
  };

  add("project", project);
  const b = project.bible;
  b.characters.forEach((n) => add("character", n));
  b.factions.forEach((n) => add("faction", n));
  b.relationships.forEach((n) => add("relationship", n));
  b.locations.forEach((n) => add("location", n));
  b.items.forEach((n) => add("item", n));
  b.abilities.forEach((n) => add("ability", n));
  b.objects.forEach((o) => {
    add("object", o);
    o.verbs.forEach((v) => add("verb", v, { object: o }));
  });
  b.puzzles.forEach((n) => add("puzzle", n));
  b.quests.forEach((n) => add("quest", n));
  b.lore.forEach((n) => add("lore", n));
  project.variables.forEach((n) => add("variable", n));
  project.spine.forEach((n) => add("milestone", n));
  project.levels.forEach((n) => add("level", n));
  project.endings.forEach((n) => add("ending", n));
  project.cinematics.forEach((c) => {
    add("cinematic", c);
    c.shots.forEach((s) => add("shot", { id: s.id, name: s.camera }));
  });
  for (const scene of project.scenes) {
    add("scene", scene);
    scene.systemic.objectives.forEach((n) => add("objective", n, { scene }));
    scene.systemic.triggers.forEach((n) => add("trigger", n, { scene }));
    scene.elements.forEach((n) => add("element", n, { scene }));
    scene.behavioral.notes.forEach((n) => add("behavior", n, { scene }));
    for (const beat of scene.beats) {
      add("beat", beat, { scene });
      beat.choices?.forEach((c) => add("choice", { id: c.id, name: c.text }, { scene, beat }));
    }
  }

  const typed = <T>(kind: NodeKind) => (id: Id) => {
    const e = byId.get(id);
    return e?.kind === kind ? (e.node as T) : undefined;
  };
  const choiceById = (id: Id) => {
    const e = byId.get(id);
    return e?.kind === "choice" ? e.beat!.choices!.find((c) => c.id === id) : undefined;
  };

  return {
    project,
    byId,
    duplicates,
    get: (id) => byId.get(id),
    label: (id) => byId.get(id)?.node.name ?? id,
    variable: typed<VariableDef>("variable"),
    item: typed<Item>("item"),
    relationship: typed<Relationship>("relationship"),
    object: typed<SmartObject>("object"),
    puzzle: typed<Puzzle>("puzzle"),
    scene: typed<Scene>("scene"),
    beat: typed<Beat>("beat"),
    choice: choiceById,
    cinematic: typed<Cinematic>("cinematic"),
  };
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

export type RefUse = "read" | "write" | "structure";

export interface Reference {
  /** The node holding the reference. */
  from: Id;
  to: Id;
  /** Node kinds that are valid targets. */
  expects: NodeKind[];
  /** Whether state is read (conditions), written (mutations) or structural. */
  use: RefUse;
  /** Human-readable location, e.g. "choice cho_x effects". */
  via: string;
}

export interface ExprProblem {
  from: Id;
  via: string;
  source: ExprSource;
  message: string;
}

const EXPR_KIND: Record<string, NodeKind[]> = {
  variable: ["variable"],
  item: ["item"],
  relationship: ["relationship"],
  choice: ["choice"],
  node: ["scene", "beat"],
  objective: ["objective"],
  puzzle: ["puzzle"],
  object: ["object"],
};

export function collectReferences(project: GameProject): { refs: Reference[]; exprProblems: ExprProblem[] } {
  const refs: Reference[] = [];
  const exprProblems: ExprProblem[] = [];

  const ref = (from: Id, to: Id | undefined, expects: NodeKind[], via: string, use: RefUse = "structure") => {
    if (to !== undefined) refs.push({ from, to, expects, via, use });
  };
  const expr = (from: Id, source: ExprSource | undefined, via: string) => {
    if (source === undefined) return;
    try {
      for (const r of exprRefs(parseExpr(source))) ref(from, r.id, EXPR_KIND[r.kind]!, via, "read");
    } catch (e) {
      exprProblems.push({ from, via, source, message: e instanceof ExprError ? e.message : String(e) });
    }
  };
  const mutations = (from: Id, muts: Mutation[] | undefined, via: string) => {
    for (const m of muts ?? []) {
      switch (m.op) {
        case "set": ref(from, m.var, ["variable"], via, "write"); expr(from, m.value, via); break;
        case "add": ref(from, m.var, ["variable"], via, "write"); break;
        case "give": case "take": ref(from, m.item, ["item"], via, "write"); break;
        case "relationship": ref(from, m.relationship, ["relationship"], via, "write"); break;
        case "objective": ref(from, m.objective, ["objective"], via, "write"); break;
        case "puzzle": ref(from, m.puzzle, ["puzzle"], via, "write"); break;
        case "object": ref(from, m.object, ["object"], via, "write"); break;
        case "event": break;
      }
    }
  };
  const target = (from: Id, t: Target, via: string) => {
    if ("beat" in t) ref(from, t.beat, ["beat"], via);
    else if ("scene" in t) ref(from, t.scene, ["scene"], via);
    else ref(from, t.end, ["ending"], via);
  };

  ref(project.id, project.start.scene, ["scene"], "project start");

  const b = project.bible;
  b.characters.forEach((c: Character) => ref(c.id, c.faction, ["faction"], "character faction"));
  b.relationships.forEach((r) => {
    ref(r.id, r.from, ["character"], "relationship from");
    ref(r.id, r.to, ["character"], "relationship to");
  });
  b.locations.forEach((l: Location) => ref(l.id, l.parent, ["location"], "location parent"));
  b.abilities.forEach((a) => expr(a.id, a.prerequisite, "ability prerequisite"));
  b.objects.forEach((o) =>
    o.verbs.forEach((v: Verb) => {
      expr(v.id, v.availableWhen, `verb ${v.id} condition`);
      mutations(v.id, v.effects, `verb ${v.id} effects`);
    }),
  );
  b.puzzles.forEach((p: Puzzle) => {
    expr(p.id, p.solution, "puzzle solution");
    mutations(p.id, p.onSolve, "puzzle onSolve");
    mutations(p.id, p.onFail, "puzzle onFail");
  });

  project.spine.forEach((m: Milestone) => ref(m.id, m.anchor, ["scene", "beat"], "milestone anchor"));
  project.levels.forEach((l: Level) => l.scenes.forEach((s) => ref(l.id, s, ["scene"], "level scenes")));
  project.cinematics.forEach((c) => {
    c.participants?.forEach((p) => ref(c.id, p, ["character"], "cinematic participants"));
    c.shots.forEach((s) => s.lines?.forEach((l) => ref(c.id, l.speaker, ["character"], "cinematic dialogue")));
    mutations(c.id, c.onComplete, "cinematic onComplete");
  });

  for (const scene of project.scenes) {
    const sid = scene.id;
    ref(sid, scene.level, ["level"], "scene level");
    ref(sid, scene.location, ["location"], "scene location");
    ref(sid, scene.entry, ["beat"], "scene entry");
    scene.narrative.participants?.forEach((p) => ref(sid, p, ["character"], "scene participants"));
    expr(sid, scene.narrative.prerequisites, "scene prerequisites");
    scene.behavioral.notes.forEach((n) => {
      ref(n.id, n.actor, ["character"], "behavior actor");
      expr(n.id, n.when, "behavior condition");
    });
    mutations(sid, scene.systemic.onEnter, "scene onEnter");
    expr(sid, scene.systemic.completion, "scene completion");
    scene.systemic.triggers.forEach((t: Trigger) => {
      expr(t.id, t.when, "trigger condition");
      mutations(t.id, t.effects, "trigger effects");
    });
    scene.elements.forEach((e) => ref(e.id, e.ref, [], "scene element"));
    for (const beat of scene.beats) {
      beat.lines?.forEach((l) => ref(beat.id, l.speaker, ["character"], "dialogue speaker"));
      mutations(beat.id, beat.onEnter, "beat onEnter");
      ref(beat.id, beat.cinematic, ["cinematic"], "beat cinematic");
      ref(beat.id, beat.puzzle, ["puzzle"], "beat puzzle");
      beat.next?.forEach((t) => {
        target(beat.id, t.to, "beat next");
        expr(beat.id, t.when, "transition condition");
      });
      beat.choices?.forEach((c: Choice) => {
        expr(c.id, c.availableWhen, "choice condition");
        mutations(c.id, c.effects, "choice effects");
        target(c.id, c.to, "choice target");
      });
    }
  }
  return { refs, exprProblems };
}

/** Usage map: id → references pointing at it. Drives Used/Unused indicators. */
export function usageIndex(refs: Reference[]): Map<Id, Reference[]> {
  const usage = new Map<Id, Reference[]>();
  for (const r of refs) {
    const list = usage.get(r.to);
    if (list) list.push(r);
    else usage.set(r.to, [r]);
  }
  return usage;
}

