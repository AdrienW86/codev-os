import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/require-admin";
import { manageClientAds } from "@/lib/ads/management";

export const runtime = "nodejs";
const id = z.string().regex(/^\d+$/);
const change = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("campaign_pause"), customerId: z.string().regex(/^\d{10}$/), campaignId: id }).strict(),
  z.object({ kind: z.literal("campaign_enable"), customerId: z.string().regex(/^\d{10}$/), campaignId: id }).strict(),
  z.object({ kind: z.literal("ad_pause"), customerId: z.string().regex(/^\d{10}$/), campaignId: id, adGroupId: id, adId: id }).strict(),
  z.object({ kind: z.literal("ad_enable"), customerId: z.string().regex(/^\d{10}$/), campaignId: id, adGroupId: id, adId: id }).strict(),
  z.object({ kind: z.literal("call_asset_pause"), customerId: z.string().regex(/^\d{10}$/), campaignId: id, assetId: id }).strict(),
  z.object({ kind: z.literal("call_asset_enable"), customerId: z.string().regex(/^\d{10}$/), campaignId: id, assetId: id }).strict(),
  z.object({ kind: z.literal("keyword_pause"), customerId: z.string().regex(/^\d{10}$/), campaignId: id, adGroupId: id, criterionId: id }).strict(),
  z.object({ kind: z.literal("keyword_enable"), customerId: z.string().regex(/^\d{10}$/), campaignId: id, adGroupId: id, criterionId: id }).strict(),
  z.object({ kind: z.literal("keyword_add"), customerId: z.string().regex(/^\d{10}$/), campaignId: id, adGroupId: id,
    keywords: z.array(z.object({ text: z.string().trim().min(1).max(80), matchType: z.enum(["EXACT", "PHRASE"]) }).strict()).min(1).max(25),
  }).strict(),
  z.object({ kind: z.literal("negative_keyword_add"), customerId: z.string().regex(/^\d{10}$/), campaignId: id,
    keywords: z.array(z.object({ text: z.string().trim().min(1).max(80), matchType: z.enum(["EXACT", "PHRASE"]) }).strict()).min(1).max(25),
  }).strict(),
]);
const input = z.object({
  clientId: z.uuid(), change, dryRun: z.boolean().optional(), confirm: z.string().max(80).optional(), approvalId: z.uuid().optional(),
}).strict();

export async function POST(request: Request) {
  const { userId } = await requireAdmin();
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) {
    return NextResponse.json({ error: "Origine non autorisée." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const parsed = input.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Données invalides." }, { status: 400 });
  try {
    const result = await manageClientAds({ kind: "admin", userId }, parsed.data);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Opération impossible.";
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
