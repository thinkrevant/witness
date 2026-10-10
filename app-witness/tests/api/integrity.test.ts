import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getIncidents, POST as postIncident } from "@/app/api/incidents/route";
import { GET as getMedia } from "@/app/api/media/[...file]/route";
import { createSession } from "@/lib/auth/session";
import { nextEntry } from "@/lib/evidence/ledger";
import type { LedgerEntry, LedgerEntryBody } from "@/lib/evidence/types";
import { createDemoSource } from "@/lib/sources/demo-source";
import { getStore } from "@/lib/store/store";
import { fakeTsr } from "../helpers/tsr";

interface IncidentsBody {
  entries: LedgerEntry[];
  chain: { ok: boolean };
  mediaChecks: { file: string; ok: boolean }[];
  suspectSeqs: number[];
  status: { seq: number; intact: boolean; timestamp: string }[];
}

let dir: string;
let cookie: string;
let original: LedgerEntry[];
const prevDir = process.env.WITNESS_DATA_DIR;
const prevTsa = process.env.WITNESS_TSA;
const prevEnvToken = process.env.RING_ACCESS_TOKEN;

function req(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://localhost${url}`, { ...init, headers });
}

async function incidents(): Promise<IncidentsBody> {
  const res = await getIncidents(req("/api/incidents"));
  expect(res.status).toBe(200);
  return res.json();
}

function media(file: string, headers?: HeadersInit) {
  const segments = file.split("/");
  return getMedia(req(`/api/media/${file}`, { headers }), { params: Promise.resolve({ file: segments }) });
}

const setLedger = (ledger: LedgerEntry[]) => getStore().update((d) => ({ ...d, ledger }));

/** The entry without the fields nextEntry sets, so it can be sealed again. */
function bodyOf(e: LedgerEntry): Omit<LedgerEntryBody, "seq" | "prevHash"> {
  const body: Partial<LedgerEntry> = { ...e };
  delete body.seq;
  delete body.prevHash;
  delete body.entryHash;
  return body as Omit<LedgerEntryBody, "seq" | "prevHash">;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "witness-integrity-"));
  process.env.WITNESS_DATA_DIR = dir;
  process.env.WITNESS_TSA = "off";
  delete process.env.RING_ACCESS_TOKEN;
  cookie = `db_s=${createSession()}`;
  const events = (await createDemoSource().listEvents()).sort((a, b) => a.start - b.start);
  for (const ev of events) {
    const res = await postIncident(
      req("/api/incidents", { method: "POST", body: JSON.stringify({ eventId: ev.id, note: "At the door" }) }),
    );
    expect(res.status).toBe(200);
  }
  original = (await getStore().read()).ledger;
});

afterAll(async () => {
  if (prevDir === undefined) delete process.env.WITNESS_DATA_DIR;
  else process.env.WITNESS_DATA_DIR = prevDir;
  if (prevTsa === undefined) delete process.env.WITNESS_TSA;
  else process.env.WITNESS_TSA = prevTsa;
  if (prevEnvToken !== undefined) process.env.RING_ACCESS_TOKEN = prevEnvToken;
  await rm(dir, { recursive: true, force: true });
});

describe("GET /api/incidents integrity", () => {
  it("reports every record intact, every file checked, and failed timestamps", async () => {
    const body = await incidents();
    expect(body.entries).toHaveLength(2);
    expect(body.chain.ok).toBe(true);
    expect(body.mediaChecks).toHaveLength(4);
    expect(body.mediaChecks.every((c) => c.ok)).toBe(true);
    expect(body.suspectSeqs).toEqual([]);
    expect(body.status).toEqual([
      { seq: 0, intact: true, timestamp: "failed" },
      { seq: 1, intact: true, timestamp: "failed" },
    ]);
  });

  it("shows Timestamped only for a token that covers the entry's current hash", async () => {
    const store = getStore();
    const tsrFile = await store.writeTsa(0, fakeTsr(original[0].entryHash));
    await store.update((d) => ({
      ...d,
      tsa: [...d.tsa, { seq: 0, tsrFile, status: "ok", requestedAt: new Date().toISOString() }],
    }));
    expect((await incidents()).status[0]).toEqual({ seq: 0, intact: true, timestamp: "covers-record" });

    // Rewrite incident #1 and re-seal the whole chain: the chain verifies, the timestamp does not.
    const resealed: LedgerEntry[] = [];
    for (const e of original) {
      const body = bodyOf(e);
      resealed.push(await nextEntry(resealed.at(-1) ?? null, e.seq === 0 ? { ...body, note: "rewritten" } : body));
    }
    await setLedger(resealed);
    try {
      const body = await incidents();
      expect(body.chain.ok).toBe(true);
      expect(body.suspectSeqs).toEqual([0]);
      expect(body.status[0]).toEqual({ seq: 0, intact: false, timestamp: "does-not-match" });
      expect(body.status[1].intact).toBe(true);
    } finally {
      await setLedger(original);
    }
  });

  it("marks the suspect seq when an entry is edited without re-sealing", async () => {
    await setLedger(original.map((e, i) => (i === 1 ? { ...e, note: "changed later" } : e)));
    try {
      const body = await incidents();
      expect(body.chain.ok).toBe(false);
      expect(body.suspectSeqs).toEqual([1]);
      expect(body.status.map((s) => s.intact)).toEqual([true, false]);
    } finally {
      await setLedger(original);
    }
  });

  it("flags a tampered media file: failing check, entry not intact, and the media route refuses it", async () => {
    const target = original[1].media.find((m) => m.kind === "snapshot")!;
    // Served (and cached as verified) before the change.
    expect((await media(target.file)).status).toBe(200);

    await writeFile(path.join(dir, target.file), new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));

    const body = await incidents();
    expect(body.chain.ok).toBe(true);
    expect(body.mediaChecks.filter((c) => !c.ok).map((c) => c.file)).toEqual([target.file]);
    expect(body.status.map((s) => s.intact)).toEqual([true, false]);

    const refused = await media(target.file);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "integrity" });
    expect((await media(target.file, { range: "bytes=0-1" })).status).toBe(409);

    const clip = original[1].media.find((m) => m.kind === "clip")!;
    expect((await media(clip.file, { range: "bytes=0-99" })).status).toBe(206);
  });
});
