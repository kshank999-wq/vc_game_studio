import { describe, expect, it } from 'vitest';
import { BODY, CROUCH } from '../level/controller';
import { makesFootsteps, startGait, stepGait, strideAt, type Footfall, type Gait } from '../level/footsteps';

// Walk along x at a pace for a while, ticking at 60 Hz; the steps that fall.
const walk = (pace: number, seconds: number, footing = { grounded: true }) => {
  const dt = 1 / 60;
  let gait: Gait = startGait();
  let x = 0;
  const steps: Footfall[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    const r = stepGait(gait, { x, y: 0 }, { x: x + pace * dt, y: 0 }, dt, footing);
    gait = r.gait;
    steps.push(...r.steps);
    x += pace * dt;
  }
  return steps;
};

describe('footsteps in Play Mode', () => {
  it('a walk falls into steps, a stride apart, left and right in turn', () => {
    const steps = walk(BODY.walk, 4);
    // 3.6 m/s over 4 s is 14.4 m, at strides of about 1.55 m (and the first half a stride in).
    expect(steps.length).toBe(Math.floor((BODY.walk * 4 + strideAt(BODY.walk) / 2) / strideAt(BODY.walk)));
    expect(steps.map((s) => s.foot).slice(0, 4)).toEqual([0, 1, 0, 1]);
  });

  it('a run steps faster and louder than a walk', () => {
    const walking = walk(BODY.walk, 4);
    const running = walk(BODY.run, 4);
    expect(running.length).toBeGreaterThan(walking.length);
    expect(running[0]!.loud).toBeGreaterThan(walking[0]!.loud);
    expect(running[0]!.loud).toBeCloseTo(1);
  });

  it('is silent creeping crouched, in the air, climbing or swimming, or being put somewhere', () => {
    expect(walk(BODY.walk * CROUCH.speed, 4)).toEqual([]);
    expect(walk(BODY.walk, 4, { grounded: false } as { grounded: boolean })).toEqual([]);
    expect(makesFootsteps({ climbing: true }, BODY.walk)).toBe(false);
    expect(makesFootsteps({ swimming: true }, BODY.walk)).toBe(false);
    expect(makesFootsteps({ grounded: true }, 300)).toBe(false);
  });

  it('starts the walk again after standing still', () => {
    let r = stepGait(startGait(), { x: 0, y: 0 }, { x: 1, y: 0 }, 1 / 3, { grounded: true });
    r = stepGait(r.gait, { x: 1, y: 0 }, { x: 1, y: 0 }, 1 / 60, { grounded: true });
    expect(r.gait).toEqual(startGait());
  });
});
