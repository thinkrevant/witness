import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PUT as putCase } from "@/app/api/case/route";
import { POST as postIncident } from "@/app/api/incidents/route";
import { POST as postLive } from "@/app/api/live/route";
import { POST as postLock } from "@/app/api/lock/route";
import { PUT as putSettings } from "@/app/api/settings/route";
import { createSession } from "@/lib/auth/session";
import { getStore } from "@/lib/store/store";

let dir: string;
let cookie: string;
const prevDir = process.env.WITNESS_DATA_DIR;
const prevTsa = process.env.WITNESS_TSA;

type Route = (req: Request) => Promise<Response>;

const ROUTES: { name: string; method: string; url: string; handler: Route; body: unknown }[] = [
  { name: "POST /api/lock", method: "POST", url: "/api/lock", handler: postLock, body: { pin: "4821" } },
  { name: "PUT /api/settings", method: "PUT", url: "/api/settings", handler: putSettings, body: { demoMode: false } },
  { name: "PUT /api/case", method: "PUT", url: "/api/case", handler: putCase, body: { respondentName: "Mallory" } },
  { name: "POST /api/incidents", method: "POST", url: "/api/incidents", handler: postIncident, body: { eventId: "x" } },
  { name: "POST /api/live", method: "POST", url: "/api/live", handler: postLive, body: { offer: "v=0" } },
];

function req(route: (typeof ROUTES)[number], headers: Record<string, string>) {
  return new Request(`http://localhost:3000${route.url}`, {
    method: route.method,
    headers: { cookie, host: "localhost:3000", ...headers },
    body: JSON.stringify(route.body),
  });
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "witness-cross-site-"));
  process.env.WITNESS_DATA_DIR = dir;
  process.env.WITNESS_TSA = "off";
  cookie = `db_s=${createSession()}`;
});

beforeEach(() => {
  globalThis.__witnessLockState = undefined;
});

afterAll(async () => {
  if (prevDir === undefined) delete process.env.WITNESS_DATA_DIR;
  else process.env.WITNESS_DATA_DIR = prevDir;
  if (prevTsa === undefined) delete process.env.WITNESS_TSA;
  else process.env.WITNESS_TSA = prevTsa;
  globalThis.__witnessLockState = undefined;
  await rm(dir, { recursive: true, force: true });
});

describe("state-changing routes refuse cross-site requests", () => {
  for (const route of ROUTES) {
    it(`${route.name}: 403 for another Origin, a non-JSON body type or no content-type`, async () => {
      const cases: Record<string, string>[] = [
        { "content-type": "application/json", origin: "https://evil.example" },
        { "content-type": "application/json", origin: "http://localhost:3001" },
        { "content-type": "application/json", origin: "null" },
        { "content-type": "text/plain" },
        { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost:3000" },
        {},
      ];
      for (const headers of cases) {
        const res = await route.handler(req(route, headers));
        expect(res.status, JSON.stringify(headers)).toBe(403);
        expect(await res.json()).toEqual({ error: "forbidden" });
      }
      const data = await getStore().read();
      expect(data.settings.pinHash).toBeNull();
      expect(data.settings.demoMode).toBe(true);
      expect(data.case).toBeNull();
    });
  }

  it("accepts a same-origin JSON request, and one without an Origin header", async () => {
    const lock = ROUTES[0];
    expect((await lock.handler(req(lock, { "content-type": "application/json", origin: "http://localhost:3000" }))).status).toBe(200);
    const caseRoute = ROUTES[2];
    expect((await caseRoute.handler(req(caseRoute, { "content-type": "application/json; charset=utf-8" }))).status).toBe(200);
    expect((await getStore().read()).case?.respondentName).toBe("Mallory");
  });
});
