import { env, type Interval, type Plan } from './env';
import { PLAN_ORDER } from './plans';
import { stripe } from './stripe';

/**
 * Prices, read from Stripe rather than repeated here: Stripe
 * is what the customer is charged, and a second copy would one day disagree.
 * Null when Stripe is not configured, so the pages still render and the price
 * simply appears at checkout.
 */

/** Each plan's prices as shown, and what a year saves against twelve months, when it does. */
export type DisplayPrices = Record<Plan, Partial<Record<Interval, string>> & { saving?: string }>;

export const formatPrice = (amountCents: number, currency: string): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amountCents / 100);

/**
 * What paying yearly saves against twelve monthly payments, in words: "save
 * almost $50" when it falls just short of a whole amount, "save $50" when it is
 * one. Null when a year saves nothing.
 */
export const yearlySaving = (monthCents: number, yearCents: number, currency: string): string | null => {
  const saved = monthCents * 12 - yearCents;
  if (saved <= 0) return null;
  const whole = Math.ceil(saved / 100) * 100;
  return whole === saved ? `save ${formatPrice(saved, currency)}` : `save almost ${formatPrice(whole, currency)}`;
};

const PRICE_VARS = {
  studio: { month: 'STRIPE_PRICE_STUDIO_MONTHLY', year: 'STRIPE_PRICE_STUDIO_YEARLY' },
} as const;

/**
 * Each price on its own, so one bad ID blanks only its own card. A failure is
 * logged with the variable it came from (never the key), since the page itself
 * just shows a dash.
 */
export const fetchDisplayPrices = async (): Promise<DisplayPrices | null> => {
  let ids: typeof env.stripePrices;
  try {
    ids = env.stripePrices;
  } catch (err) {
    console.error(`[pricing] ${(err as Error).message}`);
    return null;
  }
  const out: DisplayPrices = { studio: {} };
  const cents: Partial<Record<Plan, Partial<Record<Interval, { amount: number; currency: string }>>>> = {};
  await Promise.all(
    PLAN_ORDER.flatMap((plan) =>
      (['month', 'year'] as const).map(async (interval) => {
        const id = ids[plan][interval];
        try {
          const price = await stripe().prices.retrieve(id);
          if (price.unit_amount != null && price.currency) {
            out[plan][interval] = formatPrice(price.unit_amount, price.currency);
            (cents[plan] ??= {})[interval] = { amount: price.unit_amount, currency: price.currency };
          }
        } catch (err) {
          console.error(`[pricing] ${PRICE_VARS[plan][interval]}=${id}: ${(err as Error).message}`);
        }
      }),
    ),
  );
  for (const plan of PLAN_ORDER) {
    const { month, year } = cents[plan] ?? {};
    const saving = month && year && month.currency === year.currency ? yearlySaving(month.amount, year.amount, year.currency) : null;
    if (saving) out[plan].saving = saving;
  }
  return out;
};
