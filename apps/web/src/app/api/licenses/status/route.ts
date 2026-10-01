import { NextResponse } from 'next/server';
import { checkDevice } from '@/lib/activation-service';
import { deviceSchema } from '@/lib/device-input';
import { RULES, rateLimit } from '@/lib/rate-limit';
import { signingKey } from '@/lib/signing';
import { adminClient, callerFrom } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The desktop app's regular check (at start and every few hours while it is
 * open): a fresh entitlement while this computer is on an active license, and
 * the reason when it is not.
 */
export async function POST(request: Request): Promise<Response> {
  const limited = await rateLimit(request, RULES.status);
  if (limited) return limited;
  const parsed = deviceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'A device is required' }, { status: 400 });
  const caller = await callerFrom(request);
  if (!caller) return NextResponse.json({ error: 'Signed out', reason: 'signed_out' }, { status: 401 });

  const result = await checkDevice(caller, parsed.data, adminClient(), signingKey());
  if (!result.ok) return NextResponse.json({ error: result.message, reason: result.reason }, { status: 409 });
  return NextResponse.json({ token: result.token, entitlement: result.entitlement });
}
