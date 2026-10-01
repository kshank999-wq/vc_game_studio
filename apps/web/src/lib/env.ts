/**
 * Environment access, as in VC Writer: every value is read lazily and fails
 * loudly where it is used, so a missing Stripe key breaks checkout and not the
 * marketing pages or a build that has no secrets.
 */

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
};

const optional = (name: string, fallback: string): string => process.env[name]?.trim() || fallback;

export const DEFAULT_SITE_URL = 'https://vc-gamestudio.com';

/**
 * The site's own origin, absolute and without a trailing slash. Forgiving,
 * unlike everything else: the root layout reads it at module scope, so a typo
 * (or the variable's name pasted in as its value, which happened to VC Writer)
 * must warn and fall back rather than fail the build.
 */
export const parseSiteUrl = (raw: string | undefined): string => {
  const value = raw?.trim();
  if (!value) return DEFAULT_SITE_URL;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    console.warn(`NEXT_PUBLIC_SITE_URL is not a URL (${JSON.stringify(value)}); using ${DEFAULT_SITE_URL}.`);
    return DEFAULT_SITE_URL;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    console.warn(`NEXT_PUBLIC_SITE_URL must be http or https (${JSON.stringify(value)}); using ${DEFAULT_SITE_URL}.`);
    return DEFAULT_SITE_URL;
  }
  return parsed.href.replace(/\/+$/, '');
};

export const env = {
  get supabaseUrl(): string {
    return required('NEXT_PUBLIC_SUPABASE_URL');
  },
  get supabaseAnonKey(): string {
    return required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  },
  /** Server only. Bypasses row level security. */
  get supabaseServiceRoleKey(): string {
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },
  get stripeSecretKey(): string {
    return required('STRIPE_SECRET_KEY');
  },
  get stripeWebhookSecret(): string {
    return required('STRIPE_WEBHOOK_SECRET');
  },
  /** The four recurring prices: two plans, each monthly and yearly. */
  get stripePrices(): PriceIds {
    return {
      writer: { month: required('STRIPE_PRICE_WRITER_MONTHLY'), year: required('STRIPE_PRICE_WRITER_YEARLY') },
      studio: { month: required('STRIPE_PRICE_STUDIO_MONTHLY'), year: required('STRIPE_PRICE_STUDIO_YEARLY') },
    };
  },
  get resendApiKey(): string {
    return required('RESEND_API_KEY');
  },
  get resendFrom(): string {
    return optional('RESEND_FROM_ADDRESS', 'VC Game Studio <noreply@vc-gamestudio.com>');
  },
  /** Ed25519 private key (PKCS#8 PEM, or the same base64-encoded) that signs desktop entitlements. */
  get licenseSigningKey(): string {
    return required('LICENSE_SIGNING_PRIVATE_KEY');
  },
  get releaseBucket(): string {
    return optional('RELEASE_BUCKET', 'gs-releases');
  },
  get releaseDownloadTtlSeconds(): number {
    return Number.parseInt(optional('RELEASE_DOWNLOAD_TTL_SECONDS', '900'), 10);
  },
  get siteUrl(): string {
    return parseSiteUrl(process.env['NEXT_PUBLIC_SITE_URL']);
  },
} as const;

export type Plan = 'writer' | 'studio';
export type Interval = 'month' | 'year';
export type PriceIds = Record<Plan, Record<Interval, string>>;

export const SITE_NAME = 'VC Game Studio';
