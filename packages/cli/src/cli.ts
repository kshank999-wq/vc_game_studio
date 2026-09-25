#!/usr/bin/env node
/**
 * vcw — VC Writer command line.
 *
 *   vcw validate <project.json>   static checks
 *   vcw explore  <project.json>   walk every playthrough
 *   vcw play     <project.json>   interactive text simulation
 */

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import {
  explorePaths, indexProject, parseProjectFile, Simulator, validateProject, type GameProject,
} from "@vc/core";

function load(path: string | undefined): GameProject {
  if (!path) usage();
  return parseProjectFile(readFileSync(path, "utf8")).project;
}

function usage(): never {
  console.error("usage: vcw <validate|explore|play> <project.json>");
  process.exit(2);
}

function validate(project: GameProject): number {
  const report = validateProject(project);
  const icon = { error: "✖", warning: "⚠", info: "·" } as const;
  for (const i of report.issues) console.log(`${icon[i.severity]} [${i.code}] ${i.message}  (${i.node})`);
  console.log(`\n${report.errors} error(s), ${report.warnings} warning(s), ${report.unused.length} unused`);
  return report.errors ? 1 : 0;
}

function explore(project: GameProject): number {
  const index = indexProject(project);
  const r = explorePaths(project);
  console.log(`${r.paths.length} distinct playthrough(s)${r.truncated ? " (truncated)" : ""}`);
  for (const id of project.endings.map((e) => e.id)) {
    const n = r.paths.filter((p) => p.ending === id).length;
    console.log(`  ${n ? "✔" : "✖"} ${index.label(id)}: ${n} path(s)`);
  }
  for (const p of [...r.stuck, ...r.errors]) {
    const where = p.at && "beat" in p.at ? index.label(p.at.beat) : "?";
    console.log(`  ${p.outcome === "stuck" ? "⚠ stuck" : "✖ error"} at "${where}" after [${p.actions.map((a) => index.label(a)).join(" → ")}]: ${p.message}`);
  }
  return r.stuck.length || r.errors.length || r.endingsMissed.length ? 1 : 0;
}

async function play(project: GameProject): Promise<number> {
  const sim = new Simulator(project).start();
  const rl = createInterface({ input: process.stdin });
  let shown = 0;
  const flush = () => {
    for (const e of sim.events.slice(shown)) {
      if (e.type === "enter-scene") console.log(`\n=== ${e.message} ===`);
      else if (e.type === "enter-beat") {
        const beat = sim.index.beat(e.id)!;
        for (const l of beat.lines ?? []) console.log(`${sim.index.label(l.speaker)}: ${l.text}`);
      } else if (e.type === "warning") console.log(`⚠ ${e.message}`);
      else if (e.type === "ending") console.log(`\n*** ENDING: ${e.message} ***`);
      else if (e.type !== "choice") console.log(`  [${e.type}] ${e.message}`);
    }
    shown = sim.events.length;
  };
  const lines = rl[Symbol.asyncIterator]();
  while (!sim.ended) {
    flush();
    const actions = sim.actions();
    if (actions.length === 1 && actions[0]!.kind === "continue" && actions[0]!.available) {
      sim.act("continue");
      continue;
    }
    actions.forEach((a, i) =>
      console.log(`  ${i + 1}. ${a.label}${a.available ? "" : `  (unavailable: ${a.reasons.join("; ")})`}`),
    );
    process.stdout.write("> ");
    const next = await lines.next();
    if (next.done) break;
    const answer = next.value.trim();
    if (!process.stdin.isTTY) console.log(answer);
    if (answer === "q") break;
    if (answer === "s") { console.log(JSON.stringify({ ...sim.state, log: undefined }, null, 2)); continue; }
    const pick = actions[Number(answer) - 1];
    if (!pick) { console.log("Enter a number, s for state, q to quit"); continue; }
    try { sim.act(pick.id); } catch (e) { console.log(`✖ ${(e as Error).message}`); }
  }
  flush();
  rl.close();
  return 0;
}

const [cmd, file] = process.argv.slice(2);
const project = load(file);
const code = cmd === "validate" ? validate(project) : cmd === "explore" ? explore(project) : cmd === "play" ? await play(project) : usage();
process.exit(code);
