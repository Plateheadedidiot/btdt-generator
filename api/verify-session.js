import Stripe from 'stripe';
import { handleOptions, setCors, jsonError } from './_cors.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(res);

  if (req.method !== 'POST') {
    return jsonError(res, 405, 'Method not allowed');
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return jsonError(res, 500, 'Missing STRIPE_SECRET_KEY');
  }

  try {
    const { sessionId, email } = req.body || {};

    if (!sessionId) {
      return jsonError(res, 400, 'Missing sessionId');
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'payment_intent'],
    });

    const paid = session.payment_status === 'paid';
    const mode = session.metadata?.purchase_mode || session.mode;
    const sessionEmail = session.customer_details?.email || session.customer_email || session.metadata?.email || null;

    if (email && sessionEmail && String(email).toLowerCase() !== String(sessionEmail).toLowerCase()) {
      return jsonError(res, 403, 'Email does not match this checkout session');
    }

    const subscriptionActive = Boolean(
      session.subscription &&
        ['active', 'trialing'].includes(session.subscription.status)
    );

    const unlockGranted = paid && (mode === 'unlock' || session.mode === 'payment');

    return res.status(200).json({
      ok: true,
      paid,
      email: sessionEmail,
      mode,
      imageId: session.metadata?.image_id || null,
      unlockGranted,
      subscriptionActive,
      prompt: session.metadata?.prompt || null,
    });
  } catch (err) {
    console.error('VERIFY SESSION ERROR:', err);
    return jsonError(res, 500, err?.message || 'Failed to verify checkout session');
  }
}
