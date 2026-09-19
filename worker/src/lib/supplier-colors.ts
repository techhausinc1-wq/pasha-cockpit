// Supplier color/finish tracker. Real ask, Ivan 2026-09-19: "once a month
// pasha calls his suppliers to check if a sectional or a bed or a table is
// made in any new colors, we need to incorporate that... what we need to
// order, what we need photos of, prepare emails saying 'ok we need photos
// of the new brown color'."
//
// One record per (supplier, product line) pair -- e.g. "Crown Mark" +
// "Sectionals". Each carries the known color/finish list and a running log
// of newly-reported colors, each with its own needs-photos/needs-order/
// resolved status so nothing reported on a call gets lost before it's
// actually photographed or ordered.

import { kvGet, kvGetDoc, kvList, kvSet, kvSetDoc, kvDelete, nanoid } from "./kv.ts";

const RES = "supplier-products";
const CHECK_DUE_DAYS = 30; // Ivan's own cadence: "once a month"

export type ColorReportStatus = "needs-photos" | "needs-order-decision" | "resolved";

export interface ColorReport {
  id: string;
  color: string;
  reported_at: string;
  reported_by: string; // worker name at time of report
  status: ColorReportStatus;
  notes?: string;
  resolved_at?: string;
}

export interface SupplierProduct {
  id: string;
  supplier: string; // "Crown Mark" | "Happy Homes" | others as added -- free text so a new real supplier isn't blocked by a closed enum
  supplier_email?: string;
  product_type: string; // "Sectional" | "Bed" | "Table" | etc, free text
  known_colors: string[];
  reports: ColorReport[];
  last_checked_at: string | null;
  last_checked_by: string | null;
  created_at: string;
  updated_at: string;
  _ord: number;
}

export async function listSupplierProducts(): Promise<SupplierProduct[]> {
  return kvList<SupplierProduct>(RES);
}

// Seed with the two real suppliers already referenced elsewhere in this
// codebase (see Order["supplier"] in orders.ts) -- NOT fabricated names.
// known_colors starts empty on purpose: we don't actually know their
// current color lineup, that's the whole point of the tracker. Pasha's
// first real monthly call fills it in.
// Guarded by a singleton KV doc (strongly consistent, read-your-writes
// immediately) rather than kvList().length -- Cloudflare KV's list() is
// only eventually consistent (see kv.ts), so a naive "seed if list is
// empty" check can fire more than once under concurrent cold starts and
// double-seed. Confirmed this happening in testing before this fix.
export async function seedSupplierProductsIfEmpty(): Promise<void> {
  const marker = await kvGetDoc<{ seeded: true }>(RES + "-seed-marker");
  if (marker) return;
  await kvSetDoc(RES + "-seed-marker", { seeded: true as const });
  const existing = await kvList<SupplierProduct>(RES);
  if (existing.length > 0) return;
  await createSupplierProduct({ supplier: "Crown Mark", product_type: "Sectional" });
  await createSupplierProduct({ supplier: "Happy Homes", product_type: "Sectional" });
}

export async function findSupplierProduct(id: string): Promise<SupplierProduct | null> {
  return kvGet<SupplierProduct>(RES, id);
}

export async function createSupplierProduct(input: {
  supplier: string;
  supplier_email?: string;
  product_type: string;
  known_colors?: string[];
}): Promise<SupplierProduct> {
  const now = new Date().toISOString();
  const rec: SupplierProduct = {
    id: "sp_" + nanoid(12),
    supplier: input.supplier,
    supplier_email: input.supplier_email,
    product_type: input.product_type,
    known_colors: input.known_colors || [],
    reports: [],
    last_checked_at: null,
    last_checked_by: null,
    created_at: now,
    updated_at: now,
    _ord: Date.now(),
  };
  await kvSet(RES, rec.id, rec);
  return rec;
}

export async function deleteSupplierProduct(id: string): Promise<boolean> {
  const existing = await findSupplierProduct(id);
  if (!existing) return false;
  await kvDelete(RES, id);
  return true;
}

// Logging the monthly call itself -- with or without a new color found.
// Reporting a new color IS the check happening, so both paths stamp
// last_checked_at/by; a plain "nothing new" call only needs logCheck().
export async function logCheck(id: string, checkedBy: string): Promise<SupplierProduct | null> {
  const rec = await findSupplierProduct(id);
  if (!rec) return null;
  rec.last_checked_at = new Date().toISOString();
  rec.last_checked_by = checkedBy;
  rec.updated_at = rec.last_checked_at;
  await kvSet(RES, rec.id, rec);
  return rec;
}

export async function addColorReport(
  id: string,
  input: { color: string; reported_by: string; status?: ColorReportStatus; notes?: string },
): Promise<SupplierProduct | null> {
  const rec = await findSupplierProduct(id);
  if (!rec) return null;
  const now = new Date().toISOString();
  const report: ColorReport = {
    id: "cr_" + nanoid(10),
    color: input.color,
    reported_at: now,
    reported_by: input.reported_by,
    status: input.status || "needs-photos",
    notes: input.notes,
  };
  rec.reports.unshift(report);
  rec.last_checked_at = now;
  rec.last_checked_by = input.reported_by;
  rec.updated_at = now;
  await kvSet(RES, rec.id, rec);
  return rec;
}

export async function updateColorReportStatus(
  productId: string,
  reportId: string,
  status: ColorReportStatus,
): Promise<SupplierProduct | null> {
  const rec = await findSupplierProduct(productId);
  if (!rec) return null;
  const report = rec.reports.find((r) => r.id === reportId);
  if (!report) return null;
  report.status = status;
  if (status === "resolved") {
    report.resolved_at = new Date().toISOString();
    // A resolved report for a color the shop didn't already stock/know
    // about graduates into the known list, so it shows up next time
    // without re-reporting it as "new" again.
    if (!rec.known_colors.includes(report.color)) rec.known_colors.push(report.color);
  }
  rec.updated_at = new Date().toISOString();
  await kvSet(RES, rec.id, rec);
  return rec;
}

// "What needs attention" -- anything with an open (non-resolved) report,
// or anything not checked in CHECK_DUE_DAYS. Used for the monthly-cadence
// nudge on the dashboard/morning view.
export async function supplierProductsNeedingAttention(): Promise<{
  openReports: { product: SupplierProduct; report: ColorReport }[];
  overdueChecks: SupplierProduct[];
}> {
  const all = await listSupplierProducts();
  const openReports: { product: SupplierProduct; report: ColorReport }[] = [];
  const overdueChecks: SupplierProduct[] = [];
  const cutoff = Date.now() - CHECK_DUE_DAYS * 24 * 60 * 60 * 1000;
  for (const p of all) {
    for (const r of p.reports) {
      if (r.status !== "resolved") openReports.push({ product: p, report: r });
    }
    const lastChecked = p.last_checked_at ? new Date(p.last_checked_at).getTime() : 0;
    if (lastChecked < cutoff) overdueChecks.push(p);
  }
  return { openReports, overdueChecks };
}
