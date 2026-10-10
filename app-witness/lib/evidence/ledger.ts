import { canonicalJson } from "./canonical";
import { sha256Hex } from "./hash";
import type { ChainReport, LedgerEntry, LedgerEntryBody } from "./types";

export const GENESIS_HASH = "0".repeat(64);

function hashBody(body: LedgerEntryBody): Promise<string> {
  return sha256Hex(canonicalJson(body));
}

/** Builds the entry that follows `prev` (or the first entry when `prev` is null). */
export async function nextEntry(
  prev: LedgerEntry | null,
  body: Omit<LedgerEntryBody, "seq" | "prevHash">,
): Promise<LedgerEntry> {
  const full: LedgerEntryBody = {
    ...body,
    seq: prev ? prev.seq + 1 : 0,
    prevHash: prev ? prev.entryHash : GENESIS_HASH,
  };
  return { ...full, entryHash: await hashBody(full) };
}

/** Checks sequence, hash links and every entry's own hash, reporting all problems. */
export async function verifyChain(entries: LedgerEntry[]): Promise<ChainReport> {
  const problems: ChainReport["problems"] = [];
  for (let i = 0; i < entries.length; i++) {
    const { entryHash, ...body } = entries[i];
    const expectedPrev = i === 0 ? GENESIS_HASH : entries[i - 1].entryHash;
    if (body.seq !== i) problems.push({ seq: body.seq, reason: "seq-gap" });
    if (body.prevHash !== expectedPrev) {
      problems.push({ seq: body.seq, reason: "prevHash-mismatch" });
    }
    if ((await hashBody(body)) !== entryHash) {
      problems.push({ seq: body.seq, reason: "entryHash-mismatch" });
    }
  }
  return { ok: problems.length === 0, problems };
}
