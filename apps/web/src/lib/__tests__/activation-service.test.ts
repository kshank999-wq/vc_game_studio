import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { activateDevice, checkDevice, deactivateDevice, listDevices } from '../activation-service';
import { publicKeyPem, readEntitlement } from '../entitlement';
import { fakeSupabase, type Tables } from './fake-supabase';

const { privateKey } = generateKeyPairSync('ed25519');
const caller = { id: 'u1', email: 'ken@example.com' };
const device = (fingerprint: string) => ({ fingerprint: fingerprint.repeat(16), deviceName: `Mac ${fingerprint}`, platform: 'macos' as const, appVersion: '0.1.0' });
const license = (over: Record<string, unknown> = {}) => ({
  id: 'L1',
  user_id: 'u1',
  serial: 'VCGS-AAAAA-BBBBB-CCCCC-DDDDD',
  plan: 'studio',
  status: 'active',
  max_activations: 2,
  paid_through: '2027-01-01T00:00:00.000Z',
  ...over,
});
const seed = (licenses: Record<string, unknown>[]): Tables => ({ gs_licenses: licenses as Tables[string], gs_device_activations: [] });

describe('activating computers', () => {
  it('activates on the account without a serial, and the entitlement says which plan', async () => {
    const db = fakeSupabase(seed([license({ id: 'X', status: 'expired', serial: 'VCGS-X' }), license()]));
    const result = await activateDevice(caller, device('a'), null, db.client, privateKey);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const read = readEntitlement(result.token, publicKeyPem(privateKey));
    expect(read).toMatchObject({ plan: 'studio', serial: 'VCGS-AAAAA-BBBBB-CCCCC-DDDDD', fingerprint: 'a'.repeat(16), email: 'ken@example.com' });
  });

  it('two computers, then a clear refusal; a reinstall is the same seat', async () => {
    const db = fakeSupabase(seed([license()]));
    expect((await activateDevice(caller, device('a'), null, db.client, privateKey)).ok).toBe(true);
    expect((await activateDevice(caller, device('a'), null, db.client, privateKey)).ok).toBe(true);
    expect((await activateDevice(caller, device('b'), null, db.client, privateKey)).ok).toBe(true);
    const third = await activateDevice(caller, device('c'), null, db.client, privateKey);
    expect(third).toMatchObject({ ok: false, reason: 'no_slots' });
    expect(db.tables['gs_device_activations']).toHaveLength(2);
  });

  it("will not activate on someone else's serial", async () => {
    const db = fakeSupabase(seed([license({ user_id: 'someone-else' })]));
    expect(await activateDevice(caller, device('a'), 'VCGS-AAAAA-BBBBB-CCCCC-DDDDD', db.client, privateKey)).toMatchObject({
      ok: false,
      reason: 'no_license',
    });
  });

  it('checks in while the license holds, and stops when the seat is freed or the subscription ends', async () => {
    const db = fakeSupabase(seed([license()]));
    await activateDevice(caller, device('a'), null, db.client, privateKey);
    expect((await checkDevice(caller, device('a'), db.client, privateKey)).ok).toBe(true);
    expect(await checkDevice(caller, device('z'), db.client, privateKey)).toMatchObject({ ok: false, reason: 'no_license' });

    const [seat] = await listDevices('u1', db.client);
    expect(seat).toMatchObject({ name: 'Mac a', platform: 'macos', deactivatedAt: null });
    expect(await deactivateDevice(caller, { activationId: seat?.id ?? '' }, db.client)).toEqual({ ok: true, error: null });
    expect(await checkDevice(caller, device('a'), db.client, privateKey)).toMatchObject({ ok: false, reason: 'device_removed' });

    await activateDevice(caller, device('a'), null, db.client, privateKey);
    (db.tables['gs_licenses'] ?? [])[0]!['status'] = 'expired';
    expect(await checkDevice(caller, device('a'), db.client, privateKey)).toMatchObject({ ok: false, reason: 'license_inactive' });
  });

  it('frees only seats on the caller’s own licenses', async () => {
    const db = fakeSupabase(seed([license()]));
    await activateDevice(caller, device('a'), null, db.client, privateKey);
    expect((await deactivateDevice({ id: 'intruder', email: '' }, { fingerprint: 'a'.repeat(16) }, db.client)).ok).toBe(false);
    expect((await deactivateDevice(caller, { fingerprint: 'a'.repeat(16) }, db.client)).ok).toBe(true);
  });
});
