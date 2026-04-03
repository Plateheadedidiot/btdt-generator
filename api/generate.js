import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      mode,
      prompt,
      scriptText,
      placement,
      style,
      size,
      color,
      fontStyle,
      flowShape,
      bodyMockup
    } = req.body || {};

    if ((mode === "design" || mode === "design_script") && !prompt) {
      return res.status(400).json({ error: "Missing design prompt" });
    }

    if ((mode === "script" || mode === "design_script") && !scriptText) {
      return res.status(400).json({ error: "Missing script text" });
    }

    let finalPrompt = "Create a tattoo design.\n";

    if (mode === "design") {
      finalPrompt += `Design idea: ${prompt}\n`;
    }

    if (mode === "script") {
      finalPrompt += `Use EXACT text: "${scriptText}". Do NOT change spelling, grammar, punctuation, capitalization, wording, or spacing.\n`;
    }

    if (mode === "design_script") {
      finalPrompt += `Design idea: ${prompt}\n`;
      finalPrompt += `Use EXACT text: "${scriptText}". Do NOT change spelling, grammar, punctuation, capitalization, wording, or spacing.\n`;
    }

    finalPrompt += `
Placement: ${placement}
Style: ${style}
Size: ${size}
Color: ${color}
Font: ${fontStyle}
Layout: ${flowShape}

Make it look like a REAL tattoo.
Respect body placement and anatomy.
Do NOT make it look like a poster or graphic design mockup.
`;

    if (bodyMockup) {
      finalPrompt += `
Show the tattoo on a human body in the correct placement.
`;
    }

    if (placement === "knuckles" || placement === "fingers") {
      finalPrompt += `
For finger and knuckle tattoos:
- Fit each character naturally inside the finger or knuckle area
- If the text is 4 letters, place one letter per knuckle across one hand
- If the text is 8 letters, split evenly across both hands
- Do not connect letters across fingers unless explicitly requested
- Keep each letter centered, bold, and readable
`;
    }

    const result = await client.images.generate({
      model: "gpt-image-1",
      prompt: finalPrompt,
      size: "1024x1024",
    });

    const image = result?.data?.[0]?.b64_json;

    if (!image) {
      return res.status(500).json({ error: "No image returned from OpenAI" });
    }

    return res.status(200).json({ image });

  } catch (err) {
    console.error("GEN ERROR:", err);
    return res.status(500).json({
      error: err?.message || "Generation failed"
    });
  }
}
