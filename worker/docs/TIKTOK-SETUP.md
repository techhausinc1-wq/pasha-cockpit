# TikTok setup — for real reel publishing + ad-spend data in the cockpit

Written 2026-08-18. Purpose: connect TikTok for Business so the Reels tab
can publish generated videos for real, and the ad-ROI dashboard can pull
real TikTok Ads spend/performance numbers.

**The code side is done** — `worker/src/lib/tiktok.ts` (Content Posting
API, video publish) and `worker/src/lib/ad-platforms.ts`
(`getTikTokAdInsights`, TikTok Ads Marketing API) are live and ready for
real credentials. What is left is entirely TikTok developer-portal steps.
Until then, `/api/reels/publish/tiktok` and the TikTok slice of
`/api/ads/insights` both return a clear "not configured" message instead
of failing the request — same graceful-fallback pattern as every other
integration in this app.

This is two separate TikTok surfaces with two separate app types:

| Capability | TikTok app type | Env vars |
|---|---|---|
| Publish a generated reel | TikTok Login Kit + Content Posting API | `TIKTOK_ACCESS_TOKEN` |
| Ad-spend/ROI numbers | TikTok for Business (Marketing API) | `TIKTOK_ADS_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID` |

---

## Phase 1 — Publishing (Content Posting API)

1. Go to **https://developers.tiktok.com/** and sign in with the account
   that should own the store's TikTok presence long-term.
2. **Manage apps → Create an app**. Name it something like
   `210 Discount Furniture Cockpit`.
3. Under **Products**, add **Login Kit** and **Content Posting API**.
4. Note the **Client key** and **Client secret** from the app's Basic
   Information page.
5. Add a redirect URI for the OAuth flow (pattern:
   `https://pasha-cockpit.techhausinc1.deno.net/oauth/tiktok/callback` —
   this callback route does not exist yet; it is the natural next step,
   structurally identical to `worker/src/lib/meta-oauth.ts`'s Facebook
   flow, once this app is approved).
6. TikTok's Content Posting API requires an **audit** before a video can
   post as fully public — until that is approved, `lib/tiktok.ts` posts
   with `privacy_level: "SELF_ONLY"` (draft/private to the account), which
   needs no audit and is safe to use immediately for verifying the pipe
   works end to end.
7. Once a real user access token exists (from the Login Kit OAuth flow,
   scope `video.publish`), set:
   - `TIKTOK_ACCESS_TOKEN`

At that point, the Reels tab's "Publish to TikTok" action goes from
"not configured" to actually posting.

## Phase 2 — Ad-spend / ROI (Marketing API)

1. Go to **https://business.tiktok.com/**, sign in as the ad account
   owner.
2. Create (or use an existing) **TikTok for Business** app under
   **https://ads.tiktok.com/marketing_api/** — this is a separate
   developer console from Login Kit.
3. Note the **Advertiser ID** from Assets → Advertiser accounts.
4. Generate an access token with `report:read` scope (via the Marketing
   API's own OAuth flow, or a long-lived token issued directly to a
   verified app in some regions — TikTok's console walks through
   whichever path applies to the account).
5. Set:
   - `TIKTOK_ADS_ACCESS_TOKEN`
   - `TIKTOK_ADVERTISER_ID`

At that point, the ad-ROI dashboard's TikTok row goes from "not
configured" to pulling real spend/impressions/clicks/conversions via
`GET /open_api/v1.3/report/integrated/get/`.

## Notes

- These are two unrelated TikTok credential sets — publishing working does
  not mean ad-ROI data is available, and vice versa. Both are optional
  independently; the rest of the cockpit works with neither configured.
- TikTok's developer console changes fairly often — if an exact menu path
  above is stale, the credential *names* (Client key/secret, Advertiser
  ID, access token) are stable concepts to search for regardless of the
  current UI.
