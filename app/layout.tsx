import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CODE-V OS", template: "%s · CODE-V OS" },
  description: "Cockpit interne CODE-V — clients, agents et recommandations.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="fr" className="antialiased"><body><ClerkProvider signInUrl="/sign-in" signInFallbackRedirectUrl="/dashboard">{children}</ClerkProvider></body></html>;
}
