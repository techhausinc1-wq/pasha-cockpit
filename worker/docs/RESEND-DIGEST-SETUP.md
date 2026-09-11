# Daily digest email setup — Resend

Written 2026-09-10. Purpose: turn on the real end-of-day report email
("which team member is working best today," financing tally, sales
today) that's already built and running on a nightly cron
(`Deno.cron("pasha-daily-digest", "0 21 * * *", ...)` in `worker/src/main.ts`).

**The code side is done** — `worker/src/lib/digest.ts` builds the report
from real live data (threads, financing applications, orders — the exact
same numbers the in-app dashboard shows) and sends it via Resend. It
already no-ops safely with a clear log line if the credentials below
aren't set, so this doc is the only thing standing between "the report
exists" and "the report actually lands in an inbox every night."

## Steps

1. Create a Resend account at **https://resend.com** (or reuse the one
   already used elsewhere in the TechHaus/Heisenbug portfolio for Hire
   Signal, if there is one — same email-sending need, may already exist).
2. Add and verify a sending domain in Resend (DNS records — SPF/DKIM —
   added at wherever `210discountfurniture.com`'s DNS is managed). A
   dedicated subdomain like `send.210discountfurniture.com` is the safer
   choice — it never touches the root domain's existing mail records
   (same pattern already used for `send.techhaus.haus`).
3. Create an API key in Resend's dashboard.
4. Set on this Deno Deploy app (`pasha-cockpit-api`):
   - `RESEND_API_KEY` — the API key from step 3.
   - `DIGEST_EMAIL_FROM` — e.g. `"210 Discount Furniture <reports@send.210discountfurniture.com>"`.

Once both are set (no redeploy needed for env-var-only changes on Deno
Deploy, but redeploy anyway to be safe), the nightly cron will actually
send. To test immediately without waiting for 9pm, log in as an owner
(Paul or Ivan) and call:

```
POST /api/digest/send
{"toEmail": "besthomefurnituresa@gmail.com"}   // optional -- defaults to your own account email
```

`GET /api/digest/preview` (any user with leaderboard read access) returns
the same report data as JSON without sending anything — useful for
checking the numbers look right before wiring the email.

## What this does NOT cover

This only reports on data already inside the cockpit (WhatsApp threads,
financing applications entered here, orders entered here). Ivan separately
flagged that real financing-lender confirmation emails (Snap, AFF,
Koalafi, etc.) land in Pasha's own inbox, outside this app — a true count
of those needs real email-inbox reading (Gmail API), which is a distinct,
larger piece of work, not covered by this Resend setup. See
`docs/GMAIL-READ-SETUP.md` for that.
