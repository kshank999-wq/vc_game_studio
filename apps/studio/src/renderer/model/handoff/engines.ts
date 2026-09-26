import type { EngineId, ObjectType } from '../types';
import type { HandoffIR } from './ir';

/**
 * Engine adapters. Each turns the engine-neutral handoff model into files for
 * one engine. Adding an engine means adding one adapter here; nothing in the
 * story model, the Bible or the handoff screen changes.
 */

export interface GeneratedFile {
  /** Relative to the engine project's root. */
  path: string;
  content: string;
  /** Runtime files are the same for every project; generated files come from the story. */
  kind: 'runtime' | 'generated';
}

export type OutputGroup = 'Story' | 'People + words' | 'World' | 'Logic';

/** One row of "what each element becomes": an element, or a whole-project item like the dialogue table. */
export interface ElementOutput {
  /** The element's object id, or a fixed key for whole-project outputs ('story', 'dialogue'). */
  id: string;
  label: string;
  symbol: ObjectType;
  group: OutputGroup;
  generates: string;
  files: string[];
  /** Changes whenever what this element generates changes (HANDOFF: Generated.hash). */
  fingerprint: string;
}

export interface EngineOutput {
  files: GeneratedFile[];
  elements: ElementOutput[];
}

export interface EngineAdapter {
  id: EngineId;
  name: string;
  /** Language and the engine-native form the data takes. */
  language: string;
  available: boolean;
  /** Inside the engine project. */
  defaultOutputPath: string;
  runtimeName: string;
  /** Once-per-project steps, shown on the handoff screen. */
  setup: string[];
  /** A line for adapters still to come. */
  plan?: string;
  generate?: (ir: HandoffIR, outputPath: string) => EngineOutput;
}

/** FNV-1a, 32 bit: a short, stable fingerprint for text. */
export const fingerprint = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};
