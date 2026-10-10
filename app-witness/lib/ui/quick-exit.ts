export const DOUBLE_ESC_MS = 1000;
export const EXIT_URL = "https://weather.com";

type Key = Pick<KeyboardEvent, "key" | "repeat">;

/**
 * Returns a keydown checker that is true when a key press completes "Esc twice within
 * windowMs". Auto-repeat from holding Esc down is ignored, so one long press never counts twice.
 */
export function createDoubleEscDetector(windowMs = DOUBLE_ESC_MS) {
  let lastEsc: number | null = null;
  return (e: Key, now: number): boolean => {
    if (e.key !== "Escape" || e.repeat) return false;
    if (lastEsc !== null && now - lastEsc <= windowMs) {
      lastEsc = null;
      return true;
    }
    lastEsc = now;
    return false;
  };
}
