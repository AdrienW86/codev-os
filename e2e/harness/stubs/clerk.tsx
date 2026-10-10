// E2E UNIQUEMENT — substitué à @clerk/nextjs dans la copie temporaire de l'application.
import type { ReactNode } from "react";

export function ClerkProvider({ children }: { children: ReactNode }) { return <>{children}</>; }
export function SignIn() { return <p>Connexion (E2E)</p>; }
export function UserButton() { return <span aria-label="Compte (E2E)" className="inline-block h-8 w-8 rounded-full bg-white/10" />; }
export function SignOutButton({ children }: { children?: ReactNode }) { return <>{children}</>; }
