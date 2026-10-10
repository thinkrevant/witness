import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getCase, PUT as putCase } from "@/app/api/case/route";
import { GET as getThumb } from "@/app/api/events/[id]/thumb/route";
import { GET as getEvents } from "@/app/api/events/route";
import { GET as getIncidents, POST as postIncident } from "@/app/api/incidents/route";
import { GET as getMedia } from "@/app/api/media/[...file]/route";
import { GET as getSettings, PUT as putSettings } from "@/app/api/settings/route";
import { hashPin, verifyPin } from "@/lib/auth/pin";
import { createSession, isSessionValid } from "@/lib/auth/session";
import type { LedgerEntry } from "@/lib/evidence/types";
import { createDemoSource } from "@/lib/sources/demo-source";
import { getStore } from "@/lib/store/store";

const VEHICLE_START = 1791621888046;

let dir: string;
let cookie: string;
let vehicleId: string;
const prevDir = process.env.WITNESS_DATA_DIR;
const prevTsa = process.env.WITNESS_TSA;
const prevEnvToken = process.env.RING_ACCESS_TOKEN;

function req(url: string, init: RequestInit & { session?: boolean } = {}) {
  const { session = true, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (session) headers.set("cookie", cookie);
  if (rest.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://localhost${url}`, { ...rest, headers });
}

function seal(eventId: string, note = "He was at the door") {
  return postIncident(req("/api/incidents", { method: "POST", body: JSON.stringify({ eventId, note }) }));
}

function media(segments: string[], headers?: HeadersInit) {
  return getMedia(req(`/api/media/${segments.join("/")}`, { headers }), {
    params: Promise.resolve({ file: segments }),
  });
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "witness-api-"));
  process.env.WITNESS_DATA_DIR = dir;
  process.env.WITNESS_TSA = "off";
  delete process.env.RING_ACCESS_TOKEN;
  cookie = `db_s=${createSession()}`;
  const events = await createDemoSource().listEvents();
  vehicleId = events.find((e) => e.start === VEHICLE_START)!.id;
});

afterAll(async () => {
  if (prevDir === undefined) delete process.env.WITNESS_DATA_DIR;
  else process.env.WITNESS_DATA_DIR = prevDir;
  if (prevTsa === undefined) delete process.env.WITNESS_TSA;
  else process.env.WITNESS_TSA = prevTsa;
  if (prevEnvToken !== undefined) process.env.RING_ACCESS_TOKEN = prevEnvToken;
  await rm(dir, { recursive: true, force: true });
});

describe("session guard", () => {
  it("every route refuses a request without a session", async () => {
    const noSession = (url: string, init: RequestInit = {}) => req(url, { ...init, session: false });
    const responses = await Promise.all([
      getEvents(noSession("/api/events")),
      getThumb(noSession(`/api/events/${vehicleId}/thumb`), { params: Promise.resolve({ id: vehicleId }) }),
      getIncidents(noSession("/api/incidents")),
      postIncident(noSession("/api/incidents", { method: "POST", body: JSON.stringify({ eventId: vehicleId }) })),
      getCase(noSession("/api/case")),
      getSettings(noSession("/api/settings")),
      getMedia(noSession("/api/media/media/x.jpg"), { params: Promise.resolve({ file: ["media", "x.jpg"] }) }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401, 401]);
  });
});

describe("events", () => {
  it("lists the two demo events, none sealed yet", async () => {
    const res = await getEvents(req("/api/events"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("demo");
    expect(body.events).toHaveLength(2);
    expect(body.events.every((e: { sealed: boolean }) => e.sealed === false)).toBe(true);
  });

  it("serves a JPEG thumbnail for a known event and 404 for an unknown one", async () => {
    const ok = await getThumb(req(`/api/events/${vehicleId}/thumb`), {
      params: Promise.resolve({ id: vehicleId }),
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
    const bytes = new Uint8Array(await ok.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);

    const missing = await getThumb(req("/api/events/nope/thumb"), { params: Promise.resolve({ id: "nope" }) });
    expect(missing.status).toBe(404);
  });
});

describe("incidents", () => {
  let entry: LedgerEntry;

  it("seals the demo vehicle event once; a repeat returns alreadySealed", async () => {
    const first = await seal(vehicleId);
    expect(first.status).toBe(200);
    const a = await first.json();
    expect(a.alreadySealed).toBe(false);
    expect(a.entry.ringEventId).toBe(vehicleId);
    entry = a.entry;

    const second = await seal(vehicleId);
    expect(second.status).toBe(200);
    const b = await second.json();
    expect(b.alreadySealed).toBe(true);
    expect(b.entry.entryHash).toBe(entry.entryHash);
  });

  it("returns 404 for an unknown event and 400 without an eventId", async () => {
    expect((await seal("no-such-event")).status).toBe(404);
    const bad = await postIncident(req("/api/incidents", { method: "POST", body: JSON.stringify({ note: "x" }) }));
    expect(bad.status).toBe(400);
  });

  it("GET shows one entry, an intact chain and the stubbed (failed) timestamp", async () => {
    const res = await getIncidents(req("/api/incidents"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.chain.ok).toBe(true);
    expect(body.status).toEqual([{ seq: 0, intact: true, timestamp: "failed" }]);
  });

  it("marks the sealed event in the activity list", async () => {
    const body = await (await getEvents(req("/api/events"))).json();
    const sealed = body.events.find((e: { id: string }) => e.id === vehicleId);
    expect(sealed.sealed).toBe(true);
  });

  it("serves sealed media with its ledger content-type, and byte ranges for video", async () => {
    const snap = entry.media.find((m) => m.kind === "snapshot")!;
    const img = await media(snap.file.split("/"));
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect((await img.arrayBuffer()).byteLength).toBe(snap.bytes);

    const clip = entry.media.find((m) => m.kind === "clip")!;
    const part = await media(clip.file.split("/"), { range: "bytes=0-99" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-type")).toBe("video/mp4");
    expect(part.headers.get("content-range")).toBe(`bytes 0-99/${clip.bytes}`);
    expect((await part.arrayBuffer()).byteLength).toBe(100);

    const tail = await media(clip.file.split("/"), { range: "bytes=-10" });
    expect(tail.headers.get("content-range")).toBe(`bytes ${clip.bytes - 10}-${clip.bytes - 1}/${clip.bytes}`);

    const beyond = await media(clip.file.split("/"), { range: `bytes=${clip.bytes}-` });
    expect(beyond.status).toBe(416);
  });

  it("refuses files that are not in the ledger, including traversal", async () => {
    expect((await media(["..", "store.json"])).status).toBe(404);
    expect((await media(["store.json"])).status).toBe(404);
    expect((await media(["media", "..", "store.json"])).status).toBe(404);
    expect((await media(["media", "0".repeat(64) + ".jpg"])).status).toBe(404);
  });
});

describe("settings", () => {
  const token = "secret-ring-token-0123456789";

  it("stores the token but never returns it", async () => {
    const put = await putSettings(
      req("/api/settings", { method: "PUT", body: JSON.stringify({ ringToken: token, demoMode: true }) }),
    );
    expect(put.status).toBe(200);
    expect(await put.text()).not.toContain(token);

    const res = await getSettings(req("/api/settings"));
    const text = await res.text();
    expect(text).not.toContain(token);
    expect(JSON.parse(text)).toEqual({ demoMode: true, hasToken: true });
  });

  it("clears the token with null and rejects bad input", async () => {
    await putSettings(req("/api/settings", { method: "PUT", body: JSON.stringify({ ringToken: null }) }));
    expect(await (await getSettings(req("/api/settings"))).json()).toEqual({ demoMode: true, hasToken: false });

    const bad = await putSettings(req("/api/settings", { method: "PUT", body: JSON.stringify({ demoMode: "yes" }) }));
    expect(bad.status).toBe(400);
  });

  it("counts an env RING_ACCESS_TOKEN as a token without ever returning it", async () => {
    const prev = process.env.RING_ACCESS_TOKEN;
    process.env.RING_ACCESS_TOKEN = "env-ring-token-abcdef";
    try {
      const text = await (await getSettings(req("/api/settings"))).text();
      expect(text).not.toContain("env-ring-token-abcdef");
      expect(JSON.parse(text)).toEqual({ demoMode: true, hasToken: true });
    } finally {
      if (prev === undefined) delete process.env.RING_ACCESS_TOKEN;
      else process.env.RING_ACCESS_TOKEN = prev;
    }
  });

  describe("PIN change", () => {
    const change = (currentPin: string, newPin: string) =>
      putSettings(req("/api/settings", { method: "PUT", body: JSON.stringify({ currentPin, newPin }) }));

    beforeAll(async () => {
      const { hash, salt } = await hashPin("2468");
      await getStore().update((d) => ({ ...d, settings: { ...d.settings, pinHash: hash, pinSalt: salt } }));
    });

    beforeEach(() => {
      globalThis.__witnessLockState = undefined;
    });

    afterAll(() => {
      globalThis.__witnessLockState = undefined;
    });

    it("changes the PIN only with the current PIN and ends every other session", async () => {
      const other = createSession();
      const wrong = await change("0000", "13579");
      expect(wrong.status).toBe(403);
      expect(await wrong.json()).toEqual({ error: "wrong-pin", attemptsLeft: 4 });
      expect((await change("2468", "12")).status).toBe(400);
      expect((await change("2468", "13579")).status).toBe(200);

      const { settings } = await getStore().read();
      expect(await verifyPin("13579", settings.pinHash!, settings.pinSalt!)).toBe(true);
      expect(isSessionValid(other)).toBe(false);
      expect(isSessionValid(cookie.slice("db_s=".length))).toBe(true);
    });

    it("shares the unlock throttle: 5 wrong current PINs, then 429 even for the right one", async () => {
      for (let i = 0; i < 5; i++) expect((await change("0000", "97531")).status).toBe(403);
      const locked = await change("13579", "97531");
      expect(locked.status).toBe(429);
      expect((await locked.json()).error).toBe("cooldown");
      const { settings } = await getStore().read();
      expect(await verifyPin("13579", settings.pinHash!, settings.pinSalt!)).toBe(true);
    });
  });
});

describe("case", () => {
  it("starts empty, then saves and returns the case", async () => {
    expect(await (await getCase(req("/api/case"))).json()).toEqual({ case: null });

    const info = {
      petitionerName: "Sam",
      respondentName: "Alex Doe",
      orderNumber: "PO-2026-114",
      court: "Superior Court",
      issuedOn: "2026-09-01",
      expiresOn: "2027-09-01",
      servedOn: "2026-09-03",
      conditions: "No contact; stay 100 yards away",
    };
    const put = await putCase(req("/api/case", { method: "PUT", body: JSON.stringify(info) }));
    expect(put.status).toBe(200);
    expect(await (await getCase(req("/api/case"))).json()).toEqual({ case: info });

    const bad = await putCase(req("/api/case", { method: "PUT", body: JSON.stringify({ ...info, respondentName: "  " }) }));
    expect(bad.status).toBe(400);
  });
});
