import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateClaims } from './generate.js';
import { review, metrics, SIGNALS } from './detect.js';
import { secondOpinion, explainForClaimant, aiEnabled, aiProvider } from './ai.js';
import { createPayoutBatch, getPayoutBatch, paypalMode, verifyWebhook } from './paypal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/vendor', express.static(path.join(__dirname, '..', 'node_modules', 'ag-grid-community', 'dist')));

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const DEMO_LIMIT = Number(process.env.DEMO_PAYOUT_LIMIT || 5);
const DEMO_RECEIVER = process.env.DEMO_RECEIVER_EMAIL || '';

const settlement = {
  name: 'In re SnapGlow Serum Marketing Litigation',
  note: 'Fictional case with synthetic claimants, for demonstration only',
  fund: 50000,
  docket: 'No. 1:26-cv-04417 (synthetic)',
};
let claims = [];
const byId = new Map();
const batches = [];
const audit = [];
const log = (action, detail) => audit.unshift({ at: new Date().toISOString(), action, detail });

// AI answers are saved to disk so a demo never spends API quota twice on the same claim.
const CACHE = path.join(__dirname, '..', 'data', 'ai-cache.json');
let aiCache = {};
try { aiCache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { aiCache = {}; }
const saveCache = () => { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(aiCache, null, 1)); };
const remember = (c) => { if (c.opinion && !c.opinion.note && c.opinion.source !== 'rules') { aiCache[c.id] = { ...(aiCache[c.id] || {}), opinion: c.opinion }; saveCache(); } };

function load() {
  claims = review(generateClaims());
  for (const c of claims) { if (aiCache[c.id]?.opinion) c.opinion = aiCache[c.id].opinion; if (aiCache[c.id]?.letter) c.letter = aiCache[c.id].letter; }
  byId.clear(); claims.forEach((c) => byId.set(c.id, c));
  batches.length = 0; audit.length = 0;
  log('dataset', `${claims.length.toLocaleString()} claims loaded and screened`);
}
load();

const payable = (c) => (c.status === 'clear' && c.decision !== 'reject') || c.decision === 'approve';
const cents = (n) => Math.floor(n * 100) / 100;
const publicClaim = (c) => { const { truth, ring, ...rest } = c; return rest; };

app.get('/api/summary', (req, res) => {
  const counts = { clear: 0, review: 0, held: 0, approved: 0, rejected: 0, paid: 0 };
  for (const c of claims) {
    counts[c.status]++;
    if (c.decision === 'approve') counts.approved++;
    if (c.decision === 'reject') counts.rejected++;
    if (c.payout?.status === 'SUCCESS') counts.paid++;
  }
  const payCount = claims.filter(payable).length;
  res.json({
    settlement, counts, total: claims.length, payable: payCount,
    shareIfPaidToAll: cents(settlement.fund / claims.length),
    shareAfterReview: cents(settlement.fund / Math.max(1, payCount)),
    metrics: metrics(claims), signals: SIGNALS,
    modes: { paypal: paypalMode(), ai: aiProvider() || 'rules only', demoPayoutLimit: DEMO_LIMIT },
    batches, audit: audit.slice(0, 30),
  });
});

app.get('/api/claims', (req, res) => {
  const { status } = req.query;
  res.json(claims.filter((c) => !status || c.status === status).map(publicClaim));
});

// Evaluation view: reveals the hidden synthetic labels so judges can check accuracy.
app.get('/api/evaluation', (req, res) => {
  const m = metrics(claims); const byTruth = {};
  for (const c of claims) { const k = `${c.truth}|${c.status}`; byTruth[k] = (byTruth[k] || 0) + 1; }
  res.json({ ...m, byTruth });
});

app.get('/api/claims/:id', (req, res) => {
  const c = byId.get(req.params.id); if (!c) return res.status(404).json({ error: 'No claim with that ID' });
  res.json(publicClaim(c));
});

app.post('/api/claims/:id/opinion', async (req, res) => {
  const c = byId.get(req.params.id); if (!c) return res.status(404).json({ error: 'No claim with that ID' });
  if (c.opinion && c.opinion.source !== 'rules' && !c.opinion.note && !req.query.fresh) return res.json(c.opinion);
  try { c.opinion = await secondOpinion(c); remember(c); res.json(c.opinion); }
  catch (e) { res.status(502).json({ error: `AI review failed: ${e.message}` }); }
});

app.post('/api/claims/:id/decision', (req, res) => {
  const c = byId.get(req.params.id); if (!c) return res.status(404).json({ error: 'No claim with that ID' });
  const { decision, by = 'administrator' } = req.body;
  if (!['approve', 'reject', null].includes(decision)) return res.status(400).json({ error: 'Decision must be approve, reject or null' });
  c.decision = decision; c.decidedBy = by;
  log('decision', `${c.id} ${decision || 'reset'} by ${by}`);
  res.json(publicClaim(c));
});

// AI second opinion for the whole "needs review" band (capped to keep API cost small).
app.post('/api/review-band/opinions', async (req, res) => {
  const limit = Math.min(Number(req.body.limit || 5), 50);
  const band = claims.filter((c) => c.status === 'review' && !c.opinion).slice(0, limit);
  for (const c of band) { try { c.opinion = await secondOpinion(c); remember(c); } catch (e) { c.opinion = { error: e.message }; } }
  log('ai-review', `AI second opinion on ${band.length} claims`);
  res.json({ reviewed: band.length });
});

// Payout: only after a person types the confirmation phrase. Never pays held or undecided claims.
app.post('/api/payouts', async (req, res) => {
  const list = claims.filter(payable).filter((c) => !c.payout);
  const share = cents(settlement.fund / Math.max(1, claims.filter(payable).length));
  const phrase = `PAY ${list.length}`;
  if (req.body.confirm !== phrase) return res.status(400).json({ error: `Type "${phrase}" to confirm this payout`, phrase });
  if (!list.length) return res.status(400).json({ error: 'Nothing left to pay' });

  // Sandbox demo: send a small slice to PayPal; the first goes to your sandbox personal account.
  const slice = list.slice(0, DEMO_LIMIT);
  const items = slice.map((c, i) => ({ claimId: c.id, value: share.toFixed(2), receiver: i === 0 && DEMO_RECEIVER ? DEMO_RECEIVER : c.email.replace(/@.*/, '@example.com') }));
  const senderBatchId = `snapglow-r1-${Date.now()}`;
  try {
    const h = await createPayoutBatch(senderBatchId, items, `Payment from ${settlement.name}`);
    const batch = { id: h.payout_batch_id, senderBatchId, status: h.batch_status, share, sent: items.length, eligible: list.length, createdAt: new Date().toISOString(), mode: paypalMode() };
    batches.unshift(batch);
    slice.forEach((c, i) => { c.payout = { batchId: batch.id, status: 'PENDING', receiver: items[i].receiver, value: items[i].value }; });
    log('payout', `Batch ${batch.id}: ${items.length} payments of $${share.toFixed(2)} sent to PayPal (${list.length.toLocaleString()} eligible)`);
    res.json(batch);
  } catch (e) {
    log('payout-error', e.message);
    res.status(502).json({ error: `PayPal did not accept the batch: ${e.message}` });
  }
});

app.get('/api/payouts/:id', async (req, res) => {
  try {
    const j = await getPayoutBatch(req.params.id);
    const b = batches.find((x) => x.id === req.params.id);
    if (b) b.status = j.batch_header.batch_status;
    for (const it of j.items || []) {
      const c = byId.get(it.payout_item.sender_item_id);
      if (c?.payout) { c.payout.status = it.transaction_status; c.payout.transactionId = it.transaction_id; }
    }
    res.json({ status: j.batch_header.batch_status, items: (j.items || []).map((it) => ({ claimId: it.payout_item.sender_item_id, receiver: it.payout_item.receiver, value: it.payout_item.amount.value, status: it.transaction_status, transactionId: it.transaction_id })) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// PayPal webhooks (PAYMENT.PAYOUTSBATCH.*, PAYMENT.PAYOUTS-ITEM.*).
// When PAYPAL_WEBHOOK_ID is set, every event is verified with PayPal before it changes anything.
app.post('/webhooks/paypal', async (req, res) => {
  const e = req.body || {};
  if (process.env.PAYPAL_WEBHOOK_ID && paypalMode() !== 'mock') {
    const ok = await verifyWebhook(req.headers, e, process.env.PAYPAL_WEBHOOK_ID).catch(() => false);
    if (!ok) { log('webhook-rejected', `Unverified ${e.event_type || 'event'} ignored`); return res.sendStatus(400); }
  }
  const r = e.resource || {};
  const claimId = r.payout_item?.sender_item_id;
  const c = claimId && byId.get(claimId);
  if (c?.payout) c.payout.status = r.transaction_status || c.payout.status;
  log('webhook', `${e.event_type || 'unknown event'}${claimId ? ' for ' + claimId : ''}`);
  res.sendStatus(200);
});

// ---- Claimant side -------------------------------------------------------
app.get('/api/claimant/:id', async (req, res) => {
  const c = byId.get(req.params.id); if (!c) return res.status(404).json({ error: 'We could not find that claim ID. Check the ID in your claim confirmation email.' });
  let letter = null;
  if (c.status !== 'clear') {
    if (!c.letter) { c.letter = await explainForClaimant(c).catch(() => null); if (c.letter?.source && c.letter.source !== 'rules') { aiCache[c.id] = { ...(aiCache[c.id] || {}), letter: c.letter }; saveCache(); } }
    letter = c.letter;
  }
  res.json({ id: c.id, firstName: c.name.split(' ')[0], status: c.status, decision: c.decision, verified: c.verified || null, payout: c.payout || null, letter, share: cents(settlement.fund / Math.max(1, claims.filter(payable).length)) });
});

// Log in with PayPal: proves the claimant controls a real PayPal account, then we pay that account.
app.get('/auth/paypal/start', (req, res) => {
  const claimId = req.query.claim;
  if (!byId.has(claimId)) return res.status(404).send('Unknown claim');
  if (paypalMode() === 'mock' || process.env.LOGIN_WITH_PAYPAL !== '1') return res.redirect(`/auth/paypal/callback?mock=1&state=${claimId}`);
  const auth = paypalMode() === 'sandbox' ? 'https://www.sandbox.paypal.com' : 'https://www.paypal.com';
  const q = new URLSearchParams({ flowEntry: 'static', client_id: process.env.PAYPAL_CLIENT_ID, response_type: 'code', scope: 'openid email https://uri.paypal.com/services/paypalattributes', redirect_uri: `${PUBLIC_URL}/auth/paypal/callback`, state: claimId });
  res.redirect(`${auth}/signin/authorize?${q}`);
});

app.get('/auth/paypal/callback', async (req, res) => {
  const c = byId.get(req.query.state);
  if (!c) return res.status(400).send('Unknown claim');
  try {
    let email, payerId, verified;
    if (req.query.mock) { email = DEMO_RECEIVER || c.email; payerId = 'MOCKPAYER'; verified = true; }
    else {
      const base = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
      const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
      const t = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code }) }).then((r) => r.json());
      const u = await fetch(`${base}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, { headers: { Authorization: `Bearer ${t.access_token}` } }).then((r) => r.json());
      email = (u.emails || []).find((e) => e.primary)?.value || u.emails?.[0]?.value;
      payerId = u.payer_id; verified = u.verified_account === true || u.verified_account === 'true';
    }
    // One PayPal account can confirm only one claim, so a ring cannot launder fakes through one login.
    const already = !req.query.mock && claims.find((x) => x !== c && x.verified?.payerId === payerId);
    if (already) {
      log('verify-blocked', `${c.id}: PayPal account already used to confirm ${already.id}`);
      return res.redirect(`/claim.html?id=${c.id}&error=${encodeURIComponent('This PayPal account was already used to confirm another claim. Each class member can be paid once.')}`);
    }
    c.verified = { email, payerId, verified, at: new Date().toISOString() };
    c.email = email; c.decision = 'approve'; c.decidedBy = 'claimant verified with PayPal';
    log('verify', `${c.id} confirmed with a ${verified ? 'verified ' : ''}PayPal account and was approved`);
    res.redirect(`/claim.html?id=${c.id}&verified=1`);
  } catch (e) {
    res.redirect(`/claim.html?id=${c.id}&error=${encodeURIComponent('PayPal sign-in did not finish. Try again.')}`);
  }
});

app.post('/api/reset', (req, res) => { load(); res.json({ ok: true }); });

app.listen(PORT, () => console.log(`CleanClaim running at ${PUBLIC_URL} (PayPal: ${paypalMode()}, AI: ${aiProvider() || 'rules only'})`));
