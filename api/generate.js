import OpenAI from "openai";
import crypto from "crypto";

export const config = {
  api: { bodyParser: false },
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const STRIPE_SECRET_KEY = "sk_test_51TCnzSBUHTFhWUqxldvjBaduRf2CBUc1cZDJZLMF6CwxttaNnswEQWMxgUNgBTmtvLVV85wLvtNAg01PmOqona2l00zyU5KpvH";
const STRIPE_WEBHOOK_SECRET = "whsec_ZWC5WSlRPsto5nymASBcyoldrO4cGfVx";
const STRIPE_UNLOCK_PRICE_ID = "price_1TCo7VBUHTFhWUqxGsVwYNpX";
const STRIPE_SUBSCRIPTION_PRICE_ID = "price_1TCo8kBUHTFhWUqxtJhaCIfH";
const PUBLIC_APP_URL = "https://beentheredonetat.com";

if (!OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY in Vercel");
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

function send(res, code, data) {
  return res.status(code).json(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  return Buffer.concat(chunks).toString();
}

function parse(body) {
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function inferAction(body = {}) {
  if (body.action) return body.action;
  if (body.sessionId || body.session_id) return "verify_session";
  if (body.checkoutMode) return "create_checkout_session";
  if (body.email && !body.prompt && !body.scriptText) return "check_access";
  return "generate";
}

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function placementRule(placement, scriptText = "", flowShape = "", bodyMockup = true) {
  const p = clean(placement).toLowerCase();
  const count = clean(scriptText).replace(/\s+/g, "").length;

  if (p === "knuckles" || p === "fingers") {
    let splitRule = "Use true segmented finger placement with one character per segment when possible.";
    if (count === 4) splitRule = "Place exactly one character on each finger or knuckle across one hand.";
    if (count === 8) splitRule = "Split the text evenly across both hands with exactly one character per finger or knuckle.";
    if (count > 0 && count !== 4 && count !== 8) {
      splitRule = `The text has ${count} characters. Distribute it naturally across finger or knuckle segments while keeping each character clearly isolated and believable.`;
    }

    return [
      "Do not treat this like standard straight-line typography.",
      splitRule,
      "Keep each character centered, separate, bold, readable, and realistically sized for actual finger or knuckle tattooing.",
      "Avoid long connected cursive across multiple fingers unless explicitly required by the prompt.",
      String(flowShape).toLowerCase() === "straight line"
        ? "Interpret straight line as segmented finger layout, not one connected line."
        : "Only honor the requested flow if it still looks anatomically believable.",
      bodyMockup
        ? "If showing the body, the hand angle must make the finger or knuckle placement clearly readable."
        : "If not showing the body, still compose the text as a true segmented finger or knuckle tattoo."
    ].join(" ");
  }

  const rules = {
    arm: "Fit the composition naturally to the outer arm with believable flow and real tattoo spacing.",
    forearm: "Use a vertical composition that reads naturally down the forearm and fits the narrow limb cleanly.",
    "upper arm": "Curve or shape the design slightly to suit the rounded upper arm rather than a flat poster layout.",
    wrist: "Keep the design compact, simplified, and realistically scaled for a small wrist area.",
    hand: "Fit the tattoo naturally to the hand with bold readability and realistic scale for that compact surface.",
    thigh: "Use a larger, open composition that suits the broad flat thigh and does not feel tiny or cramped.",
    calf: "Compose vertically or with a gentle natural curve so it fits the calf cleanly.",
    shin: "Center the design vertically on the shin with strong readability for the narrow front-of-leg placement.",
    ankle: "Keep the design small and naturally fitted to the ankle, with believable wrap or contour if needed.",
    knee: "Build the design around the round knee shape so it feels intentional on a joint rather than flat or pasted on.",
    chest: "Use a wider composition that suits the chest and follows natural torso flow.",
    sternum: "Use a narrow centered vertical composition that follows the body centerline cleanly.",
    stomach: "Shape the design naturally for the stomach area with believable scale and spacing.",
    back: "Allow a larger composition with breathing room so it feels natural on the back.",
    "shoulder blade": "Angle or curve the design to fit the shoulder blade instead of letting it sit flat and awkward.",
    neck: "Keep the design compact and elegantly scaled for the neck with believable orientation.",
    "behind ear": "Keep the tattoo very small, subtle, and precisely placed behind the ear with realistic scale.",
  };

  return rules[p] || "Place the tattoo in a body-aware, anatomically believable way with realistic scale and orientation.";
}

function buildQualityRules(input) {
  const lowerStyle = clean(input.style).toLowerCase();
  const lowerColor = clean(input.color).toLowerCase();

  const rules = [
    "Create a tattoo-ready image, not a poster, painting, or graphic design mockup.",
    "Prioritize tattoo stencil logic, tattooability, and strong tattoo composition.",
    "Use clean bold linework, readable shapes, intentional negative space, crisp edges, and strong silhouette.",
    "Favor print-ready tattoo stencil sensibility over decorative illustration sensibility.",
    "Prioritize bold outlines, simplified shadow masses, and readable tattoo composition over realism or painterly finish.",
    "Avoid blur, muddy rendering, soft painterly shading, noisy tiny details, fake paper texture, poster layouts, and overdesigned mockup framing.",
    "The result should feel suitable for an actual tattoo artist to refine, stencil, or place.",
  ];

  if (input.bodyMockup) {
    rules.push("This must look like a believable tattoo placement preview on a real body area, not a floating sticker on skin.");
    rules.push("Respect realistic angle, scale, body curvature, natural body flow, and believable tattoo positioning.");
    rules.push("Show enough of the relevant body part to make the placement obvious.");
  } else {
    rules.push("Show the design cleanly on a plain light background while still composing it specifically for the selected body placement.");
  }

  if (
    lowerColor.includes("black") ||
    lowerColor.includes("grey") ||
    lowerColor.includes("sepia") ||
    lowerColor.includes("ink only")
  ) {
    rules.push("Favor strong black shapes, high contrast, clear stencil readability, and simplified tattoo-ready detail.");
  } else {
    rules.push("Use color like a tattoo artist would: bold, intentional color grouping with tattoo-style readability, not muddy painterly blending.");
  }

  if (lowerStyle.includes("fine line")) {
    rules.push("Keep the lines delicate but still tattooable and readable. Avoid hairline detail that would disappear in a real tattoo.");
  }

  if (lowerStyle.includes("traditional") || lowerStyle.includes("neo traditional")) {
    rules.push("Use classic tattoo readability, strong line hierarchy, simplified color blocking, and durable tattoo composition.");
  }

  if (lowerStyle.includes("japanese")) {
    rules.push("Keep the flow body-aware and compositionally intentional, with bold readable masses and strong tattoo rhythm.");
  }

  if (lowerStyle.includes("realism")) {
    rules.push("Keep realism tattoo-friendly. Preserve strong silhouette and readability instead of photographic noise.");
  }

  if (
    lowerStyle.includes("cartoony") ||
    lowerStyle.includes("illustrative") ||
    lowerStyle.includes("surreal") ||
    lowerStyle.includes("surrealism")
  ) {
    rules.push("Keep the shapes graphic, bold, and tattooable rather than soft or painterly.");
  }

  if (input.mode === "script" || input.mode === "design_script") {
    rules.push("Lettering must remain sharp, readable, centered, and convincingly tattooable.");
  }

  return rules.join(" ");
}

function buildPrompt(input) {
  const parts = [
    "Create a tattoo-ready image.",
    `Placement: ${input.placement}.`,
    `Placement guidance: ${placementRule(input.placement, input.scriptText, input.flowShape, input.bodyMockup)}`,
    `Size: ${input.size}.`,
    `Color: ${input.color}.`,
    `Quality rules: ${buildQualityRules(input)}`
  ];

  if (input.mode === "design") {
    parts.push(`Tattoo style: ${input.style}.`);
    parts.push(`Design idea: ${input.prompt}.`);
    parts.push("Make the final result clean, readable, body-aware, and suitable for tattoo translation.");
  } else if (input.mode === "script") {
    parts.push(`Use the EXACT text "${input.scriptText}". Do not change spelling, wording, capitalization, punctuation, grammar, or spacing.`);
    parts.push(`Font style: ${input.fontStyle}.`);
    parts.push(`Flow layout: ${input.flowShape}.`);
    if (input.secondLine) {
      parts.push(`Add a second line using the EXACT text "${input.secondLine}". Do not alter it.`);
    }
    if (input.emphasisWord) {
      parts.push(`Emphasize the EXACT word "${input.emphasisWord}".`);
    }
    parts.push("Keep the lettering clean, readable, tattooable, and accurately placed for the selected body part.");
  } else {
    parts.push(`Tattoo style: ${input.style}.`);
    parts.push(`Design idea: ${input.prompt}.`);
    parts.push(`Add script using the EXACT text "${input.scriptText}". Do not change spelling, wording, capitalization, punctuation, grammar, or spacing.`);
    parts.push(`Font style: ${input.fontStyle}.`);
    parts.push(`Flow layout: ${input.flowShape}.`);
    if (input.secondLine) {
      parts.push(`Add a second line using the EXACT text "${input.secondLine}". Do not alter it.`);
    }
    if (input.emphasisWord) {
      parts.push(`Emphasize the EXACT word "${input.emphasisWord}".`);
    }
    parts.push("The design and lettering must feel unified, intentional, tattoo-ready, and anatomically believable.");
  }

  if (input.reference_image) {
    if (input.convertReference) {
      parts.push("Convert the uploaded inspiration image into a tattoo-ready design.");
      parts.push("Preserve the major composition, subject, pose, and recognizable structure from the uploaded image.");
      parts.push("Simplify or adapt the image into bold, tattooable linework, strong shapes, readable negative space, and stencil-friendly design logic.");
      parts.push("Do not make it a photo edit. Reinterpret it as a tattoo design while staying faithful to the source image.");
    } else if (input.strictReference) {
      parts.push("Match the uploaded inspiration image as closely as possible.");
      parts.push("Preserve composition, pose, structure, silhouette, and layout.");
      parts.push("Only adapt details as needed to make it tattooable, stencil-friendly, and appropriate for the selected placement.");
      parts.push("Do not significantly redesign or drift away from the uploaded image.");
    } else {
      parts.push("Strongly follow the uploaded inspiration image for composition, silhouette, pose, major structure, shape language, and visual hierarchy where relevant.");
      parts.push("Do not ignore the uploaded inspiration image.");
      parts.push("Use the inspiration image as a real visual anchor, while still obeying all tattoo-readiness, stencil, text-accuracy, and body-placement rules.");
      parts.push("Keep the final result tattooable and do not copy tiny non-tattooable details from the reference.");
    }
  }

  return parts.join(" ");
}

async function handleGenerate(res, body) {
  const input = {
    mode: body.mode || "design",
    prompt: clean(body.prompt),
    scriptText: clean(body.scriptText),
    secondLine: clean(body.secondLine),
    emphasisWord: clean(body.emphasisWord),
    style: clean(body.style, "traditional"),
    placement: clean(body.placement, "forearm"),
    size: clean(body.size, "medium"),
    color: clean(body.color, "black and grey"),
    fontStyle: clean(body.fontStyle, "fine line cursive"),
    flowShape: clean(body.flowShape, "straight line"),
    bodyMockup: !!body.bodyMockup,
    strictReference: !!body.strictReference,
    convertReference: !!body.convertReference,
    reference_image: body.reference_image || null,
  };

  if ((input.mode === "design" || input.mode === "design_script") && !input.prompt && !input.convertReference) {
    return send(res, 400, { error: "Missing design prompt" });
  }

  if ((input.mode === "script" || input.mode === "design_script") && !input.scriptText) {
    return send(res, 400, { error: "Missing script text" });
  }

  if (input.convertReference && !input.reference_image) {
    return send(res, 400, { error: "Upload an inspo image before using Convert to Tattoo." });
  }

  const prompt = buildPrompt(input);

  let img;

  if (input.reference_image) {
    try {
      img = await client.images.generate({
        model: "gpt-image-1",
        size: "1024x1024",
        quality: "high",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: prompt
              },
              {
                type: "input_image",
                image_data: input.reference_image
              }
            ]
          }
        ]
      });
    } catch (err) {
      img = await client.images.generate({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
        quality: "high",
      });
    }
  } else {
    img = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      quality: "high",
    });
  }

  const image = img?.data?.[0]?.b64_json;
  if (!image) {
    return send(res, 500, { error: "No image returned from OpenAI" });
  }

  return send(res, 200, {
    image,
    prompt_used: prompt,
    used_reference_image: !!input.reference_image,
    strict_reference: !!input.strictReference,
    convert_reference: !!input.convertReference,
  });
}

async function stripeFetch(path, method = "POST", form = null) {
  const body = form ? new URLSearchParams(form).toString() : undefined;

  const res = await fetch("https://api.stripe.com" + path, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });

  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text || `Stripe error ${res.status}`);
  }

  if (!res.ok) {
    throw new Error(data?.error?.message || `Stripe error ${res.status}`);
  }

  return data;
}

async function handleCheckout(res, body) {
  const rawMode = clean(body.checkoutMode).toLowerCase();
  const mode = rawMode === "subscription" ? "subscription" : "payment";

  const price =
    mode === "subscription"
      ? STRIPE_SUBSCRIPTION_PRICE_ID
      : STRIPE_UNLOCK_PRICE_ID;

  if (!STRIPE_SECRET_KEY) {
    return send(res, 500, { error: "Missing STRIPE_SECRET_KEY" });
  }

  if (!price) {
    return send(res, 500, { error: "Missing Stripe price ID" });
  }

  if (!body.email) {
    return send(res, 400, { error: "Missing email" });
  }

  const session = await stripeFetch("/v1/checkout/sessions", "POST", {
    mode,
    success_url: `${PUBLIC_APP_URL}/generator.html?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${PUBLIC_APP_URL}/generator.html`,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    customer_email: body.email,
  });

  if (!session?.url) {
    return send(res, 500, { error: "Stripe did not return a checkout URL" });
  }

  return send(res, 200, { url: session.url });
}

async function handleVerify(res, body) {
  const sessionId = body.sessionId || body.session_id;

  if (!sessionId) {
    return send(res, 400, { error: "Missing sessionId" });
  }

  const session = await stripeFetch(
    `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    "GET"
  );

  return send(res, 200, {
    success: session.payment_status === "paid",
    mode: session.mode,
  });
}

async function handleAccess(res) {
  return send(res, 200, {
    hasAccess: false,
    subscriptionActive: false,
  });
}

function verifyStripe(sig, payload) {
  const parts = Object.fromEntries(
    sig.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k, v];
    })
  );

  const signed = crypto
    .createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(parts.t + "." + payload)
    .digest("hex");

  if (signed !== parts.v1) {
    throw new Error("Bad signature");
  }
}

async function handleWebhook(req, res, raw) {
  const sig = req.headers["stripe-signature"];
  verifyStripe(sig, raw);
  return send(res, 200, { received: true });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return send(res, 200, { ok: true });
  }

  const raw = await readBody(req);

  try {
    if (req.headers["stripe-signature"]) {
      return await handleWebhook(req, res, raw);
    }

    const body = parse(raw);
    const action = inferAction(body);

    if (action === "generate") return await handleGenerate(res, body);
    if (action === "create_checkout_session") return await handleCheckout(res, body);
    if (action === "verify_session") return await handleVerify(res, body);
    if (action === "check_access") return await handleAccess(res, body);

    return send(res, 400, { error: "Invalid action" });
  } catch (e) {
    console.error("API ERROR:", e);
    return send(res, 500, { error: e?.message || "Server error" });
  }
}
