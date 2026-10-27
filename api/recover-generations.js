
import { createClient } from "../lib/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed."
    });
  }

  // Vercel will send CRON_SECRET in a Bearer token.
  // Never accept a missing or unconfigured secret.
  const secret = process.env.CRON_SECRET;

  if (!secret || secret.length < 16) {
    console.error("CRON_SECRET is not configured.");

    return res.status(503).json({
      error: "Recovery service is not configured."
    });
  }

  const authorization = req.headers.authorization;

  if (authorization !== `Bearer ${secret}`) {
    return res.status(401).json({
      error: "Unauthorized."
    });
  }

  try {
    if (
      !process.env.SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      throw new Error(
        "Supabase configuration is missing."
      );
    }

    const db = createClient();

    const { data, error } = await db.rpc(
      "recover_generations"
    );

    if (error) {
      throw error;
    }

    console.log("GENERATION RECOVERY COMPLETE", {
      completed: data?.completed ?? 0,
      refunded: data?.refunded ?? 0
    });

    return res.status(200).json({
      ok: true,
      completed: data?.completed ?? 0,
      refunded: data?.refunded ?? 0
    });

  } catch (error) {
    console.error(
      "GENERATION RECOVERY ERROR:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Generation recovery failed."
    });
  }
}
