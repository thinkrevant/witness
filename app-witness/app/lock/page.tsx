"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { buttonPrimary, card, inputClass } from "@/lib/ui/styles";

interface LockInfo {
  hasPin: boolean;
  cooldownSeconds: number;
}

export default function LockPage() {
  const [info, setInfo] = useState<LockInfo | null>(null);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/lock", { cache: "no-store" });
      const data = (await res.json()) as LockInfo;
      setInfo(data);
      setCooldown(data.cooldownSeconds);
    } catch {
      setMessage("Something went wrong. Try again.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counting = cooldown > 0;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [counting]);

  const firstRun = info !== null && !info.hasPin;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || cooldown > 0) return;
    if (firstRun && pin !== confirm) {
      setMessage("The codes do not match.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/lock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        window.location.replace("/");
        return;
      }
      const data = (await res.json()) as { error?: string; seconds?: number; attemptsLeft?: number };
      if (data.error === "cooldown") {
        setCooldown(data.seconds ?? 30);
        setMessage("Too many tries. Please wait.");
      } else if (data.error === "wrong-pin") {
        if (data.attemptsLeft === 0) {
          await refresh();
          setMessage("Too many tries. Please wait.");
        } else {
          setMessage("That code is not right.");
        }
      } else if (data.error === "invalid-pin") {
        setMessage("Use 4 to 8 digits.");
      } else {
        setMessage("Something went wrong. Try again.");
      }
      setPin("");
      setConfirm("");
    } catch {
      setMessage("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-4 py-16 text-stone-900">
      <svg
        aria-hidden="true"
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-teal-700"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4.5" width="18" height="16" rx="2" />
        <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
        <circle cx="8" cy="14" r="0.8" fill="currentColor" />
        <circle cx="12" cy="14" r="0.8" fill="currentColor" />
        <circle cx="16" cy="14" r="0.8" fill="currentColor" />
      </svg>
      <h1 className="mt-3 text-2xl font-semibold">Daybook</h1>
      {info && (
        <form onSubmit={onSubmit} className={`${card} mt-6 flex w-full flex-col gap-3 p-5`}>
          <label htmlFor="code" className="text-sm font-medium text-stone-700">
            {firstRun ? "Set a 4–8 digit code" : "Enter code"}
          </label>
          <input
            id="code"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className={`${inputClass} text-lg tracking-widest`}
          />
          {firstRun && (
            <>
              <label htmlFor="confirm" className="text-sm font-medium text-stone-700">
                Confirm code
              </label>
              <input
                id="confirm"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
                className={`${inputClass} text-lg tracking-widest`}
              />
            </>
          )}
          <button
            type="submit"
            disabled={busy || cooldown > 0 || pin.length < 4}
            className={buttonPrimary}
          >
            {firstRun ? "Save" : "Open"}
          </button>
          <p role="status" className="min-h-5 text-sm text-stone-700">
            {cooldown > 0 ? `Try again in ${cooldown} seconds.` : message}
          </p>
        </form>
      )}
    </main>
  );
}
