import { describe, expect, it } from "vitest";
import { buildTimeStampReq, parseTsrStatus, requestTimestamp, tsrCoversHash } from "@/lib/timestamp/tsa";
import { fakeTsr } from "../helpers/tsr";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const bytes = (h: string) => new Uint8Array(Buffer.from(h.replace(/\s+/g, ""), "hex"));

const ZERO_DIGEST = "00".repeat(32);
const NONCE = bytes("0102030405060708");

describe("buildTimeStampReq", () => {
  it("encodes the exact DER for a zero digest and nonce 01..08", () => {
    const expected =
      "3043 020101 3031 300d06096086480165030402010500 0420" +
      "00".repeat(32) +
      " 0208 0102030405060708 0101ff";
    expect(hex(buildTimeStampReq(ZERO_DIGEST, NONCE))).toBe(expected.replace(/\s+/g, ""));
  });

  it("prepends 0x00 to a nonce whose high bit is set so the INTEGER stays positive", () => {
    const out = hex(buildTimeStampReq(ZERO_DIGEST, bytes("ff02030405060708")));
    expect(out.startsWith("3044")).toBe(true);
    expect(out.endsWith("0209" + "00ff02030405060708" + "0101ff")).toBe(true);
  });

  it("rejects a digest that is not 32 bytes of hex", () => {
    expect(() => buildTimeStampReq("abcd", NONCE)).toThrow(/sha-256/i);
    expect(() => buildTimeStampReq("zz".repeat(32), NONCE)).toThrow(/sha-256/i);
  });
});

describe("parseTsrStatus", () => {
  it("reads status 0 from a minimal response", () => {
    expect(parseTsrStatus(bytes("30 05 30 03 02 01 00"))).toBe(0);
  });

  it("reads a rejection status", () => {
    expect(parseTsrStatus(bytes("30 05 30 03 02 01 02"))).toBe(2);
  });

  it("handles a long-form outer length", () => {
    const der = bytes("30 81 85 30 03 02 01 00" + "aa".repeat(130));
    expect(parseTsrStatus(der)).toBe(0);
  });

  it("handles a long-form PKIStatusInfo length", () => {
    // SEQ{ SEQ(long-form len 6){ INTEGER 1, UTF8String "x" } }
    const inner = bytes("30 82 00 06 02 01 01 0c 01 78");
    const outer = new Uint8Array([0x30, inner.length, ...inner]);
    expect(parseTsrStatus(outer)).toBe(1);
  });

  it("throws a clear error on malformed input", () => {
    expect(() => parseTsrStatus(new Uint8Array())).toThrow(/malformed/i);
    expect(() => parseTsrStatus(bytes("04 05 30 03 02 01 00"))).toThrow(/malformed/i);
    expect(() => parseTsrStatus(bytes("30 05 30 03 04 01 00"))).toThrow(/malformed/i);
    expect(() => parseTsrStatus(bytes("30 20 30 03 02 01 00"))).toThrow(/malformed/i);
  });
});

describe("requestTimestamp", () => {
  const digest = "ab".repeat(32);
  const granted = bytes("30 05 30 03 02 01 00");

  it("POSTs the DER request and returns the response bytes when granted", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(granted, { status: 200 });
    }) as unknown as typeof fetch;

    const result = await requestTimestamp(digest, { fetch: fakeFetch });
    expect(result.status).toBe("ok");
    expect(result.tsr).toEqual(granted);
    expect(seen?.url).toBe("https://freetsa.org/tsr");
    expect(seen?.init.method).toBe("POST");
    expect((seen?.init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/timestamp-query",
    );
    const body = seen?.init.body as Uint8Array;
    // Length is 0x43, or 0x44 when the random nonce needs a leading 0x00.
    expect(hex(body)).toMatch(/^304[34]020101/);
    expect(hex(body)).toContain("0420" + digest);
  });

  it("uses a custom url", async () => {
    let url = "";
    const fakeFetch = (async (u: string) => {
      url = u;
      return new Response(granted, { status: 200 });
    }) as unknown as typeof fetch;
    await requestTimestamp(digest, { fetch: fakeFetch, url: "http://tsa.test/x" });
    expect(url).toBe("http://tsa.test/x");
  });

  it("returns failed when fetch rejects, without throwing", async () => {
    const fakeFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await requestTimestamp(digest, { fetch: fakeFetch })).toEqual({
      status: "failed",
      tsr: null,
    });
  });

  it("returns failed on a non-2xx response", async () => {
    const fakeFetch = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    expect(await requestTimestamp(digest, { fetch: fakeFetch })).toEqual({
      status: "failed",
      tsr: null,
    });
  });

  it("returns failed when the TSA rejects the request (status >= 2)", async () => {
    const fakeFetch = (async () =>
      new Response(bytes("30 05 30 03 02 01 02"), { status: 200 })) as unknown as typeof fetch;
    expect(await requestTimestamp(digest, { fetch: fakeFetch })).toEqual({
      status: "failed",
      tsr: null,
    });
  });

  it("returns failed when the response body is not a TimeStampResp", async () => {
    const fakeFetch = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    expect(await requestTimestamp(digest, { fetch: fakeFetch })).toEqual({
      status: "failed",
      tsr: null,
    });
  });

  it("accepts grantedWithMods (status 1)", async () => {
    const mods = bytes("30 05 30 03 02 01 01");
    const fakeFetch = (async () => new Response(mods, { status: 200 })) as unknown as typeof fetch;
    const result = await requestTimestamp(digest, { fetch: fakeFetch });
    expect(result.status).toBe("ok");
  });
});

describe("tsrCoversHash", () => {
  const entryHash = "c3".repeat(16) + "9a".repeat(16);
  const other = "0f".repeat(32);

  it("is true when a real-shaped token's messageImprint is the entry hash", () => {
    const tsr = fakeTsr(entryHash);
    expect(parseTsrStatus(tsr)).toBe(0);
    expect(tsrCoversHash(tsr, entryHash)).toBe(true);
    expect(tsrCoversHash(tsr, entryHash.toUpperCase())).toBe(true);
  });

  it("is false for a token issued for another hash, a status-only reply, or a bad hash", () => {
    expect(tsrCoversHash(fakeTsr(other), entryHash)).toBe(false);
    expect(tsrCoversHash(bytes("30 05 30 03 02 01 00"), entryHash)).toBe(false);
    expect(tsrCoversHash(new Uint8Array(), entryHash)).toBe(false);
    expect(tsrCoversHash(fakeTsr(entryHash), "abcd")).toBe(false);
  });

  it("needs the hash as a 32-byte OCTET STRING, not just the bytes anywhere", () => {
    const raw = bytes("30 22 02 01 00 30 1d" + entryHash);
    expect(tsrCoversHash(raw, entryHash)).toBe(false);
  });
});
