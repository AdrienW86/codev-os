import "server-only";
// Outil de l'assistant : consulter le point de situation d'un agent ou de toute l'équipe (lecture seule).
import { requireAdmin } from "@/lib/require-admin";
import { getActiveScenario } from "@/lib/simulation/server";
import { resolveClient } from "@/lib/assistant/clients";
import { loadAgentBriefings } from "@/lib/harness/briefing-service";
import { briefingAlerts, briefingStateLabels, briefingsSummary } from "@/lib/harness/briefing";
import type { HarnessAgentId } from "@/lib/harness/charter";
import type { ToolOutcome } from "@/lib/assistant/orchestrator";

const day = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value)) : "";

export async function agentBriefingTool(input: Record<string, unknown>): Promise<ToolOutcome> {
  await requireAdmin();
  if (await getActiveScenario()) return { ok: false, text: "Simulation active : aucun point de situation des agents réels n’est lu." };
  let clientId: string | null = null;
  let clientName: string | null = null;
  if (typeof input.client === "string") {
    const client = await resolveClient(input.client);
    if (!client.ok) return { ok: false, text: client.message, links: [{ label: "Clients", href: "/clients" }] };
    clientId = client.id; clientName = client.name;
  }
  const agent = typeof input.agent === "string" ? input.agent as HarnessAgentId : null;
  const briefings = await loadAgentBriefings({ clientId, agents: agent ? [agent] : undefined });
  const ordered = agent ? briefings : [...briefingAlerts(briefings), ...briefings.filter((item) => !briefingAlerts(briefings).includes(item))];
  const text = agent && briefings[0]
    ? `${briefings[0].name}${clientName ? ` pour ${clientName}` : ""} : ${briefingStateLabels[briefings[0].state].toLowerCase()}. ${briefings[0].facts[0]?.statement ?? briefings[0].gaps[0] ?? "Aucun constat enregistré."}`
    : `${clientName ? `${clientName} : ` : ""}${briefingsSummary(briefings)}`;
  return {
    ok: true, text,
    view: {
      type: "table", title: `Point de situation des agents${clientName ? ` · ${clientName}` : ""}`,
      caption: "Constats datés issus des données enregistrées. Aucun agent relancé, aucune API externe appelée.",
      columns: ["Agent", "État", "Constats", "Manques"],
      rows: ordered.map((item) => ({ cells: [
        item.name,
        `${briefingStateLabels[item.state]}${item.stale && item.state === "ok" ? " · sans activité récente" : ""}`,
        item.facts.map((fact) => `${fact.statement}${fact.at ? ` (${day(fact.at)})` : ""}`).join(" ") || "Aucun constat.",
        item.gaps.join(" ") || "—",
      ] })),
      empty: "Aucun agent consulté.",
    },
    links: [{ label: "Équipe des agents", href: "/agents" }],
    context: clientId && clientName ? { clientId, clientName } : {},
  };
}
