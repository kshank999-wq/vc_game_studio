import { describe, expect, it } from 'vitest';
import { bestLicense, isInterval, isPlan, licenseStatusFor, planForPrice, priceIdFor } from '../plans';

const prices = { writer: { month: 'price_wm', year: 'price_wy' }, studio: { month: 'price_sm', year: 'price_sy' } };

describe('plans', () => {
  it('maps the four prices both ways', () => {
    expect(priceIdFor(prices, 'studio', 'year')).toBe('price_sy');
    expect(planForPrice(prices, 'price_wm')).toEqual({ plan: 'writer', interval: 'month' });
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

  it('runs a device on the best active license', () => {
    const w = { status: 'active' as const, plan: 'writer' as const };
    const s = { status: 'active' as const, plan: 'studio' as const };
    const gone = { status: 'expired' as const, plan: 'studio' as const };
    expect(bestLicense([w, s])).toBe(s);
    expect(bestLicense([gone, w])).toBe(w);
    expect(bestLicense([gone])).toBeNull();
  });
});
