"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Dashboard", icon: "■" },
  { href: "/positions", label: "Positions", icon: "▲" },
  { href: "/trades", label: "Trades", icon: "↔" },
  { href: "/evaluations", label: "Evaluations", icon: "☰" },
  { href: "/regime", label: "Regime", icon: "⚡" },
  { href: "/strategy", label: "Strategy", icon: "⚙" },
  { href: "/reconciliation", label: "Reconciliation", icon: "✔" },
  { href: "/controls", label: "Controls", icon: "⌘" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-screen w-56 bg-gray-950 border-r border-gray-800 flex flex-col z-20">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-800">
        <span className="text-2xl">&#x1F36F;</span>
        <span className="text-lg font-bold text-white tracking-tight">
          Huny Money
        </span>
      </div>
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-gray-800 text-white"
                  : "text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
              }`}
            >
              <span className="text-base w-5 text-center">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-500">
        v0.1.0
      </div>
    </aside>
  );
}
