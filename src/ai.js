// AI layer. Two jobs:
//  1. secondOpinion(): read the claimant's own words + the signals for claims in the
//     "needs review" band and recommend approve / hold, with a reason a court could read.
//  2. explainForClaimant(): turn signals into a short, respectful letter for the claimant.
// The AI only recommends. A person makes every final decision, and nothing is paid
// until a person approves the payout batch.
//
// Provider: Gemini (GEMINI_API_KEY) or Claude (ANTHROPIC_API_KEY). Without a key, rules only.

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

export const aiProvider = () => (GEMINI_KEY ? `Gemini (${GEMINI_MODEL})` : ANTHROPIC_KEY ? `Claude (${CLAUDE_MODEL})` : null);
export const aiEnabled = () => !!aiProvider();

const SYSTEM = `You assist a court-appointed class action settlement administrator.
You review claims for a consumer settlement (a skin serum sold in US stores).
You never decide on your own; you recommend, and a human administrator decides.
Fraud is common (bot rings, AI agents filing in bulk, duplicates), but real people
are often messy, share networks (dorms, families) and lack receipts. Wrongly
rejecting a real class member is a serious harm. Be specific and plain-spoken.`;

async function ask(prompt, { json = false, maxTokens = 400 } = {}) {
  if (GEMINI_KEY) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2, ...(json ? { responseMimeType: 'application/json' } : {}), thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || `Gemini error ${r.status}`);
    return j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  }
  if (ANTHROPIC_KEY) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || `Claude error ${r.status}`);
    return j.content?.find((b) => b.type === 'text')?.text || '';
  }
  throw new Error('No AI key set');
}

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
  if (!aiEnabled()) return fallbackOpinion(c);
  const text = await ask(
`Claim ${c.id}
Claimant's own words: "${c.narrative}"
Units claimed: ${c.units}, proof of purchase: ${c.proof ? 'yes' : 'no'}, filed by: ${c.filer}
Automated signals (score ${c.score}/100):
${c.reasons.map((r) => '- ' + r).join('\n') || '- none'}

Reply with JSON only: {"recommendation":"approve"|"hold","confidence":0-1,"reason":"one or two plain sentences"}`, { json: true, maxTokens: 300 });
  try {
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (!['approve', 'hold'].includes(j.recommendation)) throw new Error('bad shape');
    return { ...j, source: aiProvider() };
  } catch {
    return { ...fallbackOpinion(c), note: 'AI reply could not be read; rule-based opinion shown' };
  }
}

export async function explainForClaimant(c) {
  const base = c.reasons.length
    ? `Your claim is on hold while we check a few things:\n${c.reasons.map((r) => '• ' + r).join('\n')}`
    : 'Your claim passed our checks.';
  if (!aiEnabled() || !c.reasons.length) return { text: base, source: 'rules' };
  try {
    const text = await ask(
`Write a short, respectful note (max 90 words) to claimant ${c.name.split(' ')[0]} explaining why claim ${c.id} is on hold,
based only on these findings, and telling them they can confirm their identity with their PayPal account
to have it reviewed and paid. No legal advice, no accusations, plain text, no markdown.
Findings:\n${c.reasons.map((r) => '- ' + r).join('\n')}`, { maxTokens: 250 });
    return { text: text.trim() || base, source: aiProvider() };
  } catch {
    return { text: base, source: 'rules' };
  }
}
