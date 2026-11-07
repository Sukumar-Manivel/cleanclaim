// AI layer. Two jobs:
//  1. secondOpinion(): read the claimant's own words + the signals for claims in the
//     "needs review" band and recommend approve / hold, with a reason a court could read.
//  2. explainForClaimant(): turn signals into a short, respectful letter for the claimant.
// The AI only recommends. A person makes every final decision, and nothing is paid
// until a person approves the payout batch.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
export const aiEnabled = () => !!client;

const SYSTEM = `You assist a court-appointed class action settlement administrator.
You review claims for a consumer settlement (a skin serum sold in US stores).
You never decide on your own; you recommend, and a human administrator decides.
Fraud is common (bot rings, AI agents filing in bulk, duplicates), but real people
are often messy, share networks (dorms, families) and lack receipts. Wrongly
rejecting a real class member is a serious harm. Be specific and plain-spoken.`;

function fallbackOpinion(c) {
  // A story copied by hundreds of other claims is a strong sign on its own.
  const copies = Number((c.reasons[c.signals.indexOf('template')] || '').match(/matches (\d+)/)?.[1] || 0);
  const strong = c.signals.filter((s) => ['device', 'identity', 'agent'].includes(s) || (s === 'template' && copies >= 200));
  const rec = strong.length ? 'hold' : 'approve';
  const why = strong.length
    ? `Signals tied to identity or automation are present: ${c.reasons[c.signals.indexOf(strong[0])]}`
    : `Only network-level or wording signals fired; the story reads as first-hand (${c.narrative.slice(0, 60)}...). Shared networks like dorms are common for real claimants.`;
  return { recommendation: rec, confidence: strong.length ? 0.7 : 0.6, reason: why, source: 'rules' };
}

export async function secondOpinion(c) {
  if (!client) return fallbackOpinion(c);
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 300, system: SYSTEM,
    messages: [{ role: 'user', content:
`Claim ${c.id}
Claimant's own words: "${c.narrative}"
Units claimed: ${c.units}, proof of purchase: ${c.proof ? 'yes' : 'no'}, filed by: ${c.filer}
Automated signals (score ${c.score}/100):
${c.reasons.map((r) => '- ' + r).join('\n') || '- none'}

Reply with JSON only: {"recommendation":"approve"|"hold","confidence":0-1,"reason":"one or two plain sentences"}` }],
  });
  try {
    const text = msg.content.find((b) => b.type === 'text')?.text || '';
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    return { ...j, source: MODEL };
  } catch {
    return fallbackOpinion(c);
  }
}

export async function explainForClaimant(c) {
  const base = c.reasons.length
    ? `Your claim is on hold while we check a few things:\n${c.reasons.map((r) => '• ' + r).join('\n')}`
    : 'Your claim passed our checks.';
  if (!client || !c.reasons.length) return { text: base, source: 'rules' };
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 250, system: SYSTEM,
    messages: [{ role: 'user', content:
`Write a short, respectful note (max 90 words) to claimant ${c.name} explaining why claim ${c.id} is on hold,
based only on these findings, and telling them they can confirm their identity with their PayPal account
to have it reviewed and paid. No legal advice, no accusations.
Findings:\n${c.reasons.map((r) => '- ' + r).join('\n')}` }],
  });
  return { text: msg.content.find((b) => b.type === 'text')?.text || base, source: MODEL };
}
