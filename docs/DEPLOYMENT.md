# Selling VC Game Studio: deployment and service wiring

VC Game Studio is its own product, run on its own services, separate from
VC Writer. **vc-gamestudio.com** sells subscriptions and issues licenses, and customers download the desktop app
for Mac or Windows. Projects stay on the customer's computer, as files.

| Piece | Where | What it is |
| --- | --- | --- |
| Website | `apps/web` (Next.js on Vercel) | Home, pricing, sign-in, account (license, computers, billing), downloads, the browser preview at `/preview`, and the API the app calls |
| Desktop app | `apps/studio` (Electron) | Signs in, activates the computer, and checks its license (`src/main/licensing.ts`) |
| Accounts and records | Supabase project **vc-game-studio** (`ikzjxigttvdvguawvtyf`), its own | Customer accounts, subscriptions, licenses, computers and releases. `supabase/migrations/gs_0000`–`gs_0002`, **applied** |
| Payments | VC Game Studio's own Stripe account | One package, VC Game Studio, monthly and yearly |
| Email | Resend | The license email |

## Setting it up: six commands

Each step below is one command. Each is safe to run again, and all of them
share one git-ignored file, `apps/web/.env.production.local`. Run them on
your own computer, from the repository root, after `npm install`.

1. **Start the file** with the keys only you hold:

   ```bash
   cp apps/web/.env.example apps/web/.env.production.local
   ```

   Fill in `STRIPE_SECRET_KEY` (VC Game Studio's own Stripe account: Stripe →
   Developers → API keys) and `RESEND_API_KEY`. The Supabase URL and keys are
   written by the supabase step. Also fill in two personal tokens that are
   only for these steps and never uploaded:
   - `VERCEL_TOKEN`: Vercel → Account Settings → Tokens;
   - `SUPABASE_ACCESS_TOKEN`: supabase.com → Account → Access Tokens.
2. `npm run setup -w @vcgs/web -- keys` makes the license key pair. It
   prints the public half for GitHub.
3. `npm run setup -w @vcgs/web -- stripe --studio-monthly=24.99 --studio-yearly=249.99`
   (your prices) makes:
   - the product and its two prices;
   - the webhook (its secret goes into the file);
   - **a customer portal of Game Studio's own**.

   The portal offers exactly the monthly and yearly plans to switch between.
4. `npm run setup -w @vcgs/web -- resend` adds vc-gamestudio.com to Resend,
   puts its DNS records in Vercel and asks Resend to verify it.
5. `npm run setup -w @vcgs/web -- supabase` sets up the vc-game-studio
   project's sign-in:
   - writes its URL and keys into the file (no copying from the dashboard);
   - sets the site address to vc-gamestudio.com and allows its
     `/auth/callback`;
   - writes the sign-in email, with the six-digit code the desktop app asks
     for;
   - sends sign-in email through Resend from noreply@vc-gamestudio.com
     (Supabase's own mail server sends only a few an hour). Run the resend
     step first, so the domain is verified.
6. `npm run setup -w @vcgs/web -- vercel` does the Vercel side:
   - creates the `vc-game-studio` project, linked to this repository, with
     root `apps/web`;
   - attaches vc-gamestudio.com and www;
   - uploads every variable from the file (secrets as write-only).

`npm run setup -w @vcgs/web -- check` lists anything still missing. The
manual equivalents of each step are described below.

## How a sale works

1. The customer signs in on vc-gamestudio.com with an emailed link; the
   first sign-in makes their account.
2. Pricing → **Subscribe** opens a Stripe Checkout in subscription mode.
   Everything this site creates in Stripe carries
   `metadata.product = vc-game-studio`.
3. Stripe's `customer.subscription.created` event reaches
   `/api/stripe/webhook`. The webhook records the subscription in
   `gs_subscriptions`, issues one license in `gs_licenses` (serial
   `VCGS-XXXXX-XXXXX-XXXXX-XXXXX`, 2 computers) and emails it. Later
   `updated` and `deleted` events keep the license in step with Stripe:
   - a plan change follows the subscription;
   - the license stays active while Stripe retries a card (`past_due`);
   - the license expires when the subscription ends;
   - a refund or dispute revokes the license.
4. The customer downloads the installer from their account page. Each
   download is a 15-minute signed link from the private `gs-releases` bucket.
5. In the app, they type their email and the code they are sent. The
   computer takes one of the license's two seats, and the site returns a
   signed entitlement (Ed25519). The app keeps it, checks in at start and
   every 6 hours, and works offline for 14 days on the last one it got.
   - **No active license:** everything opens and plays, but nothing saves.
   - **VC Game Studio license:** saving and engine export both work.
   - Nothing is ever deleted.
6. A lost computer: **Free this seat** on the account page, then activate
   the new one.

## Vercel: the project

- **New project** in team `kshank999-5979's projects`, from
  `kshank999-wq/vc_game_studio`.
- **Root Directory:** `apps/web`, with **Include files outside the root
  directory** turned on. The build also builds the browser preview from
  `apps/studio`.
- **Framework:** Next.js, and the install command, are pinned by `apps/web/vercel.json`. It installs the whole repository (`cd ../.. && npm ci`), not just `apps/web`, because the build also builds the browser preview from `apps/studio`.
- **Production branch:** the branch that holds this work.
- **Domains:** `vc-gamestudio.com` and `www.vc-gamestudio.com`. The domain is
  already registered in Vercel, so attaching it is all that's needed.
- The repository-root `vercel.json` deliberately fails a build that runs from
  the root, and prints what to fix.

## Vercel: environment variables

Set these for Production, and for Preview if preview deployments should
work. The vercel setup step uploads them all from the file.

| Variable | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ikzjxigttvdvguawvtyf.supabase.co` | Written by the supabase step. Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → vc-game-studio → Project Settings → API Keys → `sb_publishable_…` | Written by the supabase step. Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → vc-game-studio → API Keys → `sb_secret_…` | Written by the supabase step. **Secret**, server only |
| `STRIPE_SECRET_KEY` | VC Game Studio's Stripe account → Developers → API keys | **Secret** |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → the **vc-gamestudio.com** endpoint → Signing secret | **New**, this endpoint's own. **Secret** |
| `STRIPE_PRICE_STUDIO_MONTHLY` | Stripe price id | New |
| `STRIPE_PRICE_STUDIO_YEARLY` | Stripe price id | New |
| `STRIPE_PORTAL_CONFIGURATION` | `bpc_…`, made by the stripe step | The customer portal with the two plans |
| `RESEND_API_KEY` | Resend → API keys | **Secret** |
| `RESEND_FROM_ADDRESS` | `VC Game Studio <noreply@vc-gamestudio.com>` | Needs vc-gamestudio.com verified in Resend |
| `LICENSE_SIGNING_PRIVATE_KEY` | The first line printed by `npm run keys:license -w @vcgs/web` | **Secret.** Signs what the app may do |
| `NEXT_PUBLIC_SITE_URL` | `https://vc-gamestudio.com` | Must include `https://`. A bad value is warned about and ignored |
| `STRIPE_AUTOMATIC_TAX` | `1` once Stripe Tax is active (Settings → Tax) | Optional. Off by default: a checkout that asks for automatic tax on an account without Stripe Tax set up fails |
| `RELEASE_BUCKET` | `gs-releases` | Optional; this is the default |
| `RELEASE_DOWNLOAD_TTL_SECONDS` | `900` | Optional; this is the default |
| `RATE_LIMIT_SALT` | Any random string | Optional |
| `ELECTRON_SKIP_BINARY_DOWNLOAD` | `1` | Optional; skips downloading Electron, which the site never uses |

There is no Stripe publishable key: checkout is Stripe's hosted page, so the
browser never needs one.

## The license key pair

Run this once:

```bash
npm run keys:license -w @vcgs/web
```

It prints two lines and writes nothing to disk:

- `LICENSE_SIGNING_PRIVATE_KEY=…` goes into **Vercel** (secret).
- `MAIN_VITE_LICENSE_PUBLIC_KEY=…` goes into **GitHub** (a variable; it is
  public).

Making a new pair later signs out every installed copy until they are rebuilt
with the new public key.

## Stripe

1. **Product:** create one, *VC Game Studio*. Give it a recurring
   **monthly** and a recurring **yearly** price, and put the two price ids in
   `STRIPE_PRICE_STUDIO_MONTHLY` and `STRIPE_PRICE_STUDIO_YEARLY`. The site reads the amounts
   from Stripe, so the price lives in one place.
2. **Webhook:** add an endpoint at `https://vc-gamestudio.com/api/stripe/webhook`
   for these events:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `charge.refunded`
   - `charge.dispute.created`

   Its signing secret goes in `STRIPE_WEBHOOK_SECRET`.
3. **Customer portal** (Settings → Billing → Customer portal): allow
   cancelling, updating the card, and **switching between the monthly and
   yearly prices**. Make this a **separate configuration**, not the default (VC
   Writer's Writers Room uses the default), and put its id in
   `STRIPE_PORTAL_CONFIGURATION`. The stripe setup step does all of this.
4. **Stripe Tax:** set it up under Settings → Tax, then set
   `STRIPE_AUTOMATIC_TAX=1` in Vercel so checkout calculates tax. Until then
   checkout runs without tax.

To test locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
Redelivering an event is safe: event ids are claimed in
`gs_stripe_webhook_events`, and there is one license per subscription.

## Resend

Verify **vc-gamestudio.com** as a sending domain (Resend gives you the DNS
records). Vercel manages the domain's DNS, so add them under Vercel → Domains.
A failed send is logged to `email_events` (templates `gs-license-*`) and
never fails a purchase; the account page always shows the license.

## Supabase (the vc-game-studio project)

- **Database:** done. `gs_0000_foundation` (accounts, email log, rate
  limiter), `gs_0001_commerce` and `gs_0002_trigger_functions_private` are
  applied. The security advisor reports only `email_events`, `rate_limits`
  and `gs_stripe_webhook_events` having no policies, which is intended
  (service role only).
- **Sign-in:** the supabase setup step sets the site address, the redirect
  list, the sign-in email (with `{{ .Token }}`, the code the desktop app
  asks for) and Resend as the mail server. By hand: Auth → URL
  configuration; Auth → Email templates → Magic link; Auth → SMTP settings
  (host `smtp.resend.com`, port 465, user `resend`, the Resend API key as
  the password).

## GitHub: building the installers

`.github/workflows/desktop-release.yml` runs on a `v*` tag:
- it builds the Windows installer and the macOS universal DMG;
- it uploads them as workflow artifacts;
- after approval in the `release` environment, it publishes them to customers
  (`apps/web/scripts/publish-release.mjs`).

In Settings → Secrets and variables → Actions:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `MAIN_VITE_SITE_URL` | `https://vc-gamestudio.com` |
| Variable | `MAIN_VITE_SUPABASE_URL` | `https://ikzjxigttvdvguawvtyf.supabase.co` |
| Variable | `MAIN_VITE_SUPABASE_ANON_KEY` | The same publishable key as above |
| Variable | `MAIN_VITE_LICENSE_PUBLIC_KEY` | The second line from `keys:license` |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | For the publish job |
| Secret | `CSC_LINK`, `CSC_KEY_PASSWORD` | Apple Developer ID Application certificate (.p12, base64) and its password |
| Secret | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization |
| Secret | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE` | Windows signing via Azure Artifact Signing (VC Entertainment LLC's certificate profile; Game Studio signs as its own app registration, `vcgs-github-signing`). Alternatively `WINDOWS_CERTIFICATE` + `WINDOWS_CERTIFICATE_PASSWORD` |

The workflow refuses to package without the three licensing variables,
because a build without them has licensing switched off. The Apple and
Azure secrets are VC Entertainment LLC's signing credentials. Without them the installers are unsigned:
macOS and Windows will warn on first run, so do not publish those.

Then add the `release` environment (Settings → Environments) with yourself as
a required reviewer.

To publish by hand instead:

```bash
npm run publish:release -w @vcgs/web -- <installer> <macos|windows> <version>
```

## Local development

- `npm run dev -w @vcgs/web`: the site, with the variables above in
  `apps/web/.env.local`.
- `npm run dev -w @vcgs/studio`: the app. Without the `MAIN_VITE_*`
  variables it is a developer build with licensing off.
