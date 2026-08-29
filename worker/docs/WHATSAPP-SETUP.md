# WhatsApp Business API setup — for real WhatsApp messages in the cockpit

Written 2026-08-13. Purpose: connect a real WhatsApp Business phone number
to the cockpit so the Inbox tab shows real WhatsApp threads alongside FB
Marketplace / Page / Instagram, and workers can reply from it.

**The code side is done** — `worker/src/lib/whatsapp.ts` and the
`/api/whatsapp/webhook` (GET verification + POST event delivery) and
`/api/whatsapp/send` routes in `worker/src/main.ts` are live and ready for
real credentials. What's left is entirely Meta-console steps + a phone
number, same shape as the Messenger/IG setup in `META-BUSINESS-SETUP.md`.

**No App Review needed to send/receive** — unlike FB Messenger/IG DMs,
WhatsApp's `whatsapp_business_messaging` permission is available to any
app once the WhatsApp product is added and a phone number is registered.
The gate here is business/phone verification, not Meta's review queue —
faster path than Phase 3 of the Meta doc.

---

## Phase 1 — Add WhatsApp to the Meta App (~20 min)

1. Use the same Meta App from `META-BUSINESS-SETUP.md` (`210 Discount
   Furniture Cockpit`) if it already exists — one app can host both
   Messenger and WhatsApp products. Otherwise create one per that doc's
   Phase 1.
2. Left sidebar → **Add Product** → find **WhatsApp** → Set Up.
3. Meta auto-provisions a **test phone number** for development — good
   enough to prove the pipe works end-to-end before using the real store
   line.

## Phase 2 — Get credentials, test with the sandbox number (~15 min)

1. In the WhatsApp product page → **API Setup** tab. Note:
   - **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - **WhatsApp Business Account ID** (WABA ID) → not required by the
     current code, but useful to have on hand
   - **Temporary access token** (24h) — fine for testing, not for
     production; Phase 4 below replaces it with a permanent one.
2. Add your own phone as a test recipient (Meta requires this for the
   sandbox number) and send yourself a test message from the API Setup
   page's "Send message" button to confirm the number works at all.
3. Set env vars on whichever worker hosts this (same tenant-prefix pattern
   as the FB doc — either extend Igor HQ's shared worker or run this
   cockpit's own `worker/`):
   - `WHATSAPP_TOKEN` = the temporary token, for now
   - `WHATSAPP_PHONE_NUMBER_ID`
4. Restart the worker, then from a terminal:
   ```
   curl -X POST http://localhost:8001/api/whatsapp/send \
     -H "X-Access-Code: pasha-shell-<your-id>" \
     -H "Content-Type: application/json" \
     -d '{"to":"<your test number, no +>","text":"cockpit test"}'
   ```
   A `{"ok":true,"message_id":"..."}` response means outbound send works.

## Phase 3 — Wire the webhook (inbound messages) (~15 min)

1. The worker needs a public HTTPS URL for Meta to POST to — during local
   dev, tunnel it (e.g. `ngrok http 8001`); once deployed, use the real
   worker URL.
2. Pick a random string for `WHATSAPP_VERIFY_TOKEN` (anything — it's just
   a shared secret between you and Meta for the handshake) and set it as
   an env var.
3. WhatsApp product page → **Configuration** tab → **Webhook** → Edit:
   - Callback URL: `https://<your-worker>/api/whatsapp/webhook`
   - Verify token: same string as `WHATSAPP_VERIFY_TOKEN`
   - Click **Verify and Save** — Meta calls the GET endpoint immediately;
     it should go green. If it fails, check the worker logs and confirm
     the env var matches exactly.
4. Still on the Configuration tab → **Webhook fields** → subscribe to
   `messages` (this is the only field the current code parses; `statuses`
   /`message_template_status_update` etc. can be added later if needed).
5. Get the **App Secret** from **App Settings → Basic** (Show, same place
   as `META_APP_SECRET` in the FB doc) → set as `WHATSAPP_APP_SECRET`.
   This is what the worker uses to verify each inbound webhook call is
   really from Meta (`x-hub-signature-256` header) — without it, every
   inbound message gets rejected with `403 invalid_signature`.
6. Send a WhatsApp message *to* the test number from your own phone. It
   should show up as a new thread in the cockpit's Inbox tab within a
   couple seconds (`surface: "wa"`, account label "WhatsApp · 210 main").

## Phase 4 — Go live with the real store number (~1-3 days, mostly waiting)

The sandbox/test number works for proving the pipe, but customers need to
message the *real* 210 Discount Furniture number.

1. **Two paths, pick one:**
   - **Port the existing store landline/cell to WhatsApp Business** — the
     number keeps working for normal calls; WhatsApp just adds itself on
     top. Requires the number not already be registered to a personal
     WhatsApp account (if it is, that app has to be deleted/logged out
     first — coordinate this with Paul, it disrupts whatever's on it now).
   - **Get a new number dedicated to WhatsApp** — cleaner, no risk to an
     existing line, but customers have to learn a new number.
2. WhatsApp product page → **API Setup** → **Add phone number** → follow
   the verification flow (SMS or voice code to that number).
3. **Business verification** in Meta Business Manager (same step as the
   FB doc's Phase 1.6) is required before the "test number" restrictions
   lift — un-verified numbers can only message the 5 phone numbers you've
   manually added as testers. Once verified, any customer can message in.
4. Get a **permanent system-user access token** (Business Settings →
   System Users → generate token scoped to `whatsapp_business_messaging`
   + `whatsapp_business_management`) to replace the 24h temporary one from
   Phase 2 — the temporary token expiring is the #1 cause of "it worked
   yesterday, broken today."
5. Update `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_TOKEN` to point at the
   real number + permanent token. Done — same webhook, same code path.

## Message templates (only needed for *starting* a conversation)

WhatsApp only allows free-form replies within 24h of the customer's last
message. To message a customer *first* (e.g. "your Snap application was
approved, come by today") outside that window requires a pre-approved
**message template** (Meta reviews these, usually same-day). Not needed
for the reactive inbox flow this integration currently covers — worth a
follow-up once outbound-initiated flows (financing status pings, delivery
reminders) are in scope.

## What's mock vs. real, right now

- Webhook receiver, signature verification, send endpoint: **REAL**, code
  complete, works the moment credentials are set.
- The store's real WhatsApp number actually receiving customer traffic:
  **depends on Phase 4** (business verification + number registration),
  which is on Meta's/carrier's timeline, not a code task.
