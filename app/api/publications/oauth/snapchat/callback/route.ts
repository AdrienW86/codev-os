import type {NextRequest} from "next/server";
import {handleOAuthCallback} from "@/lib/publications/oauth/callback";

// Snapchat OAuth callback (Snap OAuth 2.0, Public Profile API): state validated before any code exchange.
export async function GET(request:NextRequest){return handleOAuthCallback("snapchat",request);}
