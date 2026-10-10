// Server-only: open live-view sessions. The Ring session URL stays here; the browser only gets an opaque id.
import { randomUUID } from "node:crypto";
import type { LiveView } from "@/lib/sources/source";

/** Ring ends a session after 30 s (battery) or 60 s (line-powered); 60 is the most a viewer can get. */
export const LIVE_MAX_SECONDS = 60;
/** Entries older than this are dropped: Ring has ended the session by then. */
const FORGET_AFTER_MS = (LIVE_MAX_SECONDS + 60) * 1000;

export interface LiveSession {
  sessionUrl: string;
  /** The source that opened the session, so it is stopped with the same token. */
  live: LiveView;
  startedAt: number;
}

declare global {
  var __witnessLiveSessions: Map<string, LiveSession> | undefined;
}

/** Held on globalThis so Next dev-mode module duplication still sees one map. */
function sessions(): Map<string, LiveSession> {
  return (globalThis.__witnessLiveSessions ??= new Map<string, LiveSession>());
}

function forgetExpired(now: number): void {
  for (const [id, s] of sessions()) if (now - s.startedAt > FORGET_AFTER_MS) sessions().delete(id);
}

/** Records an open session and returns its random id. */
export function rememberLiveSession(sessionUrl: string, live: LiveView, now = Date.now()): string {
  forgetExpired(now);
  const id = randomUUID();
  sessions().set(id, { sessionUrl, live, startedAt: now });
  return id;
}

/** Removes and returns the session, or null when the id is unknown (or already stopped). */
export function takeLiveSession(id: string, now = Date.now()): LiveSession | null {
  forgetExpired(now);
  const s = sessions().get(id);
  if (!s) return null;
  sessions().delete(id);
  return s;
}

/** Stops and forgets every open session (used when the app locks). Failures are ignored: Ring ends them soon anyway. */
export async function stopAllLiveSessions(): Promise<void> {
  const open = [...sessions().values()];
  sessions().clear();
  await Promise.allSettled(open.map((s) => s.live.stop(s.sessionUrl)));
}
