import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectTimedOut,
  findCapturedEvent,
  pollForCapture,
  reactToConnectionState,
  remainingSeconds,
  stopLiveSession,
  waitForIceGathering,
} from "@/lib/ui/live";

const START = 1_800_000_000_000;

function ev(id: string, type: string, start: number, sealed = false) {
  return { id, type, start, sealed };
}

describe("findCapturedEvent", () => {
  it("picks the unsealed on_demand event closest to when the stream started", () => {
    const events = [
      ev("later", "on_demand", START + 40_000),
      ev("ours", "on_demand", START + 1_500),
      ev("motion", "motion", START + 1_000),
      ev("old", "on_demand", START - 60_000),
    ];
    expect(findCapturedEvent(events, START)?.id).toBe("ours");
  });

  it("allows a start up to 10 s before the stream (clock skew), not more", () => {
    expect(findCapturedEvent([ev("skew", "on_demand", START - 10_000)], START)?.id).toBe("skew");
    expect(findCapturedEvent([ev("too-old", "on_demand", START - 10_001)], START)).toBeNull();
  });

  it("ignores sealed events and other types", () => {
    expect(
      findCapturedEvent([ev("s", "on_demand", START + 1, true), ev("m", "motion", START + 1)], START),
    ).toBeNull();
  });
});

describe("remainingSeconds", () => {
  it("counts down whole seconds from maxSeconds and stops at 0", () => {
    expect(remainingSeconds(START, 60, START)).toBe(60);
    expect(remainingSeconds(START, 60, START + 400)).toBe(60);
    expect(remainingSeconds(START, 60, START + 1_000)).toBe(59);
    expect(remainingSeconds(START, 60, START + 59_500)).toBe(1);
    expect(remainingSeconds(START, 60, START + 60_000)).toBe(0);
    expect(remainingSeconds(START, 60, START + 90_000)).toBe(0);
  });
});

class FakePc extends EventTarget {
  iceGatheringState: RTCIceGatheringState = "gathering";
  finish() {
    this.iceGatheringState = "complete";
    this.dispatchEvent(new Event("icegatheringstatechange"));
  }
}

describe("waitForIceGathering", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves at once when gathering is already complete", async () => {
    const pc = new FakePc();
    pc.iceGatheringState = "complete";
    await expect(waitForIceGathering(pc, 3000)).resolves.toBe(true);
  });

  it("resolves when gathering completes", async () => {
    const pc = new FakePc();
    const done = waitForIceGathering(pc, 3000);
    pc.finish();
    await expect(done).resolves.toBe(true);
  });

  it("gives up after the cap and reports it", async () => {
    vi.useFakeTimers();
    const pc = new FakePc();
    const done = waitForIceGathering(pc, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(done).resolves.toBe(false);
  });
});

describe("pollForCapture", () => {
  it("polls every interval until the recording appears", async () => {
    const lists = [[], [ev("motion", "motion", START + 1)], [ev("ours", "on_demand", START + 2_000)]];
    const fetchEvents = vi.fn(async () => lists.shift() ?? []);
    let now = START;
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });
    const found = await pollForCapture({ fetchEvents, streamStartMs: START, sleep, now: () => now });
    expect(found?.id).toBe("ours");
    expect(fetchEvents).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([3000, 3000]);
  });

  it("returns null after the time limit", async () => {
    const fetchEvents = vi.fn(async () => []);
    let now = START;
    const sleep = async (ms: number) => {
      now += ms;
    };
    const found = await pollForCapture({ fetchEvents, streamStartMs: START, sleep, now: () => now });
    expect(found).toBeNull();
    // Checks at 0, 3, ..., 60 s.
    expect(fetchEvents).toHaveBeenCalledTimes(21);
  });

  it("keeps polling through a failed request", async () => {
    const fetchEvents = vi
      .fn<() => Promise<ReturnType<typeof ev>[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([ev("ours", "on_demand", START)]);
    let now = START;
    const found = await pollForCapture({
      fetchEvents,
      streamStartMs: START,
      sleep: async (ms) => {
        now += ms;
      },
      now: () => now,
    });
    expect(found?.id).toBe("ours");
  });

  it("stops early when cancelled", async () => {
    const fetchEvents = vi.fn(async () => []);
    const controller = new AbortController();
    let now = START;
    const found = await pollForCapture({
      fetchEvents,
      streamStartMs: START,
      signal: controller.signal,
      sleep: async (ms) => {
        now += ms;
        controller.abort();
      },
      now: () => now,
    });
    expect(found).toBeNull();
    expect(fetchEvents).toHaveBeenCalledTimes(1);
  });
});

describe("stopLiveSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a keepalive DELETE for the session and never throws", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(() => stopLiveSession("abc-123")).not.toThrow();
    expect(fetchMock).toHaveBeenCalledWith("/api/live?session=abc-123", { method: "DELETE", keepalive: true });
    await Promise.resolve();
  });
});

describe("reactToConnectionState", () => {
  it("goes live when connected while connecting, and ignores it otherwise", () => {
    expect(reactToConnectionState("connected", "connecting")).toBe("live");
    expect(reactToConnectionState("connected", "live")).toBe("none");
    expect(reactToConnectionState("connected", "ended")).toBe("none");
  });

  it("gives a live view a grace period on 'disconnected' instead of ending it", () => {
    expect(reactToConnectionState("disconnected", "live")).toBe("wait");
    expect(reactToConnectionState("disconnected", "connecting")).toBe("none");
  });

  it("ends a live view on failed or closed", () => {
    expect(reactToConnectionState("failed", "live")).toBe("end");
    expect(reactToConnectionState("closed", "live")).toBe("end");
  });

  it("fails only a connecting view on 'failed'; other phases are left alone", () => {
    expect(reactToConnectionState("failed", "connecting")).toBe("fail");
    expect(reactToConnectionState("closed", "connecting")).toBe("none");
    for (const phase of ["ended", "failed", "saving", "not-ready"]) {
      for (const state of ["failed", "closed", "disconnected", "connected"] as RTCPeerConnectionState[]) {
        expect(reactToConnectionState(state, phase), `${state}/${phase}`).toBe("none");
      }
    }
    expect(reactToConnectionState("new", "connecting")).toBe("none");
    expect(reactToConnectionState("connecting", "connecting")).toBe("none");
  });
});

describe("connectTimedOut", () => {
  it("times out only a still-connecting, current, unconnected peer connection", () => {
    expect(connectTimedOut("connecting", true, "connecting")).toBe(true);
    expect(connectTimedOut("connecting", true, "new")).toBe(true);
    expect(connectTimedOut("connecting", true, "connected")).toBe(false);
    // Stopped, captured or replaced by "Try again": the old timer must do nothing.
    expect(connectTimedOut("ended", true, "closed")).toBe(false);
    expect(connectTimedOut("saving", false, "closed")).toBe(false);
    expect(connectTimedOut("connecting", false, "closed")).toBe(false);
    expect(connectTimedOut("live", true, "disconnected")).toBe(false);
  });
});
