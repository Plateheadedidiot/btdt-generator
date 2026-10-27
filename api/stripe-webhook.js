import Stripe from "stripe";
import { createClient } from "../lib/supabase.js";

export const config = {
  api: { bodyParser: false }
};

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function send(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

function emailOf(value) {
  return String(value || "").trim().toLowerCase();
}

function idOf(value) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id || null;
}

function dateOf(seconds) {
  return seconds
    ? new Date(seconds * 1000).toISOString()
    : null;
}

function checked(result, description) {
  if (result.error) {
    throw new Error(
      `${description}: ${result.error.message}`
    );
  }

  return result.data;
}

function getDatabase() {
  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error("Supabase is not configured.");
  }

  return createClient();
}

async function readRawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)
    );
  }

  return Buffer.concat(chunks);
}

// Verify account IDs carried in Stripe metadata.
// Never accept an arbitrary user_id without
// confirming that the Supabase account exists
// and its email matches the Stripe customer.
async function verifiedUserId(db, proposedId, email) {
  if (!proposedId || !UUID.test(proposedId)) {
    return null;
  }

  if (!email) {
    return null;
  }

  const result = await db.auth.admin.getUserById(
    proposedId
  );

  if (result.error || !result.data?.user) {
    throw new Error(
      "Unable to verify the checkout account."
    );
  }

  const user = result.data.user;

  if (emailOf(user.email) !== emailOf(email)) {
    throw new Error(
      "Stripe email does not match the account."
    );
  }

  return user.id;
}

async function customerEmail(customerId) {
  if (!customerId) return "";

  const customer = await stripe.customers.retrieve(
    customerId
  );

  if (customer.deleted) {
    return "";
  }

  return emailOf(customer.email);
}

async function saveCheckout(db, values) {
  const result = await db
    .from("checkout_sessions")
    .upsert(values, {
      onConflict: "stripe_session_id"
    });

  checked(result, "Save checkout");
}

async function syncSubscription(
  db,
  subscriptionId,
  preferredEmail = "",
  sessionUserId = null
) {
  if (!subscriptionId) {
    throw new Error("Missing subscription ID.");
  }

  const subscription =
    await stripe.subscriptions.retrieve(
      subscriptionId
    );

  const customerId = idOf(subscription.customer);

  const email =
    await customerEmail(customerId) ||
    emailOf(preferredEmail);

  if (!email) {
    throw new Error(
      `Missing customer email: ${subscriptionId}`
    );
  }

  // Find the original verified checkout account
  // when Stripe sends a later renewal or update.
  let candidateUserId =
    subscription.metadata?.user_id ||
    sessionUserId ||
    null;

  const existing = await db
    .from("subscribers")
    .select(
      "user_id,stripe_subscription_id,generations_used"
    )
    .eq("email", email)
    .maybeSingle();

  const previous = checked(
    existing,
    "Find existing subscriber"
  );

  if (!candidateUserId && previous?.user_id) {
    candidateUserId = previous.user_id;
  }

  const userId = await verifiedUserId(
    db,
    candidateUserId,
    email
  );

  if (
    previous?.user_id &&
    userId &&
    previous.user_id !== userId
  ) {
    throw new Error(
      "Subscription account ownership conflict."
    );
  }

  const item = subscription.items?.data?.[0];

  const periodStart =
    item?.current_period_start ||
    subscription.current_period_start ||
    null;

  const periodEnd =
    item?.current_period_end ||
    subscription.current_period_end ||
    null;

  const data = {
    email,
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    period_start: dateOf(periodStart),
    period_end: dateOf(periodEnd),
    generations_limit: 150
  };

  checked(
    await db
      .from("subscribers")
      .upsert(data, {
        onConflict: "email"
      }),
    "Save subscription"
  );

  console.log("SUBSCRIPTION SYNCED", {
    subscriptionId,
    status: subscription.status,
    accountLinked: Boolean(userId)
  });

  return { email, userId };
}

async function fulfillUnlock(db, session) {
  if (session.payment_status !== "paid") {
    // Do not unlock an unpaid checkout.
    return;
  }

  if (
    session.metadata?.source !== "btdt-generator" ||
    session.metadata?.purchase_mode !== "unlock"
  ) {
    throw new Error(
      "Unexpected image checkout metadata."
    );
  }

  const imageId = session.metadata?.image_id;

  if (!imageId || !UUID.test(imageId)) {
    throw new Error(
      "Checkout is missing a valid image ID."
    );
  }

  const email = emailOf(
    session.customer_details?.email ||
    session.customer_email ||
    session.metadata?.email
  );

  if (!email) {
    throw new Error("Missing checkout email.");
  }

  const userId = await verifiedUserId(
    db,
    session.metadata?.user_id,
    email
  );

  const lookup = await db
    .from("images")
    .select(
      "id,email,user_id,is_unlocked,stripe_session_id"
    )
    .eq("id", imageId)
    .maybeSingle();

  const image = checked(
    lookup,
    "Find purchased image"
  );

  if (!image) {
    throw new Error(
      `Purchased image not found: ${imageId}`
    );
  }

  if (
    image.email &&
    emailOf(image.email) !== email
  ) {
    throw new Error(
      "Image email does not match checkout."
    );
  }

  if (userId && image.user_id !== userId) {
    throw new Error(
      "Purchased image is not owned by this account."
    );
  }

  if (image.user_id && !userId) {
    throw new Error(
      "Account-owned image requires account-linked checkout."
    );
  }

  if (
    image.stripe_session_id &&
    image.stripe_session_id !== session.id
  ) {
    throw new Error(
      "Image belongs to a different checkout session."
    );
  }

  // Save the checkout record before the image unlock.
  // Repeated events use the same Stripe session ID.
  const previous = checked(
    await db
      .from("checkout_sessions")
      .select("user_id,image_id")
      .eq("stripe_session_id", session.id)
      .maybeSingle(),
    "Find previous checkout"
  );

  if (
    previous &&
    (
      (previous.user_id &&
        previous.user_id !== userId) ||
      (previous.image_id &&
        previous.image_id !== imageId)
    )
  ) {
    throw new Error(
      "Checkout ownership conflict."
    );
  }

  await saveCheckout(db, {
    stripe_session_id: session.id,
    email,
    user_id: userId,
    image_id: imageId,
    mode: "unlock",
    completed: false
  });

  const updated = await db
    .from("images")
    .update({
      email,
      user_id: userId,
      is_unlocked: true,
      stripe_session_id: session.id
    })
    .eq("id", imageId)
    .select("id")
    .single();

  checked(updated, "Unlock image");

  await saveCheckout(db, {
    stripe_session_id: session.id,
    email,
    user_id: userId,
    image_id: imageId,
    mode: "unlock",
    completed: true
  });

  console.log("IMAGE PURCHASE FULFILLED", {
    imageId,
    sessionId: session.id,
    accountLinked: Boolean(userId)
  });
}

async function fulfillSubscription(db, session) {
  const subscriptionId =
    idOf(session.subscription);

  if (!subscriptionId) {
    throw new Error(
      "Checkout is missing subscription ID."
    );
  }

  const email = emailOf(
    session.customer_details?.email ||
    session.customer_email ||
    session.metadata?.email
  );

  const verified = await syncSubscription(
    db,
    subscriptionId,
    email,
    session.metadata?.user_id || null
  );

  const previous = checked(
    await db
      .from("checkout_sessions")
      .select("user_id")
      .eq("stripe_session_id", session.id)
      .maybeSingle(),
    "Find subscription checkout"
  );

  if (
    previous?.user_id &&
    previous.user_id !== verified.userId
  ) {
    throw new Error(
      "Subscription checkout ownership conflict."
    );
  }

  await saveCheckout(db, {
    stripe_session_id: session.id,
    email: verified.email,
    user_id: verified.userId,
    mode: "subscription",
    completed: true
  });

  console.log("SUBSCRIPTION CHECKOUT RECORDED", {
    sessionId: session.id,
    accountLinked: Boolean(verified.userId)
  });
}

async function handleCheckout(db, eventSession) {
  // Always get current Stripe state.
  const session =
    await stripe.checkout.sessions.retrieve(
      eventSession.id
    );

  if (!session.livemode) {
    throw new Error("Unexpected test checkout.");
  }

  if (session.mode === "payment") {
    await fulfillUnlock(db, session);
    return;
  }

  if (session.mode === "subscription") {
    await fulfillSubscription(db, session);
  }
}

async function handleInvoice(db, invoice) {
  const subscriptionId = idOf(
    invoice.subscription ||
    invoice.parent?.subscription_details?.subscription
  );

  if (!subscriptionId) return;

  await syncSubscription(db, subscriptionId);
}

async function handleSubscription(db, eventSubscription) {
  await syncSubscription(
    db,
    eventSubscription.id
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return send(res, 405, {
      error: "Method not allowed."
    });
  }

  if (!stripe) {
    return send(res, 503, {
      error: "Stripe is not configured."
    });
  }

  const secret =
    process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    return send(res, 503, {
      error: "Stripe webhook signing secret is missing."
    });
  }

  const signature =
    req.headers["stripe-signature"];

  if (!signature) {
    return send(res, 400, {
      error: "Missing Stripe signature."
    });
  }

  let event;

  try {
    const raw = await readRawBody(req);

    // Stripe verifies the original request payload.
    event = stripe.webhooks.constructEvent(
      raw,
      signature,
      secret
    );
  } catch (err) {
    console.error(
      "WEBHOOK SIGNATURE ERROR:",
      err.message
    );

    return send(res, 400, {
      error: "Invalid webhook signature."
    });
  }

  try {
    const db = getDatabase();

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckout(db, event.data.object);
        break;

      case "invoice.paid":
      case "invoice.payment_succeeded":
        await handleInvoice(db, event.data.object);
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscription(
          db,
          event.data.object
        );
        break;

      default:
        break;
    }

    return send(res, 200, {
      received: true
    });
  } catch (err) {
    console.error("WEBHOOK PROCESSING ERROR", {
      eventId: event.id,
      type: event.type,
      message: err.message
    });

    // Stripe can retry events that were not processed.
    return send(res, 500, {
      error: "Webhook processing failed."
    });
  }
}
