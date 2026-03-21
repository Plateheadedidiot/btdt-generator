import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  const allowedOrigins = [
    "https://beentheredonetat.com",
    "https://www.beentheredonetat.com",
    "http://beentheredonetat.com",
    "http://www.beentheredonetat.com",
    "https://btdt-generator-4tts.vercel.app"
  ];

  const origin = req.headers.origin || "";
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { mode, email } = body;

    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: "Email required" });
    }

    if (!["unlock", "subscribe"].includes(mode)) {
      return res.status(400).json({ error: "Invalid checkout mode" });
    }

    const price = mode === "unlock"
      ? process.env.STRIPE_PRICE_UNLOCK
      : process.env.STRIPE_PRICE_SUB_MONTHLY;

    if (!price) {
      return res.status(500).json({ error: "Missing Stripe price env var" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: mode === "unlock" ? "payment" : "subscription",
      customer_email: String(email).trim().toLowerCase(),
      line_items: [{ price, quantity: 1 }],
      success_url: `https://beentheredonetat.com/generator.html?checkout=success&mode=${mode}`,
      cancel_url: `https://beentheredonetat.com/generator.html?checkout=cancelled`
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Checkout creation failed" });
  }
}
