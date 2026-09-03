import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { ServiceWorkerRegistrar } from "@/components/providers/service-worker";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Outage Tracker — Power, internet and cellular outages near you",
  description:
    "See power, internet and cellular outages on one live map. Report what is down where you are, confirm what others report, and find out whether the problem is your router or your whole street.",
  keywords: [
    "outage tracker",
    "service outage",
    "power outage",
    "internet outage",
    "cellular outage",
    "network status",
  ],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Outage Tracker",
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: "Outage Tracker",
    title: "Outage Tracker",
    description:
      "Power, internet and cellular outages on one live map. Report, confirm, and see what is actually down.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Outage Tracker",
    description: "Service outages on one live map.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays enabled. Locking it is an accessibility failure in general,
  // and doubly so here: reading a dense cluster of markers depends on zooming.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <QueryProvider>
          {children}
          <Toaster />
          <ServiceWorkerRegistrar />
        </QueryProvider>
      </body>
    </html>
  );
}
