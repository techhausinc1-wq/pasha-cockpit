// Messaging threads, financing applications, AP invoices, tax obligations,
// and dashboard stats source data. Real Deno KV persistence (see lib/kv.ts)
// -- replaces the process-memory SAMPLE_* arrays that used to reset on
// every worker restart. Seed values below are identical to what used to be
// hardcoded here, so a fresh deploy looks exactly the same as before.

import { kvGet, kvGetDoc, kvList, kvSet, kvSetDoc } from "./kv.ts";

const THREADS_RES = "threads";
const APPLICATIONS_RES = "applications";
const AP_RES = "ap";
const TAX_RES = "tax";
const STATS_RES = "dashboard_stats";
const TRUCKS_RES = "trucks_inbound";

export interface SampleThread {
  id: string;
  account_id: string;
  account_label: string;
  surface: "mp" | "pg" | "ig" | "wa";
  customer_handle: string;
  customer_name: string;
  worker_id: string | null;
  status: "active" | "won" | "lost" | "cold";
  intent:
    | "stock-check"
    | "price-check"
    | "financing"
    | "location"
    | "delivery"
    | "negotiation"
    | "general";
  product_slug: string | null;
  last_message_at: string;
  last_message_from: "customer" | "worker";
  unread: boolean;
  preview: string;
  receipt_photo_key?: string;
  won_at?: string;
  _ord: number;
}

export function seedThreads(): SampleThread[] {
  const now = Date.now();
  const t: SampleThread[] = [];
  t.push({ id: "t_1", account_id: "mp-acct-1", account_label: "FB Marketplace - acct 1", surface: "mp", customer_handle: "maria.lopez.92", customer_name: "Maria Lopez", worker_id: "u_rick", status: "active", intent: "stock-check", product_slug: "logan2-charcoal-reversible-sectional-charcoal", last_message_at: new Date(now - 8 * 60 * 1000).toISOString(), last_message_from: "customer", unread: true, preview: "is the gray logan2 still available, need it this weekend", _ord: now - 1 });
  t.push({ id: "t_2", account_id: "mp-acct-2", account_label: "FB Marketplace - acct 2", surface: "mp", customer_handle: "j.bryant", customer_name: "Joel Bryant", worker_id: "u_carlos", status: "active", intent: "financing", product_slug: "amelia-charcoal-power-reclining-sectional-w-bluetooth-speakers", last_message_at: new Date(now - 22 * 60 * 1000).toISOString(), last_message_from: "worker", unread: false, preview: "(worker) - yes - $2,199 - apply here for financing: bk.snapfinance.com", _ord: now - 2 });
  t.push({ id: "t_3", account_id: "pg-210-main", account_label: "FB Page - 210 main", surface: "pg", customer_handle: "shannon.rivera", customer_name: "Shannon Rivera", worker_id: null, status: "active", intent: "delivery", product_slug: "wynnlow-queen-panel-bed-with-dresser", last_message_at: new Date(now - 47 * 60 * 1000).toISOString(), last_message_from: "customer", unread: true, preview: "Do you deliver to Converse, TX, buying for my son next weekend", _ord: now - 3 });
  t.push({ id: "t_4", account_id: "mp-acct-1", account_label: "FB Marketplace - acct 1", surface: "mp", customer_handle: "tonyramos", customer_name: "Tony Ramos", worker_id: "u_nick", status: "active", intent: "negotiation", product_slug: "messi-white-pu-reversible-sectional", last_message_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(), last_message_from: "customer", unread: true, preview: "Will you take $400, it has been listed a few weeks, cash today", _ord: now - 4 });
  t.push({ id: "t_5", account_id: "ig-210furnitureoutlet", account_label: "Instagram - 210furnitureoutlet", surface: "ig", customer_handle: "jasminev_", customer_name: "Jasmine V.", worker_id: "u_carlos", status: "active", intent: "stock-check", product_slug: "akerson-grey-3pc-queen-bedroom-set-included-queen-bed-dresser-mirror", last_message_at: new Date(now - 3 * 60 * 60 * 1000).toISOString(), last_message_from: "worker", unread: false, preview: "(worker) - in stock at the showroom now, $1,599 out the door, come by today till 7pm", _ord: now - 5 });
  t.push({ id: "t_6", account_id: "mp-acct-2", account_label: "FB Marketplace - acct 2", surface: "mp", customer_handle: "elenacm", customer_name: "Elena C.M.", worker_id: "u_rick", status: "cold", intent: "financing", product_slug: "fulton-counter-height-bench-wh", last_message_at: new Date(now - 50 * 60 * 60 * 1000).toISOString(), last_message_from: "worker", unread: false, preview: "(worker, 2d ago) - try AFF first, americanfirstfinance.com, any luck", _ord: now - 6 });
  return t;
}

export async function listThreads(): Promise<SampleThread[]> {
  return kvList<SampleThread>(THREADS_RES);
}

// Marks a thread converted -- a real, photo-of-the-receipt-backed signal
// that works for any payment method (cash/card/financed), not just
// financing-app approvals. The photo itself lives in the private RECEIPTS
// R2 bucket (see main.ts's /api/threads/:id/mark-won route); this just
// records the key + timestamp on the thread.
export async function markThreadWon(id: string, receiptPhotoKey?: string): Promise<SampleThread | null> {
  const thread = await kvGet<SampleThread>(THREADS_RES, id);
  if (!thread) return null;
  thread.status = "won";
  thread.won_at = new Date().toISOString();
  if (receiptPhotoKey) thread.receipt_photo_key = receiptPhotoKey;
  await kvSet(THREADS_RES, id, thread);
  return thread;
}

export async function upsertWhatsAppThread(msg: {
  wa_id: string;
  name: string | null;
  text: string;
  timestamp: string;
}): Promise<void> {
  const accountId = "wa-210-main";
  const all = await kvList<SampleThread>(THREADS_RES);
  let thread = all.find((t) => t.customer_handle === msg.wa_id && t.surface === "wa");
  if (!thread) {
    thread = {
      id: "wa_" + msg.wa_id,
      account_id: accountId,
      account_label: "WhatsApp - 210 main",
      surface: "wa",
      customer_handle: msg.wa_id,
      customer_name: msg.name || msg.wa_id,
      worker_id: null,
      status: "active",
      intent: "general",
      product_slug: null,
      last_message_at: msg.timestamp,
      last_message_from: "customer",
      unread: true,
      preview: msg.text,
      _ord: Date.now(),
    };
  } else {
    thread.last_message_at = msg.timestamp;
    thread.last_message_from = "customer";
    thread.unread = true;
    thread.preview = msg.text;
    thread._ord = Date.now();
    if (msg.name) thread.customer_name = msg.name;
  }
  await kvSet(THREADS_RES, thread.id, thread);
}

// Same shape as upsertWhatsAppThread, generalized for Messenger ("pg") and
// Instagram ("ig") DMs -- see lib/meta-messaging.ts. One function instead of
// two near-identical copies since the only real difference is the surface
// label and account_id/account_label source.
export async function upsertMetaThread(msg: {
  surface: "pg" | "ig";
  senderId: string; // PSID (Messenger) or IGSID (Instagram)
  senderName: string | null;
  accountId: string; // the connected Page ID or IG business ID this came in on
  accountLabel: string;
  text: string;
  timestamp: string;
}): Promise<void> {
  const all = await kvList<SampleThread>(THREADS_RES);
  let thread = all.find((t) => t.customer_handle === msg.senderId && t.surface === msg.surface);
  if (!thread) {
    thread = {
      id: msg.surface + "_" + msg.senderId,
      account_id: msg.accountId,
      account_label: msg.accountLabel,
      surface: msg.surface,
      customer_handle: msg.senderId,
      customer_name: msg.senderName || msg.senderId,
      worker_id: null,
      status: "active",
      intent: "general",
      product_slug: null,
      last_message_at: msg.timestamp,
      last_message_from: "customer",
      unread: true,
      preview: msg.text,
      _ord: Date.now(),
    };
  } else {
    thread.last_message_at = msg.timestamp;
    thread.last_message_from = "customer";
    thread.unread = true;
    thread.preview = msg.text;
    thread._ord = Date.now();
    if (msg.senderName) thread.customer_name = msg.senderName;
  }
  await kvSet(THREADS_RES, thread.id, thread);
}

export async function markThreadSent(customerHandle: string, text: string): Promise<void> {
  const all = await kvList<SampleThread>(THREADS_RES);
  const thread = all.find((t) => t.customer_handle === customerHandle);
  if (!thread) return;
  thread.last_message_at = new Date().toISOString();
  thread.last_message_from = "worker";
  thread.unread = false;
  thread.preview = "(worker) - " + text;
  await kvSet(THREADS_RES, thread.id, thread);
}

export interface SampleApplication {
  id: string;
  customer_name: string;
  worker_id: string;
  ticket: number;
  product_slugs: string[];
  started_at: string;
  status: "in-progress" | "approved" | "declined" | "funded";
  lender_attempts: {
    lender: "AFF" | "Koalafi" | "Progressive" | "Snap" | "Kafene" | "Acima";
    decision: "approved" | "declined" | "pending";
    amount?: number;
    at: string;
  }[];
  _ord: number;
}

export function seedApplications(): SampleApplication[] {
  const now = Date.now();
  const list: SampleApplication[] = [];
  list.push({
    id: "a_1", customer_name: "Cesar Garcia", worker_id: "u_carlos", ticket: 999,
    product_slugs: ["logan2-charcoal-reversible-sectional-charcoal"],
    started_at: new Date(now - 15 * 60 * 1000).toISOString(), status: "in-progress",
    lender_attempts: [{ lender: "AFF", decision: "pending", at: new Date(now - 15 * 60 * 1000).toISOString() }],
    _ord: now - 1,
  });
  list.push({
    id: "a_2", customer_name: "Adriana Soto", worker_id: "u_rick", ticket: 2199,
    product_slugs: ["amelia-charcoal-power-reclining-sectional-w-bluetooth-speakers"],
    started_at: new Date(now - 47 * 60 * 1000).toISOString(), status: "in-progress",
    lender_attempts: [
      { lender: "AFF", decision: "declined", at: new Date(now - 45 * 60 * 1000).toISOString() },
      { lender: "Koalafi", decision: "pending", at: new Date(now - 12 * 60 * 1000).toISOString() },
    ],
    _ord: now - 2,
  });
  list.push({
    id: "a_3", customer_name: "Luis Hernandez", worker_id: "u_carlos", ticket: 1599,
    product_slugs: ["akerson-grey-3pc-queen-bedroom-set-included-queen-bed-dresser-mirror"],
    started_at: new Date(now - 90 * 60 * 1000).toISOString(), status: "approved",
    lender_attempts: [
      { lender: "AFF", decision: "declined", at: new Date(now - 85 * 60 * 1000).toISOString() },
      { lender: "Koalafi", decision: "approved", amount: 1599, at: new Date(now - 78 * 60 * 1000).toISOString() },
    ],
    _ord: now - 3,
  });
  return list;
}

export async function listApplications(): Promise<SampleApplication[]> {
  return kvList<SampleApplication>(APPLICATIONS_RES);
}

export interface APInvoice {
  id: string;
  supplier: "Crown Mark" | "Happy Homes" | "Other";
  invoice_no: string;
  amount: number;
  due_date: string;
  status: "open" | "paid" | "overdue";
  received: string;
  _ord: number;
}

export function seedAP(): APInvoice[] {
  const now = Date.now();
  const list: APInvoice[] = [];
  list.push({ id: "ap_1", supplier: "Crown Mark", invoice_no: "CM-2026-0518", amount: 8420.50, due_date: new Date(now + 2 * 86400000).toISOString().slice(0, 10), status: "open", received: "2026-05-18", _ord: now - 1 });
  list.push({ id: "ap_2", supplier: "Crown Mark", invoice_no: "CM-2026-0512", amount: 3895.00, due_date: new Date(now + 5 * 86400000).toISOString().slice(0, 10), status: "open", received: "2026-05-12", _ord: now - 2 });
  list.push({ id: "ap_3", supplier: "Happy Homes", invoice_no: "HH-26-04412", amount: 5240.00, due_date: new Date(now - 3 * 86400000).toISOString().slice(0, 10), status: "overdue", received: "2026-05-09", _ord: now - 3 });
  list.push({ id: "ap_4", supplier: "Happy Homes", invoice_no: "HH-26-04488", amount: 1820.00, due_date: new Date(now + 10 * 86400000).toISOString().slice(0, 10), status: "open", received: "2026-05-19", _ord: now - 4 });
  return list;
}

export async function listAP(): Promise<APInvoice[]> {
  return kvList<APInvoice>(AP_RES);
}

export interface TaxObligation {
  id: string;
  name: string;
  agency: string;
  due_date: string;
  status: "filed" | "due" | "overdue";
  amount_accrued?: number;
  notes: string;
  _ord: number;
}

export function seedTax(): TaxObligation[] {
  const list: TaxObligation[] = [];
  list.push({ id: "tax_1", name: "TX Sales Tax - May 2026 return", agency: "TX Comptroller", due_date: "2026-06-20", status: "due", amount_accrued: 4860, notes: "Monthly filing, about 30% above April pace", _ord: 4 });
  list.push({ id: "tax_2", name: "TX Sales Tax - April 2026 return", agency: "TX Comptroller", due_date: "2026-05-19", status: "filed", notes: "Filed 2026-05-19, Webfile confirmation received", _ord: 3 });
  list.push({ id: "tax_3", name: "Workers Comp Renewal", agency: "Texas Mutual", due_date: "2026-06-14", status: "due", notes: "21 days out, no cancellation notice received", _ord: 2 });
  list.push({ id: "tax_4", name: "Bexar County BPP Bill", agency: "Bexar County Tax Assessor", due_date: "2027-01-31", status: "due", notes: "Bill arrives October, rendition was filed on time April 15", _ord: 1 });
  return list;
}

export async function listTax(): Promise<TaxObligation[]> {
  return kvList<TaxObligation>(TAX_RES);
}

export interface SampleStat {
  label: string;
  value: string;
  trend?: string;
  hint?: string;
}

export function seedDashboardStats(): SampleStat[] {
  const list: SampleStat[] = [];
  list.push({ label: "Messages today", value: "18", trend: "+3 vs Sat avg", hint: "11 Paul, 5 Carlos, 2 Rick" });
  list.push({ label: "Visits expected", value: "3", hint: "From yesterdays threads" });
  list.push({ label: "Sales today", value: "$2,499", trend: "1 financed (Snap), 1 cash" });
  list.push({ label: "Lost-sale flags", value: "1", hint: "Logan2 brown, financing not offered in reply 1" });
  return list;
}

export async function getDashboardStats(): Promise<SampleStat[]> {
  const stored = await kvGetDoc<SampleStat[]>(STATS_RES);
  return stored ?? seedDashboardStats();
}

export interface TruckInbound {
  supplier: string;
  arrives: string;
  pieces: number;
}

export function seedTrucksInbound(): TruckInbound[] {
  const list: TruckInbound[] = [];
  list.push({ supplier: "Crown Mark", arrives: "Mon 7am", pieces: 47 });
  list.push({ supplier: "Happy Homes", arrives: "Wed 11am", pieces: 22 });
  return list;
}

export async function getTrucksInbound(): Promise<TruckInbound[]> {
  const stored = await kvGetDoc<TruckInbound[]>(TRUCKS_RES);
  return stored ?? seedTrucksInbound();
}

// One-time boot seed, called from main.ts's seedIfEmpty(). Colocated here
// with the types/seed data instead of inlined in main.ts.
export async function seedSampleDataIfEmpty(): Promise<void> {
  const existingThreads = await kvList<SampleThread>(THREADS_RES);
  if (existingThreads.length === 0) {
    for (const t of seedThreads()) await kvSet(THREADS_RES, t.id, t);
  }
  const existingApps = await kvList<SampleApplication>(APPLICATIONS_RES);
  if (existingApps.length === 0) {
    for (const a of seedApplications()) await kvSet(APPLICATIONS_RES, a.id, a);
  }
  const existingAP = await kvList<APInvoice>(AP_RES);
  if (existingAP.length === 0) {
    for (const a of seedAP()) await kvSet(AP_RES, a.id, a);
  }
  const existingTax = await kvList<TaxObligation>(TAX_RES);
  if (existingTax.length === 0) {
    for (const t of seedTax()) await kvSet(TAX_RES, t.id, t);
  }
  const existingStats = await kvGetDoc<SampleStat[]>(STATS_RES);
  if (!existingStats) await kvSetDoc(STATS_RES, seedDashboardStats());
  const existingTrucks = await kvGetDoc<TruckInbound[]>(TRUCKS_RES);
  if (!existingTrucks) await kvSetDoc(TRUCKS_RES, seedTrucksInbound());
}
