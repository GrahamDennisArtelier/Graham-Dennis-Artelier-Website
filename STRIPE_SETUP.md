# Stripe and Supabase setup

This project uses Stripe-hosted Checkout for one-time artwork purchases. The browser sends artwork IDs to a Supabase Edge Function, which reads the authoritative price and availability from the database before creating a pending order and Stripe Checkout Session. A signed webhook confirms payment and marks the artwork sold.

Never put Stripe secret keys in the website `.env`, `supabase-config.js`, HTML, or other browser-readable files.

## 1. Prerequisites

You need access to Supabase project `yfoskcuqmholbivajzdw`, a Stripe account, Node.js, and the deployed website. The SQL in `supabase-schema.sql` must already have been run so the `artworks` and `orders` tables exist.

The domains are:

```text
Canonical: https://www.grahamdennisartelier.co.uk
Also accepted: https://grahamdennisartelier.co.uk
```

Configure your host to redirect the non-`www` address to the canonical `www` address with a permanent `301` or `308`. Both domains need valid HTTPS certificates. Both may start checkout, but Stripe returns customers to `www`.

## 2. Get a Stripe test key

1. Sign in to Stripe and enable **Test mode**.
2. Open **Developers → API keys**.
3. Reveal and copy the secret key beginning `sk_test_`.
4. Keep it private. Do not place it in the website root `.env`.

No Stripe publishable key is required in the browser because customers are redirected to Stripe-hosted Checkout using a server-created Session URL.

## 3. Link Supabase

From `D:\Dev\grahamdennis`, run:

```powershell
npx supabase login
npx supabase link --project-ref yfoskcuqmholbivajzdw
```

The login uses a Supabase account access token, not the project's publishable key.

## 4. Configure initial Edge Function secrets

Replace the example Stripe value and run:

```powershell
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_REPLACE_ME
npx supabase secrets set SITE_URL=https://www.grahamdennisartelier.co.uk
npx supabase secrets set ALLOWED_ORIGINS=https://www.grahamdennisartelier.co.uk,https://grahamdennisartelier.co.uk
npx supabase secrets list
```

Do not set `STRIPE_WEBHOOK_SECRET` until Stripe creates it in step 6. Supabase automatically provides database credentials to hosted functions; do not add a service-role key to this repository.

## 5. Deploy both functions

Authentication settings are already in `supabase/config.toml`. Deploy:

```powershell
npx supabase functions deploy create-checkout-session
npx supabase functions deploy stripe-webhook
```

The endpoints will be:

```text
https://yfoskcuqmholbivajzdw.supabase.co/functions/v1/create-checkout-session
https://yfoskcuqmholbivajzdw.supabase.co/functions/v1/stripe-webhook
```

The checkout endpoint accepts only the two configured origins. The webhook endpoint verifies Stripe's signature and therefore does not use browser authentication.

## 6. Create the Stripe webhook

1. In Stripe test mode, open **Developers → Workbench → Webhooks**.
2. Choose **Create destination** and select events from **Your account**.
3. Subscribe to:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.expired
```

4. Choose **Webhook endpoint** and enter:

```text
https://yfoskcuqmholbivajzdw.supabase.co/functions/v1/stripe-webhook
```

5. Create the destination, open it, and reveal its `whsec_...` signing secret.
6. Store it in Supabase:

```powershell
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
```

Secrets update immediately; another deployment is not required.

## 7. Prepare an artwork

Checkout accepts only Supabase-backed artworks with a database UUID and these values:

```text
status = published
availability = available
inventory_quantity = 1
price = 10.00 (or another test amount)
```

Built-in demonstration artworks cannot be purchased because they deliberately lack database IDs.

## 8. Test the complete checkout

1. Visit `https://www.grahamdennisartelier.co.uk/gallery.html`.
2. Add the Supabase-backed artwork to the cart.
3. Select **Continue to secure checkout**.
4. Confirm the browser opens `checkout.stripe.com`.
5. Use Stripe's successful test card:

```text
Number: 4242 4242 4242 4242
Expiry: any future date
CVC: any three digits
Postcode: any valid format
```

6. Complete payment and confirm Stripe returns to `gallery.html?checkout=success...` on the `www` domain.
7. Confirm the success message appears and the cart clears.

Then verify:

- The Supabase order changed from `pending` to `paid`.
- Customer email, name, address, and total were saved.
- The artwork changed to `availability = sold` and `inventory_quantity = 0`.
- Stripe Workbench shows a successful `2xx` webhook delivery.

Also start another Checkout and use Stripe's back link. The site should return to `gallery.html?checkout=cancel` and reopen the cart.

## 9. Switch to live payments

Only do this after test mode works end to end:

1. Complete Stripe business activation and verification.
2. Disable test mode and copy the `sk_live_...` secret key.
3. Replace `STRIPE_SECRET_KEY` in Supabase.
4. Create a separate webhook destination in Stripe live mode using the same endpoint URL.
5. Replace `STRIPE_WEBHOOK_SECRET` with that live destination's new `whsec_...` value.
6. Make a small real purchase, confirm the complete flow, and refund it in Stripe.

Test and live webhook destinations have different signing secrets.

## 10. Troubleshooting

### Checkout cannot start

- Confirm both functions are deployed.
- Confirm the required names appear in `npx supabase secrets list`.
- Confirm the artwork is loaded from Supabase and has a UUID.
- Verify status, availability, inventory, and price.
- Inspect **Supabase → Edge Functions → create-checkout-session → Logs**.

### Origin not allowed

Ensure `ALLOWED_ORIGINS` contains both exact HTTPS origins, comma-separated and without trailing slashes. Localhost is intentionally excluded from production.

### Payment succeeds but the artwork remains available

- Inspect the webhook delivery in Stripe Workbench.
- Ensure the `whsec_...` belongs to that exact destination and mode.
- Inspect **Supabase → Edge Functions → stripe-webhook → Logs**.
- Confirm the Checkout Session metadata contains `order_id`.

### Webhook returns 401

Confirm `supabase/config.toml` has `verify_jwt = false` for `stripe-webhook`, then redeploy. Stripe authenticates using its webhook signature, not a Supabase JWT.

## Security checklist

- Never expose `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, a Supabase secret key, or service-role key to the browser.
- Keep Row Level Security enabled.
- Calculate all prices in the Edge Function from database records.
- Verify Stripe's raw request body before processing events.
- Use HTTPS on both production domains.
