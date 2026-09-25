import { describe, expect, it } from "vitest";
import { evaluate, explainFailure, exprRefs, formatExpr, parseExpr, type EvalContext } from "../src/index.js";

const ctx = (vars: Record<string, unknown>, calls: Record<string, unknown> = {}): EvalContext => ({
  variable: (id) => vars[id] as never,
  call: (fn, id) => calls[`${fn}:${id}`] as never,
  label: (id) => id.toUpperCase(),
});

describe("expressions", () => {
  it("respects precedence", () => {
    expect(evaluate(parseExpr("1 + 2 * 3 == 7 && !false"), ctx({}))).toBe(true);
    expect(evaluate(parseExpr("(1 + 2) * 3"), ctx({}))).toBe(9);
    expect(evaluate(parseExpr("-a + 5"), ctx({ a: 2 }))).toBe(3);
  });

  it("accepts writer-friendly keywords", () => {
    const e = parseExpr("not locked and (trust >= 2 or has(itm_key))");
    expect(evaluate(e, ctx({ locked: false, trust: 0 }, { "has:itm_key": true }))).toBe(true);
    expect(evaluate(e, ctx({ locked: false, trust: 0 }, { "has:itm_key": false }))).toBe(false);
  });

  it("compares strings", () => {
    expect(evaluate(parseExpr(`state(obj_door) == "open"`), ctx({}, { "state:obj_door": "open" }))).toBe(true);
    expect(evaluate(parseExpr(`'a' + "b" == "ab"`), ctx({}))).toBe(true);
  });

  it("reports syntax errors with position", () => {
    expect(() => parseExpr("a >= ")).toThrow(/end of expression/);
    expect(() => parseExpr("launch(itm_x)")).toThrow(/Unknown function "launch"/);
    expect(() => parseExpr("has(1)")).toThrow(/takes an id/);
    expect(() => parseExpr('"open')).toThrow(/Unterminated string/);
    expect(() => parseExpr("a b")).toThrow(/trailing input/);
  });

  it("lists referenced ids by kind", () => {
    const refs = exprRefs(parseExpr("var_a > 1 and rel(rel_m) < 0 or chose(cho_x)"));
    expect(refs).toEqual([
      { kind: "variable", id: "var_a" },
      { kind: "relationship", id: "rel_m", fn: "rel" },
      { kind: "choice", id: "cho_x", fn: "chose" },
    ]);
  });

  it("explains only the failing parts of a condition", () => {
    const e = parseExpr("has(itm_lantern) and oil > 0 and trust >= 1");
    const why = explainFailure(e, ctx({ oil: 0, trust: 3 }, { "has:itm_lantern": false }));
    expect(why).toEqual(["has(ITM_LANTERN) is false", "OIL > 0 (OIL = 0)"]);
    expect(explainFailure(e, ctx({ oil: 1, trust: 3 }, { "has:itm_lantern": true }))).toEqual([]);
  });

  it("formats back to readable source", () => {
    const src = "!(a && b) || c == 'x'";
    const formatted = formatExpr(parseExpr(src));
    expect(formatted).toBe(`not (a and b) or (c == "x")`);
    expect(parseExpr(formatted)).toEqual(parseExpr(src));
  });
});
