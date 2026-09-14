// Shared KV plumbing for the whole worker -- Cloudflare Workers KV port.
// Every exported function signature is unchanged from the original Deno KV
// version so no other lib/*.ts file needed to change; only this file's
// internals differ. See main.ts's fetch()/scheduled() handlers for
// setKvNamespace(), the Cloudflare equivalent of the old getKv().
//
// Key namespacing: every key is "pasha:<resource>:<id>" (Cloudflare KV
// keys are flat strings, not the tuple keys Deno.Kv used -- ":" joins
// serve the same namespacing purpose).
//
// Real semantic difference from the Deno KV version worth knowing:
// Cloudflare KV's list() returns keys only, not values, and is eventually
// consistent (writes can take up to ~60s to be visible from list() in
// other regions -- reads by exact key are consistent from the writing
// location immediately). Fine for this worker's real traffic level and
// usage pattern (a single small business's own data, not a
// high-concurrency multi-writer system) -- not fine to assume for a
// higher-traffic product without re-checking this tradeoff.

export interface KvNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string }): Promise<{ keys: { name: string }[] }>;
}

let _kv: KvNamespaceLike | null = null;

export function setKvNamespace(ns: KvNamespaceLike): void {
  _kv = ns;
}

function kv(): KvNamespaceLike {
  if (!_kv) throw new Error("KV namespace not set -- setKvNamespace() must be called before any kv* function, same as main.ts does at the top of fetch()/scheduled().");
  return _kv;
}

export function nanoid(len = 24): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const ROOT = "pasha";
function keyFor(resource: string, id: string): string {
  return ROOT + ":" + resource + ":" + id;
}

// Generic KV-backed list/get/set for a resource namespace under
// "pasha:<resource>:<id>". Records carrying `_ord` sort newest-first, same
// display order the Deno KV version produced.
export async function kvList<T>(resource: string): Promise<T[]> {
  const prefix = ROOT + ":" + resource + ":";
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page: { keys: { name: string }[]; cursor?: string; list_complete?: boolean } = await (kv() as unknown as {
      list(opts: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; cursor?: string; list_complete?: boolean }>;
    }).list({ prefix, cursor });
    for (const k of page.keys) {
      const raw = await kv().get(k.name);
      if (raw) {
        try {
          out.push(JSON.parse(raw) as T);
        } catch { /* skip a corrupt record rather than fail the whole list */ }
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  out.sort((a, b) => ((b as { _ord?: number })._ord ?? 0) - ((a as { _ord?: number })._ord ?? 0));
  return out;
}

export async function kvGet<T>(resource: string, id: string): Promise<T | null> {
  const raw = await kv().get(keyFor(resource, id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSet<T>(resource: string, id: string, value: T, ttlMs?: number): Promise<void> {
  const opts = ttlMs ? { expirationTtl: Math.max(60, Math.ceil(ttlMs / 1000)) } : undefined; // Cloudflare KV requires expirationTtl >= 60s
  await kv().put(keyFor(resource, id), JSON.stringify(value), opts);
}

export async function kvDelete(resource: string, id: string): Promise<void> {
  await kv().delete(keyFor(resource, id));
}

// Single-document resources (no per-id list) -- seeded flag, dashboard
// stats, trucks-inbound, Meta/TikTok OAuth connections.
const SINGLETON_ID = "_singleton";
export async function kvGetDoc<T>(resource: string): Promise<T | null> {
  return kvGet<T>(resource, SINGLETON_ID);
}
export async function kvSetDoc<T>(resource: string, value: T): Promise<void> {
  await kvSet(resource, SINGLETON_ID, value);
}
