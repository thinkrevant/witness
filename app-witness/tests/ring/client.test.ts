import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RingAuthError, RingMediaUnavailable } from "@/lib/ring/errors";
import { createRingClient, type RingEvent } from "@/lib/ring/client";

const BASE = "https://api.amazonvision.com";
const SIGNED = "https://media.example-signed.test/obj?sig=abc";
const TOKEN = "secret-token-value";
const DEVICE =
  "ava1.ring.device.MMC66XL4OGHBVO4S3B3F6ROKHS6WSWRHKOX74GFQABSJPLI23VMPX3G7VDURMPY2F6UBWOM4YDHFAKDPLP3H5I6EVQ6SHUIQ";

function fixture(name: string): unknown {
  const file = path.join(__dirname, "..", "..", "fixtures", "playground", name);
  return JSON.parse(readFileSync(file, "utf8"));
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function apiError(status: number, code: string): Response {
  return json({ errors: [{ id: "e1", status: String(status), code, detail: "detail" }] }, status);
}

function redirect(requestId = "req-1"): Response {
  return new Response(null, { status: 303, headers: { location: SIGNED, "x-request-id": requestId } });
}

function media(bytes: number[], headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "video/mp4", ...headers },
  });
}

/** fetch mock that serves queued responses in order and records every call. */
function queueFetch(responses: Response[]) {
  const queue = [...responses];
  return vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    return next;
  });
}

function makeClient(responses: Response[], retrySchedule?: number[]) {
  const fetchMock = queueFetch(responses);
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
  const client = createRingClient({
    token: TOKEN,
    fetch: fetchMock,
    sleep,
    retrySchedule,
  });
  return { client, fetchMock, sleep };
}

function ev(partial: Partial<RingEvent> = {}): RingEvent {
  return { id: "ev1", deviceId: DEVICE, type: "on_demand", start: 1791621888046, end: 1791621909805, ...partial };
}

describe("listDevices", () => {
  it("maps devices and joins online status via included", async () => {
    const { client, fetchMock } = makeClient([
      json({
        data: [
          {
            type: "devices",
            id: "d1",
            attributes: { name: "Front Door", image_url: "x" },
            relationships: { status: { data: { type: "device-status", id: "s1" } } },
          },
          { type: "devices", id: "d2", attributes: { name: "Back" }, relationships: {} },
        ],
        included: [{ type: "device-status", id: "s1", attributes: { online: true } }],
      }),
    ]);
    const devices = await client.listDevices();
    expect(devices).toEqual([
      { id: "d1", name: "Front Door", online: true },
      { id: "d2", name: "Back", online: null },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/v1/devices?include=status`);
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe("listEvents", () => {
  it("maps the playground fixture", async () => {
    const { client, fetchMock } = makeClient([json(fixture("history-vehicle.json"))]);
    const events = await client.listEvents(DEVICE);
    expect(events).toEqual([
      {
        id: "ava1.ring.history.event.2CXFMGXZF7SKH25MJOGXCCOKI2FYOCBAYIU2F4WPBBYMV5F6KV2YBJ5U5BUWTCJWJYPHQE35HI7I6ET4MJXOESGPVKNJZIUB",
        deviceId: DEVICE,
        type: "on_demand",
        start: 1791621888046,
        end: 1791621909805,
      },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/v1/history/devices/${encodeURIComponent(DEVICE)}/events`);
  });

  it("follows links.next across pages and returns newest first", async () => {
    const page1 = {
      data: [
        {
          type: "history-events",
          id: "old",
          attributes: { start: 100, end: 200, event_type: "motion" },
          relationships: { source: { data: { id: "d1" } } },
        },
      ],
      links: { next: "/v1/history/devices/d1/events?page[key]=abc" },
    };
    const page2 = {
      data: [
        {
          type: "history-events",
          id: "new",
          attributes: { start: 900, end: null, event_type: "ding" },
          relationships: { source: { data: { id: "d1" } } },
        },
      ],
    };
    const { client, fetchMock } = makeClient([json(page1), json(page2)]);
    const events = await client.listEvents("d1");
    expect(events.map((e) => e.id)).toEqual(["new", "old"]);
    expect(events[0].end).toBeNull();
    expect(String(fetchMock.mock.calls[1][0])).toBe(`${BASE}/v1/history/devices/d1/events?page[key]=abc`);
  });

  it("refuses a next link that points at another host (the token would leak)", async () => {
    const page = { data: [], links: { next: "https://evil.example/steal" } };
    const { client, fetchMock } = makeClient([json(page)]);
    await expect(client.listEvents("d1")).rejects.toThrow(/unexpected pagination link/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws RingAuthError on 401", async () => {
    const { client } = makeClient([apiError(401, "UNAUTHORIZED")]);
    await expect(client.listEvents("d1")).rejects.toBeInstanceOf(RingAuthError);
  });
});

describe("downloadClip", () => {
  it("sends timestamp and duration, follows the 303 without auth, and parses headers", async () => {
    const { client, fetchMock } = makeClient([
      redirect("req-abc"),
      media([1, 2, 3], {
        "X-Media-Timestamp": "1791621888047",
        "X-Media-Duration": "21466",
        "X-Request-ID": "req-from-get",
      }),
    ]);
    const result = await client.downloadClip(DEVICE, ev());
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.contentType).toBe("video/mp4");
    expect(result.mediaTimestamp).toBe(1791621888047);
    expect(result.mediaDuration).toBe(21466);
    expect(result.requestId).toBe("req-abc");

    const [postUrl, postInit] = fetchMock.mock.calls[0];
    expect(String(postUrl)).toBe(`${BASE}/v1/devices/${encodeURIComponent(DEVICE)}/media/video/download`);
    expect(postInit?.method).toBe("POST");
    expect(postInit?.redirect).toBe("manual");
    expect(postInit?.body).toBe(JSON.stringify({ timestamp: 1791621888046, duration: 21759 }));
    expect((postInit?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);

    const [getUrl, getInit] = fetchMock.mock.calls[1];
    expect(String(getUrl)).toBe(SIGNED);
    expect(JSON.stringify(getInit?.headers ?? {})).not.toMatch(/authorization/i);
  });

  it("falls back to the follow-up response's request id when the 303 has none", async () => {
    const { client } = makeClient([
      new Response(null, { status: 303, headers: { location: SIGNED } }),
      media([1], { "X-Request-ID": "req-from-get" }),
    ]);
    const r = await client.downloadClip(DEVICE, ev());
    expect(r.requestId).toBe("req-from-get");
  });

  it("clamps duration to 900000 when the event is longer", async () => {
    const { client, fetchMock } = makeClient([redirect(), media([1])]);
    await client.downloadClip(DEVICE, ev({ start: 1000, end: 1000 + 2_000_000 }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ timestamp: 1000, duration: 900000 });
  });

  it("uses 30000 when the event has no end", async () => {
    const { client, fetchMock } = makeClient([redirect(), media([1])]);
    await client.downloadClip(DEVICE, ev({ end: null }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).duration).toBe(30000);
  });

  it("clamps duration up to 1000 for very short events", async () => {
    const { client, fetchMock } = makeClient([redirect(), media([1])]);
    await client.downloadClip(DEVICE, ev({ start: 5000, end: 5100 }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).duration).toBe(1000);
  });

  it("returns nulls for absent optional headers", async () => {
    const { client } = makeClient([new Response(null, { status: 303, headers: { location: SIGNED } }), media([9])]);
    const r = await client.downloadClip(DEVICE, ev());
    expect(r.mediaTimestamp).toBeNull();
    expect(r.mediaDuration).toBeNull();
    expect(r.requestId).toBeNull();
  });
});

describe("downloadSnapshot", () => {
  it("posts the latest_in_range body and returns the jpeg bytes", async () => {
    const { client, fetchMock } = makeClient([
      redirect("snap-req"),
      media([255, 216], { "content-type": "image/jpeg", "X-Media-Timestamp": "1791621888047" }),
    ]);
    const r = await client.downloadSnapshot(DEVICE, ev());
    expect(r.contentType).toBe("image/jpeg");
    expect(r.mediaDuration).toBeNull();
    expect(r.mediaTimestamp).toBe(1791621888047);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/v1/devices/${encodeURIComponent(DEVICE)}/media/image/download`);
    expect(JSON.parse(String(init?.body))).toEqual({
      type: "latest_in_range",
      start_timestamp: 1791621888046,
      end_timestamp: 1791621909805,
      image_options: { format: "jpeg", resolution: { width: 1920, height: 1080 } },
    });
  });
});

describe("retries and errors", () => {
  it("retries 425, 425, then succeeds after 2 sleeps", async () => {
    const { client, sleep, fetchMock } = makeClient([
      apiError(425, "RECORDING_NOT_READY"),
      apiError(425, "RECORDING_NOT_READY"),
      redirect(),
      media([7, 7]),
    ]);
    const r = await client.downloadClip(DEVICE, ev());
    expect(r.bytes).toEqual(new Uint8Array([7, 7]));
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([5000, 10000]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("retries a 416 that comes from the follow-up GET", async () => {
    const { client, sleep } = makeClient([redirect(), apiError(416, "MEDIA_NOT_FOUND"), redirect(), media([1])]);
    const r = await client.downloadClip(DEVICE, ev());
    expect(r.bytes).toEqual(new Uint8Array([1]));
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("throws RingMediaUnavailable after retrySchedule.length retries of 416", async () => {
    const schedule = [1, 2, 3];
    const { client, sleep, fetchMock } = makeClient(
      Array.from({ length: 4 }, () => apiError(416, "MEDIA_NOT_FOUND")),
      schedule,
    );
    await expect(client.downloadClip(DEVICE, ev())).rejects.toBeInstanceOf(RingMediaUnavailable);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 3000]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("uses the default schedule [5,10,20,30]", async () => {
    const { client, sleep } = makeClient(Array.from({ length: 5 }, () => apiError(425, "RECORDING_NOT_READY")));
    await expect(client.downloadSnapshot(DEVICE, ev())).rejects.toBeInstanceOf(RingMediaUnavailable);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([5000, 10000, 20000, 30000]);
  });

  it("throws RingAuthError on 401 from a media POST without retrying", async () => {
    const { client, sleep } = makeClient([apiError(401, "UNAUTHORIZED")]);
    await expect(client.downloadClip(DEVICE, ev())).rejects.toBeInstanceOf(RingAuthError);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("maps 403 TIME_RANGE_NOT_AUTHORIZED to RingMediaUnavailable without retrying", async () => {
    const { client, sleep } = makeClient([apiError(403, "TIME_RANGE_NOT_AUTHORIZED")]);
    const err = await client.downloadClip(DEVICE, ev()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RingMediaUnavailable);
    expect((err as Error).message).toContain("not accessible with this token");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("throws a generic error for other statuses and never leaks the token", async () => {
    const { client } = makeClient([apiError(500, "INTERNAL")]);
    const err = await client.downloadClip(DEVICE, ev()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RingAuthError);
    expect(err).not.toBeInstanceOf(RingMediaUnavailable);
    expect((err as Error).message).not.toContain(TOKEN);
    expect((err as Error).message).toContain("500");
  });
});
