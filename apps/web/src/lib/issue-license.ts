import type Stripe from 'stripe';
import { sendLicenseEmail } from './email';
import { env } from './env';
import { PLANS } from './plans';
import { stripe } from './stripe';
import { recordSubscription, type SubscriptionRecord } from './subscriptions';
import { adminClient } from './supabase';

/**
 * Record a subscription and, the first time, email its license. Shared by the
 * webhook and the page Stripe returns to after checkout, so a late or missing
 * webhook never leaves a customer without their license. Whichever gets
 * there first issues it; unique(subscription_id) makes the other a no-op, and
 * only the one that issued it sends the email.
 */
export const issueFromSubscription = async (subscription: Stripe.Subscription): Promise<SubscriptionRecord | null> => {
  const record = await recordSubscription(subscription, {
    client: adminClient(),
    prices: env.stripePrices,
    customerEmail: async (customerId) => {
      const customer = await stripe().customers.retrieve(customerId);
      return 'deleted' in customer && customer.deleted ? null : customer.email;
    },
  });
  if (record?.created && record.email) {
    await sendLicenseEmail({ to: record.email, userId: record.userId, serial: record.serial, planName: PLANS[record.plan].name });
  }
  return record;
};

/** The subscription a completed checkout started, read back from Stripe; null for anything else. */
export const issueFromCheckout = async (sessionId: string): Promise<SubscriptionRecord | null> => {
  const session = await stripe().checkout.sessions.retrieve(sessionId);
  if (session.mode !== 'subscription' || session.status !== 'complete' || !session.subscription) return null;
  const id = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
  return issueFromSubscription(await stripe().subscriptions.retrieve(id));
};
