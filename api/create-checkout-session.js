import Stripe from 'stripe';
import { handleOptions, setCors, jsonError } from './_cors.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

const ALLOWED_MODES = new Set(['unlock', 'subscription']);

function normalizeUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.toString();
  } catch {
    return null;
  }
}

function getSuccessUrl(body) {
  return (
    normalizeUrl(body.success_url) ||
    normalizeUrl(process.env.STRIPE_SUCCESS_URL) ||
    normalizeUrl(process.env.PUBLIC_APP_URL && `${process.env.PUBLIC_APP_URL}/generator.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`) ||
    'http://localhost:3000/generator.html?checkout=success&session_id={CHECKOUT_SESSION_ID}'
  );
}

function getCancelUrl(body) {
  return (
    normalizeUrl(body.cancel_url) ||
    normalizeUrl(process.env.STRIPE_CANCEL_URL) ||
    normalizeUrl(process.env.PUBLIC_APP_URL && `${process.env.PUBLIC_APP_URL}/generator.html?checkout=cancelled`) ||
    'http://localhost:3000/generator.html?checkout=cancelled'
  );
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
    const {
      mode,
      email,
      imageId,
      prompt,
      placement,
      style,
      unlockPriceId,
      subscriptionPriceId,
      success_url,
      cancel_url,
    } = req.body || {};

    if (!ALLOWED_MODES.has(mode)) {
      return jsonError(res, 400, 'Invalid checkout mode. Use unlock or subscription.');
    }

    if (!email || !String(email).includes('@')) {
      return jsonError(res, 400, 'Valid email is required');
    }

    const successUrl = getSuccessUrl(req.body || {});
    const cancelUrl = getCancelUrl(req.body || {});

    const unlockPrice = unlockPriceId || process.env.STRIPE_UNLOCK_PRICE_ID;
    const subscriptionPrice = subscriptionPriceId || process.env.STRIPE_SUBSCRIPTION_PRICE_ID;

    if (mode === 'unlock' && !unlockPrice) {
      return jsonError(res, 500, 'Missing STRIPE_UNLOCK_PRICE_ID');
    }

    if (mode === 'subscription' && !subscriptionPrice) {
      return jsonError(res, 500, 'Missing STRIPE_SUBSCRIPTION_PRICE_ID');
    }

    const commonMetadata = {
      source: 'btdt-generator',
      purchase_mode: mode,
      email: String(email),
      image_id: String(imageId || ''),
      prompt: String(prompt || '').slice(0, 500),
      placement: String(placement || ''),
      style: String(style || ''),
    };

    const session = await stripe.checkout.sessions.create({
      mode: mode === 'subscription' ? 'subscription' : 'payment',
      customer_email: String(email),
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      line_items: [
        {
          price: mode === 'subscription' ? subscriptionPrice : unlockPrice,
          quantity: 1,
        },
      ],
      metadata: commonMetadata,
      payment_intent_data: mode === 'unlock' ? { metadata: commonMetadata } : undefined,
      subscription_data:
        mode === 'subscription'
          ? {
              metadata: commonMetadata,
            }
          : undefined,
    });

    return res.status(200).json({
      ok: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      mode,
    });
  } catch (err) {
    console.error('STRIPE CHECKOUT ERROR:', err);
    return jsonError(res, 500, err?.message || 'Failed to create checkout session');
  }
}
