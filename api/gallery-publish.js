
import Stripe from "stripe";
import { createClient } from "../lib/supabase.js";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  if (!stripe ||
      !process.env.SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({
      error: "Payment or gallery database not configured"
    });
  }

  try {
    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body || {};

    const sessionId = String(body.sessionId || "");
    const share = body.share === true;

    if (!/^cs_live_[A-Za-z0-9]+$/.test(sessionId)) {
      return res.status(400).json({
        error: "A valid live checkout session is required"
      });
    }

    const session =
      await stripe.checkout.sessions.retrieve(sessionId);

    if (
      session.livemode !== true ||
      session.mode !== "payment" ||
      session.payment_status !== "paid" ||
      session.metadata?.purchase_mode !== "unlock"
    ) {
      return res.status(403).json({
        error: "A completed image purchase is required"
      });
    }

    const imageId = session.metadata?.image_id;

    if (!imageId) {
      return res.status(400).json({
        error: "No purchased image is linked to this session"
      });
    }

    const db = createClient();

    const lookup = await db
      .from("images")
      .select("id,is_unlocked,stripe_session_id")
      .eq("id", imageId)
      .maybeSingle();

    if (lookup.error) throw lookup.error;

    if (
      !lookup.data ||
      !lookup.data.is_unlocked ||
      lookup.data.stripe_session_id !== session.id
    ) {
      return res.status(403).json({
        error: "Image unlock has not been confirmed yet"
      });
    }

    const update = await db
      .from("images")
      .update({ is_public: share })
      .eq("id", imageId)
      .eq("stripe_session_id", session.id)
      .eq("is_unlocked", true)
      .select("id,is_public")
      .single();

    if (update.error) throw update.error;

    return res.status(200).json({
      ok: true,
      imageId,
      shared: update.data.is_public
    });

  } catch (error) {
    console.error("GALLERY PUBLISH ERROR:", error);
    return res.status(500).json({
      error: "Unable to update gallery preference"
    });
  }
}
