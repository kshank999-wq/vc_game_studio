import Stripe from 'stripe';
import { env } from './env';

/** Everything this site creates in Stripe carries this, so the webhook knows its own (and leaves anything else alone). */
export const PRODUCT_TAG = 'vc-game-studio';

let cached: Stripe | null = null;

export const stripe = (): Stripe => {
  if (!cached) {
    // Pinned, so a Stripe-side default cannot change webhook payloads under a deployed build.
    cached = new Stripe(env.stripeSecretKey, { apiVersion: '2025-02-24.acacia' });
  }
  return cached;
};
