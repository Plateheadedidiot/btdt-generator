
import Stripe from "stripe";
import { createClient } from "../lib/supabase.js";

export const config = {
  api: { bodyParser: false }
};

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

function reply(res, status, data) {
  return res.status(status).json(data);
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

function normalEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function asId(value) {
  if (!value) return null;
  return typeof value === "string"
    ? value
    : value.id || null;
}

function timestampToDate(seconds) {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

function checkDatabase(result, action) {
  if (result.error) {
    throw new Error(
      `${action}: ${result.error.message}`
    );
  }
  return result.data;
}

async function lookupCustomerEmail(customerId) {
  if (!customerId) return "";

  const customer = await stripe.customers.retrieve(
    customerId
  );

  if (customer.deleted) return "";

  return normalEmail(customer.email);
}

async function syncSubscription(
  db,
  subscriptionId,
  preferredEmail = ""
) {
  const subscription = await stripe.subscriptions.retrieve(
    subscriptionId
  );

  const customerId = asId(subscription.customer);

  let email = normalEmail(preferredEmail);

  // Prefer the customer email registered in Stripe.
  const customerEmail = await lookupCustomerEmail(customerId);

  if (customerEmail) {
    email = customerEmail;
  }

  // Recover an existing subscriber email when needed.
  if (!email) {
    const existing = await db
      .from("subscribers")
      .select("email")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    checkDatabase(existing, "Find subscriber");

    email = normalEmail(existing.data?.email);
  }

  if (!email) {
    throw new Error(
      `No customer email for subscription ${subscriptionId}`
    );
  }

  // Recent Stripe API versions store billing period
  // information on subscription items.
  const item = subscription.items?.data?.[0];

  const periodStart =
    item?.current_period_start ||
    subscription.current_period_start ||
    null;

  const periodEnd =
    item?.current_period_end ||
    subscription.current_period_end ||
    null;

  const status = subscription.status;

  const data = {
    email,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    status,
    period_start: timestampToDate(periodStart),
    period_end: timestampToDate(periodEnd),
    generations_limit: 150
  };

  const result = await db
    .from("subscribers")
    .upsert(data, {
      onConflict: "email"
    });

  checkDatabase(result, "Save subscription");

  console.log("SUBSCRIPTION SYNCED", {
    subscriptionId,
    status
  });
}

async function completeUnlock(db, session) {
  if (session.payment_status !== "paid") {
    // Delayed payment methods aren't fulfilled yet.
    return;
  }

  const imageId = session.metadata?.image_id;

  const email = normalEmail(
    session.customer_details?.email ||
    session.customer_email ||
    session.metadata?.email
  );

  if (!imageId || !email) {
    throw new Error(
      `Checkout ${session.id} missing image_id or email`
    );
  }

  // Verify the image exists before granting an unlock.
  const lookup = await db
    .from("images")
    .select("id,email,is_unlocked,stripe_session_id")
    .eq("id", imageId)
    .maybeSingle();

  checkDatabase(lookup, "Find purchased image");

  const image = lookup.data;

  if (!image) {
    throw new Error(
      `Image ${imageId} does not exist`
    );
  }

  if (
    image.email &&
    normalEmail(image.email) !== email
  ) {
    throw new Error(
      "Image owner does not match checkout email"
    );
  }

  // Repeated Stripe events should not alter
  // an image unlocked by a different session.
  if (
    image.is_unlocked &&
    image.stripe_session_id &&
    image.stripe_session_id !== session.id
  ) {
    throw new Error(
      "Image already unlocked through another session"
    );
  }

  const update = await db
    .from("images")
    .update({
      email,
      is_unlocked: true,
      stripe_session_id: session.id
    })
    .eq("id", imageId);

  checkDatabase(update, "Unlock purchased image");

  const checkout = await db
    .from("checkout_sessions")
    .upsert({
      stripe_session_id: session.id,
      email,
      image_id: imageId,
      mode: "unlock",
      completed: true
    }, {
      onConflict: "stripe_session_id"
    });

  checkDatabase(checkout, "Record unlock checkout");

  console.log("IMAGE UNLOCKED", {
    imageId,
    sessionId: session.id
  });
}

async function completeSubscriptionCheckout(
  db,
  session
) {
  const subscriptionId = asId(session.subscription);

  if (!subscriptionId) {
    throw new Error(
      `Checkout ${session.id} missing subscription`
    );
  }

  const email = normalEmail(
    session.customer_details?.email ||
    session.customer_email ||
    session.metadata?.email
  );

  await syncSubscription(
    db,
    subscriptionId,
    email
  );

  const result = await db
    .from("checkout_sessions")
    .upsert({
      stripe_session_id: session.id,
      email,
      mode: "subscription",
      completed: true
    }, {
      onConflict: "stripe_session_id"
    });

  checkDatabase(result, "Record subscription checkout");
}

async function processCheckout(db, session) {
  // Retrieve the latest Stripe state instead of relying
  // entirely on an event that may arrive out of order.
  const latest = await stripe.checkout.sessions.retrieve(
    session.id
  );

  if (latest.mode === "payment") {
    await completeUnlock(db, latest);
    return;
  }

  if (latest.mode === "subscription") {
    await completeSubscriptionCheckout(db, latest);
  }
}

async function processInvoice(db, invoice) {
  // Stripe API versions differ in the location of
  // the subscription reference.
  const subscriptionId = asId(
    invoice.subscription ||
    invoice.parent?.subscription_details?.subscription
  );

  if (!subscriptionId) return;

  await syncSubscription(
    db,
    subscriptionId
  );
}

async function processSubscriptionEvent(
  db,
  subscription
) {
  await syncSubscription(
    db,
    subscription.id
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return reply(res, 405, {
      error: "Method not allowed"
    });
  }

  if (!stripe) {
    return reply(res, 503, {
      error: "Stripe secret key is not configured"
    });
  }

  const webhookSecret =
    process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return reply(res, 503, {
      error: "Stripe webhook secret is not configured"
    });
  }

  const signature = req.headers["stripe-signature"];

  if (!signature) {
    return reply(res, 400, {
      error: "Missing Stripe signature"
    });
  }

  let event;

  // Verify the original unmodified request body.
  try {
    const rawBody = await readRawBody(req);

    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret
    );
  } catch (error) {
    console.error(
      "Webhook signature verification failed:",
      error.message
    );

    return reply(res, 400, {
      error: "Invalid Stripe webhook signature"
    });
  }

  try {
    if (
      !process.env.SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      throw new Error(
        "Supabase environment variables are missing"
      );
    }

    const db = createClient();

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        await processCheckout(
          db,
          event.data.object
        );
        break;
      }

      case "invoice.paid":
      case "invoice.payment_succeeded": {
        await processInvoice(
          db,
          event.data.object
        );
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await processSubscriptionEvent(
          db,
          event.data.object
        );
        break;
      }

      default:
        // No action required for other event types.
        break;
    }

    return reply(res, 200, {
      received: true
    });
  } catch (error) {
    console.error("WEBHOOK PROCESSING ERROR", {
      eventId: event.id,
      eventType: event.type,
      error: error.message
    });

    // A non-2xx response permits Stripe to retry.
    return reply(res, 500, {
      error: "Unable to process Stripe event"
    });
  }
}
