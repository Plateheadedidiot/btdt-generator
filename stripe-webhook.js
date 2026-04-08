import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false
  }
};

async function getRawBody(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function saveEntitlement(details) {
  // Replace this with your database logic later.
  // Example target fields:
  // email, plan, stripe_checkout_session_id, stripe_customer_id,
  // stripe_subscription_id, status, uses_remaining, created_at
  console.log("SAVE ENTITLEMENT:", JSON.stringify(details, null, 2));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const sig = req.headers["stripe-signature"];
  const rawBody = await getRawBody(req);

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("WEBHOOK SIGNATURE ERROR:", err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const email =
        session.customer_details?.email ||
        session.customer_email ||
        session.metadata?.email ||
        "";

      const plan = session.metadata?.plan || "";
      const subscriptionId = session.subscription || null;

      await saveEntitlement({
        source_event: "checkout.session.completed",
        email,
        plan,
        stripe_checkout_session_id: session.id,
        stripe_customer_id: session.customer || null,
        stripe_subscription_id: subscriptionId,
        payment_status: session.payment_status || null,
        status: plan === "subscription" ? "active" : "active",
        uses_remaining: plan === "subscription" ? null : 1,
        created_at: new Date().toISOString()
      });
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object;

      await saveEntitlement({
        source_event: event.type,
        email: subscription.customer_email || null,
        plan: "subscription",
        stripe_checkout_session_id: null,
        stripe_customer_id: subscription.customer || null,
        stripe_subscription_id: subscription.id,
        payment_status: null,
        status: subscription.status || null,
        uses_remaining: null,
        updated_at: new Date().toISOString()
      });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("WEBHOOK HANDLER ERROR:", err);
    return res.status(500).send(err?.message || "Webhook handler failed");
  }
}