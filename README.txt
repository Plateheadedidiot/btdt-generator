Vercel backend replacement

Files:
- api/generate.js
- package.json
- .env.example

What to do:
1. Replace your existing Vercel api/generate.js with this file.
2. Make sure package.json in your Vercel project includes:
   - "type": "module"
   - "openai"
3. Add OPENAI_API_KEY in Vercel environment variables.
4. Redeploy.

This version:
- uses a simple Image API call
- supports design / script / design+script
- enforces exact script text
- adds extra finger/knuckle handling
