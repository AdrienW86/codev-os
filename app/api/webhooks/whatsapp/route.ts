import { after } from "next/server";
import { boundedBytes, incomingImages, validSignature } from "@/lib/whatsapp/payload";
import { enqueueImages, ingestionEnabled, processImageBatch } from "@/lib/whatsapp/service";
export const runtime = "nodejs";
export const maxDuration = 120;
const respond = (text: string, status: number) => new Response(text, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  const challenge = query.get("hub.challenge");
  if (!expected) return respond("Non configuré", 503);
  if (query.get("hub.mode") !== "subscribe" || query.get("hub.verify_token") !== expected || !challenge || !/^\d{1,100}$/.test(challenge)) return respond("Refusé", 403);
  return respond(challenge, 200);
}
export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const phone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!secret || !phone || !waba || !ingestionEnabled()) return respond("Non activé", 503);
  let body: Uint8Array;
  try { body = await boundedBytes(request, 1024 * 1024); } catch { return respond("Corps refusé", 413); }
  if (!validSignature(body, request.headers.get("x-hub-signature-256"), secret)) return respond("Signature refusée", 401);
  let images;
  try { images = incomingImages(JSON.parse(Buffer.from(body).toString("utf8")), waba, phone); }
  catch { return respond("Notification invalide", 400); }
  try { await enqueueImages(images); }
  catch { console.error("[whatsapp] Réception indisponible."); return respond("Réessayez", 503); }
  if (images.length) after(async () => {
    try { await processImageBatch({ kind: "system", worker: "whatsapp-webhook" }); }
    catch { console.error("[whatsapp] Traitement différé indisponible."); }
  });
  return respond("OK", 200);
}
