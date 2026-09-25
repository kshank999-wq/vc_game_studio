import { describe, expect, it } from "vitest";
import {
  contentHash, FormatError, implementationHooks, indexProject, newId, parseProjectFile,
  SCHEMA_VERSION, serializeProject, type ImplementationBinding,
} from "../src/index.js";
import { example } from "./helpers.js";

describe("project file", () => {
  it("round-trips", () => {
    const p = example();
    const file = parseProjectFile(serializeProject(p));
    expect(file.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.project).toEqual(p);
  });

  it("rejects other formats and newer schema versions", () => {
    expect(() => parseProjectFile({ format: "other" })).toThrow(FormatError);
    expect(() => parseProjectFile({ format: "vc-writer-project", schemaVersion: SCHEMA_VERSION + 1, project: {} }))
      .toThrow(/supports up to/);
  });

  it("generates prefixed unique ids", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId("scene")));
    expect(ids.size).toBe(500);
    expect([...ids][0]).toMatch(/^scn_[0-9a-z]{12}$/);
  });
});

describe("Game Studio handoff", () => {
  const bind = (p: ReturnType<typeof example>, source: string, complete = true): ImplementationBinding => {
    const entry = indexProject(p).get(source)!;
    return { source, sourceKind: entry.kind, engine: "godot", target: `res://${source}.tscn`, sourceHash: contentHash(entry.node), complete };
  };

  it("lists every authored hook as unbound initially", () => {
    const hooks = implementationHooks(example());
    const byKind = (k: string) => hooks.filter((h) => h.kind === k).map((h) => h.id);
    expect(byKind("scene")).toEqual(["scn_entrance", "scn_tunnel", "scn_vault"]);
    expect(byKind("object")).toEqual(["obj_lever"]);
    expect(byKind("puzzle")).toEqual(["pzl_vault_door"]);
    expect(byKind("cinematic")).toEqual(["cin_vault_reveal"]);
    expect(byKind("trigger")).toEqual(["trg_oil_low"]);
    expect(hooks.every((h) => h.status === "unbound")).toBe(true);
  });

  it("tracks implemented, partial, needs-update and conflict", () => {
    const p = example();
    const bindings = [bind(p, "obj_lever"), bind(p, "pzl_vault_door", false), bind(p, "itm_lantern"), bind(p, "itm_vault_key")];
    p.bible.items.find((i) => i.id === "itm_lantern")!.equippable = false;
    p.bible.items = p.bible.items.filter((i) => i.id !== "itm_vault_key");

    const status = Object.fromEntries(implementationHooks(p, bindings).map((h) => [h.id, h.status]));
    expect(status.obj_lever).toBe("implemented");
    expect(status.pzl_vault_door).toBe("partial");
    expect(status.itm_lantern).toBe("needs-update");
    expect(status.itm_vault_key).toBe("conflict");
    expect(status.scn_vault).toBe("unbound");
  });

  it("hashes content independent of key order", () => {
    expect(contentHash({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(contentHash({ b: [1, { d: 3, c: 2 }], a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});
