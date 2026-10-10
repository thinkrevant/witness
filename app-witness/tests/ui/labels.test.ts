import { describe, expect, it } from "vitest";
import { eventTypeLabel, fingerprintLabel } from "@/lib/ui/labels";

describe("eventTypeLabel", () => {
  it("names the known Ring event types", () => {
    expect(eventTypeLabel("on_demand")).toBe("Live view");
    expect(eventTypeLabel("motion")).toBe("Motion");
    expect(eventTypeLabel("ding")).toBe("Doorbell press");
  });

  it("capitalises any other type", () => {
    expect(eventTypeLabel("package")).toBe("Package");
  });
});

describe("fingerprintLabel", () => {
  it("shows the first 4 hex characters", () => {
    expect(fingerprintLabel("3f9a" + "0".repeat(60))).toBe("Sealed · fingerprint 3f9a…");
  });
});
