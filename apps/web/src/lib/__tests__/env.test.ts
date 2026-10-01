import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SITE_URL, parseSiteUrl } from '../env';

describe('site url', () => {
  it('keeps a good URL without its trailing slash', () => {
    expect(parseSiteUrl('https://vc-gamestudio.com/')).toBe('https://vc-gamestudio.com');
    expect(parseSiteUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('falls back, warning, on the mistakes that took VC Writer down', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseSiteUrl('NEXT_PUBLIC_SITE_URL')).toBe(DEFAULT_SITE_URL);
    expect(parseSiteUrl('ftp://vc-gamestudio.com')).toBe(DEFAULT_SITE_URL);
    expect(parseSiteUrl(undefined)).toBe(DEFAULT_SITE_URL);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
