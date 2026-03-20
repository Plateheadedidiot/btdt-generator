Styled UI + clean paywall layer package.

What this includes:
- working styled generator
- dropdowns for style, placement, size, color
- optional inspiration upload with preview
- 3 free previews per day
- clean paywall box after free limit is reached
- Stripe Checkout routes for:
  - $1.99 unlock
  - $14.99/month subscription

What this version does NOT do yet:
- no Supabase persistence yet
- unlock/subscription state is stored in localStorage after successful checkout return
- this is a clean intermediate paywall layer on top of the stable generator

Required Vercel env vars:
OPENAI_API_KEY
STRIPE_SECRET_KEY
STRIPE_PRICE_UNLOCK
STRIPE_PRICE_SUB_MONTHLY
APP_URL

Recommended APP_URL:
https://btdt-generator-4tts.vercel.app
