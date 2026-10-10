import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "@/lib/evidence/hash";
import type { LedgerEntry } from "@/lib/evidence/types";

export interface CaseInfo {
  petitionerName: string;
  respondentName: string;
  orderNumber: string;
  court: string;
  issuedOn: string;
  expiresOn: string;
  servedOn: string;
  conditions: string;
}

export interface Settings {
  ringToken: string | null;
  demoMode: boolean;
  pinHash: string | null;
  pinSalt: string | null;
}

export interface TsaRecord {
  seq: number;
  tsrFile: string | null;
  status: "ok" | "pending" | "failed";
  requestedAt: string;
}

export interface StoreData {
  case: CaseInfo | null;
  settings: Settings;
  ledger: LedgerEntry[];
  tsa: TsaRecord[];
}

const STORE_FILE = "store.json";
const MEDIA_DIR = "media";
const TSA_DIR = "tsa";

function emptyData(): StoreData {
  return {
    case: null,
    settings: { ringToken: null, demoMode: true, pinHash: null, pinSalt: null },
    ledger: [],
    tsa: [],
  };
}

function isErrno(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === code;
}

export function createStore(dataDir: string) {
  const root = path.resolve(dataDir);
  const storePath = path.join(root, STORE_FILE);
  const mediaRoot = path.join(root, MEDIA_DIR);
  const tsaRoot = path.join(root, TSA_DIR);

  // Serializes every read/write of store.json within this process.
  let queue: Promise<unknown> = Promise.resolve();
  function locked<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  async function readFromDisk(): Promise<StoreData> {
    let raw: string;
    try {
      raw = await readFile(storePath, "utf8");
    } catch (err) {
      if (isErrno(err, "ENOENT")) return emptyData();
      throw err;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("top-level value is not an object");
      }
      return parsed as StoreData;
    } catch (err) {
      throw new Error(
        `${STORE_FILE} at ${storePath} is corrupt and was left untouched: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async function writeAtomic(target: string, bytes: Uint8Array | string) {
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, bytes);
      await rename(tmp, target);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  function resolveContained(file: string, containerRoot: string, label: string): string {
    if (path.isAbsolute(file)) {
      throw new Error(`${label} path must be relative`);
    }
    const resolved = path.resolve(root, file);
    const rel = path.relative(containerRoot, resolved);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`${label} path escapes the ${label.toLowerCase()} directory`);
    }
    return resolved;
  }

  async function readContained(file: string, containerRoot: string, label: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(resolveContained(file, containerRoot, label)));
  }

  return {
    read(): Promise<StoreData> {
      return locked(readFromDisk);
    },

    update(
      fn: (d: StoreData) => StoreData | Promise<StoreData>,
    ): Promise<StoreData> {
      return locked(async () => {
        const next = await fn(await readFromDisk());
        await writeAtomic(storePath, JSON.stringify(next, null, 2) + "\n");
        return next;
      });
    },

    /** Content-addressed and idempotent, so it does not need the store lock. */
    async writeMedia(
      bytes: Uint8Array,
      ext: "jpg" | "mp4",
    ): Promise<{ file: string; sha256: string }> {
      const sha256 = await sha256Hex(bytes);
      const file = `${MEDIA_DIR}/${sha256}.${ext}`;
      const target = path.join(root, file);
      try {
        await writeAtomic(target, bytes);
      } catch (err) {
        // Windows can refuse a rename onto a file another writer just created. The name is
        // the content hash, so an existing file already holds exactly these bytes.
        if (!(await stat(target).then(() => true, () => false))) throw err;
      }
      return { file, sha256 };
    },

    /** `file` is relative to the data dir and must resolve inside its media folder. */
    async readMedia(file: string): Promise<Uint8Array> {
      return readContained(file, mediaRoot, "Media");
    },

    /** Size and modification time of a media file; same path rules as readMedia. */
    async statMedia(file: string): Promise<{ size: number; mtimeMs: number }> {
      const { size, mtimeMs } = await stat(resolveContained(file, mediaRoot, "Media"));
      return { size, mtimeMs };
    },

    /** Stores a timestamp response as tsa/<seq>.tsr; one file per ledger entry. */
    async writeTsa(seq: number, bytes: Uint8Array): Promise<string> {
      if (!Number.isInteger(seq) || seq < 0) throw new Error("TSA seq must be a non-negative integer");
      const file = `${TSA_DIR}/${seq}.tsr`;
      await writeAtomic(path.join(root, file), bytes);
      return file;
    },

    /** `file` is relative to the data dir and must resolve inside its tsa folder. */
    async readTsa(file: string): Promise<Uint8Array> {
      return readContained(file, tsaRoot, "TSA");
    },
  };
}

export type Store = ReturnType<typeof createStore>;

declare global {
  var __witnessStores: Map<string, Store> | undefined;
}

/** The active data directory: WITNESS_DATA_DIR, or ./data under the app root. */
export function getDataDir(): string {
  return path.resolve(process.env.WITNESS_DATA_DIR ?? path.join(process.cwd(), "data"));
}

/** One store per resolved data dir, shared via globalThis so Next dev-mode module duplication keeps a single mutex. */
export function getStore(): Store {
  const dataDir = getDataDir();
  const stores = (globalThis.__witnessStores ??= new Map<string, Store>());
  let store = stores.get(dataDir);
  if (!store) {
    store = createStore(dataDir);
    stores.set(dataDir, store);
  }
  return store;
}
