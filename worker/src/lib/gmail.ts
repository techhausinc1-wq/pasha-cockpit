// Real financing-email tally -- Ivan's own words, 2026-09-10: "financing
// applications that are submitted are sent to our emails, so we need a
// running tally of that every day also." The real financing workflow
// (Snap/AFF/Koalafi/Progressive/Kafene) happens on the lenders' own
// portals, outside this cockpit -- the only record is confirmation emails
// landing in Pasha's inbox. This reads that inbox via the Gmail API.
//
// Uses a pre-issued OAuth refresh token (installed-app / offline-access
// flow) rather than a full interactive start/callback route pair, since
// this only needs read access to one mailbox, obtained once -- simpler to
// set up than a full multi-user OAuth dance. See docs/GMAIL-READ-SETUP.md.
//
// Gated on GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN: returns
// a clear {configured:false} result instead of failing, same fallback
// pattern as every other credential-gated integration in this app.

import { getEnv } from "./env.ts";

const GMAIL_CLIENT_ID = (): string => getEnv("GMAIL_CLIENT_ID") ?? "";
const GMAIL_CLIENT_SECRET = (): string => getEnv("GMAIL_CLIENT_SECRET") ?? "";
const GMAIL_REFRESH_TOKEN = (): string => getEnv("GMAIL_REFRESH_TOKEN") ?? "";

// Best-known public sending domains for 210's actual financing lenders.
// Verify against Pasha's real inbox before trusting this list -- a lender
// sending from a different domain than expected will silently undercount.
const LENDER_DOMAINS = [
  "snapfinance.com",
  "americanfirstfinance.com", // AFF
  "koalafi.com",
  "progleasing.com", // Progressive Leasing
  "kafene.com",
];

export function gmailConfigured(): boolean {
  return Boolean(GMAIL_CLIENT_ID() && GMAIL_CLIENT_SECRET() && GMAIL_REFRESH_TOKEN());
}

async function getFreshAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID(),
      client_secret: GMAIL_CLIENT_SECRET(),
      refresh_token: GMAIL_REFRESH_TOKEN(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("Gmail token refresh failed (" + res.status + "): " + await res.text());
  const data = await res.json();
  return data.access_token;
}

export interface FinancingEmailTally {
  configured: boolean;
  count_today: number;
  by_lender: Record<string, number>;
  error?: string;
}

export async function countTodaysFinancingEmails(): Promise<FinancingEmailTally> {
  if (!gmailConfigured()) {
    return { configured: false, count_today: 0, by_lender: {} };
  }
  try {
    const token = await getFreshAccessToken();
    const byLender: Record<string, number> = {};
    let total = 0;
    for (const domain of LENDER_DOMAINS) {
      const q = encodeURIComponent("newer_than:1d from:" + domain);
      const res = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=" + q + "&maxResults=100",
        { headers: { Authorization: "Bearer " + token } },
      );
      if (!res.ok) throw new Error("Gmail search failed for " + domain + " (" + res.status + ")");
      const data = await res.json();
      const n = (data.messages || []).length;
      byLender[domain] = n;
      total += n;
    }
    return { configured: true, count_today: total, by_lender: byLender };
  } catch (e) {
    return { configured: true, count_today: 0, by_lender: {}, error: e instanceof Error ? e.message : String(e) };
  }
}
