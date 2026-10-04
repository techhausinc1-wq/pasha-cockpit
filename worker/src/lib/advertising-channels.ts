// Real outbound advertising-channel tracker. Ivan, 2026-10-01: "we need to
// make sure we have all advertising avenues... make a tab for them in
// pasha's cockpit... every lead has a summary of how we should handle them
// and why contact them in the first place."
//
// This is distinct from the existing Ads tab (inbound Meta/Google/TikTok
// *performance* data). This tracks outbound channels worth contacting --
// radio stations, the JBSA military base program, billboard companies,
// Spanish-language TV, direct mail -- each with a real contact, a real
// reason to reach out, and a real approach, so nothing here is a bare name
// and phone number. Seed data is the real research already done and live
// at techhaushq.com/pasha-advertising -- not re-invented here.

import { kvGet, kvGetDoc, kvList, kvSet, kvSetDoc, kvDelete, nanoid } from "./kv.ts";

const RES = "ad-channels";

export type ChannelStatus = "not-contacted" | "contacted" | "in-progress" | "declined" | "signed";
export type ChannelCategory = "jbsa" | "radio" | "billboard" | "tv" | "direct-mail";

export interface ChannelNote {
  id: string;
  text: string;
  by: string;
  at: string;
}

export interface AdChannel {
  id: string;
  category: ChannelCategory;
  name: string; // the station/company/program name
  contact_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  why_contact: string; // the real reasoning -- why this channel at all
  how_to_approach: string; // the real, specific next step
  pricing_note: string; // real figure or "not published -- ask by phone"
  pricing_confirmed: boolean; // true = a real published/quoted rate; false = market estimate or unknown, ask directly
  status: ChannelStatus;
  notes: ChannelNote[];
  created_at: string;
  updated_at: string;
  _ord: number;
}

const SEED: Array<Omit<AdChannel, "id" | "status" | "notes" | "created_at" | "updated_at" | "_ord">> = [
  {
    category: "jbsa",
    name: "502nd Force Support Squadron — Commercial Sponsorship & Advertising Program",
    contact_name: "Connie Szeszko (Fort Sam Houston)",
    phone: "210-221-2307",
    why_contact: "The real, official advertising channel into Joint Base San Antonio — Lackland, Fort Sam Houston, and Randolph combined serve roughly 198,000 active-duty, family, civilian, and retiree personnel. Incoming military on PCS orders need to furnish a home fast — about as strong a buyer-intent match as exists for a discount furniture store. No San Antonio furniture competitor currently offers a formal military discount program.",
    how_to_approach: "Call and ask for current sponsorship tiers/rates — pricing isn't published, this is normal for base programs and has to be requested by phone. Lead with the PCS/incoming-family angle specifically.",
    pricing_note: "Not published — request current rates/tiers by phone.",
    pricing_confirmed: false,
  },
  {
    category: "jbsa",
    name: "502nd Force Support Squadron — Commercial Sponsorship & Advertising Program",
    contact_name: "Al Conyers (Lackland)",
    phone: "210-925-1187",
    why_contact: "Same real JBSA program, Lackland installation specifically — the largest of the three JBSA sites.",
    how_to_approach: "Same ask as the Fort Sam Houston contact — current rates/tiers, PCS/incoming-family framing.",
    pricing_note: "Not published — request current rates/tiers by phone.",
    pricing_confirmed: false,
  },
  {
    category: "jbsa",
    name: "502nd Force Support Squadron — Commercial Sponsorship & Advertising Program",
    contact_name: "Ed McDaniel (Randolph)",
    phone: "210-652-2940",
    why_contact: "Same real JBSA program, Randolph installation specifically.",
    how_to_approach: "Same ask as the other two JBSA contacts — current rates/tiers, PCS/incoming-family framing.",
    pricing_note: "Not published — request current rates/tiers by phone.",
    pricing_confirmed: false,
  },
  {
    category: "radio",
    name: "KXTN 1350 AM — Tejano & Proud",
    why_contact: "Tejano format — directly matches the store's working-class, bilingual customer base better than English Top-40 or news/talk.",
    how_to_approach: "Request a media kit and ad-rate card; ask about a 30-second spot package.",
    pricing_note: "Market-average ~$81 per 30-second spot, varies by station/daypart — get a real quote.",
    pricing_confirmed: false,
  },
  {
    category: "radio",
    name: "KSAH 720 AM — Norteño",
    why_contact: "Norteño format — same bilingual/working-class audience match as KXTN, different format for broader reach.",
    how_to_approach: "Request a media kit and ad-rate card; ask about a 30-second spot package.",
    pricing_note: "Market-average ~$81 per 30-second spot, varies by station/daypart — get a real quote.",
    pricing_confirmed: false,
  },
  {
    category: "radio",
    name: "KROM-FM 92.9 — Qué Buena (pop)",
    why_contact: "Spanish-language pop format, broad reach across the same target demographic.",
    how_to_approach: "Request a media kit and ad-rate card.",
    pricing_note: "Market-average ~$81 per 30-second spot, varies by station/daypart — get a real quote.",
    pricing_confirmed: false,
  },
  {
    category: "radio",
    name: "KMYO-FM 95.1 — Amor (AC)",
    why_contact: "Spanish-language adult-contemporary — a softer-format option for the same audience.",
    how_to_approach: "Request a media kit and ad-rate card.",
    pricing_note: "Market-average ~$81 per 30-second spot, varies by station/daypart — get a real quote.",
    pricing_confirmed: false,
  },
  {
    category: "radio",
    name: "KAJA-FM 97.3 — KJ97, #1 new country",
    why_contact: "Top-rated country station — reaches a different, non-Spanish-speaking customer segment the Tejano/Norteño stations don't cover.",
    how_to_approach: "Owned by iHeartMedia San Antonio along with KQXT/KXXM/WOAI — request a quote at iheartsanantonioadvertising.com for a bundled rate across their cluster.",
    pricing_note: "Market-average ~$81 per 30-second spot — ask iHeartMedia for a cluster quote.",
    pricing_confirmed: false,
  },
  {
    category: "radio",
    name: "KCYY-FM 100.3 — Y100",
    why_contact: "Second major country station, same iHeartMedia cluster as KAJA.",
    how_to_approach: "Request via iheartsanantonioadvertising.com, same cluster quote as KAJA.",
    pricing_note: "Market-average ~$81 per 30-second spot — ask iHeartMedia for a cluster quote.",
    pricing_confirmed: false,
  },
  {
    category: "radio",
    name: "KKYX-AM 680 — Country Legends",
    why_contact: "Classic-country format, older demographic — a different buyer profile (often repeat/replacement furniture buyers).",
    how_to_approach: "Request a media kit and ad-rate card directly.",
    pricing_note: "Market-average ~$81 per 30-second spot — get a real quote.",
    pricing_confirmed: false,
  },
  {
    category: "radio",
    name: "KBPT-FM 92.5 — The Bull, classic country",
    why_contact: "Classic-country format, same older/repeat-buyer demographic as KKYX.",
    how_to_approach: "Request a media kit and ad-rate card directly.",
    pricing_note: "Market-average ~$81 per 30-second spot — get a real quote.",
    pricing_confirmed: false,
  },
  {
    category: "billboard",
    name: "Clear Channel Outdoor",
    contact_name: "Teri Pearce, Account Executive",
    phone: "210-630-6973 / 210-373-9461",
    address: "3714 N. Pan Am Expressway, San Antonio, TX 78219",
    why_contact: "Highest-cost, highest-reach option — best used once a specific high-traffic corridor near the store or a JBSA gate is picked, not a first move on a limited budget.",
    how_to_approach: "Call Teri directly with a specific corridor in mind (e.g. near the Kotzebue St store or a JBSA gate) and ask for real current pricing for that location.",
    pricing_note: "Estimate only, not a quote: bulletin (14'×48') $1,800-$5,500/4wk, 30-sheet poster $600-$1,800/4wk, digital bulletin $3,000-$8,500/4wk.",
    pricing_confirmed: false,
  },
  {
    category: "billboard",
    name: "Lamar Advertising",
    why_contact: "Covers the Austin-San Antonio-Central Texas market — a second real quote to compare against Clear Channel before committing.",
    how_to_approach: "Request a quote via lamar.com/austin for the same corridor considered with Clear Channel.",
    pricing_note: "Neither company publishes its own rates — get a real comparison quote once a corridor is picked.",
    pricing_confirmed: false,
  },
  {
    category: "tv",
    name: "Univision KWEX-41",
    contact_name: "Barbara Carreon, GSM",
    phone: "210-227-4141",
    address: "411 E. Durango St, San Antonio, TX 78204",
    why_contact: "Top Spanish-language TV reach in the market — same bilingual customer match as the Tejano/Norteño radio stations, different medium.",
    how_to_approach: "Call and ask for a media kit and local-spot ad rates.",
    pricing_note: "Not published — request current rates by phone.",
    pricing_confirmed: false,
  },
  {
    category: "tv",
    name: "Telemundo KVDA-60",
    phone: "210-340-8860",
    address: "6234 San Pedro Ave, San Antonio, TX 78216",
    why_contact: "Second major Spanish-language TV station — a real second quote to compare against Univision.",
    how_to_approach: "Call and ask for a media kit and local-spot ad rates.",
    pricing_note: "Not published — request current rates by phone.",
    pricing_confirmed: false,
  },
  {
    category: "direct-mail",
    name: "USPS Every Door Direct Mail (EDDM)",
    why_contact: "Cheapest, fastest channel to launch — blankets the ZIP codes around the Kotzebue St store with zero mailing list and zero permit needed.",
    how_to_approach: "Design a 6.5\"×9\" piece, submit via USPS EDDM online, start with the ZIP codes immediately around the store.",
    pricing_note: "$0.26/piece postage (2026 retail EDDM rate), ~$0.32-$0.41/piece all-in with printing. Up to 5,000 pieces/ZIP/day, no permit, no list, no annual fee.",
    pricing_confirmed: true,
  },
];

export async function listAdChannels(): Promise<AdChannel[]> {
  return kvList<AdChannel>(RES);
}

// Guarded by a singleton KV doc, same pattern as supplier-colors.ts --
// kvList() is only eventually consistent, a naive length-check can
// double-seed under concurrent cold starts.
export async function seedAdChannelsIfEmpty(): Promise<void> {
  const marker = await kvGetDoc<{ seeded: true }>(RES + "-seed-marker");
  if (marker) return;
  await kvSetDoc(RES + "-seed-marker", { seeded: true as const });
  const existing = await kvList<AdChannel>(RES);
  if (existing.length > 0) return;
  for (const s of SEED) await createAdChannel(s);
}

export async function findAdChannel(id: string): Promise<AdChannel | null> {
  return kvGet<AdChannel>(RES, id);
}

export async function createAdChannel(
  input: Omit<AdChannel, "id" | "status" | "notes" | "created_at" | "updated_at" | "_ord">,
): Promise<AdChannel> {
  const now = new Date().toISOString();
  const rec: AdChannel = {
    ...input,
    id: "adc_" + nanoid(12),
    status: "not-contacted",
    notes: [],
    created_at: now,
    updated_at: now,
    _ord: Date.now(),
  };
  await kvSet(RES, rec.id, rec);
  return rec;
}

export async function updateAdChannelStatus(id: string, status: ChannelStatus): Promise<AdChannel | null> {
  const rec = await findAdChannel(id);
  if (!rec) return null;
  rec.status = status;
  rec.updated_at = new Date().toISOString();
  await kvSet(RES, rec.id, rec);
  return rec;
}

export async function addAdChannelNote(id: string, text: string, by: string): Promise<AdChannel | null> {
  const rec = await findAdChannel(id);
  if (!rec) return null;
  const now = new Date().toISOString();
  rec.notes.unshift({ id: "n_" + nanoid(10), text, by, at: now });
  rec.updated_at = now;
  await kvSet(RES, rec.id, rec);
  return rec;
}

export async function deleteAdChannel(id: string): Promise<boolean> {
  const existing = await findAdChannel(id);
  if (!existing) return false;
  await kvDelete(RES, id);
  return true;
}
