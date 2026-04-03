const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function buildPlacementRules(placement) {
  const rules = {
    "arm": "Compose for the outer arm with a natural vertical or slightly angled layout that follows the limb.",
    "forearm": "Use a narrow vertical composition that reads naturally down the forearm and fits the long body area cleanly.",
    "upper arm": "Fit the composition to the rounded upper arm with a slight curve or wrap-aware flow.",
    "wrist": "Keep the design compact, simplified, and realistically scaled for the wrist. Avoid oversized details.",
    "hand": "Fit the tattoo naturally on the flat but compact hand area. Keep it bold, readable, and properly scaled.",
    "fingers": "For finger tattoos, fit each element within the narrow finger segments. Keep characters or symbols centered, separated, and realistically sized to each finger segment. Avoid a poster-like straight line floating across multiple fingers.",
    "knuckles": "For knuckle tattoos, use a true knuckle layout. If the text is 4 letters, place exactly one letter on each knuckle across one hand. If the text is 8 letters, split evenly across both hands. Each character must be centered in its own knuckle area, separated from neighboring fingers, bold, readable, and realistically sized. Do not connect the letters across fingers unless explicitly requested.",
    "thigh": "Use a larger, open composition that feels natural on the broad flat surface of the thigh.",
    "calf": "Compose vertically or with a gentle curve so it fits the long shape of the calf naturally.",
    "shin": "Center the design on the shin with a narrow vertical composition that suits the front of the leg.",
    "ankle": "Keep the design small, simple, and naturally fitted to the ankle with believable wrap or contour.",
    "knee": "Build the tattoo around the round shape of the knee so it feels intentional on a joint, not flat or poster-like.",
    "chest": "Use a wider composition that suits the chest and feels natural across the pectoral area.",
    "sternum": "Use a centered, narrow vertical composition that follows the centerline of the body.",
    "stomach": "Shape the tattoo to sit naturally on the stomach with believable spacing and scale for a broad area.",
    "back": "Allow for a larger composition with more breathing room so it fits naturally on the back.",
    "shoulder blade": "Curve or angle the composition to suit the shoulder blade and follow the body naturally.",
    "neck": "Keep the design compact, elegant, and appropriately scaled for the neck.",
    "behind ear": "Keep the design very small, subtle, and precisely placed behind the ear.",
  };

  return rules[placement] || "Place the tattoo in a body-aware, anatomically believable way.";
}

function buildGlobalPromptParts(input) {
  const parts = [];
  parts.push("Create a tattoo concept or lettering design.");
  parts.push("This must look like a REAL tattoo placement or tattoo-ready concept, not a poster, logo sheet, or generic graphic design.");
  parts.push("Respect anatomy, body curvature, believable scale, and realistic tattoo placement.");
  parts.push(`Placement: ${input.placement}.`);
  parts.push(`Size: ${input.size}.`);
  parts.push(`Color approach: ${input.color}.`);
  parts.push(`Placement rule: ${buildPlacementRules(input.placement)}`);

  if (input.bodyMockup) {
    parts.push("Show the tattoo on a body placement mockup with the correct body part clearly visible.");
    parts.push("The tattoo must be integrated naturally on skin with realistic orientation, angle, and scale.");
  } else {
    parts.push("Present the design as a clean tattoo concept on a plain background while still composing it correctly for the selected body placement.");
  }

  return parts;
}

function buildDesignPrompt(input) {
  const parts = buildGlobalPromptParts(input);
  parts.push(`Tattoo style: ${input.style}.`);
  parts.push(`Design idea: ${input.prompt}.`);
  parts.push("Make it tattoo-ready, strong in silhouette, readable, and compositionally clean for the chosen body area.");
  return parts.join(" ");
}

function buildExactTextRule(text) {
  return `Use the EXACT text "${text}". Do NOT change spelling, wording, punctuation, capitalization, spacing, or grammar under any circumstance. Any deviation from the user text is incorrect. Render the text character-for-character exactly as given.`;
}

function buildScriptPlacementLogic(input, scriptText) {
  const parts = [];
  parts.push(buildExactTextRule(scriptText));
  parts.push(`Font style: ${input.fontStyle}.`);
  parts.push(`Flow or layout request: ${input.flowShape}.`);

  if ((input.placement === "fingers" || input.placement === "knuckles") && input.flowShape === "straight line") {
    parts.push("Do NOT use a normal straight line layout. Adapt the text into a true segmented finger or knuckle layout.");
  }

  if (input.secondLine) {
    parts.push(`Add a second line using the EXACT text "${input.secondLine}". Do NOT alter it.`);
  }

  if (input.emphasisWord) {
    parts.push(`Emphasize this word exactly as written: "${input.emphasisWord}".`);
  }

  parts.push("Keep the lettering readable, clean, centered, and believable as an actual tattoo.");
  return parts;
}

function buildScriptPrompt(input) {
  const scriptText = input.scriptText || "";
  const parts = buildGlobalPromptParts(input);
  parts.push(...buildScriptPlacementLogic(input, scriptText));
  parts.push("This is a lettering-focused tattoo request.");
  return parts.join(" ");
}

function buildDesignScriptPrompt(input) {
  const scriptText = input.scriptText || "";
  const parts = buildGlobalPromptParts(input);
  parts.push(`Tattoo style: ${input.style}.`);
  parts.push(`Design idea: ${input.prompt}.`);
  parts.push(...buildScriptPlacementLogic(input, scriptText));
  parts.push("The design and lettering must feel unified and intentional, not pasted together.");
  return parts.join(" ");
}

function normalizeBody(reqBody) {
  return {
    mode: reqBody.mode || "design",
    prompt: (reqBody.prompt || "").trim(),
    scriptText: (reqBody.scriptText || "").trim(),
    secondLine: (reqBody.secondLine || "").trim(),
    emphasisWord: (reqBody.emphasisWord || "").trim(),
    style: reqBody.style || "traditional",
    placement: reqBody.placement || "forearm",
    size: reqBody.size || "medium",
    color: reqBody.color || "black and grey",
    fontStyle: reqBody.fontStyle || "fine line cursive",
    flowShape: reqBody.flowShape || "straight line",
    bodyMockup: Boolean(reqBody.bodyMockup),
    reference_image: reqBody.reference_image || null
  };
}

function buildFinalPrompt(input) {
  if (input.mode === "script") return buildScriptPrompt(input);
  if (input.mode === "design_script") return buildDesignScriptPrompt(input);
  return buildDesignPrompt(input);
}

async function readReferenceImageDataUrl(base64String) {
  if (!base64String) return null;
  return `data:image/png;base64,${base64String}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const input = normalizeBody(req.body || {});
    const finalPrompt = buildFinalPrompt(input);

    if ((input.mode === "design" || input.mode === "design_script") && !input.prompt) {
      return res.status(400).json({ error: "Missing design prompt." });
    }

    if ((input.mode === "script" || input.mode === "design_script") && !input.scriptText) {
      return res.status(400).json({ error: "Missing script text." });
    }

    const referenceDataUrl = await readReferenceImageDataUrl(input.reference_image);

    const imageInputs = [{ type: "input_text", text: finalPrompt }];

    if (referenceDataUrl) {
      imageInputs.push({
        type: "input_image",
        image_url: referenceDataUrl
      });
    }

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [{
        role: "user",
        content: imageInputs
      }],
      tools: [{
        type: "image_generation",
        size: "1024x1024",
        quality: "high"
      }]
    });

    let imageBase64 = null;

    for (const output of response.output || []) {
      for (const content of output.content || []) {
        if (content.type === "output_image" && content.image_base64) {
          imageBase64 = content.image_base64;
          break;
        }
      }
      if (imageBase64) break;
    }

    if (!imageBase64) {
      return res.status(500).json({
        error: "No image returned from OpenAI.",
        prompt_used: finalPrompt
      });
    }

    return res.status(200).json({
      image: imageBase64,
      prompt_used: finalPrompt
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: error.message || "Generation failed."
    });
  }
};