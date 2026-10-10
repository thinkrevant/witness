import { sha256Hex } from "@/lib/evidence/hash";
import { verifyChain } from "@/lib/evidence/ledger";
import { suspectSeqs } from "@/lib/evidence/verify";
import type { ChainReport, LedgerEntry } from "@/lib/evidence/types";
import type { CaseInfo, Store, StoreData, TsaRecord } from "@/lib/store/store";
import { tsrCoversHash } from "@/lib/timestamp/tsa";

export interface MediaCheck {
  file: string;
  expected: string;
  /** The SHA-256 of the file as it is now, or "missing" when it cannot be read. */
  actual: string;
  ok: boolean;
}

/**
 * Whether an entry's independent timestamp names its current entry hash:
 * - "covers-record": the stored token was issued for this exact entry hash;
 * - "does-not-match": the token names another hash, so the entry changed after it was timestamped;
 * - "failed": no token could be obtained or read;
 * - "none": no timestamp was requested.
 */
export type TimestampCheck = "covers-record" | "does-not-match" | "failed" | "none";

export interface TimestampInfo {
  seq: number;
  status: TsaRecord["status"];
  requestedAt: string;
  /** Path inside the evidence bundle, when a timestamp response was stored. */
  file: string | null;
  check: Exclude<TimestampCheck, "none">;
}

/** A stored timestamp response, by ledger seq. */
export interface TsaFile {
  seq: number;
  bytes: Uint8Array;
}

export interface Manifest {
  app: "Witness";
  version: 1;
  generatedAt: string;
  case: CaseInfo;
  chain: ChainReport;
  /** Anchors the ledger: a later report with fewer entries or another head hash shows truncation. */
  head: { count: number; entryHash: string | null };
  entries: LedgerEntry[];
  timestamps: TimestampInfo[];
  mediaChecks: MediaCheck[];
}

/** Re-reads every sealed media file and compares its SHA-256 with the ledger. */
export async function verifyMediaFiles(store: Store, entries: LedgerEntry[]): Promise<MediaCheck[]> {
  const checks: MediaCheck[] = [];
  for (const entry of entries) {
    for (const media of entry.media) {
      let actual: string;
      try {
        actual = await sha256Hex(await store.readMedia(media.file));
      } catch {
        actual = "missing";
      }
      checks.push({ file: media.file, expected: media.sha256, actual, ok: actual === media.sha256 });
    }
  }
  return checks;
}

export { suspectSeqs };

export function tsaBundlePath(seq: number): string {
  return `timestamps/${seq}.tsr`;
}

/** The latest timestamp record for each ledger entry that has one. */
export function latestTimestamps(tsa: TsaRecord[], entries: LedgerEntry[]): TsaRecord[] {
  return entries.flatMap((e) => tsa.findLast((t) => t.seq === e.seq) ?? []);
}

/** Reads the stored response of each entry's latest successful timestamp; unreadable files are skipped. */
export async function readTimestampFiles(
  store: Store,
  tsa: TsaRecord[] | undefined,
  entries: LedgerEntry[],
): Promise<TsaFile[]> {
  const files: TsaFile[] = [];
  for (const t of latestTimestamps(tsa ?? [], entries)) {
    if (t.status !== "ok" || !t.tsrFile) continue;
    try {
      files.push({ seq: t.seq, bytes: await store.readTsa(t.tsrFile) });
    } catch {
      // A lost timestamp file only removes the optional third-party proof.
    }
  }
  return files;
}

/** Each entry's latest timestamp record, checked against the entry's current hash. */
export function checkTimestamps(
  tsa: TsaRecord[] | undefined,
  entries: LedgerEntry[],
  files: TsaFile[],
): TimestampInfo[] {
  const bySeq = new Map(entries.map((e) => [e.seq, e]));
  return latestTimestamps(tsa ?? [], entries).map((t) => {
    const bytes = t.status === "ok" ? files.find((f) => f.seq === t.seq)?.bytes : undefined;
    const check: TimestampInfo["check"] = !bytes
      ? "failed"
      : tsrCoversHash(bytes, bySeq.get(t.seq)!.entryHash)
        ? "covers-record"
        : "does-not-match";
    return {
      seq: t.seq,
      status: t.status,
      requestedAt: t.requestedAt,
      file: bytes ? tsaBundlePath(t.seq) : null,
      check,
    };
  });
}

/** The timestamp check for one entry: "none" when it has no timestamp record. */
export function timestampCheckFor(timestamps: TimestampInfo[], seq: number): TimestampCheck {
  return timestamps.find((t) => t.seq === seq)?.check ?? "none";
}

/**
 * Seqs that must not be relied on: those `suspectSeqs` finds in the chain, plus any entry whose
 * independent timestamp names a different hash (it was changed and re-sealed after being timestamped).
 */
export function recordSuspects(chain: ChainReport, timestamps: TimestampInfo[]): Set<number> {
  const seqs = suspectSeqs(chain);
  for (const t of timestamps) if (t.check === "does-not-match") seqs.add(t.seq);
  return seqs;
}

export function manifestSuspects(m: Manifest): Set<number> {
  return recordSuspects(m.chain, m.timestamps);
}

/** Async because the chain is re-verified (hashing uses Web Crypto). */
export async function buildManifest(
  data: StoreData,
  mediaChecks: MediaCheck[],
  now: Date,
  tsaFiles: TsaFile[],
): Promise<Manifest> {
  if (!data.case) throw new Error("A report needs the case details first");
  const entries = data.ledger;
  const last = entries.at(-1);
  return {
    app: "Witness",
    version: 1,
    generatedAt: now.toISOString(),
    case: data.case,
    chain: await verifyChain(entries),
    head: { count: entries.length, entryHash: last ? last.entryHash : null },
    entries,
    timestamps: checkTimestamps(data.tsa, entries, tsaFiles),
    mediaChecks,
  };
}
