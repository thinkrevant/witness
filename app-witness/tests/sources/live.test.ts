import { describe, expect, it, vi } from "vitest";
import type { RingClient } from "@/lib/ring/client";
import { createDemoSource } from "@/lib/sources/demo-source";
import { createRingSource } from "@/lib/sources/ring-source";

function fakeClient(): RingClient {
  return {
    listDevices: vi.fn(async () => [
      { id: "dev-first", name: "Front Door", online: true },
      { id: "dev-second", name: "Back", online: true },
    ]),
    listEvents: vi.fn(async () => []),
    downloadSnapshot: vi.fn(),
    downloadClip: vi.fn(),
    startLiveView: vi.fn(async () => ({ answerSdp: "v=0 answer", sessionUrl: "https://api.amazonvision.com/s/1" })),
    stopLiveView: vi.fn(async () => undefined),
  };
}

describe("live view on event sources", () => {
  it("the ring source starts live view on the first device and stops by session URL", async () => {
    const client = fakeClient();
    const source = createRingSource(client);
    expect(source.live).toBeDefined();
    await expect(source.live!.start("v=0 offer")).resolves.toEqual({
      answerSdp: "v=0 answer",
      sessionUrl: "https://api.amazonvision.com/s/1",
    });
    expect(client.startLiveView).toHaveBeenCalledWith("dev-first", "v=0 offer");
    await source.live!.stop("https://api.amazonvision.com/s/1");
    expect(client.stopLiveView).toHaveBeenCalledWith("https://api.amazonvision.com/s/1");
  });

  it("the demo source has no live view", () => {
    expect(createDemoSource().live).toBeUndefined();
  });
});
