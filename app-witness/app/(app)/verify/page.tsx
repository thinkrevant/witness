"use client";

import { useEffect, useRef, useState } from "react";
import type { LedgerEntry } from "@/lib/evidence/types";
import { sha256Hex } from "@/lib/evidence/hash";
import { verifyFileAgainstManifest, type VerifyResult } from "@/lib/evidence/verify";
import { api } from "@/lib/ui/api";
import { buttonPrimary, card } from "@/lib/ui/styles";

interface Ledger {
  entries: LedgerEntry[];
  /** Records not to vouch for: a broken seal, or a timestamp issued for another hash. */
  suspectSeqs: number[];
}

interface Row {
  id: number;
  name: string;
  /** Null while the file is being checked; "unreadable" if it could not be read. */
  outcome: { result: VerifyResult; sha256: string } | "unreadable" | null;
}

function loggedAtLabel(iso: string): string {
  return new Date(iso).toLocaleString();
}

function ResultLine({ outcome }: { outcome: Row["outcome"] }) {
  if (outcome === null) return <p className="text-stone-600">Checking…</p>;
  if (outcome === "unreadable") {
    return <p className="font-medium text-red-900">❌ This file could not be read.</p>;
  }
  const { result } = outcome;
  if (result.status === "match") {
    return (
      <p className="text-lg font-semibold text-teal-900">
        ✅ Matches sealed original — incident #{result.seq + 1} ({result.kind === "clip" ? "video" : "photo"}),
        logged {loggedAtLabel(result.loggedAt)}
      </p>
    );
  }
  if (result.status === "match-broken-seal") {
    return (
      <p className="text-lg font-semibold text-amber-900">
        ⚠️ Matches a record whose seal is broken — see the report before relying on it
      </p>
    );
  }
  return (
    <p className="text-lg font-semibold text-red-900">
      ❌ Does not match any sealed file. It may have been edited.
    </p>
  );
}

function rowStyle(outcome: Row["outcome"]): string {
  if (outcome === null) return "border-stone-200 bg-white";
  if (outcome === "unreadable") return "border-red-300 bg-red-50";
  if (outcome.result.status === "match") return "border-teal-300 bg-teal-50";
  if (outcome.result.status === "match-broken-seal") return "border-amber-300 bg-amber-50";
  return "border-red-300 bg-red-50";
}

export default function VerifyPage() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [failed, setFailed] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const nextId = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Ledger>("/api/incidents")
      .then(setLedger)
      .catch(() => setFailed(true));
  }, []);

  // A file dropped beside the drop zone must not make the browser open it in place of the app.
  useEffect(() => {
    const ignore = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", ignore);
    window.addEventListener("drop", ignore);
    return () => {
      window.removeEventListener("dragover", ignore);
      window.removeEventListener("drop", ignore);
    };
  }, []);

  async function check(files: FileList | File[]) {
    if (!ledger) return;
    for (const file of Array.from(files)) {
      const id = nextId.current++;
      setRows((r) => [{ id, name: file.name, outcome: null }, ...r]);
      let outcome: Row["outcome"];
      try {
        // The file is read and hashed here in the browser; it is never uploaded.
        const bytes = new Uint8Array(await file.arrayBuffer());
        outcome = {
          result: await verifyFileAgainstManifest(bytes, ledger.entries, ledger.suspectSeqs),
          sha256: await sha256Hex(bytes),
        };
      } catch {
        outcome = "unreadable";
      }
      setRows((r) => r.map((row) => (row.id === id ? { ...row, outcome } : row)));
    }
  }

  if (failed) return <p className="text-stone-700">This page could not be loaded. Please try again.</p>;
  if (!ledger) return <p className="text-stone-600">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Verify a file</h1>
      <p className="text-stone-700">
        Check whether a photo or video is exactly the original that was sealed. Checking happens on this
        device; the file is never uploaded.
      </p>

      <div
        className={`${card} flex flex-col items-center gap-3 border-2 border-dashed px-4 py-10 text-center ${
          over ? "border-teal-700 bg-teal-50" : "border-stone-300"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void check(e.dataTransfer.files);
        }}
      >
        <p className="text-lg font-medium text-stone-800">Drop files here</p>
        <button type="button" className={buttonPrimary} onClick={() => input.current?.click()}>
          Choose file
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/jpeg,video/mp4,*/*"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose files to check"
          onChange={(e) => {
            if (e.target.files) void check(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {ledger.entries.length === 0 && (
        <p className="rounded-lg bg-stone-100 px-3 py-2 text-stone-800">
          Nothing has been logged yet, so no file can match.
        </p>
      )}

      <ul className="flex flex-col gap-3" aria-live="polite">
        {rows.map((row) => (
          <li key={row.id} className={`rounded-xl border p-4 ${rowStyle(row.outcome)}`}>
            <p className="break-all font-medium text-stone-900">{row.name}</p>
            <ResultLine outcome={row.outcome} />
            {row.outcome !== null && row.outcome !== "unreadable" && (
              <p className="mt-1 text-sm text-stone-600">
                Fingerprint <code>{row.outcome.sha256.slice(0, 12)}…</code>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
