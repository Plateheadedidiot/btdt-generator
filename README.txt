Fresh full Vercel package

Included:
- public/index.html
- public/loading/frame1.png through frame4.png
- api/generate.js
- vercel.json

What changed:
- one-pass 4-frame loader (each frame shows once, then holds on frame 4)
- better on-page error reporting
- fresh loading folder
- cleaner API error handling
- CORS enabled for:
  https://beentheredonetat.com
  https://www.beentheredonetat.com

How to use:
1. Replace your Vercel project's public/ folder with this package's public/
2. Replace api/generate.js
3. Replace vercel.json
4. Redeploy

After redeploying, test:
- /loading/frame1.png through /loading/frame4.png
- then try a generation
- if it fails, the page should now show the real error message
