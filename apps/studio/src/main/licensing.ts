import type { KeyObject } from 'node:crypto';
import { planFrom, readToken, type Entitlement, type Plan } from './license-token';

/**
 * The license, as the desktop app keeps it.
 *
 * Signing in is activating: the customer types the email their subscription is
 * under, gets a code from the shared VC account system (Supabase, the same one
 * VC Writer signs in to), and this computer takes one of the license's two
 * seats. The site answers with a signed entitlement (license-token.ts) that is
 * kept on disk; the app checks in when it starts and every few hours, and
 * offline the last entitlement lasts its grace (14 days).
 *
 * Without an active entitlement the app is the preview edition: every project
 * opens and can be read and played, nothing saves. VC Game Writer saves;
 * VC Game Studio also exports to the engines. Nothing is ever deleted.
 *
 * Kept free of Electron so it is tested with fakes; licensing-ipc.ts wires it
 * to the windows.
 */

export type AccessPlan = Plan | 'none';

export interface Access {
  plan: AccessPlan;
  /** licensed, or why not; not-configured is a developer build without the license keys. */
  state: 'licensed' | 'signed-out' | 'not-activated' | 'expired-offline' | 'not-configured';
  email: string | null;
  serial: string | null;
  paidThrough: string | null;
  validUntil: string | null;
  /** The last thing worth telling the customer (a refusal, a network problem). */
  message: string | null;
}

export interface Stored {
  token: string | null;
  email: string | null;
  /** Supabase refresh token, encrypted at rest by the store where the system can. */
  refreshToken: string | null;
}

export interface LicensingConfig {
  siteUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  publicKey: KeyObject | null;
}

export interface LicensingDeps {
  config: LicensingConfig;
  fetch: typeof fetch;
  load: () => Promise<Stored>;
  save: (stored: Stored) => Promise<void>;
  fingerprint: () => Promise<string>;
  device: () => { deviceName: string; platform: 'windows' | 'macos' | null; appVersion: string };
  now?: () => Date;
}

export const isConfigured = (config: LicensingConfig): boolean =>
  Boolean(config.siteUrl && config.supabaseUrl && config.supabaseAnonKey && config.publicKey);

const EMPTY: Stored = { token: null, email: null, refreshToken: null };

export class Licensing {
  private stored: Stored = EMPTY;
  private fingerprintValue = '';
  private message: string | null = null;
  private session: { accessToken: string; expiresAt: number } | null = null;
  private listeners = new Set<(access: Access) => void>();

  constructor(private readonly deps: LicensingDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async start(): Promise<Access> {
    this.fingerprintValue = await this.deps.fingerprint();
    this.stored = { ...EMPTY, ...(await this.deps.load()) };
    return this.access();
  }

  onChange(listener: (access: Access) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private entitlement(): Entitlement | null {
    const key = this.deps.config.publicKey;
    return key && this.stored.token ? readToken(this.stored.token, key) : null;
  }

  access(): Access {
    const base = { email: this.stored.email, message: this.message };
    if (!isConfigured(this.deps.config)) {
      return { ...base, plan: 'studio', state: 'not-configured', serial: null, paidThrough: null, validUntil: null };
    }
    const entitlement = this.entitlement();
    const plan = planFrom(entitlement, this.fingerprintValue, this.now());
    const facts = { serial: entitlement?.serial ?? null, paidThrough: entitlement?.paidThrough ?? null, validUntil: entitlement?.validUntil ?? null };
    if (plan) return { ...base, ...facts, plan, state: 'licensed' };
    const state: Access['state'] = entitlement && entitlement.fingerprint === this.fingerprintValue
      ? 'expired-offline'
      : !this.stored.refreshToken
        ? 'signed-out'
        : 'not-activated';
    return { ...base, ...facts, plan: 'none', state };
  }

  canSave(): boolean {
    return this.access().plan !== 'none';
  }

  canExport(): boolean {
    return this.access().plan === 'studio';
  }

  private async commit(patch: Partial<Stored>, message: string | null = this.message): Promise<Access> {
    this.stored = { ...this.stored, ...patch };
    this.message = message;
    await this.deps.save(this.stored);
    const access = this.access();
    for (const listener of this.listeners) listener(access);
    return access;
  }

  private async auth(path: string, body: unknown): Promise<Record<string, unknown>> {
    const { supabaseUrl, supabaseAnonKey } = this.deps.config;
    const response = await this.deps.fetch(`${supabaseUrl}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: supabaseAnonKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const text = String(json['msg'] ?? json['error_description'] ?? json['message'] ?? `Sign-in failed (${response.status})`);
      throw new Error(/signups not allowed|user not found/i.test(text) ? 'There is no account for that email. Use the address your subscription is under.' : text);
    }
    return json;
  }

  /** Step one of signing in: email a code to an existing account. */
  async requestCode(email: string): Promise<void> {
    await this.auth('otp', { email: email.trim().toLowerCase(), create_user: false });
  }

  /** Step two: the code, then this computer takes its seat. */
  async verifyCode(email: string, code: string): Promise<Access> {
    const json = await this.auth('verify', { type: 'email', email: email.trim().toLowerCase(), token: code.trim() });
    this.takeSession(json);
    await this.commit({ email: String((json['user'] as { email?: string } | undefined)?.email ?? email), refreshToken: String(json['refresh_token'] ?? '') || null }, null);
    return this.activate(null);
  }

  private takeSession(json: Record<string, unknown>): void {
    const accessToken = String(json['access_token'] ?? '');
    if (!accessToken) throw new Error('Sign-in did not return a session.');
    this.session = { accessToken, expiresAt: this.now().getTime() + Number(json['expires_in'] ?? 3600) * 1000 - 60_000 };
  }

  private async accessToken(): Promise<string | null> {
    if (this.session && this.session.expiresAt > this.now().getTime()) return this.session.accessToken;
    if (!this.stored.refreshToken) return null;
    const json = await this.auth('token?grant_type=refresh_token', { refresh_token: this.stored.refreshToken });
    this.takeSession(json);
    // Supabase rotates refresh tokens; keep the new one.
    await this.commit({ refreshToken: String(json['refresh_token'] ?? this.stored.refreshToken) });
    return this.session?.accessToken ?? null;
  }

  private async site(path: string, method: 'POST' | 'DELETE', body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const token = await this.accessToken();
    if (!token) return { status: 401, json: { reason: 'signed_out' } };
    const response = await this.deps.fetch(`${this.deps.config.siteUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: (await response.json().catch(() => ({}))) as Record<string, unknown> };
  }

  private deviceBody(): Record<string, unknown> | null {
    const device = this.deps.device();
    if (!device.platform) return null;
    return { fingerprint: this.fingerprintValue, deviceName: device.deviceName, platform: device.platform, appVersion: device.appVersion };
  }

  /** Take a seat on the account's license (or the one named), and keep the entitlement. */
  async activate(serial: string | null): Promise<Access> {
    const device = this.deviceBody();
    if (!device) return this.commit({}, 'VC Game Studio is licensed for macOS and Windows.');
    try {
      const { status, json } = await this.site('/api/licenses/activate', 'POST', { ...device, ...(serial ? { serial } : {}) });
      if (status === 200 && typeof json['token'] === 'string') return this.commit({ token: json['token'] }, null);
      return this.commit({}, String(json['error'] ?? `Activation failed (${status}).`));
    } catch {
      return this.commit({}, 'Could not reach vc-gamestudio.com. Check the connection and try again.');
    }
  }

  /**
   * The regular check-in. A fresh entitlement while the seat holds; the reason
   * when it does not. Offline, nothing changes: the last entitlement runs out
   * on its own date.
   */
  async refresh(): Promise<Access> {
    if (!isConfigured(this.deps.config) || !this.stored.refreshToken) return this.access();
    const device = this.deviceBody();
    if (!device) return this.access();
    try {
      const { status, json } = await this.site('/api/licenses/status', 'POST', device);
      if (status === 200 && typeof json['token'] === 'string') return this.commit({ token: json['token'] }, null);
      const reason = String(json['reason'] ?? '');
      // Signed in on a computer that never took its seat (an earlier attempt failed): take it now.
      if (reason === 'no_license' && !this.stored.token) return this.activate(null);
      if (reason === 'device_removed' || reason === 'license_inactive' || reason === 'no_license') {
        return this.commit({ token: null }, String(json['error'] ?? 'This computer is no longer licensed.'));
      }
      if (status === 401) return this.commit({ refreshToken: null }, 'Signed out. Sign in again to keep your license current.');
      return this.access();
    } catch {
      return this.access();
    }
  }

  /** Free this computer's seat and forget the account here. Projects are untouched. */
  async signOut(): Promise<Access> {
    try {
      if (this.stored.refreshToken) await this.site('/api/licenses/devices', 'DELETE', { fingerprint: this.fingerprintValue });
    } catch {
      // Offline: the seat can be freed from the account page instead.
    }
    this.session = null;
    return this.commit({ ...EMPTY }, null);
  }
}
