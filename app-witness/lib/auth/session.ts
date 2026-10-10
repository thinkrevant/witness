import { randomBytes } from "node:crypto";

export const SESSION_COOKIE = "db_s";

declare global {
  var __witnessSessions: Set<string> | undefined;
}

/** Held on globalThis so Next dev-mode module duplication still sees one set of sessions. */
function sessions(): Set<string> {
  return (globalThis.__witnessSessions ??= new Set<string>());
}

export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  sessions().add(token);
  return token;
}

export function isSessionValid(token: string | undefined): boolean {
  return token !== undefined && sessions().has(token);
}

export function endSession(token: string): void {
  sessions().delete(token);
}

/** Ends every session except `keep` (used after a PIN change). */
export function endOtherSessions(keep: string | undefined): void {
  for (const token of sessions()) if (token !== keep) sessions().delete(token);
}

export function readSessionToken(req: Request): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Call first in every API route: a 401 Response when locked, otherwise null. */
export function requireSession(req: Request): Response | null {
  if (isSessionValid(readSessionToken(req))) return null;
  return Response.json({ error: "locked" }, { status: 401 });
}
