// Builds a TimeStampResp shaped like a real FreeTSA reply (status, then a CMS SignedData whose
// encapsulated TSTInfo carries the messageImprint), for tests only. The signature is a stub.

function tlv(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const content = Buffer.concat(parts);
  const n = content.length;
  const len = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
  return new Uint8Array(Buffer.concat([Buffer.from([tag, ...len]), content]));
}

const hex = (h: string) => new Uint8Array(Buffer.from(h.replace(/\s+/g, ""), "hex"));

const SHA256_ALG = hex("300d 0609 608648016503040201 0500");
const OID_SIGNED_DATA = hex("0609 2a864886f70d010702");
const OID_TST_INFO = hex("060b 2a864886f70d0109100104");
const OID_POLICY = hex("0603 2a0304");

/** A granted (status 0) TimeStampResp whose TSTInfo messageImprint is `sha256Hex`. */
export function fakeTsr(sha256Hex: string): Uint8Array {
  const tstInfo = tlv(
    0x30,
    hex("020101"),
    OID_POLICY,
    tlv(0x30, SHA256_ALG, tlv(0x04, hex(sha256Hex))),
    hex("0203 01e240"),
    tlv(0x18, new TextEncoder().encode("20261010120000Z")),
    hex("0208 0102030405060708"),
  );
  const signedData = tlv(
    0x30,
    hex("020103"),
    tlv(0x31, SHA256_ALG),
    tlv(0x30, OID_TST_INFO, tlv(0xa0, tlv(0x04, tstInfo))),
    tlv(0x31, tlv(0x30, hex("020101"), tlv(0x04, new Uint8Array(64).fill(0x5a)))),
  );
  const token = tlv(0x30, OID_SIGNED_DATA, tlv(0xa0, signedData));
  return tlv(0x30, hex("3003 020100"), token);
}
