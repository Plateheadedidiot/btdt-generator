import { createClient } from "../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { image_id, email } = body;
    if (!image_id || !email) return res.status(400).json({ error: "image_id and email required" });

    const cleanEmail = String(email).trim().toLowerCase();
    const supabase = createClient();

    const { data: image } = await supabase
      .from("images")
      .select("is_unlocked,email")
      .eq("id", image_id)
      .maybeSingle();

    if (!image) return res.status(404).json({ error: "Image not found" });
    if (!(image.is_unlocked && image.email === cleanEmail)) {
      return res.status(403).json({ error: "Image must be unlocked before publishing" });
    }

    await supabase.from("images").update({ is_public: true }).eq("id", image_id);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Gallery publish failed" });
  }
}
