import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import Link from "next/link";
import { AgentCard } from "@/components/agents/agent-card";
import { PageHeading } from "@/components/ui/primitives";
import { listAgents } from "@/lib/agents/data";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage() {
  await requireAdmin();
  const agents = await listAgents();
  return (
    <>
      <PageHeading eyebrow="Configuration" title="Agents" description="Configurez les agents disponibles dans votre espace CODE-V." action={<div className="flex flex-wrap items-center gap-4"><span className="text-xs text-muted">{agents.length} agents</span><Link href="/agents/new" className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-background">+ Nouvel agent</Link></div>} />
      {agents.length ? <div className="grid gap-5 md:grid-cols-2">{agents.map((agent) => <AgentCard key={agent.id} agent={agent} />)}</div> : <p className="border-t border-border py-8 text-sm text-muted">Aucun agent configuré. Créez le premier pour le rattacher ensuite à des clients.</p>}
      <p className="mt-6 text-xs leading-5 text-muted">
        Les configurations sont enregistrées dans Supabase. Aucune exécution ou connexion externe n’est active.
      </p>
    </>
  );
}
