"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { PLAYGROUND_URL } from "@/components/RingStatus";
import { ApiError, api } from "@/lib/ui/api";
import { buttonPrimary, buttonSecondary, card, inputClass, linkClass } from "@/lib/ui/styles";

interface PublicSettings {
  demoMode: boolean;
  hasToken: boolean;
}

function RingSection({
  settings,
  save,
}: {
  settings: PublicSettings;
  save: (changes: { ringToken?: string | null; demoMode?: boolean }, done: string) => Promise<boolean>;
}) {
  const [token, setToken] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (await save({ ringToken: token, demoMode: false }, "Ring token saved.")) setToken("");
  }

  return (
    <section className={`${card} flex flex-col gap-3`}>
      <h2 className="text-lg font-semibold">Ring connection</h2>
      <p className="text-sm text-stone-600">
        {settings.hasToken ? "A Ring token is saved." : "No Ring token saved yet."} Get a token from
        the{" "}
        <a href={PLAYGROUND_URL} target="_blank" rel="noreferrer" className={linkClass}>
          Ring Developer Playground
        </a>
        . Playground tokens last about 30 minutes.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label htmlFor="ring-token" className="text-sm font-medium text-stone-800">
          Paste token
        </label>
        <input
          id="ring-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className={inputClass}
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" disabled={token.trim() === ""} className={buttonPrimary}>
            Save token
          </button>
          {settings.hasToken && (
            <button
              type="button"
              onClick={() => save({ ringToken: null }, "Ring token removed.")}
              className={buttonSecondary}
            >
              Remove token
            </button>
          )}
        </div>
      </form>
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 border-t border-stone-200 pt-3">
        <span>
          <span className="block font-medium">Demo mode</span>
          <span className="block text-sm text-stone-600">
            Use Ring Developer Playground simulated footage instead of your doorbell.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={settings.demoMode}
          onChange={(e) =>
            save({ demoMode: e.target.checked }, e.target.checked ? "Demo mode on." : "Demo mode off.")
          }
          className="h-6 w-6 shrink-0 accent-teal-700"
        />
      </label>
    </section>
  );
}

function PinSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setMessage("The new codes do not match.");
      return;
    }
    try {
      await api("/api/settings", { method: "PUT", body: { currentPin: current, newPin: next } });
      setMessage("Code changed.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setMessage(
        code === "wrong-pin"
          ? "Your current code is not right."
          : code === "cooldown"
            ? "Too many tries. Please wait a little, then try again."
            : code === "invalid-pin"
              ? "Use 4 to 8 digits."
              : "The code could not be changed. Please try again.",
      );
    }
  }

  const pinInput = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
      </label>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, ""))}
        className={`${inputClass} mt-1 tracking-widest`}
      />
    </div>
  );

  return (
    <form onSubmit={onSubmit} className={`${card} flex flex-col gap-3`}>
      <h2 className="text-lg font-semibold">Change code</h2>
      {pinInput("pin-current", "Current code", current, setCurrent)}
      {pinInput("pin-new", "New code (4–8 digits)", next, setNext)}
      {pinInput("pin-confirm", "Confirm new code", confirm, setConfirm)}
      <button type="submit" disabled={current.length < 4 || next.length < 4} className={buttonPrimary}>
        Change code
      </button>
      <p role="status" className="min-h-5 text-sm text-stone-700">
        {message}
      </p>
    </form>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<PublicSettings>("/api/settings")
      .then(setSettings)
      .catch(() => setMessage("Settings could not be loaded."));
  }, []);

  async function save(changes: { ringToken?: string | null; demoMode?: boolean }, done: string) {
    try {
      setSettings(await api<PublicSettings>("/api/settings", { method: "PUT", body: changes }));
      setMessage(done);
      router.refresh(); // Re-renders the layout so the demo banner matches.
      return true;
    } catch {
      setMessage("That could not be saved. Please try again.");
      return false;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <p role="status" className="min-h-5 text-sm text-stone-700">
        {message}
      </p>
      {settings && <RingSection settings={settings} save={save} />}
      <PinSection />
    </div>
  );
}
