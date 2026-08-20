# Ad-spend / ROI setup — Meta Ads, Google Ads, TikTok Ads

Written 2026-08-18. Purpose: make the cockpit's ad dashboard show real
spend, impressions, clicks, and conversions per platform instead of the
mock `ADS` numbers in `docs/index.html`.

**The code side is done** — `worker/src/lib/ad-platforms.ts`
(`getMetaAdInsights`, `getGoogleAdInsights`, `getTikTokAdInsights`) and the
`GET /api/ads/insights` route in `worker/src/main.ts` are live and ready
for real credentials. Each platform is independent: any subset can be
configured and the rest report "not configured" without breaking the
route (`GET /api/ads/insights` always returns all three keys, each with
its own `configured`/`ok` flags).

Requires the `ads.read` atom (owner role only by default — see
`worker/src/lib/rbac.ts`).

---

## Meta Ads

Reuses the same Meta App as `docs/META-BUSINESS-SETUP.md` — no separate
app needed, just an additional permission.

1. In the same Meta App used for Facebook/Instagram posting, request the
   `ads_read` permission (**App Review → Permissions and Features**) —
   Standard Access, no review needed once Business Verification is done
   (same phase as the posting scopes in META-BUSINESS-SETUP.md).
2. Get the **Ad Account ID** from **https://business.facebook.com/** →
   Business Settings → Accounts → Ad Accounts (format `act_123456789`).
3. Issue a long-lived access token with `ads_read` scope — either reuse
   the token `lib/meta-oauth.ts` already stores after Pasha connects (a
   future refinement), or generate one directly in Graph API Explorer for
   now.
4. Set:
   - `META_ADS_ACCESS_TOKEN`
   - `META_AD_ACCOUNT_ID`

## Google Ads

1. Go to **https://ads.google.com/**, sign in as the account that manages
   210 Discount Furniture's Google Ads campaigns (or create one).
2. Apply for a **developer token** at **https://ads.google.com/aw/apicenter**
   under the Google Ads manager account — Google reviews this
   (typically same-day for a small read-only integration, can take longer).
3. Create OAuth2 credentials in **https://console.cloud.google.com/** (a
   Google Cloud project, OAuth client ID — same kind of setup as any other
   Google API integration TechHaus tools already use) and complete the
   consent flow once to get a refresh token, then exchange it for an
   access token (standard Google OAuth2 token endpoint,
   `https://oauth2.googleapis.com/token`).
4. Note the **Customer ID** (10 digits, no dashes) from the top-right of
   the Google Ads UI.
5. Set:
   - `GOOGLE_ADS_DEVELOPER_TOKEN`
   - `GOOGLE_ADS_CUSTOMER_ID`
   - `GOOGLE_ADS_ACCESS_TOKEN` (short-lived — a scheduled refresh job is
     the natural next step once this is live; for now, re-issuing it
     manually every ~55 minutes during testing is enough to prove the pipe
     works)

## TikTok Ads

See `docs/TIKTOK-SETUP.md` Phase 2 — same env vars
(`TIKTOK_ADS_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID`) power both the ad-ROI
dashboard here and nothing else; TikTok publishing (Phase 1 of that doc)
is a completely separate credential set.

## What this unlocks

Once any subset of the above is set, `GET /api/ads/insights` (used by the
Ads tab) returns real numbers for that platform instead of "not
configured" — spend, impressions, clicks, and conversions for whatever
date range is requested (defaults to the trailing 30 days).
