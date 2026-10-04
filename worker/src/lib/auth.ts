// Real per-person PIN auth + bearer session tokens -- replaces the trivial
// static "X-Access-Code: pasha-shell-<userid>" scheme. Same shape as
// feliks-valet-cockpit/worker/main.ts: POST /api/login exchanges
// {userId, pin} for a bearer session token; every other /api/* route
// resolves that token back to a User via userFromToken(), then checks the
// same ROLE_ATOMS table rbac.ts already defines (kept exactly as-is --
// only the auth boundary in front of it changes from fake to real).
//
// PINs are 4-digit, plaintext in KV -- same documented tradeoff as
// feliks-valet-cockpit/AUTH-SETUP.md: this is a single small businesss
// internal tool, not a multi-tenant SaaS, so PIN secrecy is not the real
// security boundary. The real boundary is the server-side atom check on
// every route below, which was the actual gap being closed here (the old
// scheme had ANY caller who knew the naming convention able to mint a
// valid access code for any user id).

import { kvDelete, kvGet, kvList, kvSet, nanoid } from "./kv.ts";
import { type Atom, findUser, type Role, ROLE_ATOMS, SHELL_USERS, type User } from "./rbac.ts";

const USERS_RES = "users";
const SESSIONS_RES = "sessions";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Failed-login tracking -- a fixed-size ring of recent attempts per userId,
// kept in a KV resource so it survives across isolates (unlike a plain
// in-memory Map, which Workers can spin down between requests). Real gap
// found and fixed 2026-10-01: /api/login previously had NO rate limiting
// at all -- 4-digit PINs (10,000 possible values) with unlimited attempts
// is brute-forceable. This is intentionally simple (attempt counter +
// cooldown window), not a full lockout/alerting system -- proportionate to
// a small internal tool, not a bank.
const LOGIN_ATTEMPTS_RES = "login_attempts";
const MAX_ATTEMPTS = 8;
const LOCKOUT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

interface LoginAttempts {
  count: number;
  firstAttemptAt: number;
}

export async function checkLoginLockout(userId: string): Promise<{ locked: boolean; retryAfterMs?: number }> {
  const rec = await kvGet<LoginAttempts>(LOGIN_ATTEMPTS_RES, userId);
  if (!rec) return { locked: false };
  const age = Date.now() - rec.firstAttemptAt;
  if (age > LOCKOUT_WINDOW_MS) return { locked: false }; // window expired, treat as fresh
  if (rec.count >= MAX_ATTEMPTS) return { locked: true, retryAfterMs: LOCKOUT_WINDOW_MS - age };
  return { locked: false };
}

export async function recordFailedLogin(userId: string): Promise<void> {
  const rec = await kvGet<LoginAttempts>(LOGIN_ATTEMPTS_RES, userId);
  const now = Date.now();
  if (!rec || now - rec.firstAttemptAt > LOCKOUT_WINDOW_MS) {
    await kvSet(LOGIN_ATTEMPTS_RES, userId, { count: 1, firstAttemptAt: now }, LOCKOUT_WINDOW_MS);
  } else {
    await kvSet(LOGIN_ATTEMPTS_RES, userId, { count: rec.count + 1, firstAttemptAt: rec.firstAttemptAt }, LOCKOUT_WINDOW_MS);
  }
}

export async function clearLoginAttempts(userId: string): Promise<void> {
  await kvDelete(LOGIN_ATTEMPTS_RES, userId);
}

export interface Session {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

// Seeds SHELL_USERS (identity/role/pin, from rbac.ts) into KV on first
// boot. rbac.ts stays the single source of truth for who the actual
// people/roles are -- this just makes that list durable and loginable
// instead of a hardcoded array. Safe to call every boot: only writes
// users that do not exist yet, so a PIN changed later via the API is
// never clobbered by a redeploy.
export async function seedUsersIfEmpty(): Promise<void> {
  for (const u of SHELL_USERS) {
    const existing = await kvGet<User>(USERS_RES, u.id);
    if (!existing) await kvSet(USERS_RES, u.id, u);
  }
}

export async function getUserById(id: string): Promise<User | null> {
  const fromKv = await kvGet<User>(USERS_RES, id);
  if (fromKv) return fromKv;
  // Fallback to the static rbac.ts list -- covers the brief window before
  // seedUsersIfEmpty() has run, and any deployment that has not opened a
  // KV connection yet.
  return findUser(id) ?? null;
}

export async function listUsers(): Promise<User[]> {
  return kvList<User>(USERS_RES);
}

export async function setUserPin(id: string, pin: string): Promise<User | null> {
  const u = await getUserById(id);
  if (!u) return null;
  const updated: User = { ...u, pin };
  await kvSet(USERS_RES, id, updated);
  return updated;
}

function randomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export interface CreateUserInput {
  name: string;
  role: Role;
  email?: string;
  phone?: string;
  assigned_accounts?: string[];
}

export interface UpdateUserInput {
  name?: string;
  role?: Role;
  email?: string;
  phone?: string;
  assigned_accounts?: string[];
  custom_overrides?: { added: Atom[]; removed: Atom[] };
}

// Real create-user path -- Phase 2 of the Cockpit plan. The Team tab's
// old renderTeam()/togglePerm() only ever mutated an in-memory fixture;
// this is what makes "add a real login for Christian/María/José" an
// actual action instead of a UI illusion. Role is validated against the
// real Role union (ROLE_ATOMS keys) -- an unknown role string is rejected,
// not silently stored, since the atom/role check is the real security
// boundary per this file's own header comment.
export async function createUser(input: CreateUserInput): Promise<{ user: User } | { error: string }> {
  const name = (input.name || "").trim();
  if (!name) return { error: "name_required" };
  if (!Object.prototype.hasOwnProperty.call(ROLE_ATOMS, input.role)) {
    return { error: "invalid_role" };
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24) || "user";
  let id = "u_" + slug;
  // avoid id collisions with an existing user
  const existingIds = new Set((await listUsers()).map((u) => u.id));
  if (existingIds.has(id)) id = id + "-" + nanoid(4).toLowerCase();
  const user: User = {
    id,
    name,
    role: input.role,
    email: input.email,
    phone: input.phone,
    assigned_accounts: input.assigned_accounts || [],
    is_master: false,
    pin: randomPin(),
  };
  await kvSet(USERS_RES, id, user);
  return { user };
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<{ user: User } | { error: string }> {
  const u = await getUserById(id);
  if (!u) return { error: "not_found" };
  if (input.role !== undefined && !Object.prototype.hasOwnProperty.call(ROLE_ATOMS, input.role)) {
    return { error: "invalid_role" };
  }
  const allAtoms = new Set<Atom>(Object.values(ROLE_ATOMS).flat());
  if (input.custom_overrides) {
    for (const a of [...input.custom_overrides.added, ...input.custom_overrides.removed]) {
      if (!allAtoms.has(a)) return { error: "invalid_atom: " + a };
    }
  }
  const updated: User = {
    ...u,
    name: input.name !== undefined ? input.name : u.name,
    role: input.role !== undefined ? input.role : u.role,
    email: input.email !== undefined ? input.email : u.email,
    phone: input.phone !== undefined ? input.phone : u.phone,
    assigned_accounts: input.assigned_accounts !== undefined ? input.assigned_accounts : u.assigned_accounts,
    custom_overrides: input.custom_overrides !== undefined ? input.custom_overrides : u.custom_overrides,
  };
  await kvSet(USERS_RES, id, updated);
  return { user: updated };
}

export async function verifyPin(userId: string, pin: string): Promise<User | null> {
  const u = await getUserById(userId);
  if (!u) return null;
  if (u.pin !== pin) return null;
  return u;
}

export async function createSession(userId: string): Promise<string> {
  const token = nanoid(40);
  const now = Date.now();
  const session: Session = { token, userId, createdAt: now, expiresAt: now + SESSION_TTL_MS };
  await kvSet(SESSIONS_RES, token, session, SESSION_TTL_MS);
  return token;
}

export async function userFromToken(token: string): Promise<User | null> {
  if (!token) return null;
  const session = await kvGet<Session>(SESSIONS_RES, token);
  if (!session || session.expiresAt < Date.now()) return null;
  return getUserById(session.userId);
}

export async function deleteSession(token: string): Promise<void> {
  await kvDelete(SESSIONS_RES, token);
}

export function bearerToken(req: Request): string {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}
