import type { MediaResult, RingClient, RingEvent } from "@/lib/ring/client";
import type { EventSource } from "./source";

/** Live source: uses the first device shared with the token. */
export function createRingSource(client: RingClient): EventSource {
  let deviceId: Promise<string> | null = null;

  function firstDeviceId(): Promise<string> {
    if (!deviceId) {
      const lookup = client.listDevices().then((devices) => {
        if (devices.length === 0) {
          throw new Error("No Ring devices are shared with this token");
        }
        return devices[0].id;
      });
      deviceId = lookup;
      // Do not cache a failure, so a later call can retry.
      lookup.catch(() => {
        if (deviceId === lookup) deviceId = null;
      });
    }
    return deviceId;
  }

  return {
    kind: "ring",
    async listEvents(): Promise<RingEvent[]> {
      return client.listEvents(await firstDeviceId());
    },
    async snapshot(ev: RingEvent): Promise<MediaResult> {
      return client.downloadSnapshot(await firstDeviceId(), ev);
    },
    async clip(ev: RingEvent): Promise<MediaResult> {
      return client.downloadClip(await firstDeviceId(), ev);
    },
    live: {
      async start(offerSdp: string) {
        return client.startLiveView(await firstDeviceId(), offerSdp);
      },
      stop(sessionUrl: string) {
        return client.stopLiveView(sessionUrl);
      },
    },
  };
}
