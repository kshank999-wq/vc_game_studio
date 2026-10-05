import type { Interval, Plan, PriceIds } from './env';

/**
 * The plan and what it unlocks, and the rules that turn a Stripe subscription
 * into a license. Pure, so the money path is tested without Stripe or a
 * database.
 *
 * One package, VC Game Studio, monthly or yearly: the whole design tool and
 * the engine handoff to Godot, Unity and Unreal. (It began inside VC Writer;
 * VC Writer now only links here.)
 */

export const PLANS: Record<Plan, { name: string; tagline: string; features: string[] }> = {
  studio: {
    name: 'VC Game Studio',
    tagline: 'Design the whole game, then send it straight into your engine.',
    features: [
      'Story spine, subplot and character lanes',
      'Game Bible: characters, items, lore, skills, equipment and crafting',
      'Scenes, dialogue, choices and cinematics',
      'Level Designer with 2D maps and the 3D graybox',
      'Puzzle Creator with screen puzzles and a solver',
      'Play-through and Play Mode, with saved paths',
      'Note Sorter, comments, tasks and history',
      'Engine handoff to Godot 4, Unity and Unreal Engine 5',
      'Generated runtimes: state, rules, quests, puzzles, levels and saves',
      'Re-export that keeps the code you wrote in the engine',
    ],
  },
};

export const PLAN_ORDER: Plan[] = ['studio'];

export const DEVICES_PER_LICENSE = 2;

export const isPlan = (value: unknown): value is Plan => value === 'studio';
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

/** Of several licenses, the one a device should run on: the first active one. */
export const bestLicense = <T extends { status: LicenseStatus; plan: Plan }>(licenses: readonly T[]): T | null => {
  const active = licenses.filter((license) => license.status === 'active');
  return active[0] ?? null;
};
