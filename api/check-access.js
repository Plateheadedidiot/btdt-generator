import Stripe from 'stripe';
import { handleOptions, setCors, jsonError } from './_cors.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

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
    const { email } = req.body || {};
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return jsonError(res, 400, 'Valid email is required');
    }

    const customers = await stripe.customers.list({ email: normalizedEmail, limit: 10 });
    const customerIds = customers.data.map((c) => c.id);

    let hasActiveSubscription = false;

    for (const customerId of customerIds) {
      const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
      if (subscriptions.data.some((sub) => ['active', 'trialing'].includes(sub.status))) {
        hasActiveSubscription = true;
        break;
      }
    }

    return res.status(200).json({
      ok: true,
      email: normalizedEmail,
      hasActiveSubscription,
      hasUnlockAccess: false,
      note: 'Subscription status is durable. One-time unlocks should be verified with /api/verify-session right after checkout unless you later add a database.',
    });
  } catch (err) {
    console.error('CHECK ACCESS ERROR:', err);
    return jsonError(res, 500, err?.message || 'Failed to check access');
  }
}
