import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import { Badge, PageHeading, Panel } from "@/components/ui/primitives";
import { getPublicationSettingsState } from "@/lib/publications/data";
import { PublicationSettingsPanel } from "@/components/publications/settings-panel";

export const metadata: Metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  await requireAdmin();
  const publicationSettings = await getPublicationSettingsState();
  return (
    <>
      <PageHeading eyebrow="Configuration" title="Paramètres" description="État des données internes et des intégrations. Google Ads est disponible en lecture seule après configuration." />
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel className="p-6">
          <h2 className="font-semibold">Espace de travail</h2>
          <dl className="mt-6 space-y-5 text-sm">
            {[
              ["Organisation", "CODE-V"],
              ["Application", "CODE-V OS"],
              ["Environnement", "Interne · données métier Supabase côté serveur"],
              ["Langue de l’interface", "Français"],
              ["Exécutions", "Simulations internes et analyses Google Ads en lecture seule"],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-wrap justify-between gap-2 border-b border-border pb-4 last:border-0 last:pb-0">
                <dt className="text-muted">{label}</dt><dd>{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel className="p-6">
          <h2 className="font-semibold">Services et intégrations</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Supabase stocke les données métier côté serveur. Configurez et testez Google Ads depuis la fiche de chaque client.</p>
          <ul className="mt-6 divide-y divide-border">
            {[{ name: "Supabase", status: "Actif · serveur" }, { name: "OpenAI", status: "Non connecté" }, { name: "Google Ads", status: "Lecture seule · par client" }].map(({ name, status }) => (
              <li key={name} className="flex items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                <span className="text-sm">{name}</span><Badge tone={name === "Supabase" ? "green" : "neutral"}>{status}</Badge>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <div className="mt-6"><PublicationSettingsPanel settings={publicationSettings} /></div>
    </>
  );
}
