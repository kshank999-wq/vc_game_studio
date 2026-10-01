import { NextResponse } from 'next/server';
import { canDownload, loadAccount } from '@/lib/account';
import { env } from '@/lib/env';
import { adminClient, currentUser } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A download of the current installer for one platform. Never a permanent
 * public URL: every request re-checks the account's license and mints a
 * short-lived signed URL, so a leaked link dies within minutes.
 */
export async function GET(_request: Request, { params }: { params: { platform: string } }): Promise<Response> {
  const platform = params.platform === 'windows' || params.platform === 'macos' ? params.platform : null;
  if (!platform) return NextResponse.json({ error: 'Unknown platform' }, { status: 404 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in to download VC Game Studio' }, { status: 401 });

  const client = adminClient();
  if (!canDownload(await loadAccount(client, user.id))) {
    return NextResponse.json({ error: 'Downloads come with an active subscription' }, { status: 403 });
  }

  const { data: build, error } = await client
    .from('gs_release_builds')
    .select('version, artifact_key, sha256, minimum_os_version')
    .eq('platform', platform)
    .eq('channel', 'stable')
    .eq('active', true)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not read the releases' }, { status: 500 });
  if (!build) return NextResponse.json({ error: 'No published build for this platform yet' }, { status: 404 });

  const { data: signed, error: signError } = await client.storage
    .from(env.releaseBucket)
    .createSignedUrl(build.artifact_key as string, env.releaseDownloadTtlSeconds, { download: true });
  if (signError || !signed) return NextResponse.json({ error: 'Could not prepare the download' }, { status: 500 });

  return NextResponse.json({
    url: signed.signedUrl,
    version: build.version,
    sha256: build.sha256,
    minimumOsVersion: build.minimum_os_version,
  });
}
