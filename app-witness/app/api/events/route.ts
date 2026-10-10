import { sourceFailure } from "@/lib/api/http";
import { requireSession } from "@/lib/auth/session";
import { getSource } from "@/lib/sources/source";
import { getStore } from "@/lib/store/store";

export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;

  const { settings, ledger } = await getStore().read();
  const source = await getSource(settings);
  try {
    const sealedIds = new Set(ledger.map((e) => e.ringEventId));
    const events = (await source.listEvents()).map((ev) => ({ ...ev, sealed: sealedIds.has(ev.id) }));
    return Response.json({ source: source.kind, events });
  } catch (err) {
    return sourceFailure(err, "events-failed", settings);
  }
}
