import test from 'node:test';
import assert from 'node:assert/strict';
import { generateClaims } from '../src/generate.js';
import { review, metrics, SIGNALS } from '../src/detect.js';
import { createPayoutBatch, getPayoutBatch, paypalMode } from '../src/paypal.js';

test('generateClaims produces 10,000 deterministic claims', () => {
  const claims = generateClaims({ total: 10000, real: 1200 });
  assert.equal(claims.length, 10000);

  const truths = {};
  for (const c of claims) {
    truths[c.truth] = (truths[c.truth] || 0) + 1;
  }

  assert.equal(truths.real, 1200);
  assert.ok(truths.bot_ring > 0, 'Should generate bot rings');
  assert.ok(truths.ai_agent > 0, 'Should generate AI agent claims');
  assert.ok(truths.duplicate > 0, 'Should generate duplicate claims');
});

test('review screens claims and assigns scores and statuses', () => {
  const raw = generateClaims({ total: 1000, real: 200 });
  const reviewed = review(raw);

  assert.equal(reviewed.length, 1000);
  for (const c of reviewed) {
    assert.ok(typeof c.score === 'number');
    assert.ok(c.score >= 0 && c.score <= 100);
    assert.ok(['clear', 'review', 'held'].includes(c.status));
    assert.ok(Array.isArray(c.reasons));
    assert.ok(Array.isArray(c.signals));
  }

  const m = metrics(reviewed);
  assert.ok(m.precision > 0.9, `Precision should be high (>0.90), got ${m.precision}`);
  assert.ok(m.recall > 0.8, `Recall should be high (>0.80), got ${m.recall}`);
});

test('paypal mock client creates and polls batches without error', async () => {
  assert.equal(paypalMode(), 'sandbox' === process.env.PAYPAL_CLIENT_ID ? 'sandbox' : (process.env.PAYPAL_CLIENT_ID ? 'sandbox' : 'mock'));
  
  const items = [{ claimId: 'CL-00001', receiver: 'test@example.com', value: '33.06' }];
  const batch = await createPayoutBatch(`test-batch-${Date.now()}`, items, 'Test payment');
  assert.ok(batch.payout_batch_id);

  const status = await getPayoutBatch(batch.payout_batch_id);
  assert.ok(status.batch_header);
});
