import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/ui/primitives";
import { SimulationLab } from "@/components/simulation/simulation-lab";
import { PublicationPipelineLab } from "@/components/simulation/publication-pipeline-lab";
import { scenarios } from "@/lib/simulation/scenarios";
import { pipelineScenarioSummaries } from "@/lib/publications/simulation/runner";
import { runPublicationSimulationAction } from "./actions";

export const metadata: Metadata = { title: "Simulation UX" };

export default async function SimulationSettingsPage() {
  await requireAdmin();
  // Seule la présence de la clé est transmise (booléen), jamais sa valeur.
  const realAIAvailable = Boolean(process.env.OPENAI_API_KEY);
  return (
    <>
      <Link href="/settings" className="mb-6 inline-block text-xs text-accent hover:underline">← Paramètres</Link>
      <PageHeading eyebrow="Paramètres" title="Simulation UX" description="Parcourez CODE-V OS avec des données fictives pour valider l’expérience avant le développement des backends." />
      <SimulationLab scenarios={scenarios.map(({ id, name, description, focus }) => ({ id, name, description, focus }))} />
      <section aria-labelledby="pipeline-title" className="mt-12 border-t border-border pt-8">
        <h2 id="pipeline-title" className="text-lg font-semibold">Simulation du pipeline Publications</h2>
        <p className="mb-6 mt-1 max-w-3xl text-sm text-muted">Photo → analyse IA → choix éditorial → déclinaisons → brouillon → approbation simulée → créneau → diffusion simulée, avec les vraies règles de l’application et des adaptateurs simulés.</p>
        <PublicationPipelineLab scenarios={pipelineScenarioSummaries()} run={runPublicationSimulationAction} realAIAvailable={realAIAvailable} />
      </section>
    </>
  );
}
