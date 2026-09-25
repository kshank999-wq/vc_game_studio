/**
 * The versioned VC Writer project file. VC Game Studio opens the same file,
 * so this is also the handoff format: the full structured graph, plus
 * implementation bindings kept separate from the narrative content.
 */

import type { ImplementationBinding } from "./handoff.js";
import type { GameProject } from "./schema.js";

export const FORMAT = "vc-writer-project";
export const SCHEMA_VERSION = 1;

export interface ProjectFile {
  format: typeof FORMAT;
  schemaVersion: number;
  project: GameProject;
  /** Added by VC Game Studio; VC Writer preserves them untouched. */
  bindings?: ImplementationBinding[];
}

/**
 * Upgrades from version N to N+1. Add an entry whenever the schema changes;
 * never edit an existing one, so old projects always open.
 */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

export class FormatError extends Error {}

export function parseProjectFile(input: string | unknown): ProjectFile {
  let doc = (typeof input === "string" ? JSON.parse(input) : input) as Record<string, unknown>;
  if (!doc || doc.format !== FORMAT) throw new FormatError(`Not a VC Writer project (expected format "${FORMAT}")`);
  let version = doc.schemaVersion;
  if (typeof version !== "number") throw new FormatError("Missing schemaVersion");
  if (version > SCHEMA_VERSION) {
    throw new FormatError(`Project uses schema v${version}; this version of VC Writer supports up to v${SCHEMA_VERSION}`);
  }
  while (version < SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new FormatError(`No migration from schema v${version}`);
    doc = migrate(doc);
    version++;
    doc.schemaVersion = version;
  }
  return doc as unknown as ProjectFile;
}

export function serializeProject(project: GameProject, bindings?: ImplementationBinding[]): string {
  const file: ProjectFile = { format: FORMAT, schemaVersion: SCHEMA_VERSION, project };
  if (bindings?.length) file.bindings = bindings;
  return JSON.stringify(file, null, 2) + "\n";
}
