// Live check against the Ring Developer Playground. Usage: npx tsx scripts/ring-check.ts
// Reads RING_ACCESS_TOKEN from the environment or from ../.env.local. The token is never printed.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRingClient } from "../lib/ring/client";

function loadToken(): string {
  const fromEnv = process.env.RING_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const envFile = path.join(__dirname, "..", "..", ".env.local");
  let text: string;
  try {
    text = readFileSync(envFile, "utf8");
  } catch {
    throw new Error("RING_ACCESS_TOKEN is not set and ../.env.local could not be read");
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*RING_ACCESS_TOKEN\s*=\s*(.*)\s*$/.exec(line);
    if (m) return m[1].replace(/^["']|["']$/g, "").trim();
  }
  throw new Error("RING_ACCESS_TOKEN not found in the environment or ../.env.local");
}

async function main(): Promise<void> {
  const client = createRingClient({ token: loadToken() });

  const devices = await client.listDevices();
  console.log(`devices: ${devices.length}`);
  for (const d of devices) console.log(`  ${d.name} (${d.id}) online=${d.online}`);
  if (devices.length === 0) return;

  const device = devices[0];
  const events = await client.listEvents(device.id);
  console.log(`events for ${device.name}: ${events.length}`);
  if (events.length === 0) return;

  const ev = events[0];
  console.log(`newest event: ${ev.id} type=${ev.type} start=${ev.start} end=${ev.end}`);

  const snap = await client.downloadSnapshot(device.id, ev);
  console.log(`snapshot: ${snap.bytes.length} bytes, ${snap.contentType}, requestId=${snap.requestId}`);

  const clip = await client.downloadClip(device.id, ev);
  console.log(
    `clip: ${clip.bytes.length} bytes, ${clip.contentType}, duration=${clip.mediaDuration}, requestId=${clip.requestId}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : "unknown error");
  process.exit(1);
});
