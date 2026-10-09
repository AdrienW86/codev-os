import type { Metadata } from "next";
import Link from "next/link";
import { AgentForm } from "@/components/agents/agent-form";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/require-admin";

export const metadata: Metadata = { title: "Nouvel agent" };

export default async function NewAgentPage() {
  await requireAdmin();
  return <><Link href="/agents" className="mb-6 inline-block text-xs text-accent hover:underline">← Tous les agents</Link><PageHeading eyebrow="Configuration" title="Nouvel agent" description="Enregistrez la configuration d’un agent. Aucune exécution externe n’est connectée." /><Panel className="max-w-4xl p-6"><AgentForm /></Panel></>;
}