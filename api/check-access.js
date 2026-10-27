import { createClient } from "../lib/supabase.js";
import { getAuthenticatedUser } from "../lib/auth.js";
import {
  handleOptions,
  setCors,
  jsonError
} from "./_cors.js";

function reply(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  setCors(res);

  if (req.method !== "POST") {
    return jsonError(
      res, 405, "Method not allowed."
    );
  }

  try {
    // Verify the customer's Supabase login.
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return reply(res, 401, {
        ok: false,
        error: "Please sign in to check your membership."
      });
    }

    const db = createClient();

    // Only retrieve membership records explicitly
    // associated with this authenticated account.
    const result = await db
      .from("subscribers")
      .select(
        "status,period_end,generations_used,generations_limit"
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (result.error) {
      throw result.error;
    }

    const subscription = result.data;

    const activeStatus = [
      "active",
      "trialing"
    ].includes(subscription?.status);

    const withinPeriod = Boolean(
      subscription?.period_end &&
      new Date(subscription.period_end).getTime() >
        Date.now()
    );

    const hasActiveSubscription =
      activeStatus && withinPeriod;

    const generationsUsed =
      subscription?.generations_used ?? 0;

    const generationsLimit =
      subscription?.generations_limit ?? 150;

    return reply(res, 200, {
      ok: true,
      userId: user.id,
      hasActiveSubscription,
      subscriptionActive: hasActiveSubscription,
      hasAccess: hasActiveSubscription,
      hasUnlockAccess: false,
      generationsUsed,
      generationsLimit,
      generationsRemaining: hasActiveSubscription
        ? Math.max(
            0,
            generationsLimit - generationsUsed
          )
        : 0
    });

  } catch (error) {
    console.error("CHECK ACCESS ERROR:", error);

    return reply(res, 500, {
      ok: false,
      error: "Unable to check membership."
    });
  }
}

