import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { mapHistoryEvents } from "@/lib/ring/client";
import type { JsonApiDocument, MediaResult, RingEvent } from "@/lib/ring/client";
import type { EventSource } from "./source";

type MediaKind = "snapshot" | "clip";

const EXT: Record<MediaKind, string> = { snapshot: "jpg", clip: "mp4" };
const DEFAULT_CONTENT_TYPE: Record<MediaKind, string> = {
  snapshot: "image/jpeg",
  clip: "video/mp4",
};

interface ParsedHeaders {
  contentType?: string;
  mediaTimestamp?: number;
  mediaDuration?: number;
  requestId?: string;
}

/**
 * Parses a raw HTTP header dump. The dump holds several status blocks (303, then 200);
 * for each header the value from the last block that has it wins.
 */
function parseHeaderDump(text: string): ParsedHeaders {
  const found: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("HTTP/")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    found[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  const num = (v: string | undefined) => {
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    contentType: found["content-type"],
    mediaTimestamp: num(found["x-media-timestamp"]),
    mediaDuration: num(found["x-media-duration"]),
    requestId: found["x-request-id"],
  };
}

/** Demo source: serves the Ring Developer Playground fixtures bundled with the app. */
export function createDemoSource(): EventSource {
  const dir =
    process.env.WITNESS_FIXTURES_DIR ?? path.join(process.cwd(), "fixtures", "playground");

  async function media(kind: MediaKind, ev: RingEvent): Promise<MediaResult> {
    const suffix = `-${ev.start}.${EXT[kind]}`;
    const names = await readdir(dir);
    const name = names.find((n) => n.endsWith(suffix));
    if (!name) throw new Error(`No demo fixture ${kind} for event starting at ${ev.start}`);
    const label = name.slice(0, name.length - suffix.length);

    const bytes = new Uint8Array(await readFile(path.join(dir, name)));
    const headerText = await readFile(path.join(dir, `${label}-${kind}-headers.txt`), "utf8").catch(
      () => "",
    );
    const h = parseHeaderDump(headerText);
    return {
      bytes,
      contentType: h.contentType ?? DEFAULT_CONTENT_TYPE[kind],
      mediaTimestamp: h.mediaTimestamp ?? null,
      mediaDuration: h.mediaDuration ?? null,
      requestId: h.requestId ?? null,
    };
  }

  return {
    kind: "demo",
    async listEvents() {
      const doc = JSON.parse(
        await readFile(path.join(dir, "history-all.json"), "utf8"),
      ) as JsonApiDocument;
      return mapHistoryEvents(doc, "demo-device").sort((a, b) => b.start - a.start);
    },
    snapshot: (ev) => media("snapshot", ev),
    clip: (ev) => media("clip", ev),
  };
}
