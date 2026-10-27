
import OpenAI, { toFile } from "openai";
import crypto from "crypto";

export const config = {
  api: { bodyParser: false },
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Stripe Price IDs are safe to include in public code.
const STRIPE_UNLOCK_PRICE_ID =
  "price_1TCo7VBUHTFhWUqxGsVwYNpX";

const STRIPE_SUBSCRIPTION_PRICE_ID =
  "price_1TCo8kBUHTFhWUqxtJhaCIfH";

const PUBLIC_APP_URL =
  process.env.PUBLIC_APP_URL ||
  process.env.APP_URL ||
  "https://beentheredonetat.com";

const IMAGE_MODEL =
  process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

const client = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

function send(res, code, data) {
  return res.status(code).json(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)
    );
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

  if (body.sessionId || body.session_id) {
    return "verify_session";
  }

  if (body.checkoutMode) {
    return "create_checkout_session";
  }

  if (
    body.email &&
    !body.prompt &&
    !body.scriptText
  ) {
    return "check_access";
  }

  return "generate";
}

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
}

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
      "Use segmented finger placement with one character per segment when possible.";

    if (count === 4) {
      rule =
        "Place exactly one character on each of four fingers or knuckles.";
    } else if (count === 8) {
      rule =
        "Split the text across both hands, one character per finger or knuckle.";
    } else if (count > 0) {
      rule =
        `Distribute ${count} characters naturally across finger or knuckle segments.`;
    }

    return [
      "Do not use continuous straight-line typography across the fingers.",
      rule,
      "Keep characters centered, separated and readable.",
      "Respect realistic finger spacing.",
      flowShape === "straight line"
        ? "Interpret straight line as segmented placement."
        : "Honor the flow only where anatomically believable.",
      bodyMockup
        ? "Show the hand clearly with realistic anatomy."
        : "Compose for authentic finger or knuckle tattoos."
    ].join(" ");
  }

  const rules = {
    arm: "Follow natural arm curvature and spacing.",
    forearm: "Use a vertical composition along the forearm.",
    "upper arm": "Fit the rounded upper arm naturally.",
    wrist: "Keep the design compact and readable.",
    hand: "Use believable placement and scale on the hand.",
    thigh: "Use an open composition suitable for the thigh.",
    calf: "Flow vertically with the natural calf shape.",
    shin: "Center the design along the shin.",
    ankle: "Keep the design small and fitted to the ankle.",
    knee: "Work with the curved shape of the knee.",
    chest: "Follow the natural width and flow of the chest.",
    sternum: "Use a narrow, centered vertical composition.",
    stomach: "Follow the natural torso shape.",
    back: "Use a balanced composition for the back.",
    "shoulder blade": "Follow the shoulder blade's angle.",
    neck: "Keep the tattoo compact and naturally oriented.",
    "behind ear": "Use a small, subtle, realistic placement."
  };

  return (
    rules[p] ||
    "Use anatomically believable tattoo placement."
  );
}

function buildQualityRules(input) {
  const style = clean(input.style).toLowerCase();
  const color = clean(input.color).toLowerCase();

  const rules = [
    "Create a tattoo-ready image.",
    "Prioritize clean, bold linework.",
    "Use strong silhouettes and intentional negative space.",
    "Avoid muddy shading, blurry edges and unnecessary tiny details.",
    "Keep the design readable and suitable for tattoo translation.",
    "Use professional tattoo composition, not a poster layout."
  ];

  if (input.bodyMockup) {
    rules.push(
      "Show the tattoo naturally integrated on the selected body area.",
      "Use believable anatomy, proportions and scale.",
      "The tattoo must not look like a floating sticker.",
      "Make the exact placement clearly visible."
    );
  } else {
    rules.push(
      "Display the artwork clearly on a plain light background.",
      "Keep the composition appropriate for its intended body placement."
    );
  }

  if (
    color.includes("black") ||
    color.includes("grey") ||
    color.includes("sepia") ||
    color.includes("ink only")
  ) {
    rules.push(
      "Use high contrast, bold black shapes and readable shading."
    );
  } else {
    rules.push(
      "Use intentional tattoo-style color grouping."
    );
  }

  if (style.includes("fine line")) {
    rules.push(
      "Use delicate but tattooable linework."
    );
  }

  if (style.includes("traditional")) {
    rules.push(
      "Use classic tattoo outlines, strong contrast and durable composition."
    );
  }

  if (style.includes("japanese")) {
    rules.push(
      "Use strong Japanese tattoo flow and readable graphic masses."
    );
  }

  if (style.includes("realism")) {
    rules.push(
      "Preserve tattoo-friendly contrast and avoid photographic noise."
    );
  }

  if (
    style.includes("cartoony") ||
    style.includes("illustrative") ||
    style.includes("surreal")
  ) {
    rules.push(
      "Use clean graphic shapes and bold, tattooable illustration."
    );
  }

  if (
    input.mode === "script" ||
    input.mode === "design_script"
  ) {
    rules.push(
      "Keep lettering sharp, readable and correctly spelled."
    );
  }

  return rules.join(" ");
}

function buildPrompt(input) {
  const parts = [
    "Create a professional tattoo-ready image.",
    `Placement: ${input.placement}.`,
    `Placement guidance: ${placementRule(
      input.placement,
      input.scriptText,
      input.flowShape,
      input.bodyMockup
    )}`,
    `Size: ${input.size}.`,
    `Color: ${input.color}.`,
    `Quality rules: ${buildQualityRules(input)}`
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
      "Do not alter spelling, capitalization, punctuation or spacing.",
      `Font style: ${input.fontStyle}.`,
      `Flow layout: ${input.flowShape}.`
    );
  } else {
    parts.push(
      `Tattoo style: ${input.style}.`,
      `Design idea: ${input.prompt}.`,
      `Add the EXACT text "${input.scriptText}".`,
      `Font style: ${input.fontStyle}.`,
      `Flow layout: ${input.flowShape}.`
    );
  }

  if (input.secondLine) {
    parts.push(
      `Add a second line with EXACT text "${input.secondLine}".`
    );
  }

  if (input.emphasisWord) {
    parts.push(
      `Emphasize the word "${input.emphasisWord}".`
    );
  }

  if (input.reference_image) {
    if (input.convertReference) {
      parts.push(
        "Convert the supplied reference image into a tattoo-ready design.",
        "Preserve its composition, subject, pose and silhouette.",
        "Only simplify elements necessary for tattoo readability.",
        "Do not replace the reference with a different concept."
      );
    } else if (input.strictReference) {
      parts.push(
        "Match the reference image very closely.",
        "Preserve its subject, composition and silhouette."
      );
    } else {
      parts.push(
        "Use the reference image as inspiration for composition and visual direction."
      );
    }
  }

  return parts.join(" ");
}

function decodeReferenceImage(reference) {
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
    bytes.length === 0 ||
    bytes.length > 15 * 1024 * 1024
  ) {
    throw Object.assign(
      new Error(
        "Reference image must be valid and smaller than 15 MB."
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
      bytes.subarray(0, 4).toString("ascii") === "RIFF"
    ) {
      mime = "image/webp";
    } else if (
      bytes.subarray(0, 8).toString("hex") ===
      "89504e470d0a1a0a"
    ) {
      mime = "image/png";
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

async function handleGenerate(res, body) {
  if (!client) {
    return send(res, 503, {
      error:
        "OPENAI_API_KEY is not configured in Vercel."
    });
  }

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
  let response;

  if (input.reference_image) {
    const { bytes, mime, ext } =
      decodeReferenceImage(input.reference_image);

    const referenceFile = await toFile(
      bytes,
      `reference.${ext}`,
      { type: mime }
    );

    response = await client.images.edit({
      model: IMAGE_MODEL,
      image: referenceFile,
      prompt,
      size: "1024x1024",
      quality: "high"
    });
  } else {
    response = await client.images.generate({
      model: IMAGE_MODEL,
      prompt,
      size: "1024x1024",
      quality: "high"
    });
  }

  const image = response?.data?.[0]?.b64_json;

  if (!image) {
    return send(res, 500, {
      error: "OpenAI did not return an image."
    });
  }

  return send(res, 200, {
    image,
    prompt_used: prompt,
    used_reference_image: !!input.reference_image,
    strict_reference: input.strictReference,
    convert_reference: input.convertReference
  });
}

async function stripeFetch(
  path,
  method = "POST",
  form = null
) {
  if (!STRIPE_SECRET_KEY) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured."
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
    throw new Error(
      data?.error?.message ||
      `Stripe error ${response.status}`
    );
  }

  return data;
}

async function handleCheckout(res, body) {
  const rawMode =
    clean(body.checkoutMode).toLowerCase();

  const mode =
    ["subscription", "subscribe"].includes(rawMode)
      ? "subscription"
      : "payment";

  const price =
    mode === "subscription"
      ? STRIPE_SUBSCRIPTION_PRICE_ID
      : STRIPE_UNLOCK_PRICE_ID;

  const email = clean(body.email).toLowerCase();

  if (!email || !email.includes("@")) {
    return send(res, 400, {
      error: "Valid email required."
    });
  }

  const session = await stripeFetch(
    "/v1/checkout/sessions",
    "POST",
    {
      mode,
      "metadata[purchase_mode]":
        mode === "subscription"
          ? "subscription"
          : "unlock",
      success_url:
        `${PUBLIC_APP_URL}/generator.html?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:
        `${PUBLIC_APP_URL}/generator.html`,
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      customer_email: email
    }
  );

  if (!session?.url) {
    return send(res, 500, {
      error:
        "Stripe did not return a checkout URL."
    });
  }

  return send(res, 200, {
    url: session.url
  });
}

async function handleVerify(res, body) {
  const sessionId =
    body.sessionId || body.session_id;

  if (!sessionId) {
    return send(res, 400, {
      error: "Missing checkout session ID."
    });
  }

  const session = await stripeFetch(
    `/v1/checkout/sessions/${encodeURIComponent(
      sessionId
    )}`,
    "GET"
  );

  return send(res, 200, {
    success:
      session.payment_status === "paid",
    mode: session.mode
  });
}

async function handleAccess(res) {
  return send(res, 200, {
    hasAccess: false,
    subscriptionActive: false
  });
}

function verifyStripe(signature, payload) {
  if (!STRIPE_WEBHOOK_SECRET || !signature) {
    throw new Error(
      "Webhook signature configuration missing."
    );
  }

  const parts = Object.fromEntries(
    signature.split(",").map((p) => {
      const [key, value] = p.split("=");
      return [key, value];
    })
  );

  const signed = crypto
    .createHmac(
      "sha256",
      STRIPE_WEBHOOK_SECRET
    )
    .update(parts.t + "." + payload)
    .digest("hex");

  const expected = Buffer.from(
    signed,
    "hex"
  );
  const actual = Buffer.from(
    parts.v1 || "",
    "hex"
  );

  if (
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(expected, actual)
  ) {
    throw new Error(
      "Invalid Stripe webhook signature."
    );
  }
}

async function handleWebhook(req, res, raw) {
  try {
    verifyStripe(
      req.headers["stripe-signature"],
      raw
    );

    return send(res, 200, {
      received: true
    });
  } catch (err) {
    return send(res, 400, {
      error: "Webhook verification failed."
    });
  }
}

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
    "Content-Type, Stripe-Signature"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return send(res, 200, {
      ok: true
    });
  }

  if (req.method !== "POST") {
    return send(res, 405, {
      error: "Method not allowed."
    });
  }

  try {
    const raw = await readBody(req);

    if (req.headers["stripe-signature"]) {
      return await handleWebhook(
        req,
        res,
        raw
      );
    }

    const body = parse(raw);
    const action = inferAction(body);

    if (action === "generate") {
      return await handleGenerate(res, body);
    }

    if (action === "create_checkout_session") {
      return await handleCheckout(res, body);
    }

    if (action === "verify_session") {
      return await handleVerify(res, body);
    }

    if (action === "check_access") {
      return await handleAccess(res);
    }

    return send(res, 400, {
      error: "Invalid action."
    });
  } catch (err) {
    console.error("API ERROR:", err);

    const status =
      err?.status === 429
        ? 429
        : err?.status === 401
          ? 502
          : err?.status === 400
            ? 400
            : 500;

    const message =
      status === 429
        ? "Image service rate limit reached. Try again shortly."
        : status === 502
          ? "OpenAI API key invalid or expired. Check Vercel."
          : err?.message || "Server error.";

    return send(res, status, {
      error: message
    });
  }
}

