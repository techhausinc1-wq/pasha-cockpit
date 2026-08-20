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

import { getKv, kvGet, kvSet, nanoid } from "./kv.ts";
import { findUser, SHELL_USERS, type User } from "./rbac.ts";

const USERS_RES = "users";
const SESSIONS_RES = "sessions";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
  const kv = await getKv();
  const out: User[] = [];
  const prefix = ["pasha", USERS_RES];
  for await (const entry of kv.list<User>({ prefix })) out.push(entry.value);
  return out;
}

export async function setUserPin(id: string, pin: string): Promise<User | null> {
  const u = await getUserById(id);
  if (!u) return null;
  const updated: User = { ...u, pin };
  await kvSet(USERS_RES, id, updated);
  return updated;
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
  const kv = await getKv();
  const key = ["pasha", SESSIONS_RES, token];
  await kv.delete(key);
}

export function bearerToken(req: Request): string {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}
