import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyChain } from "@/lib/evidence/ledger";
import { sha256Hex } from "@/lib/evidence/hash";
import {
  RingAuthError,
  RingMediaUnavailable,
  type MediaResult,
  type RingClient,
  type RingEvent,
} from "@/lib/ring/client";
import { sealIncident as sealIncidentReal, type SealArgs } from "@/lib/seal/seal";
import { createDemoSource } from "@/lib/sources/demo-source";
import { createRingSource } from "@/lib/sources/ring-source";
import { effectiveToken, getSource, type EventSource } from "@/lib/sources/source";
import { createStore } from "@/lib/store/store";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "witness-seal-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const event: RingEvent = {
  id: "event-1",
  deviceId: "device-1",
  type: "on_demand",
  start: 1_000_000,
  end: 1_021_000,
};

const snapBytes = new Uint8Array([1, 2, 3, 4, 5]);
const clipBytes = new Uint8Array([9, 8, 7, 6]);

function media(bytes: Uint8Array, contentType: string, extra?: Partial<MediaResult>): MediaResult {
  return {
    bytes,
    contentType,
    mediaTimestamp: 1_000_005,
    mediaDuration: 21_000,
    requestId: "req-1",
    ...extra,
  };
}

function fakeSource(overrides: Partial<EventSource> = {}): EventSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    kind: "ring",
    calls,
    listEvents: async () => [event],
    snapshot: async () => {
      calls.push("snapshot");
      return media(snapBytes, "image/jpeg", { mediaDuration: null });
    },
    clip: async () => {
      calls.push("clip");
      return media(clipBytes, "video/mp4");
    },
    ...overrides,
  };
}

// Tests must never reach a real TSA: default every seal to a stub timestamp.
const stubTsr = new Uint8Array([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x00]);
const okStamp: NonNullable<SealArgs["timestamp"]> = async () => ({ status: "ok", tsr: stubTsr });
const sealIncident = (args: SealArgs) => sealIncidentReal({ timestamp: okStamp, ...args });

const fixedNow = () => new Date("2026-10-10T12:00:00.000Z");

describe("sealIncident", () => {
  it("appends one entry with two media records whose hashes match the bytes", async () => {
    const store = createStore(dir);
    const source = fakeSource();
    const { entry, alreadySealed } = await sealIncident({
      store,
      source,
      event,
      note: "He was on the porch",
      now: fixedNow,
    });

    expect(alreadySealed).toBe(false);
    const data = await store.read();
    expect(data.ledger).toHaveLength(1);
    expect(data.ledger[0]).toEqual(entry);
    expect((await verifyChain(data.ledger)).ok).toBe(true);

    expect(entry).toMatchObject({
      seq: 0,
      ringEventId: "event-1",
      deviceId: "device-1",
      eventStart: 1_000_000,
      eventEnd: 1_021_000,
      source: "ring",
      note: "He was on the porch",
      loggedAt: "2026-10-10T12:00:00.000Z",
      clipUnavailable: false,
    });
    expect(entry.incidentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.media).toHaveLength(2);
    const [snap, clip] = entry.media;
    expect(snap).toMatchObject({
      kind: "snapshot",
      sha256: await sha256Hex(snapBytes),
      bytes: 5,
      contentType: "image/jpeg",
      ringMediaTimestamp: 1_000_005,
      ringMediaDuration: null,
      ringRequestId: "req-1",
    });
    expect(clip).toMatchObject({
      kind: "clip",
      sha256: await sha256Hex(clipBytes),
      bytes: 4,
      contentType: "video/mp4",
      ringMediaDuration: 21_000,
    });
    expect(snap.file).toBe(`media/${snap.sha256}.jpg`);
    expect(clip.file).toBe(`media/${clip.sha256}.mp4`);
    expect(Number.isNaN(Date.parse(snap.retrievedAt))).toBe(false);
    expect(new Uint8Array(await readFile(path.join(dir, snap.file)))).toEqual(snapBytes);
    expect(new Uint8Array(await readFile(path.join(dir, clip.file)))).toEqual(clipBytes);
  });

  it("defaults eventEnd to start + 30000 when the event has no end", async () => {
    const store = createStore(dir);
    const { entry } = await sealIncident({
      store,
      source: fakeSource(),
      event: { ...event, end: null },
      note: "",
    });
    expect(entry.eventEnd).toBe(1_030_000);
  });

  it("returns the existing entry without downloading when the event is already sealed", async () => {
    const store = createStore(dir);
    const first = fakeSource();
    const a = await sealIncident({ store, source: first, event, note: "one" });
    const second = fakeSource();
    const b = await sealIncident({ store, source: second, event, note: "two" });

    expect(b.alreadySealed).toBe(true);
    expect(b.entry).toEqual(a.entry);
    expect(second.calls).toEqual([]);
    expect((await store.read()).ledger).toHaveLength(1);
  });

  it("seals only once when two requests race", async () => {
    const store = createStore(dir);
    const [a, b] = await Promise.all([
      sealIncident({ store, source: fakeSource(), event, note: "a" }),
      sealIncident({ store, source: fakeSource(), event, note: "b" }),
    ]);

    expect((await store.read()).ledger).toHaveLength(1);
    expect([a.alreadySealed, b.alreadySealed].sort()).toEqual([false, true]);
    expect(a.entry.entryHash).toBe(b.entry.entryHash);
  });

  it("seals the snapshot alone when the clip is unavailable", async () => {
    const store = createStore(dir);
    const source = fakeSource({
      clip: async () => {
        throw new RingMediaUnavailable("not ready");
      },
    });
    const { entry } = await sealIncident({ store, source, event, note: "" });

    expect(entry.clipUnavailable).toBe(true);
    expect(entry.media).toHaveLength(1);
    expect(entry.media[0].kind).toBe("snapshot");
  });

  it("writes nothing when the clip download fails with an auth error", async () => {
    const store = createStore(dir);
    const source = fakeSource({
      clip: async () => {
        throw new RingAuthError();
      },
    });

    await expect(sealIncident({ store, source, event, note: "" })).rejects.toBeInstanceOf(
      RingAuthError,
    );
    expect((await store.read()).ledger).toHaveLength(0);
    const mediaDir = path.join(dir, "media");
    const files = await readdir(mediaDir).catch(() => [] as string[]);
    expect(files).toEqual([]);
  });

  it("writes nothing when the snapshot download fails", async () => {
    const store = createStore(dir);
    const source = fakeSource({
      snapshot: async () => {
        throw new Error("boom");
      },
    });
    await expect(sealIncident({ store, source, event, note: "" })).rejects.toThrow("boom");
    expect((await store.read()).ledger).toHaveLength(0);
  });

  it("chains a second incident onto the first", async () => {
    const store = createStore(dir);
    const a = await sealIncident({ store, source: fakeSource(), event, note: "" });
    const b = await sealIncident({
      store,
      source: fakeSource(),
      event: { ...event, id: "event-2" },
      note: "",
    });
    expect(b.entry.seq).toBe(1);
    expect(b.entry.prevHash).toBe(a.entry.entryHash);
    expect((await verifyChain((await store.read()).ledger)).ok).toBe(true);
  });
});

describe("sealIncident timestamping", () => {
  it("stores the .tsr and records an ok TsaRecord for the new entry", async () => {
    const store = createStore(dir);
    const hashes: string[] = [];
    const { entry } = await sealIncident({
      store,
      source: fakeSource(),
      event,
      note: "",
      timestamp: async (h) => {
        hashes.push(h);
        return { status: "ok", tsr: stubTsr };
      },
    });

    expect(hashes).toEqual([entry.entryHash]);
    const { tsa } = await store.read();
    expect(tsa).toHaveLength(1);
    expect(tsa[0]).toMatchObject({ seq: 0, tsrFile: "tsa/0.tsr", status: "ok" });
    expect(Number.isNaN(Date.parse(tsa[0].requestedAt))).toBe(false);
    expect(await store.readTsa("tsa/0.tsr")).toEqual(stubTsr);
  });

  it("still resolves and records failed when the TSA fails", async () => {
    const store = createStore(dir);
    const { entry } = await sealIncident({
      store,
      source: fakeSource(),
      event,
      note: "",
      timestamp: async () => ({ status: "failed", tsr: null }),
    });
    expect(entry.seq).toBe(0);
    const data = await store.read();
    expect(data.ledger).toHaveLength(1);
    expect(data.tsa).toHaveLength(1);
    expect(data.tsa[0]).toMatchObject({ seq: 0, tsrFile: null, status: "failed" });
    await expect(readdir(path.join(dir, "tsa"))).rejects.toThrow();
  });

  it("still resolves and records failed when the timestamp function throws", async () => {
    const store = createStore(dir);
    const { entry } = await sealIncident({
      store,
      source: fakeSource(),
      event,
      note: "",
      timestamp: async () => {
        throw new Error("boom");
      },
    });
    expect(entry.seq).toBe(0);
    const data = await store.read();
    expect(data.ledger).toHaveLength(1);
    expect(data.tsa).toHaveLength(1);
    expect(data.tsa[0]).toMatchObject({ seq: 0, tsrFile: null, status: "failed" });
  });

  it("fails open with a failing TSA fetch (real requestTimestamp, stub fetch)", async () => {
    const store = createStore(dir);
    const { requestTimestamp } = await import("@/lib/timestamp/tsa");
    const rejecting = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const { entry } = await sealIncident({
      store,
      source: fakeSource(),
      event,
      note: "",
      timestamp: (h) => requestTimestamp(h, { fetch: rejecting }),
    });
    expect(entry.seq).toBe(0);
    expect((await store.read()).tsa[0]).toMatchObject({ seq: 0, tsrFile: null, status: "failed" });
  });

  it("does not timestamp an already sealed event", async () => {
    const store = createStore(dir);
    await sealIncident({ store, source: fakeSource(), event, note: "" });
    let calls = 0;
    const again = await sealIncident({
      store,
      source: fakeSource(),
      event,
      note: "",
      timestamp: async () => {
        calls++;
        return { status: "ok", tsr: stubTsr };
      },
    });
    expect(again.alreadySealed).toBe(true);
    expect(calls).toBe(0);
    expect((await store.read()).tsa).toHaveLength(1);
  });

  it("does not timestamp the loser of a race", async () => {
    const store = createStore(dir);
    let calls = 0;
    const timestamp: NonNullable<SealArgs["timestamp"]> = async () => {
      calls++;
      return { status: "ok", tsr: stubTsr };
    };
    await Promise.all([
      sealIncident({ store, source: fakeSource(), event, note: "a", timestamp }),
      sealIncident({ store, source: fakeSource(), event, note: "b", timestamp }),
    ]);
    expect(calls).toBe(1);
    expect((await store.read()).tsa).toHaveLength(1);
  });
});

describe("demo source", () => {
  const fixtures = path.join(process.cwd(), "fixtures", "playground");

  it("lists the two fixture events, newest first, with the vehicle event present", async () => {
    const events = await createDemoSource().listEvents();
    expect(events.map((e) => e.start)).toEqual([1791622011263, 1791621888046]);
    const vehicle = events.find((e) => e.start === 1791621888046);
    expect(vehicle).toMatchObject({ type: "on_demand", end: 1791621909805 });
    expect(vehicle?.deviceId).toMatch(/^ava1\.ring\.device\./);
  });

  it("serves fixture bytes and header metadata for the vehicle event", async () => {
    const source = createDemoSource();
    const vehicle = (await source.listEvents()).find((e) => e.start === 1791621888046)!;

    const snap = await source.snapshot(vehicle);
    const file = new Uint8Array(await readFile(path.join(fixtures, "vehicle-1791621888046.jpg")));
    expect(await sha256Hex(snap.bytes)).toBe(await sha256Hex(file));
    expect(snap).toMatchObject({
      contentType: "image/jpeg",
      mediaTimestamp: 1791621909809,
      mediaDuration: null,
      requestId: "fa8ffdf0-b7e2-4160-98e8-32ef95ad3c38",
    });

    const clip = await source.clip(vehicle);
    expect(clip).toMatchObject({
      contentType: "video/mp4",
      mediaTimestamp: 1791621888047,
      mediaDuration: 21466,
      requestId: "0130bf5a-d80a-49a2-9d2d-b7d96b663eed",
    });
    const clipFile = new Uint8Array(await readFile(path.join(fixtures, "vehicle-1791621888046.mp4")));
    expect(await sha256Hex(clip.bytes)).toBe(await sha256Hex(clipFile));
  });

  it("serves the motion event media", async () => {
    const source = createDemoSource();
    const motion = (await source.listEvents()).find((e) => e.start === 1791622011263)!;
    const clip = await source.clip(motion);
    expect(clip).toMatchObject({ mediaDuration: 39238, requestId: "8882942e-e254-45f0-abcd-14b3d51ca158" });
  });

  it("rejects an event with no fixture media", async () => {
    await expect(createDemoSource().snapshot({ ...event, start: 42 })).rejects.toThrow(/fixture/i);
  });

  it("can seal a demo event end to end", async () => {
    const store = createStore(dir);
    const source = createDemoSource();
    const vehicle = (await source.listEvents()).find((e) => e.start === 1791621888046)!;
    const { entry } = await sealIncident({ store, source, event: vehicle, note: "demo" });
    expect(entry.source).toBe("demo");
    expect(entry.media.map((m) => m.kind)).toEqual(["snapshot", "clip"]);
  });
});

describe("getSource", () => {
  const base = { ringToken: "tok", demoMode: true, pinHash: null, pinSalt: null };

  it("returns the demo source in demo mode or without a token", async () => {
    const prevEnv = process.env.RING_ACCESS_TOKEN;
    delete process.env.RING_ACCESS_TOKEN;
    try {
      expect((await getSource(base)).kind).toBe("demo");
      expect((await getSource({ ...base, demoMode: false, ringToken: null })).kind).toBe("demo");
      expect((await getSource({ ...base, demoMode: false, ringToken: "" })).kind).toBe("demo");
    } finally {
      if (prevEnv !== undefined) process.env.RING_ACCESS_TOKEN = prevEnv;
    }
  });

  it("returns the ring source with a token and demo mode off", async () => {
    expect((await getSource({ ...base, demoMode: false })).kind).toBe("ring");
  });

  describe("RING_ACCESS_TOKEN fallback", () => {
    const prev = process.env.RING_ACCESS_TOKEN;
    afterEach(() => {
      if (prev === undefined) delete process.env.RING_ACCESS_TOKEN;
      else process.env.RING_ACCESS_TOKEN = prev;
    });

    it("uses the env token when Settings has none", async () => {
      process.env.RING_ACCESS_TOKEN = "env-tok";
      expect(effectiveToken({ ...base, ringToken: null })).toBe("env-tok");
      expect(effectiveToken({ ...base, ringToken: "" })).toBe("env-tok");
      expect(effectiveToken(base)).toBe("tok");
      expect((await getSource({ ...base, demoMode: false, ringToken: null })).kind).toBe("ring");
      expect((await getSource({ ...base, demoMode: true, ringToken: null })).kind).toBe("demo");
    });

    it("treats an empty env token as no token", async () => {
      process.env.RING_ACCESS_TOKEN = "";
      expect(effectiveToken({ ...base, ringToken: null })).toBeNull();
      expect((await getSource({ ...base, demoMode: false, ringToken: null })).kind).toBe("demo");
    });
  });
});

describe("ring source", () => {
  function fakeClient(devices: { id: string; name: string; online: boolean | null }[]) {
    const calls: string[] = [];
    const client: RingClient = {
      listDevices: async () => {
        calls.push("listDevices");
        return devices;
      },
      listEvents: async (id) => {
        calls.push(`listEvents:${id}`);
        return [event];
      },
      downloadSnapshot: async (id) => {
        calls.push(`snapshot:${id}`);
        return media(snapBytes, "image/jpeg");
      },
      downloadClip: async (id) => {
        calls.push(`clip:${id}`);
        return media(clipBytes, "video/mp4");
      },
      startLiveView: async (id) => {
        calls.push(`live:${id}`);
        return { answerSdp: "v=0", sessionUrl: "https://api.amazonvision.com/s" };
      },
      stopLiveView: async () => {
        calls.push("stop");
      },
    };
    return { client, calls };
  }

  it("uses the first device and looks devices up once", async () => {
    const { client, calls } = fakeClient([
      { id: "dev-a", name: "A", online: true },
      { id: "dev-b", name: "B", online: true },
    ]);
    const source = createRingSource(client);
    await source.listEvents();
    await source.snapshot(event);
    await source.clip(event);
    expect(calls).toEqual(["listDevices", "listEvents:dev-a", "snapshot:dev-a", "clip:dev-a"]);
  });

  it("fails clearly when the token has no devices", async () => {
    const { client } = fakeClient([]);
    await expect(createRingSource(client).listEvents()).rejects.toThrow(
      "No Ring devices are shared with this token",
    );
  });
});
