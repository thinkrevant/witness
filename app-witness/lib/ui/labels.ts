const EVENT_TYPE_LABELS: Record<string, string> = {
  on_demand: "Live view",
  motion: "Motion",
  ding: "Doorbell press",
};

/** Plain-language name for a raw Ring event_type. */
export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

/** "Sealed · fingerprint 3f9a…" from a SHA-256 hex digest. */
export function fingerprintLabel(sha256: string): string {
  return `Sealed · fingerprint ${sha256.slice(0, 4)}…`;
}
