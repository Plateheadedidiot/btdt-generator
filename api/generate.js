import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildPlacementRules(placement, scriptText = "", flowShape = "") {
  const lower = String(placement || "").toLowerCase();
  const cleanedScript = String(scriptText || "").trim();
  const charCount = cleanedScript.replace(/\s+/g, "").length;

  const genericRules = {
    arm: "Compose for the outer arm with a natural vertical or slightly angled layout that follows the limb.",
    forearm: "Use a narrow vertical composition that reads naturally down the forearm and fits the long body area cleanly.",
    "upper arm": "Fit the composition to the rounded upper arm with a slight curve or wrap-aware flow.",
    wrist: "Keep the design compact, simplified, and realistically scaled for the wrist. Avoid oversized details.",
    hand: "Fit the tattoo naturally on the flat but compact hand area. Keep it bold, readable, and properly scaled.",
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

  if (lower === "fingers" || lower === "knuckles") {
    let segmentationRule = "Use true segmented finger or knuckle placement. Each character or symbol must sit within its own finger segment, not float across multiple fingers.";
    if (charCount === 4) {
      segmentationRule = "The text has 4 characters. Place exactly one character on each finger or knuckle across one hand.";
    } else if (charCount === 8) {
      segmentationRule = "The text has 8 characters. Split evenly across both hands with 4 characters per hand, one character per finger or knuckle.";
    } else if (charCount > 0 && charCount <= 10) {
      segmentationRule = `The text has ${charCount} characters. Distribute the characters naturally across the available finger or knuckle segments with one character per segment where possible.`;
    }

    const flowRule = (String(flowShape).toLowerCase() === "straight line")
      ? "Do not treat this like a normal straight horizontal line of text. Adapt it into true finger or knuckle segmentation."
      : "Respect the requested flow only if it still looks like a believable finger or knuckle tattoo.";

    const placementSurface = lower === "knuckles"
      ? "Center each character in its own knuckle box with bold spacing and clear separation from neighboring knuckles."
      : "Center each character in its own finger segment with realistic spacing and no overlap between fingers.";

    return [
      "For finger and knuckle tattoos, prioritize realism over decorative typography.",
      segmentationRule,
      flowRule,
      placementSurface,
      "Each character must be large enough to read but small enough to fit its own segment cleanly.",
      "Avoid long connected script spanning multiple fingers unless explicitly required by the prompt.",
      "If body mockup is enabled, show the hand(s) from a believable angle so the segmentation is obvious."
    ].join(" ");
  }

  return genericRules[lower] || "Place the tattoo in a body-aware, anatomically believable way.";
}

function exactTextRule(text) {
  return `Use the EXACT text "${text}". Do NOT change spelling, wording, punctuation, capitalization, spacing, or grammar under any circumstance. Render the text character-for-character exactly as given.`;
}

function buildPrompt(input) {
  const parts = [
    "Create a tattoo concept or lettering design.",
    "This must look like a real tattoo placement or a tattoo-ready concept, not a poster or generic graphic design.",
    "Respect anatomy, believable scale, realistic placement, and clean tattoo composition.",
    `Placement: ${input.placement}.`,
    `Placement rule: ${buildPlacementRules(input.placement, input.scriptText, input.flowShape)}`,
    `Size: ${input.size}.`,
    `Color approach: ${input.color}.`,
  ];

  if (input.bodyMockup) {
    parts.push("Show the tattoo on skin with the correct body part clearly visible.");
    parts.push("Integrate the tattoo naturally on the body with realistic angle, orientation, and scale.");
  } else {
    parts.push("Present the design on a clean background while still composing it correctly for the chosen body placement.");
  }

  if (input.mode === "design") {
    parts.push(`Tattoo style: ${input.style}.`);
    parts.push(`Design idea: ${input.prompt}.`);
    parts.push("Make it tattoo-ready, clear in silhouette, readable, and strong in line hierarchy.");
  }

  if (input.mode === "script") {
    parts.push(exactTextRule(input.scriptText));
    parts.push(`Font style: ${input.fontStyle}.`);
    parts.push(`Flow or layout request: ${input.flowShape}.`);
    if (input.secondLine) {
      parts.push(`Add a second line using the EXACT text "${input.secondLine}". Do not alter it.`);
    }
    if (input.emphasisWord) {
      parts.push(`Emphasize this word exactly as written: "${input.emphasisWord}".`);
    }
    parts.push("Keep the lettering clean, readable, centered, and believable as an actual tattoo.");
  }

  if (input.mode === "design_script") {
    parts.push(`Tattoo style: ${input.style}.`);
    parts.push(`Design idea: ${input.prompt}.`);
    parts.push(exactTextRule(input.scriptText));
    parts.push(`Font style: ${input.fontStyle}.`);
    parts.push(`Flow or layout request: ${input.flowShape}.`);
    if (input.secondLine) {
      parts.push(`Add a second line using the EXACT text "${input.secondLine}". Do not alter it.`);
    }
    if (input.emphasisWord) {
      parts.push(`Emphasize this word exactly as written: "${input.emphasisWord}".`);
    }
    parts.push("The design and lettering must feel unified and intentional, not pasted together.");
  }

  return parts.join(" ");
}

function normalize(body = {}) {
  return {
    mode: body.mode || "design",
    prompt: String(body.prompt || "").trim(),
    scriptText: String(body.scriptText || "").trim(),
    secondLine: String(body.secondLine || "").trim(),
    emphasisWord: String(body.emphasisWord || "").trim(),
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const input = normalize(req.body || {});

    if ((input.mode === "design" || input.mode === "design_script") && !input.prompt) {
      return res.status(400).json({ error: "Missing design prompt" });
    }

    if ((input.mode === "script" || input.mode === "design_script") && !input.scriptText) {
      return res.status(400).json({ error: "Missing script text" });
    }

    const prompt = buildPrompt(input);

    // Fast path: generate a single image using the Image API.
    // Reference image is accepted by the frontend, but ignored here until a stable
    // image-edit flow is implemented. That keeps generation reliable and fast.
    const result = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      quality: "medium"
    });

    const image = result?.data?.[0]?.b64_json;

    if (!image) {
      return res.status(500).json({
        error: "No image returned from OpenAI",
      });
    }

    return res.status(200).json({
      image,
      prompt_used: prompt,
      reference_ignored: Boolean(input.reference_image),
      speed_mode: "medium"
    });
  } catch (err) {
    console.error("GEN ERROR:", err);
    return res.status(500).json({
      error: err?.message || "Generation failed",
      details: err?.response?.data || null
    });
  }
}