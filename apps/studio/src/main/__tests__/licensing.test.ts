import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// The site's own signer: the two sides of the token format are tested against each other.
import { issueEntitlement } from '../../../../web/src/lib/entitlement';
import { planFrom, publicKeyFrom, readToken } from '../license-token';
import { Licensing, type Stored } from '../licensing';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const FINGERPRINT = 'f'.repeat(64);
/** The old VC Game Writer plan: the site no longer sells it, but a copy holding such a token still reads it. */
const LEGACY_WRITER = 'writer' as unknown as 'studio';

const token = (over: Partial<Parameters<typeof issueEntitlement>[0]> = {}, now = new Date()) =>
  issueEntitlement({ serial: 'VCGS-AAAAA-BBBBB-CCCCC-DDDDD', plan: 'studio', fingerprint: FINGERPRINT, email: 'ken@example.com', paidThrough: '2027-01-01T00:00:00.000Z', ...over }, privateKey, now).token;

describe('the entitlement token', () => {
  it('reads what the site signs, with the key as PEM or base64', () => {
    for (const key of [publicKeyFrom(publicPem), publicKeyFrom(Buffer.from(publicPem).toString('base64'))]) {
      expect(readToken(token(), key!)).toMatchObject({ plan: 'studio', fingerprint: FINGERPRINT });
    }
    expect(publicKeyFrom('')).toBeNull();
    expect(publicKeyFrom('not a key')).toBeNull();
  });

  it('gives a plan only to this computer, until the date', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    const entitlement = readToken(token({}, now), publicKey)!;
    expect(planFrom(entitlement, FINGERPRINT, now)).toBe('studio');
    expect(planFrom(entitlement, 'another computer', now)).toBeNull();
    expect(planFrom(entitlement, FINGERPRINT, new Date('2026-10-16T00:00:00Z'))).toBeNull();
  });

  it('refuses a token from another key or an edited one', () => {
    const other = generateKeyPairSync('ed25519').publicKey;
    expect(readToken(token(), other)).toBeNull();
    expect(readToken(token().replace(/\.[^.]+$/, '.AAAA'), publicKey)).toBeNull();
  });
});

/** A fake Supabase and site: what the app's calls get back. */
const harness = (routes: Record<string, (body: Record<string, unknown>) => [number, Record<string, unknown>]>, stored: Partial<Stored> = {}) => {
  const calls: string[] = [];
  let disk: Stored = { token: null, email: null, refreshToken: null, ...stored };
  let online = true;
  const licensing = new Licensing({
    config: { siteUrl: 'https://site.test', supabaseUrl: 'https://auth.test', supabaseAnonKey: 'anon', publicKey },
    fetch: (async (url: string, init?: RequestInit) => {
      if (!online) throw new TypeError('fetch failed');
      const path = url.replace(/^https:\/\/[^/]+/, '');
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      const route = routes[path];
      const [status, json] = route ? route(JSON.parse(String(init?.body ?? '{}'))) : [404, {}];
      return new Response(JSON.stringify(json), { status });
    }) as typeof fetch,
    load: async () => disk,
    save: async (next) => {
      disk = next;
    },
    fingerprint: async () => FINGERPRINT,
    device: () => ({ deviceName: 'Studio Mac', platform: 'macos', appVersion: '0.1.0' }),
  });
  return { licensing, calls, disk: () => disk, offline: () => (online = false) };
};

const session = { access_token: 'access', refresh_token: 'refresh-2', expires_in: 3600, user: { email: 'ken@example.com' } };

describe('signing in is activating', () => {
  it('a code, then a seat, then saving and export', async () => {
    const h = harness({
      '/auth/v1/otp': () => [200, {}],
      '/auth/v1/verify': () => [200, session],
      '/api/licenses/activate': (body) => (body['fingerprint'] === FINGERPRINT ? [200, { token: token() }] : [400, {}]),
    });
    expect((await h.licensing.start()).state).toBe('signed-out');
    expect(h.licensing.canSave()).toBe(false);
    await h.licensing.requestCode('Ken@Example.com');
    const access = await h.licensing.verifyCode('ken@example.com', '123456');
    expect(access).toMatchObject({ plan: 'studio', state: 'licensed', email: 'ken@example.com', serial: 'VCGS-AAAAA-BBBBB-CCCCC-DDDDD' });
    expect(h.licensing.canSave() && h.licensing.canExport()).toBe(true);
    expect(h.disk().refreshToken).toBe('refresh-2');
    expect(h.calls).toEqual(['POST /auth/v1/otp', 'POST /auth/v1/verify', 'POST /api/licenses/activate']);
  });

  it('a legacy VC Game Writer token saves but does not export', async () => {
    const h = harness({}, { token: token({ plan: LEGACY_WRITER }), refreshToken: 'r' });
    await h.licensing.start();
    expect(h.licensing.canSave()).toBe(true);
    expect(h.licensing.canExport()).toBe(false);
  });

  it('says plainly when there is no seat, and stays unlicensed', async () => {
    const h = harness({
      '/auth/v1/verify': () => [200, session],
      '/api/licenses/activate': () => [409, { error: 'This license is already on 2 of 2 computers.', reason: 'no_slots' }],
    });
    await h.licensing.start();
    const access = await h.licensing.verifyCode('ken@example.com', '123456');
    expect(access).toMatchObject({ plan: 'none', state: 'not-activated', message: 'This license is already on 2 of 2 computers.' });
  });

  it('explains an email with no account', async () => {
    const h = harness({ '/auth/v1/otp': () => [422, { msg: 'Signups not allowed for otp' }] });
    await h.licensing.start();
    await expect(h.licensing.requestCode('who@example.com')).rejects.toThrow(/no account for that email/);
  });
});

describe('checking in', () => {
  it('renews the entitlement, keeping the rotated refresh token', async () => {
    const h = harness(
      {
        '/auth/v1/token?grant_type=refresh_token': () => [200, { ...session, refresh_token: 'refresh-3' }],
        '/api/licenses/status': () => [200, { token: token({ plan: LEGACY_WRITER }) }],
      },
      { token: token(), refreshToken: 'refresh-2', email: 'ken@example.com' },
    );
    await h.licensing.start();
    expect((await h.licensing.refresh()).plan).toBe('writer');
    expect(h.disk().refreshToken).toBe('refresh-3');
  });

  it('keeps working offline on the last entitlement', async () => {
    const h = harness({}, { token: token(), refreshToken: 'r' });
    await h.licensing.start();
    h.offline();
    expect((await h.licensing.refresh()).state).toBe('licensed');
  });

  it('stops saving when the seat is freed from the account page or the subscription ends', async () => {
    for (const reason of ['device_removed', 'license_inactive']) {
      const h = harness(
        {
          '/auth/v1/token?grant_type=refresh_token': () => [200, session],
          '/api/licenses/status': () => [409, { error: `gone: ${reason}`, reason }],
        },
        { token: token(), refreshToken: 'r', email: 'ken@example.com' },
      );
      await h.licensing.start();
      const access = await h.licensing.refresh();
      expect(access).toMatchObject({ plan: 'none', message: `gone: ${reason}` });
      expect(h.disk().token).toBeNull();
    }
  });

  it('a lapsed entitlement on this computer reads as offline too long', async () => {
    const h = harness({}, { token: token({}, new Date('2020-01-01T00:00:00Z')), refreshToken: 'r' });
    expect((await h.licensing.start()).state).toBe('expired-offline');
  });

  it('signing out frees the seat and forgets the account; a developer build is unlocked', async () => {
    const h = harness(
      { '/auth/v1/token?grant_type=refresh_token': () => [200, session], '/api/licenses/devices': () => [200, { deactivated: true }] },
      { token: token(), refreshToken: 'r', email: 'ken@example.com' },
    );
    await h.licensing.start();
    expect(await h.licensing.signOut()).toMatchObject({ plan: 'none', state: 'signed-out', email: null });
    expect(h.calls).toContain('DELETE /api/licenses/devices');

    const dev = new Licensing({
      config: { siteUrl: '', supabaseUrl: '', supabaseAnonKey: '', publicKey: null },
      fetch: fetch,
      load: async () => ({ token: null, email: null, refreshToken: null }),
      save: async () => {},
      fingerprint: async () => FINGERPRINT,
      device: () => ({ deviceName: '', platform: null, appVersion: '' }),
    });
    expect(await dev.start()).toMatchObject({ plan: 'studio', state: 'not-configured' });
  });
});
