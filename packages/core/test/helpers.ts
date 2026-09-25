import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseProjectFile, type GameProject } from "../src/index.js";

const EXAMPLE = fileURLToPath(new URL("../../../examples/sunken-vault.game.json", import.meta.url));

/** A fresh, mutable copy of the Sunken Vault example project. */
export function example(): GameProject {
  return parseProjectFile(readFileSync(EXAMPLE, "utf8")).project;
}

export function scene(p: GameProject, id: string) {
  return p.scenes.find((s) => s.id === id)!;
}

export function beat(p: GameProject, id: string) {
  return p.scenes.flatMap((s) => s.beats).find((b) => b.id === id)!;
}
