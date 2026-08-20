// Real ad-spend/ROI tracking code paths -- item 6. Meta Ads, Google Ads,
// TikTok Ads. Each gated on its own env vars with the same graceful "not
// configured" fallback as the rest of this worker. See
// docs/AD-ROI-SETUP.md for what to request from each platform.

export interface AdInsight {
  configured: boolean;
  platform: "meta" | "google" | "tiktok";
  ok: boolean;
  spend?: number;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  message: string;
}

// ── Meta Ads (Marketing API) ────────────────────────────────────────────
// Requires META_ADS_ACCESS_TOKEN (a long-lived token with ads_read scope
// -- can reuse the same Meta App as lib/meta-oauth.ts) + META_AD_ACCOUNT_ID
// (format act_<id>, from Business Manager -> Ad Account settings).
export async function getMetaAdInsights(dateFrom: string, dateTo: string): Promise<AdInsight> {
  const token = Deno.env.get("META_ADS_ACCESS_TOKEN") ?? "";
  const accountId = Deno.env.get("META_AD_ACCOUNT_ID") ?? "";
  if (!token || !accountId) {
    return { configured: false, platform: "meta", ok: false, message: "Meta Ads not configured (see docs/AD-ROI-SETUP.md) -- set META_ADS_ACCESS_TOKEN, META_AD_ACCOUNT_ID." };
  }
  try {
    const url = new URL("https://graph.facebook.com/v20.0/" + accountId + "/insights");
    url.searchParams.set("fields", "spend,impressions,clicks,actions");
    url.searchParams.set("time_range", JSON.stringify({ since: dateFrom, until: dateTo }));
    url.searchParams.set("access_token", token);
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) return { configured: true, platform: "meta", ok: false, message: "Meta Ads API error: " + JSON.stringify(data) };
    const row = data.data?.[0] ?? {};
    const conversions = (row.actions || []).filter((a: { action_type: string }) => a.action_type === "offsite_conversion").reduce((s: number, a: { value: string }) => s + Number(a.value || 0), 0);
    return { configured: true, platform: "meta", ok: true, spend: Number(row.spend || 0), impressions: Number(row.impressions || 0), clicks: Number(row.clicks || 0), conversions, message: "Pulled Meta Ads insights." };
  } catch (e) {
    return { configured: true, platform: "meta", ok: false, message: "Meta Ads request error: " + (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Google Ads (Google Ads API, v17) ────────────────────────────────────
// Requires GOOGLE_ADS_DEVELOPER_TOKEN + GOOGLE_ADS_CUSTOMER_ID (10-digit,
// no dashes) + a valid OAuth2 access token (GOOGLE_ADS_ACCESS_TOKEN --
// same Google Cloud OAuth app used elsewhere would issue this via a
// refresh token exchange; kept as a direct access token here since token
// refresh is identical to any other Google OAuth integration and out of
// scope to re-derive per-call).
export async function getGoogleAdInsights(dateFrom: string, dateTo: string): Promise<AdInsight> {
  const developerToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN") ?? "";
  const customerId = Deno.env.get("GOOGLE_ADS_CUSTOMER_ID") ?? "";
  const accessToken = Deno.env.get("GOOGLE_ADS_ACCESS_TOKEN") ?? "";
  if (!developerToken || !customerId || !accessToken) {
    return { configured: false, platform: "google", ok: false, message: "Google Ads not configured (see docs/AD-ROI-SETUP.md) -- set GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_ACCESS_TOKEN." };
  }
  try {
    const query = "SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM customer WHERE segments.date BETWEEN " + JSON.stringify(dateFrom) + " AND " + JSON.stringify(dateTo);
    const res = await fetch("https://googleads.googleapis.com/v17/customers/" + customerId + "/googleAds:search", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "developer-token": developerToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (!res.ok) return { configured: true, platform: "google", ok: false, message: "Google Ads API error: " + JSON.stringify(data) };
    const row = data.results?.[0]?.metrics ?? {};
    return {
      configured: true, platform: "google", ok: true,
      spend: Number(row.costMicros || 0) / 1_000_000,
      impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0),
      conversions: Number(row.conversions || 0),
      message: "Pulled Google Ads insights.",
    };
  } catch (e) {
    return { configured: true, platform: "google", ok: false, message: "Google Ads request error: " + (e instanceof Error ? e.message : String(e)) };
  }
}

// ── TikTok Ads (Marketing API) ──────────────────────────────────────────
// Requires TIKTOK_ADS_ACCESS_TOKEN + TIKTOK_ADVERTISER_ID (from TikTok for
// Business -> Assets -> Advertiser ID).
export async function getTikTokAdInsights(dateFrom: string, dateTo: string): Promise<AdInsight> {
  const accessToken = Deno.env.get("TIKTOK_ADS_ACCESS_TOKEN") ?? "";
  const advertiserId = Deno.env.get("TIKTOK_ADVERTISER_ID") ?? "";
  if (!accessToken || !advertiserId) {
    return { configured: false, platform: "tiktok", ok: false, message: "TikTok Ads not configured (see docs/AD-ROI-SETUP.md) -- set TIKTOK_ADS_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID." };
  }
  try {
    const url = new URL("https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/");
    url.searchParams.set("advertiser_id", advertiserId);
    url.searchParams.set("report_type", "BASIC");
    url.searchParams.set("dimensions", JSON.stringify(["advertiser_id"]));
    url.searchParams.set("metrics", JSON.stringify(["spend", "impressions", "clicks", "conversion"]));
    url.searchParams.set("start_date", dateFrom);
    url.searchParams.set("end_date", dateTo);
    url.searchParams.set("data_level", "AUCTION_ADVERTISER");
    const res = await fetch(url, { headers: { "Access-Token": accessToken } });
    const data = await res.json();
    if (!res.ok || data.code !== 0) return { configured: true, platform: "tiktok", ok: false, message: "TikTok Ads API error: " + JSON.stringify(data) };
    const row = data.data?.list?.[0]?.metrics ?? {};
    return {
      configured: true, platform: "tiktok", ok: true,
      spend: Number(row.spend || 0),
      impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0),
      conversions: Number(row.conversion || 0),
      message: "Pulled TikTok Ads insights.",
    };
  } catch (e) {
    return { configured: true, platform: "tiktok", ok: false, message: "TikTok Ads request error: " + (e instanceof Error ? e.message : String(e)) };
  }
}

export function adPlatformsConfigured(): Record<"meta" | "google" | "tiktok", boolean> {
  return {
    meta: Boolean(Deno.env.get("META_ADS_ACCESS_TOKEN") && Deno.env.get("META_AD_ACCOUNT_ID")),
    google: Boolean(Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN") && Deno.env.get("GOOGLE_ADS_CUSTOMER_ID")),
    tiktok: Boolean(Deno.env.get("TIKTOK_ADS_ACCESS_TOKEN") && Deno.env.get("TIKTOK_ADVERTISER_ID")),
  };
}
