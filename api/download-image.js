import { createClient } from "../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { image_id, email } = req.query || {};
    if (!image_id || !email) return res.status(400).json({ error: "image_id and email required" });

    const cleanEmail = String(email).trim().toLowerCase();
    const supabase = createClient();

    const { data: image } = await supabase
      .from("images")
      .select("image_b64,is_unlocked,email")
      .eq("id", image_id)
      .maybeSingle();

    if (!image) return res.status(404).json({ error: "Image not found" });

    const { data: sub } = await supabase
      .from("subscribers")
      .select("status,period_end")
      .eq("email", cleanEmail)
      .maybeSingle();

    const subActive = !!sub && sub.status === "active" && sub.period_end && new Date(sub.period_end) > new Date();
    const allowed = (image.is_unlocked && image.email === cleanEmail) || subActive;

    if (!allowed) return res.status(403).json({ error: "Image not unlocked for this email" });

    return res.status(200).json({ image_b64: image.image_b64 });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Download failed" });
  }
}
