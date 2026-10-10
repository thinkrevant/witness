import { badRequest, readJsonObject, rejectCrossSite } from "@/lib/api/http";
import { requireSession } from "@/lib/auth/session";
import { getStore, type CaseInfo } from "@/lib/store/store";

const FIELDS = [
  "petitionerName",
  "respondentName",
  "orderNumber",
  "court",
  "issuedOn",
  "expiresOn",
  "servedOn",
  "conditions",
] as const satisfies readonly (keyof CaseInfo)[];

const MAX_FIELD_LENGTH = 2000;

/** Every field is an optional string (trimmed, default ""); the respondent's name is required. */
function parseCase(body: Record<string, unknown> | null): CaseInfo | null {
  if (!body) return null;
  const info = {} as CaseInfo;
  for (const field of FIELDS) {
    const value = body[field] ?? "";
    if (typeof value !== "string" || value.length > MAX_FIELD_LENGTH) return null;
    info[field] = value.trim();
  }
  return info.respondentName === "" ? null : info;
}

export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  return Response.json({ case: (await getStore().read()).case });
}

export async function PUT(req: Request) {
  const forbidden = rejectCrossSite(req);
  if (forbidden) return forbidden;
  const denied = requireSession(req);
  if (denied) return denied;

  const info = parseCase(await readJsonObject(req));
  if (!info) return badRequest();
  await getStore().update((d) => ({ ...d, case: info }));
  return Response.json({ case: info });
}
