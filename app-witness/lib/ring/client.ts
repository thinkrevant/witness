// Server-only: calls the Ring Partner API (Amazon Vision). Never import from client components (CORS, token).
import { RingAuthError, RingMediaUnavailable } from "./errors";

export { RingAuthError, RingMediaUnavailable } from "./errors";

const BASE_URL = "https://api.amazonvision.com";
const DEFAULT_RETRY_SCHEDULE = [5, 10, 20, 30];
const DEFAULT_CLIP_MS = 30_000;
const MIN_CLIP_MS = 1_000;
const MAX_CLIP_MS = 900_000;

export interface RingDevice {
  id: string;
  name: string;
  online: boolean | null;
}

export interface RingEvent {
  id: string;
  deviceId: string;
  /** Raw Ring event_type, e.g. "on_demand". */
  type: string;
  start: number;
  end: number | null;
}

export interface MediaResult {
  bytes: Uint8Array;
  contentType: string;
  mediaTimestamp: number | null;
  mediaDuration: number | null;
  requestId: string | null;
}

export interface RingClientOptions {
  token: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Seconds to wait before each retry of a 416/425; N entries means up to N retries. */
  retrySchedule?: number[];
}

export interface RingClient {
  listDevices(): Promise<RingDevice[]>;
  listEvents(deviceId: string): Promise<RingEvent[]>;
  downloadSnapshot(deviceId: string, ev: RingEvent): Promise<MediaResult>;
  downloadClip(deviceId: string, ev: RingEvent): Promise<MediaResult>;
  /** Opens a WHEP live-view session: sends the SDP offer, returns Ring's SDP answer and session URL. */
  startLiveView(deviceId: string, offerSdp: string): Promise<LiveViewSession>;
  /** Closes a WHEP session. An already-ended session (404) counts as closed. */
  stopLiveView(sessionUrl: string): Promise<void>;
}

export interface LiveViewSession {
  answerSdp: string;
  /** Absolute https://api.amazonvision.com URL; DELETE it to end the session. Server-side only. */
  sessionUrl: string;
}

interface ApiErrorBody {
  errors?: { code?: string }[];
}

export interface JsonApiResource {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id?: string } } | undefined>;
}

export interface JsonApiDocument {
  data?: JsonApiResource[];
  included?: JsonApiResource[];
  links?: { next?: unknown };
}

/** Outcome of one download attempt: media, or a retryable 416/425. */
type Attempt = { media: MediaResult } | { retryable: string };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return body.errors?.[0]?.code;
  } catch {
    return undefined;
  }
}

function numberHeader(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseOnline(device: JsonApiResource, statusById: Map<string, JsonApiResource>): boolean | null {
  const statusId = device.relationships?.status?.data?.id;
  if (typeof statusId !== "string") return null;
  const online = statusById.get(statusId)?.attributes?.["online"];
  return typeof online === "boolean" ? online : null;
}

/** Maps a Ring history JSON:API document to events (unsorted). Shared with the demo source. */
export function mapHistoryEvents(doc: JsonApiDocument, fallbackDeviceId: string): RingEvent[] {
  return (doc.data ?? []).map((e) => ({
    id: String(e.id),
    deviceId: String(e.relationships?.source?.data?.id ?? fallbackDeviceId),
    type: String(e.attributes?.["event_type"] ?? "unknown"),
    start: Number(e.attributes?.["start"]),
    end: typeof e.attributes?.["end"] === "number" ? e.attributes["end"] : null,
  }));
}

export function createRingClient(opts: RingClientOptions): RingClient {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const schedule = opts.retrySchedule ?? DEFAULT_RETRY_SCHEDULE;
  const authHeaders = { Authorization: `Bearer ${opts.token}` };

  /** Throws for 401 and for any non-2xx status that is not handled by the caller. Never includes the token. */
  async function failFor(res: Response, what: string): Promise<never> {
    const code = await errorCode(res);
    if (res.status === 401) throw new RingAuthError();
    throw new Error(`Ring API ${what} failed: HTTP ${res.status}${code ? ` ${code}` : ""}`);
  }

  async function getJson(url: string, what: string): Promise<JsonApiDocument> {
    const res = await doFetch(url, { headers: { ...authHeaders, Accept: "application/json" } });
    if (!res.ok) await failFor(res, what);
    return (await res.json()) as JsonApiDocument;
  }

  async function listDevices(): Promise<RingDevice[]> {
    const body = await getJson(`${BASE_URL}/v1/devices?include=status`, "device list");
    const statusById = new Map<string, JsonApiResource>();
    for (const inc of body.included ?? []) {
      if (inc.type === "device-status" && typeof inc.id === "string") statusById.set(inc.id, inc);
    }
    return (body.data ?? []).map((d) => ({
      id: String(d.id),
      name: String(d.attributes?.["name"] ?? d.id),
      online: parseOnline(d, statusById),
    }));
  }

  async function listEvents(deviceId: string): Promise<RingEvent[]> {
    const events: RingEvent[] = [];
    const seen = new Set<string>();
    let url: string | null = `${BASE_URL}/v1/history/devices/${encodeURIComponent(deviceId)}/events`;
    while (url) {
      seen.add(url);
      const body = await getJson(url, "event list");
      events.push(...mapHistoryEvents(body, deviceId));
      const next: unknown = body.links?.next;
      url = null;
      if (typeof next === "string" && next !== "") {
        // links.next is relative to the base URL; refuse anything that would send the token elsewhere.
        const resolved = new URL(next, BASE_URL);
        if (resolved.origin !== BASE_URL) throw new Error("Ring API returned an unexpected pagination link");
        if (seen.has(resolved.href)) throw new Error("Ring API returned a repeating pagination link");
        url = resolved.href;
      }
    }
    return events.sort((a, b) => b.start - a.start);
  }

  async function downloadOnce(path: string, body: unknown): Promise<Attempt> {
    const post = await doFetch(`${BASE_URL}${path}`, {
      method: "POST",
      redirect: "manual",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (post.status !== 303) {
      const code = await errorCode(post);
      if (post.status === 416 || post.status === 425) return { retryable: `HTTP ${post.status}${code ? ` ${code}` : ""}` };
      if (post.status === 401) throw new RingAuthError();
      if (post.status === 403 && code === "TIME_RANGE_NOT_AUTHORIZED") {
        throw new RingMediaUnavailable("Footage not accessible with this token (time range not authorized)");
      }
      throw new Error(`Ring API media request failed: HTTP ${post.status}${code ? ` ${code}` : ""}`);
    }
    const location = post.headers.get("location");
    if (!location) throw new Error("Ring API media redirect had no location header");
    const requestId = post.headers.get("x-request-id");

    // The signed URL lives on another host: do not send the Authorization header.
    const get = await doFetch(location);
    if (get.status === 416 || get.status === 425) {
      const code = await errorCode(get);
      return { retryable: `HTTP ${get.status}${code ? ` ${code}` : ""}` };
    }
    if (!get.ok) await failFor(get, "media download");

    return {
      media: {
        bytes: new Uint8Array(await get.arrayBuffer()),
        contentType: get.headers.get("content-type") ?? "application/octet-stream",
        mediaTimestamp: numberHeader(get, "x-media-timestamp"),
        mediaDuration: numberHeader(get, "x-media-duration"),
        requestId: requestId ?? get.headers.get("x-request-id"),
      },
    };
  }

  async function download(path: string, body: unknown): Promise<MediaResult> {
    let lastReason = "";
    for (let attempt = 0; attempt <= schedule.length; attempt++) {
      if (attempt > 0) await sleep(schedule[attempt - 1] * 1000);
      const result = await downloadOnce(path, body);
      if ("media" in result) return result.media;
      lastReason = result.retryable;
    }
    throw new RingMediaUnavailable(
      `Footage not available from Ring after ${schedule.length} retries (${lastReason})`,
    );
  }

  /**
   * Resolves a URL (against the API base when `base` is given) and throws unless it stays on the API
   * origin, because the token is sent there.
   */
  function apiUrl(raw: string, what: string, base?: string): string {
    let resolved: URL;
    try {
      resolved = new URL(raw, base);
    } catch {
      throw new Error(`Ring API ${what} is not a valid URL`);
    }
    if (resolved.origin !== BASE_URL) throw new Error(`Ring API ${what} is on an unexpected host`);
    return resolved.href;
  }

  async function startLiveView(deviceId: string, offerSdp: string): Promise<LiveViewSession> {
    const res = await doFetch(
      `${BASE_URL}/v1/devices/${encodeURIComponent(deviceId)}/media/streaming/whep/sessions`,
      {
        method: "POST",
        redirect: "manual",
        headers: { ...authHeaders, "Content-Type": "application/sdp" },
        body: offerSdp,
      },
    );
    if (res.status !== 201) await failFor(res, "live view");
    const location = res.headers.get("location");
    if (!location) throw new Error("Ring API live view session had no location header");
    const sessionUrl = apiUrl(location, "live view session location", BASE_URL);
    return { answerSdp: await res.text(), sessionUrl };
  }

  async function stopLiveView(sessionUrl: string): Promise<void> {
    // Only the absolute URL startLiveView returned is accepted.
    const url = apiUrl(sessionUrl, "live view session URL");
    const res = await doFetch(url, { method: "DELETE", redirect: "manual", headers: authHeaders });
    if (res.ok || res.status === 404) return;
    await failFor(res, "live view stop");
  }

  return {
    listDevices,
    listEvents,
    startLiveView,
    stopLiveView,
    downloadSnapshot(deviceId, ev) {
      return download(`/v1/devices/${encodeURIComponent(deviceId)}/media/image/download`, {
        type: "latest_in_range",
        start_timestamp: ev.start,
        end_timestamp: ev.end ?? ev.start + DEFAULT_CLIP_MS,
        image_options: { format: "jpeg", resolution: { width: 1920, height: 1080 } },
      });
    },
    downloadClip(deviceId, ev) {
      const raw = (ev.end ?? ev.start + DEFAULT_CLIP_MS) - ev.start;
      const duration = Math.min(MAX_CLIP_MS, Math.max(MIN_CLIP_MS, raw));
      return download(`/v1/devices/${encodeURIComponent(deviceId)}/media/video/download`, {
        timestamp: ev.start,
        duration,
      });
    },
  };
}
