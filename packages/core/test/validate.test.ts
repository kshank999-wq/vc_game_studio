import { describe, expect, it } from "vitest";
import { validateProject, type GameProject } from "../src/index.js";
import { beat, example, scene } from "./helpers.js";

const codes = (p: GameProject) => validateProject(p).issues.filter((i) => i.severity !== "info").map((i) => i.code);

describe("validator", () => {
  it("accepts the example with no errors or warnings", () => {
    const r = validateProject(example());
    expect(r.issues.filter((i) => i.severity !== "info")).toEqual([]);
    expect(r.unused).toEqual(["lor_expedition"]);
  });

  it("flags duplicate ids", () => {
    const p = example();
    p.bible.items.push({ id: "itm_lantern", name: "Copy", category: "resource" });
    expect(codes(p)).toContain("duplicate-id");
  });

  it("flags missing and wrong-kind references", () => {
    const p = example();
    beat(p, "bt_descend").next = [{ to: { scene: "scn_nowhere" } }];
    beat(p, "bt_arrive").choices![0]!.effects!.push({ op: "give", item: "chr_mara" });
    const c = codes(p);
    expect(c).toContain("dangling-ref");
    expect(c).toContain("wrong-kind");
  });

  it("flags invalid expressions", () => {
    const p = example();
    beat(p, "bt_fork").choices![0]!.availableWhen = "has(itm_lantern) and";
    expect(codes(p)).toContain("expression");
  });

  it("flags dead ends and unreachable content", () => {
    const p = example();
    beat(p, "bt_collapse").next = [];
    p.scenes.push({
      ...structuredClone(scene(p, "scn_entrance")),
      id: "scn_orphan", name: "Orphan", entry: "bt_orphan", level: undefined,
      beats: [{ id: "bt_orphan", name: "Orphan", kind: "custom", lane: "spine", next: [{ to: { end: "end_lost" } }] }],
      elements: [], systemic: { objectives: [], triggers: [] },
    });
    const c = codes(p);
    expect(c).toContain("dead-end");
    expect(c).toContain("unreachable-scene");
  });

  it("flags loops that never reach an ending", () => {
    const p = example();
    beat(p, "bt_collapse").next = [{ to: { beat: "bt_squeeze" } }];
    beat(p, "bt_squeeze").choices = [{ id: "cho_loop", text: "Loop", to: { beat: "bt_collapse" } }];
    expect(codes(p)).toContain("no-ending");
  });

  it("flags branches that skip a required milestone", () => {
    const p = example();
    beat(p, "bt_find_key").choices![1]!.to = { end: "end_alone" };
    const r = validateProject(p);
    const issue = r.issues.find((i) => i.code === "milestone-bypassed")!;
    expect(issue.node).toBe("mil_vault");
    expect(issue.message).toMatch(/Heavy Pockets/);
  });

  it("allows failure endings to skip milestones", () => {
    const p = example();
    p.endings.find((e) => e.id === "end_lost")!.failure = false;
    expect(codes(p)).toContain("milestone-bypassed");
  });

  it("flags items that are required but never acquired", () => {
    const p = example();
    beat(p, "bt_find_key").onEnter = [];
    const r = validateProject(p);
    expect(r.issues.find((i) => i.code === "impossible-item")?.message).toMatch(/Vault Key/);
  });

  it("flags conditions on variables that never change", () => {
    const p = example();
    beat(p, "bt_fork").choices![0]!.effects = [];
    expect(codes(p)).toContain("constant-variable");
  });

  it("flags impossible object states and enum values", () => {
    const p = example();
    beat(p, "bt_door").choices![0]!.availableWhen = `state(obj_lever) == "raised"`;
    beat(p, "bt_fork").choices![1]!.effects = [{ op: "set", var: "var_approach", value: '"sneaky"' }];
    const r = validateProject(p);
    expect(r.issues.filter((i) => i.code === "invalid-state")[0]?.message).toMatch(/no state "raised"/);
    expect(r.issues.some((i) => i.code === "invalid-enum")).toBe(true);
  });

  it("survives renames because references use ids", () => {
    const p = example();
    p.bible.items.find((i) => i.id === "itm_lantern")!.name = "Brass Lamp";
    scene(p, "scn_vault").name = "Renamed";
    expect(codes(p)).toEqual([]);
  });
});
