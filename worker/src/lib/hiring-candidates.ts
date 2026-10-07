// Indeed hiring-candidate monitor. Real ask, Ivan 2026-10-05: "we need to
// have a live view of messages and who answered them, and what they
// answered. and a summary of the current state of each message, if
// anyone said they were coming, etc. all chats must be monitored."
//
// Real constraint, checked before building this (not assumed): Indeed
// closed self-serve API signups in 2020 and requires a signed partner
// agreement for any Job Sync / Disposition Sync / messaging integration
// -- there is no webhook or polling endpoint a small-business employer
// account can call. So this is NOT a live push feed. It's a snapshot
// store: something (today, a person or an agent driving a browser)
// reads Indeed's Candidates page and POSTs what it found to
// /api/hiring/sync; this file just stores the latest known state per
// candidate and a last-synced timestamp. The UI must always show that
// timestamp -- never present this as more real-time than it is.
//
// summary_state is OUR OWN closed classification (not Indeed's own
// status string, which we also keep as indeed_status for reference) --
// it's what actually answers "who said they're coming":
//   confirmed       -- candidate confirmed a specific day/time
//   awaiting_reply  -- we're mid-conversation, ball is in their court
//   unread          -- they sent something we haven't actually read yet
//   flagged         -- bilingual/license status unconfirmed or unclear,
//                      needs a human decision, never auto-messaged
//   disqualified    -- explicitly told us no license / not bilingual
//   non_responder   -- only got the initial auto-message, never replied
//   new_unscreened  -- brand new application, no outreach sent yet
//   other           -- anything that doesn't cleanly fit the above

import { kvGet, kvGetDoc, kvList, kvSet, kvSetDoc, kvDelete, nanoid } from "./kv.ts";

const RES = "hiring-candidates";
const SYNC_DOC = "hiring-candidates-sync";

export type SummaryState =
  | "confirmed"
  | "awaiting_reply"
  | "unread"
  | "flagged"
  | "disqualified"
  | "non_responder"
  | "new_unscreened"
  | "other";

export interface HiringCandidate {
  id: string; // "cand_<indeed_id>" -- stable, lets re-sync upsert idempotently
  indeed_id: string;
  name: string;
  job_title: string;
  location?: string;
  indeed_status: string; // Indeed's own bucket text, e.g. "Contacting" -- free text, Indeed can add buckets we don't know about
  summary_state: SummaryState;
  bilingual: "yes" | "no" | "unknown";
  license: "yes" | "no" | "unknown";
  confirmed_day?: string;
  confirmed_time?: string;
  flag_reason?: string;
  last_message_text?: string;
  last_message_from?: "us" | "them" | null;
  last_message_relative?: string; // Indeed only gives us relative text ("6 days ago") -- stored verbatim, never converted into a fake precise timestamp
  applied_relative?: string; // "Applied Sep 23"
  notes?: string;
  // Real ask, Ivan 2026-10-05: a simple yes/no triage link so Pasha can
  // mark each candidate "try to hire" or "forget about them" without
  // touching Indeed directly. "discard" doesn't set this field -- it
  // deletes the record outright (see deleteCandidate below), since the
  // ask was literally "delete them from the database".
  triage: "pending" | "pursue";
  created_at: string;
  updated_at: string;
  _ord: number;
}

export interface SyncStatus {
  synced_at: string;
  total_known: number;
  source: string; // who/what ran the sync, e.g. "claude-session-manual", "cron:indeed-sync"
}

export async function listCandidates(): Promise<HiringCandidate[]> {
  return kvList<HiringCandidate>(RES);
}

export async function findCandidate(id: string): Promise<HiringCandidate | null> {
  return kvGet<HiringCandidate>(RES, id);
}

export async function getSyncStatus(): Promise<SyncStatus | null> {
  return kvGetDoc<SyncStatus>(SYNC_DOC);
}

export interface UpsertCandidateInput {
  indeed_id: string;
  name: string;
  job_title: string;
  location?: string;
  indeed_status: string;
  summary_state: SummaryState;
  bilingual?: "yes" | "no" | "unknown";
  license?: "yes" | "no" | "unknown";
  confirmed_day?: string;
  confirmed_time?: string;
  flag_reason?: string;
  last_message_text?: string;
  last_message_from?: "us" | "them" | null;
  last_message_relative?: string;
  applied_relative?: string;
  notes?: string;
  triage?: "pending" | "pursue";
}

export async function upsertCandidate(input: UpsertCandidateInput): Promise<HiringCandidate> {
  const id = "cand_" + input.indeed_id;
  const now = new Date().toISOString();
  const existing = await findCandidate(id);
  const rec: HiringCandidate = {
    id,
    indeed_id: input.indeed_id,
    name: input.name,
    job_title: input.job_title,
    location: input.location,
    indeed_status: input.indeed_status,
    summary_state: input.summary_state,
    triage: input.triage ?? existing?.triage ?? "pending",
    bilingual: input.bilingual ?? existing?.bilingual ?? "unknown",
    license: input.license ?? existing?.license ?? "unknown",
    confirmed_day: input.confirmed_day ?? existing?.confirmed_day,
    confirmed_time: input.confirmed_time ?? existing?.confirmed_time,
    flag_reason: input.flag_reason ?? existing?.flag_reason,
    last_message_text: input.last_message_text ?? existing?.last_message_text,
    last_message_from: input.last_message_from ?? existing?.last_message_from ?? null,
    last_message_relative: input.last_message_relative ?? existing?.last_message_relative,
    applied_relative: input.applied_relative ?? existing?.applied_relative,
    notes: input.notes ?? existing?.notes,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    _ord: existing?._ord ?? Date.now(),
  };
  await kvSet(RES, id, rec);
  return rec;
}

export async function bulkUpsertCandidates(
  inputs: UpsertCandidateInput[],
  source: string,
): Promise<{ upserted: number }> {
  for (const input of inputs) await upsertCandidate(input);
  await kvSetDoc<SyncStatus>(SYNC_DOC, {
    synced_at: new Date().toISOString(),
    total_known: inputs.length,
    source,
  });
  return { upserted: inputs.length };
}

export async function deleteCandidate(id: string): Promise<boolean> {
  const existing = await findCandidate(id);
  if (!existing) return false;
  await kvDelete(RES, id);
  return true;
}

export interface HiringSummary {
  counts: Record<SummaryState, number>;
  confirmedThisWeek: HiringCandidate[];
  needsAttention: HiringCandidate[]; // flagged + unread, in that order -- what a human should look at first
  total: number;
  sync: SyncStatus | null;
}

export async function getSummary(): Promise<HiringSummary> {
  const all = await listCandidates();
  const counts: Record<SummaryState, number> = {
    confirmed: 0,
    awaiting_reply: 0,
    unread: 0,
    flagged: 0,
    disqualified: 0,
    non_responder: 0,
    new_unscreened: 0,
    other: 0,
  };
  for (const c of all) counts[c.summary_state]++;
  const confirmedThisWeek = all.filter((c) => c.summary_state === "confirmed");
  const needsAttention = [
    ...all.filter((c) => c.summary_state === "flagged"),
    ...all.filter((c) => c.summary_state === "unread"),
  ];
  return { counts, confirmedThisWeek, needsAttention, total: all.length, sync: await getSyncStatus() };
}

// Real seed, 2026-10-05: the first real Indeed sync this session, for the
// Furniture Delivery Driver/Warehouse Worker job (San Antonio, 10203
// Kotzebue St #112). Scraped directly off employers.indeed.com's
// Candidates page -- not fabricated. Seeds only once (singleton marker,
// same double-seed guard as supplier-colors.ts) so a later real sync from
// /api/hiring/sync always wins over this bootstrap snapshot.
export async function seedHiringCandidatesIfEmpty(): Promise<void> {
  const marker = await kvGetDoc<{ seeded: true }>(RES + "-seed-marker");
  if (marker) return;
  await kvSetDoc(RES + "-seed-marker", { seeded: true as const });
  const existing = await kvList<HiringCandidate>(RES);
  if (existing.length > 0) return;

  const JOB = "Furniture Delivery Driver/Warehouse Worker";
  const seed: UpsertCandidateInput[] = [
    {
      indeed_id: "tosh-soriano",
      name: "Tosh Soriano",
      job_title: JOB,
      location: "San Antonio, TX",
      indeed_status: "Contacting",
      summary_state: "confirmed",
      bilingual: "unknown",
      license: "unknown",
      confirmed_day: "Monday, Oct 5",
      confirmed_time: "1:00pm",
      last_message_text: "Yes, I can do Monday, Oct 5 at 1:00pm.",
      last_message_from: "them",
      last_message_relative: "3 days ago",
      applied_relative: "Applied Sep 23",
    },
    {
      indeed_id: "98bb0a88715e",
      name: "Ruben Maldonado",
      job_title: JOB,
      indeed_status: "Contacting",
      summary_state: "awaiting_reply",
      bilingual: "unknown",
      license: "unknown",
      last_message_text:
        "Hi Ruben, we're scheduling interviews this week, Monday Oct 5 through Friday Oct 9, between 12pm and 4pm. Does Monday, Oct 5 at 2:30pm work for you? Just to confirm: are you bilingual (English and Spanish), and do you have a current, valid driver's license?",
      last_message_from: "us",
      last_message_relative: "just now",
    },
    {
      indeed_id: "ab668e128d15",
      name: "Jonaja McMurry",
      job_title: JOB,
      location: "San Antonio, TX",
      indeed_status: "Contacting",
      summary_state: "flagged",
      bilingual: "no",
      license: "unknown",
      flag_reason: "Resume lists English only under Languages, no Spanish. Asked twice (9/25, 9/29) whether bilingual -- never confirmed. Needs Ivan's call before any slot is offered.",
      last_message_text:
        "Great, thanks for sharing that! We're scheduling interviews Monday, September 28 through Friday, October 2, between 12pm and 4pm. Please let us know the specific day and time... Also, just to confirm: this position requires being bilingual (English and Spanish), and you must have a current, valid driver's license -- can you confirm both of those work for you?",
      last_message_from: "us",
      last_message_relative: "6 days ago",
      applied_relative: "Applied Sep 15",
    },
    {
      indeed_id: "alex-jr-becerra",
      name: "Alex Jr Becerra",
      job_title: JOB,
      location: "San Antonio, TX",
      indeed_status: "Contacting",
      summary_state: "disqualified",
      bilingual: "unknown",
      license: "no",
      flag_reason: "No valid driver's license -- hard requirement for this role.",
      last_message_text: "Thanks for being upfront, Alex -- a valid driver's license is a hard requirement for this role, so we...",
      last_message_from: "us",
      last_message_relative: "6 days ago",
      applied_relative: "Applied Sep 22",
    },
    {
      indeed_id: "don-j-shows-iii",
      name: "Don J Shows III",
      job_title: JOB,
      location: "San Antonio, TX",
      indeed_status: "Contacting",
      summary_state: "disqualified",
      bilingual: "no",
      license: "unknown",
      flag_reason: "Confirmed not bilingual -- hard requirement for this role.",
      last_message_text: "Thanks for letting me know -- this role does require being bilingual in English and Spanish, so we ca...",
      last_message_from: "us",
      last_message_relative: "6 days ago",
      applied_relative: "Applied Sep 21",
    },
  ];
  await bulkUpsertCandidates(seed, "claude-session-manual-seed-2026-10-05");
}
