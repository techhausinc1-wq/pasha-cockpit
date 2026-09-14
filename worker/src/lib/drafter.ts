// Drafter — the Heisenbug-OS agent that composes outbound message replies
// in the operator's voice, grounded in the catalog and the financing waterfall.
//
// Per spec §6.1, the Drafter loop is:
// 1. Classify the inbound message's intent in <2s
// 2. Match the product being asked about against the catalog
// 3. Compose a draft following the master template for that intent
// 4. Always volunteer financing for budget signals
// 5. End with foot-traffic CTA + open-until-X-pm hook
//
// Returns the draft for human review; never auto-sends.

import { getEnv } from "./env.ts";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-5";

export type Intent =
  | "stock-check" // "is it still available?"
  | "price-check" // "how much?"
  | "financing" // "do you finance?", "no credit"
  | "location" // "where are you?", "hours?"
  | "delivery" // "do you deliver to X?", "how much delivery?"
  | "negotiation" // "will you take $X?", "any discount?"
  | "general"; // everything else

export interface InboundContext {
  customer_name: string;
  customer_handle?: string;
  surface: "mp" | "pg" | "ig" | "wa"; // marketplace / page / instagram / whatsapp
  account_label: string;
  thread_history: Array<
    { from: "customer" | "worker"; text: string; at: string }
  >;
  latest_message: string;
  product_match?: {
    slug: string;
    name: string;
    price: number | null;
    price_text: string | null;
    sku?: string | null;
    photos: string[];
    color_options?: string[];
  };
  // Optional context for richer drafts
  in_stock?: boolean | "unknown";
  has_color_variants?: boolean;
  store_open_until?: string; // e.g. "7pm" — passed through to CTA
  worker_name?: string; // who's drafting (so the reply matches their voice)
}

export interface DraftResult {
  intent: Intent;
  intent_confidence: number; // 0..1
  draft_reply: string;
  reasoning: string;
  volunteered_financing: boolean;
  cta_to_visit: boolean;
  notes_for_human: string[]; // anything the human should double-check before sending
}

// =============================================================
// Intent classification — fast, rule-based first, then LLM if ambiguous
// =============================================================
const RULES: Array<{ intent: Intent; patterns: RegExp[] }> = [
  {
    intent: "stock-check",
    patterns: [
      /\b(still\s+(have|available|in\s+stock|got))\b/i,
      /\b(do\s+you\s+have)\b/i,
      /\b(en\s+stock|disponible|todav[ií]a)\b/i,
    ],
  },
  {
    intent: "price-check",
    patterns: [
      /\b(how\s+much|price|cuesta|cu[aá]nto|cu[aá]ndo\s+vale|cu[aá]nt[oa]\s+es)\b/i,
      /\$\s*\d/,
    ],
  },
  {
    intent: "financing",
    patterns: [
      /\b(financ|payment\s+plan|no\s+credit|bad\s+credit|lease|monthly|snap|acima|aff|koalafi|progressive|kafene)\b/i,
      /\b(financiamiento|cr[eé]dito|sin\s+cr[eé]dito|pagos|mensual)\b/i,
    ],
  },
  {
    intent: "location",
    patterns: [
      /\b(where\s+(are|is)|address|location|open|hours|when\s+open|d[oó]nde)\b/i,
    ],
  },
  {
    intent: "delivery",
    patterns: [
      /\b(deliver|delivery|ship|ship\s+to|pickup|pick\s+up|haul|entrega)\b/i,
    ],
  },
  {
    intent: "negotiation",
    patterns: [
      /\b(will\s+you\s+take|best\s+price|lower|discount|deal|haggle|negotiate|cash)\b/i,
      /\b(rebaja|descuento|mejor\s+precio)\b/i,
    ],
  },
];

export function classifyByRules(
  text: string,
): { intent: Intent; confidence: number } {
  const lower = text.toLowerCase();
  for (const r of RULES) {
    for (const p of r.patterns) {
      if (p.test(text) || p.test(lower)) {
        return { intent: r.intent, confidence: 0.85 };
      }
    }
  }
  return { intent: "general", confidence: 0.4 };
}

// =============================================================
// The system prompt for the Drafter LLM call
// =============================================================
function buildSystemPrompt(ctx: InboundContext): string {
  return `You are Paul's reply assistant at 210 Discount Furniture / Furniture & Mattress Warehouse in San Antonio.

You compose REPLY DRAFTS for the worker to review before sending. Never call your output a finished reply — it's a draft.

THE STORE
- 210 Discount Furniture / Furniture & Mattress Warehouse, San Antonio TX
- Open Mon-Sat 9am-7pm, Sun 10am-6pm (today closes at ${
    ctx.store_open_until || "7pm"
  })
- Phone (210) 712-4700
- Main showroom: 10203 Kotzebue Street, #112
- Delivery: $79 flat anywhere in San Antonio, unlimited pieces
- Crown Mark / Happy Homes suppliers — usually trucks daily from Houston, so "tomorrow if you sign today" is often realistic

FINANCING — REQUIRED BEHAVIOR
- Customer base depends on no-credit / lease-to-own financing. Volunteer it proactively on any budget/affordability signal.
- Available: American First Finance (AFF), Koalafi, Progressive Leasing, Snap Finance, Kafene
- NEVER call lease-to-own "financing", "credit", "loan", "0% interest"
- NEVER quote a payment amount without quoting cash price and total-of-payments alongside (TX Property Code Ch. 92A)
- NEVER imply approval is guaranteed — use "see what you qualify for", not "get approved"
- Recommend AFF first (TX-licensed installment, cheapest if customer qualifies)

TONE
- Warm, direct, no jargon. Match how the customer is writing — Spanish in, Spanish out.
- No emojis.
- Short. 1-3 sentences usually. Mobile-readable.
- Always end with a foot-traffic CTA: "come by today before [close]" or "can you come by today?"

ALWAYS RETURN STRICT JSON with this shape:
{
  "intent": "stock-check" | "price-check" | "financing" | "location" | "delivery" | "negotiation" | "general",
  "intent_confidence": number 0..1,
  "draft_reply": "the reply text the worker would send",
  "reasoning": "one sentence: why this draft, what signal you read",
  "volunteered_financing": boolean,
  "cta_to_visit": boolean,
  "notes_for_human": ["anything the worker should double-check before sending"]
}`;
}

function buildUserPrompt(ctx: InboundContext): string {
  const lines: string[] = [];
  lines.push(`Surface: ${ctx.surface} (${ctx.account_label})`);
  lines.push(
    `Customer: ${ctx.customer_name}${
      ctx.customer_handle ? " (" + ctx.customer_handle + ")" : ""
    }`,
  );
  if (ctx.worker_name) lines.push(`Drafting as: ${ctx.worker_name}`);
  lines.push("");

  if (ctx.product_match) {
    const p = ctx.product_match;
    lines.push(`PRODUCT THE BUYER IS ASKING ABOUT:`);
    lines.push(`- Name: ${p.name}`);
    lines.push(`- Slug: ${p.slug}`);
    if (p.sku) lines.push(`- SKU: ${p.sku}`);
    if (p.price_text) lines.push(`- Price: ${p.price_text}`);
    if (p.color_options && p.color_options.length > 0) {
      lines.push(`- Available colors: ${p.color_options.join(", ")}`);
    }
    if (ctx.in_stock !== undefined) {
      lines.push(
        `- Stock: ${
          ctx.in_stock === true
            ? "in stock"
            : ctx.in_stock === false
            ? "not in stock"
            : "unknown — confirm with worker"
        }`,
      );
    }
    lines.push("");
  }

  if (ctx.thread_history.length > 0) {
    lines.push(`PREVIOUS MESSAGES IN THIS THREAD (oldest first):`);
    for (const m of ctx.thread_history) {
      lines.push(`  [${m.from}] ${m.text}`);
    }
    lines.push("");
  }

  lines.push(`LATEST INCOMING MESSAGE FROM CUSTOMER:`);
  lines.push(`"${ctx.latest_message}"`);
  lines.push("");
  lines.push(
    `Compose the draft reply. Return STRICT JSON per the schema in the system prompt.`,
  );

  return lines.join("\n");
}

// =============================================================
// Main entry point
// =============================================================
export async function draftReply(ctx: InboundContext): Promise<DraftResult> {
  const key = getEnv("ANTHROPIC_KEY");
  if (!key) throw new Error("ANTHROPIC_KEY not set");

  const sys = buildSystemPrompt(ctx);
  const user = buildUserPrompt(ctx);

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      system: sys,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const raw =
    data.content?.filter((b: { type: string }) => b.type === "text").map((
      b: { text: string },
    ) => b.text).join("\n") || "";

  // Robust JSON parsing (strip markdown fences, extract first JSON object)
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "")
    .trim();
  let parsed: DraftResult;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(
        "Drafter LLM did not return parseable JSON: " + raw.slice(0, 200),
      );
    }
    parsed = JSON.parse(match[0]);
  }

  // Defensive defaults
  if (!parsed.intent) {
    parsed.intent = classifyByRules(ctx.latest_message).intent;
  }
  if (parsed.intent_confidence == null) parsed.intent_confidence = 0.7;
  if (!Array.isArray(parsed.notes_for_human)) parsed.notes_for_human = [];

  return parsed;
}
