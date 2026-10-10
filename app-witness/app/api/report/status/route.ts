import { requireSession } from "@/lib/auth/session";
import { verifyChain } from "@/lib/evidence/ledger";
import { checkTimestamps, readTimestampFiles, recordSuspects, verifyMediaFiles } from "@/lib/report/manifest";
import { getStore } from "@/lib/store/store";

/** What the report page shows before a download: is there a case, how many incidents, and do they all check out. */
export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;

  const store = getStore();
  const data = await store.read();
  const chain = await verifyChain(data.ledger);
  const timestamps = checkTimestamps(data.tsa, data.ledger, await readTimestampFiles(store, data.tsa, data.ledger));
  return Response.json({
    hasCase: data.case !== null,
    incidents: data.ledger.length,
    chain,
    mediaChecks: await verifyMediaFiles(store, data.ledger),
    suspectSeqs: [...recordSuspects(chain, timestamps)].sort((a, b) => a - b),
  });
}
