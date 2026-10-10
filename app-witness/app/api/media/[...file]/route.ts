import { notFound } from "@/lib/api/http";
import { requireSession } from "@/lib/auth/session";
import { sha256Hex } from "@/lib/evidence/hash";
import type { MediaRecord } from "@/lib/evidence/types";
import { getDataDir, getStore } from "@/lib/store/store";

type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

/** Parses a single "bytes=" range. Null means serve the whole file (no or unsupported header). */
function parseRange(header: string | null, size: number): ByteRange {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

// SHA-256 of files already hashed, keyed by data dir, path, size and mtime, so a video's many
// Range requests do not re-hash the whole clip each time. Any write changes the key.
const MAX_CACHED = 256;
const hashCache = new Map<string, string>();

/** True when the bytes still hash to the fingerprint recorded in the ledger. */
async function matchesSeal(
  record: MediaRecord,
  bytes: Uint8Array,
  info: { size: number; mtimeMs: number },
): Promise<boolean> {
  const key = `${getDataDir()}|${record.file}|${info.size}|${info.mtimeMs}`;
  let actual = info.size === bytes.byteLength ? hashCache.get(key) : undefined;
  if (actual === undefined) {
    actual = await sha256Hex(bytes);
    if (hashCache.size >= MAX_CACHED) hashCache.clear();
    hashCache.set(key, actual);
  }
  return actual === record.sha256;
}

/**
 * Serves only files the ledger lists, with the content-type recorded when they were sealed, and
 * refuses (409 "integrity") a file whose bytes no longer match the ledger's SHA-256.
 */
export async function GET(req: Request, { params }: { params: Promise<{ file: string[] }> }) {
  const denied = requireSession(req);
  if (denied) return denied;

  const file = (await params).file.join("/");
  const store = getStore();
  const record = (await store.read()).ledger
    .flatMap((e) => e.media)
    .find((m) => m.file === file);
  if (!record) return notFound();

  let bytes: Uint8Array;
  let info: { size: number; mtimeMs: number };
  try {
    info = await store.statMedia(record.file);
    bytes = await store.readMedia(record.file);
  } catch {
    return notFound();
  }
  if (!(await matchesSeal(record, bytes, info))) {
    return Response.json({ error: "integrity" }, { status: 409 });
  }

  const headers = {
    "Content-Type": record.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };
  const range = parseRange(req.headers.get("range"), bytes.byteLength);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${bytes.byteLength}` },
    });
  }
  if (range === null) {
    return new Response(bytes as BodyInit, {
      headers: { ...headers, "Content-Length": String(bytes.byteLength) },
    });
  }
  const part = bytes.subarray(range.start, range.end + 1);
  return new Response(part as BodyInit, {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(part.byteLength),
      "Content-Range": `bytes ${range.start}-${range.end}/${bytes.byteLength}`,
    },
  });
}
