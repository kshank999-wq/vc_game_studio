/**
 * Transactional email templates, versioned as VC Writer's are, so the version
 * that sent any message is recorded in `email_events` and a change to what
 * customers receive is a reviewable diff. Email clients allow less than a
 * browser: tables, inline styles, solid colours, no web fonts.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  template: string;
  version: number;
}

// The studio's tokens (apps/studio/src/renderer/tokens.css), as literals.
const INK = '#0b0a07';
const PANEL = '#12100b';
const BORDER = '#332b17';
const GOLD = '#c9a45c';
const TEXT = '#f1e7cf';
const MUTED = '#9c8f6d';
const FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

const escape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const frame = (title: string, body: string): string => `<!doctype html>
<html><body style="margin:0;padding:0;background:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${INK}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:${PANEL};border:1px solid ${BORDER}">
<tr><td style="padding:28px 32px 8px;font-family:${FONT};font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:${GOLD}">VC Game Studio</td></tr>
<tr><td style="padding:0 32px;font-family:${FONT};font-size:22px;font-weight:600;color:${TEXT}">${escape(title)}</td></tr>
<tr><td style="padding:16px 32px 28px;font-family:${FONT};font-size:15px;line-height:1.6;color:${TEXT}">${body}</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid ${BORDER};font-family:${FONT};font-size:12px;color:${MUTED}">You are receiving this because of a purchase on vc-gamestudio.com.</td></tr>
</table></td></tr></table></body></html>`;

const button = (href: string, label: string): string =>
  `<a href="${escape(href)}" style="display:inline-block;padding:10px 18px;background:${GOLD};color:${INK};font-weight:600;text-decoration:none;border-radius:4px">${escape(label)}</a>`;

export interface LicenseEmailInput {
  serial: string;
  planName: string;
  accountUrl: string;
  downloadUrl: string;
}

/** Sent once, when a subscription first issues its license. */
export const licenseIssued = (input: LicenseEmailInput): RenderedEmail => ({
  subject: `Your ${input.planName} license`,
  template: 'gs-license-issued',
  version: 1,
  html: frame(
    `Welcome to ${input.planName}`,
    `<p>Your subscription is active. This is your license:</p>
<p style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:18px;letter-spacing:0.08em;color:${GOLD}">${escape(input.serial)}</p>
<p>Download the app for Mac or Windows, open it, and sign in with this email address. It activates itself; the license works on two computers.</p>
<p>${button(input.downloadUrl, 'Download VC Game Studio')}</p>
<p style="color:${MUTED}">Your account page has the license, your computers and your billing: <a href="${escape(input.accountUrl)}" style="color:${GOLD}">${escape(input.accountUrl)}</a></p>`,
  ),
  text: `Welcome to ${input.planName}

Your subscription is active. Your license: ${input.serial}

Download the app for Mac or Windows, open it, and sign in with this email address. It activates itself; the license works on two computers.

Download: ${input.downloadUrl}
Account (license, computers, billing): ${input.accountUrl}
`,
});

/** Asked for from the account page. */
export const licenseReminder = (input: LicenseEmailInput): RenderedEmail => ({
  ...licenseIssued(input),
  subject: `Your ${input.planName} license (as requested)`,
  template: 'gs-license-reminder',
  version: 1,
});
