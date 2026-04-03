import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildPlacementRules(placement) {
  const rules = {
    arm: "Compose for the outer arm with a natural vertical or slightly angled layout that follows the limb.",
    forearm: "Use a narrow vertical composition that reads naturally down the forearm and fits the long body area cleanly.",
    "upper arm": "Fit the composition to the rounded upper arm with a slight curve or wrap-aware flow.",
    wrist: "Keep the design compact, simplified, and realistically scaled for the wrist. Avoid oversized details.",
    hand: "Fit the tattoo naturally on the hand. Keep it bold, readable, and properly scaled.",
    fingers: "For finger tattoos, fit each element within the narrow finger segments. Keep characters or symbols centered, separated, and realistically sized. Avoid a poster-like straight line floating across multiple fingers.",
    knuckles: "For knuckle tattoos, use a true knuckle layout. If the text is 4 letters, place exactly one letter on each knuckle across one hand. If the text is 8 letters, split evenly across both hands. Each character must be centered in its own knuckle area, separated from neighboring fingers, bold, readable, and realistically sized. Do not connect letters across fingers unless explicitly requested.",
    thigh: "Use a larger, open composition that feels natural on the broad flat surface of the thigh.",
    calf: "Compose vertically or with a gentle curve so it fits the long shape of the calf naturally.",
    shin: "Center the design on the shin with a narrow vertical composition that suits the front of the leg.",
    ankle: "Keep the design small, simple, and naturally fitted to the ankle with believable wrap or contour.",
    knee: "Build the tattoo around the round shape of the knee so it feels intentional on a joint, not flat or poster-like.",
    chest: "Use a wider composition that suits the chest and feels natural across the pectoral area.",
    sternum: "Use a centered, narrow vertical composition that follows the centerline of the body.",
    stomach: "Shape the tattoo to sit naturally on the stomach with believable spacing and scale for a broad area.",
    back: "Allow for a larger composition with more breathing room so it fits naturally on the back.",
    "shoulder blade": "Curve or angle the composition to suit the shoulder blade and follow the body naturally.",
    neck: "Keep the design compact, elegant, and appropriately scaled for the neck.",
    "behind ear": "Keep the design very small, subtle, and precisely placed behind the ear.",
  };
  return rules[placement] || "Place the tattoo in a body-aware, anatomically believable way.";
}

function normalize(body = {}) {
  return {
    mode: body.mode || "design",
    prompt: (body.prompt || "").trim(),
    scriptText: (body.scriptText || "").trim(),
    secondLine: (body.secondLine || "").trim(),
    emphasisWord: (body.emphasisWord || "").trim(),
    style: body.style || "traditional",
    placement: body.placement || "forearm",
    size: body.size || "medium",
    color: body.color || "black and grey",
    fontStyle: body.fontStyle || "fine line cursive",
    flowShape: body.flowShape || "straight line",
    bodyMockup: Boolean(body.bodyMockup),
    reference_image: body.reference_image || null,
  };
}

function exactTextRule(text) {
  return `Use the EXACT text "${text}". Do NOT change spelling, wording, punctuation, capitalization, spacing, or grammar under any circumstance. Any deviation is incorrect. Render the text character-for-character exactly as given.`;
}

function buildPrompt(input) {
  const parts = [
    "Create a tattoo concept or lettering design.",
    "This must look like a real tattoo placement or tattoo-ready concept, not a poster, logo sheet, or generic graphic design.",
    "Respect anatomy, body curvature, believable scale, and realistic tattoo placement.",
    `Placement: ${input.placement}.`,
    `Placement rule: ${buildPlacementRules(input.placement)}`,
    `Size: ${input.size}.`,
    `Color approach: ${input.color}.`,
  ];

  if (input.bodyMockup) {
    parts.push("Show the tattoo on skin with the correct body part clearly visible.");
    parts.push("The tattoo must be integrated naturally on the body with realistic orientation, scale, and angle.");
  } else {
    parts.push("Present the design cleanly on a plain background, but still compose it correctly for the chosen body placement.");
  }

  if (input.mode === "design") {
    parts.push(`Tattoo style: ${input.style}.`);
    parts.push(`Design idea: ${input.prompt}.`);
    parts.push("Make it tattoo-ready, strong in silhouette, readable, and compositionally clean.");
  }

  if (input.mode === "script") {
    parts.push(exactTextRule(input.scriptText));
    parts.push(`Font style: ${input.fontStyle}.`);
    parts.push(`Flow or layout request: ${input.flowShape}.`);
    if ((input.placement === "fingers" || input.placement === "knuckles") && input.flowShape === "straight line") {
      parts.push("Do NOT use a normal straight line. Adapt the text into a true segmented finger or knuckle layout.");
    }
    if (input.secondLine) parts.push(`Add a second line using the EXACT text "${input.secondLine}". Do NOT alter it.`);
    if (input.emphasisWord) parts.push(`Emphasize this word exactly as written: "${input.emphasisWord}".`);
    parts.push("Keep the lettering clean, readable, centered, and believable as an actual tattoo.");
  }

  if (input.mode === "design_script") {
    parts.push(`Tattoo style: ${input.style}.`);
    parts.push(`Design idea: ${input.prompt}.`);
    parts.push(exactTextRule(input.scriptText));
    parts.push(`Font style: ${input.fontStyle}.`);
    parts.push(`Flow or layout request: ${input.flowShape}.`);
    if ((input.placement === "fingers" || input.placement === "knuckles") && input.flowShape === "straight line") {
      parts.push("Do NOT use a normal straight line. Adapt the text into a true segmented finger or knuckle layout.");
    }
    if (input.secondLine) parts.push(`Add a second line using the EXACT text "${input.secondLine}". Do NOT alter it.`);
    if (input.emphasisWord) parts.push(`Emphasize this word exactly as written: "${input.emphasisWord}".`);
    parts.push("The design and lettering must feel unified and intentional, not pasted together.");
  }

  return parts.join(" ");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const input = normalize(req.body || {});

    if ((input.mode === "design" || input.mode === "design_script") && !input.prompt) {
      return res.status(400).json({ error: "Missing design prompt." });
    }

    if ((input.mode === "script" || input.mode === "design_script") && !input.scriptText) {
      return res.status(400).json({ error: "Missing script text." });
    }

    const prompt = buildPrompt(input);

    // Temporary: if a reference image is provided, ignore it instead of failing.
    // This keeps generation working while the frontend still allows uploads.
    const result = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });

    const image = result?.data?.[0]?.b64_json;

    if (!image) {
      return res.status(500).json({ error: "No image returned from OpenAI.", prompt_used: prompt });
    }

    return res.status(200).json({
      image,
      prompt_used: prompt,
      reference_ignored: Boolean(input.reference_image),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: error?.message || "Generation failed.",
    });
  }
}