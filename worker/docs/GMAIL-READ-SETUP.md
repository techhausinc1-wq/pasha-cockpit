# Financing-email tally setup — Gmail API (read-only)

Written 2026-09-10, directly from Ivan's own words: "financing applications
that are submitted are sent to our emails, so we need a running tally of
that every day also." The real financing workflow (Snap, AFF/American
First Finance, Koalafi, Progressive Leasing, Kafene) happens on each
lender's own portal, outside this cockpit — the only record of a
submission is the confirmation email that lands in Pasha's real inbox.
This is the one piece of the daily report that genuinely needs real email
access; everything else in `docs/RESEND-DIGEST-SETUP.md` only reads data
already inside the app.

**The code side is done** — `worker/src/lib/gmail.ts`
(`countTodaysFinancingEmails`) searches Gmail for messages from each
lender's domain in the last 24 hours and returns a real per-lender count.
It's wired into the daily digest already; it just needs credentials.

## Which inbox?

First confirm with Pasha/Ivan: which real email address actually receives
these lender confirmation emails? (`pasha@210discountfurniture.com`? A
personal Gmail? Something else?) Don't guess — the OAuth consent in step 3
below has to be granted by whoever owns that actual mailbox.

## Steps

1. In **https://console.cloud.google.com/**, create (or reuse an existing
   TechHaus/Heisenbug) project, enable the **Gmail API**.
2. Create an OAuth 2.0 Client ID (Desktop app type is simplest for a
   one-time consent flow) — gives you a Client ID + Client Secret.
3. Run the standard Google OAuth2 "installed app" consent flow once,
   signed in as the real mailbox from above, requesting the
   `https://www.googleapis.com/auth/gmail.readonly` scope. The easiest way
   to do this without writing a callback server: **Google OAuth 2.0
   Playground** (https://developers.google.com/oauthplayground) — plug in
   your own Client ID/Secret in its settings gear, authorize the
   `gmail.readonly` scope, exchange for a refresh token.
4. Set on this Deno Deploy app (`pasha-cockpit-api`):
   - `GMAIL_CLIENT_ID`
   - `GMAIL_CLIENT_SECRET`
   - `GMAIL_REFRESH_TOKEN`

Once set, `GET /api/digest/preview` and the nightly digest email will both
show a real per-lender count instead of "not connected yet."

## Before trusting the numbers

`LENDER_DOMAINS` in `worker/src/lib/gmail.ts` is a best-known-public-domain
guess for each lender (snapfinance.com, americanfirstfinance.com,
koalafi.com, progleasing.com, kafene.com). **Check a real confirmation
email from each lender in Pasha's actual inbox and confirm the sending
domain matches** before trusting the count — a lender sending from a
different or third-party domain (e.g. a marketing-automation subdomain)
will silently undercount until the list is corrected.
