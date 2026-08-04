"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Codes search", index: "01" },
  { href: "/query-forms", label: "Query forms", index: "02" },
  { href: "/query-forms/history", label: "History", index: "03" },
];

export function NavTabs() {
  const pathname = usePathname();

  return (
    <nav className="mt-5 flex gap-6">
      {TABS.map((tab) => {
        const active =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`group relative flex items-center gap-2 pb-3 text-sm transition-colors ${
              active ? "text-ink" : "text-ink-faint hover:text-ink-soft"
            }`}
          >
            <span className="font-mono text-[10px] text-ink-faint group-hover:text-brand-600">
              {tab.index}
            </span>
            <span className={active ? "font-medium" : ""}>{tab.label}</span>
            <span
              className={`absolute -bottom-px left-0 right-0 h-[2px] rounded-full transition-colors ${
                active ? "bg-brand-600" : "bg-transparent"
              }`}
            />
          </Link>
        );
      })}
    </nav>
  );
}
