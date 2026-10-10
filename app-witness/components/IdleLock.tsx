"use client";

import { useEffect } from "react";

const DEFAULT_IDLE_MS = 5 * 60 * 1000;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "touchstart", "scroll", "wheel"] as const;

function idleMs(): number {
  const override = Number(process.env.NEXT_PUBLIC_IDLE_MS);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_IDLE_MS;
}

export default function IdleLock() {
  useEffect(() => {
    const timeout = idleMs();
    let timer: ReturnType<typeof setTimeout>;

    async function lock() {
      try {
        await fetch("/api/lock", { method: "DELETE", keepalive: true });
      } catch {
        // Lock the screen even if the request failed.
      }
      window.location.replace("/lock");
    }

    function reset() {
      clearTimeout(timer);
      timer = setTimeout(lock, timeout);
    }

    // A page restored from the back/forward cache skips the server's session check; reload it
    // so a locked session lands on the lock screen instead of showing old content.
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) window.location.reload();
    }

    reset();
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, reset, { passive: true });
    }
    window.addEventListener("pageshow", onPageShow);
    return () => {
      clearTimeout(timer);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, reset);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return null;
}
