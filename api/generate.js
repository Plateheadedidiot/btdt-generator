import { createClient } from "../lib/supabase.js";

async function generateImageB64(prompt) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024"
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || data?.error || "OpenAI image generation failed";
    throw new Error(message);
  }
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("No base64 image returned by image API.");
  return b64;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { prompt, email } = body;

    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: "Prompt required" });
    if (!email || !String(email).trim()) return res.status(400).json({ error: "Email required" });

    const supabase = createClient();
    const cleanEmail = String(email).trim().toLowerCase();

    const { data: sub } = await supabase
      .from("subscribers")
      .select("status,generations_used,generations_limit,period_end")
      .eq("email", cleanEmail)
      .maybeSingle();

    const now = new Date();
    const subActive = !!sub && sub.status === "active" && sub.period_end && new Date(sub.period_end) > now;
    const canUseSub = subActive && (sub.generations_used || 0) < (sub.generations_limit || 150);

    const image_b64 = await generateImageB64(String(prompt).trim());

    const { data: inserted, error } = await supabase
      .from("images")
      .insert({
        email: cleanEmail,
        prompt: String(prompt).trim(),
        image_b64,
        preview_b64: image_b64,
        is_unlocked: canUseSub,
        is_public: false
      })
      .select("id,is_unlocked")
      .single();

    if (error) throw error;

    if (canUseSub) {
      await supabase
        .from("subscribers")
        .update({ generations_used: (sub.generations_used || 0) + 1 })
        .eq("email", cleanEmail);
    }

    return res.status(200).json({
      image_id: inserted.id,
      preview_b64: image_b64,
      unlocked: inserted.is_unlocked,
      subscription_active: canUseSub
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
