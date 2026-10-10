import { beforeEach, describe, expect, it, vi } from "vitest";
import { rememberLiveSession, stopAllLiveSessions, takeLiveSession } from "@/lib/live/sessions";
import type { LiveView } from "@/lib/sources/source";

const live: LiveView = { start: vi.fn(), stop: vi.fn() };

beforeEach(() => {
  globalThis.__witnessLiveSessions = undefined;
});

describe("live session registry", () => {
  it("hands each session back once, by its random id", () => {
    const a = rememberLiveSession("https://api.amazonvision.com/s/a", live, 1_000);
    const b = rememberLiveSession("https://api.amazonvision.com/s/b", live, 1_000);
    expect(a).not.toBe(b);
    expect(takeLiveSession(b, 2_000)?.sessionUrl).toBe("https://api.amazonvision.com/s/b");
    expect(takeLiveSession(b, 2_000)).toBeNull();
    expect(takeLiveSession(a, 2_000)?.live).toBe(live);
  });

  it("forgets sessions Ring has certainly ended (two minutes on)", () => {
    const id = rememberLiveSession("https://api.amazonvision.com/s/old", live, 0);
    expect(takeLiveSession(id, 121_000)).toBeNull();
    expect(globalThis.__witnessLiveSessions?.size).toBe(0);
  });

  it("stopAllLiveSessions stops and forgets every open session, even if one stop fails", async () => {
    const stop = vi.fn(async (url: string) => {
      if (url.endsWith("/a")) throw new Error("Ring said no");
    });
    const ring: LiveView = { start: vi.fn(), stop };
    const a = rememberLiveSession("https://api.amazonvision.com/s/a", ring);
    rememberLiveSession("https://api.amazonvision.com/s/b", ring);
    await expect(stopAllLiveSessions()).resolves.toBeUndefined();
    expect(stop.mock.calls.map((c) => c[0]).sort()).toEqual([
      "https://api.amazonvision.com/s/a",
      "https://api.amazonvision.com/s/b",
    ]);
    expect(takeLiveSession(a)).toBeNull();
    expect(globalThis.__witnessLiveSessions?.size).toBe(0);
  });
});
