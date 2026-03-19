Fresh full Vercel package built from the 4 newly uploaded cow frames.

Included:
- public/index.html
- public/loading/frame1.png through frame4.png
- api/generate.js
- vercel.json

What changed:
- uses the 4 newly uploaded frames in the exact order provided
- one-image loader (no crossfade bug)
- one-pass sequence: frame1 -> frame2 -> frame3 -> frame4, then hold
- better error reporting
- CORS enabled for your domains

Replace your Vercel project's:
- public/
- api/generate.js
- vercel.json

Then redeploy.
