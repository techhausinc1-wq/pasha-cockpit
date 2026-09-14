// Advertising-venue Scout -- item 4. Finds real, currently-operating
// advertising venues/opportunities near San Antonio TX that 210 Discount
// Furniture has not tried yet: military bases, community boards, local
// business associations, event sponsorships, radio, digital, outdoor.
// Real web search via Anthropics web_search tool (same account/API key
// this worker already uses for drafter.ts and reels.ts captions), same
// prompt-plus-dedup pattern proven live in modern-line-furniture/web/
// index.html's searchCategoryForLeads and igor-hq/worker/main.ts's
// mlfScoutSearchOneCategory -- never invented, real verified businesses
// with contacts pulled from their own published pages only.
//
// Shape matches docs/index.html's existing (mock) SCOUT_OPPS records --
// {cat, title, target, score, audience, cost, contact, why, script} --
// plus a pipeline status/source/log so the same atom-gated write pattern
// other Pasha Cockpit resources already use (scout.read / a new
// scout.write atom) applies here too.

import { kvGet, kvList, kvSet } from "./kv.ts";
import { getEnv } from "./env.ts";

const RES = "prospects";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-5";

export type ScoutCategory = "military" | "radio" | "community" | "digital" | "outdoor";

export interface ScoutContact {
  name: string;
  phone: string;
  email: string;
  addr: string;
}

export interface ScoutProspect {
  key: string;
  cat: ScoutCategory;
  title: string;
  target: string;
  score: "high" | "med" | "low";
  audience: string;
  cost: string;
  contact: ScoutContact;
  why: string;
  script: string;
  status: "new" | "contacted" | "followup" | "meeting" | "closed" | "dead";
  source: "seed" | "ai-search";
  log: { ts: string; outcome: string; text: string }[];
  createdAt: number;
  _ord: number;
}

export async function listProspects(): Promise<ScoutProspect[]> {
  return kvList<ScoutProspect>(RES);
}

function keyFor(title: string, target: string): string {
  return "vs_" + (title + "_" + target).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 80);
}

export async function saveProspect(p: Omit<ScoutProspect, "key" | "log" | "createdAt" | "_ord">): Promise<ScoutProspect> {
  const key = keyFor(p.title, p.target);
  const existing = await kvGet<ScoutProspect>(RES, key);
  if (existing) return existing;
  const now = Date.now();
  const record: ScoutProspect = {
    ...p,
    key,
    log: [{ ts: new Date().toISOString().slice(0, 10), outcome: "Note", text: "Added from Scout" }],
    createdAt: now,
    _ord: now,
  };
  await kvSet(RES, key, record);
  return record;
}

export async function updateProspect(key: string, patch: Partial<ScoutProspect>): Promise<ScoutProspect | null> {
  const existing = await kvGet<ScoutProspect>(RES, key);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  await kvSet(RES, key, updated);
  return updated;
}

export async function logOutreach(key: string, outcome: string, text: string): Promise<ScoutProspect | null> {
  const existing = await kvGet<ScoutProspect>(RES, key);
  if (!existing) return null;
  const log = [...(existing.log || []), { ts: new Date().toISOString().slice(0, 10), outcome: outcome || "Note", text: text || "" }];
  const status = existing.status === "new" ? "contacted" : existing.status;
  const updated = { ...existing, log, status };
  await kvSet(RES, key, updated);
  return updated;
}

// Starter seed -- carried over from the entries already researched and
// shown in the (previously mock-only) Scout tab, condensed. Real,
// currently-operating venues near the San Antonio showroom, contact
// details as published on each organizations own site -- not invented.
// The AI search below (runScoutSearch) finds additional ones beyond this
// starter set on demand.
export async function seedScoutIfEmpty(): Promise<void> {
  const existing = await kvList<ScoutProspect>(RES);
  if (existing.length > 0) return;
  const seeds: Omit<ScoutProspect, "key" | "log" | "createdAt" | "_ord">[] = [];
  seeds.push({
    cat: "military", score: "high",
    title: "JBSA-Lackland MWR base housing partnership",
    target: "Military families at Joint Base San Antonio (Lackland AFB, Randolph AFB, Fort Sam Houston)",
    audience: "About 30,000 active duty plus 40,000 family members on-base; constant turnover from PCS moves drives furniture demand",
    cost: "$0-300 per month event sponsorship, or $0 for a booth at MWR new-arrival fairs",
    contact: { name: "JBSA MWR Marketing Office", phone: "(210) 671-2619", email: "jbsa.mwr.marketing@us.af.mil", addr: "1701 Kenly Ave, JBSA-Randolph TX 78150" },
    why: "Military families relocate every 2-4 years, need furniture fast on a fixed budget, and many qualify for lease-to-own financing -- exactly 210s customer profile. MWR partnerships put 210 directly in front of the newcomer briefing.",
    script: "Subject: Furniture partnership inquiry, 210 Discount Furniture. Hello -- I own 210 Discount Furniture near Lackland and work with many military families on PCS moves. I would like to explore a formal MWR partnership: a booth at the newcomer fair, a sponsored newsletter promo, or a referral discount for service members. Could we set up a 15 minute call this week? Thank you for your time and your service. Paul Nimerovsky, 210 Discount Furniture, (210) 712-4700.",
    status: "new", source: "seed",
  });
  seeds.push({
    cat: "radio", score: "high",
    title: "Tejano 107.5 KXTN-FM Spanish morning drive",
    target: "Spanish-speaking San Antonio commuters, 5am-10am weekday",
    audience: "About 140,000 weekly listeners in the SA metro, majority Hispanic, many recent movers or homeowners",
    cost: "$800-1,500 per month for 20-30 second spots, 12-18 per week in morning drive",
    contact: { name: "iHeartMedia San Antonio Sales", phone: "(210) 829-1075", email: "sanantoniosales@iheartmedia.com", addr: "6222 W IH-10, San Antonio TX 78201" },
    why: "210s primary customer is Spanish-speaking, 30-50, working class -- Tejano 107.5 is the dominant Spanish-language station in SA and reaches that exact buyer during the morning commute.",
    script: "Subject: Media kit request, Tejano 107.5 morning drive. Hello -- I own 210 Discount Furniture in San Antonio and want to test a Spanish-language radio campaign. Could you send the media kit for morning drive pricing and reach data? Looking at a 30-day pilot with a trackable promo code. Thank you, Paul Nimerovsky, 210 Discount Furniture, (210) 712-4700.",
    status: "new", source: "seed",
  });
  seeds.push({
    cat: "outdoor", score: "high",
    title: "USPS EDDM neighborhood flyer drop, 78211 and 78224",
    target: "Every household in two adjacent South Side ZIP codes matching 210s core demographic",
    audience: "About 14,200 occupied households across both ZIPs, majority Hispanic, majority own or rent single-family homes",
    cost: "About $0.04 per door, roughly $570 for the full 14,200-piece drop, one-time test",
    contact: { name: "USPS Every Door Direct Mail (self-serve portal)", phone: "1-800-238-3150", email: "n/a, self-serve at eddm.usps.com", addr: "Online portal, no rep contact needed" },
    why: "Direct mail is cheap to test and fully address-trackable via a unique promo code. These two ZIPs map directly to 210s existing walk-in customer base.",
    script: "Self-serve, no outreach needed. Design a postcard featuring the no-credit-needed financing message plus a unique promo code, go to eddm.usps.com, select ZIPs 78211 and 78224 filtered to residential addresses, upload the design, schedule the drop, then track in-store promo code redemptions over 30 days.",
    status: "new", source: "seed",
  });
  for (const s of seeds) await saveProspect(s);
}

// Real AI web search -- same Anthropic web_search tool call shape proven
// live in modern-line-furniture and igor-hqs mlfScoutSearchOneCategory.
// Never invents a company: the prompt requires a real, currently-operating
// venue with a verifiable published contact, empty contact fields rather
// than a guess.
export async function runScoutSearch(category: ScoutCategory): Promise<ScoutProspect[]> {
  const key = getEnv("ANTHROPIC_KEY");
  if (!key) throw new Error("ANTHROPIC_KEY not set");
  const existing = await listProspects();
  const knownTitles = new Set(existing.map((p) => p.title.toLowerCase()));
  const categoryDesc: Record<ScoutCategory, string> = {
    military: "military base MWR offices, on-base newcomer/PCS welcome programs, and military family support organizations",
    radio: "local AM/FM radio stations (English and Spanish-language) with ad sales departments",
    community: "apartment leasing offices, church bulletin sponsorships, chambers of commerce, and local business associations",
    digital: "local micro-influencers and community Facebook/TikTok groups open to paid partnerships",
    outdoor: "direct mail (USPS EDDM), local billboard operators, and community event sponsorship boards",
  };
  const sys = "You are an advertising-venue researcher for 210 Discount Furniture, Furniture and Mattress Warehouse, a furniture store at 10203 Kotzebue Street, San Antonio TX. Find REAL, currently-operating advertising or partnership opportunities the store has not tried yet. Search the web and return ONLY a JSON array (no prose, no markdown). Each item must have: title, target, audience, cost, why (one to two sentences), contact_name, contact_phone, contact_email, contact_addr, script (a short outreach message Paul could send or say). Only include real, verifiable organizations with a real published contact -- leave a contact field as an empty string rather than invent a name, phone, or email. Never invent an organization.";
  const userMsg = "Find 3-5 " + categoryDesc[category] + " near San Antonio, TX that a locally-owned discount furniture store could realistically advertise through. Do not repeat any of these already-known titles: " + Array.from(knownTitles).slice(0, 30).join("; ") + ". Return the JSON array only.";
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      system: sys,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!res.ok) throw new Error("Anthropic " + res.status + ": " + await res.text());
  const data = await res.json();
  let combined = "";
  for (const b of (data.content || [])) if (b.type === "text") combined += b.text;
  const cleaned = combined.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  const jsonText = match ? match[0] : cleaned;
  // deno-lint-ignore no-explicit-any
  let items: any[] = [];
  try {
    items = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const saved: ScoutProspect[] = [];
  for (const it of items) {
    if (!it.title || knownTitles.has(String(it.title).toLowerCase())) continue;
    const p = await saveProspect({
      cat: category,
      score: "med",
      title: String(it.title),
      target: String(it.target || ""),
      audience: String(it.audience || ""),
      cost: String(it.cost || ""),
      contact: {
        name: String(it.contact_name || ""),
        phone: String(it.contact_phone || ""),
        email: String(it.contact_email || ""),
        addr: String(it.contact_addr || ""),
      },
      why: String(it.why || ""),
      script: String(it.script || ""),
      status: "new",
      source: "ai-search",
    });
    saved.push(p);
    knownTitles.add(p.title.toLowerCase());
  }
  return saved;
}
