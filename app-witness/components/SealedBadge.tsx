import type { TimestampCheck } from "@/lib/report/manifest";
import { fingerprintLabel } from "@/lib/ui/labels";

const TSA_TEXT: Record<TimestampCheck, string> = {
  "covers-record": "Timestamped ✓",
  "does-not-match": "⚠️ Timestamp does not match",
  failed: "Timestamp unavailable",
  none: "No timestamp",
};

/**
 * Shows whether the record still matches its seal, with the snapshot fingerprint, and whether
 * the independent timestamp covers the record as it is now.
 */
export default function SealedBadge({
  sha256,
  intact,
  timestamp,
}: {
  sha256: string;
  intact: boolean;
  timestamp: TimestampCheck;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {intact ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-3 py-1 font-medium text-teal-800 ring-1 ring-teal-200">
          <span aria-hidden="true">✅</span>
          {fingerprintLabel(sha256)}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 font-semibold text-red-900 ring-1 ring-amber-400">
          <span aria-hidden="true">⚠️</span>
          Seal broken — see report
        </span>
      )}
      <span
        className={`rounded-full px-3 py-1 ${
          timestamp === "does-not-match"
            ? "bg-amber-50 font-semibold text-red-900 ring-1 ring-amber-400"
            : "bg-stone-100 text-stone-700"
        }`}
      >
        {TSA_TEXT[timestamp]}
      </span>
    </div>
  );
}
