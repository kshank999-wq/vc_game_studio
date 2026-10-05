import { env, type Interval, type Plan } from './env';
import { PLAN_ORDER } from './plans';
import { stripe } from './stripe';

/**
 * Prices, read from Stripe rather than repeated here (VC Writer's rule): Stripe
 * is what the customer is charged, and a second copy would one day disagree.
 * Null when Stripe is not configured, so the pages still render and the price
 * simply appears at checkout.
 */

export type DisplayPrices = Record<Plan, Partial<Record<Interval, string>>>;

export const formatPrice = (amountCents: number, currency: string): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amountCents / 100);

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
  await Promise.all(
    PLAN_ORDER.flatMap((plan) =>
      (['month', 'year'] as const).map(async (interval) => {
        const id = ids[plan][interval];
        try {
          const price = await stripe().prices.retrieve(id);
          if (price.unit_amount != null && price.currency) out[plan][interval] = formatPrice(price.unit_amount, price.currency);
        } catch (err) {
          console.error(`[pricing] ${PRICE_VARS[plan][interval]}=${id}: ${(err as Error).message}`);
        }
      }),
    ),
  );
  return out;
};
