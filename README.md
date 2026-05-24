# Pasha cockpit (shell)

The operator cockpit for 210 Discount Furniture / Furniture & Mattress Warehouse,
San Antonio. Built per the architecture in
`~/code/pasha-discovery/docs/SPEC-v1.md`.

## What this is (right now — overnight shell)

A working scaffold demonstrating the cockpit UX and the RBAC pattern, with sample
data hardcoded. The full integrations (FB Marketplace + Page DMs, FormPiper
financing waterfall, Crown Mark / Happy Homes supplier AP, TX compliance watcher)
land after Paul's discovery session and the 30-min phone call answering the open
questions in spec §11.

What works today:
- **Auth** — switch between "Owner" (full access) and "Showroom Associate"
  (limited views) to see how the RBAC pattern hides features per role.
- **Cockpit homepage** — the 4-section live overview (Right Now / Today / Money /
  Watch) with sample data.
- **Catalog browser** — wired to the real 602-SKU `data/catalog.json` scraped
  from 210discountfurniture.com.
- **Messaging hub mock** — 5 sample threads (mix of intents) showing the
  Drafter pattern: AI-classified intent, suggested reply, hard CTA to visit.
- **Financing waterfall mock** — a fake in-progress application stepping through
  the AFF -> Koalafi -> Progressive -> Snap -> Kafene cascade.

What's mock vs. real:
- Catalog data: REAL (from the scrape)
- All threads, applications, AP rows, tax rows: MOCK
- Auth: working but hardcoded user list

## Local run

```bash
cd worker
deno task dev
# → cockpit at http://localhost:8000/
```

(Worker also serves `../web/index.html` at root.)

## Stack

Same pattern as Cabinet: Deno worker + vanilla-JS single-file HTML +
Postgres + pgvector (when real data lands). Single-tenant for now;
workspace_id-aware throughout so the lift to multi-tenant Heisenbug is mechanical.

## Phase plan

Per `~/code/pasha-discovery/docs/SPEC-v1.md`. This shell IS Phase 0 of that plan
(scaffold). Phase 1 starts after Paul's discovery + the 30-min call: real auth,
real message ingestion via the local-browser scrape pattern, FormPiper integration,
real catalog + inventory.
