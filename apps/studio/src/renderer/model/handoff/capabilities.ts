import type { EngineId } from '../types';

/**
 * What each engine gets from an export (spec §14, the adapter capability
 * matrix): generated and working as exported, generated but needing to be
 * hooked up in the engine, or not generated at all. Kept in step with
 * docs/ENGINE-ADAPTERS.md, which says how each part works.
 */
export type Support = 'auto' | 'binding' | 'none';

export interface Capability {
  feature: string;
  engines: Record<EngineId, { support: Support; note?: string }>;
}

const all = (support: Support, note?: string) => ({ support, ...(note ? { note } : {}) });
const json = all('binding', 'In story.json; your runtime reads it (README.md says how)');

export const CAPABILITIES: readonly Capability[] = [
  {
    feature: 'Story graph and scene flow',
    engines: {
      godot: all('auto', 'A flow controller per scene; play_story.tscn plays it from the Beginning'),
      unity: all('binding', 'ScenePlayer and StoryWalker run it; add VcgsGame and a VcgsSceneFlow to your scenes'),
      unreal: all('binding', 'The subsystem runs it; add a VcgsSceneFlowComponent and answer its events'),
      custom: json,
    },
  },
  {
    feature: 'Conditions, effects, triggers and gates',
    engines: { godot: all('auto', 'rule_engine.gd'), unity: all('auto', 'Rules'), unreal: all('auto', 'vcgs::Rules'), custom: json },
  },
  {
    feature: 'Dialogue and VO cues',
    engines: {
      godot: all('auto', 'Dialogue table and VO cue list; placeholder scenes show the lines'),
      unity: all('binding', 'Lines arrive as ScenePlayer events; show them with your UI'),
      unreal: all('binding', 'OnDialogue gives speaker, text and direction; show them with your UI'),
      custom: json,
    },
  },
  {
    feature: 'Choices',
    engines: {
      godot: all('auto', 'A script per choice; placeholder scenes offer the options'),
      unity: all('binding', 'Rules offer the options; present them and call Choose'),
      unreal: all('binding', 'OnChoice offers the options; present them and call Choose'),
      custom: json,
    },
  },
  {
    feature: 'Characters, items, locations and cinematics as engine data',
    engines: {
      godot: all('auto', 'A .tres resource each'),
      unity: all('auto', 'A ScriptableObject .asset each'),
      unreal: all('binding', 'DataTable CSVs; run import_datatables.py in the editor once'),
      custom: json,
    },
  },
  {
    feature: 'Interactable objects',
    engines: {
      godot: all('auto', 'An interactable script per object, wired in placeholder scenes'),
      unity: all('binding', 'Add VcgsInteractable with the object’s key'),
      unreal: all('binding', 'Add UVcgsInteractableComponent with the object’s key'),
      custom: json,
    },
  },
  {
    feature: 'Placeholder scenes to play the story in',
    engines: { godot: all('auto', 'scenes/<scene>.tscn with stand-ins and an on-screen player'), unity: all('none'), unreal: all('none'), custom: all('none') },
  },
  {
    feature: 'Levels: graybox, items and their rules',
    engines: {
      godot: all('auto', 'A .tscn per level, and play_<level>.tscn to walk it'),
      unity: all('binding', 'Run VCGS › Update level from data… in the editor'),
      unreal: all('binding', 'Run build_level.py in the editor'),
      custom: json,
    },
  },
  {
    feature: 'Quests, lore, mechanics, skills, equipment and crafting',
    engines: { godot: all('auto'), unity: all('auto'), unreal: all('auto'), custom: json },
  },
  {
    feature: 'Puzzles (dependency graphs and screen puzzles)',
    engines: { godot: all('auto'), unity: all('auto'), unreal: all('auto'), custom: json },
  },
  {
    feature: 'NPC patrols and companions; darkness, light and fuel',
    engines: { godot: all('auto'), unity: all('auto'), unreal: all('auto'), custom: json },
  },
  {
    feature: 'Codex (people met, places, items, quests)',
    engines: {
      godot: all('auto', 'Press C in placeholder scenes'),
      unity: all('auto', 'The VcgsCodex screen'),
      unreal: all('auto', 'AVcgsCodexHUD'),
      custom: json,
    },
  },
  {
    feature: 'Saved games (one format for every engine)',
    engines: { godot: all('auto'), unity: all('auto'), unreal: all('auto'), custom: json },
  },
  {
    feature: 'Encounters: the fight itself',
    engines: {
      godot: all('binding', 'encounter_requested asks your game to play it, then win() or lose()'),
      unity: all('binding', 'EncounterRequested, then Win() or Lose()'),
      unreal: all('binding', 'OnEncounter, then Win or Lose'),
      custom: json,
    },
  },
  {
    feature: 'Cinematics: camera and animation',
    engines: {
      godot: all('binding', 'Shot lists and camera notes travel; build the shots in the engine'),
      unity: all('binding', 'Shot lists travel; build them in Timeline'),
      unreal: all('binding', 'Shot lists travel; build them in Sequencer'),
      custom: json,
    },
  },
];

export const SUPPORT_LABEL: Record<Support, string> = {
  auto: 'Generated, works as exported',
  binding: 'Generated, hook it up in the engine',
  none: 'Not generated',
};
