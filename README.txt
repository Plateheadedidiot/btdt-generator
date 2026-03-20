Verified fix:
- preview generation does NOT require email
- email is only required for unlock, subscribe, download, or publish

Verification markers in public/index.html:
- <!-- VERIFIED: NO EMAIL REQUIRED FOR PREVIEW -->
- async function generate() includes comment: Email is optional for previews.
- the string 'Please enter your email first.' should NOT appear inside generate()


Critical fix in this version:
- api/generate.js no longer requires email for preview generation
- email is optional for generate
- email is only attached later when the user unlocks/subscribes


Added in this version:
- 3 free previews per day using localStorage
- after 3, user must unlock an image or subscribe
- subscription bypasses the free preview limit
- usage counter shown on the page
