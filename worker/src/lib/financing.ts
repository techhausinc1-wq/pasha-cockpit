// Real financing-waterfall submission code paths -- item 6. AFF, Koalafi,
// Progressive Leasing, Snap Finance, Kafene. Each lender is a real dealer
// API gated behind a signed dealer agreement Pasha does not have yet, so
// every function here is gated on its own env var with the same graceful
// "not configured" fallback pattern as Twilio/Square/QuickBooks in
// feliks-valet-cockpit/worker/main.ts -- correct request shape and auth
// header, inert until Pasha supplies real dealer credentials. See
// docs/FINANCING-SETUP.md for what to request from each lender and where
// the exact endpoint path should be confirmed against that lenders own
// dealer-portal API docs (none of the five publish a fully open public API
// reference -- access is provisioned per-dealer after underwriting
// approval, so the paths below are each lenders documented integration
// pattern as of this writing, not guaranteed byte-for-byte current).

import { getEnv } from "./env.ts";

export type LenderName = "AFF" | "Koalafi" | "Progressive" | "Snap" | "Kafene";

export interface FinancingApplicant {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  cartTotal: number;
}

export interface FinancingResult {
  configured: boolean;
  lender: LenderName;
  ok: boolean;
  decision?: "approved" | "declined" | "pending";
  approvedAmount?: number;
  applicationUrl?: string;
  message: string;
}

// ── American First Finance (AFF) ────────────────────────────────────────
// Dealer API, OAuth2 client-credentials -> Bearer token, per AFFs dealer
// integration docs. Requires AFF_CLIENT_ID + AFF_CLIENT_SECRET + AFF_DEALER_ID.
async function submitAFF(applicant: FinancingApplicant): Promise<FinancingResult> {
  const clientId = getEnv("AFF_CLIENT_ID") ?? "";
  const clientSecret = getEnv("AFF_CLIENT_SECRET") ?? "";
  const dealerId = getEnv("AFF_DEALER_ID") ?? "";
  if (!clientId || !clientSecret || !dealerId) {
    return { configured: false, lender: "AFF", ok: false, message: "AFF not configured (see docs/FINANCING-SETUP.md) -- set AFF_CLIENT_ID, AFF_CLIENT_SECRET, AFF_DEALER_ID." };
  }
  try {
    const tokenRes = await fetch("https://api.americanfirstfinance.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return { configured: true, lender: "AFF", ok: false, message: "AFF auth failed: " + JSON.stringify(tokenData) };
    }
    const appRes = await fetch("https://api.americanfirstfinance.com/v1/applications", {
      method: "POST",
      headers: { Authorization: "Bearer " + tokenData.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({
        dealer_id: dealerId,
        first_name: applicant.firstName,
        last_name: applicant.lastName,
        phone: applicant.phone,
        email: applicant.email,
        address: { line1: applicant.addressLine1, city: applicant.city, state: applicant.state, zip: applicant.zip },
        cart_total: applicant.cartTotal,
      }),
    });
    const data = await appRes.json().catch(() => ({}));
    if (!appRes.ok) return { configured: true, lender: "AFF", ok: false, message: "AFF application failed: " + JSON.stringify(data) };
    return { configured: true, lender: "AFF", ok: true, decision: data.decision, approvedAmount: data.approved_amount, applicationUrl: data.application_url, message: "AFF application submitted." };
  } catch (e) {
    return { configured: true, lender: "AFF", ok: false, message: "AFF request error: " + (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Koalafi ──────────────────────────────────────────────────────────────
// Dealer/partner API, static API key header. Requires KOALAFI_API_KEY +
// KOALAFI_MERCHANT_ID.
async function submitKoalafi(applicant: FinancingApplicant): Promise<FinancingResult> {
  const apiKey = getEnv("KOALAFI_API_KEY") ?? "";
  const merchantId = getEnv("KOALAFI_MERCHANT_ID") ?? "";
  if (!apiKey || !merchantId) {
    return { configured: false, lender: "Koalafi", ok: false, message: "Koalafi not configured (see docs/FINANCING-SETUP.md) -- set KOALAFI_API_KEY, KOALAFI_MERCHANT_ID." };
  }
  try {
    const res = await fetch("https://api.koalafi.com/v1/applications", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantId,
        customer: { firstName: applicant.firstName, lastName: applicant.lastName, phone: applicant.phone, email: applicant.email },
        address: { line1: applicant.addressLine1, city: applicant.city, state: applicant.state, postalCode: applicant.zip },
        orderTotal: applicant.cartTotal,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { configured: true, lender: "Koalafi", ok: false, message: "Koalafi application failed: " + JSON.stringify(data) };
    return { configured: true, lender: "Koalafi", ok: true, decision: data.status, approvedAmount: data.approvedAmount, applicationUrl: data.checkoutUrl, message: "Koalafi application submitted." };
  } catch (e) {
    return { configured: true, lender: "Koalafi", ok: false, message: "Koalafi request error: " + (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Progressive Leasing ─────────────────────────────────────────────────
// POS API, static API key header. Requires PROGRESSIVE_API_KEY +
// PROGRESSIVE_STORE_NUMBER (Progressive assigns a numeric store id per
// location at onboarding).
async function submitProgressive(applicant: FinancingApplicant): Promise<FinancingResult> {
  const apiKey = getEnv("PROGRESSIVE_API_KEY") ?? "";
  const storeNumber = getEnv("PROGRESSIVE_STORE_NUMBER") ?? "";
  if (!apiKey || !storeNumber) {
    return { configured: false, lender: "Progressive", ok: false, message: "Progressive Leasing not configured (see docs/FINANCING-SETUP.md) -- set PROGRESSIVE_API_KEY, PROGRESSIVE_STORE_NUMBER." };
  }
  try {
    const res = await fetch("https://api.progleasing.com/pos/v1/applications", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        storeNumber,
        firstName: applicant.firstName,
        lastName: applicant.lastName,
        cellPhone: applicant.phone,
        email: applicant.email,
        street: applicant.addressLine1,
        city: applicant.city,
        state: applicant.state,
        zip: applicant.zip,
        cartTotal: applicant.cartTotal,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { configured: true, lender: "Progressive", ok: false, message: "Progressive application failed: " + JSON.stringify(data) };
    return { configured: true, lender: "Progressive", ok: true, decision: data.decisionStatus, approvedAmount: data.approvalAmount, applicationUrl: data.customerPortalUrl, message: "Progressive Leasing application submitted." };
  } catch (e) {
    return { configured: true, lender: "Progressive", ok: false, message: "Progressive request error: " + (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Snap Finance ─────────────────────────────────────────────────────────
// Merchant API, static API key header. Requires SNAP_API_KEY +
// SNAP_MERCHANT_ID.
async function submitSnap(applicant: FinancingApplicant): Promise<FinancingResult> {
  const apiKey = getEnv("SNAP_API_KEY") ?? "";
  const merchantId = getEnv("SNAP_MERCHANT_ID") ?? "";
  if (!apiKey || !merchantId) {
    return { configured: false, lender: "Snap", ok: false, message: "Snap Finance not configured (see docs/FINANCING-SETUP.md) -- set SNAP_API_KEY, SNAP_MERCHANT_ID." };
  }
  try {
    const res = await fetch("https://api.snapfinance.com/v3/applications", {
      method: "POST",
      headers: { Authorization: "ApiKey " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantId,
        applicant: { firstName: applicant.firstName, lastName: applicant.lastName, mobilePhone: applicant.phone, email: applicant.email },
        address: { street1: applicant.addressLine1, city: applicant.city, state: applicant.state, zip: applicant.zip },
        cartAmount: applicant.cartTotal,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { configured: true, lender: "Snap", ok: false, message: "Snap application failed: " + JSON.stringify(data) };
    return { configured: true, lender: "Snap", ok: true, decision: data.applicationStatus, approvedAmount: data.approvalAmount, applicationUrl: data.applicationLink, message: "Snap Finance application submitted." };
  } catch (e) {
    return { configured: true, lender: "Snap", ok: false, message: "Snap request error: " + (e instanceof Error ? e.message : String(e)) };
  }
}

// ── Kafene ───────────────────────────────────────────────────────────────
// Partner API, static API key header. Requires KAFENE_API_KEY +
// KAFENE_RETAILER_ID.
async function submitKafene(applicant: FinancingApplicant): Promise<FinancingResult> {
  const apiKey = getEnv("KAFENE_API_KEY") ?? "";
  const retailerId = getEnv("KAFENE_RETAILER_ID") ?? "";
  if (!apiKey || !retailerId) {
    return { configured: false, lender: "Kafene", ok: false, message: "Kafene not configured (see docs/FINANCING-SETUP.md) -- set KAFENE_API_KEY, KAFENE_RETAILER_ID." };
  }
  try {
    const res = await fetch("https://api.kafene.com/partner/v1/applications", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        retailerId,
        firstName: applicant.firstName,
        lastName: applicant.lastName,
        phoneNumber: applicant.phone,
        email: applicant.email,
        addressLine1: applicant.addressLine1,
        city: applicant.city,
        state: applicant.state,
        zipCode: applicant.zip,
        orderAmount: applicant.cartTotal,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { configured: true, lender: "Kafene", ok: false, message: "Kafene application failed: " + JSON.stringify(data) };
    return { configured: true, lender: "Kafene", ok: true, decision: data.decision, approvedAmount: data.approvedSpendingLimit, applicationUrl: data.applicationUrl, message: "Kafene application submitted." };
  } catch (e) {
    return { configured: true, lender: "Kafene", ok: false, message: "Kafene request error: " + (e instanceof Error ? e.message : String(e)) };
  }
}

// Single-lender submit, used by the /api/financing/submit/:lender route so
// a worker can retry just the next lender in the waterfall (matches the
// existing SampleApplication.lender_attempts shape -- one attempt at a
// time, not an all-five blast).
export async function submitToLender(lender: LenderName, applicant: FinancingApplicant): Promise<FinancingResult> {
  if (lender === "AFF") return submitAFF(applicant);
  if (lender === "Koalafi") return submitKoalafi(applicant);
  if (lender === "Progressive") return submitProgressive(applicant);
  if (lender === "Snap") return submitSnap(applicant);
  return submitKafene(applicant);
}

export function lenderConfigured(lender: LenderName): boolean {
  if (lender === "AFF") return Boolean(getEnv("AFF_CLIENT_ID") && getEnv("AFF_CLIENT_SECRET"));
  if (lender === "Koalafi") return Boolean(getEnv("KOALAFI_API_KEY"));
  if (lender === "Progressive") return Boolean(getEnv("PROGRESSIVE_API_KEY"));
  if (lender === "Snap") return Boolean(getEnv("SNAP_API_KEY"));
  return Boolean(getEnv("KAFENE_API_KEY"));
}
