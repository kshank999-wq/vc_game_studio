import { describe, expect, it } from 'vitest';
import { aiStep, defaultAI, HEARING, sense, startMemory, type AIWorld } from '../character/ai';
import { startCast, stepCast, type CastMember } from '../character/crowd';

// Hearing by height (character spec §6.2): footsteps carry up and down as across, and a floor between muffles them.
const ai = defaultAI();
const world = (x: number, dz: number, noisy = true): AIWorld => ({ target: { x, y: 0, noisy, alive: true, dz }, patrol: [{ x: 0, y: 0 }], walls: [] });
const memory = (w: AIWorld) => ({ ...startMemory(w, ai, 100), facing: 0 });

describe('hearing by height', () => {
  it('hears footsteps on the same floor out to its hearing radius', () => {
    const w = world(-5, 0);
    const s = sense(ai, memory(w), w);
    expect(s.hears).toBe(true);
    expect(s.around).toBeCloseTo(5);
    expect(s.hearing).toBe(6);
  });

  it('counts the height between them, and muffles footsteps through a floor', () => {
    // 3 m across and 3 m down: 4.2 m away, inside the muffled 4.5 m.
    const near = world(-3, -3);
    const heard = sense(ai, memory(near), near);
    expect(heard.hears).toBe(true);
    expect(heard.hearing).toBe(ai.hearingRadius * HEARING.muffle);
    expect(heard.around).toBeCloseTo(Math.hypot(3, 3));
    // 4.5 m across and 3 m down: 5.4 m away, inside 6 m but outside the muffled range.
    const far = world(-4.5, -3);
    expect(sense(ai, memory(far), far).hears).toBe(false);
    // The same 5.4 m on one floor (a ramp, 2 m up) is not muffled.
    const ramp = world(-Math.sqrt(5.4 ** 2 - 4), 2);
    expect(sense(ai, memory(ramp), ramp).hears).toBe(true);
  });

  it('hears nothing of a quiet target', () => {
    const w = world(-2, 0, false);
    expect(sense(ai, memory(w), w).hears).toBe(false);
  });

  it('senses closeness and reaches to attack by height too', () => {
    const below = world(1, -3);
    const s = sense(ai, memory(below), below);
    expect(s.distance).toBeCloseTo(1);
    expect(s.near).toBe(false);
    // Chasing a target 1 m across but a floor down: it can't hit through the floor.
    const r = aiStep(ai, 3, { ...memory(below), state: 'chase' }, below, 0.1);
    expect(r.memory.state).not.toBe('attack');
    expect(r.attacked).toBeFalsy();
    const level = world(1, 0);
    expect(aiStep(ai, 3, { ...memory(level), state: 'chase' }, level, 0.1).memory.state).toBe('attack');
  });
});

describe('Play Mode: a guard on another floor', () => {
  const guard: CastMember = {
    key: 'g',
    itemId: 'i',
    character: 'c',
    name: 'Guard',
    activity: 'patrol',
    home: { x: 0, y: 0 },
    z: 0,
    yaw: 0,
    speed: 2,
    height: 1.8,
    placeholder: { shape: 'capsule', color: '#888', scale: 1 } as unknown as CastMember['placeholder'],
    wanderRadius: 0,
    fleeFrom: 'never',
    route: [],
    ai: { ...defaultAI(), start: 'idle' },
    health: 100,
    damage: 5,
    maxAttackers: 2,
    placed: true,
  };
  const step = (noisy: boolean) => stepCast([guard], startCast([guard]), 0.1, 0, { x: 3, y: 0, z: 3, alive: true, noisy }, () => false);

  it('hears the player walking on the floor above, but never sees them through it', () => {
    const r = step(true);
    expect(r.poses.g!.mem!.state).toBe('investigate');
    expect(r.events.join(' ')).toMatch(/Hears it 4\.2 m away \(hearing 4\.5 m\)/);
  });

  it('knows nothing of a quiet player on another floor', () => {
    const r = step(false);
    expect(['idle', 'patrol']).toContain(r.poses.g!.mem!.state);
    expect(r.events.join(' ')).not.toMatch(/Hears it|Sees it/);
  });
});
