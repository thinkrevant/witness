"use client";

import { usePathname } from "next/navigation";
import AppLink from "@/components/AppLink";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/incidents", label: "Incident log" },
  { href: "/report", label: "Report" },
  { href: "/verify", label: "Verify" },
  { href: "/safety", label: "Safety" },
  { href: "/settings", label: "Settings" },
];

/** Main navigation: a 3 × 2 grid on phones, one row from 640 px up. Marks the current page. */
export default function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="grid grid-cols-3 gap-1 pb-2 sm:flex sm:flex-wrap sm:pb-0">
      {NAV.map((item) => {
        const current = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <AppLink
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${
              current ? "bg-teal-50 text-teal-900 ring-1 ring-teal-200" : "text-stone-700 hover:bg-stone-100"
            }`}
          >
            {item.label}
          </AppLink>
        );
      })}
    </nav>
  );
}
