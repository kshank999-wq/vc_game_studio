/**
 * VC Game Studio's own Supabase project's sign-in settings, through the
 * Management API: the site's address (where a refused link falls back to),
 * this site's callback on the redirect allow list, the sign-in email (with
 * the six-digit code the desktop app asks for) and, given a Resend key, the
 * mail server it is sent through, from the site's own address. Settings
 * already right are left as they are.
 */

type Fetch = typeof fetch;

export const addRedirect = (list: string | null | undefined, url: string): { list: string; changed: boolean } => {
  const entries = (list ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.includes(url)) return { list: entries.join(','), changed: false };
  return { list: [...entries, url].join(','), changed: true };
};

export const carriesCode = (template: string | null | undefined): boolean => /\{\{\s*\.Token\s*\}\}/.test(template ?? '');

export const SIGN_IN_SUBJECT = 'Your VC Game Studio sign-in';

/** The sign-in email: the link for the website, the code for the desktop app. */
export const SIGN_IN_EMAIL = `<h2>Sign in to VC Game Studio</h2>
<p><a href="{{ .ConfirmationURL }}">Sign in</a></p>
<p>Or type this code in the app: <strong>{{ .Token }}</strong></p>
<p>If you did not ask to sign in, you can ignore this email.</p>`;

export interface AuthSetupOptions {
  accessToken: string;
  projectRef: string;
  /** The site, e.g. https://vc-gamestudio.com. */
  siteUrl: string;
  callbackUrl: string;
  /** Send sign-in email through Resend (from this address) rather than Supabase's own, rate-limited server. */
  smtp?: { resendKey: string; fromAddress: string; fromName: string };
}

interface AuthConfig {
  site_url?: string;
  uri_allow_list?: string;
  mailer_subjects_magic_link?: string;
  mailer_templates_magic_link_content?: string;
  smtp_host?: string | null;
  smtp_admin_email?: string | null;
}

/**
 * The project's API keys, for the site's env file: the publishable key (public,
 * the browser's) and the secret key (the server's). The legacy anon and
 * service_role keys stand in for a project without the newer ones.
 */
export const projectKeys = async (fetcher: Fetch, options: { accessToken: string; projectRef: string }): Promise<{ anon: string; service: string }> => {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${options.projectRef}/api-keys?reveal=true`, {
    headers: { authorization: `Bearer ${options.accessToken}` },
  });
  if (!response.ok) throw new Error(`Reading the project's API keys failed (HTTP ${response.status}).`);
  const keys = (await response.json()) as { name?: string; type?: string; api_key?: string }[];
  const find = (type: string, legacy: string) =>
    keys.find((key) => key.type === type && key.api_key)?.api_key ?? keys.find((key) => key.name === legacy && key.api_key)?.api_key ?? '';
  const anon = find('publishable', 'anon');
  const service = find('secret', 'service_role');
  if (!anon || !service) throw new Error("The project's API keys were not all readable; copy them from Supabase → Project Settings → API Keys instead.");
  return { anon, service };
};

export const setupSupabaseAuth = async (fetcher: Fetch, options: AuthSetupOptions): Promise<{ notes: string[]; codeInEmail: boolean }> => {
  const url = `https://api.supabase.com/v1/projects/${options.projectRef}/config/auth`;
  const headers = { authorization: `Bearer ${options.accessToken}`, 'content-type': 'application/json' };
  const response = await fetcher(url, { headers });
  if (!response.ok) throw new Error(`Reading the auth settings failed (HTTP ${response.status}). Is SUPABASE_ACCESS_TOKEN a personal access token with access to the project?`);
  const config = (await response.json()) as AuthConfig;
  const notes: string[] = [];
  const patch: Record<string, unknown> = {};

  if (config.site_url !== options.siteUrl) {
    patch['site_url'] = options.siteUrl;
    notes.push(`Set the site address to ${options.siteUrl}.`);
  }
  const next = addRedirect(config.uri_allow_list, options.callbackUrl);
  if (next.changed) {
    patch['uri_allow_list'] = next.list;
    notes.push(`Added ${options.callbackUrl} to the sign-in redirect list.`);
  } else {
    notes.push(`${options.callbackUrl} is already on the sign-in redirect list.`);
  }
  const hadCode = carriesCode(config.mailer_templates_magic_link_content);
  if (!hadCode) {
    patch['mailer_subjects_magic_link'] = SIGN_IN_SUBJECT;
    patch['mailer_templates_magic_link_content'] = SIGN_IN_EMAIL;
    notes.push('Wrote the sign-in email, with the six-digit code the desktop app asks for.');
  } else {
    notes.push('The sign-in email already carries the six-digit code the desktop app asks for.');
  }
  if (options.smtp) {
    if (config.smtp_host === 'smtp.resend.com' && config.smtp_admin_email === options.smtp.fromAddress) {
      notes.push(`Sign-in email already goes through Resend, from ${options.smtp.fromAddress}.`);
    } else {
      Object.assign(patch, {
        external_email_enabled: true,
        smtp_host: 'smtp.resend.com',
        smtp_port: '465',
        smtp_user: 'resend',
        smtp_pass: options.smtp.resendKey,
        smtp_admin_email: options.smtp.fromAddress,
        smtp_sender_name: options.smtp.fromName,
      });
      notes.push(`Sign-in email now goes through Resend, from ${options.smtp.fromAddress} (not Supabase's own server, which sends only a few an hour).`);
    }
  } else if (!config.smtp_host) {
    notes.push("Sign-in email still goes through Supabase's own server, which sends only a few an hour: put RESEND_API_KEY in the file and run this step again.");
  }

  if (Object.keys(patch).length) {
    const patched = await fetcher(url, { method: 'PATCH', headers, body: JSON.stringify(patch) });
    if (!patched.ok) throw new Error(`Updating the sign-in settings failed (HTTP ${patched.status}).`);
  }
  return { notes, codeInEmail: true };
};
