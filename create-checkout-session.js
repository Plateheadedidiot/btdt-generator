import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email, plan } = req.body || {};

    if (!email || !plan) {
      return res.status(400).json({ error: "Missing email or plan" });
    }

    const isSubscription = plan === "subscription";
    const priceId = isSubscription
      ? process.env.STRIPE_SUBSCRIPTION_PRICE_ID
      : process.env.STRIPE_SINGLE_UNLOCK_PRICE_ID;

    if (!priceId) {
      return res.status(500).json({ error: "Missing Stripe price ID environment variable" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: isSubscription ? "subscription" : "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      success_url: "https://beentheredonetat.com/generator.html?checkout=success",
      cancel_url: "https://beentheredonetat.com/generator.html?checkout=cancel",
      metadata: {
        email,
        plan
      }
    });

    return res.status(200).json({
      ok: true,
      url: session.url,
      session_id: session.id
    });
  } catch (err) {
    console.error("CHECKOUT SESSION ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Checkout session creation failed"
    });
  }
}