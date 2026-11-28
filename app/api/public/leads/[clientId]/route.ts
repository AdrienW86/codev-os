import { after } from "next/server";
import { boundedBytes } from "@/lib/whatsapp/payload";
import { ipFingerprint } from "@/lib/leads/model";
import { intakeFormLead, leadsIpSecret, processLead } from "@/lib/leads/service";

// Formulaire de demande de devis des sites clients (Agent Leads). Public, sans session : la clé du formulaire identifie
// le client, l'origine du navigateur doit être déclarée, un champ piège et une limite de débit écartent les robots.
// La demande est qualifiée et la réponse préparée tout de suite après la réponse HTTP (le planificateur reprend un échec).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const base: Record<string, string> = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const cors = (origin: string | null): Record<string, string> => (origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" } : { Vary: "Origin" });
const MESSAGES: Record<string, string> = {
  not_found: "Formulaire inconnu ou désactivé.", origin_not_allowed: "Site non autorisé pour ce formulaire.", too_many_requests: "Trop de demandes, réessayez plus tard.",
  unavailable: "Service momentanément indisponible.", not_installed: "Service momentanément indisponible.", invalid: "Demande illisible.",
};

async function readBody(request: Request): Promise<unknown> {
  const bytes = await boundedBytes(request, 32 * 1024);
  const text = Buffer.from(bytes).toString("utf8");
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("application/json")) return JSON.parse(text);
  if (type.includes("multipart/form-data")) {
    const form = await new Response(Buffer.from(bytes), { headers: { "content-type": type } }).formData();
    return Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
  }
  return Object.fromEntries(new URLSearchParams(text));
}

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const origin = request.headers.get("origin");
  let body: unknown;
  try { body = await readBody(request); } catch { return Response.json({ ok: false, error: MESSAGES.invalid }, { status: 400, headers: base }); }
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for");
  const result = await intakeFormLead({ clientId, key: new URL(request.url).searchParams.get("key"), origin, ipHash: ipFingerprint(ip, leadsIpSecret()), body })
    .catch(() => ({ ok: false as const, status: 503, error: "unavailable", allowedOrigin: null }));
  const headers = { ...base, ...cors(result.allowedOrigin) };
  if (!result.ok) return Response.json({ ok: false, error: MESSAGES[result.error] ?? result.error }, { status: result.status, headers });
  if (result.leadId && !result.duplicate) after(async () => {
    try { await processLead(result.leadId); } catch { console.error("[leads] Traitement immédiat différé au prochain passage."); }
  });
  return Response.json({ ok: true }, { status: 201, headers });
}

/** Pré-vol CORS : n'expose rien ; l'origine est vérifiée lors du dépôt lui-même. */
export function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  return new Response(null, { status: 204, headers: { ...base, ...(origin && /^https:\/\//.test(origin) ? cors(origin) : {}), "Access-Control-Max-Age": "600" } });
}
