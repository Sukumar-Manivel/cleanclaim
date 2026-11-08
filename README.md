# CleanClaim

**Settlement money should reach real people, not bots.**

When a class action settles, anyone affected can file a claim online. Bots, claim rings and now AI agents file fake claims by the thousands, and every fake claim shrinks what real people get. One payment processor reported 80 million fraudulent claims across its clients in 2023, up 19,000% since 2021 (Digital Disbursements). In the Juul/Altria settlement, the administrator said about 80% of 14 million claims were likely fake.

CleanClaim is a review console for settlement administrators:

1. **Screens every claim** for warning signs: shared networks, reused devices, filing bursts, throwaway emails, copy-paste stories, the same person filing many times, and claims filed in bulk by automated agents.
2. **Explains every flag in plain English**, so an administrator, a judge or the claimant can read why.
3. **Asks an AI for a second opinion** on borderline claims, using the claimant's own words. The AI only recommends; a person decides.
4. **Lets wrongly held claimants clear themselves** by confirming with their PayPal account (Log in with PayPal). One PayPal account can confirm one claim.
5. **Pays eligible class members through PayPal Payouts**, only after a person types a confirmation. A repeated batch is rejected by PayPal, so nobody is paid twice.

In the demo case ($50,000 fund, 10,000 filed claims), paying everyone would give **$5.00** each. After review, **1,512** eligible class members get **$33.06** each.

## How PayPal is used

| PayPal feature | What it does here |
|---|---|
| Payouts API (`POST /v1/payments/payouts`) | Sends settlement payments to eligible class members in batches, with `sender_batch_id` as the retry key |
| Payouts status (`GET /v1/payments/payouts/{id}`) + webhooks | Tracks each payment: SUCCESS, UNCLAIMED, RETURNED |
| Log in with PayPal (OpenID Connect) | Lets a held claimant prove they control a real PayPal account; we then pay that account |
| OAuth client credentials | Server-side token, refreshed automatically |

Tested in the PayPal sandbox: a $1 payout between US sandbox accounts returned `SUCCESS`. Venmo payouts are supported in production but PayPal's sandbox rejects `recipient_wallet: VENMO`, so the demo pays PayPal accounts.

## How AI is used

- Rule signals score each claim and write the plain-English reasons.
- An AI model reviews the "needs a person" band: it reads the claimant's own words with the signals and recommends approve or hold with a reason (`src/ai.js`).
- The AI writes the respectful hold notice the claimant sees.
- Providers are tried in order: Gemini (3 models) → GitHub Models → Groq → OpenRouter → Claude. If one is out of quota or slow (15 s limit), the next answers; if all fail, rule-based text is shown. Answers are cached so the demo never spends quota twice.

## Accuracy (synthetic data)

All claims are synthetic and labelled, so the "How accurate is this?" tab compares the review with the truth. Current run: **99.8%** of held claims are fake, **95.8%** of fake claims are caught, **15** real people are held by mistake (and can clear themselves), **289** claims go to a person. Hand-made fakes with no shared signals are the main miss, which is why a person stays in the loop.

## Run it

```bash
npm install
cp .env.example .env   # add your PayPal sandbox keys (optional)
npm start              # http://localhost:3000
```

- Admin console: `http://localhost:3000`
- Claimant page: `http://localhost:3000/claim.html?id=CL-08246`

Without PayPal keys the app runs in **mock mode** (fake batch IDs, no network).

## Safety rules built in

- CleanClaim never holds money. Payments go from the administrator's own PayPal business account to class members.
- The AI never denies a claim. Held claims wait for a person or for the claimant to confirm.
- Every decision and payment is written to the activity log.
- Demo data is fictional. "SnapGlow" and all claimants are made up.

## Built with

Node.js, Express, AG Grid Community, PayPal Payouts API, Log in with PayPal, Google Gemini API, GitHub Models, Groq, OpenRouter, Anthropic Claude API (fallback chain).

## License

MIT
