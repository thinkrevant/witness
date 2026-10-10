// Builds the court report: a pure text model (buildReportText) drawn onto US Letter pages with pdf-lib.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { sha256Hex } from "@/lib/evidence/hash";
import type { ChainReport, LedgerEntry, MediaRecord } from "@/lib/evidence/types";
import { manifestSuspects, type Manifest } from "./manifest";

export interface ReportSection {
  section: string;
  lines: string[];
}

export const REPORT_TITLE = "Record of Protective Order Violations";
/** The PDF's metadata title: neutral, so a file browser or viewer's title bar does not give the app away. */
export const PDF_METADATA_TITLE = "Daybook record";
export const INTEGRITY_WARNING = "INTEGRITY WARNING";
export const LEGAL_DISCLAIMER = "This app does not provide legal advice. Talk to an advocate or attorney.";
const DEMO_LABEL = "Ring Developer Playground simulated footage";
export const BROKEN_SEAL_NOTICE = "This record's seal is broken — do not rely on it.";
const ALTERED_NOTICE = "(some characters could not be shown here; the exact text is in manifest.json)";
const BLANK = "______________________________";

// ---------------------------------------------------------------- text safety

/** Code points the standard PDF fonts can draw (WinAnsi). */
export const WIN_ANSI_CODE_POINTS: number[] = [
  ...Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => 0x20 + i),
  ...Array.from({ length: 0xff - 0xa0 + 1 }, (_, i) => 0xa0 + i),
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
];
const WIN_ANSI = new Set(WIN_ANSI_CODE_POINTS);

/** Replaces whitespace with a plain space and anything else the standard fonts cannot draw with "?". */
export function toWinAnsi(raw: string): { text: string; altered: boolean } {
  let text = "";
  let altered = false;
  for (const ch of raw) {
    if (WIN_ANSI.has(ch.codePointAt(0)!)) text += ch;
    else if (/\s/.test(ch)) text += " ";
    else {
      text += "?";
      altered = true;
    }
  }
  return { text, altered };
}

/** One drawable line per input line, plus a notice when anything had to be replaced. */
function clean(raw: string): string[] {
  let altered = false;
  const lines = raw.split(/\r\n|\r|\n/).map((part) => {
    const r = toWinAnsi(part);
    altered ||= r.altered;
    return r.text;
  });
  return altered ? [...lines, ALTERED_NOTICE] : lines;
}

/** Greedy word wrap; words wider than the line (such as hashes) are split by character. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= maxWidth;
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current !== "") lines.push(current);
    current = "";
    for (const ch of word) {
      if (current !== "" && !fits(current + ch)) {
        lines.push(current);
        current = "";
      }
      current += ch;
    }
  }
  lines.push(current);
  return lines;
}

// ---------------------------------------------------------------- text model

/** The trust story, stated no more strongly than the checks support. */
export const TRUST_POINTS = [
  "1. Ring's watermark in each image shows the Ring device and the time the image was downloaded from Ring.",
  "2. The SHA-256 fingerprints show the files match the fingerprints recorded when they were sealed.",
  "3. The hash chain shows no incident was removed, inserted or reordered within the chain, unless every later record was re-sealed; the independent timestamps and the head hash in earlier reports detect such a rewrite.",
  "4. Where present, an independent RFC 3161 timestamp shows the record's fingerprint existed at the stated time.",
  "5. The chain-of-custody records when each file was retrieved from Ring and the Ring request ID.",
];
export const TRUST_CAVEAT = "These points hold only for records without the problems listed above.";

/** Local time (of the machine making the report) and UTC. */
function when(value: number | string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${localTime(d)} (UTC ${d.toISOString()})`;
}

function localTime(d: Date): string {
  // ICU may use narrow no-break spaces; toWinAnsi turns them into plain spaces.
  return toWinAnsi(d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "long" })).text;
}

function orNotGiven(value: string): string {
  return value.trim() === "" ? "(not given)" : value;
}

function shortId(id: string): string {
  const tail = id.split(".").at(-1) ?? id;
  return tail.length > 10 ? `${tail.slice(0, 10)}…` : tail;
}

function incidentNumber(seq: number): number {
  return seq + 1;
}

/** Incidents in the order the events happened. */
export function incidentsInOrder(m: Manifest): LedgerEntry[] {
  return [...m.entries].sort((a, b) => a.eventStart - b.eventStart || a.seq - b.seq);
}

const CHAIN_REASONS: Record<ChainReport["problems"][number]["reason"], string> = {
  "prevHash-mismatch":
    "does not link to the entry before it (an entry may have been removed, inserted or reordered)",
  "entryHash-mismatch": "its contents changed after it was sealed",
  "seq-gap": "is out of sequence (an entry may be missing)",
};

function problems(m: Manifest): string[] {
  const chain = m.chain.problems.map(
    (p) => `- Incident #${incidentNumber(p.seq)} (ledger seq ${p.seq}): the record ${CHAIN_REASONS[p.reason]}.`,
  );
  const timestamps = m.timestamps
    .filter((t) => t.check === "does-not-match")
    .map(
      (t) =>
        `- Incident #${incidentNumber(t.seq)} (ledger seq ${t.seq}): its independent timestamp was issued for a different entry hash, so the record may have been changed and re-sealed after it was timestamped.`,
    );
  const media = m.mediaChecks
    .filter((c) => !c.ok)
    .map((c) =>
      c.actual === "missing"
        ? `- File ${c.file} is missing or cannot be read (sealed SHA-256 ${c.expected}).`
        : `- File ${c.file} does not match its seal (sealed SHA-256 ${c.expected}, now ${c.actual}).`,
    );
  return [...chain, ...timestamps, ...media];
}

function cover(m: Manifest): ReportSection {
  const ok = problems(m).length === 0;
  return {
    section: REPORT_TITLE,
    lines: [
      "Prepared with Witness from sealed Ring doorbell recordings.",
      "",
      ...clean(`Petitioner: ${orNotGiven(m.case.petitionerName)}`),
      ...clean(`Respondent: ${orNotGiven(m.case.respondentName)}`),
      ...clean(`Order or case number: ${orNotGiven(m.case.orderNumber)}`),
      ...clean(`Court: ${orNotGiven(m.case.court)}`),
      "",
      `Report generated: ${when(m.generatedAt)}`,
      `Incidents recorded: ${m.entries.length}`,
      `Ledger entries: ${m.head.count}`,
      `Head (last) entry hash: ${m.head.entryHash ?? "none"}`,
      ok
        ? "Integrity: every record and file matched its seal when this report was made."
        : "Integrity: PROBLEMS FOUND. See the page \"Chain of custody and integrity\".",
      "",
      LEGAL_DISCLAIMER,
    ],
  };
}

function orderDetails(m: Manifest): ReportSection {
  const c = m.case;
  return {
    section: "Order details",
    lines: [
      "As entered by the petitioner in Witness.",
      "",
      ...clean(`Petitioner: ${orNotGiven(c.petitionerName)}`),
      ...clean(`Respondent: ${orNotGiven(c.respondentName)}`),
      ...clean(`Order or case number: ${orNotGiven(c.orderNumber)}`),
      ...clean(`Court: ${orNotGiven(c.court)}`),
      ...clean(`Date issued: ${orNotGiven(c.issuedOn)}`),
      ...clean(`Expiry date: ${orNotGiven(c.expiresOn)}`),
      ...clean(`Date served on the respondent: ${orNotGiven(c.servedOn)}`),
      "",
      "## Conditions of the order",
      ...clean(orNotGiven(c.conditions)),
    ],
  };
}

const NOTE_CELL_LIMIT = 140;

function timeline(m: Manifest): ReportSection {
  const rows = incidentsInOrder(m).map((e) => {
    const start = new Date(e.eventStart);
    let note = toWinAnsi(e.note.replace(/\s+/g, " ").trim()).text;
    if (note.length > NOTE_CELL_LIMIT) note = `${note.slice(0, NOTE_CELL_LIMIT)}… (continued on the incident page)`;
    return [
      String(incidentNumber(e.seq)),
      localTime(start),
      start.toISOString(),
      shortId(e.ringEventId),
      note === "" ? "(no note)" : note,
    ]
      .map((cell) => toWinAnsi(cell).text)
      .join("\t");
  });
  return {
    section: "Incident timeline",
    lines: [
      "Listed by when each event happened. The # is the order in which incidents were logged.",
      "Times are shown in local time (of the computer that made this report) and in UTC.",
      "",
      "#\tDate and time (local)\tDate and time (UTC)\tRing event ID\tNote",
      ...rows,
    ],
  };
}

function mediaLines(m: Manifest, media: MediaRecord, suspect: boolean): string[] {
  const check = m.mediaChecks.find((c) => c.file === media.file && c.expected === media.sha256);
  const status = !check
    ? "not checked"
    : check.ok
      ? suspect
        ? "the file matches the fingerprint written in this record, but the record's seal is broken, so that fingerprint may have been changed"
        : "matches its seal"
      : check.actual === "missing"
        ? "FILE MISSING"
        : "DOES NOT MATCH ITS SEAL";
  const kind = media.kind === "snapshot" ? "Snapshot (still image)" : "Clip (video)";
  return [
    // The bundle file is media/<SHA-256>.<ext>, so the hash line also names the file.
    `## ${kind}: ${media.bytes.toLocaleString("en-US")} bytes, ${toWinAnsi(media.contentType).text}`,
    `SHA-256: ${media.sha256}`,
    media.ringMediaTimestamp === null
      ? "Ring X-Media-Timestamp: not provided"
      : `Ring X-Media-Timestamp: ${media.ringMediaTimestamp} = ${when(media.ringMediaTimestamp)}`,
    ...(media.ringMediaDuration === null ? [] : [`Ring X-Media-Duration: ${media.ringMediaDuration} ms`]),
    ...clean(`Ring request ID: ${media.ringRequestId ?? "not provided"}`),
    `Retrieved from Ring: ${when(media.retrievedAt)}`,
    `Fingerprint check when this report was made: ${status}`,
  ];
}

const TIMESTAMP_TEXT: Record<Manifest["timestamps"][number]["check"], string> = {
  "covers-record": "ok, issued for this record's entry hash",
  "does-not-match": "DOES NOT MATCH this record (it was issued for a different entry hash)",
  failed: "failed",
};

function timestampLine(m: Manifest, seq: number): string {
  const t = m.timestamps.find((x) => x.seq === seq);
  if (!t) return "Independent timestamp (RFC 3161): none";
  const where = t.file ? `; bundle file ${t.file}` : "";
  return `Independent timestamp (RFC 3161): ${TIMESTAMP_TEXT[t.check]} (requested ${when(t.requestedAt)}${where})`;
}

function incident(m: Manifest, e: LedgerEntry): ReportSection {
  const suspect = manifestSuspects(m).has(e.seq);
  return {
    section: `Incident #${incidentNumber(e.seq)}`,
    lines: [
      ...(suspect ? [BROKEN_SEAL_NOTICE] : []),
      `Event start: ${when(e.eventStart)}`,
      `Event end: ${when(e.eventEnd)}`,
      `Logged and sealed: ${when(e.loggedAt)}`,
      ...(e.source === "demo" ? [DEMO_LABEL] : []),
      ...clean(`Ring event ID: ${e.ringEventId}`),
      ...clean(`Ring device ID: ${e.deviceId}`),
      ...(e.clipUnavailable ? ["Clip unavailable: Ring did not provide a video for this event; only the still image was sealed."] : []),
      "## Note",
      ...(e.note.trim() === "" ? ["(no note)"] : clean(e.note)),
      ...e.media.flatMap((media) => mediaLines(m, media, suspect)),
      "## Ledger record",
      `Entry hash (ledger seq ${e.seq}): ${e.entryHash}`,
      `Previous entry hash: ${e.prevHash}`,
      timestampLine(m, e.seq),
    ],
  };
}

function integrity(m: Manifest): ReportSection {
  const found = problems(m);
  const okFiles = m.mediaChecks.filter((c) => c.ok).length;
  const suspect = manifestSuspects(m);
  const suspectFiles = new Set(
    m.entries.filter((e) => suspect.has(e.seq)).flatMap((e) => e.media.map((media) => media.file)),
  );
  const fileLabel = (ok: boolean, file: string) =>
    !ok ? "PROBLEM" : suspectFiles.has(file) ? "Matches its record, but the record's seal is broken" : "Matches";
  const custody = incidentsInOrder(m).map((e) => {
    const files = e.media
      .map(
        (media) =>
          `${media.kind === "snapshot" ? "Snapshot" : "Clip"} retrieved ${when(media.retrievedAt)}, Ring request ${media.ringRequestId ?? "not provided"}`,
      )
      .join("; ");
    return toWinAnsi(`Incident #${incidentNumber(e.seq)}: logged ${when(e.loggedAt)}. ${files}.`).text;
  });
  return {
    section: "Chain of custody and integrity",
    lines: [
      ...(found.length > 0
        ? [INTEGRITY_WARNING, "These problems were found when this report was made:", ...found, ""]
        : []),
      "## Hash chain",
      `Ledger entries: ${m.head.count}`,
      `Head (last) entry hash: ${m.head.entryHash ?? "none"}`,
      m.chain.ok
        ? "Intact: every entry links to the one before it, and every entry still matches its own hash."
        : "Broken: see the problems listed above.",
      "Compare the entry count and head hash with any earlier report. If they differ, entries were added or removed at the end.",
      "## Media files",
      `${okFiles} of ${m.mediaChecks.length} files match the SHA-256 fingerprints recorded when they were sealed.`,
      ...m.mediaChecks.map((c) => `${fileLabel(c.ok, c.file)}: ${c.file}`),
      "## Chain of custody",
      ...custody,
      "## What these records show",
      ...(found.length > 0 ? [TRUST_CAVEAT] : []),
      ...TRUST_POINTS,
    ],
  };
}

function howToVerify(): ReportSection {
  return {
    section: "How to verify",
    lines: [
      "Anyone can check these files without Witness and without an internet connection.",
      "## Easiest: verify.html",
      "1. Unzip the evidence bundle.",
      "2. Open verify.html in a web browser (double-click it). It works offline.",
      "3. Drop one or more files from the media folder onto the page. It says whether each file matches a sealed original.",
      "## With the command line",
      "Windows: certutil -hashfile <file> SHA256",
      "macOS or Linux: shasum -a 256 <file>",
      "Compare the result with the SHA-256 in this report and in manifest.json. If even one byte of a file changed, its fingerprint is completely different.",
      "## Independent timestamps",
      "openssl ts -reply -in timestamps/N.tsr -text",
      "This shows when the timestamp authority (FreeTSA) signed the hash of ledger entry N. The \"Message data\" it shows should equal that entry's hash in this report.",
      "## The hash chain",
      "manifest.json lists every ledger entry. Each entry's hash is the SHA-256 of the entry as canonical JSON (keys sorted, no spaces, without the entryHash field). Each entry stores the previous entry's hash; the first stores 64 zeros.",
    ],
  };
}

function declaration(): ReportSection {
  return {
    section: "Declaration",
    lines: [
      `I, ${BLANK}, declare that the attached video and images were recorded by my Ring doorbell at ${BLANK} and downloaded using Witness on ${BLANK}. They have not been altered, edited or re-encoded since they were downloaded. The SHA-256 fingerprints in this report identify each file exactly.`,
      "",
      "",
      `Signature: ${BLANK}          Date: ${BLANK}`,
      "",
      `Printed name: ${BLANK}`,
      "",
      "",
      LEGAL_DISCLAIMER,
      "An advocate or attorney can tell you whether your court needs different wording, a notary, or a statement made under penalty of perjury.",
    ],
  };
}

/** The whole report as plain lines, in page order. buildReportPdf draws exactly this. */
export function buildReportText(manifest: Manifest): ReportSection[] {
  return [
    cover(manifest),
    orderDetails(manifest),
    timeline(manifest),
    ...incidentsInOrder(manifest).map((e) => incident(manifest, e)),
    integrity(manifest),
    howToVerify(),
    declaration(),
  ];
}

// ---------------------------------------------------------------- drawing

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const BOTTOM = MARGIN + 14;
const BODY = 9.5;
const LEAD = 12;
const TABLE_SIZE = 8.5;
const TABLE_LEAD = 11;
const TABLE_WIDTHS = [22, 122, 122, 76, 162];
const IMAGE_MAX_H = 160;
const INK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.4, 0.4, 0.4);
const RED = rgb(0.75, 0.05, 0.05);

class PageWriter {
  private page!: PDFPage;
  private y = 0;
  private section = "";
  private tableHeader: string[] | null = null;

  constructor(
    private readonly doc: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
  ) {}

  startSection(title: string, isCover: boolean) {
    this.section = title;
    this.tableHeader = null;
    this.newPage();
    const size = isCover ? 22 : 16;
    for (const part of wrapText(title, this.bold, size, CONTENT_W)) {
      this.text(part, this.bold, size, INK);
      this.y -= size + 6;
    }
    this.y -= 8;
  }

  private newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  private continueOnNewPage() {
    this.newPage();
    this.text(`${this.section} (continued)`, this.bold, 12, INK);
    this.y -= 22;
  }

  private ensure(height: number) {
    if (this.y - height < BOTTOM) this.continueOnNewPage();
  }

  /** Every string is made WinAnsi-safe again here, so drawing can never throw on a character. */
  private text(s: string, font: PDFFont, size: number, color: typeof INK, x = MARGIN) {
    this.page.drawText(toWinAnsi(s).text, { x, y: this.y - size, size, font, color });
  }

  async image(entry: LedgerEntry, suspect: boolean, readMedia: (file: string) => Promise<Uint8Array>) {
    const snapshot = entry.media.find((m) => m.kind === "snapshot");
    if (!snapshot) return;
    let image: PDFImage | null = null;
    let reason = "it is missing or no longer matches its sealed fingerprint";
    if (suspect) {
      // The recorded fingerprint itself may have been edited, so the file cannot be shown as sealed.
      reason = "this record's seal is broken, so the file cannot be confirmed as the sealed original";
    } else {
      try {
        const bytes = await readMedia(snapshot.file);
        if ((await sha256Hex(bytes)) === snapshot.sha256) {
          reason = "it could not be displayed here; the sealed file is in the evidence bundle";
          image = await this.doc.embedJpg(bytes);
        }
      } catch {
        // Falls through to the explanation below.
      }
    }
    if (!image) {
      this.line(`Still image not shown: ${reason}.`, RED);
      this.y -= LEAD / 2;
      return;
    }
    const scale = Math.min(CONTENT_W / image.width, IMAGE_MAX_H / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    this.page.drawImage(image, { x: MARGIN, y: this.y - height, width, height });
    this.y -= height + 4;
    this.text("Sealed still image, scaled to fit. The original file is in the evidence bundle.", this.regular, 8, GREY);
    this.y -= 18;
  }

  line(raw: string, color = INK) {
    if (raw === "") {
      this.y -= LEAD / 2;
    } else if (raw === BROKEN_SEAL_NOTICE) {
      this.ensure(LEAD + 4);
      this.text(raw, this.bold, BODY + 1, RED);
      this.y -= LEAD + 4;
    } else if (raw === INTEGRITY_WARNING) {
      this.ensure(24);
      this.text(raw, this.bold, 15, RED);
      this.y -= 22;
    } else if (raw.startsWith("## ")) {
      this.y -= LEAD / 3;
      this.ensure(LEAD * 2);
      this.text(raw.slice(3), this.bold, BODY + 1, INK);
      this.y -= LEAD + 1;
    } else if (raw.includes("\t")) {
      this.row(raw.split("\t"));
    } else {
      for (const part of wrapText(raw, this.regular, BODY, CONTENT_W)) {
        this.ensure(LEAD);
        this.text(part, this.regular, BODY, color);
        this.y -= LEAD;
      }
    }
  }

  private row(cells: string[]) {
    const isHeader = this.tableHeader === null;
    if (isHeader) this.tableHeader = cells;
    const height = this.rowHeight(cells, isHeader);
    if (this.y - height < BOTTOM) {
      this.continueOnNewPage();
      if (!isHeader) this.drawRow(this.tableHeader!, true);
    }
    this.drawRow(cells, isHeader);
  }

  private rowHeight(cells: string[], header: boolean): number {
    const font = header ? this.bold : this.regular;
    const lines = cells.map((c, i) => wrapText(c, font, TABLE_SIZE, TABLE_WIDTHS[i] - 6).length);
    return Math.max(...lines) * TABLE_LEAD + 5;
  }

  private drawRow(cells: string[], header: boolean) {
    const font = header ? this.bold : this.regular;
    const height = this.rowHeight(cells, header);
    let x = MARGIN;
    cells.forEach((cell, i) => {
      wrapText(cell, font, TABLE_SIZE, TABLE_WIDTHS[i] - 6).forEach((part, j) => {
        const y = this.y - TABLE_SIZE - j * TABLE_LEAD;
        this.page.drawText(toWinAnsi(part).text, { x, y, size: TABLE_SIZE, font, color: INK });
      });
      x += TABLE_WIDTHS[i];
    });
    this.y -= height;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 2 },
      end: { x: MARGIN + CONTENT_W, y: this.y + 2 },
      thickness: header ? 0.8 : 0.3,
      color: GREY,
    });
    this.y -= 3;
  }

  footers(generatedAt: string) {
    const pages = this.doc.getPages();
    pages.forEach((page, i) => {
      const label = `Page ${i + 1} of ${pages.length}`;
      page.drawText(`Witness report generated ${generatedAt}`, { x: MARGIN, y: 30, size: 8, font: this.regular, color: GREY });
      page.drawText(label, {
        x: PAGE_W - MARGIN - this.regular.widthOfTextAtSize(label, 8),
        y: 30,
        size: 8,
        font: this.regular,
        color: GREY,
      });
    });
  }
}

/** The report PDF: one page per section (longer sections continue on extra pages). */
export async function buildReportPdf(
  manifest: Manifest,
  readMedia: (file: string) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const generated = new Date(manifest.generatedAt);
  doc.setTitle(PDF_METADATA_TITLE);
  doc.setCreator("Witness");
  doc.setProducer("Witness (pdf-lib)");
  doc.setCreationDate(generated);
  doc.setModificationDate(generated);

  const writer = new PageWriter(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
  );
  for (const [i, section] of buildReportText(manifest).entries()) {
    writer.startSection(section.section, i === 0);
    const incident = /^Incident #(\d+)$/.exec(section.section);
    if (incident) {
      const entry = manifest.entries.find((e) => incidentNumber(e.seq) === Number(incident[1]));
      if (entry) await writer.image(entry, manifestSuspects(manifest).has(entry.seq), readMedia);
    }
    for (const line of section.lines) writer.line(line);
  }
  writer.footers(manifest.generatedAt);
  return doc.save({ useObjectStreams: false });
}
