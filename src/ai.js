// AI layer. Two jobs:
//  1. secondOpinion(): read the claimant's own words + the signals for claims in the
//     "needs review" band and recommend approve / hold, with a reason a court could read.
//  2. explainForClaimant(): turn signals into a short, respectful letter for the claimant.
// The AI only recommends. A person makes every final decision, and nothing is paid
// until a person approves the payout batch.
//
// Providers are tried in order (AI_ORDER). If one is out of quota, slow or down, the next one
// answers. If all fail, rule-based text is used, so the app never stops working.
//   gemini      GEMINI_API_KEY      (several Gemini models, each with its own daily limit)
//   groq        GROQ_API_KEY        (free tier, very fast; OpenAI-compatible API)
//   github      GITHUB_TOKEN        (GitHub Models, free with a GitHub account; OpenAI-compatible API)
//   openrouter  OPENROUTER_API_KEY  (free models available; OpenAI-compatible API)
//   anthropic   ANTHROPIC_API_KEY
const env = process.env;
const TIMEOUT_MS = Number(env.AI_TIMEOUT_MS || 15000);
const list = (v, d) => (v || d).split(',').map((x) => x.trim()).filter(Boolean);

const PROVIDERS = {
  gemini: { key: env.GEMINI_API_KEY, label: 'Gemini', models: list(env.GEMINI_MODELS, [env.GEMINI_MODEL || 'gemini-3.8-flash', 'gemini-flash-lite-latest', 'gemini-flash-latest'].join(',')) },
  groq: { key: env.GROQ_API_KEY, label: 'Groq', models: list(env.GROQ_MODELS, 'llama-3.3-70b-versatile,llama-3.1-8b-instant'), url: 'https://api.groq.com/openai/v1/chat/completions' },
  github: { key: env.GITHUB_TOKEN, label: 'GitHub Models', models: list(env.GITHUB_MODELS, 'openai/gpt-4.1-mini,meta/Llama-3.3-70B-Instruct'), url: 'https://models.github.ai/inference/chat/completions' },
  openrouter: { key: env.OPENROUTER_API_KEY, label: 'OpenRouter', models: list(env.OPENROUTER_MODELS, 'meta-llama/llama-3.3-70b-instruct:free'), url: 'https://openrouter.ai/api/v1/chat/completions' },
  anthropic: { key: env.ANTHROPIC_API_KEY, label: 'Claude', models: list(env.CLAUDE_MODELS, env.CLAUDE_MODEL || 'claude-sonnet-5-5') },
};
const ORDER = list(env.AI_ORDER, 'gemini,github,groq,openrouter,anthropic').filter((p) => PROVIDERS[p]?.key);

export const aiProvider = () => (ORDER.length ? ORDER.map((p) => PROVIDERS[p].label).join(' → ') : null);
export const aiEnabled = () => ORDER.length > 0;

const SYSTEM = `You assist a court-appointed class action settlement administrator.
You review claims for a consumer settlement (a skin serum sold in US stores).
You never decide on your own; you recommend, and a human administrator decides.
Fraud is common (bot rings, AI agents filing in bulk, duplicates), but real people
are often messy, share networks (dorms, families) and lack receipts. Wrongly
rejecting a real class member is a serious harm. Be specific and plain-spoken.

What is normal for honest claimants in this case:
- Short, generic stories ("bought it, used it, did not work") are written by many real people; a story
  matching fewer than about 100 others is not evidence of fraud by itself. Hundreds or thousands of
  near-identical stories point to a script.
- A shared network with claims minutes apart can be a campus or workplace where an email about the
  settlement went out. Weigh it with first-hand detail in the claimant's own words.
- Reused devices, the same name and address on many claims, and bulk filing by an automated agent
  are much stronger signs than network or wording alone.
Recommend "hold" only when the evidence would convince a fair reviewer; otherwise "approve".`;

let lastSource = null;

async function callOnce(provider, model, prompt, json, maxTokens) {
  const p = PROVIDERS[provider];
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let r, j, text;
  if (provider === 'gemini') {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2, ...(json ? { responseMimeType: 'application/json' } : {}) },
      }),
    });
    j = await r.json().catch(() => ({}));
    text = j.candidates?.[0]?.content?.parts?.map((x) => x.text).join('');
  } else if (provider === 'anthropic') {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-api-key': p.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }),
    });
    j = await r.json().catch(() => ({}));
    text = j.content?.find((b) => b.type === 'text')?.text;
  } else { // OpenAI-compatible (GitHub Models, Groq, OpenRouter)
    r = await fetch(p.url, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature: 0.2, ...(json ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
      }),
    });
    j = await r.json().catch(() => ({}));
    text = j.choices?.[0]?.message?.content;
  }
  if (!r.ok || !text) throw new Error(`${p.label} ${model}: ${r.status === 429 ? 'limit reached' : (j.error?.message || `error ${r.status}`)}`);
  return text;
}

// Try every provider and model in order until one answers.
async function ask(prompt, { json = false, maxTokens = 400 } = {}) {
  const errors = [];
  for (const provider of ORDER) {
    for (const model of PROVIDERS[provider].models) {
      try {
        const text = await callOnce(provider, model, prompt, json, maxTokens);
        lastSource = `${PROVIDERS[provider].label} (${model})`;
        return text;
      } catch (e) {
        errors.push(e.name === 'TimeoutError' ? `${PROVIDERS[provider].label} ${model}: timed out` : e.message);
      }
    }
  }
  throw new Error(errors.join('; ') || 'No AI key set');
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
  let text;
  try {
    text = await ask(
`Claim ${c.id}
Claimant's own words: "${c.narrative}"
Units claimed: ${c.units}, proof of purchase: ${c.proof ? 'yes' : 'no'}, filed by: ${c.filer}
Automated signals (score ${c.score}/100):
${c.reasons.map((r) => '- ' + r).join('\n') || '- none'}

Reply with JSON only: {"recommendation":"approve"|"hold","confidence":0-1,"reason":"one or two plain sentences"}`, { json: true, maxTokens: 300 });
  } catch (e) {
    return { ...fallbackOpinion(c), note: `All AI providers were busy or out of quota, so the rule-based opinion is shown. Details: ${e.message.slice(0, 200)}` };
  }
  try {
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (!['approve', 'hold'].includes(j.recommendation)) throw new Error('bad shape');
    return { ...j, source: lastSource };
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
    return { text: text.trim() || base, source: lastSource };
  } catch {
    return { text: base, source: 'rules' };
  }
}
