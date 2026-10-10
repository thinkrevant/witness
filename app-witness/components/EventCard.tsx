import Image from "next/image";
import type { RingEvent } from "@/lib/ring/client";
import { eventTypeLabel } from "@/lib/ui/labels";
import { buttonPrimary } from "@/lib/ui/styles";

export type ActivityEvent = RingEvent & { sealed: boolean };

/** One doorbell event: thumbnail, local time, type, and either the log action or a sealed chip. */
export default function EventCard({
  event,
  onLog,
}: {
  event: ActivityEvent;
  onLog: (event: ActivityEvent) => void;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center">
      <Image
        unoptimized
        src={`/api/events/${encodeURIComponent(event.id)}/thumb`}
        alt={`Doorbell still, ${eventTypeLabel(event.type)}`}
        width={192}
        height={108}
        className="aspect-video w-full rounded-lg bg-stone-200 object-cover sm:w-48"
      />
      <div className="flex flex-1 flex-col gap-1">
        <p className="font-semibold text-stone-900">{eventTypeLabel(event.type)}</p>
        <p className="text-sm text-stone-600">{new Date(event.start).toLocaleString()}</p>
      </div>
      {event.sealed ? (
        <span className="inline-flex min-h-11 items-center justify-center rounded-full bg-teal-50 px-4 font-medium text-teal-800 ring-1 ring-teal-200">
          Sealed ✓
        </span>
      ) : (
        <button type="button" onClick={() => onLog(event)} className={buttonPrimary}>
          Log as violation
        </button>
      )}
    </li>
  );
}
