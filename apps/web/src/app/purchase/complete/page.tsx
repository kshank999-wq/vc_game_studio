import type { Metadata } from 'next';
import Link from 'next/link';
import { issueFromCheckout } from '@/lib/issue-license';

export const metadata: Metadata = { title: 'Thank you' };
export const dynamic = 'force-dynamic';

/**
 * Where Stripe returns after a subscription checkout. The webhook normally
 * issues the license first; this page also reads the checkout back from Stripe
 * and issues it if the webhook has not, so the customer never lands here
 * without one. Either way the license is emailed once and shown on the
 * account page. The page shows neither, since its address can be shared.
 */
export default async function PurchaseComplete({ searchParams }: { searchParams: { session_id?: string } }) {
  const sessionId = searchParams.session_id;
  const record = sessionId?.startsWith('cs_')
    ? await issueFromCheckout(sessionId).catch((cause: unknown) => {
        console.error(`[purchase] ${sessionId}: ${cause instanceof Error ? cause.message : String(cause)}`);
        return null;
      })
    : null;

  return (
    <div className="hero">
      <div className="eyebrow">Subscribed</div>
      <h1>Thank you</h1>
      {record ? (
        <p className="lede">
          Your license is ready. We have emailed it to you, and it is on your account page. Download the app, open it, and sign
          in with the same email address; it activates itself.
        </p>
      ) : (
        <p className="lede">
          Your payment went through. Your license is being issued and will arrive by email in a minute; it also appears on your
          account page. Download the app, open it, and sign in with the same email address.
        </p>
      )}
      <div className="actions">
        <Link className="button" href="/account">
          Go to your account
        </Link>
        <Link className="button secondary" href="/download">
          Download
        </Link>
      </div>
    </div>
  );
}
