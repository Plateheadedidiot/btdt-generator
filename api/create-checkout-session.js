import Stripe from "stripe";
import { createClient } from "../lib/supabase.js";
import { getAuthenticatedUser } from "../lib/auth.js";
import {
  handleOptions,
  setCors,
  jsonError
} from "./_cors.js";

// VERIFIED LIVE STRIPE PRICES
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
  return String(value ?? "").trim();
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
  // Allow authenticated browser requests.
  // This endpoint returns no private data
  // unless the Supabase token is verified.
  setCors(res);
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return jsonError(
      res, 405, "Method not allowed."
    );
  }

  // Require login BEFORE creating a live
  // payment session.
  try {
    const user = await getAuthenticatedUser(req);

    if (!user || !validEmail(user.email)) {
      return jsonError(
        res,
        401,
        "Please sign in before purchasing."
      );
    }

    if (!stripe) {
      return jsonError(
        res, 503, "STRIPE_SECRET_KEY is missing."
      );
    }

    if (
      !process.env.STRIPE_SECRET_KEY.startsWith(
        "sk_live_"
      )
    ) {
      return jsonError(
        res,
        503,
        "A live Stripe secret key is required."
      );
    }

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

    if (!["unlock", "subscription"].includes(mode)) {
      return jsonError(
        res,
        400,
        "Invalid checkout mode."
      );
    }

    // Use ONLY the authenticated email.
    // Ignore email and user_id supplied
    // by the browser.
    const email = clean(user.email).toLowerCase();

    const imageId = clean(
      body.imageId || body.image_id
    );

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
        .select("id,user_id,is_unlocked")
        .eq("id", imageId)
        .maybeSingle();

      if (lookup.error) {
        console.error(
          "IMAGE LOOKUP ERROR",
          lookup.error
        );

        return jsonError(
          res,
          503,
          "Unable to verify the image."
        );
      }

      if (!lookup.data) {
        return jsonError(
          res, 404, "Image not found."
        );
      }

      if (lookup.data.is_unlocked) {
        return jsonError(
          res,
          409,
          "This image is already unlocked."
        );
      }

      // Strict account ownership:
      // unowned guest images cannot be
      // purchased via authenticated checkout
      // until securely associated with a user.
      if (lookup.data.user_id !== user.id) {
        return jsonError(
          res,
          403,
          "This image is not linked to your account."
        );
      }
    }

    // Prices are always determined server-side.
    const priceId = mode === "subscription"
      ? SUBSCRIPTION_PRICE_ID
      : UNLOCK_PRICE_ID;

    const metadata = {
      source: "btdt-generator",
      purchase_mode: mode,
      email,
      image_id: mode === "unlock"
        ? imageId
        : "",
      user_id: user.id
    };

    const session =
      await stripe.checkout.sessions.create({
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

        success_url:
          `${APP_URL}/generator.html?success=true&session_id={CHECKOUT_SESSION_ID}`,

        cancel_url:
          `${APP_URL}/generator.html?checkout=cancelled`,

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
      mode,
      accountLinked: true
    });

  } catch (error) {
    console.error(
      "CREATE CHECKOUT SESSION ERROR:",
      error
    );

    return jsonError(
      res,
      500,
      "Unable to create a checkout session."
    );
  }
}
