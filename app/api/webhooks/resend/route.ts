import { boundedBytes } from "@/lib/whatsapp/payload";
import { readResendEvent, validResendSignature } from "@/lib/emailing/policy";
import { recordResendEvent } from "@/lib/emailing/service";
export const runtime = "nodejs";

// Webhook Resend : rebonds, plaintes et statuts de remise. La signature Svix est vérifiée sur le corps brut avant
// toute lecture ou écriture ; un rebond définitif ou une plainte ajoute l'adresse à la liste d'exclusion globale.
const respond = (text: string, status: number) => new Response(text, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return respond("Non configuré", 503);
  let body: Uint8Array;
  try { body = await boundedBytes(request, 256 * 1024); } catch { return respond("Corps refusé", 413); }
  const id = request.headers.get("svix-id");
  if (!validResendSignature(body, { id, timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") }, secret)) return respond("Signature refusée", 401);
  let effect;
  try { effect = readResendEvent(JSON.parse(Buffer.from(body).toString("utf8"))); } catch { effect = null; }
  if (!effect) return respond("Événement ignoré", 200); // format inconnu : on n'insiste pas, rien n'est modifié
  try { await recordResendEvent(id!, effect); }
  catch { console.error("[email] Événement Resend non enregistré."); return respond("Réessayez", 503); }
  return respond("OK", 200);
}
