import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUT as putCase } from "@/app/api/case/route";
import { POST as postIncident } from "@/app/api/incidents/route";
import { GET as getReport } from "@/app/api/report/route";
import { GET as getStatus } from "@/app/api/report/status/route";
import { createSession } from "@/lib/auth/session";
import { createDemoSource } from "@/lib/sources/demo-source";

let dir: string;
let cookie: string;
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

const report = (format: string, session = true) => getReport(req(`/api/report?format=${format}`, { session }));

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "witness-report-api-"));
  process.env.WITNESS_DATA_DIR = dir;
  process.env.WITNESS_TSA = "off";
  delete process.env.RING_ACCESS_TOKEN;
  cookie = `db_s=${createSession()}`;
});

afterAll(async () => {
  if (prevDir === undefined) delete process.env.WITNESS_DATA_DIR;
  else process.env.WITNESS_DATA_DIR = prevDir;
  if (prevTsa === undefined) delete process.env.WITNESS_TSA;
  else process.env.WITNESS_TSA = prevTsa;
  if (prevEnvToken !== undefined) process.env.RING_ACCESS_TOKEN = prevEnvToken;
  await rm(dir, { recursive: true, force: true });
});

describe("GET /api/report", () => {
  it("refuses a request without a session", async () => {
    expect((await report("pdf", false)).status).toBe(401);
    expect((await getStatus(req("/api/report/status", { session: false }))).status).toBe(401);
  });

  it("rejects an unknown format", async () => {
    expect((await report("docx")).status).toBe(400);
    expect((await getReport(req("/api/report"))).status).toBe(400);
  });

  it("needs a case, then at least one incident", async () => {
    const noCase = await report("pdf");
    expect(noCase.status).toBe(409);
    expect(await noCase.json()).toEqual({ error: "no-case" });

    await putCase(
      req("/api/case", { method: "PUT", body: JSON.stringify({ respondentName: "Alex Doe", orderNumber: "PO-1" }) }),
    );
    const noIncidents = await report("zip");
    expect(noIncidents.status).toBe(409);
    expect(await noIncidents.json()).toEqual({ error: "no-incidents" });

    const status = await (await getStatus(req("/api/report/status"))).json();
    expect(status).toMatchObject({ hasCase: true, incidents: 0, chain: { ok: true }, mediaChecks: [], suspectSeqs: [] });
  });

  it("serves the PDF and the zip with neutral file names", async () => {
    const events = await createDemoSource().listEvents();
    for (const ev of events) {
      const res = await postIncident(
        req("/api/incidents", { method: "POST", body: JSON.stringify({ eventId: ev.id, note: "At the door" }) }),
      );
      expect(res.status).toBe(200);
    }

    const pdfRes = await report("pdf");
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get("content-type")).toBe("application/pdf");
    expect(pdfRes.headers.get("content-disposition")).toMatch(
      /^attachment; filename="daybook-record-\d{4}-\d{2}-\d{2}\.pdf"$/,
    );
    const doc = await PDFDocument.load(new Uint8Array(await pdfRes.arrayBuffer()));
    expect(doc.getPageCount()).toBe(3 + events.length + 3);

    const zipRes = await report("zip");
    expect(zipRes.status).toBe(200);
    expect(zipRes.headers.get("content-type")).toBe("application/zip");
    expect(zipRes.headers.get("content-disposition")).toMatch(
      /^attachment; filename="daybook-record-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    const files = unzipSync(new Uint8Array(await zipRes.arrayBuffer()));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["report.pdf", "manifest.json", "verify.html", "README.txt"]));
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest.entries).toHaveLength(events.length);
    expect(manifest.mediaChecks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    // TSA was off, so there is no timestamp file to include.
    expect(Object.keys(files).some((f) => f.startsWith("timestamps/"))).toBe(false);

    const status = await (await getStatus(req("/api/report/status"))).json();
    expect(status).toMatchObject({ hasCase: true, incidents: events.length, chain: { ok: true } });
    expect(status.mediaChecks).toHaveLength(events.length * 2);
  });
});
