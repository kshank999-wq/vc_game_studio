import type Stripe from 'stripe';
import type { Interval, Plan } from '../env';
import { PLAN_ORDER, PLANS } from '../plans';

/**
 * Stripe for VC Game Studio, made in one go and safe to run again: the two
 * products, their four recurring prices, the webhook endpoint, and a customer
 * portal configuration of its own.
 *
 * The portal is this product's own configuration rather than the account's
 * default, because the account is shared: VC Writer's Writers Room sends its
 * customers to the default portal, and they must not be offered Game Studio
 * plans to switch to. /api/billing/portal names this configuration.
 */

export const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.refunded',
  'charge.dispute.created',
];

export type Amounts = Record<Plan, Record<Interval, number>>;

export const lookupKey = (plan: Plan, interval: Interval): string => `vcgs_${plan}_${interval}`;

const ENV_KEY: Record<Plan, Record<Interval, string>> = {
  writer: { month: 'STRIPE_PRICE_WRITER_MONTHLY', year: 'STRIPE_PRICE_WRITER_YEARLY' },
  studio: { month: 'STRIPE_PRICE_STUDIO_MONTHLY', year: 'STRIPE_PRICE_STUDIO_YEARLY' },
};

/** `--writer-monthly=19 --writer-yearly=190 --studio-monthly=39 --studio-yearly=390`, in whole or decimal currency units. */
export const parseAmounts = (args: string[]): Amounts => {
  const read = (name: string): number => {
    const raw = args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
    const value = raw === undefined ? NaN : Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Give a price: --${name}=<amount>, e.g. --${name}=19`);
    return Math.round(value * 100);
  };
  return {
    writer: { month: read('writer-monthly'), year: read('writer-yearly') },
    studio: { month: read('studio-monthly'), year: read('studio-yearly') },
  };
};

export interface StripeSetupResult {
  env: Record<string, string>;
  notes: string[];
}

export const setupStripe = async (
  stripe: Stripe,
  options: { amounts: Amounts; currency: string; siteUrl: string },
): Promise<StripeSetupResult> => {
  const env: Record<string, string> = {};
  const notes: string[] = [];
  const priceIds: Record<Plan, Record<Interval, string>> = { writer: { month: '', year: '' }, studio: { month: '', year: '' } };
  const productIds: Record<Plan, string> = { writer: '', studio: '' };

  for (const plan of PLAN_ORDER) {
    const found = await stripe.products.search({ query: `metadata['vcgs_plan']:'${plan}'` });
    const product =
      found.data.find((candidate) => candidate.active) ??
      (await stripe.products.create({
        name: PLANS[plan].name,
        description: PLANS[plan].tagline,
        metadata: { product: 'vc-game-studio', vcgs_plan: plan },
      }));
    if (found.data.length === 0) notes.push(`Created the product ${PLANS[plan].name}.`);
    productIds[plan] = product.id;

    for (const interval of ['month', 'year'] as const) {
      const key = lookupKey(plan, interval);
      const amount = options.amounts[plan][interval];
      const existing = (await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 })).data[0];
      const reusable =
        existing && existing.unit_amount === amount && existing.currency === options.currency && existing.product === product.id;
      const price = reusable
        ? existing
        : await stripe.prices.create({
            product: product.id,
            currency: options.currency,
            unit_amount: amount,
            recurring: { interval },
            lookup_key: key,
            // A new amount takes the key over; customers already on the old price stay on it.
            transfer_lookup_key: true,
            tax_behavior: 'exclusive',
            metadata: { product: 'vc-game-studio', vcgs_plan: plan },
          });
      if (!reusable) notes.push(`Price ${PLANS[plan].name} ${interval}ly: ${(amount / 100).toFixed(2)} ${options.currency.toUpperCase()}.`);
      priceIds[plan][interval] = price.id;
      env[ENV_KEY[plan][interval]] = price.id;
    }
  }

  const url = `${options.siteUrl}/api/stripe/webhook`;
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const endpoint = endpoints.data.find((candidate) => candidate.url === url);
  if (!endpoint) {
    const created = await stripe.webhookEndpoints.create({
      url,
      enabled_events: WEBHOOK_EVENTS,
      description: 'VC Game Studio (vc-gamestudio.com): subscriptions and licenses',
      api_version: '2025-02-24.acacia',
      metadata: { product: 'vc-game-studio' },
    });
    if (created.secret) env['STRIPE_WEBHOOK_SECRET'] = created.secret;
    notes.push(`Created the webhook ${url}.`);
  } else {
    await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: WEBHOOK_EVENTS });
    notes.push(`The webhook ${url} already exists; its signing secret is in the Stripe dashboard (Webhooks → the endpoint → Reveal) if the env file lacks it.`);
  }

  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id'] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end' },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      proration_behavior: 'create_prorations',
      products: PLAN_ORDER.map((plan) => ({ product: productIds[plan], prices: [priceIds[plan].month, priceIds[plan].year] })),
    },
  };
  const configurations = await stripe.billingPortal.configurations.list({ limit: 100 });
  const mine = configurations.data.find((candidate) => candidate.metadata?.['product'] === 'vc-game-studio');
  const portal = mine
    ? await stripe.billingPortal.configurations.update(mine.id, { features })
    : await stripe.billingPortal.configurations.create({
        business_profile: { headline: 'VC Game Studio: your plan, card and invoices' },
        features,
        default_return_url: `${options.siteUrl}/account`,
        metadata: { product: 'vc-game-studio' },
      });
  env['STRIPE_PORTAL_CONFIGURATION'] = portal.id;
  notes.push(`${mine ? 'Updated' : 'Created'} the VC Game Studio customer portal (not the account default, which VC Writer uses).`);
  return { env, notes };
};
