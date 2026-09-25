/**
 * Condition expressions used by gates, choices, transitions and triggers.
 *
 *   has(itm_lantern) and rel(rel_mara) >= 2
 *   var_torch_fuel > 0 || chose(cho_take_rope)
 *   objective(obj_find_vault) == "done"
 *
 * Bare identifiers are variable ids. Functions take a single entity id.
 * `and`/`or`/`not` are accepted as aliases for `&&`/`||`/`!` so writers do
 * not need to know programming syntax. There is no `eval`: expressions are
 * parsed into an AST that tooling can inspect, explain and translate.
 */

import type { Value } from "./schema.js";

export type BinOp =
  | "||" | "&&"
  | "==" | "!="
  | "<" | "<=" | ">" | ">="
  | "+" | "-" | "*" | "/" | "%";

export type Expr =
  | { k: "lit"; v: Value }
  | { k: "var"; id: string }
  | { k: "call"; fn: RefFunction; arg: string }
  | { k: "not"; a: Expr }
  | { k: "neg"; a: Expr }
  | { k: "bin"; op: BinOp; a: Expr; b: Expr };

/** Built-in functions, each taking the id of the entity it inspects. */
export const REF_FUNCTIONS = {
  has: "item",
  count: "item",
  rel: "relationship",
  chose: "choice",
  visited: "node",
  objective: "objective",
  solved: "puzzle",
  state: "object",
} as const;

export type RefFunction = keyof typeof REF_FUNCTIONS;

export class ExprError extends Error {
  constructor(message: string, public readonly source: string, public readonly pos: number) {
    super(`${message} at position ${pos} in "${source}"`);
  }
}

type Token =
  | { t: "num"; v: number; pos: number }
  | { t: "str"; v: string; pos: number }
  | { t: "id"; v: string; pos: number }
  | { t: "op"; v: string; pos: number }
  | { t: "eof"; pos: number };

const OPERATORS = ["&&", "||", "==", "!=", "<=", ">=", "<", ">", "!", "+", "-", "*", "/", "%", "(", ")"];
const KEYWORD_OPS: Record<string, string> = { and: "&&", or: "||", not: "!" };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))!;
      out.push({ t: "num", v: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i++;
      let s = "";
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\" && i + 1 < src.length) i++;
        s += src[i++];
      }
      if (i >= src.length) throw new ExprError("Unterminated string", src, start);
      i++;
      out.push({ t: "str", v: s, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      const word = m[0];
      if (word in KEYWORD_OPS) out.push({ t: "op", v: KEYWORD_OPS[word]!, pos: i });
      else out.push({ t: "id", v: word, pos: i });
      i += word.length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`Unexpected character "${c}"`, src, i);
    out.push({ t: "op", v: op, pos: i });
    i += op.length;
  }
  out.push({ t: "eof", pos: src.length });
  return out;
}

const PRECEDENCE: Record<string, number> = {
  "||": 1, "&&": 2,
  "==": 3, "!=": 3,
  "<": 4, "<=": 4, ">": 4, ">=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
};

const cache = new Map<string, Expr>();

/** Parse an expression. Results are cached by source text. */
export function parseExpr(src: string): Expr {
  const hit = cache.get(src);
  if (hit) return hit;
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p]!;
  const next = () => tokens[p++]!;

  function expectOp(v: string) {
    const tok = next();
    if (tok.t !== "op" || tok.v !== v) throw new ExprError(`Expected "${v}"`, src, tok.pos);
  }

  function primary(): Expr {
    const tok = next();
    switch (tok.t) {
      case "num": return { k: "lit", v: tok.v };
      case "str": return { k: "lit", v: tok.v };
      case "id": {
        if (tok.v === "true") return { k: "lit", v: true };
        if (tok.v === "false") return { k: "lit", v: false };
        if (tok.v === "null") return { k: "lit", v: null };
        const after = peek();
        if (after.t === "op" && after.v === "(") {
          if (!(tok.v in REF_FUNCTIONS)) throw new ExprError(`Unknown function "${tok.v}"`, src, tok.pos);
          next();
          const arg = next();
          if (arg.t !== "id") throw new ExprError(`${tok.v}() takes an id`, src, arg.pos);
          expectOp(")");
          return { k: "call", fn: tok.v as RefFunction, arg: arg.v };
        }
        return { k: "var", id: tok.v };
      }
      case "op":
        if (tok.v === "(") {
          const e = binary(0);
          expectOp(")");
          return e;
        }
        if (tok.v === "!") return { k: "not", a: binary(7) };
        if (tok.v === "-") return { k: "neg", a: binary(7) };
        throw new ExprError(`Unexpected "${tok.v}"`, src, tok.pos);
      case "eof":
        throw new ExprError("Unexpected end of expression", src, tok.pos);
    }
  }

  function binary(minPrec: number): Expr {
    let left = primary();
    for (;;) {
      const tok = peek();
      if (tok.t !== "op") break;
      const prec = PRECEDENCE[tok.v];
      if (prec === undefined || prec <= minPrec) break;
      next();
      left = { k: "bin", op: tok.v as BinOp, a: left, b: binary(prec) };
    }
    return left;
  }

  const expr = binary(0);
  const end = peek();
  if (end.t !== "eof") throw new ExprError("Unexpected trailing input", src, end.pos);
  cache.set(src, expr);
  return expr;
}

/** What an expression needs from the runtime. */
export interface EvalContext {
  variable(id: string): Value;
  call(fn: RefFunction, id: string): Value;
  /** Display name for an id, used in explanations. */
  label?(id: string): string;
}

export function truthy(v: Value): boolean {
  return v !== null && v !== false && v !== 0 && v !== "";
}

export function evaluate(expr: Expr, ctx: EvalContext): Value {
  switch (expr.k) {
    case "lit": return expr.v;
    case "var": return ctx.variable(expr.id);
    case "call": return ctx.call(expr.fn, expr.arg);
    case "not": return !truthy(evaluate(expr.a, ctx));
    case "neg": return -num(evaluate(expr.a, ctx));
    case "bin": {
      if (expr.op === "&&") return truthy(evaluate(expr.a, ctx)) && truthy(evaluate(expr.b, ctx));
      if (expr.op === "||") return truthy(evaluate(expr.a, ctx)) || truthy(evaluate(expr.b, ctx));
      const a = evaluate(expr.a, ctx);
      const b = evaluate(expr.b, ctx);
      switch (expr.op) {
        case "==": return a === b;
        case "!=": return a !== b;
        case "<": return num(a) < num(b);
        case "<=": return num(a) <= num(b);
        case ">": return num(a) > num(b);
        case ">=": return num(a) >= num(b);
        case "+": return typeof a === "string" || typeof b === "string" ? `${a}${b}` : num(a) + num(b);
        case "-": return num(a) - num(b);
        case "*": return num(a) * num(b);
        case "/": return num(b) === 0 ? 0 : num(a) / num(b);
        case "%": return num(b) === 0 ? 0 : num(a) % num(b);
      }
    }
  }
}

function num(v: Value): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return 0;
}

/** Render an expression back to source, using labels for ids if provided. */
export function formatExpr(expr: Expr, label: (id: string) => string = (id) => id): string {
  switch (expr.k) {
    case "lit": return typeof expr.v === "string" ? JSON.stringify(expr.v) : String(expr.v);
    case "var": return label(expr.id);
    case "call": return `${expr.fn}(${label(expr.arg)})`;
    case "not": return `not ${wrap(expr.a, label)}`;
    case "neg": return `-${wrap(expr.a, label)}`;
    case "bin": {
      const op = expr.op === "&&" ? "and" : expr.op === "||" ? "or" : expr.op;
      return `${wrap(expr.a, label)} ${op} ${wrap(expr.b, label)}`;
    }
  }
}

function wrap(e: Expr, label: (id: string) => string): string {
  const s = formatExpr(e, label);
  return e.k === "bin" ? `(${s})` : s;
}

/**
 * Explain why a condition is false: the smallest failing sub-conditions,
 * with current values. Answers "why is this choice unavailable?".
 */
export function explainFailure(expr: Expr, ctx: EvalContext): string[] {
  const label = ctx.label ?? ((id: string) => id);
  if (truthy(evaluate(expr, ctx))) return [];
  if (expr.k === "bin" && expr.op === "&&") {
    return [...explainFailure(expr.a, ctx), ...explainFailure(expr.b, ctx)];
  }
  if (expr.k === "bin" && expr.op === "||") {
    return [`none of: ${formatExpr(expr.a, label)} | ${formatExpr(expr.b, label)}`];
  }
  if (expr.k === "var" || expr.k === "call") {
    const v = evaluate(expr, ctx);
    return [`${formatExpr(expr, label)} is ${typeof v === "string" ? JSON.stringify(v) : String(v)}`];
  }
  const current = describeValues(expr, ctx, label);
  return [formatExpr(expr, label) + (current ? ` (${current})` : "")];
}

function describeValues(expr: Expr, ctx: EvalContext, label: (id: string) => string): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  walk(expr, (e) => {
    if (e.k !== "var" && e.k !== "call") return;
    const key = e.k === "var" ? label(e.id) : `${e.fn}(${label(e.arg)})`;
    if (seen.has(key)) return;
    seen.add(key);
    const v = evaluate(e, ctx);
    parts.push(`${key} = ${typeof v === "string" ? JSON.stringify(v) : String(v)}`);
  });
  return parts.join(", ");
}

export function walk(expr: Expr, visit: (e: Expr) => void): void {
  visit(expr);
  if (expr.k === "not" || expr.k === "neg") walk(expr.a, visit);
  else if (expr.k === "bin") { walk(expr.a, visit); walk(expr.b, visit); }
}

export interface ExprRef {
  /** "variable", or the entity kind a ref function inspects. */
  kind: "variable" | (typeof REF_FUNCTIONS)[RefFunction];
  id: string;
  fn?: RefFunction;
}

/** Every id an expression reads. */
export function exprRefs(expr: Expr): ExprRef[] {
  const refs: ExprRef[] = [];
  walk(expr, (e) => {
    if (e.k === "var") refs.push({ kind: "variable", id: e.id });
    else if (e.k === "call") refs.push({ kind: REF_FUNCTIONS[e.fn], id: e.arg, fn: e.fn });
  });
  return refs;
}
