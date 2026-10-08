import type {NextRequest} from "next/server";
import {handleOAuthCallback} from "@/lib/publications/oauth/callback";

// Meta OAuth callback (Lot 4.3 P11-a): state validated before any code exchange; internal redirect only.
export async function GET(request:NextRequest){return handleOAuthCallback("meta",request);}
