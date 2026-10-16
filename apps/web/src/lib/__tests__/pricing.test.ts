import { describe, expect, it } from 'vitest';
import { yearlySaving } from '../pricing';

describe('yearly saving', () => {
  it('says almost a whole amount when just short of it', () => {
    expect(yearlySaving(2499, 24999, 'usd')).toBe('save almost $50');
  });
  it('says the amount when it is whole', () => {
    expect(yearlySaving(2500, 25000, 'usd')).toBe('save $50');
  });
  it('says nothing when a year saves nothing', () => {
    expect(yearlySaving(2000, 24000, 'usd')).toBeNull();
    expect(yearlySaving(2000, 25000, 'usd')).toBeNull();
  });
});
