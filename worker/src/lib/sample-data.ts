// Sample data for the cockpit shell. Replaced by real database queries in Phase 1.

export interface SampleThread {
  id: string;
  account_id: string;
  account_label: string;
  surface: "mp" | "pg" | "ig" | "wa"; // marketplace / page / instagram / whatsapp
  customer_handle: string;
  customer_name: string;
  worker_id: string | null; // null = unassigned
  status: "active" | "won" | "lost" | "cold";
  intent:
    | "stock-check"
    | "price-check"
    | "financing"
    | "location"
    | "delivery"
    | "negotiation"
    | "general";
  product_slug: string | null;
  last_message_at: string;
  last_message_from: "customer" | "worker";
  unread: boolean;
  preview: string;
}

export const SAMPLE_THREADS: SampleThread[] = [
  {
    id: "t_1",
    account_id: "mp-acct-1",
    account_label: "FB Marketplace · acct 1",
    surface: "mp",
    customer_handle: "maria.lopez.92",
    customer_name: "Maria Lopez",
    worker_id: "u_rick",
    status: "active",
    intent: "stock-check",
    product_slug: "logan2-charcoal-reversible-sectional-charcoal",
    last_message_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    last_message_from: "customer",
    unread: true,
    preview: "is the gray logan2 still available? need it this weekend",
  },
  {
    id: "t_2",
    account_id: "mp-acct-2",
    account_label: "FB Marketplace · acct 2",
    surface: "mp",
    customer_handle: "j.bryant",
    customer_name: "Joel Bryant",
    worker_id: "u_carlos",
    status: "active",
    intent: "financing",
    product_slug:
      "amelia-charcoal-power-reclining-sectional-w-bluetooth-speakers",
    last_message_at: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
    last_message_from: "worker",
    unread: false,
    preview:
      "(worker) - yes - $2,199 - apply here for financing: bk.snapfinance.com/...",
  },
  {
    id: "t_3",
    account_id: "pg-210-main",
    account_label: "FB Page · 210 main",
    surface: "pg",
    customer_handle: "shannon.rivera",
    customer_name: "Shannon Rivera",
    worker_id: null,
    status: "active",
    intent: "delivery",
    product_slug: "wynnlow-queen-panel-bed-with-dresser",
    last_message_at: new Date(Date.now() - 47 * 60 * 1000).toISOString(),
    last_message_from: "customer",
    unread: true,
    preview:
      "Do you deliver to converse, TX? Buying for my son's apt next weekend",
  },
  {
    id: "t_4",
    account_id: "mp-acct-1",
    account_label: "FB Marketplace · acct 1",
    surface: "mp",
    customer_handle: "tonyramos",
    customer_name: "Tony Ramos",
    worker_id: "u_nick",
    status: "active",
    intent: "negotiation",
    product_slug: "messi-white-pu-reversible-sectional",
    last_message_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    last_message_from: "customer",
    unread: true,
    preview:
      "Will you take $400? It's been listed for a few weeks. Cash today.",
  },
  {
    id: "t_5",
    account_id: "ig-210furnitureoutlet",
    account_label: "Instagram · @210furnitureoutlet",
    surface: "ig",
    customer_handle: "@jasminev_",
    customer_name: "Jasmine V.",
    worker_id: "u_carlos",
    status: "active",
    intent: "stock-check",
    product_slug:
      "akerson-grey-3pc-queen-bedroom-set-included-queen-bed-dresser-mirror",
    last_message_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    last_message_from: "worker",
    unread: false,
    preview:
      "(worker) - in stock at the showroom now, $1,599 out the door - come by today till 7pm",
  },
  {
    id: "t_6",
    account_id: "mp-acct-2",
    account_label: "FB Marketplace · acct 2",
    surface: "mp",
    customer_handle: "elenacm",
    customer_name: "Elena C.M.",
    worker_id: "u_rick",
    status: "cold",
    intent: "financing",
    product_slug: "fulton-counter-height-bench-wh",
    last_message_at: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(),
    last_message_from: "worker",
    unread: false,
    preview:
      "(worker, 2d ago) - try AFF first: americanfirstfinance.com/app/?dealer=4327 - any luck?",
  },
];

// Real inbound WhatsApp threads, populated by the webhook in main.ts.
// Separate from SAMPLE_THREADS (which stay hardcoded fixtures) since these
// are live data — no DB yet (Phase 1), so this is process-memory only and
// resets on worker restart.
export const WHATSAPP_LIVE_THREADS: SampleThread[] = [];

export function upsertWhatsAppThread(msg: {
  wa_id: string;
  name: string | null;
  text: string;
  timestamp: string;
}): void {
  const accountId = "wa-210-main";
  let thread = WHATSAPP_LIVE_THREADS.find((t) =>
    t.customer_handle === msg.wa_id
  );
  if (!thread) {
    thread = {
      id: `wa_${msg.wa_id}`,
      account_id: accountId,
      account_label: "WhatsApp · 210 main",
      surface: "wa",
      customer_handle: msg.wa_id,
      customer_name: msg.name || msg.wa_id,
      worker_id: null,
      status: "active",
      intent: "general",
      product_slug: null,
      last_message_at: msg.timestamp,
      last_message_from: "customer",
      unread: true,
      preview: msg.text,
    };
    WHATSAPP_LIVE_THREADS.push(thread);
  } else {
    thread.last_message_at = msg.timestamp;
    thread.last_message_from = "customer";
    thread.unread = true;
    thread.preview = msg.text;
    if (msg.name) thread.customer_name = msg.name;
  }
}

export interface SampleApplication {
  id: string;
  customer_name: string;
  worker_id: string;
  ticket: number;
  product_slugs: string[];
  started_at: string;
  status: "in-progress" | "approved" | "declined" | "funded";
  lender_attempts: {
    lender: "AFF" | "Koalafi" | "Progressive" | "Snap" | "Kafene";
    decision: "approved" | "declined" | "pending";
    amount?: number;
    at: string;
  }[];
}

export const SAMPLE_APPLICATIONS: SampleApplication[] = [
  {
    id: "a_1",
    customer_name: "Cesar Garcia",
    worker_id: "u_carlos",
    ticket: 999,
    product_slugs: ["logan2-charcoal-reversible-sectional-charcoal"],
    started_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    status: "in-progress",
    lender_attempts: [
      {
        lender: "AFF",
        decision: "pending",
        at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      },
    ],
  },
  {
    id: "a_2",
    customer_name: "Adriana Soto",
    worker_id: "u_rick",
    ticket: 2199,
    product_slugs: [
      "amelia-charcoal-power-reclining-sectional-w-bluetooth-speakers",
    ],
    started_at: new Date(Date.now() - 47 * 60 * 1000).toISOString(),
    status: "in-progress",
    lender_attempts: [
      {
        lender: "AFF",
        decision: "declined",
        at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      },
      {
        lender: "Koalafi",
        decision: "pending",
        at: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
      },
    ],
  },
  {
    id: "a_3",
    customer_name: "Luis Hernandez",
    worker_id: "u_carlos",
    ticket: 1599,
    product_slugs: [
      "akerson-grey-3pc-queen-bedroom-set-included-queen-bed-dresser-mirror",
    ],
    started_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    status: "approved",
    lender_attempts: [
      {
        lender: "AFF",
        decision: "declined",
        at: new Date(Date.now() - 85 * 60 * 1000).toISOString(),
      },
      {
        lender: "Koalafi",
        decision: "approved",
        amount: 1599,
        at: new Date(Date.now() - 78 * 60 * 1000).toISOString(),
      },
    ],
  },
];

export interface APInvoice {
  id: string;
  supplier: "Crown Mark" | "Happy Homes" | "Other";
  invoice_no: string;
  amount: number;
  due_date: string;
  status: "open" | "paid" | "overdue";
  received: string;
}

export const SAMPLE_AP: APInvoice[] = [
  {
    id: "ap_1",
    supplier: "Crown Mark",
    invoice_no: "CM-2026-0518",
    amount: 8420.50,
    due_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    status: "open",
    received: "2026-05-18",
  },
  {
    id: "ap_2",
    supplier: "Crown Mark",
    invoice_no: "CM-2026-0512",
    amount: 3895.00,
    due_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    status: "open",
    received: "2026-05-12",
  },
  {
    id: "ap_3",
    supplier: "Happy Homes",
    invoice_no: "HH-26-04412",
    amount: 5240.00,
    due_date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
    status: "overdue",
    received: "2026-05-09",
  },
  {
    id: "ap_4",
    supplier: "Happy Homes",
    invoice_no: "HH-26-04488",
    amount: 1820.00,
    due_date: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
    status: "open",
    received: "2026-05-19",
  },
];

export interface TaxObligation {
  id: string;
  name: string;
  agency: string;
  due_date: string;
  status: "filed" | "due" | "overdue";
  amount_accrued?: number;
  notes: string;
}

export const SAMPLE_TAX: TaxObligation[] = [
  {
    id: "tax_1",
    name: "TX Sales Tax — May 2026 return",
    agency: "TX Comptroller",
    due_date: "2026-06-20",
    status: "due",
    amount_accrued: 4860,
    notes: "Monthly filing, ~30% above April pace",
  },
  {
    id: "tax_2",
    name: "TX Sales Tax — April 2026 return",
    agency: "TX Comptroller",
    due_date: "2026-05-19",
    status: "filed",
    notes: "Filed 2026-05-19, Webfile confirmation received",
  },
  {
    id: "tax_3",
    name: "Workers Comp Renewal",
    agency: "Texas Mutual",
    due_date: "2026-06-14",
    status: "due",
    notes: "21 days out, no cancellation notice received",
  },
  {
    id: "tax_4",
    name: "Bexar County BPP Bill",
    agency: "Bexar County Tax Assessor",
    due_date: "2027-01-31",
    status: "due",
    notes: "Bill arrives October; track rendition was filed on time April 15",
  },
];

export interface SampleStat {
  label: string;
  value: string;
  trend?: string;
  hint?: string;
}

export const TODAY_STATS = (): SampleStat[] => [
  {
    label: "Messages today",
    value: "18",
    trend: "+3 vs Sat avg",
    hint: "11 Paul · 5 Carlos · 2 Rick",
  },
  { label: "Visits expected", value: "3", hint: "From yesterday's threads" },
  { label: "Sales today", value: "$2,499", trend: "1 financed (Snap), 1 cash" },
  {
    label: "Lost-sale flags",
    value: "1",
    hint: "Logan2 brown — financing not offered in reply 1",
  },
];

export const TRUCKS_INBOUND = [
  { supplier: "Crown Mark", arrives: "Mon 7am", pieces: 47 },
  { supplier: "Happy Homes", arrives: "Wed 11am", pieces: 22 },
];
