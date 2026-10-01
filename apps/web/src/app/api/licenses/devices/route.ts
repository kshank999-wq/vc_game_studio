import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deactivateDevice, listDevices } from '@/lib/activation-service';
import { adminClient, callerFrom } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The computers using this account's seats, and the ones that used to. */
export async function GET(request: Request): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return NextResponse.json({ error: 'Sign in to see your computers' }, { status: 401 });
  return NextResponse.json({ devices: await listDevices(caller.id, adminClient()) });
}

const deleteSchema = z.union([z.object({ activationId: z.string().uuid() }), z.object({ fingerprint: z.string().min(16).max(200) })]);

/**
 * Free a seat. From the account page, any of the account's computers (the
 * lost-laptop case, done by the customer); from the app, its own. The record
 * is kept, marked freed.
 */
export async function DELETE(request: Request): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return NextResponse.json({ error: 'Sign in to manage your computers' }, { status: 401 });
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Which computer?' }, { status: 400 });
  const result = await deactivateDevice(caller, parsed.data, adminClient());
  return result.ok ? NextResponse.json({ deactivated: true }) : NextResponse.json({ error: result.error }, { status: 400 });
}
