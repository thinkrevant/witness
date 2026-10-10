"use client";

import AppLink from "@/components/AppLink";
import { useEffect, useState } from "react";
import type { ChainReport } from "@/lib/evidence/types";
import type { MediaCheck } from "@/lib/report/manifest";
import { api } from "@/lib/ui/api";
import { buttonPrimary, buttonSecondary, card, linkClass } from "@/lib/ui/styles";

interface ReportStatus {
  hasCase: boolean;
  incidents: number;
  chain: ChainReport;
  mediaChecks: MediaCheck[];
  /** Records not to rely on: a broken seal, or a timestamp issued for another hash. */
  suspectSeqs: number[];
}

type Format = "pdf" | "zip";

function IntegrityStatus({ status }: { status: ReportStatus }) {
  const badFiles = status.mediaChecks.filter((c) => !c.ok);
  if (status.chain.ok && badFiles.length === 0 && status.suspectSeqs.length === 0) {
    return (
      <p role="status" className="rounded-lg bg-teal-50 px-3 py-2 font-medium text-teal-900">
        All {status.incidents} records and {status.mediaChecks.length} files match their seals ✓
      </p>
    );
  }
  return (
    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-900">
      <p className="font-semibold">Some records or files do not match their seals.</p>
      <p className="mt-1 text-sm">
        {!status.chain.ok && "The record chain has a problem. "}
        {status.chain.ok &&
          status.suspectSeqs.length > 0 &&
          `The timestamp of incident ${status.suspectSeqs.map((s) => `#${s + 1}`).join(", ")} does not match its record. `}
        {badFiles.length > 0 && `${badFiles.length} file(s) are missing or changed. `}
        The report will say so clearly under &ldquo;INTEGRITY WARNING&rdquo;. Talk to your advocate before
        sharing it.
      </p>
    </div>
  );
}

/** Saves a response as a file, using the name the server chose. */
async function saveDownload(format: Format): Promise<void> {
  const res = await fetch(`/api/report?format=${format}`, { cache: "no-store" });
  if (res.status === 401) {
    window.location.replace("/lock");
    return;
  }
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const name =
    /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `daybook-record.${format}`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function ReportPage() {
  const [status, setStatus] = useState<ReportStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<ReportStatus>("/api/report/status")
      .then(setStatus)
      .catch(() => setFailed(true));
  }, []);

  async function download(format: Format) {
    setBusy(format);
    setMessage("");
    try {
      await saveDownload(format);
    } catch {
      setMessage("The file could not be made. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (failed) return <p className="text-stone-700">This page could not be loaded. Please try again.</p>;
  if (!status) return <p className="text-stone-600">Loading…</p>;

  const blocked = !status.hasCase
    ? { text: "Add your case details first. They go on the cover of the report.", href: "/setup", link: "Set up your case" }
    : status.incidents === 0
      ? { text: "Log at least one moment from your doorbell first.", href: "/", link: "Go to doorbell activity" }
      : null;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Report</h1>
      {blocked ? (
        <p className="rounded-lg bg-stone-100 px-3 py-2 text-stone-800">
          {blocked.text}{" "}
          <AppLink href={blocked.href} className={linkClass}>
            {blocked.link}
          </AppLink>
        </p>
      ) : (
        <IntegrityStatus status={status} />
      )}

      <section className={`${card} flex flex-col gap-2`}>
        <h2 className="text-lg font-semibold">Report for police, a lawyer or the court</h2>
        <p className="text-stone-700">
          A PDF with your case details, a timeline, one page per incident with the still image and its
          fingerprints, an integrity check, and a statement you can sign.
        </p>
        <button
          type="button"
          className={`${buttonPrimary} self-start`}
          disabled={blocked !== null || busy !== null}
          onClick={() => download("pdf")}
        >
          {busy === "pdf" ? "Preparing…" : "Download report (PDF)"}
        </button>
      </section>

      <section className={`${card} flex flex-col gap-2`}>
        <h2 className="text-lg font-semibold">Evidence bundle</h2>
        <p className="text-stone-700">
          A .zip with the report, the original video and image files exactly as Ring sent them, and a
          verify page anyone can open offline to check that no file was changed. Give this to whoever needs
          the original footage.
        </p>
        <button
          type="button"
          className={`${buttonSecondary} self-start`}
          disabled={blocked !== null || busy !== null}
          onClick={() => download("zip")}
        >
          {busy === "zip" ? "Preparing…" : "Download evidence bundle (.zip)"}
        </button>
      </section>

      {message && (
        <p role="alert" className="text-red-800">
          {message}
        </p>
      )}
      <p className="text-sm text-stone-600">
        Files are saved with a plain name (daybook-record-…) so they do not stand out in your downloads.
      </p>
    </div>
  );
}
