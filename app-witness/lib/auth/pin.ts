import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const SCRYPT_COST = 16384;

function derive(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, KEY_LENGTH, { N: SCRYPT_COST }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** scrypt (N=16384) with a random 16-byte salt unless one is supplied. Both outputs are hex. */
export async function hashPin(
  pin: string,
  salt: Buffer = randomBytes(SALT_LENGTH),
): Promise<{ hash: string; salt: string }> {
  const key = await derive(pin, salt);
  return { hash: key.toString("hex"), salt: salt.toString("hex") };
}

export async function verifyPin(pin: string, hash: string, salt: string): Promise<boolean> {
  const expected = Buffer.from(hash, "hex");
  const actual = await derive(pin, Buffer.from(salt, "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}
