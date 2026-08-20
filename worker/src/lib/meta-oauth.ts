// Facebook/Instagram OAuth connection point -- item 5. Chosen approach:
// implemented directly in pasha-cockpit's OWN worker (not as a new tenant
// on igor-hq's shared worker), even though igor-hq/worker/main.ts already
// has this exact Meta OAuth plumbing built and working for Igors own
// tenant (see its META_APP_ID/META_APP_SECRET, metaCallbackExchange,
// metaFetchPagesAndIG). Reasons: pasha-cockpit already has its own
// separately-deployed worker and its own Deno KV namespace (see lib/kv.ts)
// -- keeping the OAuth token colocated with the rest of Pashas data avoids
// a cross-worker dependency on Igors infrastructure, and matches the
// explicit alternative already documented in docs/META-BUSINESS-SETUP.md
// ("or give the cockpit its own worker"). The route shapes, scopes, and
// token-exchange logic below are copied from igor-hq/worker/main.ts
// (proven, working pattern) -- only the storage/tenancy differs.
//
// What this delivers: Pasha visits GET /oauth/facebook/start once, logs
// into Facebook Business, and the callback stores a long-lived Page access
// token for every Page + linked IG Business account he manages.
//
// What this does NOT yet do (clearly marked next step, not faked): pull
// real FB/IG DMs into the /api/threads inbox the way WhatsApp already
// does. That needs the `pages_messaging` + `instagram_manage_messages`
// scopes, which require Meta App Review (see docs/META-BUSINESS-SETUP.md
// Phase 3) -- a webhook subscription (same shape as
// lib/whatsapp.ts's /api/whatsapp/webhook) is the natural next step once
// that review is granted. Posting (reels/promos) works today without
// review; message ingestion does not yet exist.

import { getKv, kvGetDoc, kvSetDoc, nanoid } from "./kv.ts";

const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const CONN_RES = "meta_conn";
const STATE_RES = "oauth_state";

// pages_messaging + instagram_manage_messages deliberately omitted here --
// those require Meta App Review (see docs/META-BUSINESS-SETUP.md Phase 3)
// and are not needed for the posting/connect flow this ships today.
export const META_SCOPES: string[] = [];
META_SCOPES.push("pages_manage_posts");
META_SCOPES.push("pages_read_engagement");
META_SCOPES.push("pages_show_list");
META_SCOPES.push("instagram_basic");
META_SCOPES.push("instagram_content_publish");
META_SCOPES.push("business_management");
META_SCOPES.push("ads_read");

export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  igBusinessId?: string;
  igUsername?: string;
}
export interface MetaConnection {
  fbUserToken: string;
  pages: MetaPage[];
  connectedAt: number;
}

export async function getMetaConn(): Promise<MetaConnection | null> {
  return kvGetDoc<MetaConnection>(CONN_RES);
}
export async function saveMetaConn(conn: MetaConnection): Promise<void> {
  await kvSetDoc(CONN_RES, conn);
}
export function metaConfigured(): boolean {
  return Boolean(META_APP_ID && META_APP_SECRET);
}

export async function saveOAuthState(state: string): Promise<void> {
  const kv = await getKv();
  const key = ["pasha", STATE_RES, state];
  await kv.set(key, true, { expireIn: OAUTH_STATE_TTL_MS });
}
export async function consumeOAuthState(state: string): Promise<boolean> {
  const kv = await getKv();
  const key = ["pasha", STATE_RES, state];
  const entry = await kv.get(key);
  if (!entry.value) return false;
  await kv.delete(key);
  return true;
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const auth = new URL("https://www.facebook.com/v20.0/dialog/oauth");
  auth.searchParams.set("client_id", META_APP_ID);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("state", state);
  auth.searchParams.set("scope", META_SCOPES.join(","));
  auth.searchParams.set("response_type", "code");
  return auth.toString();
}

// Short-lived code -> short-lived token -> long-lived (60 day) token,
// same two-hop exchange igor-hq/worker/main.ts's metaCallbackExchange
// does.
async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const tokenUrl = new URL("https://graph.facebook.com/v20.0/oauth/access_token");
  tokenUrl.searchParams.set("client_id", META_APP_ID);
  tokenUrl.searchParams.set("client_secret", META_APP_SECRET);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);
  const res = await fetch(tokenUrl);
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error("Meta token exchange failed: " + JSON.stringify(data));
  const longUrl = new URL("https://graph.facebook.com/v20.0/oauth/access_token");
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", META_APP_ID);
  longUrl.searchParams.set("client_secret", META_APP_SECRET);
  longUrl.searchParams.set("fb_exchange_token", data.access_token);
  const longRes = await fetch(longUrl);
  const longData = await longRes.json();
  if (!longRes.ok || !longData.access_token) throw new Error("Meta long-lived exchange failed: " + JSON.stringify(longData));
  return longData.access_token as string;
}

async function fetchPagesAndIG(userToken: string): Promise<MetaPage[]> {
  const url = "https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=" + encodeURIComponent(userToken);
  const pagesRes = await fetch(url);
  const pagesData = await pagesRes.json();
  if (!pagesRes.ok || !Array.isArray(pagesData.data)) throw new Error("Meta pages fetch failed: " + JSON.stringify(pagesData));
  const pages: MetaPage[] = [];
  for (const p of pagesData.data) {
    let igBusinessId: string | undefined;
    let igUsername: string | undefined;
    if (p.instagram_business_account?.id) {
      igBusinessId = p.instagram_business_account.id;
      const igUrl = "https://graph.facebook.com/v20.0/" + igBusinessId + "?fields=username&access_token=" + encodeURIComponent(p.access_token);
      const igRes = await fetch(igUrl);
      const igData = await igRes.json().catch(() => ({}));
      if (igRes.ok && igData.username) igUsername = igData.username;
    }
    pages.push({ id: p.id, name: p.name, accessToken: p.access_token, igBusinessId, igUsername });
  }
  return pages;
}

// Full connect flow: called from main.ts's GET /oauth/facebook/callback
// route with the code Meta redirected back with.
export async function completeConnect(code: string, redirectUri: string): Promise<MetaConnection> {
  const fbUserToken = await exchangeCodeForToken(code, redirectUri);
  const pages = await fetchPagesAndIG(fbUserToken);
  const conn: MetaConnection = { fbUserToken, pages, connectedAt: Date.now() };
  await saveMetaConn(conn);
  return conn;
}

export async function startConnect(redirectUri: string): Promise<string> {
  const state = nanoid(32);
  await saveOAuthState(state);
  return buildAuthUrl(redirectUri, state);
}

// ── Publishing (works today, no App Review needed) ─────────────────────
export async function postFacebookPhoto(pageId: string, pageAccessToken: string, imageUrl: string, caption: string) {
  const url = "https://graph.facebook.com/v20.0/" + encodeURIComponent(pageId) + "/photos";
  const body = new URLSearchParams({ url: imageUrl, caption, access_token: pageAccessToken, published: "true" });
  const res = await fetch(url, { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error?.message || JSON.stringify(data) };
  return { ok: true, postId: data.post_id ?? data.id };
}

export async function postInstagramImage(igUserId: string, pageAccessToken: string, imageUrl: string, caption: string) {
  const containerUrl = "https://graph.facebook.com/v20.0/" + encodeURIComponent(igUserId) + "/media";
  const containerBody = new URLSearchParams({ image_url: imageUrl, caption, access_token: pageAccessToken });
  const containerRes = await fetch(containerUrl, { method: "POST", body: containerBody });
  const containerData = await containerRes.json().catch(() => ({}));
  if (!containerRes.ok || !containerData.id) {
    return { ok: false, step: "create_container", error: containerData.error?.message || JSON.stringify(containerData) };
  }
  const creationId = containerData.id;
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((r) => setTimeout(r, 750));
    const statusUrl = "https://graph.facebook.com/v20.0/" + encodeURIComponent(creationId) + "?fields=status_code&access_token=" + encodeURIComponent(pageAccessToken);
    const statusRes = await fetch(statusUrl);
    const statusData = await statusRes.json().catch(() => ({}));
    if (statusData.status_code === "FINISHED") break;
    if (statusData.status_code === "ERROR") return { ok: false, step: "container_status", error: "Container processing failed" };
  }
  const publishUrl = "https://graph.facebook.com/v20.0/" + encodeURIComponent(igUserId) + "/media_publish";
  const publishBody = new URLSearchParams({ creation_id: creationId, access_token: pageAccessToken });
  const publishRes = await fetch(publishUrl, { method: "POST", body: publishBody });
  const publishData = await publishRes.json().catch(() => ({}));
  if (!publishRes.ok || !publishData.id) {
    return { ok: false, step: "publish", error: publishData.error?.message || JSON.stringify(publishData) };
  }
  return { ok: true, postId: publishData.id };
}

// ── NEXT STEP, not yet implemented: real FB/IG message ingestion ───────
// Once `pages_messaging` + `instagram_manage_messages` are granted via
// Meta App Review (docs/META-BUSINESS-SETUP.md Phase 3), add:
//   1. A webhook subscription for each connected Page (Graph API
//      /{page-id}/subscribed_apps), same idea as WhatsApps webhook.
//   2. A POST /api/meta/webhook route in main.ts, verified the same way
//      lib/whatsapp.ts's verifyWebhookSignature() verifies WhatsApps
//      (HMAC-SHA256 over the raw body with the app secret).
//   3. Normalize inbound Messenger/IG DM events into the same
//      SampleThread shape lib/sample-data.ts already uses for WhatsApp
//      (surface: "pg" | "ig"), via upsertWhatsAppThread()s sibling
//      function -- so the unified inbox picks them up with zero frontend
//      changes, exactly like WhatsApp did.
// Intentionally not stubbed as fake data -- there is nothing to poll or
// receive until the scopes are granted, so a stub would either silently
// do nothing (misleading) or throw (unhelpful). This comment is the
// honest state of that gap.
