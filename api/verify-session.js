import Stripe from "stripe";
import { createClient } from "../lib/supabase.js";
import { getAuthenticatedUser } from "../lib/auth.js";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

function send(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export default async function handler(req, res) {
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader(
    "Access-Control-Allow-Origin",
    process.env.PUBLIC_APP_URL ||
      "https://beentheredonetat.com"
  );
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return send(res, 405, {
      error: "Method not allowed."
    });
  }

  if (!stripe) {
    return send(res, 503, {
      error: "Stripe is not configured."
    });
  }

  try {
    const user = await getAuthenticatedUser(req);

    if (!user || !user.email) {
      return send(res, 401, {
        error: "Please sign in to verify your purchase."
      });
    }

    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body || {};

    const sessionId = String(
      body.sessionId || body.session_id || ""
    ).trim();

    if (!/^cs_live_[A-Za-z0-9]+$/.test(sessionId)) {
      return send(res, 400, {
        error: "Invalid live checkout session ID."
      });
    }

    const session =
      await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["subscription"]
      });

    if (!session.livemode) {
      return send(res, 403, {
        error: "Not a live checkout session."
      });
    }

    const sessionEmail = normalizeEmail(
      session.customer_details?.email ||
      session.customer_email ||
      session.metadata?.email
    );

    if (
      !sessionEmail ||
      normalizeEmail(user.email) !== sessionEmail
    ) {
      return send(res, 403, {
        error: "This purchase belongs to another account."
      });
    }

    const db = createClient();

    const lookup = await db
      .from("checkout_sessions")
      .select("completed,image_id,mode,user_id")
      .eq("stripe_session_id", session.id)
      .maybeSingle();

    if (lookup.error) {
      throw lookup.error;
    }

    // Only report access that the webhook has
    // successfully recorded in our database.
    const completed = lookup.data?.completed === true;

    if (
      lookup.data?.user_id &&
      lookup.data.user_id !== user.id
    ) {
      return send(res, 403, {
        error: "This purchase belongs to another account."
      });
    }

    const isUnlock = session.mode === "payment";

    let unlockGranted = false;
    let subscriptionActive = false;

    if (isUnlock && completed) {
      const imageId = session.metadata?.image_id;

      if (imageId) {
        const image = await db
          .from("images")
          .select("is_unlocked,stripe_session_id,user_id")
          .eq("id", imageId)
          .maybeSingle();

        if (image.error) throw image.error;

        unlockGranted = Boolean(
          image.data?.is_unlocked &&
          image.data?.stripe_session_id === session.id &&
          (!image.data.user_id ||
            image.data.user_id === user.id)
        );
      }
    }

    if (!isUnlock && completed) {
      const subscription = session.subscription;

      const subscriptionId =
        typeof subscription === "string"
          ? subscription
          : subscription?.id;

      const currentSubscription =
        typeof subscription === "string"
          ? await stripe.subscriptions.retrieve(subscription)
          : subscription;

      if (subscriptionId && currentSubscription) {
        subscriptionActive = Boolean(
          ["active", "trialing"].includes(
            currentSubscription.status
          )
        );
      }
    }

    return send(res, 200, {
      ok: true,
      paid: session.payment_status === "paid",
      mode: session.mode,
      imageId:
        session.metadata?.image_id || null,
      unlockGranted,
      subscriptionActive,
      fulfillmentRecorded: completed,
      userId: user.id
    });

  } catch (error) {
    console.error("VERIFY SESSION ERROR:", error);

    return send(res, 500, {
      error: "Unable to verify checkout session."
    });
  }
}

