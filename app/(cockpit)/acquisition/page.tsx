import type { Metadata } from "next";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/require-admin";
import { getAcquisitionSnapshot } from "@/lib/acquisition/data";
import { getAcquisitionConnectorReadiness } from "@/lib/acquisition/connectors";
import { ACQUISITION_CATEGORIES, ACQUISITION_STAGES } from "@/lib/acquisition/model";
import { AcquisitionWorkspaceTabs } from "@/components/acquisition/workspace-tabs";
import { AcquisitionCreateForms } from "@/components/acquisition/create-forms";
import { PrescriberDiscovery } from "@/components/acquisition/prescriber-discovery";
import { placesConfigured } from "@/lib/acquisition/discovery";
import { listClients } from "@/lib/clients/data";

const NOTICES: Record<string, string> = {
  workspace_created: "Espace créé, envois verrouillés.",
  discovery_done: "Recherche terminée : {found} prescripteur(s) trouvé(s), {inserted} nouvelle(s) fiche(s).",
  zone_queued: "Balayage de la zone mis en file : il avance environ toutes les 15 minutes, suivez-le dans « Dernières recherches ».",
  run_cancelled: "Recherche arrêtée. Les fiches déjà trouvées sont conservées.",
  discovery_busy: "Une recherche est déjà en cours pour ce client : attendez sa fin ou arrêtez-la.",
  enrich_done: "Google Places : {found} fiche(s) complétée(s) sur {inserted} vérifiée(s).",
  already_exists: "Cet espace existe déjà.",
  handoff_done: "{found} brouillon(s) d'e-mail préparé(s) dans l'onglet E-mails, à relire et approuver ({inserted} adresse(s) écartée(s) : exclusion, doublon ou déjà contactée).",
  invalid_handoff: "Paramètres de transmission invalides.",
  handoff_nothing_to_send: "Aucune fiche à transmettre : il faut une adresse e-mail générique, une fiche non encore contactée et hors liste d'exclusion.",
  handoff_template_missing: "Modèle introuvable pour cet espace.",
  handoff_workspace_missing: "Espace introuvable.",
  handoff_schema_missing: "Migration Agent Prospection multi-sources non appliquée.",
  handoff_storage: "Enregistrement des brouillons impossible.",
  invalid_discovery: "Paramètres de recherche invalides.",
  discovery_no_place: "Aucune commune : renseignez la zone du client ou une commune.",
  discovery_location_not_found: "Commune introuvable : indiquez une commune précise (ex. Strasbourg). Un pays ou une région ne suffit pas.",
  discovery_source_unavailable: "API Recherche d'entreprises momentanément indisponible. Réessayez plus tard.",
  discovery_schema_missing: "Migration Agent Prospection non appliquée.",
  discovery_workspace_missing: "Espace introuvable.",
  discovery_storage: "Enregistrement impossible. Aucune donnée partielle n'a été conservée.",
  enrich_places_not_configured: "GOOGLE_PLACES_API_KEY n'est pas configurée.",
  enrich_schema_missing: "Migration Agent Prospection non appliquée.",
  enrich_source_unavailable: "Google Places indisponible ou clé refusée.",
};
const count = (v: string | string[] | undefined) => (typeof v === "string" && /^\d{1,5}$/.test(v) ? v : "0");

export const metadata: Metadata = { title: "Acquisition" };
// La recherche de prescripteurs enchaîne ~20 appels Sirene (≈ 20 s) : marge au-delà du défaut.
export const maxDuration = 60;

export default async function AcquisitionPage({ searchParams }: PageProps<"/acquisition">) {
  await requireAdmin();
  const [snapshot, connectors, clients, params] = await Promise.all([
    getAcquisitionSnapshot(), Promise.resolve(getAcquisitionConnectorReadiness()),
    listClients().catch(() => []), searchParams,
  ]);
  const focusClientId = typeof params.client === "string" && /^[0-9a-f-]{36}$/i.test(params.client) ? params.client : undefined;
  const noticeKey = typeof params.notice === "string" ? params.notice : "";
  const notice = NOTICES[noticeKey]?.replace("{found}", count(params.found)).replace("{inserted}", count(params.inserted));
  const qualified = snapshot.prospects.filter((p) => ["qualified","draft_ready","approved"].includes(p.stage)).length;
  return <div className="space-y-7" data-acquisition="cockpit">
    <PageHeading eyebrow="Développement commercial" title="Acquisition" description="Prospection multientreprise, preuves de qualification et campagnes personnalisées. Aucun envoi automatique n'est activé." />
    <div className="grid gap-3 sm:grid-cols-3">
      {[
        {name:"Prospects découverts",value:snapshot.prospects.length},
        {name:"À qualifier ou contacter",value:qualified},
        {name:"Brouillons d'e-mails",value:snapshot.messages.filter(m=>m.state==="draft").length},
      ].map((k)=><div key={k.name} className="rounded-xl border border-border bg-surface p-5"><p className="text-sm text-muted">{k.name}</p><p className="mt-2 text-3xl font-semibold">{k.value}</p></div>)}
    </div>
    <div role="status" className="rounded-xl border border-border-strong bg-surface-raised p-4 text-sm">
      <strong>Envois verrouillés par défaut.</strong> La prospection réelle et la découverte automatique restent désactivées jusqu&apos;à la validation du fournisseur, des données et des mécanismes de sécurité.
      {!snapshot.schemaReady && <p className="mt-2 text-muted">Base Acquisition : {snapshot.unavailableReason ?? "migration non encore appliquée"} Aucune opération n&apos;a été lancée.</p>}
    </div>
    {notice && <p role="status" className="rounded-xl border border-border bg-surface p-4 text-sm">{notice}</p>}
    {snapshot.schemaReady && <PrescriberDiscovery workspaces={snapshot.workspaces} clients={clients} runs={snapshot.discoveryRuns} prescribersReady={snapshot.prescribersReady} placesReady={placesConfigured()} focusClientId={focusClientId} multisourceReady={snapshot.multisourceReady} />}
    {snapshot.schemaReady && <AcquisitionCreateForms workspaces={snapshot.workspaces} />}
    <AcquisitionWorkspaceTabs placesReady={placesConfigured()} prescribersReady={snapshot.prescribersReady} workspaces={snapshot.workspaces} prospects={snapshot.prospects} messages={snapshot.messages} senders={snapshot.senders} templates={snapshot.templates}/>
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel>
        <div className="p-5"><h2 className="text-lg font-semibold">Connecteurs — branchements à réaliser</h2>
          <p className="mt-1 text-sm text-muted">La présence d&apos;une variable ne prouve pas qu&apos;une connexion fonctionne. Aucun test réseau ni e-mail envoyé.</p>
          <div className="mt-4 space-y-3">{connectors.map(c=><div key={c.id} className="rounded-lg border border-border p-3">
            <div className="flex justify-between gap-2"><h3 className="font-medium">{c.label}</h3><span className="text-xs text-muted">{c.configured?"Configuration détectée":"À brancher"}</span></div>
            <p className="mt-1 text-xs text-muted">{c.purpose} — {c.detail}</p>
          </div>)}</div>
        </div>
      </Panel>
      <Panel>
        <div className="p-5"><h2 className="text-lg font-semibold">Stratégies de ciblage</h2><p className="mt-1 text-sm text-muted">Chaque message doit s&apos;appuyer sur une preuve vérifiée et une relation avec l&apos;activité professionnelle.</p>
          <div className="mt-4 space-y-3">{ACQUISITION_CATEGORIES.map(c=><div key={c.id} className="border-b border-border pb-3 last:border-0">
            <h3 className="text-sm font-medium">{c.label}</h3><p className="text-xs text-muted">{c.description}</p>
            <span className="text-xs text-muted">{snapshot.prospects.filter(p=>p.category===c.id).length} prospect(s)</span>
          </div>)}</div>
        </div>
      </Panel>
    </div>
    <p className="text-xs text-muted">Statuts disponibles : {Object.values(ACQUISITION_STAGES).join(" · ")}. Gestion des oppositions obligatoire avant tout envoi.</p>
  </div>;
}
