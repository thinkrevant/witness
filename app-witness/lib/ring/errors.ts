/** The Ring API rejected the access token (HTTP 401). */
export class RingAuthError extends Error {
  constructor(message = "Ring access token was rejected (401). Check or replace the token.") {
    super(message);
    this.name = "RingAuthError";
  }
}

/**
 * The requested footage cannot be fetched: 416/425 persisted through every
 * retry, or the time range is not accessible with this token (403).
 */
export class RingMediaUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RingMediaUnavailable";
  }
}
