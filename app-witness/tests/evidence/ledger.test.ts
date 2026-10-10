import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/evidence/canonical";
import { sha256Hex } from "@/lib/evidence/hash";
import { GENESIS_HASH, nextEntry, verifyChain } from "@/lib/evidence/ledger";
import type { LedgerEntry, LedgerEntryBody } from "@/lib/evidence/types";

type NewBody = Omit<LedgerEntryBody, "seq" | "prevHash">;

function body(n: number): NewBody {
  return {
    incidentId: `incident-${n}`,
    ringEventId: `event-${n}`,
    deviceId: "device-1",
    eventStart: 1000 * n,
    eventEnd: 1000 * n + 500,
    media: [
      {
        kind: "snapshot",
        sha256: "a".repeat(64),
        bytes: 10,
        contentType: "image/jpeg",
        file: `snap-${n}.jpg`,
        ringMediaTimestamp: null,
        ringMediaDuration: null,
        ringRequestId: null,
        retrievedAt: "2026-10-10T00:00:00.000Z",
      },
    ],
    clipUnavailable: false,
    note: `note ${n}`,
    loggedAt: "2026-10-10T00:00:00.000Z",
    source: "demo",
  };
}

async function buildChain(count: number): Promise<LedgerEntry[]> {
  const entries: LedgerEntry[] = [];
  let prev: LedgerEntry | null = null;
  for (let i = 0; i < count; i++) {
    prev = await nextEntry(prev, body(i));
    entries.push(prev);
  }
  return entries;
}

describe("sha256Hex", () => {
  it("hashes a string (UTF-8) to lowercase hex", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes raw bytes identically to the equivalent string", async () => {
    const bytes = new TextEncoder().encode("abc");
    expect(await sha256Hex(bytes)).toBe(await sha256Hex("abc"));
  });
});

describe("canonicalJson", () => {
  it("sorts keys recursively, keeps array order, emits no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: "é" } })).toBe(
      '{"a":{"c":"é","d":[2,1]},"b":1}',
    );
  });

  it("omits undefined object properties and sorts keys inside arrays", () => {
    expect(canonicalJson({ z: undefined, y: [{ b: 1, a: 2 }], x: null })).toBe(
      '{"x":null,"y":[{"a":2,"b":1}]}',
    );
  });
});

describe("nextEntry", () => {
  it("starts the chain at seq 0 with the genesis prevHash", async () => {
    const first = await nextEntry(null, body(0));
    expect(GENESIS_HASH).toBe("0".repeat(64));
    expect(first.seq).toBe(0);
    expect(first.prevHash).toBe(GENESIS_HASH);
  });

  it("links the next entry to the previous entryHash", async () => {
    const first = await nextEntry(null, body(0));
    const second = await nextEntry(first, body(1));
    expect(second.seq).toBe(1);
    expect(second.prevHash).toBe(first.entryHash);
  });

  it("computes entryHash over every field except entryHash", async () => {
    const entry = await nextEntry(null, body(0));
    const { entryHash, ...rest } = entry;
    expect(entryHash).toBe(await sha256Hex(canonicalJson(rest)));
  });
});

describe("verifyChain", () => {
  it("accepts a valid chain", async () => {
    const entries = await buildChain(3);
    expect(await verifyChain(entries)).toEqual({ ok: true, problems: [] });
  });

  it("accepts an empty chain", async () => {
    expect(await verifyChain([])).toEqual({ ok: true, problems: [] });
  });

  it("flags an entry whose content was edited", async () => {
    const entries = await buildChain(3);
    entries[1] = { ...entries[1], note: "tampered" };
    const report = await verifyChain(entries);
    expect(report.ok).toBe(false);
    expect(report.problems).toContainEqual({
      seq: 1,
      reason: "entryHash-mismatch",
    });
  });

  it("flags a deleted entry at the following position", async () => {
    const entries = await buildChain(3);
    entries.splice(1, 1);
    const report = await verifyChain(entries);
    expect(report.ok).toBe(false);
    const atSeq2 = report.problems.filter((p) => p.seq === 2);
    expect(atSeq2.length).toBeGreaterThan(0);
    for (const p of atSeq2) {
      expect(["seq-gap", "prevHash-mismatch"]).toContain(p.reason);
    }
  });

  it("flags reordered entries", async () => {
    const entries = await buildChain(3);
    [entries[1], entries[2]] = [entries[2], entries[1]];
    expect((await verifyChain(entries)).ok).toBe(false);
  });

  it("flags a first entry that does not link to genesis", async () => {
    const entries = await buildChain(2);
    entries.shift();
    const report = await verifyChain(entries);
    expect(report.ok).toBe(false);
    expect(report.problems).toContainEqual({ seq: 1, reason: "seq-gap" });
    expect(report.problems).toContainEqual({
      seq: 1,
      reason: "prevHash-mismatch",
    });
  });

  it("reports every problem, not just the first", async () => {
    const entries = await buildChain(3);
    entries[0] = { ...entries[0], note: "x" };
    entries[2] = { ...entries[2], note: "y" };
    const report = await verifyChain(entries);
    const hashProblems = report.problems.filter(
      (p) => p.reason === "entryHash-mismatch",
    );
    expect(hashProblems.map((p) => p.seq)).toEqual([0, 2]);
  });
});
