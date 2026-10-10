import { badRequest, readJsonObject, rejectCrossSite } from "@/lib/api/http";
import {
  cooldownSeconds,
  recordPinFailure,
  resetPinFailures,
  serializedPinAttempt,
} from "@/lib/auth/attempts";
import { hashPin, isValidPin, verifyPin } from "@/lib/auth/pin";
import { endOtherSessions, readSessionToken, requireSession } from "@/lib/auth/session";
import { effectiveToken } from "@/lib/sources/source";
import { getStore, type Settings } from "@/lib/store/store";

const MAX_TOKEN_LENGTH = 8192;

/** What the client may see: never the token or the PIN hash. */
function publicView(settings: Settings) {
  return { demoMode: settings.demoMode, hasToken: effectiveToken(settings) !== null };
}

async function save(changes: Partial<Settings>): Promise<Response> {
  const next = await getStore().update((d) => ({ ...d, settings: { ...d.settings, ...changes } }));
  return Response.json(publicView(next.settings));
}

export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  return Response.json(publicView((await getStore().read()).settings));
}

/** Accepts {ringToken?, demoMode?} and/or {currentPin, newPin}. */
export async function PUT(req: Request) {
  const forbidden = rejectCrossSite(req);
  if (forbidden) return forbidden;
  const denied = requireSession(req);
  if (denied) return denied;

  const body = await readJsonObject(req);
  if (!body) return badRequest();
  const changes: Partial<Settings> = {};

  if ("ringToken" in body) {
    const token = body.ringToken;
    if (token !== null && (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH)) {
      return badRequest();
    }
    changes.ringToken = token === null || token.trim() === "" ? null : token.trim();
  }

  if ("demoMode" in body) {
    if (typeof body.demoMode !== "boolean") return badRequest();
    changes.demoMode = body.demoMode;
  }

  if (!("currentPin" in body || "newPin" in body)) {
    return Object.keys(changes).length === 0 ? badRequest() : save(changes);
  }

  const { currentPin, newPin } = body;
  if (typeof currentPin !== "string" || typeof newPin !== "string") return badRequest();
  if (!isValidPin(newPin)) return badRequest("invalid-pin");

  // Same throttle as unlocking, so an open session cannot be used to guess the PIN.
  return serializedPinAttempt(async () => {
    const seconds = cooldownSeconds();
    if (seconds > 0) return Response.json({ error: "cooldown", seconds }, { status: 429 });

    const { settings } = await getStore().read();
    const matches =
      settings.pinHash !== null &&
      settings.pinSalt !== null &&
      (await verifyPin(currentPin, settings.pinHash, settings.pinSalt));
    if (!matches) {
      return Response.json({ error: "wrong-pin", attemptsLeft: recordPinFailure() }, { status: 403 });
    }
    resetPinFailures();

    const { hash, salt } = await hashPin(newPin);
    const res = await save({ ...changes, pinHash: hash, pinSalt: salt });
    endOtherSessions(readSessionToken(req));
    return res;
  });
}
