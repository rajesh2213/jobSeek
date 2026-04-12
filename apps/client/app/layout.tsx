import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { DM_Sans, Instrument_Serif } from "next/font/google";
import { RouteLoader } from "../components/layout/RouteLoader";
import { AppProviders } from "../components/providers/AppProviders";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "700", "800"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-display",
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "JobSeek",
  description: "SEO-first job discovery platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${instrumentSerif.variable}`}>
      <body className="min-h-screen font-sans">
        <ClerkProvider afterSignOutUrl="/jobs">
          <AppProviders>
            <RouteLoader />
            <div className="relative min-h-screen">{children}</div>
          </AppProviders>
        </ClerkProvider>
      </body>
    </html>
  );
}
