import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { mode, email } = req.body || {};

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
      success_url: `${process.env.APP_URL}/?checkout=success&mode=${mode}`,
      cancel_url: `${process.env.APP_URL}/?checkout=cancelled`
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Checkout creation failed" });
  }
}
