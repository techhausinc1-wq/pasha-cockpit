// Real Inventory tab backend. Scoped per the Cockpit plan's Phase 5: the
// Inventory tab has shown a 21-SKU hand-authored fixture since launch,
// against a real scraped 602-item catalog (data/catalog.json) that has no
// stock-on-hand field at all. This lib adds the missing piece -- real
// qty_on_hand per catalog item -- without inventing a single starting
// number: every item seeds at qty_on_hand 0 / counted:false, "not yet
// counted," exactly like supplier-colors.ts seeds known_colors empty on
// purpose. The real numbers only exist once someone actually counts.
//
// Deliberate design difference from the per-id KV-resource pattern used by
// supplier-colors.ts / advertising-channels.ts: at 602 items, that pattern
// (kvList() paginating + one kvGet() per key) means 602+ sequential KV
// subrequests just to render the tab -- real risk of the same subrequest-
// ceiling problem that broke Hire Signal's /admin/overview at ~1,038 KV
// reads (see that incident, 2026-10-03). Counts are instead kept as ONE KV
// document (a slug -> record map), so listing is always exactly one KV
// read no matter the catalog size. Trade-off, consistent with this
// codebase's own documented stance on KV (see kv.ts's header comment):
// last-writer-wins on the whole document, fine for one small business's
// own staff doing sequential counts/receives, not a high-concurrency design.

import { kvGetDoc, kvSetDoc } from "./kv.ts";

const RES = "inventory-counts";

export interface InventoryCount {
  qty_on_hand: number;
  counted: boolean; // false until a real human has ever set a real count
  location?: string;
  updated_at: string;
  updated_by: string;
}

type CountsDoc = Record<string, InventoryCount>; // keyed by catalog slug

export interface InventoryItem {
  slug: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  photo: string | null;
  qty_on_hand: number;
  counted: boolean;
  location: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

// deno-lint-ignore no-explicit-any
async function readCatalogProducts(assets: { fetch(req: Request): Promise<Response> }): Promise<any[]> {
  const res = await assets.fetch(new Request("https://assets.internal/catalog.json"));
  if (!res.ok) throw new Error("catalog.json not found in ASSETS binding");
  const data = await res.json();
  return data.products || [];
}

async function getCountsDoc(): Promise<CountsDoc> {
  return (await kvGetDoc<CountsDoc>(RES)) || {};
}

// Strongly-consistent kvGetDoc (direct get-by-id, not kvList()) makes a
// simple "doc already exists" check safe against the double-seed race
// that forced the marker-doc pattern elsewhere in this codebase.
export async function seedInventoryIfEmpty(assets: { fetch(req: Request): Promise<Response> }): Promise<void> {
  const existing = await kvGetDoc<CountsDoc>(RES);
  if (existing) return;
  const products = await readCatalogProducts(assets);
  const now = new Date().toISOString();
  const doc: CountsDoc = {};
  for (const p of products) {
    if (!p.slug) continue;
    doc[p.slug] = { qty_on_hand: 0, counted: false, updated_at: now, updated_by: "system-seed" };
  }
  await kvSetDoc(RES, doc);
}

export async function listInventory(assets: { fetch(req: Request): Promise<Response> }): Promise<InventoryItem[]> {
  const [products, counts] = await Promise.all([readCatalogProducts(assets), getCountsDoc()]);
  return products.filter((p) => !!p.slug).map((p) => {
    const c = counts[p.slug];
    return {
      slug: p.slug,
      sku: p.sku || "",
      name: p.name || "",
      category: (p.category_path && p.category_path[0]) || "uncategorized",
      price: typeof p.price === "number" ? p.price : 0,
      photo: (p.photos && p.photos[0]) || null,
      qty_on_hand: c ? c.qty_on_hand : 0,
      counted: c ? c.counted : false,
      location: c && c.location ? c.location : null,
      updated_at: c ? c.updated_at : null,
      updated_by: c ? c.updated_by : null,
    };
  });
}

async function slugExists(assets: { fetch(req: Request): Promise<Response> }, slug: string): Promise<boolean> {
  const products = await readCatalogProducts(assets);
  return products.some((p) => p.slug === slug);
}

export async function setInventoryCount(
  assets: { fetch(req: Request): Promise<Response> },
  slug: string,
  qty: number,
  by: string,
  location?: string,
): Promise<InventoryCount | { error: string }> {
  if (!(await slugExists(assets, slug))) return { error: "slug_not_found" };
  const counts = await getCountsDoc();
  const now = new Date().toISOString();
  const rec: InventoryCount = {
    qty_on_hand: Math.max(0, Math.floor(qty)),
    counted: true,
    location: location ?? counts[slug]?.location,
    updated_at: now,
    updated_by: by,
  };
  counts[slug] = rec;
  await kvSetDoc(RES, counts);
  return rec;
}

export async function receiveInventory(
  assets: { fetch(req: Request): Promise<Response> },
  slug: string,
  qty: number,
  by: string,
): Promise<InventoryCount | { error: string }> {
  if (qty <= 0) return { error: "qty_must_be_positive" };
  if (!(await slugExists(assets, slug))) return { error: "slug_not_found" };
  const counts = await getCountsDoc();
  const prior = counts[slug];
  const now = new Date().toISOString();
  const rec: InventoryCount = {
    qty_on_hand: (prior?.qty_on_hand || 0) + Math.floor(qty),
    counted: true,
    location: prior?.location,
    updated_at: now,
    updated_by: by,
  };
  counts[slug] = rec;
  await kvSetDoc(RES, counts);
  return rec;
}

export async function shipInventory(
  assets: { fetch(req: Request): Promise<Response> },
  slug: string,
  qty: number,
  by: string,
): Promise<InventoryCount | { error: string; available?: number }> {
  if (qty <= 0) return { error: "qty_must_be_positive" };
  if (!(await slugExists(assets, slug))) return { error: "slug_not_found" };
  const counts = await getCountsDoc();
  const prior = counts[slug];
  if (!prior || prior.qty_on_hand < qty) return { error: "insufficient_stock", available: prior?.qty_on_hand || 0 };
  const now = new Date().toISOString();
  const rec: InventoryCount = {
    qty_on_hand: prior.qty_on_hand - Math.floor(qty),
    counted: true,
    location: prior.location,
    updated_at: now,
    updated_by: by,
  };
  counts[slug] = rec;
  await kvSetDoc(RES, counts);
  return rec;
}
