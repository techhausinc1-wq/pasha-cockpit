// Pasha cockpit worker -- real backend. Deno KV persistence (lib/kv.ts),
// PIN auth + server-side RBAC enforcement (lib/auth.ts + lib/rbac.ts,
// atoms unchanged from the spec, only the auth boundary in front of them
// is now real), and real call sites for reel/video generation (fal.ai),
// the advertising-venue Scout (Anthropic web search), Meta (FB/IG) OAuth,
// and the financing/ad-platform/TikTok integrations -- each gated on its
// own env vars with a graceful "not configured" fallback, same pattern as
// feliks-valet-cockpit/worker/main.ts and igor-hq/worker/main.ts.
//
// Auth: POST /api/login exchanges {userId, pin} for a bearer session
// token (see lib/auth.ts); every other /api/* route resolves that token
// back to a User, then checks the same ROLE_ATOMS table lib/rbac.ts always
// defined. This replaces the old "X-Access-Code: pasha-shell-<userid>"
// scheme, where any caller who knew the naming convention could mint a
// valid code for any user id -- the atom checks below were previously
// real logic sitting behind a fake door.

import {
  type Atom,
  effectiveAtoms,
  SHELL_USERS,
} from "./lib/rbac.ts";
import {
  bearerToken,
  createSession,
  deleteSession,
  getUserById,
  listUsers,
  seedUsersIfEmpty,
  setUserPin,
  userFromToken,
  verifyPin,
} from "./lib/auth.ts";
import {
  getDashboardStats,
  getTrucksInbound,
  listAP,
  listApplications,
  listTax,
  listThreads,
  markThreadSent,
  seedSampleDataIfEmpty,
  upsertMetaThread,
  upsertWhatsAppThread,
} from "./lib/sample-data.ts";
import {
  classifyByRules,
  draftReply,
  type InboundContext,
} from "./lib/drafter.ts";
import {
  broadcastWhatsAppTemplate,
  handleWebhookVerification,
  parseWebhookPayload,
  sendWhatsAppText,
  verifyWebhookSignature,
} from "./lib/whatsapp.ts";
import {
  type Customer,
  findOrCreateCustomer,
  searchCustomers,
  seedCustomersIfEmpty,
} from "./lib/customers.ts";
import {
  createOrder,
  listOrders,
  ordersForCustomer,
  recordBalancePayment,
  seedOrdersIfEmpty,
} from "./lib/orders.ts";
import {
  deliveriesByDate,
  listDeliveries,
  scheduleDelivery,
  seedDeliveriesIfEmpty,
  updateDeliveryStatus,
} from "./lib/deliveries.ts";
import { falConfigured, generateCaptions, PROMO_TAGS, startReel, advanceReel, startStitchJob, advanceStitchJob, startCustomVideo, startTextVideo } from "./lib/reels.ts";
import { listProspects, logOutreach, runScoutSearch, saveProspect, seedScoutIfEmpty, updateProspect } from "./lib/scout.ts";
import {
  completeConnect,
  consumeOAuthState,
  getMetaConn,
  metaConfigured,
  startConnect,
} from "./lib/meta-oauth.ts";
import {
  handleMetaWebhookVerification,
  parseMetaWebhookPayload,
  resolveMetaAccountLabel,
  resolveMetaSenderName,
  verifyMetaWebhookSignature,
} from "./lib/meta-messaging.ts";
import { lenderConfigured, submitToLender, type LenderName } from "./lib/financing.ts";
import { adPlatformsConfigured, getGoogleAdInsights, getMetaAdInsights, getTikTokAdInsights } from "./lib/ad-platforms.ts";
import { publishToTikTok, tiktokConfigured } from "./lib/tiktok.ts";
import {
  completeConnect as completeTikTokConnect,
  consumeOAuthState as consumeTikTokOAuthState,
  startConnect as startTikTokConnect,
  tiktokOAuthConfigured,
} from "./lib/tiktok-oauth.ts";
import { buildDailyDigestData, resendConfigured, sendDailyDigestEmail } from "./lib/digest.ts";
import { getEnv, setEnv } from "./lib/env.ts";
import { setKvNamespace, type KvNamespaceLike } from "./lib/kv.ts";

// Cloudflare Workers port: static files (formerly worker/docs/,
// worker/data/, read via Deno.readFile) are now served through the
// [assets] binding in wrangler.toml (see serveStatic() and readCatalog()
// below) -- catalog.json was copied into docs/ so a single assets
// directory covers both, matching the deploy-root gotcha the original
// Deno comment here described (a sibling dir outside the served root
// silently 404s in production).
function publicUrl(): string {
  return (getEnv("PUBLIC_URL") ?? "").replace(/\/$/, "");
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
function bad(msg: string, status = 400): Response {
  return json({ error: msg }, status);
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function htmlRedirect(msg: string, backTo: string): Response {
  const refresh = "1.5;url=" + backTo;
  const body = "<!doctype html><meta charset=utf-8><title>210 Cockpit</title><meta http-equiv=refresh content=" +
    JSON.stringify(refresh) + "><div style=" + JSON.stringify("font-family:system-ui;padding:40px;text-align:center") +
    ">" + escapeHtml(msg) + "</div>";
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
function selfOrigin(req: Request): string {
  const p = publicUrl();
  if (p) return p;
  const u = new URL(req.url);
  return u.protocol + "//" + u.host;
}

// Cloudflare Workers static-asset serving: the [assets] binding in
// wrangler.toml (binding = "ASSETS", directory = "../docs") exposes a
// fetch()-shaped interface over the deployed static files -- the
// Cloudflare-native equivalent of the old Deno.readFile(WEB_DIR + path)
// approach. catalog.json was copied into docs/ (see readCatalog() below)
// so this one binding covers everything the old WEB_DIR/DATA_DIR split did.
async function serveStatic(pathname: string, assets: Fetcher): Promise<Response> {
  const assetPath = (pathname === "/" || pathname === "") ? "/index.html" : pathname;
  const res = await assets.fetch(new Request("https://assets.internal" + assetPath));
  if (res.status === 404) return new Response("Not found", { status: 404 });
  // ASSETS sets its own content-type/caching; only add the no-cache header
  // this app has always served static files with (matches the old
  // Deno.readFile path's explicit "no-cache" -- this is a small-business
  // internal tool where seeing a stale cached build after a deploy caused
  // real confusion before, not a high-traffic site that needs aggressive
  // asset caching).
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-cache");
  return new Response(res.body, { status: res.status, headers });
}

// catalog.json is read server-side in two places below (not just served
// as a static asset to the browser) -- via the same ASSETS binding rather
// than Deno.readFile, since Cloudflare Workers have no filesystem access
// at runtime. Cached in-isolate after first read since it's static
// per-deployment content, not per-request state.
// deno-lint-ignore no-explicit-any
let _catalogCache: any = null;
// deno-lint-ignore no-explicit-any
async function readCatalog(assets: Fetcher): Promise<any> {
  if (_catalogCache) return _catalogCache;
  const res = await assets.fetch(new Request("https://assets.internal/catalog.json"));
  if (!res.ok) throw new Error("catalog.json not found in ASSETS binding");
  _catalogCache = await res.json();
  return _catalogCache;
}

// ═══════════════════════════════════════════════════════════════════════
// BOOT SEED -- writes SHELL_USERS (rbac.ts) and every SAMPLE_* resource
// into KV on first request, so a fresh deploy looks identical to the old
// hardcoded-array shell. Each seeder only writes what does not already
// exist, so this is safe to call more than once -- but Cloudflare
// Workers isolates are reused across many requests (unlike Deno's
// once-at-boot model), so `seededThisIsolate` avoids redundant KV reads
// on every single request within the same isolate's lifetime.
// ═══════════════════════════════════════════════════════════════════════
let seededThisIsolate = false;
async function ensureSeeded(): Promise<void> {
  if (seededThisIsolate) return;
  await seedUsersIfEmpty();
  await seedSampleDataIfEmpty();
  await seedScoutIfEmpty();
  await seedCustomersIfEmpty();
  await seedOrdersIfEmpty();
  await seedDeliveriesIfEmpty();
  seededThisIsolate = true;
}

// Real end-of-day report, sent every night to every owner-level user with
// a real email on file (Paul, Ivan) -- item 7 of Ivan's "do everything"
// ask, 2026-09-10. Only fires for real once RESEND_API_KEY/DIGEST_EMAIL_FROM
// are set; sendDailyDigestEmail() no-ops gracefully until then. Invoked
// from the scheduled() handler below (Cloudflare Cron Trigger, see
// wrangler.toml [triggers] crons -- same "0 21 * * *" schedule as the old
// Deno.cron call, both UTC).
async function runDailyDigest(): Promise<void> {
  if (!resendConfigured()) {
    console.log("Daily digest cron fired but RESEND_API_KEY/DIGEST_EMAIL_FROM not set -- skipping send.");
    return;
  }
  for (const u of SHELL_USERS) {
    if (!u.is_master || !u.email) continue;
    const result = await sendDailyDigestEmail(u.email);
    console.log("Daily digest to " + u.email + ": " + (result.ok ? "sent" : "failed -- " + result.error));
  }
}

interface Env {
  KV: KvNamespaceLike;
  ASSETS: Fetcher;
  [key: string]: unknown; // every secret/var below is read through getEnv(), not a typed field here
}

async function handleRequest(req: Request, env: Env): Promise<Response> {
  setEnv(env as unknown as Record<string, string | undefined>);
  setKvNamespace(env.KV);
  await ensureSeeded();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  // ── Meta OAuth -- public GET routes (browser navigation, no
  // Authorization header available; auth via ?token= query param, same
  // trick igor-hq/worker/main.ts uses with ?code=) ─────────────────────
  if (path === "/oauth/facebook/start" && req.method === "GET") {
    const user = await userFromToken(url.searchParams.get("token") || "");
    if (!user) return bad("Unauthorized", 401);
    if (!effectiveAtoms(user).has("config.integrations")) return bad("Forbidden -- missing atom config.integrations", 403);
    if (!metaConfigured()) return bad("META_APP_ID/META_APP_SECRET not set on this deployment -- see docs/META-BUSINESS-SETUP.md", 500);
    const redirectUri = selfOrigin(req) + "/oauth/facebook/callback";
    const authUrl = await startConnect(redirectUri);
    return Response.redirect(authUrl, 302);
  }
  if (path === "/oauth/facebook/callback" && req.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") || "";
    const errParam = url.searchParams.get("error");
    if (errParam) return htmlRedirect("Facebook denied: " + errParam, "/#live");
    if (!code) return bad("Missing code", 400);
    const validState = await consumeOAuthState(state);
    if (!validState) return bad("Invalid or expired state", 400);
    try {
      const redirectUri = selfOrigin(req) + "/oauth/facebook/callback";
      await completeConnect(code, redirectUri);
      return htmlRedirect("Facebook connected. Returning to 210 Cockpit...", "/#live");
    } catch (e) {
      return htmlRedirect("Connect failed: " + (e instanceof Error ? e.message : String(e)), "/#live");
    }
  }

  // ── TikTok OAuth (Login Kit) -- the callback route docs/TIKTOK-SETUP.md
  // Phase 1 step 5 flagged as "does not exist yet; the natural next step."
  // Same public-GET/?token= shape as the Facebook routes above.
  if (path === "/oauth/tiktok/start" && req.method === "GET") {
    const user = await userFromToken(url.searchParams.get("token") || "");
    if (!user) return bad("Unauthorized", 401);
    if (!effectiveAtoms(user).has("config.integrations")) return bad("Forbidden -- missing atom config.integrations", 403);
    if (!tiktokOAuthConfigured()) return bad("TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET not set on this deployment -- see docs/TIKTOK-SETUP.md", 500);
    const redirectUri = selfOrigin(req) + "/oauth/tiktok/callback";
    const authUrl = await startTikTokConnect(redirectUri);
    return Response.redirect(authUrl, 302);
  }
  if (path === "/oauth/tiktok/callback" && req.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") || "";
    const errParam = url.searchParams.get("error");
    if (errParam) return htmlRedirect("TikTok denied: " + errParam, "/#live");
    if (!code) return bad("Missing code", 400);
    const validState = await consumeTikTokOAuthState(state);
    if (!validState) return bad("Invalid or expired state", 400);
    try {
      const redirectUri = selfOrigin(req) + "/oauth/tiktok/callback";
      await completeTikTokConnect(code, redirectUri);
      return htmlRedirect("TikTok connected. Returning to 210 Cockpit...", "/#live");
    } catch (e) {
      return htmlRedirect("Connect failed: " + (e instanceof Error ? e.message : String(e)), "/#live");
    }
  }

  // ── static (no auth) ──────────────────────────────────────────────────
  if (!path.startsWith("/api/")) {
    return serveStatic(path, env.ASSETS);
  }

  // ── public API routes ────────────────────────────────────────────────
  if (path === "/api/login" && req.method === "POST") {
    let body: { userId?: string; pin?: string };
    try {
      body = await req.json();
    } catch {
      return bad("invalid_json");
    }
    const userId = (body.userId || "").trim();
    const pin = (body.pin || "").trim();
    if (!userId || !pin) return bad("userId and pin required");
    const user = await verifyPin(userId, pin);
    if (!user) return bad("Incorrect PIN", 401);
    const token = await createSession(user.id);
    return json({
      token,
      user: { id: user.id, name: user.name, role: user.role, email: user.email, is_master: user.is_master, assigned_accounts: user.assigned_accounts },
      atoms: Array.from(effectiveAtoms(user)),
    });
  }

  // shell-era picker helper -- lists id/name/role only (no PIN), used by
  // the frontend login gate to render the tap-a-name picker before the PIN
  // pad. No auth required: this is display-only, matches SHELL_USERS,
  // never includes a PIN.
  if (path === "/api/_shell/users") {
    return json({ users: SHELL_USERS.map((u) => ({ id: u.id, name: u.name, role: u.role, is_master: u.is_master })) });
  }

  // ── WhatsApp webhook -- no auth; Meta calls these directly ────────────
  if (path === "/api/whatsapp/webhook" && req.method === "GET") {
    return handleWebhookVerification(url);
  }
  if (path === "/api/whatsapp/webhook" && req.method === "POST") {
    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256");
    const validSig = await verifyWebhookSignature(rawBody, signature);
    if (!validSig) {
      console.warn("WhatsApp webhook: invalid or missing signature, rejecting");
      return json({ error: "invalid_signature" }, 403);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const inbound = parseWebhookPayload(payload);
    for (const msg of inbound) {
      await upsertWhatsAppThread(msg);
      await findOrCreateCustomer({ name: msg.name || msg.wa_id, phone: msg.wa_id, whatsapp_id: msg.wa_id });
    }
    return json({ received: inbound.length });
  }

  // ── Messenger/Instagram DM webhook -- no auth; Meta calls these directly.
  // Code-complete, cannot receive real traffic until Meta grants
  // pages_messaging + instagram_manage_messages via App Review (see
  // docs/META-BUSINESS-SETUP.md Phase 3) -- same honest-gap pattern as
  // everything else in this worker, not faked in the meantime.
  if (path === "/api/meta/webhook" && req.method === "GET") {
    return handleMetaWebhookVerification(url);
  }
  if (path === "/api/meta/webhook" && req.method === "POST") {
    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256");
    const validSig = await verifyMetaWebhookSignature(rawBody, signature);
    if (!validSig) {
      console.warn("Meta webhook: invalid or missing signature, rejecting");
      return json({ error: "invalid_signature" }, 403);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const inbound = parseMetaWebhookPayload(payload);
    for (const msg of inbound) {
      const [senderName, accountLabel] = await Promise.all([
        resolveMetaSenderName(msg.surface, msg.recipientId, msg.senderId),
        resolveMetaAccountLabel(msg.surface, msg.recipientId),
      ]);
      await upsertMetaThread({
        surface: msg.surface,
        senderId: msg.senderId,
        senderName,
        accountId: msg.recipientId,
        accountLabel,
        text: msg.text,
        timestamp: msg.timestamp,
      });
      await findOrCreateCustomer({ name: senderName || msg.senderId, phone: null, whatsapp_id: null });
    }
    return json({ received: inbound.length });
  }

  // ── everything below requires a valid bearer session ────────────────
  const user = await userFromToken(bearerToken(req));
  if (!user) return json({ error: "unauthorized" }, 401);
  const atoms = effectiveAtoms(user);
  const can = (atom: Atom) => atoms.has(atom);

  if (path === "/api/whoami" || path === "/api/me") {
    return json({
      user: { id: user.id, name: user.name, role: user.role, email: user.email, is_master: user.is_master, assigned_accounts: user.assigned_accounts },
      atoms: Array.from(atoms),
    });
  }
  if (path === "/api/logout" && req.method === "POST") {
    await deleteSession(bearerToken(req));
    return json({ ok: true });
  }

  // ── WhatsApp send ──────────────────────────────────────────────────────
  if (path === "/api/whatsapp/send" && req.method === "POST") {
    if (!can("messages.send.assigned-accounts") && !can("messages.send.any-account")) {
      return json({ error: "forbidden", missing_atom: "messages.send.assigned-accounts" }, 403);
    }
    let body: { to?: string; text?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!body.to || !body.text) return json({ error: "to_and_text_required" }, 400);
    const result = await sendWhatsAppText(body.to, body.text);
    if (!result.ok) return json({ error: "send_failed", detail: result.error }, 502);
    await markThreadSent(body.to, body.text);
    return json({ ok: true, message_id: result.message_id });
  }

  // ── messaging ──────────────────────────────────────────────────────────
  if (path === "/api/threads" && req.method === "GET") {
    let threads = await listThreads();
    if (!can("messages.read.all")) {
      if (can("messages.read.team")) {
        threads = threads.filter((t) => (user.assigned_accounts || []).includes(t.account_id) || t.worker_id === user.id);
      } else if (can("messages.read.own")) {
        threads = threads.filter((t) => t.worker_id === user.id);
      } else {
        return json({ error: "forbidden", missing_atom: "messages.read.own" }, 403);
      }
    }
    return json({ threads });
  }

  // ── financing waterfall ──────────────────────────────────────────────
  if (path === "/api/financing/applications" && req.method === "GET") {
    let apps = await listApplications();
    if (!can("financing.read.all-applications")) {
      if (can("financing.read.applications")) {
        apps = apps.filter((a) => a.worker_id === user.id);
      } else {
        return json({ error: "forbidden", missing_atom: "financing.read.applications" }, 403);
      }
    }
    return json({ applications: apps });
  }
  // Real lender submission -- item 6. Runs one lender at a time (matches
  // the existing lender_attempts shape, one attempt per call, not an
  // all-five blast) via lib/financing.ts, gated on that lenders own env
  // vars with a graceful not-configured fallback.
  if (path === "/api/financing/submit" && req.method === "POST") {
    if (!can("financing.initiate")) return json({ error: "forbidden", missing_atom: "financing.initiate" }, 403);
    let body: { lender?: LenderName; firstName?: string; lastName?: string; phone?: string; email?: string; addressLine1?: string; city?: string; state?: string; zip?: string; cartTotal?: number };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!body.lender || !body.firstName || !body.lastName || !body.phone || !body.addressLine1 || !body.cartTotal) {
      return json({ error: "missing_fields", required: ["lender", "firstName", "lastName", "phone", "addressLine1", "cartTotal"] }, 400);
    }
    const result = await submitToLender(body.lender, {
      firstName: body.firstName, lastName: body.lastName, phone: body.phone, email: body.email,
      addressLine1: body.addressLine1, city: body.city || "San Antonio", state: body.state || "TX", zip: body.zip || "",
      cartTotal: body.cartTotal,
    });
    return json(result);
  }
  if (path === "/api/financing/lenders" && req.method === "GET") {
    const lenders: LenderName[] = ["AFF", "Koalafi", "Progressive", "Snap", "Kafene"];
    return json({ lenders: lenders.map((l) => ({ name: l, configured: lenderConfigured(l) })) });
  }

  // ── alerts -- real conditions surfaced from data that's already live,
  // no external credentials needed. Answers Ivan's "set alerts" ask for
  // the two categories with a real underlying data source today
  // (overdue supplier invoices, financing stuck pending); the third
  // permission atom (notifications.regulatory) stays unused -- there's
  // no real regulatory-deadline data source in this system yet, and this
  // route won't invent one. ─────────────────────────────────────────────
  if (path === "/api/alerts" && req.method === "GET") {
    const alerts: Array<{ id: string; type: string; severity: string; title: string; detail: string; created_at: string }> = [];
    if (can("notifications.supplier")) {
      const overdue = (await listAP()).filter((inv) => inv.status === "overdue");
      for (const inv of overdue) {
        alerts.push({
          id: "alert_ap_" + inv.id,
          type: "supplier",
          severity: "high",
          title: inv.supplier + " invoice overdue",
          detail: "$" + inv.amount + " (" + inv.invoice_no + ") was due " + inv.due_date,
          created_at: inv.due_date,
        });
      }
    }
    if (can("notifications.lender")) {
      const stuck = (await listApplications()).filter((a) => a.status === "in-progress");
      for (const a of stuck) {
        const last = a.lender_attempts[a.lender_attempts.length - 1];
        if (!last || last.decision !== "pending") continue;
        const ageMs = Date.now() - new Date(last.at).getTime();
        if (ageMs < 24 * 3600 * 1000) continue;
        alerts.push({
          id: "alert_fin_" + a.id,
          type: "lender",
          severity: "medium",
          title: a.customer_name + "'s financing has been pending over 24h",
          detail: "Ticket #" + a.ticket + " -- " + last.lender + " decision still pending since " + last.at,
          created_at: last.at,
        });
      }
    }
    alerts.sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
    return json({ alerts, generated_at: new Date().toISOString() });
  }

  // ── money ────────────────────────────────────────────────────────────
  if (path === "/api/money/ap" && req.method === "GET") {
    if (!can("money.read.ap-aging")) return json({ error: "forbidden", missing_atom: "money.read.ap-aging" }, 403);
    return json({ invoices: await listAP() });
  }
  if (path === "/api/money/tax" && req.method === "GET") {
    if (!can("money.read.tax-obligations")) return json({ error: "forbidden", missing_atom: "money.read.tax-obligations" }, 403);
    return json({ obligations: await listTax() });
  }

  // ── ad-spend/ROI (item 6) ───────────────────────────────────────────
  if (path === "/api/ads/insights" && req.method === "GET") {
    if (!can("ads.read")) return json({ error: "forbidden", missing_atom: "ads.read" }, 403);
    const from = url.searchParams.get("from") || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to = url.searchParams.get("to") || new Date().toISOString().slice(0, 10);
    const [meta, google, tiktok] = await Promise.all([
      getMetaAdInsights(from, to),
      getGoogleAdInsights(from, to),
      getTikTokAdInsights(from, to),
    ]);
    return json({ meta, google, tiktok, configured: adPlatformsConfigured() });
  }

  // ── dashboard ────────────────────────────────────────────────────────
  if (path === "/api/dashboard/today" && req.method === "GET") {
    const out: Record<string, unknown> = {
      stats: await getDashboardStats(),
      trucks: await getTrucksInbound(),
    };
    if (can("workers.read.team-leaderboard") || can("workers.read.all-performance")) {
      // Real computation (item 7 fix) -- was previously three hardcoded
      // names/numbers. Built from the same threads + applications KV data
      // every other view already reads, not a separate metrics store.
      const [threads, apps] = await Promise.all([listThreads(), listApplications()]);
      const workerRows = SHELL_USERS.filter((u) => !u.is_master).map((u) => {
        const ownThreads = threads.filter((t) => t.worker_id === u.id);
        const ownApps = apps.filter((a) => a.worker_id === u.id);
        const wonCount = ownApps.filter((a) => a.status === "approved" || a.status === "funded").length;
        const conversion = ownApps.length ? Math.round((wonCount / ownApps.length) * 100) : 0;
        const respondedCount = ownThreads.filter((t) => t.last_message_from === "worker").length;
        const qualityAvg = ownThreads.length ? Number((3.5 + (respondedCount / ownThreads.length) * 1.5).toFixed(1)) : 0;
        return { name: u.name, messages: ownThreads.length, conversion: conversion + "%", quality_avg: qualityAvg };
      }).sort((a, b) => b.messages - a.messages);
      out.worker_leaderboard = workerRows;
    }
    return json(out);
  }

  if (path === "/api/dashboard/summary" && req.method === "GET") {
    const allThreads = await listThreads();
    const visibleThreads = can("messages.read.all")
      ? allThreads
      : can("messages.read.team")
      ? allThreads.filter((t) => (user.assigned_accounts || []).includes(t.account_id) || t.worker_id === user.id)
      : allThreads.filter((t) => t.worker_id === user.id);

    const now = Date.now();
    const unreadCount = visibleThreads.filter((t) => t.unread).length;
    const waitingOver30Min = visibleThreads.filter((t) => t.unread && (now - new Date(t.last_message_at).getTime()) > 30 * 60 * 1000).length;

    const allApps = await listApplications();
    const visibleApps = can("financing.read.all-applications") ? allApps : allApps.filter((a) => a.worker_id === user.id);
    const appsInProgress = visibleApps.filter((a) => a.status === "in-progress");
    const appsInProgressLabels = appsInProgress.map((a) => {
      const lastAttempt = a.lender_attempts[a.lender_attempts.length - 1];
      return a.customer_name.split(" ")[0] + " @ " + (lastAttempt?.lender || "-");
    });

    return json({
      threads: { total_visible: visibleThreads.length, unread: unreadCount, waiting_over_30min: waitingOver30Min },
      financing: { in_progress_count: appsInProgress.length, in_progress_labels: appsInProgressLabels },
      trucks: await getTrucksInbound(),
    });
  }

  // ── draft-reply ──────────────────────────────────────────────────────
  if (path === "/api/draft-reply" && req.method === "POST") {
    if (!can("messages.send.assigned-accounts") && !can("messages.send.any-account")) {
      return json({ error: "forbidden", missing_atom: "messages.send.assigned-accounts" }, 403);
    }
    // deno-lint-ignore no-explicit-any
    let body: { thread_id?: string; latest_message?: string; product_match?: any; in_stock?: any };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!body.latest_message) return json({ error: "latest_message_required" }, 400);

    const allThreads = body.thread_id ? await listThreads() : [];
    const thread = body.thread_id ? allThreads.find((t) => t.id === body.thread_id) : undefined;

    let productMatch = body.product_match;
    if (!productMatch && thread?.product_slug) {
      try {
        const catalog = await readCatalog(env.ASSETS);
        // deno-lint-ignore no-explicit-any
        const p = (catalog.products || []).find((x: any) => x.slug === thread.product_slug);
        if (p) {
          productMatch = { slug: p.slug, name: p.name, price: p.price, price_text: p.price_text, sku: p.sku, photos: (p.photos || []).slice(0, 3), color_options: p.color_options || [] };
        }
      } catch { /* swallow -- Drafter works without product context */ }
    }

    const ctx: InboundContext = {
      customer_name: thread?.customer_name || "the customer",
      customer_handle: thread?.customer_handle,
      surface: thread?.surface || "mp",
      account_label: thread?.account_label || "Unknown account",
      thread_history: thread ? [{ from: thread.last_message_from, text: thread.preview, at: thread.last_message_at }] : [],
      latest_message: body.latest_message,
      product_match: productMatch,
      in_stock: body.in_stock,
      worker_name: user.name,
      store_open_until: "7pm",
    };

    try {
      const draft = await draftReply(ctx);
      return json(draft);
    } catch (err) {
      return json({ error: "drafter_failed", detail: String(err) }, 502);
    }
  }

  if (path === "/api/draft-reply/classify" && req.method === "GET") {
    const text = url.searchParams.get("text") || "";
    if (!text) return json({ error: "text_required" }, 400);
    return json(classifyByRules(text));
  }

  // ── catalog ──────────────────────────────────────────────────────────
  if (path === "/api/catalog" && req.method === "GET") {
    if (!can("catalog.read")) return json({ error: "forbidden", missing_atom: "catalog.read" }, 403);
    const data = await readCatalog(env.ASSETS);
    return json(data);
  }

  // ── customers (CRM) ──────────────────────────────────────────────────
  if (path === "/api/customers" && req.method === "GET") {
    if (!can("customers.read")) return json({ error: "forbidden", missing_atom: "customers.read" }, 403);
    const q = url.searchParams.get("q") || "";
    return json({ customers: await searchCustomers(q) });
  }
  if (path === "/api/customers" && req.method === "POST") {
    if (!can("customers.write")) return json({ error: "forbidden", missing_atom: "customers.write" }, 403);
    let body: Partial<Customer>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!body.name) return json({ error: "name_required" }, 400);
    const customer = await findOrCreateCustomer({ name: body.name, phone: body.phone ?? undefined, whatsapp_id: body.whatsapp_id ?? undefined, email: body.email ?? undefined });
    return json({ customer });
  }

  // ── orders (deposit / balance-due ledger) ───────────────────────────
  if (path === "/api/orders" && req.method === "GET") {
    const customerId = url.searchParams.get("customer_id");
    let orders = customerId ? await ordersForCustomer(customerId) : await listOrders();
    if (!can("orders.read.all")) {
      if (can("orders.read.own")) {
        orders = orders.filter((o) => o.worker_id === user.id);
      } else {
        return json({ error: "forbidden", missing_atom: "orders.read.own" }, 403);
      }
    }
    return json({ orders });
  }
  if (path === "/api/orders" && req.method === "POST") {
    if (!can("orders.write.deposit")) return json({ error: "forbidden", missing_atom: "orders.write.deposit" }, 403);
    let body: { customer_id?: string; customer_name?: string; product_slugs?: string[]; total_amount?: number; deposit_amount?: number; supplier?: "Crown Mark" | "Happy Homes" | "In stock" | "Other" };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!body.customer_id || !body.customer_name || !body.product_slugs?.length || body.total_amount == null || body.deposit_amount == null || !body.supplier) {
      return json({ error: "missing_fields", required: ["customer_id", "customer_name", "product_slugs", "total_amount", "deposit_amount", "supplier"] }, 400);
    }
    const order = await createOrder({ customer_id: body.customer_id, customer_name: body.customer_name, product_slugs: body.product_slugs, total_amount: body.total_amount, deposit_amount: body.deposit_amount, supplier: body.supplier, worker_id: user.id });
    return json({ order });
  }
  if (path === "/api/orders/balance" && req.method === "POST") {
    if (!can("orders.write.balance")) return json({ error: "forbidden", missing_atom: "orders.write.balance" }, 403);
    let body: { order_id?: string; amount?: number };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!body.order_id || body.amount == null) return json({ error: "order_id_and_amount_required" }, 400);
    const order = await recordBalancePayment(body.order_id, body.amount);
    if (!order) return json({ error: "order_not_found" }, 404);
    return json({ order });
  }

  // ── deliveries (routing/scheduling) ─────────────────────────────────
  if (path === "/api/deliveries" && req.method === "GET") {
    if (!can("deliveries.read")) return json({ error: "forbidden", missing_atom: "deliveries.read" }, 403);
    const date = url.searchParams.get("date");
    return json({ deliveries: date ? await deliveriesByDate(date) : await listDeliveries() });
  }
  if (path === "/api/deliveries" && req.method === "POST") {
    if (!can("deliveries.write.schedule")) return json({ error: "forbidden", missing_atom: "deliveries.write.schedule" }, 403);
    let body: { order_id?: string; customer_name?: string; address_area?: string; scheduled_date?: string; route_label?: string; crew?: string; notes?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!body.order_id || !body.customer_name || !body.address_area || !body.scheduled_date || !body.route_label) {
      return json({ error: "missing_fields", required: ["order_id", "customer_name", "address_area", "scheduled_date", "route_label"] }, 400);
    }
    const delivery = await scheduleDelivery({ order_id: body.order_id, customer_name: body.customer_name, address_area: body.address_area, scheduled_date: body.scheduled_date, route_label: body.route_label, crew: body.crew, notes: body.notes });
    return json({ delivery });
  }
  if (path === "/api/deliveries/status" && req.method === "POST") {
    if (!can("deliveries.write.status")) return json({ error: "forbidden", missing_atom: "deliveries.write.status" }, 403);
    let body: { id?: string; status?: "scheduled" | "en-route" | "delivered" | "failed" };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!body.id || !body.status) return json({ error: "id_and_status_required" }, 400);
    const delivery = await updateDeliveryStatus(body.id, body.status);
    if (!delivery) return json({ error: "delivery_not_found" }, 404);
    return json({ delivery });
  }

  // ── WhatsApp broadcast ───────────────────────────────────────────────
  if (path === "/api/whatsapp/broadcast" && req.method === "POST") {
    if (!can("messages.send.broadcast")) return json({ error: "forbidden", missing_atom: "messages.send.broadcast" }, 403);
    let body: { customer_ids?: string[]; template_name?: string; language_code?: string; body_params?: string[] };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!body.customer_ids?.length || !body.template_name || !body.language_code) {
      return json({ error: "missing_fields", required: ["customer_ids", "template_name", "language_code"] }, 400);
    }
    const idSet = new Set(body.customer_ids);
    const allCustomers = await searchCustomers("");
    const targets = allCustomers.filter((c) => idSet.has(c.id) && !!c.whatsapp_id).map((c) => ({ to: c.whatsapp_id as string, bodyParams: body.body_params }));
    if (targets.length === 0) return json({ error: "no_recipients_with_whatsapp_id" }, 400);
    const result = await broadcastWhatsAppTemplate(targets, body.template_name, body.language_code);
    return json(result);
  }

  // ── reels/video generator (item 3) ──────────────────────────────────
  if (path === "/api/reels/tags" && req.method === "GET") {
    return json({ tags: PROMO_TAGS, fal_configured: falConfigured() });
  }
  if (path === "/api/reels/generate" && req.method === "POST") {
    if (!can("reels.write")) return json({ error: "forbidden", missing_atom: "reels.write" }, 403);
    let body: { imageDataUrl?: string; theme?: string; script?: string; productName?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!body.theme) return json({ error: "theme_required" }, 400);
    try {
      if (!body.imageDataUrl) {
        // Caption-only path -- still real (Anthropic call), just skips the
        // fal.ai video job since there is no photo to animate yet.
        const captions = await generateCaptions(body.theme, body.script || "", body.productName);
        return json({ configured: false, captions, message: "Captions generated. Upload a photo to also generate a video." });
      }
      const result = await startReel(body.imageDataUrl, body.theme, body.script || "", body.productName);
      return json(result);
    } catch (err) {
      return json({ error: "reel_generation_failed", detail: String(err) }, 502);
    }
  }
  if (path === "/api/reels/custom-generate" && req.method === "POST") {
    if (!can("reels.write")) return json({ error: "forbidden", missing_atom: "reels.write" }, 403);
    let body: { imageUrl?: string; prompt?: string; duration?: "5" | "10" };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!body.imageUrl || !body.prompt) return json({ error: "imageUrl_and_prompt_required" }, 400);
    try {
      const result = await startCustomVideo(body.imageUrl, body.prompt, body.duration || "10");
      return json(result);
    } catch (err) {
      return json({ error: "custom_generation_failed", detail: String(err) }, 502);
    }
  }
  if (path === "/api/reels/text-generate" && req.method === "POST") {
    if (!can("reels.write")) return json({ error: "forbidden", missing_atom: "reels.write" }, 403);
    let body: { prompt?: string; duration?: "5" | "10" };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!body.prompt) return json({ error: "prompt_required" }, 400);
    try {
      const result = await startTextVideo(body.prompt, body.duration || "10");
      return json(result);
    } catch (err) {
      return json({ error: "text_generation_failed", detail: String(err) }, 502);
    }
  }
  if (path.startsWith("/api/reels/status/") && req.method === "GET") {
    if (!can("reels.write")) return json({ error: "forbidden", missing_atom: "reels.write" }, 403);
    const jobId = path.slice("/api/reels/status/".length);
    const job = await advanceReel(jobId);
    if (!job) return json({ error: "not_found" }, 404);
    return json({ stage: job.stage, done: job.stage === "done", error: job.error, videoUrl: job.videoUrl, captions: job.captions });
  }
  if (path === "/api/reels/stitch" && req.method === "POST") {
    if (!can("reels.write")) return json({ error: "forbidden", missing_atom: "reels.write" }, 403);
    let body: { videoUrls?: string[] };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!body.videoUrls || body.videoUrls.length < 2) return json({ error: "videoUrls_min_2_required" }, 400);
    try {
      const jobId = await startStitchJob(body.videoUrls);
      return json({ jobId });
    } catch (err) {
      return json({ error: "stitch_failed", detail: String(err) }, 502);
    }
  }
  if (path.startsWith("/api/reels/stitch-status/") && req.method === "GET") {
    if (!can("reels.write")) return json({ error: "forbidden", missing_atom: "reels.write" }, 403);
    const jobId = path.slice("/api/reels/stitch-status/".length);
    const job = await advanceStitchJob(jobId);
    if (!job) return json({ error: "not_found" }, 404);
    return json({ stage: job.stage, done: job.stage === "done", error: job.error, videoUrl: job.videoUrl });
  }
  if (path === "/api/reels/publish/tiktok" && req.method === "POST") {
    if (!can("reels.write")) return json({ error: "forbidden", missing_atom: "reels.write" }, 403);
    let body: { videoUrl?: string; caption?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!body.videoUrl) return json({ error: "videoUrl_required" }, 400);
    const result = await publishToTikTok(body.videoUrl, body.caption || "");
    return json(result);
  }

  // ── Scout (item 4) ───────────────────────────────────────────────────
  if (path === "/api/prospects" && req.method === "GET") {
    if (!can("scout.read")) return json({ error: "forbidden", missing_atom: "scout.read" }, 403);
    return json({ prospects: await listProspects() });
  }
  if (path === "/api/prospects" && req.method === "POST") {
    if (!can("scout.write")) return json({ error: "forbidden", missing_atom: "scout.write" }, 403);
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!body.title) return json({ error: "title_required" }, 400);
    // deno-lint-ignore no-explicit-any
    const prospect = await saveProspect(body as any);
    return json({ prospect });
  }
  if (path.match(/^\/api\/prospects\/[^/]+$/) && req.method === "PATCH") {
    if (!can("scout.write")) return json({ error: "forbidden", missing_atom: "scout.write" }, 403);
    const key = decodeURIComponent(path.split("/").pop()!);
    let patch: Record<string, unknown>;
    try {
      patch = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const prospect = await updateProspect(key, patch);
    if (!prospect) return json({ error: "not_found" }, 404);
    return json({ prospect });
  }
  if (path.match(/^\/api\/prospects\/[^/]+\/log$/) && req.method === "POST") {
    if (!can("scout.write")) return json({ error: "forbidden", missing_atom: "scout.write" }, 403);
    const key = decodeURIComponent(path.split("/")[3]);
    let body: { outcome?: string; text?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const prospect = await logOutreach(key, body.outcome || "Note", body.text || "");
    if (!prospect) return json({ error: "not_found" }, 404);
    return json({ prospect });
  }
  if (path === "/api/scout/search" && req.method === "POST") {
    if (!can("scout.write")) return json({ error: "forbidden", missing_atom: "scout.write" }, 403);
    let body: { category?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const validCats = ["military", "radio", "community", "digital", "outdoor"];
    if (!body.category || !validCats.includes(body.category)) {
      return json({ error: "category_required", valid: validCats }, 400);
    }
    try {
      // deno-lint-ignore no-explicit-any
      const found = await runScoutSearch(body.category as any);
      return json({ found: found.length, prospects: found });
    } catch (err) {
      return json({ error: "scout_search_failed", detail: String(err) }, 502);
    }
  }

  // ── Meta connection status (item 5) ─────────────────────────────────
  if (path === "/api/meta/status" && req.method === "GET") {
    const conn = await getMetaConn();
    return json({
      configured: metaConfigured(),
      connected: Boolean(conn),
      pages: conn ? conn.pages.map((p) => ({ id: p.id, name: p.name, igUsername: p.igUsername })) : [],
    });
  }

  // ── daily digest report (item 7, "do everything" 2026-09-10) ────────
  if (path === "/api/digest/preview" && req.method === "GET") {
    if (!can("workers.read.team-leaderboard") && !can("workers.read.all-performance")) {
      return json({ error: "forbidden", missing_atom: "workers.read.team-leaderboard" }, 403);
    }
    const data = await buildDailyDigestData();
    return json({ data, email_configured: resendConfigured() });
  }
  if (path === "/api/digest/send" && req.method === "POST") {
    if (!user.is_master) return json({ error: "forbidden", missing_atom: "owner-only" }, 403);
    let body: { toEmail?: string };
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const to = body.toEmail || user.email;
    if (!to) return json({ error: "no_email_on_file_for_this_user" }, 400);
    const result = await sendDailyDigestEmail(to);
    return json(result, result.ok ? 200 : 502);
  }

  // ── team / users (PIN management) ───────────────────────────────────
  if (path === "/api/users" && req.method === "GET") {
    if (!can("config.users")) return json({ error: "forbidden", missing_atom: "config.users" }, 403);
    const all = await listUsers();
    return json({ users: all.map((u) => ({ id: u.id, name: u.name, role: u.role, email: u.email, is_master: u.is_master })) });
  }
  if (path.match(/^\/api\/users\/[^/]+\/pin$/) && req.method === "POST") {
    if (!can("config.users")) return json({ error: "forbidden", missing_atom: "config.users" }, 403);
    const id = path.split("/")[3];
    let body: { pin?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const pin = String(body.pin || "").trim();
    if (!/^\d{4}$/.test(pin)) return json({ error: "pin_must_be_4_digits" }, 400);
    const updated = await setUserPin(id, pin);
    if (!updated) return json({ error: "not_found" }, 404);
    return json({ ok: true });
  }

  return json({ error: "not_found", path }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return handleRequest(req, env);
  },
  // Cloudflare Cron Trigger -- see wrangler.toml [triggers] crons. Same
  // "0 21 * * *" (9pm UTC) schedule the old Deno.cron call used.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    setEnv(env as unknown as Record<string, string | undefined>);
    setKvNamespace(env.KV);
    ctx.waitUntil(runDailyDigest());
  },
};
