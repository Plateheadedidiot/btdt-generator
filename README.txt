BTDT paywall system — no login version

What this package includes
- public/index.html
- api/generate.js
- api/create-checkout.js
- api/stripe-webhook.js
- api/unlock-status.js
- api/download-image.js
- api/gallery-publish.js
- api/create-merch-request.js
- lib/supabase.js
- sql/schema.sql
- docs/env.example

What it does
- Generates locked previews
- Unlocks a single image for $1.99
- Offers a $14.99/month subscription
- Automatically unlocks subscriber images up to 150 generations/month
- Allows unlocked images to be downloaded
- Allows unlocked images to be added to the gallery
- Includes merch request hooks for later Printful integration

What it does NOT fully do yet
- It does not create a real shirt/sticker checkout yet
- It does not watermark previews
- It does not add a login system

Stripe money flow
- Stripe Checkout sends payments to your Stripe account
- Stripe then pays out to your linked bank account
- It does not route payments to PayPal

How to deploy
1. Add this package into your Vercel GitHub repo
2. Run sql/schema.sql in Supabase SQL editor
3. Add env vars from docs/env.example into Vercel
4. Create Stripe products/prices:
   - $1.99 unlock
   - $14.99 monthly subscription
   - optional $0.99 HD export
   - optional $2.99 print-ready
5. In Stripe webhook settings, point to:
   https://YOUR-VERCEL-DOMAIN/api/stripe-webhook
6. Redeploy

Recommended next step after this
- Connect Printful so “Buy as T-shirt” and “Buy as Sticker” become real checkout flows


This version was rebuilt from scratch for public/index.html with confirmed expanded options.
Search this file for: Behind Ear, Back Piece, Pastel.


Updated in this version:
- style, placement, size, and color changed to dropdown menus
- optional inspo picture upload added to public/index.html
