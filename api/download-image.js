import { createClient } from "../lib/supabase.js";
import { getAuthenticatedUser } from "../lib/auth.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function send(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return send(res, 405, {
      error: "Method not allowed."
    });
  }

  try {
    // Require a real Supabase login token.
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return send(res, 401, {
        error: "Please sign in to download your tattoo."
      });
    }

    const imageId = String(
      req.query?.image_id || req.query?.imageId || ""
    ).trim();

    if (!UUID_PATTERN.test(imageId)) {
      return send(res, 400, {
        error: "A valid image ID is required."
      });
    }

    const db = createClient();

    // Never authorize downloads by an email
    // or user ID supplied in the request.
    const lookup = await db
      .from("images")
      .select(
        "id,user_id,image_b64,is_unlocked,stripe_session_id"
      )
      .eq("id", imageId)
      .maybeSingle();

    if (lookup.error) {
      throw lookup.error;
    }

    const image = lookup.data;

    if (!image) {
      return send(res, 404, {
        error: "Image not found."
      });
    }

    // Require an explicit account owner.
    // Legacy images with null user_id must be
    // linked to their owner through a verified
    // purchase migration, not an email guess.
    if (!image.user_id || image.user_id !== user.id) {
      return send(res, 403, {
        error: "You do not have access to this image."
      });
    }

    // Paid images must have a confirmed unlock.
    // A server-side webhook records this status.
    if (
      image.is_unlocked !== true ||
      !image.stripe_session_id
    ) {
      return send(res, 403, {
        error: "This image has not been unlocked."
      });
    }

    // Verify the matching checkout was recorded.
    const purchase = await db
      .from("checkout_sessions")
      .select("completed,image_id,mode,user_id")
      .eq("stripe_session_id", image.stripe_session_id)
      .maybeSingle();

    if (purchase.error) {
      throw purchase.error;
    }

    if (
      !purchase.data ||
      purchase.data.completed !== true ||
      purchase.data.mode !== "unlock" ||
      purchase.data.image_id !== image.id ||
      (
        purchase.data.user_id &&
        purchase.data.user_id !== user.id
      )
    ) {
      return send(res, 403, {
        error: "A confirmed purchase is required."
      });
    }

    // Return the purchased image only after
    // every authorization check has succeeded.
    return send(res, 200, {
      ok: true,
      imageId: image.id,
      image_b64: image.image_b64
    });

  } catch (error) {
    console.error("DOWNLOAD IMAGE ERROR:", error);

    return send(res, 500, {
      error: "Unable to retrieve image."
    });
  }
}

