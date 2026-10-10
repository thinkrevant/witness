import { badRequest, notFound, readJsonObject, rejectCrossSite, rejectForeignOrigin, sourceFailure } from "@/lib/api/http";
import { requireSession } from "@/lib/auth/session";
import { LIVE_MAX_SECONDS, rememberLiveSession, takeLiveSession } from "@/lib/live/sessions";
import { getSource } from "@/lib/sources/source";
import { getStore } from "@/lib/store/store";

const MAX_OFFER_LENGTH = 20_000;

/**
 * Starts a live view: relays the browser's SDP offer to Ring (WHEP) and returns Ring's answer.
 * Ring's session URL stays on the server; the browser gets an opaque id to stop it with.
 */
export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const forbidden = rejectCrossSite(req);
  if (forbidden) return forbidden;

  const offer = (await readJsonObject(req))?.offer;
  if (typeof offer !== "string" || !offer.startsWith("v=0") || offer.length > MAX_OFFER_LENGTH) {
    return badRequest("bad-offer");
  }

  const { settings } = await getStore().read();
  const source = await getSource(settings);
  if (!source.live) return Response.json({ error: "live-unavailable" }, { status: 409 });
  try {
    const { answerSdp, sessionUrl } = await source.live.start(offer);
    const sessionId = rememberLiveSession(sessionUrl, source.live);
    return Response.json({ answer: answerSdp, sessionId, maxSeconds: LIVE_MAX_SECONDS });
  } catch (err) {
    return sourceFailure(err, "live-failed", settings);
  }
}

/** Ends a live view early: DELETE /api/live?session=<id>. An unknown or already-stopped id is 404. */
export async function DELETE(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const forbidden = rejectForeignOrigin(req);
  if (forbidden) return forbidden;

  const id = new URL(req.url).searchParams.get("session");
  const session = id ? takeLiveSession(id) : null;
  if (!session) return notFound();
  try {
    await session.live.stop(session.sessionUrl);
    return Response.json({ stopped: true });
  } catch (err) {
    const { settings } = await getStore().read();
    return sourceFailure(err, "live-failed", settings);
  }
}
