import { badRequest } from "@/lib/api/http";
import { requireSession } from "@/lib/auth/session";
import { buildBundle } from "@/lib/report/bundle";
import { buildManifest, readTimestampFiles, verifyMediaFiles } from "@/lib/report/manifest";
import { buildReportPdf } from "@/lib/report/pdf";
import { getStore } from "@/lib/store/store";

/** A neutral name, so a download folder does not give the app away. */
function fileName(now: Date, ext: "pdf" | "zip"): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `daybook-record-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${ext}`;
}

function download(bytes: Uint8Array, contentType: string, name: string): Response {
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

/** GET /api/report?format=pdf|zip: the court report, or the offline-verifiable evidence bundle. */
export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;

  const format = new URL(req.url).searchParams.get("format");
  if (format !== "pdf" && format !== "zip") return badRequest("bad-format");

  const store = getStore();
  const data = await store.read();
  if (!data.case) return Response.json({ error: "no-case" }, { status: 409 });
  if (data.ledger.length === 0) return Response.json({ error: "no-incidents" }, { status: 409 });

  const now = new Date();
  const tsaFiles = await readTimestampFiles(store, data.tsa, data.ledger);
  const manifest = await buildManifest(data, await verifyMediaFiles(store, data.ledger), now, tsaFiles);
  const readMedia = (file: string) => store.readMedia(file);
  const pdf = await buildReportPdf(manifest, readMedia);
  if (format === "pdf") return download(pdf, "application/pdf", fileName(now, "pdf"));

  const zip = await buildBundle(manifest, pdf, readMedia, tsaFiles);
  return download(zip, "application/zip", fileName(now, "zip"));
}
