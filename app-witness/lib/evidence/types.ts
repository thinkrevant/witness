export type MediaKind = "snapshot" | "clip";

export interface MediaRecord {
  kind: MediaKind;
  sha256: string;
  bytes: number;
  contentType: string;
  file: string;
  ringMediaTimestamp: number | null;
  ringMediaDuration: number | null;
  ringRequestId: string | null;
  /** ISO 8601 timestamp */
  retrievedAt: string;
}

export interface LedgerEntryBody {
  seq: number;
  prevHash: string;
  incidentId: string;
  ringEventId: string;
  deviceId: string;
  eventStart: number;
  eventEnd: number;
  media: MediaRecord[];
  clipUnavailable: boolean;
  note: string;
  loggedAt: string;
  source: "ring" | "demo";
}

export interface LedgerEntry extends LedgerEntryBody {
  entryHash: string;
}

export interface ChainReport {
  ok: boolean;
  problems: {
    seq: number;
    reason: "prevHash-mismatch" | "entryHash-mismatch" | "seq-gap";
  }[];
}
