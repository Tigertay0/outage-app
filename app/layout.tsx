import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/components/providers/QueryProvider";
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
  title: "Outage Tracker - Real-time Service Outage Tracking",
  description: "Track power, internet, and cellular outages in real-time. View outages on an interactive map, report issues, and stay informed about service disruptions in your area.",
  keywords: ["outage tracker", "service outage", "power outage", "internet outage", "cellular outage", "network status"],
  authors: [{ name: "Outage Tracker Team" }],
  creator: "Outage Tracker",
  publisher: "Outage Tracker",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Outage Tracker",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: "Outage Tracker",
    title: "Outage Tracker - Real-time Service Outage Tracking",
    description: "Track power, internet, and cellular outages in real-time on an interactive map.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Outage Tracker",
    description: "Track service outages in real-time on an interactive map.",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <QueryProvider>
          {children}
          <Toaster />
        </QueryProvider>
      </body>
    </html>
  );
}
