"use client";

import AppLink from "@/components/AppLink";
import { useEffect, useState } from "react";
import EventCard, { type ActivityEvent } from "@/components/EventCard";
import LogDialog from "@/components/LogDialog";
import RingStatus from "@/components/RingStatus";
import type { CaseInfo } from "@/lib/store/store";
import { ApiError, api } from "@/lib/ui/api";
import { buttonPrimary, card, linkClass } from "@/lib/ui/styles";

interface EventsResponse {
  source: "ring" | "demo";
  events: ActivityEvent[];
}

/** undefined while loading; null when no case is saved yet; "error" when it could not be loaded. */
type CaseState = CaseInfo | null | undefined | "error";

function CaseSummary({ info }: { info: CaseState }) {
  if (info === undefined) return <div className={`${card} h-28 animate-pulse`} />;
  if (info === "error") {
    return (
      <section className={card}>
        <h2 className="text-lg font-semibold">My case</h2>
        <p role="alert" className="mt-1 text-stone-700">
          Your case details could not be loaded. Please reload the page to try again.
        </p>
      </section>
    );
  }
  if (info === null) {
    return (
      <section className={card}>
        <h2 className="text-lg font-semibold">My case</h2>
        <p className="mt-1 text-stone-600">
          Add the details of your order once. They go into your reports.
        </p>
        <AppLink href="/setup" className={`${buttonPrimary} mt-3`}>
          Set up your case
        </AppLink>
      </section>
    );
  }
  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">My case</h2>
        <AppLink href="/setup" className={`${linkClass} inline-flex min-h-11 items-center`}>
          Edit
        </AppLink>
      </div>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-stone-600">Respondent</dt>
        <dd className="font-medium">{info.respondentName}</dd>
        {info.orderNumber && (
          <>
            <dt className="text-stone-600">Order</dt>
            <dd>{info.orderNumber}</dd>
          </>
        )}
        {info.court && (
          <>
            <dt className="text-stone-600">Court</dt>
            <dd>{info.court}</dd>
          </>
        )}
        {info.expiresOn && (
          <>
            <dt className="text-stone-600">Valid until</dt>
            <dd>{info.expiresOn}</dd>
          </>
        )}
        {info.conditions && (
          <>
            <dt className="text-stone-600">Conditions</dt>
            <dd>{info.conditions}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

export default function Home() {
  const [caseInfo, setCaseInfo] = useState<CaseState>(undefined);
  const [feed, setFeed] = useState<EventsResponse | null>(null);
  const [feedError, setFeedError] = useState<"reconnect" | "failed" | null>(null);
  const [logging, setLogging] = useState<ActivityEvent | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api<{ case: CaseInfo | null }>("/api/case")
      .then((d) => setCaseInfo(d.case))
      .catch(() => setCaseInfo("error"));
    api<EventsResponse>("/api/events")
      .then(setFeed)
      .catch((err) =>
        setFeedError(err instanceof ApiError && err.code === "reconnect-ring" ? "reconnect" : "failed"),
      );
  }, []);

  function onSealed(eventId: string) {
    setLogging(null);
    setNotice("Sealed. You can see it in your incident log.");
    setFeed((f) =>
      f && { ...f, events: f.events.map((e) => (e.id === eventId ? { ...e, sealed: true } : e)) },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Home</h1>
      <CaseSummary info={caseInfo} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Doorbell activity</h2>
        <RingStatus source={feed?.source ?? null} needsReconnect={feedError === "reconnect"} />
        {notice && (
          <p role="status" className="rounded-lg bg-teal-50 px-3 py-2 text-teal-900">
            {notice}{" "}
            <AppLink href="/incidents" className={linkClass}>
              Open incident log
            </AppLink>
          </p>
        )}
        {feedError === "failed" && (
          <p className="text-stone-700">Doorbell activity could not be loaded. Please try again later.</p>
        )}
        {!feed && !feedError && <p className="text-stone-600">Loading activity…</p>}
        {feed && feed.events.length === 0 && (
          <p className={`${card} text-center text-stone-600`}>No doorbell activity yet</p>
        )}
        {feed && feed.events.length > 0 && (
          <ul className="flex flex-col gap-3">
            {feed.events.map((ev) => (
              <EventCard key={ev.id} event={ev} onLog={setLogging} />
            ))}
          </ul>
        )}
      </section>

      {logging && (
        <LogDialog
          event={logging}
          onClose={() => setLogging(null)}
          onSealed={() => onSealed(logging.id)}
        />
      )}
    </div>
  );
}
