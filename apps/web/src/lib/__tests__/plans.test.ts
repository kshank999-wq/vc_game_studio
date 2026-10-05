import { describe, expect, it } from 'vitest';
import { bestLicense, isInterval, isPlan, licenseStatusFor, planForPrice, priceIdFor } from '../plans';

const prices = { studio: { month: 'price_sm', year: 'price_sy' } };

describe('plans', () => {
  it('maps the two prices both ways', () => {
    expect(priceIdFor(prices, 'studio', 'year')).toBe('price_sy');
    expect(planForPrice(prices, 'price_sm')).toEqual({ plan: 'studio', interval: 'month' });
    expect(planForPrice(prices, 'price_vcwriter_desktop')).toBeNull();
    expect(isPlan('studio') && isInterval('year') && !isPlan('lite') && !isInterval('week')).toBe(true);
  });

  it('keeps a license active through a retried card, and ends it when Stripe gives up', () => {
    expect(licenseStatusFor('active')).toBe('active');
    expect(licenseStatusFor('trialing')).toBe('active');
    expect(licenseStatusFor('past_due')).toBe('active');
    expect(licenseStatusFor('incomplete')).toBe('suspended');
    expect(licenseStatusFor('canceled')).toBe('expired');
    expect(licenseStatusFor('unpaid')).toBe('expired');
    expect(licenseStatusFor('incomplete_expired')).toBe('expired');
  });

  it('never un-revokes a refunded license', () => {
    expect(licenseStatusFor('active', 'revoked')).toBe('revoked');
    expect(licenseStatusFor('active', 'expired')).toBe('active');
  });

  it('runs a device on an active license', () => {
    const s = { status: 'active' as const, plan: 'studio' as const };
    const gone = { status: 'expired' as const, plan: 'studio' as const };
    expect(bestLicense([gone, s])).toBe(s);
    expect(bestLicense([gone])).toBeNull();
  });
});
