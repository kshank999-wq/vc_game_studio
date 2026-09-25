import { describe, expect, it } from "vitest";
import { explorePaths, Simulator } from "../src/index.js";
import { beat, example } from "./helpers.js";

describe("simulator", () => {
  it("plays through to the shared ending", () => {
    const sim = new Simulator(example()).start();
    expect(sim.beat?.id).toBe("bt_arrive");
    sim.act("cho_take_lantern").act("continue").act("cho_lit_path").act("cho_show_key");
    expect(sim.scene?.id).toBe("scn_vault");

    const turnKey = sim.actions().find((a) => a.id === "cho_use_key")!;
    expect(turnKey.available).toBe(false);
    expect(turnKey.reasons).toEqual([`state(Rusted Lever) == "up" (state(Rusted Lever) = "down")`]);

    sim.act("obj_lever:vrb_pull_lever").act("cho_use_key").act("continue");
    expect(sim.position).toEqual({ ending: "end_shared" });
    expect(sim.state.objectives).toMatchObject({ objv_enter: "done", objv_open_vault: "done" });
    expect(sim.events.filter((e) => e.type === "warning")).toEqual([]);
    expect(sim.events.some((e) => e.type === "cinematic" && e.id === "cin_vault_reveal")).toBe(true);
    expect(sim.events.some((e) => e.type === "trigger" && e.id === "trg_oil_low")).toBe(true);
  });

  it("enforces mutually exclusive choices", () => {
    const p = example();
    const arrive = beat(p, "bt_arrive");
    arrive.choices![0]!.to = { beat: "bt_arrive" };
    arrive.choices![0]!.frequency = "repeatable";
    const sim = new Simulator(p).start().act("cho_take_lantern");
    const leave = sim.actions().find((a) => a.id === "cho_leave_lantern")!;
    expect(leave.available).toBe(false);
    expect(leave.reasons).toContain(`excluded by "Take the old lantern"`);
  });

  it("hides unavailable choices marked hide", () => {
    const p = example();
    beat(p, "bt_fork").choices![0]!.whenUnavailable = "hide";
    const sim = new Simulator(p).start().act("cho_leave_lantern").act("continue");
    expect(sim.actions().map((a) => a.id)).toEqual(["cho_crawl"]);
  });

  it("refuses unavailable actions with the reason", () => {
    const sim = new Simulator(example()).start().act("cho_leave_lantern").act("continue");
    expect(() => sim.act("cho_lit_path")).toThrow(/has\(Old Lantern\) is false/);
  });

  it("warns when leaving a scene before its completion condition", () => {
    const p = example();
    beat(p, "bt_descend").onEnter = [];
    const sim = new Simulator(p).start().act("cho_take_lantern").act("continue");
    expect(sim.events.find((e) => e.type === "warning")?.message).toMatch(/Left "The Cave Mouth" before completing it/);
  });
});

describe("path explorer", () => {
  it("reaches every ending of the example", () => {
    const r = explorePaths(example());
    expect(r.endingsMissed).toEqual([]);
    expect(r.stuck).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.paths.length).toBe(6);
  });

  it("finds a gate that no playthrough can open", () => {
    const p = example();
    // The lever can no longer be pulled, so the door can never be opened.
    p.bible.objects[0]!.verbs[0]!.availableWhen = "false";
    const r = explorePaths(p);
    expect(r.stuck.length).toBeGreaterThan(0);
    expect(r.stuck[0]!.at).toEqual({ scene: "scn_vault", beat: "bt_door" });
    expect(r.endingsMissed.sort()).toEqual(["end_alone", "end_shared"]);
  });

  it("reports invalid mutations as errors", () => {
    const p = example();
    beat(p, "bt_find_key").onEnter = [];
    // Turning a key the player never received.
    beat(p, "bt_door").choices![0]!.availableWhen = `state(obj_lever) == "up"`;
    const r = explorePaths(p);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]!.message).toMatch(/Cannot take 1 × "Vault Key"/);
  });
});
