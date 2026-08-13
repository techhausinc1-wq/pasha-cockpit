// Outbound customer delivery scheduling/routing — the operational half of
// the "$79 flat delivery anywhere in San Antonio" promise the Drafter
// already makes in every reply. Furniture Wizard, MicroBiz, Upper, and
// Locate2u all treat truck/crew-assigned delivery routing as a base
// feature; this cockpit had none before.
//
// Kept deliberately simple for the shell: a delivery is scheduled for a
// date and grouped under a route_label (e.g. "North" / "South") so a
// dispatcher can eyeball who's on which truck that day — real
// distance-based route optimization is a later-phase upgrade, not a
// blocker for getting this operationally useful today.

import { findOrderById } from "./orders.ts";

export type DeliveryStatus = "scheduled" | "en-route" | "delivered" | "failed";

export interface Delivery {
  id: string;
  order_id: string;
  customer_name: string;
  address_area: string; // neighborhood/zip label — no geocoding in the shell
  scheduled_date: string; // YYYY-MM-DD
  route_label: string; // dispatcher-assigned grouping, e.g. "Route A - North"
  crew: string | null;
  status: DeliveryStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const SAMPLE_DELIVERIES: Delivery[] = [
  {
    id: "d_1",
    order_id: "o_1",
    customer_name: "Joel Bryant",
    address_area: "Converse, TX",
    scheduled_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(
      0,
      10,
    ),
    route_label: "Route A - Northeast",
    crew: "Manny & Deo",
    status: "scheduled",
    notes: "2nd floor apt, no elevator — confirm crew size before dispatch.",
    created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  },
];

export function findDeliveryById(id: string): Delivery | undefined {
  return SAMPLE_DELIVERIES.find((d) => d.id === id);
}

export function deliveriesByDate(date: string): Delivery[] {
  return SAMPLE_DELIVERIES.filter((d) => d.scheduled_date === date);
}

export function scheduleDelivery(input: {
  order_id: string;
  customer_name: string;
  address_area: string;
  scheduled_date: string;
  route_label: string;
  crew?: string | null;
  notes?: string | null;
}): Delivery {
  // Validate the order exists so a delivery can't silently reference
  // nothing — doesn't hard-fail the caller, just leaves it uncoupled.
  findOrderById(input.order_id);
  const now = new Date().toISOString();
  const delivery: Delivery = {
    id: `d_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
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
  };
  SAMPLE_DELIVERIES.push(delivery);
  return delivery;
}

export function updateDeliveryStatus(
  id: string,
  status: DeliveryStatus,
): Delivery | null {
  const d = findDeliveryById(id);
  if (!d) return null;
  d.status = status;
  d.updated_at = new Date().toISOString();
  return d;
}
