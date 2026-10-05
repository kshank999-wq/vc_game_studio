import type { Metadata } from 'next';
import { fetchDisplayPrices } from '@/lib/pricing';
import { DEVICES_PER_LICENSE, PLAN_ORDER, PLANS } from '@/lib/plans';
import { currentUser } from '@/lib/supabase';
import { PricingTiers } from './tiers';

export const metadata: Metadata = { title: 'Pricing' };
export const dynamic = 'force-dynamic';

export default async function PricingPage({ searchParams }: { searchParams: { cancelled?: string } }) {
  const prices = await fetchDisplayPrices();
  const user = await currentUser().catch(() => null);
  return (
    <>
      <div className="hero">
        <div className="eyebrow">Pricing</div>
        <h1>Monthly or yearly</h1>
        <p className="lede">
          VC Game Studio is the desktop app for Mac and Windows, on {DEVICES_PER_LICENSE} computers, with every update while you
          subscribe. Cancel any time from your account; your projects stay yours.
        </p>
        {searchParams.cancelled ? <p className="notice">Checkout was cancelled; nothing was charged.</p> : null}
      </div>
      <PricingTiers
        signedIn={Boolean(user)}
        tiers={PLAN_ORDER.map((plan) => ({ plan, ...PLANS[plan], prices: prices?.[plan] ?? {} }))}
      />
      <section>
        <h2>Questions</h2>
        <div className="grid two">
          <div className="panel">
            <h3>Where are my projects kept?</h3>
            <p className="muted">On your computer, as files you can copy, back up and put in version control. Nothing is uploaded.</p>
          </div>
          <div className="panel">
            <h3>What if my subscription ends?</h3>
            <p className="muted">
              You can still open and read every project; saving and engine export pause until you subscribe again. Nothing is
              deleted.
            </p>
          </div>
          <div className="panel">
            <h3>Does it work offline?</h3>
            <p className="muted">Yes. It checks your license when it can, and keeps working for 14 days without a connection.</p>
          </div>
          <div className="panel">
            <h3>Can I switch between monthly and yearly?</h3>
            <p className="muted">Yes, from your account at any time. Cancel there too; your projects stay on your computer.</p>
          </div>
        </div>
      </section>
    </>
  );
}
