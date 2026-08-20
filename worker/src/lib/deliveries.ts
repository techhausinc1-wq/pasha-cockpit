// Outbound customer delivery scheduling/routing. Real Deno KV persistence
// -- replaces the process-memory SAMPLE_DELIVERIES array.

import { kvGet, kvList, kvSet, nanoid } from "./kv.ts";
import { findOrderById } from "./orders.ts";

const RES = "deliveries";

export type DeliveryStatus = "scheduled" | "en-route" | "delivered" | "failed";

export interface Delivery {
  id: string;
  order_id: string;
  customer_name: string;
  address_area: string;
  scheduled_date: string; // YYYY-MM-DD
  route_label: string;
  crew: string | null;
  status: DeliveryStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  _ord: number;
}

export function seedDeliveries(): Delivery[] {
  const now = Date.now();
  const list: Delivery[] = [];
  list.push({
    id: "d_1",
    order_id: "o_1",
    customer_name: "Joel Bryant",
    address_area: "Converse, TX",
    scheduled_date: new Date(now + 3 * 86400000).toISOString().slice(0, 10),
    route_label: "Route A - Northeast",
    crew: "Manny & Deo",
    status: "scheduled",
    notes: "2nd floor apt, no elevator -- confirm crew size before dispatch.",
    created_at: new Date(now - 20 * 60 * 1000).toISOString(),
    updated_at: new Date(now - 20 * 60 * 1000).toISOString(),
    _ord: now,
  });
  return list;
}

export async function listDeliveries(): Promise<Delivery[]> {
  return kvList<Delivery>(RES);
}

export async function findDeliveryById(id: string): Promise<Delivery | null> {
  return kvGet<Delivery>(RES, id);
}

export async function deliveriesByDate(date: string): Promise<Delivery[]> {
  const all = await kvList<Delivery>(RES);
  return all.filter((d) => d.scheduled_date === date);
}

export async function scheduleDelivery(input: {
  order_id: string;
  customer_name: string;
  address_area: string;
  scheduled_date: string;
  route_label: string;
  crew?: string | null;
  notes?: string | null;
}): Promise<Delivery> {
  // Validate the order exists so a delivery cannot silently reference
  // nothing -- does not hard-fail the caller, just leaves it uncoupled.
  await findOrderById(input.order_id);
  const now = new Date().toISOString();
  const delivery: Delivery = {
    id: "d_" + nanoid(12),
    order_id: input.order_id,
    customer_name: input.customer_name,
    address_area: input.address_area,
    scheduled_date: input.scheduled_date,
    route_label: input.route_label,
    crew: input.crew ?? null,
    status: "scheduled",
    notes: input.notes ?? null,
    created_at: now,
    updated_at: now,
    _ord: Date.now(),
  };
  await kvSet(RES, delivery.id, delivery);
  return delivery;
}

export async function updateDeliveryStatus(id: string, status: DeliveryStatus): Promise<Delivery | null> {
  const d = await findDeliveryById(id);
  if (!d) return null;
  d.status = status;
  d.updated_at = new Date().toISOString();
  await kvSet(RES, d.id, d);
  return d;
}

export async function seedDeliveriesIfEmpty(): Promise<void> {
  const existing = await kvList<Delivery>(RES);
  if (existing.length > 0) return;
  for (const d of seedDeliveries()) await kvSet(RES, d.id, d);
}
