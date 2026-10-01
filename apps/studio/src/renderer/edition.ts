import { useSyncExternalStore } from 'react';

/** Where the preview edition sends people who want to keep their work. */
export const PURCHASE_URL = 'https://vc-gamestudio.com/pricing';

/**
 * What this copy may do. The browser builds decide at build time: the preview
 * saves nothing, the full web build is everything. The desktop app asks its
 * license (src/main/licensing.ts): no active license is the preview edition —
 * every project opens, nothing saves — VC Game Writer saves, and VC Game
 * Studio also exports to the engines. `__LICENSING__` is true only in the
 * desktop build, so none of the license plumbing reaches the web bundles.
 */

export type Plan = 'studio' | 'writer' | 'none';

export interface Access {
  plan: Plan;
  state: 'licensed' | 'signed-out' | 'not-activated' | 'expired-offline' | 'not-configured' | 'web';
  email: string | null;
  serial: string | null;
  paidThrough: string | null;
  validUntil: string | null;
  message: string | null;
}

/** The desktop host's license calls (src/preload). */
export interface LicenseBridge {
  now: () => Access;
  onChange: (listener: (access: Access) => void) => () => void;
  requestCode: (email: string) => Promise<Access>;
  verifyCode: (email: string, code: string) => Promise<Access>;
  activate: (serial?: string) => Promise<Access>;
  refresh: () => Promise<Access>;
  signOut: () => Promise<Access>;
  open: (page: 'account' | 'pricing' | 'download') => Promise<void>;
}

export const licenseBridge = (): LicenseBridge | undefined =>
  __LICENSING__ ? (globalThis as { vcgs?: { license?: LicenseBridge } }).vcgs?.license : undefined;

const web = (plan: Plan) => ({ plan, state: 'web' }) as Access;

let access: Access = __EDITION__ === 'preview' ? web('none') : web('studio');
const listeners = new Set<() => void>();
if (__LICENSING__) {
  const bridge = licenseBridge();
  if (bridge) {
    access = bridge.now();
    bridge.onChange((next) => {
      access = next;
      for (const listener of listeners) listener();
    });
  }
}

export const currentAccess = (): Access => access;
export const isPreview = (): boolean => access.plan === 'none';
export const canExport = (): boolean => access.plan === 'studio';

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Re-renders when the license changes (an activation, a lapse). The web builds never change. */
export const useAccess = (): Access => (__LICENSING__ ? useSyncExternalStore(subscribe, currentAccess) : access);
