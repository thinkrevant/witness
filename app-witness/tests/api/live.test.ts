import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, POST } from "@/app/api/live/route";
import { createSession } from "@/lib/auth/session";
import { RingAuthError } from "@/lib/ring/client";
import type { EventSource } from "@/lib/sources/source";

const RING_URL = "https://api.amazonvision.com/v1/devices/d1/media/streaming/whep/sessions/ring-session-1";
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\n";
const ANSWER = "v=0\r\no=- 3 4 IN IP4 0.0.0.0\r\ns=-\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n";
const TOKEN = "live-token-should-never-leak";

// When `ring` is set, getSource returns it; otherwise the real getSource runs (demo mode by default).
const seam = vi.hoisted(() => ({ ring: null as EventSource | null }));
vi.mock("@/lib/sources/source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sources/source")>();
  return {
    ...actual,
    effectiveToken: () => TOKEN,
    getSource: async (settings: Parameters<typeof actual.getSource>[0]) =>
      seam.ring ?? actual.getSource({ ...settings, demoMode: true }),
  };
});

function fakeRing() {
  const start = vi.fn(async (offer: string) => {
    void offer;
    return { answerSdp: ANSWER, sessionUrl: RING_URL };
  });
  const stop = vi.fn(async (url: string) => {
    void url;
  });
  const source: EventSource = {
    kind: "ring",
    listEvents: async () => [],
    snapshot: async () => {
      throw new Error("not used");
    },
    clip: async () => {
      throw new Error("not used");
    },
    live: { start, stop },
  };
  return { source, start, stop };
}

let dir: string;
let cookie: string;
const prevDir = process.env.WITNESS_DATA_DIR;
const prevTsa = process.env.WITNESS_TSA;

function post(body: unknown, headers: Record<string, string> = {}, session = true) {
  return POST(
    new Request("http://localhost:3000/api/live", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        "content-type": "application/json",
        ...(session ? { cookie } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

function del(id: string, headers: Record<string, string> = {}, session = true) {
  return DELETE(
    new Request(`http://localhost:3000/api/live?session=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { host: "localhost:3000", ...(session ? { cookie } : {}), ...headers },
    }),
  );
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "witness-live-"));
  process.env.WITNESS_DATA_DIR = dir;
  process.env.WITNESS_TSA = "off";
  cookie = `db_s=${createSession()}`;
});

beforeEach(() => {
  seam.ring = null;
  globalThis.__witnessLiveSessions = undefined;
});

afterAll(async () => {
  if (prevDir === undefined) delete process.env.WITNESS_DATA_DIR;
  else process.env.WITNESS_DATA_DIR = prevDir;
  if (prevTsa === undefined) delete process.env.WITNESS_TSA;
  else process.env.WITNESS_TSA = prevTsa;
  globalThis.__witnessLiveSessions = undefined;
  await rm(dir, { recursive: true, force: true });
});

describe("POST /api/live", () => {
  it("401 without a session, before anything else", async () => {
    const res = await post({ offer: OFFER }, { origin: "https://evil.example" }, false);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "locked" });
  });

  it("403 for a cross-site request or a non-JSON body", async () => {
    const ring = fakeRing();
    seam.ring = ring.source;
    for (const headers of <Record<string, string>[]>[
      { origin: "https://evil.example" },
      { origin: "http://localhost:3001" },
      { "content-type": "text/plain" },
    ]) {
      const res = await post({ offer: OFFER }, headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
    expect(ring.start).not.toHaveBeenCalled();
  });

  it("400 bad-offer for a missing, non-SDP or oversized offer", async () => {
    const ring = fakeRing();
    seam.ring = ring.source;
    for (const body of [{}, { offer: 42 }, { offer: "" }, { offer: "hello" }, { offer: `v=0\r\n${"a".repeat(20_000)}` }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad-offer" });
    }
    expect(ring.start).not.toHaveBeenCalled();
  });

  it("409 live-unavailable in demo mode", async () => {
    const res = await post({ offer: OFFER });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "live-unavailable" });
  });

  it("returns the answer and an opaque session id, never the Ring URL or token", async () => {
    const ring = fakeRing();
    seam.ring = ring.source;
    const res = await post({ offer: OFFER }, { origin: "http://localhost:3000" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("amazonvision");
    expect(text).not.toContain("ring-session-1");
    expect(text).not.toContain(TOKEN);
    const body = JSON.parse(text);
    expect(body).toEqual({ answer: ANSWER, sessionId: expect.any(String), maxSeconds: 60 });
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ring.start).toHaveBeenCalledWith(OFFER);
  });

  it("maps a rejected token to 401 reconnect-ring", async () => {
    const ring = fakeRing();
    ring.start.mockRejectedValueOnce(new RingAuthError());
    seam.ring = ring.source;
    const res = await post({ offer: OFFER });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "reconnect-ring" });
  });

  it("maps other failures to 502 live-failed without the token", async () => {
    const ring = fakeRing();
    ring.start.mockRejectedValueOnce(new Error(`Ring API live view failed: HTTP 500 ${TOKEN}`));
    seam.ring = ring.source;
    const res = await post({ offer: OFFER });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text).error).toBe("live-failed");
  });
});

describe("DELETE /api/live", () => {
  async function started() {
    const ring = fakeRing();
    seam.ring = ring.source;
    const { sessionId } = (await (await post({ offer: OFFER })).json()) as { sessionId: string };
    return { ring, sessionId };
  }

  it("401 without a session", async () => {
    const { ring, sessionId } = await started();
    expect((await del(sessionId, {}, false)).status).toBe(401);
    expect(ring.stop).not.toHaveBeenCalled();
  });

  it("403 when the Origin is another site", async () => {
    const { ring, sessionId } = await started();
    const res = await del(sessionId, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(ring.stop).not.toHaveBeenCalled();
  });

  it("stops the stored Ring session once; a repeat or unknown id is 404", async () => {
    const { ring, sessionId } = await started();
    const res = await del(sessionId, { origin: "http://localhost:3000" });
    expect(res.status).toBe(200);
    expect(ring.stop).toHaveBeenCalledTimes(1);
    expect(ring.stop).toHaveBeenCalledWith(RING_URL);

    expect((await del(sessionId)).status).toBe(404);
    expect((await del("no-such-session")).status).toBe(404);
    expect(ring.stop).toHaveBeenCalledTimes(1);
  });

  it("uses the source that started the session, even after switching to demo mode", async () => {
    const { ring, sessionId } = await started();
    seam.ring = null;
    expect((await del(sessionId)).status).toBe(200);
    expect(ring.stop).toHaveBeenCalledWith(RING_URL);
  });

  it("forgets the session even if Ring refuses the stop, without leaking the token", async () => {
    const { ring, sessionId } = await started();
    ring.stop.mockRejectedValueOnce(new Error(`Ring API live view stop failed: HTTP 500 ${TOKEN}`));
    const res = await del(sessionId);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(TOKEN);
    expect((await del(sessionId)).status).toBe(404);
  });
});
