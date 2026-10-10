import { badRequest, notFound, readJsonObject, rejectCrossSite, sourceFailure } from "@/lib/api/http";
import { requireSession } from "@/lib/auth/session";
import { verifyChain } from "@/lib/evidence/ledger";
import {
  checkTimestamps,
  readTimestampFiles,
  recordSuspects,
  timestampCheckFor,
  verifyMediaFiles,
} from "@/lib/report/manifest";
import { sealIncident, type SealArgs } from "@/lib/seal/seal";
import { getSource } from "@/lib/sources/source";
import { getStore } from "@/lib/store/store";

const MAX_NOTE_LENGTH = 5000;

/** WITNESS_TSA=off skips the external timestamp (tests, offline checks); it is then recorded as failed. */
function timestampOverride(): SealArgs["timestamp"] {
  if (process.env.WITNESS_TSA !== "off") return undefined;
  return async () => ({ status: "failed", tsr: null });
}

/**
 * The ledger with every check the report makes: the chain, each media file re-hashed, and each
 * timestamp checked against its entry's current hash. `status` says per entry whether it is
 * intact (not suspect and all its files match) and what its timestamp shows.
 */
export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;

  const store = getStore();
  const { ledger, tsa } = await store.read();
  const chain = await verifyChain(ledger);
  const mediaChecks = await verifyMediaFiles(store, ledger);
  const timestamps = checkTimestamps(tsa, ledger, await readTimestampFiles(store, tsa, ledger));
  const suspect = recordSuspects(chain, timestamps);
  const fileOk = (file: string, sha256: string) =>
    mediaChecks.some((c) => c.file === file && c.expected === sha256 && c.ok);

  return Response.json({
    entries: ledger,
    chain,
    mediaChecks,
    suspectSeqs: [...suspect].sort((a, b) => a - b),
    status: ledger.map((e) => ({
      seq: e.seq,
      intact: !suspect.has(e.seq) && e.media.every((m) => fileOk(m.file, m.sha256)),
      timestamp: timestampCheckFor(timestamps, e.seq),
    })),
  });
}

export async function POST(req: Request) {
  const forbidden = rejectCrossSite(req);
  if (forbidden) return forbidden;
  const denied = requireSession(req);
  if (denied) return denied;

  const body = await readJsonObject(req);
  const eventId = body?.eventId;
  const note = body?.note ?? "";
  if (typeof eventId !== "string" || eventId === "" || typeof note !== "string") return badRequest();
  if (note.length > MAX_NOTE_LENGTH) return badRequest("note-too-long");

  const store = getStore();
  const { settings } = await store.read();
  const source = await getSource(settings);
  try {
    const event = (await source.listEvents()).find((ev) => ev.id === eventId);
    if (!event) return notFound();
    const result = await sealIncident({
      store,
      source,
      event,
      note: note.trim(),
      timestamp: timestampOverride(),
    });
    return Response.json(result);
  } catch (err) {
    return sourceFailure(err, "seal-failed", settings);
  }
}
