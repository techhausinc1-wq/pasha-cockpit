// Cloudflare Workers pass `env` as a per-request argument to fetch()/
// scheduled(), unlike Deno's global `Deno.env.get()`. Every lib/*.ts file
// in this worker was written against the Deno global, so rather than
// thread `env` through dozens of call sites, this module captures it into
// a module-scoped variable at the top of each request (before any
// `await`, so no concurrent request can interleave and overwrite it
// before the current request's synchronous env reads complete -- the
// existing pattern throughout this codebase already reads env vars
// synchronously at the top of each function, before any network calls).
//
// Real, low-traffic single-business tool (Cloudflare's own dashboard
// showed 93-114 total requests over this worker's life) -- this is a
// deliberate, proportionate tradeoff, not a guess: full AsyncLocalStorage-
// style request isolation would be the enterprise-grade answer, not
// needed at this scale.

let currentEnv: Record<string, string | undefined> = {};

export function setEnv(env: Record<string, string | undefined>): void {
  currentEnv = env;
}

export function getEnv(key: string): string | undefined {
  return currentEnv[key];
}
