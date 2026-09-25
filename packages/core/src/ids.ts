/**
 * Stable id generation. Ids are opaque: `<prefix>_<random>`. The prefix only
 * helps humans reading raw files; code must never parse meaning out of it.
 */

export const ID_PREFIX = {
  project: "prj", character: "chr", faction: "fac", relationship: "rel",
  location: "loc", item: "itm", ability: "abl", object: "obj", verb: "vrb",
  puzzle: "pzl", quest: "qst", lore: "lor", variable: "var", milestone: "mil",
  level: "lvl", scene: "scn", beat: "bt", choice: "cho", objective: "objv",
  trigger: "trg", element: "el", behavior: "bhv", cinematic: "cin", shot: "sht",
  ending: "end",
} as const;

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function newId(kind: keyof typeof ID_PREFIX): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${ID_PREFIX[kind]}_${s}`;
}
