import type { Interval, Plan, PriceIds } from './env';

/**
 * The two plans and what each unlocks, and the rules that turn a Stripe
 * subscription into a license. Pure, so the money path is tested without
 * Stripe or a database.
 *
 * The plans are the editions the studio already knows (packages/core
 * editions.ts): VC Game Writer is the whole writing and design tool, VC Game
 * Studio adds the engine handoff to Godot, Unity and Unreal.
 */

export const PLANS: Record<Plan, { name: string; tagline: string; features: string[] }> = {
  writer: {
    name: 'VC Game Writer',
    tagline: 'Design the whole game: story, world, levels and puzzles.',
    features: [
      'Story spine, subplot and character lanes',
      'Game Bible: characters, items, lore, skills, equipment and crafting',
      'Scenes, dialogue, choices and cinematics',
      'Level Designer with 2D maps and the 3D graybox',
      'Puzzle Creator with screen puzzles and a solver',
      'Play-through and Play Mode, with saved paths',
      'Note Sorter, comments, tasks and history',
    ],
  },
  studio: {
    name: 'VC Game Studio',
    tagline: 'Everything in Game Writer, then straight into your engine.',
    features: [
      'Everything in VC Game Writer',
      'Engine handoff to Godot 4, Unity and Unreal Engine 5',
      'Generated runtimes: state, rules, quests, puzzles, levels and saves',
      'Placeholder scenes and levels to play in the engine',
      'Re-export that keeps the code you wrote in the engine',
    ],
  },
};

export const PLAN_ORDER: Plan[] = ['writer', 'studio'];

export const DEVICES_PER_LICENSE = 2;

export const isPlan = (value: unknown): value is Plan => value === 'writer' || value === 'studio';
export const isInterval = (value: unknown): value is Interval => value === 'month' || value === 'year';

export const priceIdFor = (prices: PriceIds, plan: Plan, interval: Interval): string => prices[plan][interval];

/** Which plan and interval a Stripe price is, or null for a price that is not ours. */
export const planForPrice = (prices: PriceIds, priceId: string): { plan: Plan; interval: Interval } | null => {
  for (const plan of PLAN_ORDER) {
    for (const interval of ['month', 'year'] as const) {
      if (prices[plan][interval] === priceId) return { plan, interval };
    }
  }
  return null;
};

export type LicenseStatus = 'active' | 'suspended' | 'revoked' | 'expired';

/**
 * A license follows its subscription.
 *
 * Active while Stripe says the subscription is in good standing, and also
 * while it is `past_due`: that is Stripe retrying a card, and a customer whose
 * renewal failed on a Tuesday should not lose saving that afternoon. Once
 * Stripe gives up (`unpaid`, `canceled`, `incomplete_expired`) the license
 * expires. `incomplete` is a first payment not yet through, so it is not active
 * yet. A license revoked for a refund or dispute stays revoked whatever the
 * subscription does next.
 */
export const licenseStatusFor = (stripeStatus: string, current: LicenseStatus | null = null): LicenseStatus => {
  if (current === 'revoked') return 'revoked';
  if (stripeStatus === 'active' || stripeStatus === 'trialing' || stripeStatus === 'past_due') return 'active';
  if (stripeStatus === 'incomplete' || stripeStatus === 'paused') return 'suspended';
  return 'expired';
};

/** Of several licenses, the one a device should run on: an active Studio before an active Writer. */
export const bestLicense = <T extends { status: LicenseStatus; plan: Plan }>(licenses: readonly T[]): T | null => {
  const active = licenses.filter((license) => license.status === 'active');
  return active.find((license) => license.plan === 'studio') ?? active[0] ?? null;
};
