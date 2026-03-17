export default async function handler(req, res) {
  const allowedOrigins = [
    "https://beentheredonetat.com",
    "https://www.beentheredonetat.com",
    "https://btdt-generator-4tts.vercel.app"
  ];

  const origin = req.headers.origin || "";
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { prompt } = body;

    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ error: "Prompt required" });
    }

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: String(prompt).trim(),
        size: "1024x1024"
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message || data?.error || "OpenAI image generation failed";
      return res.status(response.status).json({ error: message, raw: data });
    }

    if (!data?.data?.[0]?.b64_json) {
      return res.status(502).json({ error: "Image API returned no base64 image.", raw: data });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
