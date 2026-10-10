import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/incidents/route";
import { createSession } from "@/lib/auth/session";
import { RingMediaUnavailable, type RingEvent } from "@/lib/ring/client";
import { getStore } from "@/lib/store/store";

const event: RingEvent = { id: "ev-1", deviceId: "dev-1", type: "motion", start: 1_000_000, end: null };
const TOKEN = "live-token-should-never-leak";

// A live source whose footage lies before the token's consent window.
vi.mock("@/lib/sources/source", () => ({
  effectiveToken: () => TOKEN,
  getSource: async () => ({
    kind: "ring",
    listEvents: async () => [event],
    snapshot: async () => {
      throw new RingMediaUnavailable(
        `Footage not accessible with this token (time range not authorized) ${TOKEN}`,
      );
    },
    clip: async () => {
      throw new Error("not reached");
    },
  }),
}));

let dir: string;
const prevDir = process.env.WITNESS_DATA_DIR;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "witness-api-unavail-"));
  process.env.WITNESS_DATA_DIR = dir;
});

afterAll(async () => {
  if (prevDir === undefined) delete process.env.WITNESS_DATA_DIR;
  else process.env.WITNESS_DATA_DIR = prevDir;
  await rm(dir, { recursive: true, force: true });
});

describe("POST /api/incidents with unavailable footage", () => {
  it("returns 422 footage-unavailable without the token and seals nothing", async () => {
    const res = await POST(
      new Request("http://localhost/api/incidents", {
        method: "POST",
        headers: { cookie: `db_s=${createSession()}`, "content-type": "application/json" },
        body: JSON.stringify({ eventId: event.id, note: "" }),
      }),
    );
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    const body = JSON.parse(text);
    expect(body.error).toBe("footage-unavailable");
    expect(body.message).toMatch(/not accessible with this token/);
    expect((await getStore().read()).ledger).toHaveLength(0);
  });
});
