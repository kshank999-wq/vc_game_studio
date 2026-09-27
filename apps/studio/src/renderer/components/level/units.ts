import type { LevelSettings } from '../../model/level/types';

/** Lengths are stored in metres; the project chooses how they are shown (spec §3.1). */
const FOOT = 0.3048;

export const toDisplay = (metres: number, units: LevelSettings['units']): number =>
  Math.round((units === 'ft' ? metres / FOOT : metres) * 100) / 100;

export const fromDisplay = (value: number, units: LevelSettings['units']): number => (units === 'ft' ? value * FOOT : value);

export const unitLabel = (units: LevelSettings['units']): string => (units === 'ft' ? 'ft' : 'm');

export const formatLength = (metres: number, units: LevelSettings['units']): string => `${toDisplay(metres, units)} ${unitLabel(units)}`;
