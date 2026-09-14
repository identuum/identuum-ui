import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { GET as readBackendStatus } from "@/app/api/status/route";
import { BruteForceWarning } from "@/components/shared/brute-force-warning";
import "./globals.css";

export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Identuum",
  description: "Identity and agent governance platform",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const status = await (await readBackendStatus()).json();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body>
        <BruteForceWarning
          initiallyDisabled={status.idp.brute_force_protection_disabled === true}
        />
        {children}
      </body>
    </html>
  );
}
