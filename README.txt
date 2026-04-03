BTDT backend placement fix

This package is a full replacement backend for your Vercel generator route.

Files included:
- api/generate.js
- package.json
- .env.example
- README.txt

What this backend improves:
- placement-specific logic for all supported body parts
- much stronger finger / knuckle rules
- exact-text enforcement for script tattoos
- unified prompt building for:
  - design
  - script
  - design + script
- optional reference image support if the frontend sends reference_image as base64

How to install on Vercel:
1. In your existing Vercel project, replace your current /api/generate file with api/generate.js from this package.
2. Make sure package.json includes the openai dependency.
3. Add OPENAI_API_KEY in your Vercel environment variables.
4. Redeploy.

Expected frontend body fields:
- mode: design | script | design_script
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

Notes:
- This is written as a CommonJS Vercel serverless function.
- If your current project uses ESM instead, convert require/module.exports to import/export default.
- The route returns:
  {
    image: "<base64 png>",
    prompt_used: "<full final prompt>"
  }