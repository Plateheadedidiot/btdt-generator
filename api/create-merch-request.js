import { createClient } from "../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { image_id, email, product_type } = body;
    if (!image_id || !email || !product_type) return res.status(400).json({ error: "image_id, email, product_type required" });

    const supabase = createClient();
    await supabase.from("merch_requests").insert({
      image_id,
      email: String(email).trim().toLowerCase(),
      product_type
    });

    return res.status(200).json({ ok: true, message: "Merch request saved. Connect Printful next." });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Merch request failed" });
  }
}
