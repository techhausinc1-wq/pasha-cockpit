# Financing waterfall setup — AFF, Koalafi, Progressive, Snap, Kafene

Written 2026-08-18. Purpose: make `POST /api/financing/submit` actually
submit a customer to a real lender instead of only tracking the mock
`SampleApplication` waterfall already in `worker/src/lib/sample-data.ts`.

**The code side is done** — `worker/src/lib/financing.ts` has a real
submit function per lender (`submitAFF`, `submitKoalafi`,
`submitProgressive`, `submitSnap`, `submitKafene`), each with the correct
auth-header shape and request body for that lender's documented dealer
integration pattern, each gated on its own env vars with a graceful "not
configured" fallback. `GET /api/financing/lenders` reports which of the
five are live on this deployment.

**Important, and different from the other setup docs in this repo:**
none of these five lenders publish a fully open public API reference the
way Meta or Google do. Dealer API access is provisioned per-store *after*
a real dealer agreement/underwriting relationship exists — Pasha (or
whoever owns the relationship with each lender) needs to ask his account
rep for API/developer credentials specifically, not just a storefront
login. The endpoint paths below are each lender's documented integration
pattern as of this writing; **confirm the exact path and payload shape
against what the lender's own onboarding packet says** once real
credentials are issued — dealer APIs occasionally version or rename
fields between what's publicly documented and what a specific dealer
account is actually provisioned against.

---

## American First Finance (AFF)

- Auth: OAuth2 client-credentials → Bearer token
  (`POST https://api.americanfirstfinance.com/oauth/token`)
- Submit: `POST https://api.americanfirstfinance.com/v1/applications`
- Ask your AFF dealer rep for: **Client ID**, **Client Secret**, **Dealer
  ID**
- Env vars: `AFF_CLIENT_ID`, `AFF_CLIENT_SECRET`, `AFF_DEALER_ID`

## Koalafi

- Auth: static API key, `Authorization: Bearer <key>`
- Submit: `POST https://api.koalafi.com/v1/applications`
- Ask your Koalafi partner rep for: **API Key**, **Merchant ID**
- Env vars: `KOALAFI_API_KEY`, `KOALAFI_MERCHANT_ID`

## Progressive Leasing

- Auth: static API key, `x-api-key` header
- Submit: `POST https://api.progleasing.com/pos/v1/applications`
- Ask your Progressive onboarding contact for: **API Key**, **Store
  Number** (Progressive assigns a numeric store ID per physical location
  at onboarding)
- Env vars: `PROGRESSIVE_API_KEY`, `PROGRESSIVE_STORE_NUMBER`

## Snap Finance

- Auth: static API key, `Authorization: ApiKey <key>`
- Submit: `POST https://api.snapfinance.com/v3/applications`
- Ask your Snap merchant rep for: **API Key**, **Merchant ID**
- Env vars: `SNAP_API_KEY`, `SNAP_MERCHANT_ID`

## Kafene

- Auth: static API key, `Authorization: Bearer <key>`
- Submit: `POST https://api.kafene.com/partner/v1/applications`
- Ask your Kafene partner rep for: **API Key**, **Retailer ID**
- Env vars: `KAFENE_API_KEY`, `KAFENE_RETAILER_ID`

---

## What this unlocks

Once any subset of the five is configured, the Financing tab's "Submit"
action on a given lender actually calls that lender's real application
API instead of only advancing the local mock waterfall. The response
(`approved` / `declined` / `pending`, an approved amount, and a
customer-facing application URl where the lender provides one) gets
stored on the application record the same way a manual status update
does today, so the rest of the UI (lender_attempts history, "in progress"
counts on the dashboard) needs no changes.

Recommended order to wire up first: **AFF**, since
`worker/src/lib/drafter.ts`'s system prompt already tells the Drafter to
recommend AFF first to customers ("TX-licensed installment, cheapest if
customer qualifies").
