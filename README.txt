This version adds CORS headers so your website can call the Vercel API.

Why this likely fixes "Load failed":
- The API could work when opened directly on Vercel
- but fail from your website because cross-origin browser requests need CORS headers

What changed:
- Access-Control-Allow-Origin: *
- Access-Control-Allow-Methods: POST, OPTIONS
- Access-Control-Allow-Headers: Content-Type
- OPTIONS preflight handler added

Keep:
- exact text enforcement
- stronger finger/knuckle placement
- faster Image API generation