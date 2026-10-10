import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/evidence/hash";
import { nextEntry, verifyChain } from "@/lib/evidence/ledger";
import type { LedgerEntry, LedgerEntryBody } from "@/lib/evidence/types";
import { buildBundle } from "@/lib/report/bundle";
import {
  buildManifest,
  manifestSuspects,
  readTimestampFiles,
  suspectSeqs,
  verifyMediaFiles,
  type Manifest,
  type TsaFile,
} from "@/lib/report/manifest";
import {
  BROKEN_SEAL_NOTICE,
  TRUST_CAVEAT,
  TRUST_POINTS,
  WIN_ANSI_CODE_POINTS,
  buildReportPdf,
  buildReportText,
  toWinAnsi,
  wrapText,
} from "@/lib/report/pdf";
import { buildHashLookup, buildVerifyHtml } from "@/lib/report/verify-html";
import { sealIncident } from "@/lib/seal/seal";
import { createDemoSource } from "@/lib/sources/demo-source";
import { createStore, type CaseInfo, type Store, type StoreData } from "@/lib/store/store";
import { fakeTsr } from "../helpers/tsr";

const CASE: CaseInfo = {
  petitionerName: "Sam Rivera",
  respondentName: "Alex Doe",
  orderNumber: "PO-2026-114",
  court: "Superior Court of Example County",
  issuedOn: "2026-09-01",
  expiresOn: "2027-09-01",
  servedOn: "2026-09-03",
  conditions: "No contact; stay 100 yards away from the petitioner and her home.",
};

const NOW = new Date("2026-10-10T18:30:00.000Z");
const WARNING = "INTEGRITY WARNING";

let dir: string;
let store: Store;
let data: StoreData;
let manifest: Manifest;
let tsaFiles: TsaFile[];

const allLines = (m: Manifest) => buildReportText(m).flatMap((s) => [s.section, ...s.lines]);
/** Number of image XObjects embedded in a PDF. */
async function imageCount(pdf: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdf);
  return doc.context
    .enumerateIndirectObjects()
    .filter(([, obj]) => obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"))
    .length;
}
const cloneManifest = (m: Manifest): Manifest => JSON.parse(JSON.stringify(m));
// Deep equality on multi-megabyte arrays is very slow in vitest; compare bytes directly.
const sameBytes = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "witness-report-"));
  store = createStore(dir);
  await store.update((d) => ({ ...d, case: CASE }));
  const source = createDemoSource();
  const events = (await source.listEvents()).sort((a, b) => a.start - b.start);
  // First seal gets a timestamp, the second does not, so both TSA states are covered.
  let calls = 0;
  const timestamp = async (entryHash: string) =>
    calls++ === 0 ? { status: "ok" as const, tsr: fakeTsr(entryHash) } : { status: "failed" as const, tsr: null };
  for (const [i, event] of events.entries()) {
    await sealIncident({ store, source, event, note: `Incident note ${i + 1}`, timestamp });
  }
  data = await store.read();
  tsaFiles = await readTimestampFiles(store, data.tsa, data.ledger);
  manifest = await buildManifest(data, await verifyMediaFiles(store, data.ledger), NOW, tsaFiles);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("manifest", () => {
  it("records an intact chain, matching media and the chain head", () => {
    expect(data.ledger).toHaveLength(2);
    expect(manifest).toMatchObject({ app: "Witness", version: 1, generatedAt: NOW.toISOString(), case: CASE });
    expect(manifest.chain.ok).toBe(true);
    expect(manifest.mediaChecks).toHaveLength(4);
    expect(manifest.mediaChecks.every((c) => c.ok)).toBe(true);
    expect(manifest.entries).toEqual(data.ledger);
    expect(manifest.head).toEqual({ count: 2, entryHash: data.ledger[1].entryHash });
  });

  it("lists the timestamp status of each entry", () => {
    expect(manifest.timestamps).toEqual([
      expect.objectContaining({ seq: 0, status: "ok", check: "covers-record", file: "timestamps/0.tsr" }),
      expect.objectContaining({ seq: 1, status: "failed", check: "failed", file: null }),
    ]);
  });

  it("refuses to build without a case", async () => {
    await expect(buildManifest({ ...data, case: null }, manifest.mediaChecks, NOW, tsaFiles)).rejects.toThrow(/case/);
  });
});

describe("report text", () => {
  it("has the sections in order: cover, order, timeline, one per incident, integrity, verify, declaration", () => {
    const sections = buildReportText(manifest).map((s) => s.section);
    expect(sections).toEqual([
      "Record of Protective Order Violations",
      "Order details",
      "Incident timeline",
      "Incident #1",
      "Incident #2",
      "Chain of custody and integrity",
      "How to verify",
      "Declaration",
    ]);
  });

  it("states the chain head, labels demo footage and shows each incident's TSA status", () => {
    const text = buildReportText(manifest);
    const lines = allLines(manifest).join("\n");
    expect(lines).toContain(`Ledger entries: 2`);
    expect(lines).toContain(data.ledger[1].entryHash);
    expect(lines).not.toContain(WARNING);

    const first = text.find((s) => s.section === "Incident #1")!.lines.join("\n");
    const second = text.find((s) => s.section === "Incident #2")!.lines.join("\n");
    expect(first).toContain("Ring Developer Playground simulated footage");
    expect(first).toContain("Independent timestamp (RFC 3161): ok");
    expect(second).toContain("Independent timestamp (RFC 3161): failed");
    for (const m of data.ledger[0].media) expect(first).toContain(m.sha256);
    expect(first).toContain(data.ledger[0].entryHash);
    expect(first).toContain(data.ledger[0].prevHash);
    expect(first).toContain(new Date(data.ledger[0].eventStart).toISOString());
  });

  it("has a declaration with blanks and the legal-advice disclaimer", () => {
    const declaration = buildReportText(manifest).at(-1)!.lines.join("\n");
    expect(declaration).toContain("I, ______");
    expect(declaration).toContain("recorded by my Ring doorbell at ______");
    expect(declaration).toContain("downloaded using Witness on ______");
    expect(declaration).not.toMatch(/\[(address|date)\]/);
    expect(declaration).toContain("This app does not provide legal advice. Talk to an advocate or attorney.");
  });

  it("prints INTEGRITY WARNING when the ledger was edited", async () => {
    const edited = data.ledger.map((e, i) => (i === 0 ? { ...e, note: "changed later" } : e));
    const bad = await buildManifest({ ...data, ledger: edited }, manifest.mediaChecks, NOW, tsaFiles);
    expect(bad.chain.ok).toBe(false);
    expect(allLines(bad)).toContain(WARNING);
  });
});

describe("report PDF", () => {
  let pdf: Uint8Array;

  beforeAll(async () => {
    pdf = await buildReportPdf(manifest, (f) => store.readMedia(f));
  });

  it("is over 10 KB with 3 + incidents + 3 pages and the report title", async () => {
    expect(pdf.byteLength).toBeGreaterThan(10 * 1024);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(3 + manifest.entries.length + 3);
    // Neutral metadata title, so a file browser or PDF viewer does not give the app away.
    expect(doc.getTitle()).toBe("Daybook record");
  });

  it("draws text outside WinAnsi as '?' and points to manifest.json", async () => {
    const m = cloneManifest(manifest);
    m.entries[0].note = "日本 😀";
    const out = await buildReportPdf(m, (f) => store.readMedia(f));
    expect((await PDFDocument.load(out)).getPageCount()).toBe(8);
    const lines = buildReportText(m).find((s) => s.section === "Incident #1")!.lines;
    expect(lines).toContain("?? ?");
    expect(lines).toContain("(some characters could not be shown here; the exact text is in manifest.json)");
  });

  it("continues a long section onto extra pages instead of overflowing", async () => {
    const m = cloneManifest(manifest);
    m.entries[0].note = Array.from({ length: 120 }, (_, i) => `Line ${i} of a very long note.`).join("\n");
    const doc = await PDFDocument.load(await buildReportPdf(m, (f) => store.readMedia(f)));
    expect(doc.getPageCount()).toBeGreaterThan(8);
  });
});

describe("text helpers", () => {
  it("toWinAnsi keeps encodable text and flags anything replaced", () => {
    expect(toWinAnsi("Café — “ok” €5")).toEqual({ text: "Café — “ok” €5", altered: false });
    expect(toWinAnsi("a b\tc")).toEqual({ text: "a b c", altered: false });
    expect(toWinAnsi("日本 😀")).toEqual({ text: "?? ?", altered: true });
  });

  it("every character toWinAnsi allows can be encoded by Helvetica", async () => {
    const doc = await PDFDocument.create();
    for (const standard of [StandardFonts.Helvetica, StandardFonts.HelveticaBold]) {
      const font = await doc.embedFont(standard);
      expect(() => font.encodeText(String.fromCodePoint(...WIN_ANSI_CODE_POINTS))).not.toThrow();
    }
  });

  it("wrapText keeps every line within the width, splitting long hashes", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const text = `SHA-256: ${"ab".repeat(32)} and some ordinary words that need wrapping`;
    const lines = wrapText(text, font, 10, 120);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(120);
    expect(lines.join("").replace(/ /g, "")).toBe(text.replace(/ /g, ""));
  });
});

describe("verify.html", () => {
  it("is one offline file with the title, the embedded manifest and a parseable script", () => {
    const html = buildVerifyHtml(manifest);
    expect(html).toContain("<title>Witness — Verify evidence</title>");
    expect(html).not.toMatch(/<script[^>]*\bsrc\s*=/i);
    expect(html).not.toMatch(/<link[^>]*href\s*=\s*["']?https?:/i);
    expect(html).toContain(CASE.respondentName);
    expect(html).toContain(CASE.orderNumber);

    const embedded = /<script type="application\/json" id="manifest">([\s\S]*?)<\/script>/.exec(html);
    expect(JSON.parse(embedded![1])).toEqual(manifest);

    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(1);
    expect(() => new Function(scripts[0])).not.toThrow();
    expect(scripts[0]).toContain("crypto.subtle");
  });

  it("embeds a lookup of every sealed media hash, flagged to agree with suspectSeqs", async () => {
    const lookupOf = (html: string) =>
      JSON.parse(/<script type="application\/json" id="lookup">([\s\S]*?)<\/script>/.exec(html)![1]) as Record<
        string,
        { seq: number; suspect: boolean }
      >;
    const hashes = (m: Manifest) => m.entries.flatMap((e) => e.media.map((x) => x.sha256)).sort();

    const intact = lookupOf(buildVerifyHtml(manifest));
    expect(Object.keys(intact).sort()).toEqual([...new Set(hashes(manifest))].sort());
    expect(Object.values(intact).every((v) => !v.suspect)).toBe(true);

    const edited = data.ledger.map((e, i) => (i === 1 ? { ...e, note: "edited later" } : e));
    const m = await buildManifest({ ...data, ledger: edited }, manifest.mediaChecks, NOW, tsaFiles);
    const suspect = manifestSuspects(m);
    expect(suspect.size).toBeGreaterThan(0);
    const broken = lookupOf(buildVerifyHtml(m));
    expect(Object.keys(broken).sort()).toEqual([...new Set(hashes(m))].sort());
    for (const entry of m.entries) {
      for (const media of entry.media) expect(broken[media.sha256].suspect).toBe(suspect.has(broken[media.sha256].seq));
    }
  });

  it("escapes '<' so a note cannot close the manifest script", () => {
    const m = cloneManifest(manifest);
    m.entries[0].note = "</script><script>alert(1)</script>";
    m.case.respondentName = "<b>Alex</b>";
    const html = buildVerifyHtml(m);
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<b>Alex</b>");
    const embedded = /<script type="application\/json" id="manifest">([\s\S]*?)<\/script>/.exec(html);
    expect(JSON.parse(embedded![1]).entries[0].note).toBe(m.entries[0].note);
  });
});

describe("evidence bundle", () => {
  it("zips the report, manifest, verify page, README, every media file and the timestamps", async () => {
    const pdf = await buildReportPdf(manifest, (f) => store.readMedia(f));
    const zip = await buildBundle(manifest, pdf, (f) => store.readMedia(f), tsaFiles);
    const files = unzipSync(zip);

    expect(Object.keys(files).sort()).toEqual(
      [
        "README.txt",
        "manifest.json",
        "report.pdf",
        "verify.html",
        "timestamps/0.tsr",
        ...data.ledger.flatMap((e) => e.media.map((m) => m.file)),
      ].sort(),
    );
    expect(JSON.parse(strFromU8(files["manifest.json"]))).toEqual(manifest);
    expect(sameBytes(files["report.pdf"], pdf)).toBe(true);
    expect(tsaFiles).toHaveLength(1);
    expect(sameBytes(files["timestamps/0.tsr"], tsaFiles[0].bytes)).toBe(true);
    for (const m of data.ledger.flatMap((e: LedgerEntry) => e.media)) {
      expect(await sha256Hex(files[m.file])).toBe(m.sha256);
    }

    const readme = strFromU8(files["README.txt"]);
    expect(readme).toContain("verify.html");
    expect(readme).toContain("certutil -hashfile");
    expect(readme).toContain("shasum -a 256");
    expect(readme).toContain("openssl ts -reply -in timestamps/");
    expect(readme).toContain("This app does not provide legal advice. Talk to an advocate or attorney.");
  });
});

describe("accurate trust story", () => {
  it("prints the trust points, with the caveat only when problems were found", async () => {
    const clean = buildReportText(manifest).find((s) => s.section === "Chain of custody and integrity")!.lines;
    expect(clean).toEqual(expect.arrayContaining(TRUST_POINTS));
    expect(clean).not.toContain(TRUST_CAVEAT);
    expect(clean.join("\n")).not.toMatch(/\bprove/);

    const edited = data.ledger.map((e, i) => (i === 0 ? { ...e, note: "changed later" } : e));
    const bad = await buildManifest({ ...data, ledger: edited }, manifest.mediaChecks, NOW, tsaFiles);
    const lines = buildReportText(bad).find((s) => s.section === "Chain of custody and integrity")!.lines;
    expect(lines.indexOf(TRUST_CAVEAT)).toBe(lines.indexOf(TRUST_POINTS[0]) - 1);
  });
});

describe("broken seal", () => {
  it("suspects the entry whose hash fails and both sides of a broken link", () => {
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

  it("never vouches for a file whose record was re-sealed with a swapped file and hash", async () => {
    // Attacker swaps incident #2's still for another valid JPEG and writes its hash into the ledger.
    const original = data.ledger[0].media.find((m) => m.kind === "snapshot")!;
    const swapped = new Uint8Array([...(await store.readMedia(original.file)), 0x00]);
    const { file, sha256 } = await store.writeMedia(swapped, "jpg");
    const ledger = data.ledger.map((e, i) =>
      i !== 1
        ? e
        : { ...e, media: e.media.map((m) => (m.kind === "snapshot" ? { ...m, file, sha256, bytes: swapped.length } : m)) },
    );

    const checks = await verifyMediaFiles(store, ledger);
    expect(checks.every((c) => c.ok)).toBe(true);
    const m = await buildManifest({ ...data, ledger }, checks, NOW, tsaFiles);
    expect(m.chain.problems).toEqual([{ seq: 1, reason: "entryHash-mismatch" }]);

    const incident = buildReportText(m).find((s) => s.section === "Incident #2")!.lines;
    expect(incident[0]).toBe(BROKEN_SEAL_NOTICE);
    expect(incident.join("\n")).not.toContain("matches its seal");
    expect(buildReportText(m).find((s) => s.section === "Incident #1")!.lines.join("\n")).toContain("matches its seal");

    // Only incident #1's still is embedded; incident #2's is withheld.
    const pdf = await buildReportPdf(m, (f) => store.readMedia(f));
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(8);
    expect(await imageCount(await buildReportPdf(manifest, (f) => store.readMedia(f)))).toBe(2);
    expect(await imageCount(pdf)).toBe(1);

    const lookup = buildHashLookup(m);
    expect(lookup[sha256]).toMatchObject({ seq: 1, suspect: true });
    expect(lookup[original.sha256]).toMatchObject({ seq: 0, suspect: false });
    const html = buildVerifyHtml(m);
    const embedded = /<script type="application\/json" id="lookup">([\s\S]*?)<\/script>/.exec(html);
    expect(JSON.parse(embedded![1])[sha256].suspect).toBe(true);
    expect(html).toContain("Matches a record whose seal is broken");
  });
});

/** The entry without the fields nextEntry sets, so it can be sealed again. */
function bodyOf(e: LedgerEntry): Omit<LedgerEntryBody, "seq" | "prevHash"> {
  const body: Partial<LedgerEntry> = { ...e };
  delete body.seq;
  delete body.prevHash;
  delete body.entryHash;
  return body as Omit<LedgerEntryBody, "seq" | "prevHash">;
}

describe("timestamp that does not match the record", () => {
  it("flags an entry that was edited and the whole chain re-sealed, though verifyChain passes", async () => {
    // Attacker rewrites incident #1's note, then recomputes every hash so the chain verifies.
    const resealed: LedgerEntry[] = [];
    for (const e of data.ledger) {
      const body = bodyOf(e);
      resealed.push(await nextEntry(resealed.at(-1) ?? null, e.seq === 0 ? { ...body, note: "rewritten later" } : body));
    }
    expect((await verifyChain(resealed)).ok).toBe(true);

    const m = await buildManifest({ ...data, ledger: resealed }, manifest.mediaChecks, NOW, tsaFiles);
    expect(m.chain.ok).toBe(true);
    expect(m.timestamps).toEqual([
      expect.objectContaining({ seq: 0, check: "does-not-match", file: "timestamps/0.tsr" }),
      expect.objectContaining({ seq: 1, check: "failed" }),
    ]);
    expect([...manifestSuspects(m)]).toEqual([0]);

    const lines = allLines(m);
    expect(lines).toContain(WARNING);
    const text = lines.join(" | ");
    expect(text).toContain("Integrity: PROBLEMS FOUND");
    expect(text).toContain(
      "Incident #1 (ledger seq 0): its independent timestamp was issued for a different entry hash",
    );
    const incident = buildReportText(m).find((s) => s.section === "Incident #1")!.lines;
    expect(incident[0]).toBe(BROKEN_SEAL_NOTICE);
    expect(incident.join(" | ")).toContain("Independent timestamp (RFC 3161): DOES NOT MATCH this record");
    expect(incident.join(" | ")).not.toContain("matches its seal");

    // verify.html never vouches for its files, and the PDF withholds its still image.
    const lookup = buildHashLookup(m);
    for (const media of resealed[0].media) expect(lookup[media.sha256]).toMatchObject({ seq: 0, suspect: true });
    for (const media of resealed[1].media) expect(lookup[media.sha256]).toMatchObject({ seq: 1, suspect: false });
    expect(buildVerifyHtml(m)).toContain('class="badge status-bad"');
    expect(await imageCount(await buildReportPdf(m, (f) => store.readMedia(f)))).toBe(1);
  });

  it("states the reworded hash-chain trust point", () => {
    expect(TRUST_POINTS[2]).toBe(
      "3. The hash chain shows no incident was removed, inserted or reordered within the chain, unless every later record was re-sealed; the independent timestamps and the head hash in earlier reports detect such a rewrite.",
    );
  });
});

describe("tampering", () => {
  it("flags exactly the overwritten file and the report prints INTEGRITY WARNING", async () => {
    const target = data.ledger[0].media.find((m) => m.kind === "snapshot")!;
    await writeFile(path.join(dir, target.file), new Uint8Array([1, 2, 3]));

    const checks = await verifyMediaFiles(store, data.ledger);
    expect(checks.filter((c) => !c.ok)).toEqual([
      { file: target.file, expected: target.sha256, actual: expect.not.stringMatching(target.sha256), ok: false },
    ]);

    const tampered = await buildManifest(data, checks, NOW, tsaFiles);
    expect(tampered.chain.ok).toBe(true);
    const lines = allLines(tampered);
    expect(lines).toContain(WARNING);
    expect(lines.join("\n")).toContain(target.file);

    // The altered still is not shown as if it were the original, and the PDF still builds.
    const pdf = await buildReportPdf(tampered, (f) => store.readMedia(f));
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(8);
  });

  it("reports a missing file as actual 'missing'", async () => {
    const target = data.ledger[1].media.find((m) => m.kind === "clip")!;
    await unlink(path.join(dir, target.file));
    const checks = await verifyMediaFiles(store, data.ledger);
    expect(checks.find((c) => c.file === target.file)).toEqual({
      file: target.file,
      expected: target.sha256,
      actual: "missing",
      ok: false,
    });
  });
});
