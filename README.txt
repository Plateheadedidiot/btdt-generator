BTDT generator API + Stripe backend add-on

What stayed the same:
- api/generate.js is still your working image-generation endpoint
- OpenAI generation stays isolated so Stripe changes do not break previews

What was added:
- api/create-checkout-session.js
- api/verify-session.js
- api/check-access.js
- api/stripe-webhook.js
- api/_cors.js helper
- Stripe dependency in package.json
- updated .env.example

What each new endpoint does:
- /api/create-checkout-session
  Creates a Stripe Checkout session for either:
  - unlock (one-time payment)
  - subscription (monthly plan)

- /api/verify-session
  Verifies that a successful Stripe Checkout session is paid.
  Use this right after redirecting back from Stripe to unlock the current image.

- /api/check-access
  Checks whether an email currently has an active subscription in Stripe.
  This does NOT permanently track one-time unlocks by itself.

- /api/stripe-webhook
  Verifies incoming Stripe webhook events and logs completed purchases/subscription events.
  This is the correct backend hook point for later saving customers, entitlements, gallery items, or unlock history into a database.

Important limitation:
- Subscriptions can be checked durably in Stripe.
- One-time unlocks for old sessions are best verified immediately with /api/verify-session after checkout.
- If you want permanent unlock history by email/image, the next step is adding a real database (Supabase is a strong fit).

Suggested frontend flow:
1. User generates free preview through /api/generate
2. User clicks unlock or subscribe
3. Frontend POSTs to /api/create-checkout-session
4. Redirect user to checkoutUrl
5. On success page, frontend reads session_id from URL
6. Frontend POSTs session_id to /api/verify-session
7. If paid, remove watermark / unlock download / grant subscriber features

Vercel setup:
1. Replace your project files with these updated files.
2. In Vercel > Settings > Environment Variables add:
   - OPENAI_API_KEY
   - STRIPE_SECRET_KEY
   - STRIPE_WEBHOOK_SECRET
   - STRIPE_UNLOCK_PRICE_ID
   - STRIPE_SUBSCRIPTION_PRICE_ID
   - PUBLIC_APP_URL
3. Redeploy.
4. In Stripe, point your webhook to:
   https://YOUR-DOMAIN/api/stripe-webhook
5. Listen for at least:
   - checkout.session.completed
   - invoice.payment_succeeded
   - customer.subscription.updated
   - customer.subscription.deleted

Notes:
- All endpoints return JSON on success/failure to avoid the 'unexpected token' frontend crash.
- CORS is enabled.
- This package keeps the working generator untouched and layers Stripe around it.
