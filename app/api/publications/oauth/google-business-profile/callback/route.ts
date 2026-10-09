import type {NextRequest} from "next/server";
import {handleOAuthCallback} from "@/lib/publications/oauth/callback";

// Google Business Profile OAuth callback (Lot 4.3 P11-a): state (and PKCE) validated before any code exchange.
export async function GET(request:NextRequest){return handleOAuthCallback("google_business_profile",request);}
