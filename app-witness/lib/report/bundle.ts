// The evidence bundle: a zip anyone can verify offline.
import { strToU8, zipSync, type Zippable } from "fflate";
import { tsaBundlePath, type Manifest, type TsaFile } from "./manifest";
import { LEGAL_DISCLAIMER } from "./pdf";
import { buildVerifyHtml } from "./verify-html";

const README = [
  "WITNESS EVIDENCE BUNDLE",
  "=======================",
  "",
  "This folder holds doorbell recordings sealed by Witness, and everything needed to check",
  "that they have not been changed. Checking works offline and does not need Witness.",
  "",
  "WHAT EACH FILE IS",
  "-----------------",
  "report.pdf       The report: case details, a timeline, one page per incident, the",
  "                 integrity check and a declaration to sign.",
  "media/           The original files exactly as downloaded from Ring. Each file is",
  "                 named after its SHA-256 fingerprint (.jpg = still image, .mp4 = video).",
  "manifest.json    The full sealed record: every ledger entry with its fingerprints, Ring",
  "                 request IDs, download times and the hash chain.",
  "verify.html      A page that checks files against manifest.json in your browser.",
  "timestamps/      Independent RFC 3161 timestamps (N.tsr, one per ledger entry N), when",
  "                 the timestamp authority could be reached. May be absent.",
  "README.txt       This file.",
  "",
  "HOW TO VERIFY",
  "-------------",
  "Easiest: open verify.html in a web browser (double-click it), then drop files from the",
  "media folder onto it. It says whether each file matches a sealed original.",
  "",
  "By hand: compute a file's SHA-256 fingerprint and compare it with manifest.json and",
  "report.pdf. If even one byte changed, the fingerprint is completely different.",
  "  Windows:        certutil -hashfile <file> SHA256",
  "  macOS or Linux: shasum -a 256 <file>",
  "",
  "Timestamps: openssl ts -reply -in timestamps/N.tsr -text",
  "shows when the timestamp authority (FreeTSA) signed the hash of ledger entry N. Its",
  "\"Message data\" should equal that entry's entryHash in manifest.json.",
  "",
  "The hash chain: each entry's entryHash is the SHA-256 of the entry as canonical JSON",
  "(keys sorted, no spaces, without the entryHash field). Each entry stores the previous",
  "entry's hash in prevHash; the first stores 64 zeros. Compare the entry count and the",
  "last entry's hash with any earlier report to see whether entries were removed at the end.",
  "",
  "Footage marked \"Ring Developer Playground simulated footage\" in the report came from",
  "Ring's developer test environment, not a real doorbell.",
  "",
  LEGAL_DISCLAIMER,
  "",
].join("\r\n");

/** Zips the report, manifest, verify page, README, the sealed media and the timestamp responses. */
export async function buildBundle(
  manifest: Manifest,
  pdf: Uint8Array,
  readMedia: (file: string) => Promise<Uint8Array>,
  tsaFiles: TsaFile[],
): Promise<Uint8Array> {
  // Media, PDFs and timestamps are already compressed or tiny: store them as-is.
  const files: Zippable = {
    "report.pdf": [pdf, { level: 0 }],
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2) + "\n"),
    "verify.html": strToU8(buildVerifyHtml(manifest)),
    "README.txt": strToU8(README),
  };
  for (const media of manifest.entries.flatMap((e) => e.media)) {
    if (media.file in files) continue;
    try {
      files[media.file] = [await readMedia(media.file), { level: 0 }];
    } catch {
      // A missing file is already reported in manifest.mediaChecks and the PDF.
    }
  }
  for (const tsa of tsaFiles) files[tsaBundlePath(tsa.seq)] = [tsa.bytes, { level: 0 }];
  return zipSync(files);
}
