import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/evidence/hash";
import { nextEntry, verifyChain } from "@/lib/evidence/ledger";
import type { LedgerEntry, LedgerEntryBody, MediaRecord } from "@/lib/evidence/types";
import { suspectSeqs, verifyFileAgainstManifest } from "@/lib/evidence/verify";

const FIXTURES = path.join(process.cwd(), "fixtures", "playground");

async function media(kind: MediaRecord["kind"], bytes: Uint8Array, n: number): Promise<MediaRecord> {
  return {
    kind,
    sha256: await sha256Hex(bytes),
    bytes: bytes.length,
    contentType: kind === "snapshot" ? "image/jpeg" : "video/mp4",
    file: `media-${n}`,
    ringMediaTimestamp: null,
    ringMediaDuration: null,
    ringRequestId: null,
    retrievedAt: "2026-10-10T00:00:00.000Z",
  };
}

async function entryFor(prev: LedgerEntry | null, n: number, records: MediaRecord[]): Promise<LedgerEntry> {
  const body: Omit<LedgerEntryBody, "seq" | "prevHash"> = {
    incidentId: `incident-${n}`,
    ringEventId: `event-${n}`,
    deviceId: "device-1",
    eventStart: 1000 * n,
    eventEnd: 1000 * n + 500,
    media: records,
    clipUnavailable: false,
    note: `note ${n}`,
    loggedAt: `2026-10-10T0${n}:00:00.000Z`,
    source: "demo",
  };
  return nextEntry(prev, body);
}

async function setup() {
  const jpeg = new Uint8Array(await readFile(path.join(FIXTURES, "motion-1791622011263.jpg")));
  const mp4 = new Uint8Array(await readFile(path.join(FIXTURES, "vehicle-1791621888046.mp4")));
  const first = await entryFor(null, 0, [await media("snapshot", jpeg, 0)]);
  const second = await entryFor(first, 1, [await media("clip", mp4, 1)]);
  return { jpeg, mp4, entries: [first, second] };
}

describe("verifyFileAgainstManifest", () => {
  it("matches the sealed bytes to their record", async () => {
    const { jpeg, entries } = await setup();
    expect(await verifyFileAgainstManifest(jpeg, entries)).toEqual({
      status: "match",
      seq: 0,
      kind: "snapshot",
      loggedAt: entries[0].loggedAt,
    });
  });

  it("matches a clip to a later record", async () => {
    const { mp4, entries } = await setup();
    expect(await verifyFileAgainstManifest(mp4, entries, suspectSeqs(await verifyChain(entries)))).toMatchObject({
      status: "match",
      seq: 1,
      kind: "clip",
    });
  });

  it("does not match the same bytes with one byte flipped", async () => {
    const { jpeg, entries } = await setup();
    const edited = jpeg.slice();
    edited[100] ^= 0xff;
    expect(await verifyFileAgainstManifest(edited, entries)).toEqual({
      status: "no-match",
      sha256: await sha256Hex(edited),
    });
  });

  it("never vouches for a record whose seal is broken", async () => {
    const { jpeg, mp4, entries } = await setup();
    const tampered = entries.map((e, i) => (i === 0 ? { ...e, note: "edited later" } : e));
    const chain = await verifyChain(tampered);
    expect(chain.problems).toEqual([{ seq: 0, reason: "entryHash-mismatch" }]);
    expect(await verifyFileAgainstManifest(jpeg, tampered, suspectSeqs(chain))).toEqual({
      status: "match-broken-seal",
      seq: 0,
      kind: "snapshot",
      loggedAt: tampered[0].loggedAt,
    });
    // The other record's seal is still intact.
    expect(await verifyFileAgainstManifest(mp4, tampered, suspectSeqs(chain))).toMatchObject({ status: "match", seq: 1 });
  });

  it("prefers an intact record when the same bytes are held by a broken one too", async () => {
    const { jpeg, entries } = await setup();
    const dup = await entryFor(entries[1], 2, [await media("snapshot", jpeg, 2)]);
    const all = [entries[0], entries[1], dup];
    const tampered = all.map((e, i) => (i === 0 ? { ...e, note: "edited later" } : e));
    const chain = await verifyChain(tampered);
    expect(await verifyFileAgainstManifest(jpeg, tampered, suspectSeqs(chain))).toMatchObject({ status: "match", seq: 2 });
  });

  it("treats any seq it is given as suspect, such as one whose timestamp names another hash", async () => {
    const { jpeg, mp4, entries } = await setup();
    expect((await verifyChain(entries)).ok).toBe(true);
    expect(await verifyFileAgainstManifest(jpeg, entries, [0])).toMatchObject({ status: "match-broken-seal", seq: 0 });
    expect(await verifyFileAgainstManifest(mp4, entries, [0])).toMatchObject({ status: "match", seq: 1 });
  });
});

describe("suspectSeqs", () => {
  it("suspects the entry whose hash fails, both sides of a broken link, and a gap", () => {
    expect(
      [
        ...suspectSeqs({
          ok: false,
          problems: [
            { seq: 1, reason: "entryHash-mismatch" },
            { seq: 4, reason: "prevHash-mismatch" },
            { seq: 7, reason: "seq-gap" },
          ],
        }),
      ].sort(),
    ).toEqual([1, 3, 4, 7]);
  });
});
