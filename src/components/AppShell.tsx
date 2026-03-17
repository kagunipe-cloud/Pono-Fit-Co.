"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import Sidebar from "./Sidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isEmbed = pathname?.startsWith("/embed");

  if (isEmbed) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-gradient-to-r from-white to-brand-200 p-4 pt-14 md:p-6 md:pt-6 flex flex-col">
        <div className="flex-1">{children}</div>
        <footer className="mt-12 pt-6 border-t border-stone-200 text-sm text-stone-500 text-center">
          <Link href="/privacy" className="text-brand-600 hover:underline">Privacy Policy</Link>
          {" · "}
          <Link href="/terms" className="text-brand-600 hover:underline">Terms of Service</Link>
          <p className="mt-2">© 2026 PBJB LLC. All rights reserved.</p>
        </footer>
      </main>
    </div>
  );
}
