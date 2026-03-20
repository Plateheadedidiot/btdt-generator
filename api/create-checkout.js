import Stripe from "stripe";
import { createClient } from "../lib/supabase.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { mode, email, image_id } = body;

    if (!email || !String(email).trim()) return res.status(400).json({ error: "Email required" });
    if (!["unlock", "subscribe", "hd_export", "print_ready"].includes(mode)) {
      return res.status(400).json({ error: "Invalid checkout mode" });
    }
    if (mode === "unlock" && !image_id) return res.status(400).json({ error: "image_id required for unlock checkout" });

    const cleanEmail = String(email).trim().toLowerCase();
    const appUrl = process.env.APP_URL;

    let price = "";
    let checkoutMode = "payment";

    if (mode === "unlock") price = process.env.STRIPE_PRICE_UNLOCK;
    if (mode === "subscribe") { price = process.env.STRIPE_PRICE_SUB_MONTHLY; checkoutMode = "subscription"; }
    if (mode === "hd_export") price = process.env.STRIPE_PRICE_HD_EXPORT;
    if (mode === "print_ready") price = process.env.STRIPE_PRICE_PRINT_READY;

    if (!price) return res.status(500).json({ error: `Missing Stripe price env var for ${mode}` });

    const session = await stripe.checkout.sessions.create({
      mode: checkoutMode,
      customer_email: cleanEmail,
      line_items: [{ price, quantity: 1 }],
      success_url: `${appUrl}/?checkout=success&image_id=${encodeURIComponent(image_id || "")}&email=${encodeURIComponent(cleanEmail)}`,
      cancel_url: `${appUrl}/?checkout=cancelled&image_id=${encodeURIComponent(image_id || "")}&email=${encodeURIComponent(cleanEmail)}`,
      metadata: {
        mode,
        image_id: image_id || "",
        email: cleanEmail
      }
    });

    // Optional session tracking
    const supabase = createClient();
    await supabase.from("checkout_sessions").insert({
      stripe_session_id: session.id,
      email: cleanEmail,
      image_id: image_id || null,
      mode
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Checkout creation failed" });
  }
}
