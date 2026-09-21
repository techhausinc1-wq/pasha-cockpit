// Receipt photo -> structured order data, item 3 from Pasha's 2026-09-18
// meeting notes: some staff fill out the paper "Furniture & Mattress
// Warehouse" order form by hand and it needs uploading/photographing into
// the system. Same Anthropic Messages API call shape as drafter.ts/reels.ts
// (generateCaptions), but with an image content block instead of text-only,
// requesting Claude vision to read the real paper form's fields back as
// JSON. This function only EXTRACTS -- it never saves anything on its own.
// The frontend always shows the result in the real New Invoice form for a
// human to review/correct before it's actually saved, exactly like manual
// entry -- an OCR misread becoming a real order with nobody checking it
// would be a real, serious mistake, so this is deliberately not a one-click
// auto-save path.

import { getEnv } from "./env.ts";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-5";

export interface ParsedReceiptItem {
  description: string;
  sku: string | null;
  qty: number;
  unit_price: number | null;
}

export interface ParsedReceipt {
  customer_name: string | null;
  phone: string | null;
  address: string | null;
  payment_method: string | null;
  items: ParsedReceiptItem[];
  total: number | null;
  low_confidence_fields: string[];
}

export async function scanReceiptPhoto(imageDataUrl: string): Promise<ParsedReceipt> {
  const key = getEnv("ANTHROPIC_KEY");
  if (!key) throw new Error("ANTHROPIC_KEY not set");

  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(imageDataUrl);
  if (!match) throw new Error("imageDataUrl must be a base64 image data URL");
  const [, mediaType, base64] = match;

  const sys =
    "You read handwritten and printed furniture-store paper order forms (210 Discount Furniture / Furniture and Mattress Warehouse) from a photo and return ONLY what you can actually read. " +
    "Never guess or invent a value you can't clearly make out -- leave it null instead, and list the field's name in low_confidence_fields if you could partly read it but aren't sure. " +
    "Handwriting is often messy; it is much better to say a field is unreadable than to silently make up a plausible-looking value. " +
    "Return STRICT JSON only, matching this exact shape, no prose outside the JSON: " +
    '{"customer_name": string|null, "phone": string|null, "address": string|null, "payment_method": string|null, "items": [{"description": string, "sku": string|null, "qty": number, "unit_price": number|null}], "total": number|null, "low_confidence_fields": string[]}';

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: sys,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "Read this order form and return the JSON now." },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error("Anthropic " + res.status + ": " + await res.text());
  const data = await res.json();
  const raw = (data.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: ParsedReceipt;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Receipt scan did not return parseable JSON");
    parsed = JSON.parse(jsonMatch[0]);
  }
  // Defensive normalization -- never let a malformed model response produce
  // a crash downstream in the frontend form-filler.
  if (!Array.isArray(parsed.items)) parsed.items = [];
  if (!Array.isArray(parsed.low_confidence_fields)) parsed.low_confidence_fields = [];
  return parsed;
}
