# Meta Business API setup — for real Facebook/Instagram data in the cockpit

Written 2026-08-02. Purpose: connect the 5 Facebook Pages + 2-3 Instagram
Business accounts to the cockpit for real (not mock) inbox, posting, and
reel publishing.

**Good news:** the OAuth plumbing already exists and works — it was built
for Igor HQ (`~/code/igor-hq/worker/main.ts`, routes `/oauth/facebook/start`
and `/oauth/facebook/callback`). It already enumerates every Page + linked
Instagram Business account the logged-in user manages in one connect —
Pasha logging in once (as long as he's an admin on all 5 Pages) returns all
5 Pages and their IG accounts in a single OAuth round-trip. No new backend
code needed for posting — just real credentials and a real login.

**The honest split, so there's no surprise mid-setup:**

| Capability | Scopes needed | Meta App Review required? |
|---|---|---|
| Post to Facebook Pages | `pages_manage_posts`, `pages_show_list`, `pages_read_engagement`, `business_management` | No — works immediately after Business Verification |
| Post to Instagram | + `instagram_basic`, `instagram_content_publish` | No — same as above |
| **Read/reply to FB Messenger DMs** | + `pages_messaging` | **Yes** — Advanced Access, needs App Review with a screen-recorded demo |
| **Read/reply to Instagram DMs** | + `instagram_manage_messages` | **Yes** — same |

Posting (reels, promos) can go live fast. The unified inbox reading real
messages is gated behind Meta's review process — budget 1-3 weeks for that
part, it's Meta's timeline not ours. Everything else in the cockpit (ads
attribution, customer CRM, inventory) doesn't touch Meta's API at all and
isn't affected by this.

---

## Phase 1 — Meta App + Business Verification (do this first, ~30 min)

1. Go to **https://developers.facebook.com/apps/** and sign in as whichever
   account should own the app long-term (Pasha's own business account is
   cleaner than a personal one, but either works to start).
2. **Create App** → type **Business** → name it `210 Discount Furniture
   Cockpit` (or similar) → Create.
3. Left sidebar → **App Settings → Basic**. Note the **App ID** and
   **App Secret** (click Show) — these become `META_APP_ID` and
   `META_APP_SECRET` env vars.
4. **App Settings → Basic** → fill in:
   - App domains: `techhausinc1-wq.github.io` (or wherever the cockpit's
     backend worker ends up living)
   - Privacy Policy URL and Terms of Service URL — required by Meta even
     for a business tool. A one-paragraph page is enough; can reuse the
     same pattern as any other TechHaus tool's privacy page.
   - Category: pick the closest fit (e.g. "Business").
5. Left sidebar → **Add Product** → find **Facebook Login** → Set Up.
   - Settings → Valid OAuth Redirect URIs: add the cockpit worker's
     callback URL once it's deployed (pattern:
     `https://<worker>.techhausinc1.deno.net/oauth/facebook/callback`,
     matching Igor HQ's existing route).
6. Left sidebar → **App Settings → Basic** → scroll to **Business
   Verification** → start it. Meta will ask for a legal business name,
   address, and a document (business license, EIN letter, or similar) to
   confirm the business is real. This step blocks `pages_manage_posts` at
   any real scale even before touching Messaging scopes.

## Phase 2 — Posting scopes (no review needed once Business Verified)

1. Left sidebar → **App Review → Permissions and Features**.
2. Search for and request (Standard Access, not Advanced):
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
   `instagram_basic`, `instagram_content_publish`, `business_management`.
   These are grantable at Standard Access once Business Verification (Phase
   1 step 6) is complete — no screencast needed for these six.
3. **Add the app to Business Manager**: go to
   **https://business.facebook.com/**, under the business that owns the 5
   Pages, add this app under **Business Settings → Accounts → Apps**, and
   assign it access to all 5 Pages + their linked IG Business accounts.
4. Set env vars on whichever worker will host this (either extend Igor
   HQ's shared worker with a new `/pasha/*` tenant prefix, matching the
   existing pattern used for Kostya Studio and Modern Line Furniture, or
   give the cockpit its own worker):
   - `META_APP_ID`
   - `META_APP_SECRET`
5. Pasha (or whoever is admin on all 5 Pages) visits
   `/oauth/facebook/start?code=<access-code>` once. Approves the consent
   screen. The callback stores a long-lived Page access token for every
   Page + linked IG account automatically.

At this point: posting reels/promos from the Videos tab, and any
"Publish to Facebook/Instagram" button, can go live for real.

## Phase 3 — Messaging scopes (the unified inbox reading/replying)

This is the part that needs Meta's App Review team, not just configuration.

1. **App Review → Permissions and Features** → request `pages_messaging`
   and `instagram_manage_messages` at **Advanced Access**.
2. Meta requires, per permission:
   - A short screen-recorded video showing the actual use case (a message
     coming into the cockpit's Inbox tab, someone replying from it) — this
     means Phase 2 needs to be live first so there's something real to
     record.
   - A written explanation of why the app needs it (template: "210
     Discount Furniture receives customer inquiries across 5 Facebook
     Pages and 2-3 Instagram accounts and needs a single interface for
     staff to respond, replacing 5-7 simultaneously open browser tabs.")
3. Submit. Meta's review turnaround is typically 3-10 business days, can
   run longer. If rejected, they give a specific reason — usually asks for
   more detail in the video or use-case description, not a hard no.
4. Once approved, the existing Inbox tab's mock data gets swapped for a
   real webhook subscription (Meta pushes new messages to a webhook URL
   the worker exposes) instead of mock data — this is normal Graph API
   webhook wiring, well documented, no new unknowns once the scope is
   actually granted.

## What this unlocks, phase by phase

- **After Phase 2**: Reels/promo posting to all 5 FB + IG accounts works
  for real. Ad spend/ROAS data still needs the Marketing API separately
  (same App, additional `ads_read` permission — also Standard Access, no
  review needed, can be added alongside Phase 2).
- **After Phase 3**: The Inbox tab shows real messages instead of mock
  data, auto-reply and team assignment work on real customer messages.

## TikTok and Google Business (the other two channels in the Inbox filter)

Out of scope for this doc — separate developer programs
(business.tiktok.com and Google Business Profile API respectively), lower
priority since Meta covers the bulk of the 5+2-3 accounts. Revisit once
Phase 1-2 above is live and proven.
