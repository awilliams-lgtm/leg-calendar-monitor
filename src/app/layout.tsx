import type { Metadata } from "next";
import { Fraunces, Public_Sans } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import { SaLoginBanner } from "@/components/SaLoginBanner";
import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Legislative calendars",
  description: "Official 50-state legislative calendars with State Affairs coverage",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${publicSans.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="flex min-h-full min-w-0 flex-col">
        <SiteHeader />
        <SaLoginBanner />
        <main className="mx-auto w-full min-w-0 max-w-[90rem] flex-1 px-4 py-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
