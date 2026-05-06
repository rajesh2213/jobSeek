import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { DM_Sans, Instrument_Serif } from "next/font/google";
import { RouteLoader } from "../components/layout/RouteLoader";
import { AppProviders } from "../components/providers/AppProviders";
import { getSiteBaseUrl } from "../lib/seoSite";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  /** 800 omitted — `font-extrabold` maps to 700 in Tailwind to avoid an extra file. */
  weight: ["400", "500", "700"],
  display: "swap",
  adjustFontFallback: true,
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-display",
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
  adjustFontFallback: true,
});

const description =
  "Discover open roles, apply early, and track applications—SEO-aware job discovery in one place.";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteBaseUrl()),
  title: "JobLoom – Find Jobs Faster",
  description,
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "JobLoom – Find Jobs Faster",
    description,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "JobLoom" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-image.png"],
  },
  verification: {
    google: "5KppTyFWcHYjgW54ywECyArCL2o4wJXhoQ_dna6JLEE",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${instrumentSerif.variable}`}>
      <body className="min-h-screen font-sans">
        <ClerkProvider
          afterSignOutUrl="/jobs"
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
        >
          <AppProviders>
            <RouteLoader />
            <div className="relative min-h-screen">{children}</div>
          </AppProviders>
        </ClerkProvider>
      </body>
    </html>
  );
}
