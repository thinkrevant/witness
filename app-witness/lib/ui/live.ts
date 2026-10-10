// Browser-side helpers for live view: ICE gathering, countdown, stopping, and finding the recording.

/** The STUN server used only while live view is open (finds this computer's public address). */
export const LIVE_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

/** A live recording can start up to this long before our clock said the stream started. */
const CAPTURE_SLACK_MS = 10_000;
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 60_000;

interface CapturableEvent {
  type: string;
  start: number;
  sealed: boolean;
}

/**
 * The recording Ring made of our live view: an unsealed "on_demand" event that started no more than
 * 10 s before the stream did. When several match, the one closest to the stream start wins.
 */
export function findCapturedEvent<T extends CapturableEvent>(events: T[], streamStartMs: number): T | null {
  let best: T | null = null;
  for (const ev of events) {
    if (ev.type !== "on_demand" || ev.sealed || ev.start < streamStartMs - CAPTURE_SLACK_MS) continue;
    if (!best || Math.abs(ev.start - streamStartMs) < Math.abs(best.start - streamStartMs)) best = ev;
  }
  return best;
}

/** Whole seconds left of a session that started at `startedAtMs` and lasts `maxSeconds`; never below 0. */
export function remainingSeconds(startedAtMs: number, maxSeconds: number, nowMs: number): number {
  return Math.max(0, Math.ceil(maxSeconds - (nowMs - startedAtMs) / 1000));
}

type GatheringTarget = Pick<RTCPeerConnection, "iceGatheringState"> &
  Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * Waits until ICE gathering is complete (Ring answers 500 to an offer sent too early), at most
 * `timeoutMs`. Resolves true when complete, false when it gave up.
 */
export function waitForIceGathering(pc: GatheringTarget, timeoutMs = 3000): Promise<boolean> {
  if (pc.iceGatheringState === "complete") return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (complete: boolean) => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve(complete);
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

/**
 * Asks the server to end a live-view session. Fire-and-forget with keepalive, so it also works while
 * the page is being left; it never throws and never waits.
 */
export function stopLiveSession(sessionId: string): void {
  try {
    void fetch(`/api/live?session=${encodeURIComponent(sessionId)}`, { method: "DELETE", keepalive: true }).catch(
      () => undefined,
    );
  } catch {
    // Ring ends the session on its own within a minute.
  }
}

function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export interface PollOptions<T> {
  fetchEvents: () => Promise<T[]>;
  streamStartMs: number;
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Checks the event list every 3 s, for up to 60 s, until Ring's recording of the live view appears.
 * A failed check is skipped. Returns null when time runs out or the signal is aborted.
 */
export async function pollForCapture<T extends CapturableEvent>(opts: PollOptions<T>): Promise<T | null> {
  const interval = opts.intervalMs ?? POLL_INTERVAL_MS;
  const timeout = opts.timeoutMs ?? POLL_TIMEOUT_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => sleepFor(ms, opts.signal));
  const begin = now();
  for (;;) {
    if (opts.signal?.aborted) return null;
    try {
      const found = findCapturedEvent(await opts.fetchEvents(), opts.streamStartMs);
      if (found) return found;
    } catch {
      // Try again on the next round.
    }
    if (now() - begin >= timeout) return null;
    await sleep(interval);
  }
}

/** How a live view responds to a peer-connection state change. */
export type ConnectionReaction = "live" | "wait" | "end" | "fail" | "none";

/**
 * - connected while connecting: the video is flowing ("live");
 * - disconnected while live: may recover, so wait a grace period before ending ("wait");
 * - failed or closed while live: Ring ended the session ("end");
 * - failed while connecting: it never connected ("fail").
 * Anything else, and any change after the view stopped, is ignored.
 */
export function reactToConnectionState(state: RTCPeerConnectionState, phase: string): ConnectionReaction {
  if (phase === "connecting") {
    if (state === "connected") return "live";
    if (state === "failed") return "fail";
    return "none";
  }
  if (phase === "live") {
    if (state === "disconnected") return "wait";
    if (state === "failed" || state === "closed") return "end";
  }
  return "none";
}

/**
 * Whether the connect timeout should fail the view: only if it is still connecting, on the same
 * peer connection the timer was set for, and that connection never reached "connected".
 */
export function connectTimedOut(phase: string, samePeerConnection: boolean, state: RTCPeerConnectionState): boolean {
  return phase === "connecting" && samePeerConnection && state !== "connected";
}
