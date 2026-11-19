import { boundedBytes } from "@/lib/whatsapp/payload";
import { readResendEvent, validResendSignature } from "@/lib/emailing/policy";
import { recordResendEvent } from "@/lib/emailing/service";
import { readInboundEmail } from "@/lib/acquisition/replies";
import { handleProspectingReply } from "@/lib/acquisition/reply-service";
export const runtime = "nodejs";

// Webhook Resend : rebonds, plaintes, statuts de remise et réponses reçues (prospection). La signature Svix est vérifiée sur le corps brut avant
// toute lecture ou écriture ; un rebond définitif ou une plainte ajoute l'adresse à la liste d'exclusion globale.
const respond = (text: string, status: number) => new Response(text, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return respond("Non configuré", 503);
  let body: Uint8Array;
  try { body = await boundedBytes(request, 256 * 1024); } catch { return respond("Corps refusé", 413); }
  const id = request.headers.get("svix-id");
  if (!validResendSignature(body, { id, timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") }, secret)) return respond("Signature refusée", 401);
  let payload: unknown = null, effect;
  try { payload = JSON.parse(Buffer.from(body).toString("utf8")); effect = readResendEvent(payload); } catch { effect = null; }
  if (!effect) return respond("Événement ignoré", 200); // format inconnu : on n'insiste pas, rien n'est modifié
  // Réception entrante : réponse à un e-mail de prospection (arrêt sur « STOP », fin de séquence sur réponse).
  // Traitée AVANT l'enregistrement de l'événement (idempotente) : en cas d'échec, Resend renvoie l'événement.
  const inbound = readInboundEmail(payload);
  if (inbound) {
    try { await handleProspectingReply(inbound); }
    catch { console.error("[email] Réponse de prospection non traitée."); return respond("Réessayez", 503); }
  }
  try { await recordResendEvent(id!, effect); }
  catch { console.error("[email] Événement Resend non enregistré."); return respond("Réessayez", 503); }
  return respond("OK", 200);
}
