import { rejectCrossSite } from "@/lib/api/http";
import {
  cooldownSeconds,
  recordPinFailure,
  resetPinFailures,
  serializedPinAttempt,
} from "@/lib/auth/attempts";
import { hashPin, isValidPin, verifyPin } from "@/lib/auth/pin";
import {
  SESSION_COOKIE,
  createSession,
  endSession,
  isSessionValid,
  readSessionToken,
} from "@/lib/auth/session";
import { stopAllLiveSessions } from "@/lib/live/sessions";
import { getStore } from "@/lib/store/store";

function sessionCookie(token: string): string {
  // No Secure flag: the app is served over plain http on localhost.
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

export async function GET() {
  const { settings } = await getStore().read();
  return Response.json({
    hasPin: settings.pinHash !== null && settings.pinSalt !== null,
    cooldownSeconds: cooldownSeconds(),
  });
}

export async function POST(req: Request) {
  const forbidden = rejectCrossSite(req);
  if (forbidden) return forbidden;

  let pin: unknown;
  try {
    pin = ((await req.json()) as { pin?: unknown } | null)?.pin;
  } catch {
    return Response.json({ error: "bad-request" }, { status: 400 });
  }
  if (typeof pin !== "string") {
    return Response.json({ error: "bad-request" }, { status: 400 });
  }

  return serializedPinAttempt(async () => {
    const seconds = cooldownSeconds();
    if (seconds > 0) {
      return Response.json({ error: "cooldown", seconds }, { status: 429 });
    }

    const store = getStore();
    const { pinHash, pinSalt } = (await store.read()).settings;
    const hasPin = pinHash !== null && pinSalt !== null;
    // A malformed PIN can never match, so it is refused before any scrypt work.
    if (!isValidPin(pin)) {
      return hasPin
        ? Response.json({ error: "wrong-pin", attemptsLeft: recordPinFailure() }, { status: 401 })
        : Response.json({ error: "invalid-pin" }, { status: 400 });
    }

    if (!hasPin) {
      const { hash, salt } = await hashPin(pin);
      let alreadySet = false;
      await store.update((d) => {
        if (d.settings.pinHash !== null) {
          alreadySet = true;
          return d;
        }
        return { ...d, settings: { ...d.settings, pinHash: hash, pinSalt: salt } };
      });
      if (alreadySet) {
        return Response.json({ error: "bad-request" }, { status: 409 });
      }
    } else if (!(await verifyPin(pin, pinHash, pinSalt))) {
      return Response.json(
        { error: "wrong-pin", attemptsLeft: recordPinFailure() },
        { status: 401 },
      );
    }

    resetPinFailures();
    const token = createSession();
    return Response.json(
      { ok: true },
      { status: 200, headers: { "Set-Cookie": sessionCookie(token) } },
    );
  });
}

export async function DELETE(req: Request) {
  const token = readSessionToken(req);
  if (token && isSessionValid(token)) {
    endSession(token);
    // Locking (or Quick exit) also ends any live view. Not awaited: leaving must stay instant.
    void stopAllLiveSessions();
  }
  return Response.json(
    { ok: true },
    {
      status: 200,
      headers: { "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` },
    },
  );
}
