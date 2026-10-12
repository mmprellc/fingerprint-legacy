import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { RegisterSW } from "@/components/RegisterSW";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const serif = localFont({
  src: [
    { path: "../fonts/CormorantGaramond-Regular.ttf", weight: "400", style: "normal" },
    { path: "../fonts/CormorantGaramond-Medium.ttf", weight: "500", style: "normal" },
    { path: "../fonts/CormorantGaramond-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../fonts/CormorantGaramond-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-serif",
  display: "swap",
});

const script = localFont({
  src: "../fonts/GreatVibes-Regular.ttf",
  variable: "--font-script",
  display: "swap",
});

const ridge = localFont({
  src: "../fonts/LibreBaskerville-Bold.ttf",
  variable: "--font-ridge",
  display: "swap",
});

const ridgeAlt = localFont({
  src: "../fonts/CormorantGaramond-SemiBold.ttf",
  variable: "--font-ridge-alt",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Fingerprint Legacy", template: "%s · Fingerprint Legacy" },
  description: "Turn a loved one's fingerprint into a portrait whose ridges are made of the words you give it. People leave fingerprints. Love leaves a legacy.",
  applicationName: "Fingerprint Legacy",
  appleWebApp: { capable: true, title: "The Dash", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#F6F1E8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${script.variable} ${ridge.variable} ${ridgeAlt.variable}`}>
      <body className={serif.className}>
        <a className="skip" href="#content">Skip to content</a>
        <SiteHeader />
        <main id="content">{children}</main>
        <SiteFooter />
        <RegisterSW />
      </body>
    </html>
  );
}
