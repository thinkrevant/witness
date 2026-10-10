import { describe, expect, it } from "vitest";
import { createDoubleEscDetector } from "@/lib/ui/quick-exit";

const esc = { key: "Escape", repeat: false };
const held = { key: "Escape", repeat: true };

describe("createDoubleEscDetector", () => {
  it("fires on two Esc presses within 1000 ms", () => {
    const isDoubleEsc = createDoubleEscDetector();
    expect(isDoubleEsc(esc, 0)).toBe(false);
    expect(isDoubleEsc(esc, 1000)).toBe(true);
  });

  it("does not fire when the presses are more than 1000 ms apart", () => {
    const isDoubleEsc = createDoubleEscDetector();
    expect(isDoubleEsc(esc, 0)).toBe(false);
    expect(isDoubleEsc(esc, 1001)).toBe(false);
    // The late press starts a new pair.
    expect(isDoubleEsc(esc, 1500)).toBe(true);
  });

  it("ignores auto-repeat from holding Esc down", () => {
    const isDoubleEsc = createDoubleEscDetector();
    expect(isDoubleEsc(esc, 0)).toBe(false);
    expect(isDoubleEsc(held, 30)).toBe(false);
    expect(isDoubleEsc(held, 60)).toBe(false);
    expect(isDoubleEsc(esc, 400)).toBe(true);
  });

  it("ignores other keys", () => {
    const isDoubleEsc = createDoubleEscDetector();
    expect(isDoubleEsc({ key: "Enter", repeat: false }, 0)).toBe(false);
    expect(isDoubleEsc(esc, 100)).toBe(false);
    expect(isDoubleEsc({ key: "a", repeat: false }, 200)).toBe(false);
    expect(isDoubleEsc(esc, 300)).toBe(true);
  });

  it("needs a fresh pair after firing", () => {
    const isDoubleEsc = createDoubleEscDetector();
    isDoubleEsc(esc, 0);
    expect(isDoubleEsc(esc, 100)).toBe(true);
    expect(isDoubleEsc(esc, 200)).toBe(false);
  });
});
