// E2E UNIQUEMENT — substitué à @clerk/nextjs/server dans une COPIE temporaire de l'application
// (turbopack.resolveAlias, voir scripts/e2e.mjs). Jamais importé par le code de production.
import { NextResponse, type NextRequest } from "next/server";

const USER_ID = process.env.E2E_USER_ID ?? "user_e2e_admin";
const session = async () => ({ userId: USER_ID, isAuthenticated: true });

export const auth = session;
export async function currentUser() { return { id: USER_ID, firstName: "Adrien" }; }
export function clerkMiddleware(handler: (auth: typeof session, request: NextRequest) => Promise<Response | void> | Response | void) {
  return async (request: NextRequest) => (await handler(session, request)) ?? NextResponse.next();
}
