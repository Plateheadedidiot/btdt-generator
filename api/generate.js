export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt } = req.body || {};
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
      return res.status(response.status).json({
        error: data?.error?.message || data?.error || "Image generation failed"
      });
    }

    const image = data?.data?.[0]?.b64_json;
    if (!image) {
      return res.status(500).json({ error: "No image returned from OpenAI" });
    }

    return res.status(200).json({ image });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
