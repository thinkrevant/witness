// Thumbnails are a convenience only: cached outside media/, never hashed into the ledger.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { notFound, sourceFailure } from "@/lib/api/http";
import { requireSession } from "@/lib/auth/session";
import { sha256Hex } from "@/lib/evidence/hash";
import { RingMediaUnavailable } from "@/lib/ring/client";
import { getSource } from "@/lib/sources/source";
import { getDataDir, getStore } from "@/lib/store/store";

function jpeg(bytes: Uint8Array): Response {
  return new Response(bytes as BodyInit, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireSession(req);
  if (denied) return denied;

  const { id } = await params;
  const cacheFile = path.join(getDataDir(), "cache", `${await sha256Hex(id)}.jpg`);
  const cached = await readFile(cacheFile).catch(() => null);
  if (cached) return jpeg(new Uint8Array(cached));

  const { settings } = await getStore().read();
  const source = await getSource(settings);
  try {
    const event = (await source.listEvents()).find((ev) => ev.id === id);
    if (!event) return notFound();
    const { bytes } = await source.snapshot(event);
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, bytes);
    return jpeg(bytes);
  } catch (err) {
    if (err instanceof RingMediaUnavailable) return notFound();
    return sourceFailure(err, "thumbnail-failed", settings);
  }
}
