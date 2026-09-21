// Deposit / balance-due ledger for special orders. Real Deno KV persistence
// -- replaces the process-memory SAMPLE_ORDERS array.

import { kvGet, kvList, kvSet, nanoid } from "./kv.ts";
import { recordPurchase } from "./customers.ts";

const RES = "orders";

export type OrderStatus =
  | "deposit-paid"
  | "awaiting-truck"
  | "ready-for-delivery"
  | "delivered"
  | "cancelled";

export interface Order {
  id: string;
  customer_id: string;
  customer_name: string;
  product_slugs: string[];
  total_amount: number;
  deposit_amount: number;
  balance_due: number;
  status: OrderStatus;
  supplier: "Crown Mark" | "Happy Homes" | "In stock" | "Other";
  worker_id: string;
  created_at: string;
  updated_at: string;
  _ord: number;
  signature_key?: string;
  notes?: string;
}

export function seedOrders(): Order[] {
  const now = Date.now();
  const list: Order[] = [];
  list.push({
    id: "o_1",
    customer_id: "c_joel_bryant",
    customer_name: "Joel Bryant",
    product_slugs: ["amelia-charcoal-power-reclining-sectional-w-bluetooth-speakers"],
    total_amount: 2199,
    deposit_amount: 2199,
    balance_due: 0,
    status: "awaiting-truck",
    supplier: "Crown Mark",
    worker_id: "u_carlos",
    created_at: new Date(now - 22 * 60 * 1000).toISOString(),
    updated_at: new Date(now - 22 * 60 * 1000).toISOString(),
    _ord: now - 1,
  });
  list.push({
    id: "o_2",
    customer_id: "c_maria_lopez",
    customer_name: "Maria Lopez",
    product_slugs: ["logan2-charcoal-reversible-sectional-charcoal"],
    total_amount: 1899,
    deposit_amount: 300,
    balance_due: 1599,
    status: "deposit-paid",
    supplier: "Happy Homes",
    worker_id: "u_rick",
    created_at: new Date(now - 8 * 60 * 1000).toISOString(),
    updated_at: new Date(now - 8 * 60 * 1000).toISOString(),
    _ord: now - 2,
  });
  return list;
}

export async function listOrders(): Promise<Order[]> {
  return kvList<Order>(RES);
}

export async function findOrderById(id: string): Promise<Order | null> {
  return kvGet<Order>(RES, id);
}

export async function ordersForCustomer(customerId: string): Promise<Order[]> {
  const all = await kvList<Order>(RES);
  return all.filter((o) => o.customer_id === customerId);
}

export async function createOrder(input: {
  customer_id: string;
  customer_name: string;
  product_slugs: string[];
  total_amount: number;
  deposit_amount: number;
  supplier: Order["supplier"];
  worker_id: string;
  signature_key?: string;
  notes?: string;
}): Promise<Order> {
  const now = new Date().toISOString();
  const order: Order = {
    id: "o_" + nanoid(12),
    customer_id: input.customer_id,
    customer_name: input.customer_name,
    product_slugs: input.product_slugs,
    total_amount: input.total_amount,
    deposit_amount: input.deposit_amount,
    balance_due: Math.max(0, input.total_amount - input.deposit_amount),
    status: input.deposit_amount >= input.total_amount ? "awaiting-truck" : "deposit-paid",
    supplier: input.supplier,
    worker_id: input.worker_id,
    created_at: now,
    updated_at: now,
    _ord: Date.now(),
    ...(input.signature_key ? { signature_key: input.signature_key } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };
  await kvSet(RES, order.id, order);
  // The deposit itself counts toward lifetime value immediately -- full
  // balance gets added when recordBalancePayment closes it out.
  await recordPurchase(input.customer_id, input.deposit_amount, now);
  return order;
}

export async function recordBalancePayment(orderId: string, amount: number): Promise<Order | null> {
  const order = await findOrderById(orderId);
  if (!order) return null;
  order.balance_due = Math.max(0, order.balance_due - amount);
  order.updated_at = new Date().toISOString();
  if (order.balance_due === 0 && order.status === "deposit-paid") {
    order.status = "awaiting-truck";
  }
  await kvSet(RES, order.id, order);
  await recordPurchase(order.customer_id, amount, order.updated_at);
  return order;
}

export async function updateOrderStatus(orderId: string, status: OrderStatus): Promise<Order | null> {
  const order = await findOrderById(orderId);
  if (!order) return null;
  order.status = status;
  order.updated_at = new Date().toISOString();
  await kvSet(RES, order.id, order);
  return order;
}

export async function seedOrdersIfEmpty(): Promise<void> {
  const existing = await kvList<Order>(RES);
  if (existing.length > 0) return;
  for (const o of seedOrders()) await kvSet(RES, o.id, o);
}
