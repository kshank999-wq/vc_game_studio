import type { LaneKind, ObjectType } from './types';

/**
 * The fixed semantic mapping (HANDOFF, "Fixed semantic mapping"). Colour and
 * shape both carry the meaning; neither is used alone.
 */
export const COLORS = {
  spine: '#C9A45C',
  spineLine: '#8A6F2F',
  scene: '#4FA39A',
  cinematic: '#9A7FC0',
  dialogue: '#E08A5A',
  choice: '#F2C230',
  object: '#4A86D8',
  environment: '#6FAE5E',
  inventory: '#6CC4D6',
  puzzle: '#E07BB0',
  logic: '#C8BFAE',
  subplot: '#8FA8C4',
  error: '#E5484D',
} as const;

/** Colours handed to new character lanes, in order. */
export const CHARACTER_COLORS = ['#D9607A', '#E8E0C8', '#8FB0A0', '#D98E4F', '#B07FD9', '#6FB7D9'] as const;

export const TYPE_LABEL: Record<ObjectType, string> = {
  begin: 'Begin',
  end: 'End',
  plotPoint: 'Plot Point',
  scene: 'Scene',
  cinematic: 'Cinematic',
  choice: 'Choice',
  dialogue: 'Dialogue',
  character: 'Character / NPC',
  object: 'Interactive Object',
  environment: 'Environment',
  inventory: 'Inventory / Pickup',
  puzzle: 'Puzzle / Smart Object',
  trigger: 'Trigger',
  gate: 'Gate',
  state: 'State',
};

/** What each track accepts from the palette (spec §5, §6). Character arcs take arc events (build step 4). */
export const LANE_ACCEPTS: Record<LaneKind, readonly ObjectType[]> = {
  spine: ['plotPoint', 'scene', 'cinematic', 'choice'],
  subplot: ['plotPoint', 'scene', 'choice'],
  character: [],
};

/** Types that live inside a scene rather than on a track (build step 5). */
export const SCENE_ONLY: readonly ObjectType[] = [
  'dialogue',
  'character',
  'object',
  'environment',
  'inventory',
  'puzzle',
  'trigger',
  'gate',
  'state',
];
