// Customer records -- the persistent CRM core that messaging, deposits, and
// broadcast all key off of. Real Deno KV persistence (see lib/kv.ts) --
// replaces the process-memory CUSTOMERS array that used to reset on every
// worker restart.

import { kvGet, kvList, kvSet, nanoid } from "./kv.ts";

const RES = "customers";

export interface Customer {
  id: string;
  name: string;
  phone: string | null; // digits only, no +, matches WhatsApp wa_id format
  email: string | null;
  whatsapp_id: string | null; // usually == phone once they have messaged on WhatsApp
  first_seen_at: string;
  last_purchase_at: string | null;
  lifetime_value: number; // sum of completed order totals, dollars
  tags: string[]; // repeat, vip, no-show-risk, etc -- freeform
  notes: string | null;
  _ord: number;
}

// Seed values -- identical to what used to be hardcoded in the CUSTOMERS
// array, so a fresh deploy looks exactly the same as before. Written into
// KV once by seedIfEmpty() in main.ts.
export function seedCustomers(): Customer[] {
  const now = Date.now();
  const list: Customer[] = [];
  list.push({
    id: "c_maria_lopez",
    name: "Maria Lopez",
    phone: null,
    email: null,
    whatsapp_id: null,
    first_seen_at: new Date(now - 30 * 86400000).toISOString(),
    last_purchase_at: null,
    lifetime_value: 0,
    tags: [],
    notes: null,
    _ord: now - 1,
  });
  list.push({
    id: "c_joel_bryant",
    name: "Joel Bryant",
    phone: null,
    email: null,
    whatsapp_id: null,
    first_seen_at: new Date(now - 5 * 86400000).toISOString(),
    last_purchase_at: new Date(now - 22 * 60 * 1000).toISOString(),
    lifetime_value: 2199,
    tags: ["repeat"],
    notes: "Financed the Amelia sectional via Snap.",
    _ord: now - 2,
  });
  return list;
}

export async function findCustomerById(id: string): Promise<Customer | null> {
  return kvGet<Customer>(RES, id);
}

export async function findCustomerByHandle(handle: string): Promise<Customer | null> {
  const norm = handle.replace(/^@/, "").toLowerCase();
  const all = await kvList<Customer>(RES);
  const found = all.find((c) =>
    c.phone === handle || c.whatsapp_id === handle || c.name.toLowerCase() === norm
  );
  return found ?? null;
}

// Idempotent -- used by the WhatsApp webhook and by manual order entry so
// the same person does not end up with two customer records.
export async function findOrCreateCustomer(input: {
  name: string;
  phone?: string | null;
  whatsapp_id?: string | null;
  email?: string | null;
}): Promise<Customer> {
  const all = await kvList<Customer>(RES);
  const existing = (input.whatsapp_id && all.find((c) => c.whatsapp_id === input.whatsapp_id)) ||
    (input.phone && all.find((c) => c.phone === input.phone)) ||
    all.find((c) => c.name.toLowerCase() === input.name.toLowerCase());
  if (existing) {
    let changed = false;
    if (input.whatsapp_id && !existing.whatsapp_id) {
      existing.whatsapp_id = input.whatsapp_id;
      changed = true;
    }
    if (input.phone && !existing.phone) {
      existing.phone = input.phone;
      changed = true;
    }
    if (input.email && !existing.email) {
      existing.email = input.email;
      changed = true;
    }
    if (changed) await kvSet(RES, existing.id, existing);
    return existing;
  }
  const customer: Customer = {
    id: "c_" + nanoid(12),
    name: input.name,
    phone: input.phone ?? null,
    email: input.email ?? null,
    whatsapp_id: input.whatsapp_id ?? null,
    first_seen_at: new Date().toISOString(),
    last_purchase_at: null,
    lifetime_value: 0,
    tags: [],
    notes: null,
    _ord: Date.now(),
  };
  await kvSet(RES, customer.id, customer);
  return customer;
}

export async function recordPurchase(customerId: string, amount: number, at: string): Promise<void> {
  const c = await findCustomerById(customerId);
  if (!c) return;
  c.lifetime_value += amount;
  c.last_purchase_at = at;
  if (!c.tags.includes("repeat") && c.lifetime_value > amount) {
    c.tags.push("repeat");
  }
  await kvSet(RES, c.id, c);
}

export async function searchCustomers(query: string): Promise<Customer[]> {
  const all = await kvList<Customer>(RES);
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter((c) =>
    c.name.toLowerCase().includes(q) ||
    (c.phone && c.phone.includes(q)) ||
    (c.email && c.email.toLowerCase().includes(q)) ||
    c.tags.some((t) => t.toLowerCase().includes(q))
  );
}

export async function seedCustomersIfEmpty(): Promise<void> {
  const existing = await kvList<Customer>(RES);
  if (existing.length > 0) return;
  for (const c of seedCustomers()) await kvSet(RES, c.id, c);
}
