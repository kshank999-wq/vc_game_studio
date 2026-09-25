/**
 * Narrative simulator: walk through a project's choices without a game
 * engine, with a live view of state and an explanation of why each
 * unavailable option is unavailable.
 *
 * `explorePaths` drives the simulator through every reachable combination
 * of choices to find endings, runtime dead ends and invalid mutations.
 */

import { indexProject, type ProjectIndex } from "./project-index.js";
import {
  applyMutations, check, cloneState, explain, initialState, MutationError, type RuntimeState,
} from "./state.js";
import type { Beat, Choice, GameProject, Id, Mutation, Scene, Target } from "./schema.js";

export type Position =
  | { scene: Id; beat: Id }
  | { ending: Id };

export interface Action {
  id: string;
  kind: "choice" | "continue" | "interact";
  label: string;
  available: boolean;
  /** Failing conditions when unavailable. */
  reasons: string[];
  /** For "interact": object and verb ids. */
  object?: Id;
  verb?: Id;
}

export interface SimEvent {
  type: "enter-scene" | "enter-beat" | "choice" | "interact" | "trigger" | "cinematic" | "ending" | "warning";
  id: Id;
  message: string;
}

export class SimulationError extends Error {
  constructor(message: string, public readonly source: Id) {
    super(message);
  }
}

export class Simulator {
  readonly index: ProjectIndex;
  state!: RuntimeState;
  position!: Position;
  private started = false;
  events: SimEvent[] = [];
  private groups = new Map<string, Id[]>();

  constructor(project: GameProject | ProjectIndex) {
    this.index = "byId" in project ? project : indexProject(project);
    for (const scene of this.index.project.scenes) {
      for (const beat of scene.beats) {
        for (const c of beat.choices ?? []) {
          if (!c.exclusiveGroup) continue;
          const g = this.groups.get(c.exclusiveGroup) ?? [];
          g.push(c.id);
          this.groups.set(c.exclusiveGroup, g);
        }
      }
    }
  }

  start(sceneId: Id = this.index.project.start.scene): this {
    this.state = initialState(this.index);
    this.events = [];
    this.started = false;
    this.go({ scene: sceneId });
    this.started = true;
    return this;
  }

  get ended(): boolean {
    return "ending" in this.position;
  }

  get scene(): Scene | undefined {
    return "scene" in this.position ? this.index.scene(this.position.scene) : undefined;
  }

  get beat(): Beat | undefined {
    return "beat" in this.position ? this.index.beat(this.position.beat) : undefined;
  }

  /** Actions available (or visibly unavailable) at the current position. */
  actions(): Action[] {
    const beat = this.beat;
    if (!beat) return [];
    const out: Action[] = [];

    if (beat.choices?.length) {
      for (const c of beat.choices) {
        const reasons = this.choiceBlockers(c);
        if (reasons.length && c.whenUnavailable === "hide") continue;
        out.push({ id: c.id, kind: "choice", label: c.text, available: reasons.length === 0, reasons });
      }
    } else if (beat.next?.length) {
      const t = this.pickTransition(beat);
      out.push({
        id: "continue",
        kind: "continue",
        label: "Continue",
        available: t !== undefined,
        reasons: t ? [] : beat.next.flatMap((n) => explain(this.index, this.state, n.when)),
      });
    }

    for (const el of this.scene?.elements ?? []) {
      if (el.kind !== "object" || !el.ref) continue;
      const obj = this.index.object(el.ref);
      for (const verb of obj?.verbs ?? []) {
        const reasons = explain(this.index, this.state, verb.availableWhen);
        out.push({
          id: `${obj!.id}:${verb.id}`, kind: "interact", label: `${verb.name} ${obj!.name}`,
          available: reasons.length === 0, reasons, object: obj!.id, verb: verb.id,
        });
      }
    }
    return out;
  }

  act(actionId: string): this {
    const action = this.actions().find((a) => a.id === actionId);
    if (!action) throw new SimulationError(`No action "${actionId}" here`, actionId);
    if (!action.available) throw new SimulationError(`"${action.label}" is unavailable: ${action.reasons.join("; ")}`, actionId);
    const beat = this.beat!;

    if (action.kind === "choice") {
      const choice = beat.choices!.find((c) => c.id === actionId)!;
      this.log("choice", choice.id, choice.text);
      this.state.choices[choice.id] = (this.state.choices[choice.id] ?? 0) + 1;
      this.mutate(choice.effects, choice.id);
      this.go(choice.to);
    } else if (action.kind === "continue") {
      this.go(this.pickTransition(beat)!.to);
    } else {
      const verb = this.index.get(action.verb!)!.node as { id: Id; effects?: Mutation[] };
      this.log("interact", verb.id, action.label);
      this.mutate(verb.effects, verb.id);
      this.fireTriggers();
    }
    return this;
  }

  /** Snapshot for branching exploration. */
  fork(): Simulator {
    const copy = new Simulator(this.index);
    copy.state = cloneState(this.state);
    copy.position = { ...this.position } as Position;
    copy.events = [...this.events];
    copy.started = true;
    return copy;
  }

  private choiceBlockers(c: Choice): string[] {
    const reasons: string[] = [];
    if ((c.frequency ?? "once") === "once" && this.state.choices[c.id]) reasons.push("already chosen");
    if (c.exclusiveGroup) {
      const taken = this.groups.get(c.exclusiveGroup)!.find((id) => id !== c.id && this.state.choices[id]);
      if (taken) reasons.push(`excluded by "${this.index.label(taken)}"`);
    }
    reasons.push(...explain(this.index, this.state, c.availableWhen));
    return reasons;
  }

  private pickTransition(beat: Beat) {
    return beat.next?.find((t) => check(this.index, this.state, t.when));
  }

  private go(target: Target): void {
    if ("end" in target) {
      this.leaveScene();
      this.position = { ending: target.end };
      this.log("ending", target.end, this.index.label(target.end));
      return;
    }
    if ("scene" in target) {
      const scene = this.index.scene(target.scene);
      if (!scene) throw new SimulationError(`Unknown scene "${target.scene}"`, target.scene);
      if (this.started) this.leaveScene();
      if (!check(this.index, this.state, scene.narrative.prerequisites)) {
        const why = explain(this.index, this.state, scene.narrative.prerequisites).join("; ");
        this.log("warning", scene.id, `Entered "${scene.name}" without its prerequisites: ${why}`);
      }
      this.visit(scene.id);
      this.log("enter-scene", scene.id, scene.name);
      this.mutate(scene.systemic.onEnter, scene.id);
      this.enterBeat(scene, scene.entry);
      return;
    }
    const entry = this.index.get(target.beat);
    if (entry?.kind !== "beat") throw new SimulationError(`Unknown beat "${target.beat}"`, target.beat);
    if (this.scene && entry.scene!.id !== this.scene.id) {
      this.leaveScene();
      this.visit(entry.scene!.id);
      this.log("enter-scene", entry.scene!.id, entry.scene!.name);
    }
    this.enterBeat(entry.scene!, target.beat);
  }

  private enterBeat(scene: Scene, beatId: Id): void {
    const beat = this.index.beat(beatId);
    if (!beat) throw new SimulationError(`Unknown beat "${beatId}"`, beatId);
    this.position = { scene: scene.id, beat: beat.id };
    this.visit(beat.id);
    this.log("enter-beat", beat.id, beat.name);
    this.mutate(beat.onEnter, beat.id);
    if (beat.cinematic) {
      const cin = this.index.cinematic(beat.cinematic);
      if (cin) {
        this.log("cinematic", cin.id, cin.name);
        this.mutate(cin.onComplete, cin.id);
      }
    }
    this.fireTriggers();
  }

  private leaveScene(): void {
    const scene = this.scene;
    if (scene?.systemic.completion && !check(this.index, this.state, scene.systemic.completion)) {
      const why = explain(this.index, this.state, scene.systemic.completion).join("; ");
      this.log("warning", scene.id, `Left "${scene.name}" before completing it: ${why}`);
    }
  }

  private fireTriggers(): void {
    for (const t of this.scene?.systemic.triggers ?? []) {
      if ((t.once ?? true) && this.state.visited[t.id]) continue;
      if (!t.when || !check(this.index, this.state, t.when)) continue;
      this.visit(t.id);
      this.log("trigger", t.id, t.name);
      this.mutate(t.effects, t.id);
    }
  }

  private mutate(muts: Mutation[] | undefined, source: Id): void {
    try {
      this.state = applyMutations(this.index, this.state, muts, source);
    } catch (e) {
      if (e instanceof MutationError) throw new SimulationError(`${this.index.label(source)}: ${e.message}`, source);
      throw e;
    }
  }

  private visit(id: Id): void {
    this.state.visited[id] = (this.state.visited[id] ?? 0) + 1;
  }

  private log(type: SimEvent["type"], id: Id, message: string): void {
    this.events.push({ type, id, message });
  }
}

// ---------------------------------------------------------------------------
// Path explorer
// ---------------------------------------------------------------------------

export interface PathResult {
  actions: string[];
  outcome: "ending" | "stuck" | "error" | "truncated";
  ending?: Id;
  /** Where the path stopped, for stuck/error outcomes. */
  at?: Position;
  message?: string;
  state: RuntimeState;
}

export interface ExploreOptions {
  maxDepth?: number;
  maxPaths?: number;
  /** Include smart-object interactions as branch points (default true). */
  interactions?: boolean;
}

export interface ExploreResult {
  paths: PathResult[];
  endingsReached: Id[];
  endingsMissed: Id[];
  stuck: PathResult[];
  errors: PathResult[];
  truncated: boolean;
}

/**
 * Explore every distinct playthrough (bounded). Identical position+state
 * combinations are visited once, so repeatable actions do not loop forever.
 */
export function explorePaths(project: GameProject, opts: ExploreOptions = {}): ExploreResult {
  const { maxDepth = 200, maxPaths = 2000, interactions = true } = opts;
  const index = indexProject(project);
  const paths: PathResult[] = [];
  const seen = new Set<string>();
  let truncated = false;

  const key = (sim: Simulator) => {
    const { log: _log, ...rest } = sim.state;
    return JSON.stringify([sim.position, rest]);
  };

  const walk = (sim: Simulator, actions: string[]) => {
    if (paths.length >= maxPaths) { truncated = true; return; }
    if (sim.ended) {
      paths.push({ actions, outcome: "ending", ending: (sim.position as { ending: Id }).ending, state: sim.state });
      return;
    }
    const k = key(sim);
    if (seen.has(k)) return;
    seen.add(k);
    if (actions.length >= maxDepth) {
      truncated = true;
      paths.push({ actions, outcome: "truncated", at: sim.position, state: sim.state });
      return;
    }
    const options = sim.actions().filter((a) => a.available && (interactions || a.kind !== "interact"));
    if (!options.length) {
      const blocked = sim.actions().filter((a) => a.kind !== "interact").flatMap((a) => a.reasons);
      paths.push({
        actions, outcome: "stuck", at: sim.position, state: sim.state,
        message: blocked.length ? `No way forward: ${blocked.join("; ")}` : "No way forward",
      });
      return;
    }
    for (const a of options) {
      const branch = sim.fork();
      try {
        branch.act(a.id);
      } catch (e) {
        paths.push({ actions: [...actions, a.id], outcome: "error", at: sim.position, message: (e as Error).message, state: sim.state });
        continue;
      }
      walk(branch, [...actions, a.id]);
    }
  };

  const sim = new Simulator(index);
  try {
    sim.start();
    walk(sim, []);
  } catch (e) {
    paths.push({ actions: [], outcome: "error", message: (e as Error).message, state: initialState(index) });
  }

  const reached = new Set(paths.filter((p) => p.ending).map((p) => p.ending!));
  return {
    paths,
    endingsReached: [...reached],
    endingsMissed: project.endings.map((e) => e.id).filter((id) => !reached.has(id)),
    stuck: paths.filter((p) => p.outcome === "stuck"),
    errors: paths.filter((p) => p.outcome === "error"),
    truncated,
  };
}
