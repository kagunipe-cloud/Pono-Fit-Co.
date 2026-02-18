import Sidebar from "@/components/Sidebar";
import { BRAND } from "@/lib/branding";
import "./globals.css";

export const metadata = {
  title: BRAND.name,
  description: "Gym membership, classes, PT, and door access",
  manifest: "/api/manifest",
  icons: {
    icon: [{ url: "/app-icon.png", sizes: "192x192", type: "image/png" }, { url: "/app-icon.svg", sizes: "any", type: "image/svg+xml" }],
    apple: "/app-icon.png",
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
      <body className="min-h-screen bg-stone-100 text-stone-900 antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 overflow-auto p-6 bg-stone-100">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
