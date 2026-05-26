// Pasha cockpit worker — shell. Sample data; real DB wiring is Phase 1.
//
// Auth: trivial bearer-token via X-Access-Code (per-user codes). Each access
// code maps to a user; the user's role + permission atoms determine what the
// API returns. Workers see only their assigned accounts; masters see all.

import { effectiveAtoms, findUser, SHELL_USERS, type User } from "./lib/rbac.ts";
import { SAMPLE_AP, SAMPLE_APPLICATIONS, SAMPLE_TAX, SAMPLE_THREADS, TODAY_STATS, TRUCKS_INBOUND } from "./lib/sample-data.ts";
import { classifyByRules, draftReply, type InboundContext } from "./lib/drafter.ts";

const PORT = parseInt(Deno.env.get("PORT") || "8001");
const WEB_DIR = new URL("../../web/", import.meta.url).pathname;
const DATA_DIR = new URL("../../data/", import.meta.url).pathname;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Access-Code",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Per-user access codes. Shell-only — in Phase 1 use proper auth + bcrypt.
// Format "pasha-shell-<userid>" so it's obvious in dev.
function userFromCode(code: string): User | null {
  if (!code) return null;
  const match = code.match(/^pasha-shell-(.+)$/);
  if (!match) return null;
  return findUser("u_" + match[1]) || null;
}

function whoami(req: Request): User | null {
  return userFromCode(req.headers.get("X-Access-Code") || "");
}

async function serveStatic(pathname: string): Promise<Response> {
  // Map URL paths to filesystem files.
  // /                → web/index.html
  // /catalog.json    → data/catalog.json
  // /style.css etc.  → web/<path>
  let fsPath: string;
  if (pathname === "/" || pathname === "") {
    fsPath = `${WEB_DIR}index.html`;
  } else if (pathname === "/catalog.json") {
    fsPath = `${DATA_DIR}catalog.json`;
  } else {
    fsPath = `${WEB_DIR}${pathname.replace(/^\//, "")}`;
  }
  try {
    const body = await Deno.readFile(fsPath);
    const ext = fsPath.split(".").pop()!.toLowerCase();
    const mime = ext === "html" ? "text/html; charset=utf-8" :
                 ext === "css" ? "text/css; charset=utf-8" :
                 ext === "js" ? "application/javascript; charset=utf-8" :
                 ext === "json" ? "application/json; charset=utf-8" :
                 "application/octet-stream";
    return new Response(body, { status: 200, headers: { "Content-Type": mime, "Cache-Control": "no-cache" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

console.log(`Pasha cockpit shell listening on http://localhost:${PORT}`);
console.log(`web served from ${WEB_DIR}`);
console.log(`catalog served from ${DATA_DIR}catalog.json`);
console.log(`Sample access codes: ${SHELL_USERS.map((u) => "pasha-shell-" + u.id.replace(/^u_/, "")).join(", ")}`);

Deno.serve({ port: PORT }, async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  const url = new URL(req.url);
  const path = url.pathname;

  // ----- static (no auth) -----
  if (!path.startsWith("/api/")) {
    return serveStatic(path);
  }

  // ----- API -----

  // who am I (used by the frontend to know the current user + permissions)
  if (path === "/api/whoami") {
    const user = whoami(req);
    if (!user) return json({ user: null, atoms: [] }, 401);
    return json({
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        email: user.email,
        is_master: user.is_master,
        assigned_accounts: user.assigned_accounts,
      },
      atoms: [...effectiveAtoms(user)],
    });
  }

  // shell-only: list available users so the role-switcher UI can show options
  if (path === "/api/_shell/users") {
    return json({
      users: SHELL_USERS.map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        is_master: u.is_master,
        access_code: "pasha-shell-" + u.id.replace(/^u_/, ""),
      })),
    });
  }

  // Auth required for everything below
  const user = whoami(req);
  if (!user) return json({ error: "unauthorized" }, 401);
  const atoms = effectiveAtoms(user);

  // ----- messaging -----
  if (path === "/api/threads" && req.method === "GET") {
    // Filter by permission: own/team/all
    let threads = SAMPLE_THREADS;
    if (!atoms.has("messages.read.all")) {
      if (atoms.has("messages.read.team")) {
        // Workers see threads on accounts they're assigned to OR threads assigned to teammates
        threads = threads.filter((t) =>
          (user.assigned_accounts || []).includes(t.account_id) || t.worker_id === user.id
        );
      } else if (atoms.has("messages.read.own")) {
        threads = threads.filter((t) => t.worker_id === user.id);
      } else {
        return json({ error: "forbidden", missing_atom: "messages.read.own" }, 403);
      }
    }
    return json({ threads });
  }

  if (path === "/api/financing/applications" && req.method === "GET") {
    let apps = SAMPLE_APPLICATIONS;
    if (!atoms.has("financing.read.all-applications")) {
      if (atoms.has("financing.read.applications")) {
        apps = apps.filter((a) => a.worker_id === user.id);
      } else {
        return json({ error: "forbidden", missing_atom: "financing.read.applications" }, 403);
      }
    }
    return json({ applications: apps });
  }

  if (path === "/api/money/ap" && req.method === "GET") {
    if (!atoms.has("money.read.ap-aging")) {
      return json({ error: "forbidden", missing_atom: "money.read.ap-aging" }, 403);
    }
    return json({ invoices: SAMPLE_AP });
  }

  if (path === "/api/money/tax" && req.method === "GET") {
    if (!atoms.has("money.read.tax-obligations")) {
      return json({ error: "forbidden", missing_atom: "money.read.tax-obligations" }, 403);
    }
    return json({ obligations: SAMPLE_TAX });
  }

  if (path === "/api/dashboard/today" && req.method === "GET") {
    // All authed users get this — but with field filtering by atom
    const out: Record<string, unknown> = { stats: TODAY_STATS(), trucks: TRUCKS_INBOUND };
    if (atoms.has("workers.read.team-leaderboard") || atoms.has("workers.read.all-performance")) {
      out.worker_leaderboard = [
        { name: "Paul", messages: 11, conversion: "22%", quality_avg: 4.6 },
        { name: "Carlos", messages: 5, conversion: "30%", quality_avg: 4.4 },
        { name: "Rick", messages: 2, conversion: "0%", quality_avg: 3.8 },
      ];
    }
    return json(out);
  }

  // Derived "right now" aggregates — counts pulled from live sample state
  if (path === "/api/dashboard/summary" && req.method === "GET") {
    const visibleThreads = atoms.has("messages.read.all")
      ? SAMPLE_THREADS
      : atoms.has("messages.read.team")
      ? SAMPLE_THREADS.filter((t) => (user.assigned_accounts || []).includes(t.account_id) || t.worker_id === user.id)
      : SAMPLE_THREADS.filter((t) => t.worker_id === user.id);

    const now = Date.now();
    const unreadCount = visibleThreads.filter((t) => t.unread).length;
    const waitingOver30Min = visibleThreads.filter((t) =>
      t.unread && (now - new Date(t.last_message_at).getTime()) > 30 * 60 * 1000
    ).length;

    const visibleApps = atoms.has("financing.read.all-applications")
      ? SAMPLE_APPLICATIONS
      : SAMPLE_APPLICATIONS.filter((a) => a.worker_id === user.id);

    const appsInProgress = visibleApps.filter((a) => a.status === "in-progress");
    const appsInProgressLabels = appsInProgress.map((a) => {
      const lastAttempt = a.lender_attempts[a.lender_attempts.length - 1];
      return `${a.customer_name.split(" ")[0]} @ ${lastAttempt?.lender || "—"}`;
    });

    return json({
      threads: {
        total_visible: visibleThreads.length,
        unread: unreadCount,
        waiting_over_30min: waitingOver30Min,
      },
      financing: {
        in_progress_count: appsInProgress.length,
        in_progress_labels: appsInProgressLabels,
      },
      trucks: TRUCKS_INBOUND,
    });
  }

  // POST /api/draft-reply — Drafter agent: takes a thread + product context,
  // returns a draft reply for human review. Requires messages.send.* permission.
  if (path === "/api/draft-reply" && req.method === "POST") {
    if (!atoms.has("messages.send.assigned-accounts") && !atoms.has("messages.send.any-account")) {
      return json({ error: "forbidden", missing_atom: "messages.send.assigned-accounts" }, 403);
    }
    let body: { thread_id?: string; latest_message?: string; product_match?: any; in_stock?: any };
    try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
    if (!body.latest_message) return json({ error: "latest_message_required" }, 400);

    // If thread_id supplied, hydrate context from sample data.
    let thread = body.thread_id ? SAMPLE_THREADS.find((t) => t.id === body.thread_id) : undefined;

    // Look up product if we have a thread that matched one
    let productMatch = body.product_match;
    if (!productMatch && thread?.product_slug) {
      try {
        const catalogText = await Deno.readFile(new URL("../../data/catalog.json", import.meta.url));
        const catalog = JSON.parse(new TextDecoder().decode(catalogText));
        const p = (catalog.products || []).find((x: any) => x.slug === thread.product_slug);
        if (p) {
          productMatch = {
            slug: p.slug,
            name: p.name,
            price: p.price,
            price_text: p.price_text,
            sku: p.sku,
            photos: (p.photos || []).slice(0, 3),
            color_options: p.color_options || [],
          };
        }
      } catch { /* swallow — Drafter will work without product context */ }
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

  // GET /api/draft-reply/classify?text=... — fast rule-based intent classification only
  if (path === "/api/draft-reply/classify" && req.method === "GET") {
    const url = new URL(req.url);
    const text = url.searchParams.get("text") || "";
    if (!text) return json({ error: "text_required" }, 400);
    return json(classifyByRules(text));
  }

  if (path === "/api/catalog" && req.method === "GET") {
    if (!atoms.has("catalog.read")) {
      return json({ error: "forbidden", missing_atom: "catalog.read" }, 403);
    }
    const body = await Deno.readFile(`${DATA_DIR}catalog.json`);
    const text = new TextDecoder().decode(body);
    const data = JSON.parse(text);
    // Strip wholesale/floor pricing from response unless atom granted (no such fields in shell catalog yet, just a hook)
    if (!atoms.has("catalog.read.floor-prices")) {
      // future: strip floor_price field from each product
    }
    return json(data);
  }

  return json({ error: "not_found", path }, 404);
});
