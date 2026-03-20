Verified fix:
- preview generation does NOT require email
- email is only required for unlock, subscribe, download, or publish

Verification markers in public/index.html:
- <!-- VERIFIED: NO EMAIL REQUIRED FOR PREVIEW -->
- async function generate() includes comment: Email is optional for previews.
- the string 'Please enter your email first.' should NOT appear inside generate()
