// TikTok Login Kit OAuth -- the callback route flagged as "does not exist
// yet; the natural next step" in docs/TIKTOK-SETUP.md Phase 1 step 5.
// Structurally identical to lib/meta-oauth.ts's Facebook flow (state
// nonce in KV, code -> token exchange, long-lived connection stored in
// KV) -- same proven pattern, different token endpoint shape.
//
// Once connected, this replaces the static TIKTOK_ACCESS_TOKEN env var
// from docs/TIKTOK-SETUP.md Phase 1 step 7 with a real per-creator OAuth
// connection (auto-refreshed), while still falling back to the env var if
// no OAuth connection has been completed yet -- same "graceful, not
// all-or-nothing" pattern as the rest of this worker.
//
// Setup required (see docs/TIKTOK-SETUP.md Phase 1):
//   TIKTOK_CLIENT_KEY
//   TIKTOK_CLIENT_SECRET

import { getKv, kvGetDoc, kvSetDoc, nanoid } from "./kv.ts";

const CONN_RES = "tiktok_conn";
const STATE_RES = "tiktok_oauth_state";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const TIKTOK_CLIENT_KEY = Deno.env.get("TIKTOK_CLIENT_KEY") ?? "";
const TIKTOK_CLIENT_SECRET = Deno.env.get("TIKTOK_CLIENT_SECRET") ?? "";

export interface TikTokConnection {
  accessToken: string;
  refreshToken: string;
  openId: string;
  expiresAt: number; // ms epoch
  connectedAt: number;
}

export function tiktokOAuthConfigured(): boolean {
  return Boolean(TIKTOK_CLIENT_KEY && TIKTOK_CLIENT_SECRET);
}

export async function getTikTokConn(): Promise<TikTokConnection | null> {
  return kvGetDoc<TikTokConnection>(CONN_RES);
}

async function saveTikTokConn(conn: TikTokConnection): Promise<void> {
  await kvSetDoc(CONN_RES, conn);
}

export async function saveOAuthState(state: string): Promise<void> {
  const kv = await getKv();
  await kv.set(["pasha", STATE_RES, state], true, { expireIn: OAUTH_STATE_TTL_MS });
}
export async function consumeOAuthState(state: string): Promise<boolean> {
  const kv = await getKv();
  const key = ["pasha", STATE_RES, state];
  const entry = await kv.get(key);
  if (!entry.value) return false;
  await kv.delete(key);
  return true;
}

// video.publish for Content Posting API (lib/tiktok.ts), user.info.basic so
// the connect step can show which TikTok account is linked.
const TIKTOK_SCOPES = ["video.publish", "user.info.basic"];

export function buildAuthUrl(redirectUri: string, state: string): string {
  const auth = new URL("https://www.tiktok.com/v2/auth/authorize/");
  auth.searchParams.set("client_key", TIKTOK_CLIENT_KEY);
  auth.searchParams.set("scope", TIKTOK_SCOPES.join(","));
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("state", state);
  return auth.toString();
}

export async function startConnect(redirectUri: string): Promise<string> {
  const state = nanoid(32);
  await saveOAuthState(state);
  return buildAuthUrl(redirectUri, state);
}

// code -> {access_token, refresh_token, expires_in, open_id} -- single-hop,
// unlike Meta's two-hop short->long-lived exchange. TikTok tokens expire in
// 24h; refreshTikTokToken() below handles renewal via the refresh_token,
// which itself is valid for 365 days.
export async function completeConnect(code: string, redirectUri: string): Promise<TikTokConnection> {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({
      client_key: TIKTOK_CLIENT_KEY,
      client_secret: TIKTOK_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error("TikTok token exchange failed: " + JSON.stringify(data));
  const conn: TikTokConnection = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    openId: data.open_id,
    expiresAt: Date.now() + Number(data.expires_in ?? 86400) * 1000,
    connectedAt: Date.now(),
  };
  await saveTikTokConn(conn);
  return conn;
}

// Called lazily by lib/tiktok.ts before each publish -- refreshes only if
// within 5 minutes of expiry, same margin pattern as any short-lived-token
// integration. Returns null if there's no connection to refresh (caller
// falls back to the static TIKTOK_ACCESS_TOKEN env var).
export async function getValidTikTokAccessToken(): Promise<string | null> {
  const conn = await getTikTokConn();
  if (!conn) return null;
  if (conn.expiresAt - Date.now() > 5 * 60 * 1000) return conn.accessToken;
  try {
    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: conn.refreshToken,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) return conn.accessToken; // best-effort -- keep using the old one, let the publish call itself surface the real error
    const refreshed: TikTokConnection = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? conn.refreshToken,
      openId: conn.openId,
      expiresAt: Date.now() + Number(data.expires_in ?? 86400) * 1000,
      connectedAt: conn.connectedAt,
    };
    await saveTikTokConn(refreshed);
    return refreshed.accessToken;
  } catch {
    return conn.accessToken;
  }
}
