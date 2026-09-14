// Minimal ambient declarations for the Cloudflare Workers runtime types
// this file uses. Deliberately not the full @cloudflare/workers-types
// package -- this worker only touches a handful of runtime concepts
// (Fetcher for the ASSETS binding, ExecutionContext.waitUntil, the
// scheduled() event shape), so a small hand-written surface is easier to
// reason about than pulling in a large generated types package for a
// small worker. Extend this file if a future change needs more of the
// runtime surface.

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
}
