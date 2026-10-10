import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("fixtures", () => {
  it("includes the vehicle playground snapshot as a JPEG", () => {
    const file = path.resolve(
      __dirname,
      "../fixtures/playground/vehicle-1791621888046.jpg",
    );
    const bytes = readFileSync(file);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });
});
