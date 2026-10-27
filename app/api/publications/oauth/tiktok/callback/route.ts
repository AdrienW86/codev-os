import type {NextRequest} from "next/server";
import {handleOAuthCallback} from "@/lib/publications/oauth/callback";

// TikTok OAuth callback (Login Kit web): state validated before any code exchange.
export async function GET(request:NextRequest){return handleOAuthCallback("tiktok",request);}
