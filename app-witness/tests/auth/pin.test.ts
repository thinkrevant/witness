import { describe, expect, it } from "vitest";
import { hashPin, isValidPin, verifyPin } from "@/lib/auth/pin";

describe("isValidPin", () => {
  it("accepts 4 to 8 digits", () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("12345678")).toBe(true);
  });

  it("rejects non-digits and wrong lengths", () => {
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("123456789")).toBe(false);
    expect(isValidPin("")).toBe(false);
  });
});

describe("hashPin / verifyPin", () => {
  it("round-trips and rejects a wrong PIN", async () => {
    const { hash, salt } = await hashPin("4821");
    expect(await verifyPin("4821", hash, salt)).toBe(true);
    expect(await verifyPin("4822", hash, salt)).toBe(false);
  });

  it("uses a fresh 16-byte salt each time and a 32-byte hex key", async () => {
    const a = await hashPin("4821");
    const b = await hashPin("4821");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for a given salt", async () => {
    const salt = Buffer.alloc(16, 7);
    const a = await hashPin("4821", salt);
    const b = await hashPin("4821", salt);
    expect(a).toEqual(b);
  });
});
