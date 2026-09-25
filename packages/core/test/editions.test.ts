import { describe, expect, it } from "vitest";
import {
  conditionFeature, editionFor, hasFeature, issuesForEdition, lockedContent, validateProject,
} from "../src/index.js";
import { beat, example } from "./helpers.js";

describe("editions", () => {
  it("nests features: lite ⊂ writer ⊂ studio", () => {
    expect(hasFeature("lite", "choices")).toBe(true);
    expect(hasFeature("lite", "puzzles")).toBe(false);
    expect(hasFeature("writer", "puzzles")).toBe(true);
    expect(hasFeature("writer", "engine-export")).toBe(false);
    expect(hasFeature("studio", "engine-export")).toBe(true);
    expect(editionFor("cinematics")).toBe("writer");
    expect(editionFor("implementation")).toBe("studio");
  });

  it("classifies conditions as simple or advanced", () => {
    const p = example();
    expect(conditionFeature("has(itm_lantern) and not chose(cho_force)", p)).toBe("simple-conditions");
    expect(conditionFeature("rel(rel_mara) >= 1", p)).toBe("advanced-conditions");
    expect(conditionFeature("var_lantern_oil > 0", p)).toBe("advanced-conditions");
    expect(conditionFeature(`state(obj_lever) == "up"`, p)).toBe("advanced-conditions");
  });

  it("locks full-edition content in lite without losing it", () => {
    const p = example();
    const before = JSON.stringify(p);
    const locked = lockedContent(p, "lite");
    const ids = (f: string) => locked.filter((l) => l.feature === f).map((l) => l.id);
    expect(ids("relationships")).toContain("rel_mara");
    expect(ids("relationships")).toContain("cho_take_lantern");
    expect(ids("puzzles")).toEqual(expect.arrayContaining(["pzl_vault_door", "bt_door", "cho_use_key"]));
    expect(ids("cinematics")).toEqual(expect.arrayContaining(["cin_vault_reveal", "bt_reveal"]));
    expect(ids("advanced-conditions")).toContain("cho_lit_path");
    expect(ids("triggers")).toEqual(["trg_oil_low"]);
    expect(JSON.stringify(p)).toBe(before);
    expect(lockedContent(p, "writer")).toEqual([]);
  });

  it("keeps a lite-only story unlocked", () => {
    const p = example();
    const arrive = beat(p, "bt_arrive");
    arrive.choices = arrive.choices!.map((c) => ({ ...c, effects: c.effects?.filter((m) => m.op === "give") }));
    expect(lockedContent(p, "lite").map((l) => l.id)).not.toContain("cho_take_lantern");
  });

  it("limits validation to basic checks in lite", () => {
    const p = example();
    beat(p, "bt_find_key").choices![1]!.to = { end: "end_alone" };
    const issues = validateProject(p).issues;
    expect(issues.some((i) => i.code === "milestone-bypassed")).toBe(true);
    expect(issuesForEdition(issues, "lite").some((i) => i.code === "milestone-bypassed")).toBe(false);
    expect(issuesForEdition(issues, "writer")).toEqual(issues);
  });
});
