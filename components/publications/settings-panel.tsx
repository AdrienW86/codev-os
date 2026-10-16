import { Badge, Panel } from "@/components/ui/primitives";
import type { PublicationSettings } from "@/lib/publications/types";

export function PublicationSettingsPanel({ settings }: { settings: PublicationSettings | null }) {
  return <Panel className="p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">Publications — sécurité</h2><Badge>{settings?.emergency_stop===false?"Vérifications avant diffusion":"Diffusion à l’arrêt"}</Badge>
    </div>
    {!settings ? <p role="alert" className="mt-4 text-sm text-warning">Réglages indisponibles. Vérifiez les migrations Publications. Aucune activation n’est possible depuis cette page.</p> : <dl className="mt-5 space-y-4 text-sm">
      {[
        ["État global", settings.emergency_stop ? "À l’arrêt" : "Arrêt général levé"],
        ["Génération", settings.generation_enabled ? "Autorisée dans les réglages" : "Désactivée"],
        ["Automatisation", settings.automation_enabled ? "Autorisée dans les réglages" : "Désactivée"],
        ["Publication", settings.publishing_enabled ? "Autorisée dans les réglages" : "Désactivée"],
        ["Arrêt général", settings.emergency_stop ? "Actif" : "Inactif"],
      ].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-2 border-b border-border pb-3 last:border-0"><dt className="text-muted">{label}</dt><dd>{value}</dd></div>)}
    </dl>}
    <p className="mt-5 text-sm leading-6 text-muted">La rédaction manuelle, les images privées, la validation et le calendrier sont utilisables sans connexion fournisseur. Les réglages ci-dessus autorisent des fonctions mais ne prouvent pas que les API sont connectées. Une diffusion exige une version approuvée, un créneau, un compte connecté et tous les contrôles de sécurité.</p>
  </Panel>;
}
