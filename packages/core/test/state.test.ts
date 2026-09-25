import { describe, expect, it } from "vitest";
import { applyMutations, indexProject, initialState, MutationError } from "../src/index.js";
import { example } from "./helpers.js";

describe("runtime state", () => {
  const index = indexProject(example());
  const fresh = () => initialState(index);

  it("initializes from the project", () => {
    const s = fresh();
    expect(s.vars).toEqual({ var_lantern_oil: 3, var_approach: "none" });
    expect(s.relationships.rel_mara).toBe(0);
    expect(s.objects.obj_lever).toBe("down");
    expect(s.objectives.objv_open_vault).toBe("inactive");
  });

  it("logs each change with its source node", () => {
    const s = applyMutations(index, fresh(), [
      { op: "give", item: "itm_lantern" },
      { op: "add", var: "var_lantern_oil", amount: -1 },
    ], "cho_x");
    expect(s.inventory.itm_lantern).toBe(1);
    expect(s.log).toEqual([
      { key: "item:itm_lantern", before: 0, after: 1, source: "cho_x", op: "give" },
      { key: "var:var_lantern_oil", before: 3, after: 2, source: "cho_x", op: "add" },
    ]);
  });

  it("is atomic: a failing mutation leaves state untouched", () => {
    const s = fresh();
    expect(() => applyMutations(index, s, [
      { op: "give", item: "itm_lantern" },
      { op: "take", item: "itm_vault_key" },
    ], "cho_x")).toThrow(MutationError);
    expect(s.inventory).toEqual({});
    expect(s.log).toEqual([]);
  });

  it("clamps numbers and caps non-stackable items", () => {
    const s = applyMutations(index, fresh(), [
      { op: "add", var: "var_lantern_oil", amount: 99 },
      { op: "relationship", relationship: "rel_mara", delta: -99 },
      { op: "give", item: "itm_lantern", qty: 3 },
    ], "x");
    expect(s.vars.var_lantern_oil).toBe(5);
    expect(s.relationships.rel_mara).toBe(-5);
    expect(s.inventory.itm_lantern).toBe(1);
  });

  it("rejects values outside a variable's type", () => {
    expect(() => applyMutations(index, fresh(), [{ op: "set", var: "var_approach", value: '"reckless"' }], "x"))
      .toThrow(/not a valid enum/);
    expect(() => applyMutations(index, fresh(), [{ op: "object", object: "obj_lever", state: "sideways" }], "x"))
      .toThrow(/no state "sideways"/);
  });

  it("evaluates set values against current state", () => {
    const s = applyMutations(index, fresh(), [{ op: "set", var: "var_lantern_oil", value: "var_lantern_oil * 2 - 1" }], "x");
    expect(s.vars.var_lantern_oil).toBe(5);
  });

  it("runs puzzle onSolve effects, attributed to the puzzle", () => {
    const s = applyMutations(index, fresh(), [{ op: "puzzle", puzzle: "pzl_vault_door", status: "solved" }], "cho_use_key");
    expect(s.objectives.objv_open_vault).toBe("done");
    expect(s.log.map((c) => c.source)).toEqual(["cho_use_key", "pzl_vault_door"]);
  });
});
