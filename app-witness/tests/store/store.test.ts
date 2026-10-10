import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/evidence/hash";
import type { LedgerEntry } from "@/lib/evidence/types";
import { createStore, getStore } from "@/lib/store/store";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "witness-store-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function entry(n: number): LedgerEntry {
  return {
    seq: n,
    prevHash: "0".repeat(64),
    incidentId: `incident-${n}`,
    ringEventId: `event-${n}`,
    deviceId: "device-1",
    eventStart: 1000 * n,
    eventEnd: 1000 * n + 500,
    media: [],
    clipUnavailable: false,
    note: "",
    loggedAt: "2026-10-10T00:00:00.000Z",
    source: "demo",
    entryHash: "f".repeat(64),
  };
}

describe("createStore", () => {
  it("reads defaults from a fresh store", async () => {
    const store = createStore(dir);
    expect(await store.read()).toEqual({
      case: null,
      settings: {
        ringToken: null,
        demoMode: true,
        pinHash: null,
        pinSalt: null,
      },
      ledger: [],
      tsa: [],
    });
  });

  it("serializes 20 concurrent updates without losing any", async () => {
    const store = createStore(dir);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.update((d) => ({ ...d, ledger: [...d.ledger, entry(i)] })),
      ),
    );
    const data = await store.read();
    expect(data.ledger).toHaveLength(20);
    expect(new Set(data.ledger.map((e) => e.seq)).size).toBe(20);
  });

  it("persists updates as pretty-printed JSON across store instances", async () => {
    await createStore(dir).update((d) => ({
      ...d,
      settings: { ...d.settings, demoMode: false },
    }));
    const raw = await readFile(path.join(dir, "store.json"), "utf8");
    expect(raw).toContain('\n  "settings"');
    expect((await createStore(dir).read()).settings.demoMode).toBe(false);
  });

  it("writes media content-addressed and round-trips the bytes", async () => {
    const store = createStore(dir);
    const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
    const { file, sha256 } = await store.writeMedia(bytes, "jpg");
    expect(sha256).toBe(await sha256Hex(bytes));
    expect(file).toBe(`media/${sha256}.jpg`);
    expect(Array.from(await store.readMedia(file))).toEqual(Array.from(bytes));
    // idempotent
    expect(await store.writeMedia(bytes, "jpg")).toEqual({ file, sha256 });
  });

  it("throws an Error mentioning store.json when the file is corrupt", async () => {
    await writeFile(path.join(dir, "store.json"), "{ not json");
    const store = createStore(dir);
    const err = await store.read().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("store.json");
    // never silently reset
    expect(await readFile(path.join(dir, "store.json"), "utf8")).toBe(
      "{ not json",
    );
  });

  it("rejects media paths that escape the data directory", async () => {
    const store = createStore(dir);
    await store.update((d) => d);
    await expect(store.readMedia("../store.json")).rejects.toThrow();
    await expect(store.readMedia("media/../../x")).rejects.toThrow();
    await expect(
      store.readMedia(path.join(dir, "store.json")),
    ).rejects.toThrow();
  });
});

describe("tsa files", () => {
  it("writes tsa/<seq>.tsr atomically and reads it back", async () => {
    const store = createStore(dir);
    const bytes = new Uint8Array([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x00]);
    const file = await store.writeTsa(3, bytes);
    expect(file).toBe("tsa/3.tsr");
    expect(new Uint8Array(await readFile(path.join(dir, file)))).toEqual(bytes);
    expect(await store.readTsa(file)).toEqual(bytes);
    const left = await readdir(path.join(dir, "tsa"));
    expect(left).toEqual(["3.tsr"]);
  });

  it("refuses to read outside the tsa directory", async () => {
    const store = createStore(dir);
    await store.update((d) => d);
    await store.writeMedia(new Uint8Array([1]), "jpg");
    await expect(store.readTsa("../store.json")).rejects.toThrow();
    await expect(store.readTsa("tsa/../store.json")).rejects.toThrow();
    await expect(store.readTsa("media/x.jpg")).rejects.toThrow();
    await expect(store.readTsa(path.join(dir, "store.json"))).rejects.toThrow();
  });
});

describe("getStore", () => {
  it("resolves WITNESS_DATA_DIR at call time and caches per directory", async () => {
    const prev = process.env.WITNESS_DATA_DIR;
    try {
      process.env.WITNESS_DATA_DIR = dir;
      const a = getStore();
      expect(getStore()).toBe(a);
      const other = await mkdtemp(path.join(tmpdir(), "witness-store-"));
      try {
        process.env.WITNESS_DATA_DIR = other;
        expect(getStore()).not.toBe(a);
      } finally {
        await rm(other, { recursive: true, force: true });
      }
    } finally {
      if (prev === undefined) delete process.env.WITNESS_DATA_DIR;
      else process.env.WITNESS_DATA_DIR = prev;
    }
  });
});
