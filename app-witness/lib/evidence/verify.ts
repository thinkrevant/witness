// Pure verification logic, safe to run in the browser: no server-side imports.
import { sha256Hex } from "./hash";
import type { ChainReport, LedgerEntry, MediaKind } from "./types";

export type VerifyResult =
  | { status: "match"; seq: number; kind: MediaKind; loggedAt: string }
  | { status: "match-broken-seal"; seq: number; kind: MediaKind; loggedAt: string }
  | { status: "no-match"; sha256: string };

/**
 * Ledger seqs that must not be relied on: an entry whose own hash fails, both sides of a broken
 * link, and an out-of-sequence entry. Their recorded fingerprints may themselves have been edited.
 */
export function suspectSeqs(chain: ChainReport): Set<number> {
  const seqs = new Set<number>();
  for (const p of chain.problems) {
    seqs.add(p.seq);
    if (p.reason === "prevHash-mismatch") seqs.add(p.seq - 1);
  }
  return seqs;
}

/**
 * Checks a file's SHA-256 against every sealed media fingerprint. A record in `suspect` (from
 * `suspectSeqs`, plus any whose timestamp names another hash) is never vouched for; an intact
 * record holding the same bytes is preferred.
 */
export async function verifyFileAgainstManifest(
  bytes: Uint8Array,
  entries: LedgerEntry[],
  suspect: Iterable<number> = [],
): Promise<VerifyResult> {
  const sha256 = await sha256Hex(bytes);
  const isSuspect = new Set(suspect);
  let broken: VerifyResult | null = null;
  for (const entry of entries) {
    for (const media of entry.media) {
      if (media.sha256 !== sha256) continue;
      if (!isSuspect.has(entry.seq)) {
        return { status: "match", seq: entry.seq, kind: media.kind, loggedAt: entry.loggedAt };
      }
      broken ??= { status: "match-broken-seal", seq: entry.seq, kind: media.kind, loggedAt: entry.loggedAt };
    }
  }
  return broken ?? { status: "no-match", sha256 };
}
