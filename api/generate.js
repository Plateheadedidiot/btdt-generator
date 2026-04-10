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
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
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

async function handleGenerate(res, body) {
  if (!body.prompt && !body.scriptText) {
    return send(res, 400, { error: "Missing design prompt" });
  }

  const prompt = body.prompt || body.scriptText;

  const img = await client.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024",
    quality: "high",
  });

  const image = img?.data?.[0]?.b64_json;
  if (!image) {
    return send(res, 500, { error: "No image returned from OpenAI" });
  }

  return send(res, 200, { image });
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
  const rawMode = String(body.checkoutMode || "").toLowerCase();
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
