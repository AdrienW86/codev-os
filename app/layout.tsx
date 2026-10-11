import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { themeColors } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CODE-V OS", template: "%s · CODE-V OS" },
  description: "Cockpit interne CODE-V — clients, agents et recommandations.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "CODE-V OS", statusBarStyle: "default" },
  icons: { apple: "/pwa/apple-touch-icon.png" },
};
export const viewport: Viewport = { themeColor: themeColors.background };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="fr" className="antialiased"><body><ClerkProvider signInUrl="/sign-in" signInFallbackRedirectUrl="/dashboard">{children}</ClerkProvider></body></html>;
}
