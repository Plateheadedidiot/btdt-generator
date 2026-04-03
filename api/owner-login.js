export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email, password } = req.body || {};
    const ownerEmail = process.env.OWNER_EMAIL || "";
    const ownerPassword = process.env.OWNER_PASSWORD || "";

    if (!ownerEmail || !ownerPassword) {
      return res.status(500).json({ error: "Owner access is not configured on the server." });
    }

    if (String(email || "").trim().toLowerCase() !== ownerEmail.trim().toLowerCase()) {
      return res.status(401).json({ error: "Owner email not recognized." });
    }

    if (String(password || "") !== ownerPassword) {
      return res.status(401).json({ error: "Incorrect owner password." });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Owner login failed." });
  }
}