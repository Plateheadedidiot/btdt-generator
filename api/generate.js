export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt } = req.body || {};

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "Prompt required" });
    }

    // Always force the user's idea toward a tattoo stencil result.
    const stencilRules =
      "tattoo stencil design, black ink only, pure black and white, no shading, no gray wash, no color, no background, bold outline, crisp linework, clean negative space, tattoo transfer ready, stencil flash style, isolated on white background";

    const finalPrompt = `${prompt}, ${stencilRules}`;

    // Generate 4 smaller preview images so users can pick a favorite.
    const requests = Array.from({ length: 4 }, async () => {
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt: finalPrompt,
          size: "512x512"
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || JSON.stringify(data));
      }

      return data.data?.[0]?.b64_json;
    });

    const previews = await Promise.all(requests);

    return res.status(200).json({
      prompt: finalPrompt,
      images: previews.filter(Boolean)
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Server error"
    });
  }
}
