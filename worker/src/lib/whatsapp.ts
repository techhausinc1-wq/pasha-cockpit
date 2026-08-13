// WhatsApp Business Cloud API — webhook receiver + outbound sender.
//
// Setup required before this does anything real (see docs/WHATSAPP-SETUP.md):
//   WHATSAPP_TOKEN            permanent system-user access token
//   WHATSAPP_PHONE_NUMBER_ID  the Cloud API phone number ID to send from
//   WHATSAPP_VERIFY_TOKEN     arbitrary string, must match what's entered in
//                             the Meta webhook config screen
//   WHATSAPP_APP_SECRET       app secret, used to verify X-Hub-Signature-256
//                             on inbound webhook calls
//
// Meta's webhook contract: GET is the one-time verification handshake:
// https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
// POST is the actual event delivery, signed with the app secret:
// https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validating-payloads

const GRAPH_VERSION = "v20.0";

export interface WhatsAppInboundMessage {
  wa_id: string; // customer's WhatsApp ID (phone number, no +)
  name: string | null; // customer's WhatsApp profile name, if present
  message_id: string;
  text: string;
  timestamp: string; // ISO
}

// ----- GET /api/whatsapp/webhook — Meta's verification handshake -----
export function handleWebhookVerification(url: URL): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// ----- POST /api/whatsapp/webhook — signature check -----
// Meta signs the raw body with the app secret (HMAC-SHA256), header
// "x-hub-signature-256: sha256=<hex>". Must be checked against the RAW
// bytes before JSON parsing, since re-serializing can change byte-for-byte
// equality.
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const secret = Deno.env.get("WHATSAPP_APP_SECRET");
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
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const actualHex = Array.from(new Uint8Array(sigBuf)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");

  // Constant-time compare
  if (actualHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHex.length; i++) {
    diff |= actualHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }
  return diff === 0;
}

// ----- Parse the webhook payload into normalized inbound messages -----
// Payload shape: entry[].changes[].value.{contacts[], messages[]}
// Only handles text messages for now — media/interactive/button replies
// come through with a different `type`, worth adding once the text path
// is proven live.
export function parseWebhookPayload(
  payload: unknown,
): WhatsAppInboundMessage[] {
  const out: WhatsAppInboundMessage[] = [];
  const entries = (payload as any)?.entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    const changes = entry?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = change?.value;
      const messages = value?.messages;
      if (!Array.isArray(messages)) continue;

      const contactsByWaId = new Map<string, string>();
      for (const c of value?.contacts || []) {
        if (c?.wa_id) contactsByWaId.set(c.wa_id, c?.profile?.name ?? null);
      }

      for (const m of messages) {
        if (m?.type !== "text") continue; // media/interactive: add when needed
        out.push({
          wa_id: m.from,
          name: contactsByWaId.get(m.from) ?? null,
          message_id: m.id,
          text: m.text?.body ?? "",
          timestamp: new Date(parseInt(m.timestamp, 10) * 1000).toISOString(),
        });
      }
    }
  }
  return out;
}

// ----- Outbound send -----
export interface SendResult {
  ok: boolean;
  message_id?: string;
  error?: string;
}

export async function sendWhatsAppText(
  to: string,
  body: string,
): Promise<SendResult> {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) {
    return {
      ok: false,
      error: "WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured",
    };
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    },
  );

  if (!res.ok) {
    return {
      ok: false,
      error: `WhatsApp send ${res.status}: ${await res.text()}`,
    };
  }
  const data = await res.json();
  return { ok: true, message_id: data?.messages?.[0]?.id };
}

// Mark a message read (blue ticks) — good practice, not required.
export async function markWhatsAppRead(messageId: string): Promise<void> {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) return;
  await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    },
  ).catch(() => {}); // best-effort
}
