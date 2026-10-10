"use client";

import AppLink from "@/components/AppLink";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityEvent } from "@/components/EventCard";
import { ApiError, api } from "@/lib/ui/api";
import {
  LIVE_ICE_SERVERS,
  connectTimedOut,
  pollForCapture,
  reactToConnectionState,
  remainingSeconds,
  stopLiveSession,
  waitForIceGathering,
} from "@/lib/ui/live";
import { buttonPrimary, buttonSecondary, card, linkClass } from "@/lib/ui/styles";

/** If the video has not connected this long after Ring answered, give up calmly. */
const CONNECT_TIMEOUT_MS = 20_000;
/** A live connection that reports "disconnected" may recover; end the view only if it has not by then. */
const DISCONNECT_GRACE_MS = 4_000;

type Phase = "connecting" | "live" | "ended" | "failed" | "saving" | "not-ready";
type Failure = "reconnect" | "unavailable" | "failed";

interface LiveStart {
  answer: string;
  sessionId: string;
  maxSeconds: number;
}

function FailureMessage({ failure }: { failure: Failure }) {
  if (failure === "reconnect") {
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
  if (failure === "unavailable") return <>Live view needs a Ring connection.</>;
  return <>Your doorbell could not be reached just now. Please try again in a moment.</>;
}

/**
 * Live view of the doorbell over WebRTC (video only). The browser's offer goes to Ring through
 * /api/live; the token and Ring's session URL stay on the server. "Capture this moment" stops the
 * stream and waits for Ring's recording of it, then hands that event to `onCapture`.
 */
export default function LiveView({
  onCapture,
  onClose,
}: {
  onCapture: (event: ActivityEvent) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sessionRef = useRef<string | null>(null);
  const pollRef = useRef<AbortController | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const streamStartRef = useRef(0);
  const phaseRef = useRef<Phase>("connecting");
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [failure, setFailure] = useState<Failure>("failed");
  const [session, setSession] = useState<{ startedAt: number; maxSeconds: number } | null>(null);
  // True once video has flowed in this attempt; Ring only records a session that actually ran.
  const [reachedLive, setReachedLive] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  /** Moves to a new phase; the ref lets event handlers and timers read the current one. */
  const go = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  /** Cancels the timers, closes the connection and asks the server to end the Ring session. Never waits. */
  const teardown = useCallback(() => {
    clearTimeout(connectTimerRef.current);
    clearTimeout(graceTimerRef.current);
    connectTimerRef.current = undefined;
    graceTimerRef.current = undefined;
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.ontrack = null;
      pc.close();
    }
    if (sessionRef.current) stopLiveSession(sessionRef.current);
    sessionRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Connect on open (and on "Try again").
  useEffect(() => {
    let cancelled = false;
    const pc = new RTCPeerConnection({ iceServers: LIVE_ICE_SERVERS });
    pcRef.current = pc;
    // True once this attempt was cleaned up, stopped, captured or replaced: it must not touch the UI.
    const stale = () => cancelled || pcRef.current !== pc;

    function fail(kind: Failure) {
      if (stale()) return;
      teardown();
      setFailure(kind);
      go("failed");
    }

    function end() {
      teardown();
      go("ended");
    }

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.ontrack = (e) => {
      if (videoRef.current) videoRef.current.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    };
    pc.onconnectionstatechange = () => {
      if (stale()) return;
      const state = pc.connectionState;
      if (state !== "disconnected") {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = undefined;
      }
      switch (reactToConnectionState(state, phaseRef.current)) {
        case "live":
          clearTimeout(connectTimerRef.current);
          setReachedLive(true);
          go("live");
          break;
        case "wait":
          // Ring ends the session itself after 30-60 s; a brief network blip should not.
          if (graceTimerRef.current === undefined) {
            graceTimerRef.current = setTimeout(() => {
              graceTimerRef.current = undefined;
              if (!stale() && phaseRef.current === "live" && pc.connectionState !== "connected") end();
            }, DISCONNECT_GRACE_MS);
          }
          break;
        case "end":
          end();
          break;
        case "fail":
          fail("failed");
          break;
      }
    };

    async function connect() {
      await pc.setLocalDescription(await pc.createOffer());
      await waitForIceGathering(pc, 3000);
      if (stale()) return;
      const offer = pc.localDescription?.sdp;
      if (!offer) return fail("failed");

      streamStartRef.current = Date.now();
      let started: LiveStart;
      try {
        started = await api<LiveStart>("/api/live", { method: "POST", body: { offer } });
      } catch (err) {
        if (err instanceof ApiError && err.code === "reconnect-ring") return fail("reconnect");
        if (err instanceof ApiError && err.code === "live-unavailable") return fail("unavailable");
        return fail("failed");
      }
      if (stale()) {
        // Stopped while Ring was answering: end the session it just opened.
        stopLiveSession(started.sessionId);
        return;
      }
      sessionRef.current = started.sessionId;
      setSession({ startedAt: Date.now(), maxSeconds: started.maxSeconds });
      connectTimerRef.current = setTimeout(() => {
        connectTimerRef.current = undefined;
        if (connectTimedOut(phaseRef.current, pcRef.current === pc, pc.connectionState)) fail("failed");
      }, CONNECT_TIMEOUT_MS);
      await pc.setRemoteDescription({ type: "answer", sdp: started.answer });
    }

    connect().catch(() => fail("failed"));
    return () => {
      cancelled = true;
      teardown();
    };
  }, [attempt, go, teardown]);

  // Leaving the page (including Quick exit) ends the session without delaying anything.
  useEffect(() => {
    window.addEventListener("pagehide", teardown);
    return () => window.removeEventListener("pagehide", teardown);
  }, [teardown]);

  // Stop any capture polling on unmount.
  useEffect(() => () => pollRef.current?.abort(), []);

  // Countdown while connecting or live; the session ends when it reaches zero.
  const counting = session !== null && (phase === "connecting" || phase === "live");
  useEffect(() => {
    if (!counting || !session) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (remainingSeconds(session.startedAt, session.maxSeconds, t) === 0) {
        teardown();
        go("ended");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [counting, session, go, teardown]);
  const secondsLeft = session ? remainingSeconds(session.startedAt, session.maxSeconds, now) : null;

  function stop() {
    teardown();
    go("ended");
  }

  function retry() {
    pollRef.current?.abort();
    pollRef.current = null;
    setSession(null);
    setReachedLive(false);
    go("connecting");
    setAttempt((n) => n + 1);
  }

  async function capture() {
    if (!reachedLive) return;
    teardown();
    go("saving");
    pollRef.current?.abort();
    const controller = new AbortController();
    pollRef.current = controller;
    const found = await pollForCapture({
      fetchEvents: () => api<{ events: ActivityEvent[] }>("/api/events").then((d) => d.events),
      streamStartMs: streamStartRef.current,
      signal: controller.signal,
    });
    if (controller.signal.aborted || phaseRef.current !== "saving") return;
    if (found) onCapture(found);
    else go("not-ready");
  }

  /** Stops waiting for Ring's recording; it still appears in Doorbell activity once ready. */
  function cancelSaving() {
    pollRef.current?.abort();
    pollRef.current = null;
    onClose();
  }

  const statusText: Record<Phase, React.ReactNode> = {
    connecting: "Connecting to your doorbell…",
    live: "Live",
    ended: "Live view ended",
    failed: <FailureMessage failure={failure} />,
    saving: "Saving the recording from Ring…",
    "not-ready": "The recording isn't ready yet — it will appear in Doorbell activity shortly.",
  };
  const streaming = phase === "connecting" || phase === "live";

  return (
    <section aria-labelledby="live-title" className={`${card} flex flex-col gap-3`}>
      <h3 id="live-title" className="font-semibold text-stone-900">
        Live view
      </h3>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label="Live video from your doorbell"
        className="aspect-video w-full rounded-lg bg-stone-900 object-contain"
      />
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2 text-sm">
        <p role="status" aria-live="polite" className={phase === "failed" ? "text-stone-800" : "text-stone-700"}>
          {phase === "live" && (
            <span aria-hidden="true" className="mr-2 inline-block h-2 w-2 rounded-full bg-teal-700" />
          )}
          {(phase === "connecting" || phase === "saving") && (
            <span
              aria-hidden="true"
              className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-teal-700 border-t-transparent align-[-2px]"
            />
          )}
          {statusText[phase]}
        </p>
        {streaming && secondsLeft !== null && (
          <p className="tabular-nums text-stone-600">{secondsLeft} s left</p>
        )}
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {streaming && (
          <button type="button" onClick={stop} className={buttonSecondary}>
            Stop
          </button>
        )}
        {phase === "saving" && (
          <button type="button" onClick={cancelSaving} className={buttonSecondary}>
            Cancel
          </button>
        )}
        {!streaming && phase !== "saving" && (
          <button type="button" onClick={onClose} className={buttonSecondary}>
            Close
          </button>
        )}
        {phase === "failed" && (
          <button type="button" onClick={retry} className={buttonPrimary}>
            Try again
          </button>
        )}
        {(streaming || (phase === "ended" && reachedLive)) && (
          <button type="button" onClick={capture} disabled={!reachedLive} className={buttonPrimary}>
            Capture this moment
          </button>
        )}
      </div>
    </section>
  );
}
