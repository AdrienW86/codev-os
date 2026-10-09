import "server-only";
import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { isAuthorizedAdmin } from "@/lib/admin-policy";

// À appeler AVANT toute lecture sensible ou mutation, y compris dans chaque
// future Server Action / Route Handler. Ne pas intercepter ces interruptions.
export async function requireAdmin() {
  const { userId, isAuthenticated } = await auth();
  if (!isAuthenticated || !userId) redirect("/sign-in");
  if (!isAuthorizedAdmin(userId)) notFound();
  return { userId };
}
