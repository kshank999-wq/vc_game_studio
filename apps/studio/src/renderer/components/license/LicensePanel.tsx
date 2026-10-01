import { useState } from 'react';
import { licenseBridge, useAccess, type Access } from '../../edition';
import { Modal } from '../menu/Dialogs';

/**
 * License and account (desktop only, loaded when opened). Signing in is
 * activating: the email the subscription is under, the code it is sent, and
 * this computer takes one of the license's two seats. Signing out frees it.
 */

const PLAN_NAME = { studio: 'VC Game Studio', writer: 'VC Game Writer', none: 'Not activated' } as const;

const date = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '—');

const why = (access: Access): string => {
  switch (access.state) {
    case 'signed-out':
      return 'Sign in with the email address your subscription is under. Until then everything works except saving and engine export.';
    case 'not-activated':
      return 'Signed in, but this computer has no seat on a license yet.';
    case 'expired-offline':
      return 'This computer has not reached vc-gamestudio.com for a while, so its license has run out here. Connect and check again.';
    case 'not-configured':
      return 'A developer build: licensing is not set up, so everything is unlocked.';
    default:
      return '';
  }
};

export default function LicensePanel({ onClose }: { onClose: () => void }) {
  const access = useAccess();
  const bridge = licenseBridge();
  const [email, setEmail] = useState(access.email ?? '');
  const [code, setCode] = useState('');
  const [serial, setSerial] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!bridge) return null;
  const run = async (work: () => Promise<Access>, after?: (result: Access) => void) => {
    setBusy(true);
    setNote(null);
    try {
      const result = await work();
      if (result.message) setNote(result.message);
      after?.(result);
    } finally {
      setBusy(false);
    }
  };
  const licensed = access.state === 'licensed';
  const signedIn = Boolean(access.email) && access.state !== 'signed-out';

  return (
    <Modal title="License and account" onClose={onClose}>
      <div className="license-panel">
        <div className={`license-plan ${licensed ? 'on' : 'off'}`}>{PLAN_NAME[access.plan]}</div>
        {licensed ? (
          <dl className="license-facts">
            <dt>Account</dt>
            <dd>{access.email}</dd>
            <dt>License</dt>
            <dd className="license-serial">{access.serial}</dd>
            <dt>Paid through</dt>
            <dd>{date(access.paidThrough)}</dd>
            <dt>Works offline until</dt>
            <dd>{date(access.validUntil)}</dd>
          </dl>
        ) : (
          <p className="dialog-text">{why(access)}</p>
        )}
        {access.plan === 'writer' ? <p className="dialog-text">Engine export to Godot, Unity and Unreal is in the VC Game Studio plan; upgrade from your account page.</p> : null}

        {!licensed && !signedIn && access.state !== 'not-configured' ? (
          step === 'email' ? (
            <form
              className="license-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => bridge.requestCode(email), (result) => !result.message && setStep('code'));
              }}
            >
              <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.currentTarget.value)} aria-label="Email address" autoFocus />
              <button className="tb-btn primary" disabled={busy}>
                {busy ? 'Sending…' : 'Email me a code'}
              </button>
            </form>
          ) : (
            <form
              className="license-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => bridge.verifyCode(email, code));
              }}
            >
              <p className="dialog-text">We sent a code to {email}. Type it here.</p>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" required placeholder="123456" value={code} onChange={(e) => setCode(e.currentTarget.value)} aria-label="Code" autoFocus />
              <button className="tb-btn primary" disabled={busy}>
                {busy ? 'Activating…' : 'Sign in and activate'}
              </button>
              <button type="button" className="tb-btn" onClick={() => setStep('email')}>
                Use another email
              </button>
            </form>
          )
        ) : null}

        {!licensed && signedIn ? (
          <form
            className="license-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => bridge.activate(serial || undefined));
            }}
          >
            <p className="dialog-text">Signed in as {access.email}.</p>
            <input type="text" placeholder="License (optional): VCGS-…" value={serial} onChange={(e) => setSerial(e.currentTarget.value)} aria-label="License" />
            <button className="tb-btn primary" disabled={busy}>
              {busy ? 'Activating…' : 'Activate this computer'}
            </button>
          </form>
        ) : null}

        {note ? (
          <p className="license-note" role="status">
            {note}
          </p>
        ) : null}
      </div>
      <div className="dialog-actions">
        {signedIn || licensed ? (
          <button className="tb-btn" disabled={busy} onClick={() => void run(() => bridge.signOut())} title="Frees this computer's seat. Your projects stay where they are.">
            Sign out of this computer
          </button>
        ) : null}
        <button className="tb-btn" disabled={busy} onClick={() => void run(() => bridge.refresh())}>
          Check again
        </button>
        <div className="grow" />
        <button className="tb-btn" onClick={() => void bridge.open(licensed || signedIn ? 'account' : 'pricing')}>
          {licensed || signedIn ? 'Your account' : 'See plans'}
        </button>
        <button className="tb-btn primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
