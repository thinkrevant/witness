import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AppLink from "@/components/AppLink";
import IdleLock from "@/components/IdleLock";
import NavLinks from "@/components/NavLinks";
import { SESSION_COOKIE, isSessionValid } from "@/lib/auth/session";
import { getSource } from "@/lib/sources/source";
import { getStore } from "@/lib/store/store";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isSessionValid(token)) redirect("/lock");
  const { kind } = await getSource((await getStore().read()).settings);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <IdleLock />
      <header className="border-b border-stone-200 bg-white">
        {/* Right padding keeps the brand and nav clear of the fixed Exit button. */}
        <div className="mx-auto flex max-w-[720px] flex-col px-4 sm:flex-row sm:items-center sm:gap-4 sm:py-2 sm:pr-24">
          <AppLink
            href="/"
            className="inline-flex min-h-15 items-center gap-2 self-start pr-24 font-semibold text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 sm:min-h-11 sm:pr-0"
          >
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 32 32" className="shrink-0">
              <rect x="3" y="5" width="26" height="24" rx="4" fill="#f5f5f4" stroke="#44403c" strokeWidth="2" />
              <path d="M3 12h26" stroke="#44403c" strokeWidth="2" />
              <path d="M10 2.5v6M22 2.5v6" stroke="#44403c" strokeWidth="2.5" strokeLinecap="round" />
              <rect x="8" y="16" width="4" height="4" rx="1" fill="#0f766e" />
            </svg>
            Daybook
          </AppLink>
          <NavLinks />
        </div>
      </header>
      {kind === "demo" && (
        <p className="bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-900">
          Demo mode — Ring Developer Playground simulated footage
        </p>
      )}
      <main className="mx-auto max-w-[720px] px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-[720px] px-4 pb-8 text-sm text-stone-600">
        This app does not provide legal advice. Talk to an advocate or attorney.
      </footer>
    </div>
  );
}
