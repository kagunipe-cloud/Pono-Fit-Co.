import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import { BRAND } from "@/lib/branding";
import { SettingsProvider } from "@/lib/settings-context";
import { WaiverGate } from "@/components/WaiverGate";
import "./globals.css";

export const metadata = {
  title: BRAND.name,
  description: "Gym membership, classes, PT, and door access",
  manifest: "/api/manifest",
  icons: {
    icon: [
      { url: "/Lei_Logos.png", sizes: "192x192", type: "image/png" },
      { url: "/Lei_Logos.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/Lei_Logos.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: BRAND.name,
  },
};

export const viewport = {
  themeColor: BRAND.themeColor,
};

export default function RootLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gradient-to-r from-white to-brand-200 text-stone-900 antialiased">
        <SettingsProvider>
        <WaiverGate>
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
        </WaiverGate>
        </SettingsProvider>
      </body>
    </html>
  );
}
