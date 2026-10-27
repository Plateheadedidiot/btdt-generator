
import Stripe from "stripe";
import { createClient } from "../lib/supabase.js";
import {
  handleOptions,
  setCors,
  jsonError
} from "./_cors.js";

// VERIFIED LIVE STRIPE PRICE IDS
const UNLOCK_PRICE_ID =
  "price_1TlECVBlbWKxWiyBbNY7AcBa";

const SUBSCRIPTION_PRICE_ID =
  "price_1TlECxBlbWKxWiyBCCA1fpjY";

const APP_URL = (
  process.env.PUBLIC_APP_URL ||
  process.env.APP_URL ||
  "https://beentheredonetat.com"
).replace(/\/$/, "");

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value) {
  return String(value || "").trim();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getDatabase() {
  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Supabase environment variables are missing."
    );
  }

  return createClient();
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  setCors(res);
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return jsonError(
      res,
      405,
      "Method not allowed."
    );
  }

  if (!stripe) {
    return jsonError(
      res,
      503,
      "STRIPE_SECRET_KEY is missing in Vercel."
    );
  }

  if (
    !process.env.STRIPE_SECRET_KEY.startsWith("sk_live_")
  ) {
    return jsonError(
      res,
      503,
      "A live Stripe secret key is required."
    );
  }

  try {
    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body || {};

    const requestedMode = clean(
      body.mode || body.checkoutMode
    ).toLowerCase();

    const mode =
      requestedMode === "payment"
        ? "unlock"
        : requestedMode === "subscribe"
          ? "subscription"
          : requestedMode;

    if (
      mode !== "unlock" &&
      mode !== "subscription"
    ) {
      return jsonError(
        res,
        400,
        "Invalid mode. Use unlock or subscription."
      );
    }

    const email = clean(body.email).toLowerCase();

    if (!validEmail(email)) {
      return jsonError(
        res,
        400,
        "A valid email is required."
      );
    }

    const imageId = clean(
      body.imageId || body.image_id
    );

    // A single-image purchase must refer to
    // a real image saved in Supabase.
    if (mode === "unlock") {
      if (!UUID_PATTERN.test(imageId)) {
        return jsonError(
          res,
          400,
          "A saved image ID is required for the $1.99 unlock."
        );
      }

      const db = getDatabase();

      const lookup = await db
        .from("images")
        .select("id,is_unlocked")
        .eq("id", imageId)
        .maybeSingle();

      if (lookup.error) {
        console.error(
          "IMAGE LOOKUP ERROR:",
          lookup.error
        );

        return jsonError(
          res,
          503,
          "Unable to verify this image."
        );
      }

      if (!lookup.data) {
        return jsonError(
          res,
          404,
          "Image not found in Supabase."
        );
      }

      if (lookup.data.is_unlocked) {
        return jsonError(
          res,
          409,
          "This image has already been unlocked."
        );
      }
    }

    // Prices are decided by the backend.
    // Browser-supplied Price IDs are ignored.
    const priceId = mode === "subscription"
      ? SUBSCRIPTION_PRICE_ID
      : UNLOCK_PRICE_ID;

    const metadata = {
      source: "btdt-generator",
      purchase_mode: mode,
      email,
      image_id: mode === "unlock"
        ? imageId
        : ""
    };

    const successUrl =
      `${APP_URL}/generator.html?success=true&session_id={CHECKOUT_SESSION_ID}`;

    const cancelUrl =
      `${APP_URL}/generator.html?checkout=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: mode === "subscription"
        ? "subscription"
        : "payment",

      customer_email: email,

      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],

      success_url: successUrl,
      cancel_url: cancelUrl,

      billing_address_collection: "auto",
      allow_promotion_codes: true,

      metadata,

      ...(mode === "unlock"
        ? {
            payment_intent_data: {
              metadata
            }
          }
        : {
            subscription_data: {
              metadata
            }
          })
    });

    if (!session?.url) {
      return jsonError(
        res,
        502,
        "Stripe did not return a checkout URL."
      );
    }

    return res.status(200).json({
      ok: true,
      url: session.url,
      checkoutUrl: session.url,
      sessionId: session.id,
      mode
    });

  } catch (err) {
    console.error(
      "CREATE CHECKOUT SESSION ERROR:",
      err
    );

    return jsonError(
      res,
      500,
      "Unable to create checkout session."
    );
  }
}
