import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/ui/primitives";
import { SimulationLab } from "@/components/simulation/simulation-lab";
import { scenarios } from "@/lib/simulation/scenarios";

export const metadata: Metadata = { title: "Simulation UX" };

export default async function SimulationSettingsPage() {
  await requireAdmin();
  return (
    <>
      <Link href="/settings" className="mb-6 inline-block text-xs text-accent hover:underline">← Paramètres</Link>
      <PageHeading eyebrow="Paramètres" title="Simulation UX" description="Parcourez CODE-V OS avec des données fictives pour valider l’expérience avant le développement des backends." />
      <SimulationLab scenarios={scenarios.map(({ id, name, description, focus }) => ({ id, name, description, focus }))} />
    </>
  );
}
