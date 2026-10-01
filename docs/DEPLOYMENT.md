# Selling VC Game Studio: deployment and service wiring

VC Game Studio is sold the way VC Writer is: **vc-gamestudio.com** sells
subscriptions and issues licenses, and customers download the desktop app
for Mac or Windows. Projects stay on the customer's computer, as files.

| Piece | Where | What it is |
| --- | --- | --- |
| Website | `apps/web` (Next.js on Vercel) | Home, pricing, sign-in, account (license, computers, billing), downloads, the browser preview at `/preview`, and the API the app calls |
| Desktop app | `apps/studio` (Electron) | Signs in, activates the computer, and checks its license (`src/main/licensing.ts`) |
| Accounts and records | Supabase project **VCWriter** (`kpviyoqhmzignjyvixws`), shared with VC Writer | One account for both products. The tables are VC Game Studio's own, named `gs_*` (`supabase/migrations/gs_0001_commerce.sql`, **applied**) |
| Payments | The Stripe account VC Writer uses | Two plans (VC Game Writer, VC Game Studio), each monthly and yearly |
| Email | Resend | The license email |

## How a sale works

1. The customer signs in on vc-gamestudio.com with an emailed link. It is the
   same account as VC Writer, if they have one.
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
   - **VC Game Writer:** saving works; engine export does not.
   - **VC Game Studio:** saving and engine export both work.
   - Nothing is ever deleted.
6. A lost computer: **Free this seat** on the account page, then activate
   the new one.

## Before selling: one change to VC Writer

Stripe sends every event in an account to every webhook endpoint, so VC
Writer's webhook will see Game Studio's checkouts. As it stands, it would
issue a **VC Writer** license for each one. It also has a related existing
bug: it issues a desktop license for a Writers Room seat checkout.

The fix is in `docs/commerce/vcwriter-stripe-scope.patch`:
- skip events tagged `vc-game-studio`;
- issue a license only for a paid one-off checkout.

It is tested against VC Writer's own suite. Apply it to `kshank999-wq/VCWriter`
and deploy it before the first Game Studio sale:

```bash
cd VCWriter && git apply ../vc_game_studio/docs/commerce/vcwriter-stripe-scope.patch
```

## Vercel: the project

- **New project** in team `kshank999-5979's projects`, from
  `kshank999-wq/vc_game_studio`.
- **Root Directory:** `apps/web`, with **Include files outside the root
  directory** turned on. The build also builds the browser preview from
  `apps/studio`.
- **Framework:** Next.js (pinned by `apps/web/vercel.json`).
- **Production branch:** the branch that holds this work.
- **Domains:** `vc-gamestudio.com` and `www.vc-gamestudio.com`. The domain is
  already registered in Vercel, so attaching it is all that's needed.
- The repository-root `vercel.json` deliberately fails a build that runs from
  the root, and prints what to fix.

## Vercel: environment variables

Set these for Production, and for Preview if preview deployments should
work. The "Same as VC Writer" values are copied from the `vcwriter` Vercel
project.

| Variable | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://kpviyoqhmzignjyvixws.supabase.co` | Same as VC Writer. Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → VCWriter → Project Settings → API Keys → `sb_publishable_…` | Same as VC Writer. Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → VCWriter → API Keys → `sb_secret_…` | Same as VC Writer. **Secret**, server only |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys | Same as VC Writer. **Secret** |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → the **vc-gamestudio.com** endpoint → Signing secret | **New**, this endpoint's own. **Secret** |
| `STRIPE_PRICE_WRITER_MONTHLY` | Stripe price id (`price_…`) | New, see Stripe below |
| `STRIPE_PRICE_WRITER_YEARLY` | Stripe price id | New |
| `STRIPE_PRICE_STUDIO_MONTHLY` | Stripe price id | New |
| `STRIPE_PRICE_STUDIO_YEARLY` | Stripe price id | New |
| `RESEND_API_KEY` | Resend → API keys | Same as VC Writer, or a new key. **Secret** |
| `RESEND_FROM_ADDRESS` | `VC Game Studio <noreply@vc-gamestudio.com>` | Needs vc-gamestudio.com verified in Resend |
| `LICENSE_SIGNING_PRIVATE_KEY` | The first line printed by `npm run keys:license -w @vcgs/web` | **Secret.** Signs what the app may do |
| `NEXT_PUBLIC_SITE_URL` | `https://vc-gamestudio.com` | Must include `https://`. A bad value is warned about and ignored |
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

1. **Products:** create two, *VC Game Writer* and *VC Game Studio*. Give each
   a recurring **monthly** and a recurring **yearly** price, and put the four
   price ids in the `STRIPE_PRICE_*` variables. The site reads the amounts
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
   cancelling, updating the card, and **switching plans between the four
   prices**. That switch is how a customer upgrades from VC Game Writer to VC
   Game Studio. It is the same portal VC Writer's Writers Room uses.
4. **Stripe Tax:** checkout already asks for automatic tax, as VC Writer's
   does.

To test locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
Redelivering an event is safe: event ids are claimed in
`gs_stripe_webhook_events`, and there is one license per subscription.

## Resend

Verify **vc-gamestudio.com** as a sending domain (Resend gives you the DNS
records). Vercel manages the domain's DNS, so add them under Vercel → Domains.
A failed send is logged to `email_events` (templates `gs-license-*`) and
never fails a purchase; the account page always shows the license.

## Supabase (the shared VCWriter project)

- **Database:** done. `gs_0001_commerce` is applied. The security advisor
  reports only `gs_stripe_webhook_events` having no policies, which is
  intended (service role only, like VC Writer's own webhook table). The
  performance advisor has not been run; run it once from the Supabase
  dashboard or connector.
- **Auth → URL configuration → Redirect URLs:** add
  `https://vc-gamestudio.com/auth/callback`. Keep VC Writer's entries. Leave
  the Site URL as vc-writer.com.
- **Auth → Email templates → Magic link:** the desktop app signs in with the
  six-digit code, as VC Writer's app does, so the template must include
  `{{ .Token }}`. The sign-in email is shared with VC Writer, so word it for
  both products.

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
| Variable | `MAIN_VITE_SUPABASE_URL` | `https://kpviyoqhmzignjyvixws.supabase.co` |
| Variable | `MAIN_VITE_SUPABASE_ANON_KEY` | The same publishable key as above |
| Variable | `MAIN_VITE_LICENSE_PUBLIC_KEY` | The second line from `keys:license` |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | For the publish job |
| Secret | `CSC_LINK`, `CSC_KEY_PASSWORD` | Apple Developer ID Application certificate (.p12, base64) and its password |
| Secret | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization |
| Secret | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE` | Windows signing via Azure Artifact Signing, as VC Writer does. Alternatively `WINDOWS_CERTIFICATE` + `WINDOWS_CERTIFICATE_PASSWORD` |

The workflow refuses to package without the three licensing variables,
because a build without them has licensing switched off. The signing secrets
are the same ones VC Writer uses. Without them the installers are unsigned:
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
