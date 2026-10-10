// Server-only: picks between the live Ring API and the bundled demo fixtures.
import { createRingClient } from "@/lib/ring/client";
import type { MediaResult, RingEvent } from "@/lib/ring/client";
import type { Settings } from "@/lib/store/store";
import { createDemoSource } from "./demo-source";
import { createRingSource } from "./ring-source";

export interface EventSource {
  kind: "ring" | "demo";
  listEvents(): Promise<RingEvent[]>;
  snapshot(ev: RingEvent): Promise<MediaResult>;
  clip(ev: RingEvent): Promise<MediaResult>;
}

/** The Ring token in use: the one saved in Settings, else RING_ACCESS_TOKEN. Empty strings count as none. */
export function effectiveToken(settings: Settings): string | null {
  return settings.ringToken || process.env.RING_ACCESS_TOKEN || null;
}

/** Demo mode, or no token, means the bundled fixtures; otherwise the live Ring API. */
export async function getSource(settings: Settings): Promise<EventSource> {
  const token = effectiveToken(settings);
  if (settings.demoMode || !token) return createDemoSource();
  return createRingSource(createRingClient({ token }));
}
