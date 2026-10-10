import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "@/app/api/lock/route";
import { verifyPin } from "@/lib/auth/pin";
import { isSessionValid } from "@/lib/auth/session";

// The real scrypt check, wrapped so a test can see whether it ran.
vi.mock("@/lib/auth/pin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/pin")>();
  return { ...actual, verifyPin: vi.fn(actual.verifyPin) };
});

let dir: string;
const prevDir = process.env.WITNESS_DATA_DIR;

function post(pin: string) {
  return POST(
    new Request("http://localhost/api/lock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin }),
    }),
  );
}

function tokenFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = /db_s=([0-9a-f]+)/.exec(setCookie);
  return m ? m[1] : "";
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "witness-lock-"));
  process.env.WITNESS_DATA_DIR = dir;
});

afterAll(async () => {
  if (prevDir === undefined) delete process.env.WITNESS_DATA_DIR;
  else process.env.WITNESS_DATA_DIR = prevDir;
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  globalThis.__witnessLockState = undefined;
});

describe("/api/lock", () => {
  it("first POST sets the PIN, creates a session and sets a strict httpOnly cookie", async () => {
    expect(await (await GET()).json()).toEqual({ hasPin: false, cooldownSeconds: 0 });

    const res = await post("4821");
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toMatch(/secure/i);
    expect(isSessionValid(tokenFrom(res))).toBe(true);

    expect(await (await GET()).json()).toEqual({ hasPin: true, cooldownSeconds: 0 });
  });

  it("rejects an invalid PIN when setting one", async () => {
    // A fresh data dir so no PIN exists yet.
    const other = await mkdtemp(path.join(os.tmpdir(), "witness-lock-"));
    const prev = process.env.WITNESS_DATA_DIR;
    process.env.WITNESS_DATA_DIR = other;
    try {
      const res = await post("12a4");
      expect(res.status).toBe(400);
    } finally {
      process.env.WITNESS_DATA_DIR = prev;
      await rm(other, { recursive: true, force: true });
    }
  });

  it("accepts the right PIN and rejects a wrong one with attempts left", async () => {
    const ok = await post("4821");
    expect(ok.status).toBe(200);
    expect(isSessionValid(tokenFrom(ok))).toBe(true);

    const bad = await post("0000");
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: "wrong-pin", attemptsLeft: 4 });
  });

  it("rejects a malformed PIN without running scrypt, counting it as a failed attempt", async () => {
    vi.mocked(verifyPin).mockClear();
    for (const pin of ["12", "abcd", "123456789", ""]) {
      const res = await post(pin);
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("wrong-pin");
    }
    expect(verifyPin).not.toHaveBeenCalled();
    const bad = await post("0000");
    expect(await bad.json()).toEqual({ error: "wrong-pin", attemptsLeft: 0 });
    expect(verifyPin).toHaveBeenCalledTimes(1);
  });

  it("5 wrong attempts trigger a cooldown, even for the right PIN", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await post("0000");
      expect(res.status).toBe(401);
    }
    const locked = await post("0000");
    expect(locked.status).toBe(429);
    const body = await locked.json();
    expect(body.error).toBe("cooldown");
    expect(body.seconds).toBeGreaterThan(0);
    expect(body.seconds).toBeLessThanOrEqual(30);

    const right = await post("4821");
    expect(right.status).toBe(429);

    const state = await (await GET()).json();
    expect(state.hasPin).toBe(true);
    expect(state.cooldownSeconds).toBeGreaterThan(0);
  });

  it("parallel wrong guesses cannot exceed the attempt limit", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => post("0000")));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBe(5);
    expect(statuses.filter((s) => s === 429).length).toBe(5);
  });

  it("DELETE ends the session and clears the cookie", async () => {
    const ok = await post("4821");
    const token = tokenFrom(ok);
    expect(isSessionValid(token)).toBe(true);

    const res = await DELETE(
      new Request("http://localhost/api/lock", {
        method: "DELETE",
        headers: { cookie: `db_s=${token}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(isSessionValid(token)).toBe(false);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/Max-Age=0/i);
  });
});
