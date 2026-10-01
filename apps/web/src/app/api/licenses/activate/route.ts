import { NextResponse } from 'next/server';
import { z } from 'zod';
import { activateDevice } from '@/lib/activation-service';
import { deviceSchema } from '@/lib/device-input';
import { RULES, rateLimit } from '@/lib/rate-limit';
import { signingKey } from '@/lib/signing';
import { adminClient, callerFrom } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = deviceSchema.extend({ serial: z.string().max(60).optional() });

/**
 * Put this computer on the caller's license and return its signed
 * entitlement. Called by the desktop app with the account's bearer token; a
 * serial is optional (without one, the account's best active license).
 */
export async function POST(request: Request): Promise<Response> {
  const limited = await rateLimit(request, RULES.activate);
  if (limited) return limited;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'A device is required' }, { status: 400 });
  const caller = await callerFrom(request);
  if (!caller) return NextResponse.json({ error: 'Sign in to activate VC Game Studio' }, { status: 401 });

  const { serial, ...device } = parsed.data;
  const result = await activateDevice(caller, device, serial?.trim() || null, adminClient(), signingKey());
  if (!result.ok) {
    return NextResponse.json({ error: result.message, reason: result.reason }, { status: result.reason === 'error' ? 500 : 409 });
  }
  return NextResponse.json({ token: result.token, entitlement: result.entitlement });
}
