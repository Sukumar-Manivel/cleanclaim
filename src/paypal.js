// Thin PayPal REST client: OAuth token cache + Payouts API.
// Runs in mock mode when no credentials are set, so the app works offline for demos/tests.
const BASE = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
const ID = process.env.PAYPAL_CLIENT_ID;
const SECRET = process.env.PAYPAL_CLIENT_SECRET;
export const paypalMode = () => (ID && SECRET ? (BASE.includes('sandbox') ? 'sandbox' : 'live') : 'mock');

let token = null, tokenExp = 0;
async function getToken() {
  if (token && Date.now() < tokenExp - 60_000) return token;
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${ID}:${SECRET}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`PayPal auth failed: ${j.error_description || r.status}`);
  token = j.access_token; tokenExp = Date.now() + j.expires_in * 1000; // refreshes itself (sandbox tokens last ~9h)
  return token;
}

async function api(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, { ...opts, headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = (j.details || []).map((d) => `${d.field}: ${d.issue}`).join('; ');
    throw new Error(`${j.name || r.status}: ${j.message || ''} ${detail}`.trim());
  }
  return j;
}

const mockBatches = new Map();

// items: [{ claimId, receiver, value }]. senderBatchId makes retries safe:
// PayPal rejects a reused sender_batch_id for 30 days, so a claimant is never paid twice.
export async function createPayoutBatch(senderBatchId, items, note) {
  if (paypalMode() === 'mock') {
    const id = 'MOCK' + Math.random().toString(36).slice(2, 10).toUpperCase();
    mockBatches.set(id, { items, created: Date.now() });
    return { payout_batch_id: id, batch_status: 'PENDING' };
  }
  const body = {
    sender_batch_header: { sender_batch_id: senderBatchId, email_subject: 'Your settlement payment', email_message: note },
    items: items.map((it) => ({
      recipient_type: it.recipientType || 'EMAIL', receiver: it.receiver,
      amount: { value: it.value, currency: 'USD' }, sender_item_id: it.claimId,
      note: `Settlement payment for claim ${it.claimId}`,
    })),
  };
  const j = await api('/v1/payments/payouts', { method: 'POST', body: JSON.stringify(body) });
  return j.batch_header;
}

export async function getPayoutBatch(id) {
  if (paypalMode() === 'mock') {
    const b = mockBatches.get(id);
    const done = b && Date.now() - b.created > 3000;
    return {
      batch_header: { payout_batch_id: id, batch_status: done ? 'SUCCESS' : 'PROCESSING' },
      items: (b?.items || []).map((it, i) => ({
        payout_item_id: `MI${i}`, transaction_id: done ? `MOCKTX${i}` : null,
        transaction_status: done ? (it.receiver.endsWith('@example.com') ? 'UNCLAIMED' : 'SUCCESS') : 'PENDING',
        payout_item: { receiver: it.receiver, sender_item_id: it.claimId, amount: { value: it.value, currency: 'USD' } },
      })),
    };
  }
  return api(`/v1/payments/payouts/${id}`);
}

// Ask PayPal whether a webhook event really came from PayPal.
export async function verifyWebhook(headers, event, webhookId) {
  const j = await api('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'], cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'], transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'], webhook_id: webhookId, webhook_event: event,
    }),
  });
  return j.verification_status === 'SUCCESS';
}
