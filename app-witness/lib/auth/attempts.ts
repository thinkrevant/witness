// One PIN-guess throttle for every place that checks the PIN (unlock and PIN change).

const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 30_000;

interface LockState {
  failures: number;
  lockedUntil: number;
}

declare global {
  var __witnessLockState: LockState | undefined;
  var __witnessLockQueue: Promise<unknown> | undefined;
}

/**
 * Runs PIN attempts one at a time (on globalThis, so dev-mode module duplication shares it).
 * Without this, parallel guesses all pass the cooldown check before any failure is counted.
 */
export function serializedPinAttempt<T>(task: () => Promise<T>): Promise<T> {
  const prev = globalThis.__witnessLockQueue ?? Promise.resolve();
  const run = prev.then(task, task);
  globalThis.__witnessLockQueue = run.catch(() => undefined);
  return run;
}

function lockState(): LockState {
  return (globalThis.__witnessLockState ??= { failures: 0, lockedUntil: 0 });
}

/** Seconds left in the cooldown, or 0. Clears an expired cooldown and its failure count. */
export function cooldownSeconds(): number {
  const state = lockState();
  const left = state.lockedUntil - Date.now();
  if (left <= 0) {
    if (state.lockedUntil !== 0) {
      state.lockedUntil = 0;
      state.failures = 0;
    }
    return 0;
  }
  return Math.ceil(left / 1000);
}

/** Counts a wrong PIN, starting the cooldown at the limit. Returns the attempts left. */
export function recordPinFailure(): number {
  const state = lockState();
  state.failures += 1;
  if (state.failures >= MAX_ATTEMPTS) state.lockedUntil = Date.now() + COOLDOWN_MS;
  return Math.max(0, MAX_ATTEMPTS - state.failures);
}

export function resetPinFailures(): void {
  lockState().failures = 0;
}
