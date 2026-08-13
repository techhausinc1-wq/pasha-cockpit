// RBAC primitives. The atom list comes from spec §4.1; this is the runtime check.
//
// Atoms control what a worker can see and do. Master users have all atoms.
// Workers are assigned a role template (or custom set of atoms).

export type Atom =
  // Messages
  | "messages.read.own"
  | "messages.read.team"
  | "messages.read.all"
  | "messages.send.assigned-accounts"
  | "messages.send.any-account"
  | "messages.assign"
  // Catalog
  | "catalog.read"
  | "catalog.read.floor-prices"
  | "catalog.write.basic"
  | "catalog.write.pricing"
  // Inventory
  | "inventory.read"
  | "inventory.write.cycle-count"
  | "inventory.write.receive"
  | "inventory.write.ship"
  // Financing
  | "financing.read.applications"
  | "financing.read.team-aggregate"
  | "financing.read.all-applications"
  | "financing.initiate"
  // Workers
  | "workers.read.own-performance"
  | "workers.read.team-leaderboard"
  | "workers.read.all-performance"
  // Money
  | "money.read.ap-aging"
  | "money.read.cash-position"
  | "money.read.tax-obligations"
  | "money.read.daily-sales"
  | "money.write.mark-paid"
  // Notifications
  | "notifications.regulatory"
  | "notifications.supplier"
  | "notifications.lender"
  // Threads
  | "thread.mark-won"
  | "thread.mark-lost"
  | "thread.refund.initiate"
  // Reports
  | "reports.read.basic"
  | "reports.read.financial"
  | "reports.create.custom"
  // Config (master-only by default)
  | "config.tenant"
  | "config.users"
  | "config.integrations"
  // Customers (CRM)
  | "customers.read"
  | "customers.write"
  // Orders (deposit / balance-due ledger)
  | "orders.read.own"
  | "orders.read.all"
  | "orders.write.deposit"
  | "orders.write.balance"
  // Deliveries
  | "deliveries.read"
  | "deliveries.write.schedule"
  | "deliveries.write.status"
  // Broadcast marketing — separate from messages.send.* since this is a
  // store-wide action with compliance surface (opt-in, carrier rules),
  // not a per-thread reply.
  | "messages.send.broadcast";

export type Role =
  | "owner"
  | "sales-lead"
  | "showroom-associate"
  | "bookkeeper"
  | "delivery-driver"
  | "read-only";

export const ROLE_ATOMS: Record<Role, Atom[]> = {
  "owner": [
    "messages.read.own",
    "messages.read.team",
    "messages.read.all",
    "messages.send.assigned-accounts",
    "messages.send.any-account",
    "messages.assign",
    "catalog.read",
    "catalog.read.floor-prices",
    "catalog.write.basic",
    "catalog.write.pricing",
    "inventory.read",
    "inventory.write.cycle-count",
    "inventory.write.receive",
    "inventory.write.ship",
    "financing.read.applications",
    "financing.read.team-aggregate",
    "financing.read.all-applications",
    "financing.initiate",
    "workers.read.own-performance",
    "workers.read.team-leaderboard",
    "workers.read.all-performance",
    "money.read.ap-aging",
    "money.read.cash-position",
    "money.read.tax-obligations",
    "money.read.daily-sales",
    "money.write.mark-paid",
    "notifications.regulatory",
    "notifications.supplier",
    "notifications.lender",
    "thread.mark-won",
    "thread.mark-lost",
    "thread.refund.initiate",
    "reports.read.basic",
    "reports.read.financial",
    "reports.create.custom",
    "config.tenant",
    "config.users",
    "config.integrations",
    "customers.read",
    "customers.write",
    "orders.read.own",
    "orders.read.all",
    "orders.write.deposit",
    "orders.write.balance",
    "deliveries.read",
    "deliveries.write.schedule",
    "deliveries.write.status",
    "messages.send.broadcast",
  ],
  "sales-lead": [
    "messages.read.own",
    "messages.read.team",
    "messages.read.all",
    "messages.send.assigned-accounts",
    "messages.send.any-account",
    "messages.assign",
    "catalog.read",
    "catalog.read.floor-prices",
    "catalog.write.basic",
    "inventory.read",
    "inventory.write.cycle-count",
    "inventory.write.receive",
    "inventory.write.ship",
    "financing.read.applications",
    "financing.read.team-aggregate",
    "financing.read.all-applications",
    "financing.initiate",
    "workers.read.own-performance",
    "workers.read.team-leaderboard",
    "notifications.lender",
    "thread.mark-won",
    "thread.mark-lost",
    "reports.read.basic",
    "customers.read",
    "customers.write",
    "orders.read.all",
    "orders.write.deposit",
    "orders.write.balance",
    "deliveries.read",
    "deliveries.write.schedule",
  ],
  "showroom-associate": [
    "messages.read.own",
    "messages.send.assigned-accounts",
    "catalog.read",
    "catalog.read.floor-prices",
    "inventory.read",
    "inventory.write.cycle-count",
    "inventory.write.ship",
    "financing.read.applications",
    "financing.initiate",
    "workers.read.own-performance",
    "thread.mark-won",
    "thread.mark-lost",
    "notifications.lender",
    "customers.read",
    "customers.write",
    "orders.read.own",
    "orders.write.deposit",
    "deliveries.read",
  ],
  "bookkeeper": [
    "money.read.ap-aging",
    "money.read.cash-position",
    "money.read.tax-obligations",
    "money.read.daily-sales",
    "money.write.mark-paid",
    "notifications.regulatory",
    "notifications.supplier",
    "reports.read.financial",
    "reports.read.basic",
    "customers.read",
    "orders.read.all",
    "orders.write.balance",
  ],
  "delivery-driver": [
    "inventory.read",
    "inventory.write.ship",
    "messages.read.own",
    "deliveries.read",
    "deliveries.write.status",
  ],
  "read-only": [
    "messages.read.all",
    "catalog.read",
    "inventory.read",
    "financing.read.all-applications",
    "workers.read.all-performance",
    "money.read.ap-aging",
    "money.read.cash-position",
    "money.read.tax-obligations",
    "money.read.daily-sales",
    "reports.read.basic",
    "reports.read.financial",
    "customers.read",
    "orders.read.all",
    "deliveries.read",
  ],
};

export interface User {
  id: string;
  name: string;
  role: Role;
  email?: string;
  assigned_accounts?: string[]; // Marketplace/Page/IG account IDs
  custom_overrides?: { added: Atom[]; removed: Atom[] }; // grants/revokes on top of role template
  is_master: boolean; // owner-level (Ivan, Paul)
}

export function effectiveAtoms(user: User): Set<Atom> {
  const set = new Set<Atom>(ROLE_ATOMS[user.role] || []);
  if (user.custom_overrides) {
    for (const a of user.custom_overrides.added) set.add(a);
    for (const r of user.custom_overrides.removed) set.delete(r);
  }
  return set;
}

export function userCan(user: User, atom: Atom): boolean {
  return effectiveAtoms(user).has(atom);
}

// Hard-coded user list for the shell. In Phase 1 this lives in the database.
export const SHELL_USERS: User[] = [
  {
    id: "u_paul",
    name: "Paul (Pasha)",
    role: "owner",
    email: "besthomefurnituresa@gmail.com",
    is_master: true,
    assigned_accounts: [
      "mp-acct-1",
      "mp-acct-2",
      "mp-acct-3",
      "pg-210-main",
      "ig-210furnitureoutlet",
    ],
  },
  {
    id: "u_ivan",
    name: "Ivan (advisor)",
    role: "owner",
    email: "techhausinc1@gmail.com",
    is_master: true,
    assigned_accounts: [
      "mp-acct-1",
      "mp-acct-2",
      "mp-acct-3",
      "pg-210-main",
      "ig-210furnitureoutlet",
    ],
  },
  {
    id: "u_rick",
    name: "Rick (Sales Lead)",
    role: "sales-lead",
    is_master: false,
    assigned_accounts: ["mp-acct-1", "mp-acct-2", "pg-210-main"],
  },
  {
    id: "u_carlos",
    name: "Carlos",
    role: "showroom-associate",
    is_master: false,
    assigned_accounts: ["mp-acct-2", "ig-210furnitureoutlet"],
  },
  {
    id: "u_nick",
    name: "Nick",
    role: "showroom-associate",
    is_master: false,
    assigned_accounts: ["mp-acct-3"],
  },
];

export function findUser(id: string): User | undefined {
  return SHELL_USERS.find((u) => u.id === id);
}
