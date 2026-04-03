Fresh Vercel API replacement for the current frontend.

Files:
- api/generate.js
- package.json
- .env.example

What changed:
- Matches the current frontend payload fields
- Stronger knuckle/finger placement rules
- Exact text enforcement for script
- Faster generation by using:
  - OpenAI Images API
  - quality: "medium"
  - single-image flow
- Keeps reference_image accepted from frontend but ignores it for now, so uploads won't break generation

How to use:
1. Replace your current Vercel api/generate.js with this file.
2. Ensure package.json in the Vercel project includes "type": "module" and the openai dependency.
3. Add OPENAI_API_KEY in Vercel environment variables.
4. Redeploy.

Expected request body:
- mode
- prompt
- scriptText
- secondLine
- emphasisWord
- style
- placement
- size
- color
- fontStyle
- flowShape
- bodyMockup
- reference_image