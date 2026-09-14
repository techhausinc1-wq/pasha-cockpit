// Facebook Messenger + Instagram DM webhook receiver -- the piece
// lib/meta-oauth.ts's own comment flagged as the real next step, once
// `pages_messaging` + `instagram_manage_messages` are granted via Meta App
// Review (see docs/META-BUSINESS-SETUP.md Phase 3). Code-complete now so
// it's ready the moment that review is granted; cannot receive real traffic
// before then -- that's Meta's review timeline, not a code gap.
//
// Mirrors lib/whatsapp.ts's verify/signature pattern exactly (same Meta
// Graph API webhook contract, just a different product: "Webhooks" on the
// App itself rather than the WhatsApp product).
//
// Setup required before this does anything real (see
// docs/META-BUSINESS-SETUP.md Phase 3):
//   META_APP_SECRET             already set for OAuth (lib/meta-oauth.ts) --
//                                reused here to verify X-Hub-Signature-256
//   META_WEBHOOK_VERIFY_TOKEN   arbitrary string, must match what's entered
//                                in the Meta app's Webhooks config screen

import { getMetaConn } from "./meta-oauth.ts";

const GRAPH_VERSION = "v20.0";

export interface MetaInboundMessage {
  surface: "pg" | "ig";
  senderId: string; // PSID (Messenger) or IGSID (Instagram)
  recipientId: string; // the Page ID or IG business ID this came in on
  messageId: string;
  text: string;
  timestamp: string; // ISO
}

// ----- GET /api/meta/webhook -- Meta's verification handshake -----
// Identical contract to WhatsApp's: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
export function handleMetaWebhookVerification(url: URL): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// ----- POST /api/meta/webhook -- signature check -----
// Same HMAC-SHA256-over-raw-body contract as WhatsApp, same app secret
// (one Meta App covers both WhatsApp and Messenger/Instagram products).
export async function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const secret = Deno.env.get("META_APP_SECRET");
  if (!secret) return false;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expectedHex = signatureHeader.slice("sha256=".length);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const actualHex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");

  if (actualHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHex.length; i++) {
    diff |= actualHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }
  return diff === 0;
}

// ----- Parse the webhook payload into normalized inbound messages -----
// Messenger payload: {"object":"page","entry":[{"id":"<PAGE_ID>","messaging":[{"sender":{"id":"<PSID>"},"recipient":{"id":"<PAGE_ID>"},"timestamp":...,"message":{"mid":"...","text":"..."}}]}]}
// Instagram payload: identical shape, "object":"instagram", ids are IG business/IGSID.
// `object` is the reliable discriminator -- no need to cross-reference
// connected accounts just to know which surface a message is.
// Only handles text messages for now, same scope-limit as whatsapp.ts's
// parser -- attachments/quick-replies come through with a different shape,
// worth adding once the text path is proven live.
export function parseMetaWebhookPayload(payload: unknown): MetaInboundMessage[] {
  const out: MetaInboundMessage[] = [];
  const obj = (payload as { object?: string })?.object;
  if (obj !== "page" && obj !== "instagram") return out;
  const surface: "pg" | "ig" = obj === "page" ? "pg" : "ig";

  const entries = (payload as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    const messaging = (entry as { messaging?: unknown })?.messaging;
    if (!Array.isArray(messaging)) continue;
    for (const m of messaging as Array<Record<string, unknown>>) {
      const message = m.message as { mid?: string; text?: string; is_echo?: boolean } | undefined;
      if (!message?.text || message.is_echo) continue; // is_echo: our own outbound message reflected back, not inbound
      const sender = m.sender as { id?: string } | undefined;
      const recipient = m.recipient as { id?: string } | undefined;
      if (!sender?.id || !recipient?.id) continue;
      out.push({
        surface,
        senderId: sender.id,
        recipientId: recipient.id,
        messageId: message.mid ?? "",
        text: message.text,
        timestamp: new Date(Number(m.timestamp ?? Date.now())).toISOString(),
      });
    }
  }
  return out;
}

// Best-effort sender display name via the connected Page's access token --
// Messenger/Instagram webhook events don't include a profile name inline
// the way WhatsApp's `contacts[]` does, so a separate Graph API call is
// needed. Falls back to null (caller falls back to the raw sender ID) on
// any failure -- honest degradation, not a hard dependency.
export async function resolveMetaSenderName(surface: "pg" | "ig", accountId: string, senderId: string): Promise<string | null> {
  try {
    const conn = await getMetaConn();
    if (!conn) return null;
    const page = conn.pages.find((p) => p.id === accountId || p.igBusinessId === accountId);
    const token = page?.accessToken;
    if (!token) return null;
    if (surface === "pg") {
      const res = await fetch("https://graph.facebook.com/" + GRAPH_VERSION + "/" + encodeURIComponent(senderId) + "?fields=first_name,last_name&access_token=" + encodeURIComponent(token));
      const data = await res.json();
      if (!res.ok) return null;
      const name = [data.first_name, data.last_name].filter(Boolean).join(" ");
      return name || null;
    }
    // Instagram: the Conversations API's participant field carries the
    // username; a plain /{igsid} lookup isn't part of the public Graph API
    // the way Messenger's is, so this is left as a known follow-up rather
    // than guessed at.
    return null;
  } catch {
    return null;
  }
}

// account_label lookup, same "honest fallback if not yet connected" pattern
// as the rest of this module.
export async function resolveMetaAccountLabel(surface: "pg" | "ig", accountId: string): Promise<string> {
  const conn = await getMetaConn();
  if (!conn) return (surface === "pg" ? "Facebook Page" : "Instagram") + " - " + accountId;
  const page = conn.pages.find((p) => p.id === accountId || p.igBusinessId === accountId);
  if (surface === "pg") return "FB Page - " + (page?.name ?? accountId);
  return "Instagram - " + (page?.igUsername ?? accountId);
}
