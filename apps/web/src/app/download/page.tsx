import type { Metadata } from 'next';
import Link from 'next/link';
import { canDownload, loadAccount } from '@/lib/account';
import { adminClient, currentUser } from '@/lib/supabase';
import { Downloads } from '../account/widgets';

export const metadata: Metadata = { title: 'Download' };
export const dynamic = 'force-dynamic';

interface Release {
  platform: 'windows' | 'macos';
  version: string;
  minimum_os_version: string;
}

export default async function DownloadPage() {
  const user = await currentUser().catch(() => null);
  const subscriptions = user ? await loadAccount(adminClient(), user.id).catch(() => []) : [];
  const { data } = user
    ? await adminClient()
        .from('gs_release_builds')
        .select('platform, version, minimum_os_version')
        .eq('channel', 'stable')
        .eq('active', true)
    : { data: null };
  const releases = (data ?? []) as Release[];
  const line = (platform: Release['platform'], label: string) => {
    const release = releases.find((candidate) => candidate.platform === platform);
    return release ? `${label} ${release.version}${release.minimum_os_version ? ` · ${release.minimum_os_version} or later` : ''}` : null;
  };

  return (
    <>
      <div className="hero">
        <div className="eyebrow">Download</div>
        <h1>Get the app</h1>
        <p className="lede">For macOS and Windows 10 / 11. Install it, open it, and sign in with your account; it activates itself.</p>
      </div>
      <div className="panel" style={{ maxWidth: 640 }}>
        {!user ? (
          <>
            <p>Sign in to download. Downloads come with a subscription.</p>
            <div className="actions">
              <Link className="button" href="/signin?next=/download">
                Sign in
              </Link>
              <Link className="button secondary" href="/pricing">
                See plans
              </Link>
            </div>
          </>
        ) : canDownload(subscriptions) ? (
          <>
            <Downloads />
            <p className="muted" style={{ marginTop: 12 }}>
              {[line('macos', 'Mac'), line('windows', 'Windows')].filter(Boolean).join(' · ') || 'The first builds are on their way.'}
            </p>
          </>
        ) : (
          <>
            <p>Downloads come with an active subscription.</p>
            <div className="actions">
              <Link className="button" href="/pricing">
                See plans
              </Link>
            </div>
          </>
        )}
      </div>
    </>
  );
}
