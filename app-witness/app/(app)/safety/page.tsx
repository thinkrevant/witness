import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, isSessionValid } from "@/lib/auth/session";
import { card, linkClass } from "@/lib/ui/styles";

const TECH_SAFETY_URL = "https://www.techsafety.org";

const HELPLINES = [
  {
    name: "US National Domestic Violence Hotline",
    detail: (
      <>
        Call{" "}
        <a href="tel:+18007997233" className={linkClass}>
          1-800-799-7233
        </a>{" "}
        or text <strong>START</strong> to{" "}
        <a href="sms:88788" className={linkClass}>
          88788
        </a>
        .
      </>
    ),
  },
  {
    name: "UK National Domestic Abuse Helpline",
    detail: (
      <>
        Call{" "}
        <a href="tel:+448082000247" className={linkClass}>
          0808 2000 247
        </a>
        .
      </>
    ),
  },
];

export default async function SafetyPage() {
  // Checked here too, not only in the layout: a direct RSC request can skip the layout.
  if (!isSessionValid((await cookies()).get(SESSION_COOKIE)?.value)) redirect("/lock");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Safety</h1>

      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
        <h2 className="font-semibold">Is this device safe to use?</h2>
        <p className="mt-1">
          If your abuser can access this device or account, using this app may not be safe. Think about
          who else can unlock this computer or phone, or read your email and cloud accounts.
        </p>
        <p className="mt-2">
          For help with tech safety planning, visit{" "}
          <a href={TECH_SAFETY_URL} target="_blank" rel="noreferrer" className={linkClass}>
            techsafety.org
          </a>{" "}
          (Safety Net, from the National Network to End Domestic Violence).
        </p>
      </section>

      <section className={`${card} flex flex-col gap-3`}>
        <h2 className="text-lg font-semibold">Talk to someone</h2>
        <p className="font-medium text-stone-900">
          In an emergency, call <strong>911</strong> (US) / <strong>999</strong> (UK) /{" "}
          <strong>112</strong> (EU and most mobile phones).
        </p>
        <ul className="flex flex-col gap-3">
          {HELPLINES.map((line) => (
            <li key={line.name} className="border-t border-stone-200 pt-3">
              <p className="font-medium">{line.name}</p>
              <p className="text-stone-700">{line.detail}</p>
            </li>
          ))}
        </ul>
        <p className="text-sm text-stone-600">
          Helplines are free, confidential and open 24 hours a day. An advocate can help you make a
          safety plan and understand your protective order.
        </p>
      </section>

      <section className={`${card} flex flex-col gap-2`}>
        <h2 className="text-lg font-semibold">How quick exit works</h2>
        <p className="text-stone-700">
          Press <strong>Exit</strong> at the top right of any page, or press the <kbd className="rounded border border-stone-300 bg-stone-100 px-1.5 font-mono text-sm">Esc</kbd> key
          twice quickly. This page is replaced straight away by a weather website, and Daybook locks
          itself.
        </p>
        <p className="text-stone-700">
          Daybook keeps just one entry in your browser&apos;s history, so pressing Back after a quick
          exit does not bring the app back. It also locks after 5 minutes without use, and asks for
          your code again.
        </p>
        <p className="text-sm text-stone-600">
          Your browser&apos;s history list can still show that this page was opened. If someone checks
          your browser, you may want to clear your history.
        </p>
      </section>

      <section className={`${card} flex flex-col gap-2`}>
        <h2 className="text-lg font-semibold">About this app</h2>
        <p className="text-stone-700">
          This app does not provide legal advice. Talk to an advocate or attorney. They can also help you
          decide when and how to share a report.
        </p>
        <p className="text-sm text-stone-600">
          Your records stay on this device. Only a fingerprint of each sealed record is sent to an
          independent timestamp service; your footage and notes are never uploaded. Nothing is shared
          unless you download a report and give it to someone yourself.
        </p>
      </section>
    </div>
  );
}
