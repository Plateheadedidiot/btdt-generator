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
  throw new Error("Missing OPENAI_API_KEY");
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
  try { return JSON.parse(body); } catch { return {}; }
}

function inferAction(body = {}) {
  if (body.action) return body.action;
  if (body.sessionId) return "verify_session";
  if (body.checkoutMode) return "create_checkout_session";
  return "generate";
}

function clean(v, f = "") {
  return String(v ?? f).trim();
}

/* =========================
   🎯 PROMPT BUILDER
========================= */

function buildPrompt(input) {
  const parts = [];

  parts.push("Create a tattoo-ready design.");
  parts.push(`Placement: ${input.placement}`);
  parts.push("The tattoo must be realistically placed on the body with correct scale, angle, and anatomy.");
  parts.push("Use bold, clean linework and strong stencil readability.");
  parts.push("Avoid painterly, blurry, or overly detailed rendering.");

  if (input.prompt) {
    parts.push(`Design idea: ${input.prompt}`);
  }

  if (input.reference_image) {
    if (input.convertReference) {
      parts.push("Convert the uploaded image into a tattoo-ready version.");
      parts.push("Preserve pose, structure, and composition EXACTLY.");
      parts.push("Do not redesign. Only simplify and make tattooable.");
    } else if (input.strictReference) {
      parts.push("Match the uploaded image very closely.");
      parts.push("Preserve pose, composition, and structure.");
      parts.push("Only adjust for tattoo readability.");
    } else {
      parts.push("Use the uploaded image as inspiration.");
    }
  }

  return parts.join(". ");
}

/* =========================
   🎨 GENERATE
========================= */

async function handleGenerate(res, body) {
  const input = {
    prompt: clean(body.prompt),
    placement: clean(body.placement, "forearm"),
    strictReference: !!body.strictReference,
    convertReference: !!body.convertReference,
    reference_image: body.reference_image || null,
  };

  if (!input.prompt && !input.convertReference) {
    return send(res, 400, { error: "Missing prompt" });
  }

  if (input.convertReference && !input.reference_image) {
    return send(res, 400, { error: "Upload inspo image first" });
  }

  const basePrompt = buildPrompt(input);

  let prompt = basePrompt;

  if (input.reference_image) {
    if (input.convertReference) {
      prompt += " Preserve the original image as closely as possible. This is a direct tattoo conversion.";
    } else if (input.strictReference) {
      prompt += " Stay very close to the reference image.";
    }
  }

  let img;

  if (input.reference_image) {
    try {
      img = await client.images.generate({
        model: "gpt-image-1",
        size: "1024x1024",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_data: input.reference_image }
            ]
          }
        ]
      });
    } catch {
      img = await client.images.generate({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
      });
    }
  } else {
    img = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });
  }

  const image = img?.data?.[0]?.b64_json;

  if (!image) {
    return send(res, 500, { error: "No image returned" });
  }

  return send(res, 200, {
    image,
    used_reference_image: !!input.reference_image,
    strict: input.strictReference,
    convert: input.convertReference,
  });
}

/* =========================
   💳 STRIPE (unchanged)
========================= */

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
  try { return JSON.parse(text); } catch { throw new Error(text); }
}

async function handleCheckout(res, body) {
  const mode = body.checkoutMode === "subscription" ? "subscription" : "payment";

  const price =
    mode === "subscription"
      ? STRIPE_SUBSCRIPTION_PRICE_ID
      : STRIPE_UNLOCK_PRICE_ID;

  const session = await stripeFetch("/v1/checkout/sessions", "POST", {
    mode,
    success_url: `${PUBLIC_APP_URL}/generator.html?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${PUBLIC_APP_URL}/generator.html`,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    customer_email: body.email || "",
  });

  return send(res, 200, { url: session.url });
}

async function handleVerify(res, body) {
  const session = await stripeFetch(`/v1/checkout/sessions/${body.sessionId}`);
  return send(res, 200, {
    success: session.payment_status === "paid",
    mode: session.mode,
  });
}

function verifyStripe(sig, payload) {
  const parts = Object.fromEntries(sig.split(",").map(p => p.split("=")));

  const signed = crypto
    .createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(parts.t + "." + payload)
    .digest("hex");

  if (signed !== parts.v1) throw new Error("Bad signature");
}

async function handleWebhook(req, res, raw) {
  verifyStripe(req.headers["stripe-signature"], raw);
  return send(res, 200, { received: true });
}

/* =========================
   🚀 MAIN
========================= */

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();

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

    return send(res, 400, { error: "Invalid action" });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
}
