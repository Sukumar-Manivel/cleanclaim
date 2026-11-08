# CleanClaim: Devpost submission kit

## Project name
CleanClaim

## Elevator pitch (one line, under 200 characters)
Bots and AI agents file millions of fake class-action claims. CleanClaim flags them with plain-English reasons, lets real people clear themselves with PayPal, and pays them via PayPal Payouts.

## Inspiration
When a company settles a class action, anyone affected can file a claim online, and the money is split among the claims. That makes every fake claim a direct theft from real people. One payment processor reported 80 million fraudulent claims across its clients in 2023, up 19,000% since 2021. In the Juul/Altria settlement, the administrator said about 80% of 14 million claims were likely fake. In October 2026 a new wave began: AI agents filing claims in bulk "on behalf" of thousands of people.

Commercial tools already score claims for fraud. What we saw missing was the other side: the real person who gets held by mistake, with no idea why and no way to prove they are real. CleanClaim is built around being fair to that person while still stopping the bots.

## What it does
- **Screens every claim** for warning signs: shared networks, reused devices, filing bursts, throwaway emails, copy-paste stories, the same person filing many times, and bulk filing by automated agents.
- **Explains every flag in plain English** so an administrator, a judge, or the claimant can read it.
- **Asks an AI for a second opinion** on borderline claims. The AI reads the claimant's own words and recommends approve or hold with a reason. It never decides; a person does.
- **Lets wrongly held people clear themselves** with Log in with PayPal. One PayPal account can confirm only one claim.
- **Pays eligible class members through PayPal Payouts**, only after a person types a confirmation. PayPal rejects a repeated batch, so nobody is paid twice. Each payment is tracked to SUCCESS, UNCLAIMED or RETURNED.

In our demo case ($50,000 fund, 10,000 filed claims), paying everyone would give $5.00 each. After review, 1,512 real class members get $33.06 each.

## How we built it
- **Backend:** Node.js + Express. The detector builds network, device, identity, wording and filer clusters across all claims and turns each signal into a sentence.
- **PayPal:** Payouts API for batch payments (with `sender_batch_id` as the retry key), payout status polling and verified webhooks, Log in with PayPal (OpenID Connect) for claimant identity, OAuth client credentials on the server.
- **AI:** A fallback chain: Gemini (several models) → GitHub Models → Groq → OpenRouter → Claude → rules. Each provider gets 15 seconds; on quota limits or errors the next one answers. Answers are cached so a claim never costs quota twice.
- **Front end:** AG Grid for the 10,000-row review queue; plain HTML/CSS for the rest, designed to look like settlement safety paper.
- **Data:** 10,000 synthetic, labelled claims, including the hard cases: a campus email blast, families without receipts, a ring hiding behind residential proxies, and hand-made fakes.

## Challenges we ran into
- **Being honest about accuracy.** Our first detector scored 100%, which only meant the fake data was too easy. We added realistic hard cases until it made human-like mistakes, then built the "How accurate is this?" page to show them.
- **The AI was too harsh at first.** It called a dorm student a fraud at 95% confidence. We rewrote the instructions to describe what is normal for honest claimants, and now it approves the student and still holds the scripted ring.
- **Free-tier AI quotas.** Gemini's free tier allowed 20 requests a day for one model, so we built the multi-provider fallback and answer cache.
- **Sandbox limits.** Venmo payouts are rejected in the PayPal sandbox, so the demo pays PayPal accounts. Venmo works the same way in production.

## Accomplishments we're proud of
- Real PayPal sandbox payouts from the app, end to end, with statuses tracked per claim.
- 99.8% of held claims are truly fake and 95.8% of fake claims are caught on our labelled data, and the 15 real people we wrongly hold can clear themselves in one step.
- No money is ever held by CleanClaim and no claim is ever denied by the AI.

## What we learned
Fraud tools usually measure how many fakes they catch. The harder and more important number is how many real people they hurt, and what those people can do about it.

## What's next
- Live settlement data with a claims administrator partner.
- Venmo payouts in production, and a court-ready report export.
- Detecting AI-agent filings by asking each class member to confirm their own claim through PayPal.

## Built with
nodejs, express, paypal-payouts-api, log-in-with-paypal, paypal-webhooks, gemini, github-models, groq, openrouter, claude, ag-grid, render, javascript, html, css

## AI tools used (required field)
- Gemini API (gemini-3.8-flash, gemini-flash-lite-latest) and GitHub Models for claim second opinions and claimant notes, with Groq/OpenRouter/Claude as fallbacks.
- Claude was used as a coding assistant while building the project.

## Links to fill in
- Repo: https://github.com/Sukumar-Manivel/cleanclaim
- Live demo: (Render URL)
- Video: (YouTube URL, public)

---

# Demo video script (target 2:45, hard limit under 3:00)

Record at 1080p. Prepare first: fresh server start, Chrome zoom 90%, sandbox accounts logged out, the claimant page URL ready in a second tab. Cut all waiting time in editing.

| Time | Screen | Say (roughly) |
|---|---|---|
| 0:00–0:15 | Title card, then a news headline image or the stats as text | "When a class action settles, anyone harmed can file a claim. In 2023 one processor saw 80 million fake claims, up 19,000% in two years. Every fake claim takes money from a real person." |
| 0:15–0:30 | CleanClaim home: the check animates $5.00 → $33.06 | "This is CleanClaim. Ten thousand claims were filed on a $50,000 fund. Paid to everyone, that's five dollars each. After review, real people get thirty-three." |
| 0:30–0:55 | Review queue → click a held bot-ring claim → reasons list | "Every claim is screened for shared networks, reused devices, copy-paste stories, and bulk filing by AI agents, and every flag is written in plain English." |
| 0:55–1:20 | Click a "Needs a person" dorm student → Ask AI → Approve | "Borderline claims get an AI second opinion. Here Gemini reads the student's own words and sees a campus network, not a bot ring. It recommends approve, but a person decides." |
| 1:20–1:40 | "How accurate is this?" tab | "We test on labelled data: 99.8% of held claims are fake, 96% of fakes are caught. And we show our mistakes: 15 real people were held." |
| 1:40–2:05 | Claimant page → Confirm with PayPal → sandbox login → "approved" | "So those people can clear themselves. They confirm with PayPal; one account can only confirm one claim, and we pay that account." |
| 2:05–2:35 | Pay tab → type PAY 1513 → batch → SUCCESS / UNCLAIMED rows; flash the sandbox account balance | "Nothing is paid until a person confirms. Payments go out through PayPal Payouts, tracked per claim, and a repeated batch is rejected, so no one is paid twice." |
| 2:35–2:45 | Architecture slide: detector → AI chain → human → PayPal | "CleanClaim: bots don't get paid, real people do. Built with PayPal Payouts, Log in with PayPal, and Gemini." |

Checklist before uploading: under 3:00, public on YouTube, says "PayPal" and names the AI in the first 30 seconds, shows the product working (not slides), captions on.
