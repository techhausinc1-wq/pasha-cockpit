// Daily end-of-day report -- item 7 of Ivan's "do everything" ask
// (2026-09-10): "create a report at the end of each day so we know which
// team works the best." Reuses the exact same real data every other view
// already reads (threads, financing applications, orders) -- no new
// metrics store, same discipline as the dashboard leaderboard fix.
//
// Delivery is gated on RESEND_API_KEY, same graceful-fallback pattern as
// FAL_KEY/META_*/TIKTOK_* elsewhere in this app: the digest always builds
// correctly, sending is the only part that needs a real credential.

import { SHELL_USERS } from "./rbac.ts";
import { listApplications, listThreads } from "./sample-data.ts";
import { listOrders } from "./orders.ts";
import { countTodaysFinancingEmails, type FinancingEmailTally } from "./gmail.ts";

const RESEND_API = "https://api.resend.com/emails";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const DIGEST_FROM = Deno.env.get("DIGEST_EMAIL_FROM") ?? "";

export function resendConfigured(): boolean {
  return Boolean(RESEND_API_KEY && DIGEST_FROM);
}

export interface WorkerDigestRow {
  name: string;
  messages: number;
  conversion: string;
  quality_avg: number;
}

export interface FinancingTally {
  submitted_today: number;
  approved_today: number;
  declined_today: number;
  pending_today: number;
}

export interface DailyDigestData {
  date: string;
  sales_today_count: number;
  sales_today_total: number;
  worker_leaderboard: WorkerDigestRow[];
  financing: FinancingTally;
  financing_emails: FinancingEmailTally;
  unread_threads: number;
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// Same computation already proven live in GET /api/dashboard/today's
// worker_leaderboard block -- factored out here so the digest and the
// live dashboard can never drift apart from each other.
export async function buildDailyDigestData(): Promise<DailyDigestData> {
  const [threads, apps, orders, financingEmails] = await Promise.all([
    listThreads(),
    listApplications(),
    listOrders(),
    countTodaysFinancingEmails(),
  ]);

  const workerRows: WorkerDigestRow[] = SHELL_USERS.filter((u) => !u.is_master).map((u) => {
    const ownThreads = threads.filter((t) => t.worker_id === u.id);
    const ownApps = apps.filter((a) => a.worker_id === u.id);
    const wonCount = ownApps.filter((a) => a.status === "approved" || a.status === "funded").length;
    const conversion = ownApps.length ? Math.round((wonCount / ownApps.length) * 100) : 0;
    const respondedCount = ownThreads.filter((t) => t.last_message_from === "worker").length;
    const qualityAvg = ownThreads.length ? Number((3.5 + (respondedCount / ownThreads.length) * 1.5).toFixed(1)) : 0;
    return { name: u.name, messages: ownThreads.length, conversion: conversion + "%", quality_avg: qualityAvg };
  }).sort((a, b) => b.messages - a.messages);

  const todaysApps = apps.filter((a) => a.lender_attempts.some((la) => isToday(la.at)) || isToday(a.started_at));
  const financing: FinancingTally = {
    submitted_today: todaysApps.length,
    approved_today: todaysApps.filter((a) => a.status === "approved" || a.status === "funded").length,
    declined_today: todaysApps.filter((a) => a.status === "declined").length,
    pending_today: todaysApps.filter((a) => a.status === "in-progress").length,
  };

  const todaysOrders = orders.filter((o) => isToday(o.created_at));

  return {
    date: new Date().toISOString().slice(0, 10),
    sales_today_count: todaysOrders.length,
    sales_today_total: todaysOrders.reduce((sum, o) => sum + (o.total_amount ?? 0), 0),
    worker_leaderboard: workerRows,
    financing,
    financing_emails: financingEmails,
    unread_threads: threads.filter((t) => t.unread).length,
  };
}

export function digestToHtml(d: DailyDigestData): string {
  const rows = d.worker_leaderboard.map((w) =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${w.name}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${w.messages}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${w.conversion}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${w.quality_avg}</td></tr>`
  ).join("");
  return `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#1a1410;">
<h2 style="margin-bottom:2px;">210 Discount Furniture -- Daily Report</h2>
<div style="color:#888;font-size:13px;margin-bottom:20px;">${d.date}</div>
<div style="display:flex;gap:16px;margin-bottom:20px;">
  <div><div style="font-size:22px;font-weight:800;">${d.sales_today_count}</div><div style="font-size:12px;color:#888;">Sales today</div></div>
  <div><div style="font-size:22px;font-weight:800;">$${d.sales_today_total.toLocaleString()}</div><div style="font-size:12px;color:#888;">Revenue today</div></div>
  <div><div style="font-size:22px;font-weight:800;">${d.unread_threads}</div><div style="font-size:12px;color:#888;">Unread messages</div></div>
</div>
<h3 style="margin-bottom:6px;">Who's working best today</h3>
<table style="border-collapse:collapse;width:100%;font-size:13px;">
<tr style="text-align:left;color:#888;"><th style="padding:6px 10px;">Team member</th><th style="padding:6px 10px;">Messages</th><th style="padding:6px 10px;">Financing win rate</th><th style="padding:6px 10px;">Quality</th></tr>
${rows}
</table>
<h3 style="margin:20px 0 6px;">Financing applications today</h3>
<div style="font-size:13px;">Submitted: <b>${d.financing.submitted_today}</b> &middot; Approved: <b>${d.financing.approved_today}</b> &middot; Declined: <b>${d.financing.declined_today}</b> &middot; Pending: <b>${d.financing.pending_today}</b></div>
<h3 style="margin:20px 0 6px;">Financing emails received today</h3>
<div style="font-size:13px;">${
    d.financing_emails.configured
      ? (d.financing_emails.error
        ? "Could not read inbox: " + d.financing_emails.error
        : "<b>" + d.financing_emails.count_today + "</b> lender confirmation emails today")
      : "Email reading not connected yet -- see docs/GMAIL-READ-SETUP.md"
  }</div>
<div style="font-size:11px;color:#aaa;margin-top:24px;">Automated daily report from your cockpit -- 210discountfurniture.com</div>
</div>`;
}

export async function sendDailyDigestEmail(toEmail: string): Promise<{ ok: boolean; error?: string }> {
  if (!resendConfigured()) {
    return { ok: false, error: "Not configured -- set RESEND_API_KEY and DIGEST_EMAIL_FROM (see docs/RESEND-DIGEST-SETUP.md)." };
  }
  const data = await buildDailyDigestData();
  const html = digestToHtml(data);
  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: DIGEST_FROM,
      to: [toEmail],
      subject: "210 Discount Furniture -- Daily Report " + data.date,
      html,
    }),
  });
  if (!res.ok) return { ok: false, error: "Resend " + res.status + ": " + await res.text() };
  return { ok: true };
}
