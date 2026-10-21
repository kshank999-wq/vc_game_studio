import { FOOTSTEP_SPEED } from '../character/ai';
import { BODY } from './controller';
import type { Point } from './geometry';

/**
 * The player's footsteps in Play Mode (character spec §6.2): the same rule
 * the guards hear by (on the ground, faster than a crouched creep), and when
 * each step falls, so Play Mode can sound it.
 */

/** How the body stands this tick: footsteps only on the ground. */
export interface Footing {
  grounded?: boolean;
  climbing?: boolean;
  swimming?: boolean;
}

/** Faster than this (m/s) is the player being put somewhere (caught, travelling), not a step. */
const PUT = 20;

/** How fast the player went across the ground between two ticks (m/s). */
export const paceOf = (from: Point, to: Point, dt: number): number => (dt > 0 ? Math.hypot(to.x - from.x, to.y - from.y) / dt : 0);

/** Whether moving at this pace makes footsteps: on the ground, faster than a crouched creep. */
export const makesFootsteps = (footing: Footing, pace: number): boolean =>
  footing.grounded !== false && !footing.climbing && !footing.swimming && pace >= FOOTSTEP_SPEED && pace < PUT;

/** Metres a step covers at a pace: longer strides the faster it goes (a walk about 1.5 m, a run about 2). */
export const strideAt = (pace: number): number => 0.9 + pace * 0.18;

/** Where the walk is between steps: the ground covered since the last one, and the foot that falls next. */
export interface Gait {
  carry: number;
  foot: 0 | 1;
}

export const startGait = (): Gait => ({ carry: 0, foot: 0 });

/** A step that falls: how loud (0–1, a walk softer than a run) and which foot. */
export interface Footfall {
  loud: number;
  foot: 0 | 1;
}

/**
 * One tick of the walk: the steps that fall between two places. Starting to
 * move, the first step comes half a stride in; standing, creeping or in the
 * air, the walk starts again.
 */
export const stepGait = (gait: Gait, from: Point, to: Point, dt: number, footing: Footing): { gait: Gait; steps: Footfall[] } => {
  const pace = paceOf(from, to, dt);
  if (!makesFootsteps(footing, pace)) return { gait: startGait(), steps: [] };
  const stride = strideAt(pace);
  const loud = Math.min(1, Math.max(0.35, pace / BODY.run));
  let carry = (gait.carry > 0 ? gait.carry : stride / 2) + pace * dt;
  let foot = gait.foot;
  const steps: Footfall[] = [];
  while (carry >= stride) {
    carry -= stride;
    steps.push({ loud, foot });
    foot = foot === 0 ? 1 : 0;
  }
  return { gait: { carry, foot }, steps };
};
