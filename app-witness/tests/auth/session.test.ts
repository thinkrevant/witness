import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE,
  createSession,
  endSession,
  isSessionValid,
  requireSession,
} from "@/lib/auth/session";

describe("sessions", () => {
  it("a created session is valid", () => {
    const token = createSession();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(isSessionValid(token)).toBe(true);
  });

  it("an ended session is invalid", () => {
    const token = createSession();
    endSession(token);
    expect(isSessionValid(token)).toBe(false);
  });

  it("undefined and unknown tokens are invalid", () => {
    expect(isSessionValid(undefined)).toBe(false);
    expect(isSessionValid("nope")).toBe(false);
  });
});

describe("requireSession", () => {
  it("uses the db_s cookie name", () => {
    expect(SESSION_COOKIE).toBe("db_s");
  });

  it("returns 401 locked when there is no cookie", async () => {
    const res = requireSession(new Request("http://localhost/api/x"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    expect(await res!.json()).toEqual({ error: "locked" });
  });

  it("returns 401 for an invalid token", () => {
    const res = requireSession(
      new Request("http://localhost/api/x", { headers: { cookie: "db_s=bogus" } }),
    );
    expect(res?.status).toBe(401);
  });

  it("returns null for a valid cookie among others", () => {
    const token = createSession();
    const res = requireSession(
      new Request("http://localhost/api/x", {
        headers: { cookie: `a=1; db_s=${token}; b=2` },
      }),
    );
    expect(res).toBeNull();
  });
});
