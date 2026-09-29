import type { ObjectType } from '../types';

/**
 * Starting category sets (Note Sorter spec §5). The designer can make any
 * categories by hand; a template only adds the ones not already there. Each
 * category knows what its cards usually become, which is how Convert knows
 * what to suggest — a suggestion, never a choice made for the designer.
 */
export interface TemplateCategory {
  key: string;
  name: string;
  becomes?: ObjectType;
  /** Subcategories it starts with. */
  children?: { key: string; name: string; becomes?: ObjectType }[];
}

export interface Template {
  key: string;
  name: string;
  categories: TemplateCategory[];
}

/** Every category spec §5 names, and what its cards usually become. */
export const CATEGORY_TYPES: Record<string, ObjectType | undefined> = {
  lore: 'lore',
  eras: 'lore',
  characters: 'character',
  npcs: 'character',
  relationships: 'character',
  factions: 'character',
  companions: 'character',
  locations: 'environment',
  levels: 'environment',
  environment: 'environment',
  scenes: 'scene',
  objectives: 'quest',
  quests: 'quest',
  obstacles: 'gate',
  choices: 'choice',
  dialogue: 'dialogue',
  cinematics: 'cinematic',
  mechanics: 'mechanic',
  combat: 'mechanic',
  powers: 'mechanic',
  progression: 'mechanic',
  weapons: 'inventory',
  inventory: 'inventory',
  economy: 'inventory',
  puzzles: 'puzzle',
  smartObjects: 'object',
  encounters: 'encounter',
  enemies: 'encounter',
  stateVariables: 'state',
  gates: 'gate',
  triggers: 'trigger',
  audio: undefined,
};

const c = (key: string, name: string, children?: TemplateCategory['children']): TemplateCategory => ({
  key,
  name,
  ...(CATEGORY_TYPES[key] ? { becomes: CATEGORY_TYPES[key] } : {}),
  ...(children ? { children } : {}),
});
const sub = (key: string, name: string, becomes?: ObjectType) => ({ key, name, ...(becomes ? { becomes } : {}) });

export const TEMPLATES: readonly Template[] = [
  {
    key: 'action-adventure',
    name: 'Action-adventure',
    categories: [
      c('lore', 'Lore', [sub('eras', 'Eras', 'lore')]),
      c('characters', 'Characters'),
      c('mechanics', 'Mechanics', [sub('movement', 'Movement', 'mechanic'), sub('powers', 'Powers', 'mechanic')]),
      c('inventory', 'Inventory & Powers'),
      c('choices', 'Choices'),
      c('levels', 'Levels'),
      c('cinematics', 'Cinematics'),
      c('dialogue', 'Dialogue'),
      c('enemies', 'Enemies'),
    ],
  },
  {
    key: 'narrative',
    name: 'Narrative',
    categories: [
      c('lore', 'Lore', [sub('eras', 'Eras', 'lore')]),
      c('characters', 'Characters', [sub('relationships', 'Relationships', 'character'), sub('factions', 'Factions', 'character')]),
      c('scenes', 'Scenes'),
      c('choices', 'Choices'),
      c('dialogue', 'Dialogue'),
      c('cinematics', 'Cinematics'),
      c('quests', 'Quests'),
      c('locations', 'Locations'),
    ],
  },
  {
    key: 'systems',
    name: 'Systems',
    categories: [
      c('mechanics', 'Mechanics', [sub('combat', 'Combat', 'mechanic'), sub('powers', 'Powers', 'mechanic')]),
      c('weapons', 'Weapons'),
      c('inventory', 'Inventory'),
      c('economy', 'Economy'),
      c('puzzles', 'Puzzles'),
      c('smartObjects', 'Smart Objects'),
      c('encounters', 'Encounters'),
      c('stateVariables', 'State Variables'),
      c('gates', 'Gates'),
      c('triggers', 'Triggers'),
      c('progression', 'Player Progression'),
    ],
  },
  {
    key: 'everything',
    name: 'Everything in spec §5',
    categories: [
      c('lore', 'Lore'),
      c('eras', 'Eras'),
      c('characters', 'Characters'),
      c('npcs', 'NPCs'),
      c('relationships', 'Relationships'),
      c('factions', 'Factions'),
      c('locations', 'Locations'),
      c('levels', 'Levels'),
      c('scenes', 'Scenes'),
      c('objectives', 'Objectives'),
      c('obstacles', 'Obstacles'),
      c('choices', 'Choices'),
      c('dialogue', 'Dialogue'),
      c('cinematics', 'Cinematics'),
      c('mechanics', 'Mechanics'),
      c('combat', 'Combat'),
      c('powers', 'Powers'),
      c('weapons', 'Weapons'),
      c('inventory', 'Inventory'),
      c('economy', 'Economy'),
      c('puzzles', 'Puzzles'),
      c('smartObjects', 'Smart Objects'),
      c('encounters', 'Encounters'),
      c('enemies', 'Enemies'),
      c('companions', 'Companions'),
      c('quests', 'Quests'),
      c('stateVariables', 'State Variables'),
      c('gates', 'Gates'),
      c('triggers', 'Triggers'),
      c('audio', 'Audio'),
      c('environment', 'Environment'),
      c('progression', 'Player Progression'),
    ],
  },
];
