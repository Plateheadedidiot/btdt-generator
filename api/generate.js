import OpenAI, { toFile } from "openai";
import crypto from "crypto";
import { createClient } from "../lib/supabase.js";
import { getAuthenticatedUser } from "../lib/auth.js";

export const config = {
  api: { bodyParser: false }
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// VERIFIED LIVE STRIPE PRICE IDS
const STRIPE_UNLOCK_PRICE_ID =
  "price_1TlECVBlbWKxWiyBbNY7AcBa";

const STRIPE_SUBSCRIPTION_PRICE_ID =
  "price_1TlECxBlbWKxWiyBCCA1fpjY";

const PUBLIC_APP_URL =
  process.env.PUBLIC_APP_URL ||
  process.env.APP_URL ||
  "https://beentheredonetat.com";

const IMAGE_MODEL =
  process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

const client = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

function send(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)
    );
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function inferAction(body) {
  if (body.action) return body.action;

  if (body.sessionId || body.session_id) {
    return "verify_session";
  }

  if (body.checkoutMode) {
    return "create_checkout_session";
  }

  if (body.email && !body.prompt && !body.scriptText) {
    return "check_access";
  }

  return "generate";
}

// SUPABASE DATABASE CONNECTION
function getDatabase() {
  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw Object.assign(
      new Error(
        "Supabase environment variables are missing in Vercel."
      ),
      { status: 503 }
    );
  }

  return createClient();
}

function validImageId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(clean(value));
}

// TATTOO PLACEMENT RULES
function placementRule(
  placement,
  scriptText = "",
  flowShape = "",
  bodyMockup = true
) {
  const p = clean(placement).toLowerCase();

  const count = clean(scriptText)
    .replace(/\s+/g, "").length;

  if (p === "knuckles" || p === "fingers") {
    let rule =
      "Place characters separately on fingers or knuckles.";

    if (count === 4) {
      rule =
        "Place exactly one character on each of four fingers.";
    } else if (count === 8) {
      rule =
        "Split the text evenly across both hands.";
    } else if (count > 0) {
      rule =
        `Distribute ${count} characters naturally across the fingers.`;
    }

    return [
      rule,
      "Use realistic finger anatomy, spacing and scale.",
      "Keep every character clear, centered and readable.",
      "Avoid lettering that connects unnaturally across fingers.",
      flowShape === "straight line"
        ? "Interpret straight line as segmented finger placement."
        : "Adapt the flow to the anatomy.",
      bodyMockup
        ? "Show the tattoo accurately positioned on a real hand."
        : "Show a clean segmented finger tattoo design."
    ].join(" ");
  }

  const rules = {
    arm: "Follow natural arm curvature.",
    forearm: "Create a vertical forearm composition.",
    "upper arm": "Fit the rounded upper arm.",
    wrist: "Use a compact, realistic wrist placement.",
    hand: "Respect natural hand anatomy.",
    thigh: "Use an open composition appropriate for the thigh.",
    calf: "Follow the vertical flow of the calf.",
    shin: "Center the design vertically along the shin.",
    ankle: "Keep the tattoo compact and naturally fitted.",
    knee: "Respect the rounded knee shape.",
    chest: "Follow natural chest contours.",
    sternum: "Use a centered vertical composition.",
    stomach: "Follow natural torso contours.",
    back: "Use balanced placement across the back.",
    "shoulder blade": "Follow the angle of the shoulder blade.",
    neck: "Use appropriate scale for neck placement.",
    "behind ear": "Keep the design very small and realistic."
  };

  return rules[p] ||
    "Use anatomically believable tattoo placement.";
}

// TATTOO QUALITY RULES
function buildQualityRules(input) {
  const style = clean(input.style).toLowerCase();
  const color = clean(input.color).toLowerCase();

  const rules = [
    "Create a professional tattoo-ready design.",
    "Use intentional line weight and strong composition.",
    "Prioritize clean outlines, readable shapes and negative space.",
    "Avoid muddy shading, excessive tiny detail and blurry edges.",
    "Keep all artwork suitable for real-world tattoo translation."
  ];

  if (input.bodyMockup) {
    rules.push(
      "Show the tattoo naturally placed on the selected body area.",
      "Respect believable anatomy, scale and skin curvature.",
      "The tattoo must not appear to float above the skin.",
      "Make the requested placement clearly visible."
    );
  } else {
    rules.push(
      "Display the artwork against a plain light background.",
      "Keep the composition appropriate for the chosen body area."
    );
  }

  if (
    color.includes("black") ||
    color.includes("grey") ||
    color.includes("sepia") ||
    color.includes("ink only")
  ) {
    rules.push(
      "Use strong black shapes and high-contrast shading."
    );
  } else {
    rules.push(
      "Use tattoo-friendly color grouping and strong outlines."
    );
  }

  if (style.includes("fine line")) {
    rules.push(
      "Use delicate but durable tattooable lines."
    );
  }

  if (style.includes("traditional")) {
    rules.push(
      "Use traditional tattoo readability and strong line hierarchy."
    );
  }

  if (style.includes("japanese")) {
    rules.push(
      "Use intentional Japanese tattoo flow and bold graphic masses."
    );
  }

  if (style.includes("realism")) {
    rules.push(
      "Preserve realistic detail without excessive photographic noise."
    );
  }

  if (
    style.includes("cartoony") ||
    style.includes("illustrative") ||
    style.includes("surreal")
  ) {
    rules.push(
      "Use bold cartoon-inspired shapes with tattooable detail."
    );
  }

  if (
    input.mode === "script" ||
    input.mode === "design_script"
  ) {
    rules.push(
      "Prioritize accurate spelling, legible characters and balanced lettering."
    );
  }

  return rules.join(" ");
}

// IMAGE GENERATION PROMPT
function buildPrompt(input) {
  const parts = [
    "Create a professional tattoo-ready image.",
    `Tattoo placement: ${input.placement}.`,
    `Placement guidance: ${placementRule(
      input.placement,
      input.scriptText,
      input.flowShape,
      input.bodyMockup
    )}`,
    `Size: ${input.size}.`,
    `Color: ${input.color}.`,
    `Quality requirements: ${buildQualityRules(input)}`
  ];

  if (input.mode === "design") {
    parts.push(
      `Tattoo style: ${input.style}.`
    );

    if (input.prompt) {
      parts.push(
        `Design idea: ${input.prompt}.`
      );
    }
  } else if (input.mode === "script") {
    parts.push(
      `Use the EXACT text "${input.scriptText}".`,
      "Do not change capitalization, punctuation, spelling or spacing.",
      `Font style: ${input.fontStyle}.`,
      `Lettering layout: ${input.flowShape}.`
    );
  } else {
    parts.push(
      `Tattoo style: ${input.style}.`,
      `Design idea: ${input.prompt}.`,
      `Include the EXACT text "${input.scriptText}".`,
      `Font style: ${input.fontStyle}.`,
      `Lettering layout: ${input.flowShape}.`
    );
  }

  if (input.secondLine) {
    parts.push(
      `Include a second line with EXACT text "${input.secondLine}".`
    );
  }

  if (input.emphasisWord) {
    parts.push(
      `Emphasize the EXACT word "${input.emphasisWord}".`
    );
  }

  if (input.reference_image) {
    if (input.convertReference) {
      parts.push(
        "Convert the uploaded reference image into tattoo-ready artwork.",
        "Preserve the original composition, pose, subject and silhouette.",
        "Simplify only the details necessary for tattoo readability.",
        "Do not invent a completely different design."
      );
    } else if (input.strictReference) {
      parts.push(
        "Match the reference image as closely as possible.",
        "Preserve pose, silhouette, composition and subject."
      );
    } else {
      parts.push(
        "Use the uploaded image as strong visual inspiration."
      );
    }
  }

  return parts.join(" ");
}

// REFERENCE IMAGE SUPPORT
function decodeReference(reference) {
  const raw = String(reference || "");

  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s.exec(raw);

  const base64 = (match ? match[2] : raw)
    .replace(/\s/g, "");

  if (
    !base64 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  ) {
    throw Object.assign(
      new Error("Invalid reference image encoding."),
      { status: 400 }
    );
  }

  const bytes = Buffer.from(base64, "base64");

  if (
    !bytes.length ||
    bytes.length > 15 * 1024 * 1024
  ) {
    throw Object.assign(
      new Error(
        "Reference image must be smaller than 15 MB."
      ),
      { status: 400 }
    );
  }

  let mime = match?.[1];

  if (!mime) {
    if (
      bytes.subarray(0, 3).toString("hex") === "ffd8ff"
    ) {
      mime = "image/jpeg";
    } else if (
      bytes.subarray(0, 8).toString("hex") ===
      "89504e470d0a1a0a"
    ) {
      mime = "image/png";
    } else if (
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      mime = "image/webp";
    } else {
      throw Object.assign(
        new Error(
          "Reference image must be PNG, JPEG or WebP."
        ),
        { status: 400 }
      );
    }
  }

  const ext =
    mime === "image/jpeg"
      ? "jpg"
      : mime === "image/webp"
        ? "webp"
        : "png";

  return { bytes, mime, ext };
}

// GENERATE AND SAVE IMAGE TO SUPABASE
async function handleGenerate(res, body, user = null) {
  if (!client) {
    return send(res, 503, {
      error:
        "OPENAI_API_KEY is not configured in Vercel."
    });
  }

  const input = {
    mode: clean(body.mode, "design"),
    prompt: clean(body.prompt),
    scriptText: clean(body.scriptText),
    secondLine: clean(body.secondLine),
    emphasisWord: clean(body.emphasisWord),
    style: clean(body.style, "traditional"),
    placement: clean(body.placement, "forearm"),
    size: clean(body.size, "medium"),
    color: clean(body.color, "black and grey"),
    fontStyle: clean(
      body.fontStyle,
      "fine line cursive"
    ),
    flowShape: clean(
      body.flowShape,
      "straight line"
    ),
    bodyMockup: !!body.bodyMockup,
    strictReference: !!body.strictReference,
    convertReference: !!body.convertReference,
    reference_image: body.reference_image || null
  };

  if (
    !["design", "script", "design_script"]
      .includes(input.mode)
  ) {
    return send(res, 400, {
      error: "Invalid generation mode."
    });
  }

  if (
    input.mode !== "script" &&
    !input.prompt &&
    !input.convertReference
  ) {
    return send(res, 400, {
      error: "Missing design prompt."
    });
  }

  if (
    input.mode !== "design" &&
    !input.scriptText
  ) {
    return send(res, 400, {
      error: "Missing script text."
    });
  }

  if (
    input.convertReference &&
    !input.reference_image
  ) {
    return send(res, 400, {
      error: "Upload an inspiration image first."
    });
  }

  const prompt = buildPrompt(input);
  let result;

  if (input.reference_image) {
    const { bytes, mime, ext } =
      decodeReference(input.reference_image);

    const referenceFile = await toFile(
      bytes,
      `reference.${ext}`,
      { type: mime }
    );

    result = await client.images.edit({
      model: IMAGE_MODEL,
      image: referenceFile,
      prompt,
      size: "1024x1024",
      quality: "high"
    });
  } else {
    result = await client.images.generate({
      model: IMAGE_MODEL,
      prompt,
      size: "1024x1024",
      quality: "high"
    });
  }

  const image = result?.data?.[0]?.b64_json;

  if (!image) {
    return send(res, 500, {
      error: "OpenAI did not return an image."
    });
  }

  // NEW: Save generated image privately in Supabase.
  // The database creates a unique UUID for each image.
  const db = getDatabase();

  const saved = await db
    .from("images")
    .insert({
      prompt,
      image_b64: image,
      user_id: user?.id || null,
      email: user?.email || null,
      is_unlocked: false,
      is_public: false
    })
    .select("id")
    .single();

  if (saved.error || !saved.data?.id) {
    console.error(
      "SUPABASE IMAGE SAVE ERROR:",
      saved.error
    );

    return send(res, 500, {
      error:
        "Image generated but could not be saved in Supabase. No payment was taken."
    });
  }

  // Preserve the existing response format.
  // Add imageId so the frontend can identify this design.
  return send(res, 200, {
    image,
    imageId: saved.data.id,
    prompt_used: prompt,
    used_reference_image: !!input.reference_image,
    strict_reference: input.strictReference,
    convert_reference: input.convertReference
  });
}

// STRIPE API
async function stripeFetch(
  path,
  method = "POST",
  form = null
) {
  if (!STRIPE_SECRET_KEY) {
    throw Object.assign(
      new Error(
        "STRIPE_SECRET_KEY is not configured."
      ),
      { status: 503 }
    );
  }

  if (!STRIPE_SECRET_KEY.startsWith("sk_live_")) {
    throw Object.assign(
      new Error(
        "A live Stripe secret key is required."
      ),
      { status: 503 }
    );
  }

  const body = form
    ? new URLSearchParams(form).toString()
    : undefined;

  const response = await fetch(
    "https://api.stripe.com" + path,
    {
      method,
      headers: {
        Authorization:
          `Bearer ${STRIPE_SECRET_KEY}`,
        ...(body
          ? {
              "Content-Type":
                "application/x-www-form-urlencoded"
            }
          : {})
      },
      body
    }
  );

  const raw = await response.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Stripe returned an invalid response (${response.status}).`
    );
  }

  if (!response.ok) {
    throw Object.assign(
      new Error(
        data?.error?.message ||
        `Stripe error ${response.status}`
      ),
      { status: response.status }
    );
  }

  return data;
}

// LIVE CHECKOUT
async function handleCheckout(res, body) {
  const requestedMode =
    clean(body.checkoutMode).toLowerCase();

  if (
    ![
      "unlock",
      "payment",
      "subscription",
      "subscribe"
    ].includes(requestedMode)
  ) {
    return send(res, 400, {
      error: "Invalid checkout mode."
    });
  }

  const isSubscription =
    requestedMode === "subscription" ||
    requestedMode === "subscribe";

  const mode =
    isSubscription ? "subscription" : "payment";

  const price =
    isSubscription
      ? STRIPE_SUBSCRIPTION_PRICE_ID
      : STRIPE_UNLOCK_PRICE_ID;

  const email = clean(body.email).toLowerCase();

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return send(res, 400, {
      error: "Valid email required."
    });
  }

  const imageId = clean(body.imageId);

  // NEW: Never charge for an image that
  // does not have a saved database record.
  if (!isSubscription) {
    if (!validImageId(imageId)) {
      return send(res, 400, {
        error:
          "A valid saved image ID is required for the $1.99 unlock."
      });
    }

    const db = getDatabase();

    const lookup = await db
      .from("images")
      .select("id,is_unlocked")
      .eq("id", imageId)
      .maybeSingle();

    if (lookup.error) {
      console.error(
        "SUPABASE IMAGE LOOKUP ERROR:",
        lookup.error
      );

      return send(res, 503, {
        error:
          "Unable to verify the image before checkout."
      });
    }

    if (!lookup.data) {
      return send(res, 404, {
        error: "Purchased image not found."
      });
    }

    if (lookup.data.is_unlocked) {
      return send(res, 409, {
        error:
          "This image has already been unlocked."
      });
    }
  }

  const params = {
    mode,
    "metadata[source]": "btdt-generator",
    "metadata[purchase_mode]":
      isSubscription
        ? "subscription"
        : "unlock",
    "metadata[email]": email,
    "metadata[image_id]":
      isSubscription ? "" : imageId,
    success_url:
      `${PUBLIC_APP_URL}/generator.html?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:
      `${PUBLIC_APP_URL}/generator.html?checkout=cancelled`,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    customer_email: email
  };

  const session = await stripeFetch(
    "/v1/checkout/sessions",
    "POST",
    params
  );

  if (!session?.url) {
    return send(res, 500, {
      error:
        "Stripe did not return a checkout URL."
    });
  }

  return send(res, 200, {
    url: session.url,
    checkoutUrl: session.url,
    sessionId: session.id
  });
}

// VERIFY A STRIPE CHECKOUT SESSION
async function handleVerify(res, body) {
  const sessionId = clean(
    body.sessionId || body.session_id
  );

  if (
    !/^cs_(test_)?[A-Za-z0-9]+$/.test(sessionId)
  ) {
    return send(res, 400, {
      error: "Invalid checkout session ID."
    });
  }

  const session = await stripeFetch(
    `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    "GET"
  );

  const paid =
    session.payment_status === "paid";

  return send(res, 200, {
    success: paid,
    paid,
    mode: session.mode,
    imageId:
      session.metadata?.image_id || null,
    subscriptionId:
      session.subscription || null
  });
}

// ACCESS MUST BE VERIFIED SERVER-SIDE
async function handleAccess(res) {
  return send(res, 200, {
    hasAccess: false,
    subscriptionActive: false
  });
}

// VERIFY WEBHOOK SIGNATURE
function verifyStripeSignature(signature, payload) {
  if (!STRIPE_WEBHOOK_SECRET || !signature) {
    throw new Error(
      "Missing Stripe webhook configuration."
    );
  }

  const parts = signature.split(",");
  let timestamp = "";
  const signatures = [];

  for (const part of parts) {
    const [key, value] = part.split("=");

    if (key === "t") timestamp = value;
    if (key === "v1") signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) {
    throw new Error(
      "Invalid webhook signature."
    );
  }

  if (
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  ) {
    throw new Error(
      "Expired webhook signature."
    );
  }

  const expected = crypto
    .createHmac(
      "sha256",
      STRIPE_WEBHOOK_SECRET
    )
    .update(timestamp + "." + payload)
    .digest("hex");

  const expectedBytes =
    Buffer.from(expected, "hex");

  const valid = signatures.some(sig => {
    if (!/^[a-f0-9]{64}$/i.test(sig)) {
      return false;
    }

    const received = Buffer.from(sig, "hex");

    return (
      received.length === expectedBytes.length &&
      crypto.timingSafeEqual(
        received,
        expectedBytes
      )
    );
  });

  if (!valid) {
    throw new Error(
      "Invalid Stripe webhook signature."
    );
  }
}

// Existing webhook compatibility handler.
// Your dedicated /api/stripe-webhook endpoint
// is responsible for recording purchases.
async function handleWebhook(req, res, raw) {
  try {
    verifyStripeSignature(
      req.headers["stripe-signature"],
      raw
    );

    return send(res, 200, {
      received: true
    });
  } catch {
    return send(res, 400, {
      error:
        "Webhook signature verification failed."
    });
  }
}

// MAIN API HANDLER
export default async function handler(req, res) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Stripe-Signature, Authorization"
  );

  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return send(res, 200, {
      ok: true,
      databaseConfigured: Boolean(
        process.env.SUPABASE_URL &&
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    });
  }

  if (req.method !== "POST") {
    return send(res, 405, {
      error: "Method not allowed."
    });
  }

  try {
    if (req.headers["stripe-signature"]) {
      const chunks = [];

      for await (const chunk of req) {
        chunks.push(
          Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk)
        );
      }

      return await handleWebhook(
        req,
        res,
        Buffer.concat(chunks).toString("utf8")
      );
    }

    const body = await readBody(req);
    const action = inferAction(body);

    if (action === "generate") {
      const user = await getAuthenticatedUser(req);

      if (req.headers.authorization && !user) {
        return send(res, 401, {
          error: "Invalid or expired login token."
        });
      }

      return await handleGenerate(res, body, user);
    }

    if (
      action === "create_checkout_session" ||
      action === "verify_session" ||
      action === "check_access"
    ) {
      return send(res, 503, {
        error:
          "This legacy action is disabled. Use the dedicated authenticated API endpoint."
      });
    }

    return send(res, 400, {
      error: "Invalid action."
    });
  } catch (err) {
    console.error("API ERROR:", err);

    const status =
      [400, 413, 429, 503].includes(err?.status)
        ? err.status
        : 500;

    return send(res, status, {
      error: err?.message || "Server error."
    });
  }
}
