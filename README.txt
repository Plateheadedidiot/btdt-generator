Paywall owner-access backend add-on.

Add this file to your existing Vercel project:
- api/owner-login.js

Set these environment variables in Vercel:
- OWNER_EMAIL=beentheredonetat@gmail.com
- OWNER_PASSWORD=Cucumber1211$

Important:
- This keeps the password out of the frontend code.
- The frontend uses this endpoint to unlock unlimited generations for the owner in this browser.
- This is a UI/session bypass for you as owner.
- Real customer paywall enforcement still needs Stripe + server-side entitlement checks.