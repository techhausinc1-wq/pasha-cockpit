// Shared Deno KV plumbing for the whole worker. One connection, reused by
// every lib/*.ts module and main.ts to move persistence off the in-memory
// SAMPLE_* arrays (wiped on every restart) and onto real Deno KV storage —
// same fix, same key-namespacing style, as feliks-valet-cockpit/worker/main.ts
// solved for a sibling business first.
//
// Key namespacing: every key is ["pasha", resource, id]. See main.ts
// top-of-file comment for the full resource list.

let _kv: Deno.Kv | null = null;

export async function getKv(): Promise<Deno.Kv> {
  if (!_kv) _kv = await Deno.openKv();
  return _kv;
}

export function nanoid(len = 24): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const ROOT = "pasha";

// Generic KV-backed list/get/set for a resource namespace under
// [ROOT, resource, id]. Records carrying `_ord` sort newest-first, same
// as the old SAMPLE_*.unshift()/push() display order — KV list order is
// lexicographic by key, not insertion order, so this replaces that.
export async function kvList<T extends { _ord?: number }>(resource: string): Promise<T[]> {
  const kv = await getKv();
  const out: T[] = [];
  const prefix = [ROOT, resource];
  for await (const entry of kv.list<T>({ prefix })) out.push(entry.value);
  out.sort((a, b) => (b._ord ?? 0) - (a._ord ?? 0));
  return out;
}

export async function kvGet<T>(resource: string, id: string): Promise<T | null> {
  const kv = await getKv();
  const key = [ROOT, resource, id];
  const entry = await kv.get<T>(key);
  return entry.value ?? null;
}

export async function kvSet<T>(resource: string, id: string, value: T, ttlMs?: number): Promise<void> {
  const kv = await getKv();
  const key = [ROOT, resource, id];
  if (ttlMs) {
    await kv.set(key, value, { expireIn: ttlMs });
  } else {
    await kv.set(key, value);
  }
}

export async function kvDelete(resource: string, id: string): Promise<void> {
  const kv = await getKv();
  const key = [ROOT, resource, id];
  await kv.delete(key);
}

// Single-document resources (no per-id list) — seeded flag, dashboard
// stats, trucks-inbound, Meta OAuth connection. Modeled as a fixed-id
// record under the same resource namespace so it reuses kvGet/kvSet.
const SINGLETON_ID = "_singleton";
export async function kvGetDoc<T>(resource: string): Promise<T | null> {
  return kvGet<T>(resource, SINGLETON_ID);
}
export async function kvSetDoc<T>(resource: string, value: T): Promise<void> {
  await kvSet(resource, SINGLETON_ID, value);
}
