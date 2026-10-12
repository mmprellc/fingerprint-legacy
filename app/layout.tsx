import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/pwa";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Fingerprint Legacy", template: "%s · Fingerprint Legacy" },
  description:
    "Turn a real fingerprint into heirloom art. Every ridge is formed from the names, places, dates, and verses you choose. You design it. It goes straight to print.",
  applicationName: "Fingerprint Legacy",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Fingerprint Legacy", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#f4efe6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
        <PwaRegister />
      </body>
    </html>
  );
}
