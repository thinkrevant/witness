"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import type { CaseInfo } from "@/lib/store/store";
import { api } from "@/lib/ui/api";
import { buttonPrimary, inputClass } from "@/lib/ui/styles";

const EMPTY: CaseInfo = {
  petitionerName: "",
  respondentName: "",
  orderNumber: "",
  court: "",
  issuedOn: "",
  expiresOn: "",
  servedOn: "",
  conditions: "",
};

const FIELDS: { name: keyof CaseInfo; label: string; type?: "date" | "textarea"; hint?: string }[] = [
  { name: "petitionerName", label: "Your name" },
  { name: "respondentName", label: "Name of the person the order is against" },
  { name: "orderNumber", label: "Order or case number" },
  { name: "court", label: "Court" },
  { name: "issuedOn", label: "Date issued", type: "date" },
  { name: "expiresOn", label: "Expiry date", type: "date" },
  { name: "servedOn", label: "Date the order was served", type: "date" },
  {
    name: "conditions",
    label: "Conditions",
    type: "textarea",
    hint: "For example: no contact; stay 100 yards away.",
  },
];

export default function SetupPage() {
  const router = useRouter();
  const [info, setInfo] = useState<CaseInfo>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<{ case: CaseInfo | null }>("/api/case")
      .then((d) => d.case && setInfo(d.case))
      .catch(() => setMessage("Your saved details could not be loaded."));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api("/api/case", { method: "PUT", body: info });
      router.replace("/");
    } catch {
      setMessage("Your details could not be saved. Please check them and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Your case</h1>
        <p className="mt-1 text-stone-600">
          These details go into your reports. Only the other person&apos;s name is required, and you can change everything later.
        </p>
      </div>
      {FIELDS.map((f) => (
        <div key={f.name}>
          <label htmlFor={f.name} className="block text-sm font-medium text-stone-800">
            {f.label}
          </label>
          {f.type === "textarea" ? (
            <textarea
              id={f.name}
              rows={3}
              value={info[f.name]}
              onChange={(e) => setInfo({ ...info, [f.name]: e.target.value })}
              className={`${inputClass} mt-1`}
            />
          ) : (
            <input
              id={f.name}
              type={f.type ?? "text"}
              required={f.name === "respondentName"}
              autoComplete="off"
              value={info[f.name]}
              onChange={(e) => setInfo({ ...info, [f.name]: e.target.value })}
              className={`${inputClass} mt-1`}
            />
          )}
          {f.hint && <p className="mt-1 text-sm text-stone-600">{f.hint}</p>}
        </div>
      ))}
      <button type="submit" disabled={busy} className={buttonPrimary}>
        {busy ? "Saving…" : "Save"}
      </button>
      <p role="status" className="min-h-5 text-sm text-red-700">
        {message}
      </p>
    </form>
  );
}
