// Customer records — the persistent CRM core that messaging, deposits, and
// broadcast all key off of. No DB yet (Phase 1 shell): process-memory only,
// resets on worker restart, same tradeoff as WHATSAPP_LIVE_THREADS.

export interface Customer {
  id: string;
  name: string;
  phone: string | null; // digits only, no +, matches WhatsApp wa_id format
  email: string | null;
  whatsapp_id: string | null; // usually == phone once they've messaged on WhatsApp
  first_seen_at: string;
  last_purchase_at: string | null;
  lifetime_value: number; // sum of completed order totals, dollars
  tags: string[]; // "repeat", "vip", "no-show-risk", etc — freeform
  notes: string | null;
}

// Seed a few from the existing sample threads so the customer list isn't
// empty on first load — mirrors those threads' customer_name/handle so
// searching for "Maria Lopez" etc. shows something real-looking.
export const CUSTOMERS: Customer[] = [
  {
    id: "c_maria_lopez",
    name: "Maria Lopez",
    phone: null,
    email: null,
    whatsapp_id: null,
    first_seen_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    last_purchase_at: null,
    lifetime_value: 0,
    tags: [],
    notes: null,
  },
  {
    id: "c_joel_bryant",
    name: "Joel Bryant",
    phone: null,
    email: null,
    whatsapp_id: null,
    first_seen_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    last_purchase_at: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
    lifetime_value: 2199,
    tags: ["repeat"],
    notes: "Financed the Amelia sectional via Snap.",
  },
];

export function findCustomerById(id: string): Customer | undefined {
  return CUSTOMERS.find((c) => c.id === id);
}

export function findCustomerByHandle(
  handle: string,
): Customer | undefined {
  const norm = handle.replace(/^@/, "").toLowerCase();
  return CUSTOMERS.find((c) =>
    c.phone === handle || c.whatsapp_id === handle ||
    c.name.toLowerCase() === norm
  );
}

// Idempotent — used by the WhatsApp webhook and by manual order entry so
// the same person doesn't end up with two customer records.
export function findOrCreateCustomer(input: {
  name: string;
  phone?: string | null;
  whatsapp_id?: string | null;
  email?: string | null;
}): Customer {
  const existing = (input.whatsapp_id &&
    CUSTOMERS.find((c) => c.whatsapp_id === input.whatsapp_id)) ||
    (input.phone && CUSTOMERS.find((c) => c.phone === input.phone)) ||
    CUSTOMERS.find((c) => c.name.toLowerCase() === input.name.toLowerCase());
  if (existing) {
    if (input.whatsapp_id && !existing.whatsapp_id) {
      existing.whatsapp_id = input.whatsapp_id;
    }
    if (input.phone && !existing.phone) existing.phone = input.phone;
    if (input.email && !existing.email) existing.email = input.email;
    return existing;
  }
  const customer: Customer = {
    id: `c_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    name: input.name,
    phone: input.phone ?? null,
    email: input.email ?? null,
    whatsapp_id: input.whatsapp_id ?? null,
    first_seen_at: new Date().toISOString(),
    last_purchase_at: null,
    lifetime_value: 0,
    tags: [],
    notes: null,
  };
  CUSTOMERS.push(customer);
  return customer;
}

export function recordPurchase(
  customerId: string,
  amount: number,
  at: string,
): void {
  const c = findCustomerById(customerId);
  if (!c) return;
  c.lifetime_value += amount;
  c.last_purchase_at = at;
  if (!c.tags.includes("repeat") && c.lifetime_value > amount) {
    c.tags.push("repeat");
  }
}

export function searchCustomers(query: string): Customer[] {
  const q = query.trim().toLowerCase();
  if (!q) return CUSTOMERS;
  return CUSTOMERS.filter((c) =>
    c.name.toLowerCase().includes(q) ||
    (c.phone && c.phone.includes(q)) ||
    (c.email && c.email.toLowerCase().includes(q)) ||
    c.tags.some((t) => t.toLowerCase().includes(q))
  );
}
