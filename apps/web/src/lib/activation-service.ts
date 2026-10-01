import type { KeyObject } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decideActivation, explainRefusal, type ActivationOutcome, type Seat, type SeatLicense } from './activation';
import { issueEntitlement, type Entitlement } from './entitlement';
import type { Plan } from './env';
import { normalizeSerial } from './license';
import { bestLicense, type LicenseStatus } from './plans';

/**
 * Seats and entitlements, against the gs_ tables. The rules are in
 * activation.ts and plans.ts; this is where they meet rows. The client and the
 * signing key are arguments so the sequencing is tested against a fake.
 */

export type Platform = 'windows' | 'macos';

interface LicenseRow {
  id: string;
  serial: string;
  plan: Plan;
  status: LicenseStatus;
  max_activations: number;
  paid_through: string | null;
}

interface SeatRow {
  id: string;
  license_id: string;
  device_fingerprint: string;
  device_name: string;
  platform: Platform;
  app_version: string;
  activated_at: string;
  last_seen_at: string | null;
  deactivated_at: string | null;
}

export interface Caller {
  id: string;
  email: string;
}

export interface DeviceInput {
  fingerprint: string;
  deviceName: string;
  platform: Platform;
  appVersion: string;
}

export type EntitlementResult =
  | { ok: true; token: string; entitlement: Entitlement }
  | { ok: false; reason: 'no_license' | 'license_inactive' | 'no_slots' | 'device_removed' | 'error'; message: string; outcome?: ActivationOutcome };

const LICENSE_COLUMNS = 'id, serial, plan, status, max_activations, paid_through';

const licensesOf = async (client: SupabaseClient, userId: string): Promise<LicenseRow[]> => {
  const { data } = await client.from('gs_licenses').select(LICENSE_COLUMNS).eq('user_id', userId);
  return (data ?? []) as LicenseRow[];
};

const seatsOf = async (client: SupabaseClient, licenseIds: string[]): Promise<SeatRow[]> => {
  if (licenseIds.length === 0) return [];
  const { data } = await client.from('gs_device_activations').select('*').in('license_id', licenseIds);
  return (data ?? []) as SeatRow[];
};

const asSeatLicense = (row: LicenseRow): SeatLicense => ({ id: row.id, status: row.status, maxActivations: row.max_activations });
const asSeat = (row: SeatRow): Seat => ({ licenseId: row.license_id, deviceFingerprint: row.device_fingerprint, deactivatedAt: row.deactivated_at });

const entitle = (caller: Caller, license: LicenseRow, fingerprint: string, key: KeyObject): EntitlementResult => {
  const { token, entitlement } = issueEntitlement(
    { serial: license.serial, plan: license.plan, fingerprint, email: caller.email, paidThrough: license.paid_through },
    key,
  );
  return { ok: true, token, entitlement };
};

/**
 * Put this computer on a license. With a serial, that license (it must be the
 * caller's: a serial is not a bearer token). Without one, the caller's best
 * active license — signing in is enough for nearly everyone.
 */
export const activateDevice = async (
  caller: Caller,
  device: DeviceInput,
  serial: string | null,
  client: SupabaseClient,
  key: KeyObject,
): Promise<EntitlementResult> => {
  const licenses = await licensesOf(client, caller.id);
  const license = serial
    ? licenses.find((candidate) => candidate.serial === normalizeSerial(serial)) ?? null
    : bestLicense(licenses) ?? licenses[0] ?? null;
  if (!license) {
    return {
      ok: false,
      reason: 'no_license',
      message: serial
        ? 'That license is not on this account. Sign in with the email address the subscription is under.'
        : 'This account has no VC Game Studio subscription. Subscribe at vc-gamestudio.com/pricing, then try again.',
    };
  }

  const seats = await seatsOf(client, [license.id]);
  const outcome = decideActivation(asSeatLicense(license), seats.map(asSeat), device.fingerprint);
  if (outcome.result === 'refused') {
    return { ok: false, reason: outcome.reason, message: explainRefusal(outcome), outcome };
  }

  const now = new Date().toISOString();
  const { error } = await client.from('gs_device_activations').upsert(
    {
      license_id: license.id,
      device_fingerprint: device.fingerprint,
      device_name: device.deviceName,
      platform: device.platform,
      app_version: device.appVersion,
      activated_at: now,
      last_seen_at: now,
      deactivated_at: null,
    },
    { onConflict: 'license_id,device_fingerprint' },
  );
  if (error) return { ok: false, reason: 'error', message: 'The activation could not be recorded. Try again in a moment.' };
  return entitle(caller, license, device.fingerprint, key);
};

/**
 * The app's regular check: is this computer still on an active license? A
 * fresh entitlement if so. A seat freed from the account page, or a license
 * whose subscription ended, says so, and the app stops saving.
 */
export const checkDevice = async (
  caller: Caller,
  device: DeviceInput,
  client: SupabaseClient,
  key: KeyObject,
): Promise<EntitlementResult> => {
  const licenses = await licensesOf(client, caller.id);
  const seats = await seatsOf(client, licenses.map((license) => license.id));
  const mine = seats.filter((seat) => seat.device_fingerprint === device.fingerprint);
  const live = mine.filter((seat) => seat.deactivated_at === null);
  const onLicenses = licenses.filter((license) => live.some((seat) => seat.license_id === license.id));
  const license = bestLicense(onLicenses);

  if (!license) {
    if (live.length > 0) {
      return { ok: false, reason: 'license_inactive', message: explainRefusal({ result: 'refused', reason: 'license_inactive' }) };
    }
    return mine.length > 0
      ? { ok: false, reason: 'device_removed', message: 'This computer was removed from your license on the account page. Activate it again to keep working.' }
      : { ok: false, reason: 'no_license', message: 'This computer is not activated yet.' };
  }

  const seat = live.find((candidate) => candidate.license_id === license.id);
  if (seat) {
    await client
      .from('gs_device_activations')
      .update({ last_seen_at: new Date().toISOString(), app_version: device.appVersion })
      .eq('id', seat.id);
  }
  return entitle(caller, license, device.fingerprint, key);
};

/** Free a seat: from the account page (any device) or from the app itself (this one). */
export const deactivateDevice = async (
  caller: Caller,
  target: { activationId: string } | { fingerprint: string },
  client: SupabaseClient,
): Promise<{ ok: boolean; error: string | null }> => {
  const licenses = await licensesOf(client, caller.id);
  const seats = await seatsOf(client, licenses.map((license) => license.id));
  const chosen = seats.filter((seat) =>
    seat.deactivated_at === null && ('activationId' in target ? seat.id === target.activationId : seat.device_fingerprint === target.fingerprint),
  );
  if (chosen.length === 0) return { ok: false, error: 'That computer is not on a license of yours.' };
  const { error } = await client
    .from('gs_device_activations')
    .update({ deactivated_at: new Date().toISOString() })
    .in('id', chosen.map((seat) => seat.id));
  return error ? { ok: false, error: error.message } : { ok: true, error: null };
};

export interface DeviceView {
  id: string;
  name: string;
  platform: Platform;
  appVersion: string;
  activatedAt: string;
  lastSeenAt: string | null;
  deactivatedAt: string | null;
  serial: string;
}

export const listDevices = async (userId: string, client: SupabaseClient): Promise<DeviceView[]> => {
  const licenses = await licensesOf(client, userId);
  const seats = await seatsOf(client, licenses.map((license) => license.id));
  return seats
    .map((seat) => ({
      id: seat.id,
      name: seat.device_name,
      platform: seat.platform,
      appVersion: seat.app_version,
      activatedAt: seat.activated_at,
      lastSeenAt: seat.last_seen_at,
      deactivatedAt: seat.deactivated_at,
      serial: licenses.find((license) => license.id === seat.license_id)?.serial ?? '',
    }))
    .sort((a, b) => Number(a.deactivatedAt !== null) - Number(b.deactivatedAt !== null) || b.activatedAt.localeCompare(a.activatedAt));
};
