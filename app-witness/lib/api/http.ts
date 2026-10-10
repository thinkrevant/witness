// Server-only helpers shared by the JSON API routes.
import { RingAuthError, RingMediaUnavailable } from "@/lib/ring/client";
import { effectiveToken } from "@/lib/sources/source";
import type { Settings } from "@/lib/store/store";

/** Parses a JSON object body; null when the body is missing, invalid or not an object. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Refuses a state-changing request another website could make the browser send. The body must be
 * declared as JSON (a cross-site form cannot do that without a CORS preflight, which this app never
 * grants), and an Origin header, when present, must name this server's own host.
 */
export function rejectCrossSite(req: Request): Response | null {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return type === "application/json" && isSameOrigin(req) ? null : forbidden();
}

/**
 * For a state-changing request without a body (e.g. DELETE): an Origin header, when present, must
 * name this server's own host. A cross-site page cannot send a DELETE without a CORS preflight.
 */
export function rejectForeignOrigin(req: Request): Response | null {
  return isSameOrigin(req) ? null : forbidden();
}

/** True when there is no Origin header, or it names this server's own host. */
function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  const host = req.headers.get("host") ?? new URL(req.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function forbidden(): Response {
  return Response.json({ error: "forbidden" }, { status: 403 });
}

export function badRequest(error = "bad-request"): Response {
  return Response.json({ error }, { status: 400 });
}

export function notFound(): Response {
  return Response.json({ error: "not-found" }, { status: 404 });
}

/** Error text safe for the client: the active Ring token is never included. */
function redacted(err: unknown, settings: Settings): string {
  const message = err instanceof Error ? err.message : String(err);
  const token = effectiveToken(settings);
  return token ? message.split(token).join("[token]") : message;
}

/**
 * Maps a failure from the event source:
 * - an expired token becomes 401 "reconnect-ring";
 * - footage the token cannot reach (e.g. before its consent time) becomes 422 "footage-unavailable";
 * - anything else becomes 502 with `error`.
 * Messages never contain the token.
 */
export function sourceFailure(err: unknown, error: string, settings: Settings): Response {
  if (err instanceof RingAuthError) {
    return Response.json({ error: "reconnect-ring" }, { status: 401 });
  }
  if (err instanceof RingMediaUnavailable) {
    return Response.json(
      { error: "footage-unavailable", message: redacted(err, settings) },
      { status: 422 },
    );
  }
  return Response.json({ error, message: redacted(err, settings) }, { status: 502 });
}
