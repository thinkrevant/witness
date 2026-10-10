"use client";

import AppLink from "@/components/AppLink";
import { useState } from "react";
import type { ActivityEvent } from "@/components/EventCard";
import type { LedgerEntry } from "@/lib/evidence/types";
import { ApiError, api } from "@/lib/ui/api";
import { eventTypeLabel } from "@/lib/ui/labels";
import { buttonPrimary, buttonSecondary, inputClass, linkClass } from "@/lib/ui/styles";

function errorMessage(err: unknown): React.ReactNode {
  if (err instanceof ApiError && err.code === "reconnect-ring") {
    return (
      <>
        Ring needs to be reconnected. Paste a fresh token in{" "}
        <AppLink href="/settings" className={linkClass}>
          Settings
        </AppLink>
        , then try again.
      </>
    );
  }
  if (err instanceof ApiError && err.code === "footage-unavailable") {
    return (
      <>
        Footage not accessible with this token. A Ring token can only reach footage recorded after
        it was created. For events that happen later, generate a fresh token and paste it in{" "}
        <AppLink href="/settings" className={linkClass}>
          Settings
        </AppLink>
        .
      </>
    );
  }
  return "This could not be sealed just now. Please try again.";
}

/** Asks for an optional note, then seals the event's original media. */
export default function LogDialog({
  event,
  onClose,
  onSealed,
}: {
  event: ActivityEvent;
  onClose: () => void;
  onSealed: (entry: LedgerEntry) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);

  async function seal() {
    setBusy(true);
    setError(null);
    try {
      const { entry } = await api<{ entry: LedgerEntry; alreadySealed: boolean }>("/api/incidents", {
        method: "POST",
        body: { eventId: event.id, note },
      });
      onSealed(entry);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-stone-900/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-title"
        className="w-full max-w-[560px] rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 id="log-title" className="text-lg font-semibold text-stone-900">
          Log as violation
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          {eventTypeLabel(event.type)} · {new Date(event.start).toLocaleString()}
        </p>
        <label htmlFor="log-note" className="mt-4 block text-sm font-medium text-stone-800">
          Note (optional)
        </label>
        <textarea
          id="log-note"
          rows={4}
          autoFocus
          maxLength={5000}
          disabled={busy}
          placeholder="What happened?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={`${inputClass} mt-1`}
        />
        <p className="mt-2 text-sm text-stone-600">
          The original video and photo are saved exactly as Ring provides them, with a fingerprint
          anyone can check later.
        </p>
        <div role="status" aria-live="polite" className="mt-3 min-h-6 text-sm">
          {busy && (
            <span className="inline-flex items-center gap-2 text-stone-700">
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-teal-700 border-t-transparent"
              />
              Downloading video from Ring… Sealing…
            </span>
          )}
          {error && <span className="text-red-700">{error}</span>}
        </div>
        <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className={buttonSecondary}>
            Cancel
          </button>
          <button type="button" onClick={seal} disabled={busy} className={buttonPrimary}>
            {busy ? "Sealing…" : "Seal"}
          </button>
        </div>
      </div>
    </div>
  );
}
