import { createClient } from "../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { image_id, email } = req.query || {};
    if (!image_id) return res.status(400).json({ error: "image_id required" });

    const cleanEmail = String(email || "").trim().toLowerCase();
    const supabase = createClient();

    const { data: image } = await supabase
      .from("images")
      .select("id,is_unlocked,email")
      .eq("id", image_id)
      .maybeSingle();

    const { data: sub } = await supabase
      .from("subscribers")
      .select("status,period_end,generations_used,generations_limit")
      .eq("email", cleanEmail)
      .maybeSingle();

    const subActive = !!sub && sub.status === "active" && sub.period_end && new Date(sub.period_end) > new Date();

    return res.status(200).json({
      unlocked: !!image?.is_unlocked && (!cleanEmail || image?.email === cleanEmail),
      subscription_active: subActive
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Status check failed" });
  }
}
