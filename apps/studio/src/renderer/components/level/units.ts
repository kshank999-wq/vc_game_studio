import type { LevelSettings } from '../../model/level/types';

/** Lengths are stored in metres; the project chooses how they are shown (spec §3.1). */
const FOOT = 0.3048;

export const toDisplay = (metres: number, units: LevelSettings['units']): number =>
  Math.round((units === 'ft' ? metres / FOOT : metres) * 100) / 100;

export const fromDisplay = (value: number, units: LevelSettings['units']): number => (units === 'ft' ? value * FOOT : value);

export const unitLabel = (units: LevelSettings['units']): string => (units === 'ft' ? 'ft' : 'm');

/** A length as the designer reads it: kilometres (or miles) once it is that long (spec V2 §12), else metres (or feet). */
export const formatLength = (metres: number, units: LevelSettings['units']): string => {
  if (units === 'ft' && Math.abs(metres) >= 1609.344) return `${Math.round((metres / 1609.344) * 100) / 100} mi`;
  if (units !== 'ft' && Math.abs(metres) >= 1000) return `${Math.round((metres / 1000) * 100) / 100} km`;
  return `${toDisplay(metres, units)} ${unitLabel(units)}`;
};
