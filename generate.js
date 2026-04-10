import OpenAI from "openai";
import crypto from "crypto";

export const config = {
  api: {
    bodyParser: false,
  },
};

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature");
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function safeJsonParse(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function getHeader(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function sendJson(res, status, payload) {
  return res.status(status).json(payload);
}

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

    const flowRule = String(flowShape).toLowerCase() === "straight line"
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

function buildQualityRules(input) {
  const rules = [
    "Prioritize tattoo-ready output over painterly or photographic output.",
    "Use clean bold linework, intentional negative space, and readable shapes.",
    "Avoid muddy shading, blurry textures, soft airbrushed gradients, and tiny noisy details.",
    "Do not add fake skin texture, paper texture, poster layouts, or mockup borders unless body mockup is explicitly requested.",
    "Keep the composition strong from a distance and readable at tattoo scale.",
    "Favor high-contrast black shapes and crisp edges."
  ];

  const lowerStyle = String(input.style || "").toLowerCase();
  const lowerColor = String(input.color || "").toLowerCase();

  if (!input.bodyMockup) {
    rules.push("Use a plain light background and present the tattoo cleanly, centered, and clearly.");
  }

  if (lowerColor.includes("black") || lowerColor.includes("grey") || lowerColor.includes("sepia")) {
    rules.push("Favor tattoo stencil sensibility: bold outlines, clean fills, limited tonal clutter, and strong readability.");
  } else {
    rules.push("Use color intentionally with tattoo-style color blocking. Avoid muddy multicolor gradients.");
  }

  if (lowerStyle.includes("fine line")) {
    rules.push("Keep the lines delicate but still clean and tattooable. Avoid hairline details that would disappear in a real tattoo.");
  }

  if (lowerStyle.includes("traditional") || lowerStyle.includes("neo traditional") || lowerStyle.includes("japanese")) {
    rules.push("Use strong line hierarchy, simplified color grouping, and classic tattoo readability.");
  }

  if (lowerStyle.includes("realism")) {
    rules.push("Keep realism tattoo-friendly. Avoid hyper-photographic noise and preserve strong silhouette and readability.");
  }

  if (lowerStyle.includes("cartoony") || lowerStyle.includes("illustrative") || lowerStyle.includes("surreal")) {
    rules.push("Keep shapes graphic and tattooable. Avoid washed-out rendering.");
  }

  if (input.mode === "script" || input.mode === "design_script") {
    rules.push("Lettering must remain sharp, centered, readable, and free of decorative distortion that hurts clarity.");
  }

  return rules.join(" ");
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
    `Quality rules: ${buildQualityRules(input)}`
  ];

  if (input.bodyMockup) {
    parts.push("Show the tattoo on skin with the correct body part clearly visible.");
    parts.push("Integrate the tattoo naturally on the body with realistic angle, orientation, and scale.");
  } else {
    parts.push("Present the design on a clean light background while still composing it correctly for the chosen body placement.");
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
    if (input.secondLine) parts.push(`Add a second line using the EXACT text "${input.secondLine}". Do not alter it.`);
    if (input.emphasisWord) parts.push(`Emphasize this word exactly as written: "${input.emphasisWord}".`);
    parts.push("Keep the lettering clean, readable, centered, and believable as an actual tattoo.");
  }

  if (input.mode === "design_script") {
    parts.push(`Tattoo style: ${input.style}.`);
    parts.push(`Design idea: ${input.prompt}.`);
    parts.push(exactTextRule(input.scriptText));
    parts.push(`Font style: ${input.fontStyle}.`);
    parts.push(`Flow or layout request: ${input.flowShape}.`);
    if (input.secondLine) parts.push(`Add a second line using the EXACT text "${input.secondLine}". Do not alter it.`);
    if (input.emphasisWord) parts.push(`Emphasize this word exactly as written: "${input.emphasisWord}".`);
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

function getEnv(name, required = true) {
  const value = process.env[name];
  if (required && !value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value || "";
}

function getBaseUrl() {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

function buildAbsoluteUrl(path) {
  const base = getBaseUrl();
  const safePath = String(path || "/");
  return `${base}${safePath.startsWith("/") ? safePath : `/${safePath}`}`;
}

function verifyStripeWebhookSignature(rawBodyBuffer, signatureHeader, secret) {
  if (!signatureHeader) {
    throw new Error("Missing Stripe-Signature header");
  }

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const idx = part.indexOf("=");
      return [part.slice(0, idx), part.slice(idx + 1)];
    })
  );

  const timestamp = parts.t;
  const signature = parts.v1;

  if (!timestamp || !signature) {
    throw new Error("Invalid Stripe signature header");
  }

  const payloadToSign = `${timestamp}.${rawBodyBuffer.toString("utf8")}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payloadToSign, "utf8")
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    throw new Error("Stripe signature verification failed");
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) {
    throw new Error("Stripe signature timestamp is too old");
  }
}

async function stripeRequest({ method = "POST", path, form = null }) {
  const secretKey = getEnv("STRIPE_SECRET_KEY");
  const body = form ? new URLSearchParams(form).toString() : undefined;

  const response = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });

  const text = await response.text();
  const json = safeJsonParse(text, { raw: text });

  if (!response.ok) {
    const message = json?.error?.message || json?.raw || `Stripe request failed: ${response.status}`;
    throw new Error(message);
  }

  return json;
}

function inferAction(body = {}) {
  const explicit = String(body?.action || "").trim().toLowerCase();
  if (explicit) return explicit;

  const rawMode = String(body?.checkoutMode || body?.mode || "").trim().toLowerCase();
  const hasGenerationFields = Boolean(body?.prompt || body?.scriptText || body?.reference_image);

  if (body?.sessionId || body?.session_id) return "verify_session";
  if (body?.checkoutMode || rawMode === "unlock" || rawMode === "single" || rawMode === "subscription" || rawMode === "subscribe") {
    return "create_checkout_session";
  }
  if (body?.email && !hasGenerationFields) return "check_access";
  return "generate";
}

async function handleGenerate(res, body) {
  const input = normalize(body || {});

  if ((input.mode === "design" || input.mode === "design_script") && !input.prompt) {
    return sendJson(res, 400, { error: "Missing design prompt" });
  }

  if ((input.mode === "script" || input.mode === "design_script") && !input.scriptText) {
    return sendJson(res, 400, { error: "Missing script text" });
  }

  const prompt = buildPrompt(input);
  const result = await client.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024",
    quality: "high"
  });

  const image = result?.data?.[0]?.b64_json;
  if (!image) {
    return sendJson(res, 500, { error: "No image returned from OpenAI" });
  }

  return sendJson(res, 200, {
    ok: true,
    image,
    prompt_used: prompt,
    quality_mode: "locked",
    reference_ignored: Boolean(input.reference_image)
  });
}

async function handleCreateCheckoutSession(res, body) {
  const rawMode = String(body?.checkoutMode || body?.mode || "unlock").toLowerCase();
  const mode = rawMode === "single" ? "unlock" : (rawMode === "subscribe" ? "subscription" : rawMode);
  const email = String(body?.email || "").trim();
  const imageId = String(body?.imageId || body?.generatedImageId || "").trim();
  const successPath = body?.successPath || "/generator.html?success=true";
  const cancelPath = body?.cancelPath || "/generator.html?checkout=cancelled";

  if (!email) {
    return sendJson(res, 400, { error: "Email is required" });
  }

  const unlockPriceId = getEnv("STRIPE_UNLOCK_PRICE_ID", mode === "unlock");
  const subscriptionPriceId = getEnv("STRIPE_SUBSCRIPTION_PRICE_ID", mode === "subscription");

  let priceId = "";
  let stripeMode = "payment";

  if (mode === "subscription") {
    priceId = subscriptionPriceId;
    stripeMode = "subscription";
  } else {
    priceId = unlockPriceId;
    stripeMode = "payment";
  }

  if (!priceId) {
    return sendJson(res, 500, { error: `Missing price id for ${mode}` });
  }

  const successUrl = buildAbsoluteUrl(`${successPath}${String(successPath).includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`);
  const cancelUrl = buildAbsoluteUrl(cancelPath);

  const form = {
    mode: stripeMode,
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: email,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "metadata[email]": email,
    "metadata[checkout_mode]": mode,
  };

  if (imageId) {
    form["metadata[image_id]"] = imageId;
  }

  const session = await stripeRequest({
    method: "POST",
    path: "/v1/checkout/sessions",
    form,
  });

  return sendJson(res, 200, {
    ok: true,
    url: session.url,
    sessionId: session.id,
    checkoutMode: mode,
  });
}

async function handleVerifySession(res, body) {
  const sessionId = String(body?.sessionId || body?.session_id || "").trim();
  if (!sessionId) {
    return sendJson(res, 400, { error: "Missing sessionId" });
  }

  const session = await stripeRequest({
    method: "GET",
    path: `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription&expand[]=customer`,
  });

  const paid = session.payment_status === "paid" || session.status === "complete";
  const customerEmail = session.customer_details?.email || session.customer_email || session.metadata?.email || "";
  const checkoutMode = session.metadata?.checkout_mode || session.mode;
  const activeSubscription = session.mode === "subscription"
    ? ["active", "trialing"].includes(session.subscription?.status)
    : false;

  return sendJson(res, 200, {
    ok: true,
    paid,
    email: customerEmail,
    checkoutMode,
    mode: checkoutMode,
    imageId: session.metadata?.image_id || "",
    unlockGranted: paid && checkoutMode !== "subscription",
    subscriptionActive: activeSubscription,
    sessionStatus: session.status,
    paymentStatus: session.payment_status || "",
  });
}

async function handleCheckAccess(res, body) {
  const email = String(body?.email || "").trim();
  if (!email) {
    return sendJson(res, 400, { error: "Email is required" });
  }

  const encoded = encodeURIComponent(`email:'${email}' AND status:'active'`);
  const subscriptions = await stripeRequest({
    method: "GET",
    path: `/v1/subscriptions/search?query=${encoded}`,
  });

  const active = Array.isArray(subscriptions.data) && subscriptions.data.some((sub) => ["active", "trialing"].includes(sub.status));

  return sendJson(res, 200, {
    ok: true,
    email,
    subscriptionActive: active,
    hasAccess: active,
  });
}

async function handleStripeWebhook(rawBody, signatureHeader, res) {
  const secret = getEnv("STRIPE_WEBHOOK_SECRET");
  verifyStripeWebhookSignature(rawBody, signatureHeader, secret);

  const event = safeJsonParse(rawBody.toString("utf8"), null);
  if (!event || !event.type) {
    return sendJson(res, 400, { error: "Invalid webhook payload" });
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "invoice.payment_succeeded":
    case "invoice.payment_failed":
      console.log("STRIPE WEBHOOK EVENT:", event.type, event.data?.object?.id || "");
      break;
    default:
      console.log("Unhandled Stripe webhook event:", event.type);
      break;
  }

  return sendJson(res, 200, { received: true, type: event.type });
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      endpoint: "BTDT single API",
      actions: ["generate", "create_checkout_session", "verify_session", "check_access"],
    });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const rawBody = await readRawBody(req);
  const signatureHeader = getHeader(req, "stripe-signature");

  try {
    if (signatureHeader) {
      return await handleStripeWebhook(rawBody, signatureHeader, res);
    }

    const bodyText = rawBody.toString("utf8") || "{}";
    const body = safeJsonParse(bodyText, {});
    const action = inferAction(body);

    if (action === "generate") {
      return await handleGenerate(res, body);
    }

    if (action === "create_checkout_session") {
      return await handleCreateCheckoutSession(res, body);
    }

    if (action === "verify_session") {
      return await handleVerifySession(res, body);
    }

    if (action === "check_access") {
      return await handleCheckAccess(res, body);
    }

    return sendJson(res, 400, {
      error: "Invalid action",
      allowed_actions: ["generate", "create_checkout_session", "verify_session", "check_access"],
    });
  } catch (err) {
    console.error("API ERROR:", err);
    return sendJson(res, 500, {
      error: err?.message || "Server error",
    });
  }
}
