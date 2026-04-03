Replace your current Vercel /api/generate.js with this file.

Why this version is safer:
- Uses the Image API for single-image generation, which OpenAI recommends when you only need one image from one prompt.
- Uses ESM default export, which matches Vercel's recommended function style.
- Keeps your placement logic and exact-text enforcement.
- Ignores reference_image for now instead of crashing.

Important:
- Add OPENAI_API_KEY in Vercel env vars.
- Redeploy after replacing the file.
- Your frontend should point to https://btdt-generator-4tts.vercel.app/api/generate

Note:
- Reference image uploads are temporarily ignored in this version. This is intentional so generation works reliably first.