import { BRAND } from "@/lib/branding";
import { SettingsProvider } from "@/lib/settings-context";
import { WaiverGate } from "@/components/WaiverGate";
import AppShell from "@/components/AppShell";
import PwaRegister from "@/components/PwaRegister";
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
        <PwaRegister />
        <SettingsProvider>
        <WaiverGate>
          <AppShell>{children}</AppShell>
        </WaiverGate>
        </SettingsProvider>
      </body>
    </html>
  );
}
