import Stripe from "stripe";
import { createClient } from "../lib/supabase.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const sig = req.headers["stripe-signature"];
    const rawBody = await readRawBody(req);
    const event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    const supabase = createClient();

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const mode = session.metadata?.mode;
      const image_id = session.metadata?.image_id || null;
      const email = (session.metadata?.email || session.customer_details?.email || "").toLowerCase();

      if (mode === "unlock" && image_id && email) {
        await supabase
          .from("images")
          .update({ is_unlocked: true, stripe_session_id: session.id, email })
          .eq("id", image_id);
      }

      if (mode === "subscribe" && email) {
        let subscriptionId = session.subscription || null;
        let periodEnd = null;
        let status = "active";

        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
          status = sub.status || "active";
        }

        await supabase
          .from("subscribers")
          .upsert({
            email,
            stripe_customer_id: session.customer || null,
            stripe_subscription_id: subscriptionId,
            status,
            generations_used: 0,
            generations_limit: 150,
            period_start: new Date().toISOString(),
            period_end: periodEnd
          }, { onConflict: "email" });
      }

      if (mode === "hd_export" && image_id && email) {
        await supabase.from("images").update({ hd_export_paid: true, email }).eq("id", image_id);
      }

      if (mode === "print_ready" && image_id && email) {
        await supabase.from("images").update({ print_ready_paid: true, email }).eq("id", image_id);
      }

      await supabase
        .from("checkout_sessions")
        .update({ completed: true })
        .eq("stripe_session_id", session.id);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(400).json({ error: err?.message || "Webhook error" });
  }
}
