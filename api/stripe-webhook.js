import Stripe from 'stripe';
import { setCors, jsonError } from './_cors.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return jsonError(res, 405, 'Method not allowed');
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return jsonError(res, 500, 'Missing STRIPE_SECRET_KEY');
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return jsonError(res, 500, 'Missing STRIPE_WEBHOOK_SECRET');
  }

  try {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return jsonError(res, 400, 'Missing Stripe signature');
    }

    const rawBody = await readRawBody(req);
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('CHECKOUT COMPLETED', {
          email: session.customer_details?.email || session.customer_email || session.metadata?.email,
          mode: session.metadata?.purchase_mode || session.mode,
          imageId: session.metadata?.image_id || null,
          sessionId: session.id,
        });
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        console.log('SUBSCRIPTION PAYMENT SUCCEEDED', {
          customer: invoice.customer,
          subscription: invoice.subscription,
        });
        break;
      }
      case 'customer.subscription.deleted':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        console.log('SUBSCRIPTION CHANGED', {
          id: subscription.id,
          status: subscription.status,
          customer: subscription.customer,
        });
        break;
      }
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('STRIPE WEBHOOK ERROR:', err);
    return jsonError(res, 400, err?.message || 'Webhook error');
  }
}
