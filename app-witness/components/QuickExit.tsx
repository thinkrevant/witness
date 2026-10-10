"use client";

import { useEffect } from "react";
import { EXIT_URL, createDoubleEscDetector } from "@/lib/ui/quick-exit";

function quickExit() {
  // Fire-and-forget: end the session, but never wait on it before leaving.
  try {
    void fetch("/api/lock", { method: "DELETE", keepalive: true }).catch(() => undefined);
  } catch {
    // Leaving the page matters more than ending the session.
  }
  window.location.replace(EXIT_URL);
}

export default function QuickExit() {
  useEffect(() => {
    const isDoubleEsc = createDoubleEscDetector();
    function onKeyDown(e: KeyboardEvent) {
      if (isDoubleEsc(e, Date.now())) quickExit();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <button
      type="button"
      onClick={quickExit}
      className="fixed right-3 top-2 z-50 inline-flex min-h-11 items-center rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white shadow-md ring-2 ring-white hover:bg-stone-700 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
    >
      Exit
    </button>
  );
}
