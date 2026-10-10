// Server-only: the atomic "Log as violation" operation.
import { randomUUID } from "node:crypto";
import { nextEntry } from "@/lib/evidence/ledger";
import type { LedgerEntry, MediaKind, MediaRecord } from "@/lib/evidence/types";
import { RingMediaUnavailable } from "@/lib/ring/client";
import type { MediaResult, RingEvent } from "@/lib/ring/client";
import type { EventSource } from "@/lib/sources/source";
import type { Store } from "@/lib/store/store";
import { requestTimestamp } from "@/lib/timestamp/tsa";

const DEFAULT_EVENT_MS = 30_000;
const EXT: Record<MediaKind, "jpg" | "mp4"> = { snapshot: "jpg", clip: "mp4" };

interface Downloaded {
  kind: MediaKind;
  media: MediaResult;
  retrievedAt: string;
}

export interface SealArgs {
  store: Store;
  source: EventSource;
  event: RingEvent;
  note: string;
  now?: () => Date;
  /** Best-effort RFC 3161 timestamp of the entry hash. Defaults to FreeTSA; tests pass a stub. */
  timestamp?: (entryHash: string) => Promise<{ status: "ok" | "failed"; tsr: Uint8Array | null }>;
}

/**
 * Downloads the event's media, then appends one ledger entry for it.
 * Nothing is written to disk unless every required download succeeded.
 * Sealing an event twice returns the existing entry with `alreadySealed: true`.
 */
export async function sealIncident(
  args: SealArgs,
): Promise<{ entry: LedgerEntry; alreadySealed: boolean }> {
  const { store, source, event, note } = args;
  const now = args.now ?? (() => new Date());
  const timestamp = args.timestamp ?? requestTimestamp;

  // Early check, to avoid pointless downloads.
  const existing = (await store.read()).ledger.find((e) => e.ringEventId === event.id);
  if (existing) return { entry: existing, alreadySealed: true };

  // Bytes stay in memory until both downloads are done.
  const downloads: Downloaded[] = [];
  const snapshot = await source.snapshot(event);
  downloads.push({ kind: "snapshot", media: snapshot, retrievedAt: new Date().toISOString() });

  let clipUnavailable = false;
  try {
    const clip = await source.clip(event);
    downloads.push({ kind: "clip", media: clip, retrievedAt: new Date().toISOString() });
  } catch (err) {
    if (!(err instanceof RingMediaUnavailable)) throw err;
    clipUnavailable = true;
  }

  const records: MediaRecord[] = [];
  for (const d of downloads) {
    const { file, sha256 } = await store.writeMedia(d.media.bytes, EXT[d.kind]);
    records.push({
      kind: d.kind,
      sha256,
      bytes: d.media.bytes.byteLength,
      contentType: d.media.contentType,
      file,
      ringMediaTimestamp: d.media.mediaTimestamp,
      ringMediaDuration: d.media.mediaDuration,
      ringRequestId: d.media.requestId,
      retrievedAt: d.retrievedAt,
    });
  }

  let sealed: LedgerEntry | undefined;
  let alreadySealed = false;
  await store.update(async (data) => {
    // Re-check inside the lock: a concurrent request may have sealed this event meanwhile.
    const dup = data.ledger.find((e) => e.ringEventId === event.id);
    if (dup) {
      sealed = dup;
      alreadySealed = true;
      return data;
    }
    const last = data.ledger.length > 0 ? data.ledger[data.ledger.length - 1] : null;
    const entry = await nextEntry(last, {
      incidentId: randomUUID(),
      ringEventId: event.id,
      deviceId: event.deviceId,
      eventStart: event.start,
      eventEnd: event.end ?? event.start + DEFAULT_EVENT_MS,
      media: records,
      clipUnavailable,
      note,
      loggedAt: now().toISOString(),
      source: source.kind,
    });
    sealed = entry;
    return { ...data, ledger: [...data.ledger, entry] };
  });

  const entry = sealed!;
  if (!alreadySealed) await recordTimestamp(store, entry, timestamp);
  return { entry, alreadySealed };
}

/** Never throws: a missing timestamp must not undo or block a sealed entry. */
async function recordTimestamp(
  store: Store,
  entry: LedgerEntry,
  timestamp: NonNullable<SealArgs["timestamp"]>,
): Promise<void> {
  try {
    const requestedAt = new Date().toISOString();
    let result: Awaited<ReturnType<typeof timestamp>>;
    try {
      result = await timestamp(entry.entryHash);
    } catch {
      result = { status: "failed", tsr: null };
    }
    const tsrFile =
      result.status === "ok" && result.tsr ? await store.writeTsa(entry.seq, result.tsr) : null;
    const status = tsrFile ? "ok" : "failed";
    await store.update((data) => ({
      ...data,
      tsa: [...(data.tsa ?? []), { seq: entry.seq, tsrFile, status, requestedAt }],
    }));
  } catch {
    // Best effort only.
  }
}
