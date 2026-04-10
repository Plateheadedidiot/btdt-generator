import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, plan } = req.body || {};

    if (!email || !plan) {
      return res.status(400).json({ error: "Missing email or plan" });
    }

    const priceId = plan === "subscription"
      ? process.env.STRIPE_SUBSCRIPTION_PRICE_ID
      : process.env.STRIPE_SINGLE_UNLOCK_PRICE_ID;

    const session = await stripe.checkout.sessions.create({
      mode: plan === "subscription" ? "subscription" : "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      success_url: "https://beentheredonetat.com/generator.html?success=true",
      cancel_url: "https://beentheredonetat.com/generator.html?cancel=true",
      metadata: { email, plan }
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
