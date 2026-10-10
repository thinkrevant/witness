// RFC 3161 trusted timestamps, best effort. Server-only (uses fetch to a public TSA).

const DEFAULT_TSA_URL = "https://freetsa.org/tsr";
const TIMEOUT_MS = 10_000;

// DER-encoded AlgorithmIdentifier { id-sha256 (2.16.840.1.101.3.4.2.1), NULL }.
const SHA256_ALGORITHM_ID = new Uint8Array([
  0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00,
]);

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return [0x80 | out.length, ...out];
}

function tlv(tag: number, content: Uint8Array): Uint8Array {
  const len = derLength(content.length);
  const out = new Uint8Array(1 + len.length + content.length);
  out[0] = tag;
  out.set(len, 1);
  out.set(content, 1 + len.length);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Non-negative, minimal DER INTEGER body for big-endian unsigned bytes. */
function unsignedIntegerBody(value: Uint8Array): Uint8Array {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start++;
  const trimmed = value.subarray(start);
  return trimmed.length > 0 && trimmed[0] & 0x80 ? concat(new Uint8Array([0]), trimmed) : trimmed;
}

/** DER TimeStampReq (SHA-256, nonce, certReq=TRUE). */
export function buildTimeStampReq(sha256HexDigest: string, nonce: Uint8Array): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(sha256HexDigest)) {
    throw new Error("Expected a SHA-256 digest as 64 hex characters");
  }
  const digest = new Uint8Array(Buffer.from(sha256HexDigest, "hex"));
  const version = tlv(0x02, new Uint8Array([1]));
  const messageImprint = tlv(0x30, concat(SHA256_ALGORITHM_ID, tlv(0x04, digest)));
  const nonceInt = tlv(0x02, unsignedIntegerBody(nonce));
  const certReq = tlv(0x01, new Uint8Array([0xff]));
  return tlv(0x30, concat(version, messageImprint, nonceInt, certReq));
}

const malformed = (why: string) => new Error(`Malformed TimeStampResp: ${why}`);

/** Reads one TLV header at `at`, returning its tag and content bounds. */
function readTlv(der: Uint8Array, at: number, end: number) {
  if (at + 2 > end) throw malformed("truncated header");
  const tag = der[at];
  let len = der[at + 1];
  let start = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || start + n > end) throw malformed("bad length encoding");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + der[start + i];
    start += n;
  }
  if (start + len > end) throw malformed("length exceeds data");
  return { tag, start, end: start + len };
}

/** PKIStatus from TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken OPTIONAL }. */
export function parseTsrStatus(der: Uint8Array): number {
  const outer = readTlv(der, 0, der.length);
  if (outer.tag !== 0x30) throw malformed("outer value is not a SEQUENCE");
  const info = readTlv(der, outer.start, outer.end);
  if (info.tag !== 0x30) throw malformed("PKIStatusInfo is not a SEQUENCE");
  const status = readTlv(der, info.start, info.end);
  if (status.tag !== 0x02) throw malformed("PKIStatus is not an INTEGER");
  const length = status.end - status.start;
  if (length < 1 || length > 4) throw malformed("PKIStatus has an unexpected size");
  let value = 0;
  for (let i = status.start; i < status.end; i++) value = value * 256 + der[i];
  return value;
}

/**
 * True when a stored timestamp response names `entryHashHex`: its DER holds the hash as a
 * 32-byte OCTET STRING, which is how the TSTInfo messageImprint carries it. This only ties the
 * token to the record. It does not validate the TSA's signature, certificate or nonce; use
 * `openssl ts -verify` for that.
 */
export function tsrCoversHash(tsr: Uint8Array, entryHashHex: string): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(entryHashHex)) return false;
  const needle = Buffer.concat([Buffer.from([0x04, 0x20]), Buffer.from(entryHashHex, "hex")]);
  return Buffer.from(tsr.buffer, tsr.byteOffset, tsr.byteLength).indexOf(needle) !== -1;
}

const FAILED = { status: "failed", tsr: null } as const;

/** Asks a public TSA to timestamp a ledger entry hash. Never throws. */
export async function requestTimestamp(
  entryHash: string,
  opts: { fetch?: typeof fetch; url?: string } = {},
): Promise<{ status: "ok" | "failed"; tsr: Uint8Array | null }> {
  try {
    const doFetch = opts.fetch ?? fetch;
    const nonce = crypto.getRandomValues(new Uint8Array(8));
    const body = buildTimeStampReq(entryHash, nonce);
    const res = await doFetch(opts.url ?? DEFAULT_TSA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/timestamp-query" },
      body: body as BodyInit,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ...FAILED };
    const tsr = new Uint8Array(await res.arrayBuffer());
    if (parseTsrStatus(tsr) >= 2) return { ...FAILED };
    return { status: "ok", tsr };
  } catch {
    return { ...FAILED };
  }
}
