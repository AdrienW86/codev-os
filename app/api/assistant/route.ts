import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { checkSameOrigin, createRateLimiter, readJsonBody } from "@/lib/core/request-guard";
import { selectAIProvider } from "@/lib/ai/providers";
import { confirmProposal, proposeFromView, respond, type OrchestratorDeps } from "@/lib/assistant/orchestrator";
import { executeTool, prepareProposal } from "@/lib/assistant/executor";
import { writeAudit } from "@/lib/core/audit";
import { todayInParis } from "@/lib/dashboard/home";
import { parseContext } from "@/lib/assistant/views";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BODY = 16_384;
const limiter = createRateLimiter(30, 60_000);
const headers = { "Cache-Control": "no-store" };

const requestSchema = z.union([
  z.object({
    messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }).strict()).min(1).max(12),
    // Contexte de conversation (client, vue, filtres) : revalidé côté serveur, il ne confère aucun droit.
    context: z.unknown().optional(),
    via: z.enum(["text", "voice"]).optional(),
  }).strict(),
  z.object({ confirm: z.object({ tool: z.string().max(60), input: z.record(z.string(), z.unknown()) }).strict() }).strict(),
  // Proposition depuis un bouton de vue : validée et décrite, jamais exécutée.
  z.object({ propose: z.object({ tool: z.string().max(60), input: z.record(z.string(), z.unknown()) }).strict() }).strict(),
]);

export async function POST(request: Request) {
  const { userId } = await requireAdmin();
  const origin = checkSameOrigin(request.headers, request.url);
  if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status, headers });
  if (!limiter(userId)) return NextResponse.json({ error: "rate_limited", reply: "Trop de demandes rapprochées : patientez une minute." }, { status: 429, headers });
  const body = await readJsonBody(request, MAX_BODY);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  const parsed = requestSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400, headers });

  const actor = { kind: "assistant" as const, userId };
  const simulation = Boolean(await getActiveScenario());
  const context = "messages" in parsed.data ? parseContext(parsed.data.context) : {};
  const deps: OrchestratorDeps = {
    provider: simulation ? null : selectAIProvider(), today: todayInParis(), simulation, context,
    via: "messages" in parsed.data ? parsed.data.via ?? "text" : "text",
    // Le contexte suit les outils successifs d'un même tour (transmis par l'orchestrateur).
    execute: (name, input, current) => executeTool(actor, name, input, current ?? {}),
    prepare: (name, input) => prepareProposal(name, input),
  };
  try {
    if ("confirm" in parsed.data) {
      const reply = await confirmProposal(parsed.data.confirm.tool, parsed.data.confirm.input, deps);
      if (!simulation) await writeAudit(actor, { action: "assistant.confirmed", resource_type: "assistant_tool", resource_id: null, metadata: { tool: parsed.data.confirm.tool, input: parsed.data.confirm.input } });
      return NextResponse.json(reply, { headers });
    }
    if ("propose" in parsed.data) return NextResponse.json(await proposeFromView(parsed.data.propose.tool, parsed.data.propose.input, deps), { headers });
    return NextResponse.json(await respond(parsed.data.messages, deps), { headers });
  } catch {
    console.error("[assistant] Requête interrompue.");
    return NextResponse.json({ error: "assistant_failed", reply: "L’assistant n’a pas pu terminer la demande. Vérifiez l’état dans Travail avant de réessayer." }, { status: 500, headers });
  }
}
