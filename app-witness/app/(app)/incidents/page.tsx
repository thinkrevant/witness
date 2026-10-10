"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import SealedBadge from "@/components/SealedBadge";
import type { ChainReport, LedgerEntry } from "@/lib/evidence/types";
import type { MediaCheck, TimestampCheck } from "@/lib/report/manifest";
import { api } from "@/lib/ui/api";
import { card } from "@/lib/ui/styles";

interface EntryStatus {
  seq: number;
  /** False when the record's seal is broken, its timestamp names another hash, or a file changed. */
  intact: boolean;
  timestamp: TimestampCheck;
}

interface IncidentsResponse {
  entries: LedgerEntry[];
  chain: ChainReport;
  mediaChecks: MediaCheck[];
  suspectSeqs: number[];
  status: EntryStatus[];
}

function mediaUrl(file: string): string {
  return `/api/media/${file.split("/").map(encodeURIComponent).join("/")}`;
}

function IntegrityStatus({ data }: { data: IncidentsResponse }) {
  const allIntact =
    data.chain.ok && data.mediaChecks.every((c) => c.ok) && data.status.every((s) => s.intact);
  if (allIntact) {
    return (
      <p role="status" className="rounded-lg bg-teal-50 px-3 py-2 font-medium text-teal-900">
        All records intact ✓
      </p>
    );
  }
  const seqs = new Set([
    ...data.chain.problems.map((p) => p.seq),
    ...data.suspectSeqs,
    ...data.status.filter((s) => !s.intact).map((s) => s.seq),
  ]);
  const numbers = [...seqs].sort((a, b) => a - b).map((seq) => `#${seq + 1}`);
  return (
    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-900">
      <p className="font-semibold">⚠️ Some records or files do not match their seals.</p>
      <p className="mt-1 text-sm">
        {numbers.length > 0 ? `Incidents with a problem: ${numbers.join(", ")}. ` : ""}Keep your files as
        they are, see the report for details, and talk to your advocate before sharing them.
      </p>
    </div>
  );
}

function IncidentCard({ entry, status }: { entry: LedgerEntry; status: EntryStatus | undefined }) {
  const snapshot = entry.media.find((m) => m.kind === "snapshot");
  const clip = entry.media.find((m) => m.kind === "clip");
  return (
    <li className="relative pl-6">
      <span aria-hidden="true" className="absolute left-[-7px] top-5 h-3 w-3 rounded-full bg-teal-700" />
      <article className={`${card} flex flex-col gap-3`}>
        <p className="font-semibold">{new Date(entry.eventStart).toLocaleString()}</p>
        {entry.source === "demo" && (
          <p className="text-sm font-medium text-amber-900">Ring Developer Playground simulated footage</p>
        )}
        {snapshot && (
          <Image
            unoptimized
            src={mediaUrl(snapshot.file)}
            alt="Sealed doorbell still"
            width={1920}
            height={1080}
            className="h-auto w-full rounded-lg bg-stone-200"
          />
        )}
        {clip && (
          <video controls preload="metadata" className="w-full rounded-lg bg-black">
            <source src={mediaUrl(clip.file)} type={clip.contentType} />
          </video>
        )}
        {entry.clipUnavailable && <p className="text-sm text-stone-700">Clip unavailable</p>}
        {entry.note && <p className="whitespace-pre-wrap text-stone-800">{entry.note}</p>}
        {snapshot && (
          <SealedBadge
            sha256={snapshot.sha256}
            intact={status?.intact ?? false}
            timestamp={status?.timestamp ?? "none"}
          />
        )}
      </article>
    </li>
  );
}

export default function IncidentsPage() {
  const [data, setData] = useState<IncidentsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<IncidentsResponse>("/api/incidents")
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="text-stone-700">The incident log could not be loaded. Please try again.</p>;
  if (!data) return <p className="text-stone-600">Loading…</p>;

  const entries = [...data.entries].sort((a, b) => a.eventStart - b.eventStart);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Incident log</h1>
      {(entries.length > 0 || !data.chain.ok) && <IntegrityStatus data={data} />}
      {entries.length === 0 ? (
        <div className={`${card} text-center`}>
          <p className="font-medium text-stone-800">Nothing logged yet</p>
          <p className="mt-1 text-sm text-stone-600">
            Moments you log from your doorbell activity appear here, sealed.
          </p>
        </div>
      ) : (
        <ol className="ml-2 flex flex-col gap-6 border-l-2 border-teal-200">
          {entries.map((entry) => (
            <IncidentCard
              key={entry.entryHash}
              entry={entry}
              status={data.status.find((s) => s.seq === entry.seq)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
