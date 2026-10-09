import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { Action } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/layout";
import { EmptyState, InlineNotice } from "@/components/ui/states";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Tabs } from "@/components/ui/tabs";
import { PublicationSettingsPanel } from "@/components/publications/settings-panel";
import { SimAutomations, SimConnections } from "@/components/simulation/views/sim-settings";
import { getPublicationSettingsState } from "@/lib/publications/data";
import { listAgents } from "@/lib/agents/data";
import { agentCatalog, blueprintState, agentStateLabels, matchConfiguredAgents } from "@/lib/agents/catalog";
import { getActiveScenario } from "@/lib/simulation/server";
import { AutomationsPanel } from "@/components/automations/automations-panel";
import { SystemStatus, Observability } from "@/components/system/system-status";
import { listAutomations } from "@/lib/automations/service";
import { listClients } from "@/lib/clients/data";
import { getSystemHealth } from "@/lib/system/health";
import { isProviderConfigured } from "@/lib/system/providers";
import { safeRead } from "@/lib/core/safe-read";

export const metadata: Metadata = { title: "Paramètres" };

const tabs = [
  { id: "general", label: "Général" }, { id: "connections", label: "Connexions" }, { id: "agents", label: "Agents" },
  { id: "automations", label: "Automatisations" }, { id: "system", label: "Observabilité" }, { id: "simulation", label: "Simulation UX" }, { id: "security", label: "Sécurité" },
] as const;
type TabId = (typeof tabs)[number]["id"];

type RealConnection = { name: string; description: string; status: { label: string; tone: StatusTone }; action: ReactNode };

function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex flex-wrap justify-between gap-2 border-b border-border py-4 last:border-0"><dt className="text-muted">{label}</dt><dd>{value}</dd></div>;
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  await requireAdmin();
  const { tab: rawTab } = await searchParams;
  const tab: TabId = tabs.some((item) => item.id === rawTab) ? (rawTab as TabId) : "general";
  const scenario = await getActiveScenario();
  // Lectures limitées à l’onglet affiché.
  const real = !scenario;
  const [publicationSettings, agents, automations, clients, health] = await Promise.all([
    tab === "security" ? getPublicationSettingsState() : Promise.resolve(null),
    tab === "agents" ? listAgents() : Promise.resolve([]),
    real && tab === "automations" ? safeRead("automations", () => listAutomations(), []) : Promise.resolve({ data: [], unavailable: false }),
    real && tab === "automations" ? safeRead("clients", () => listClients(), []) : Promise.resolve({ data: [], unavailable: false }),
    real && (tab === "system" || tab === "connections") ? safeRead("health", () => getSystemHealth(), null) : Promise.resolve({ data: null, unavailable: false }),
  ]);

  return (
    <>
      <PageHeading eyebrow="Configuration" title="Paramètres" description="Espace de travail, connexions, agents, automatisations et sécurité." />
      <Tabs label="Sections des paramètres" current={tab} items={tabs.map((item) => ({ id: item.id, label: item.label, href: item.id === "general" ? "/settings" : `/settings?tab=${item.id}` }))} />

      {tab === "general" && (
        <Panel className="max-w-3xl p-6">
          <h2 className="font-semibold">Espace de travail</h2>
          <dl className="mt-2 text-sm">
            <Row label="Organisation" value="CODE-V" />
            <Row label="Application" value="CODE-V OS" />
            <Row label="Données" value="Supabase, côté serveur" />
            <Row label="Langue de l’interface" value="Français" />
            <Row label="Mode" value={scenario ? <StatusBadge label={`Simulation · ${scenario.name}`} tone="blue" /> : <StatusBadge label="Données réelles" tone="green" />} />
          </dl>
        </Panel>
      )}

      {tab === "connections" && (scenario ? <SimConnections /> : <><SystemStatus errors={health.data?.connectionErrors ?? []} /><div className="mt-8"><RealConnections /></div></>)}

      {tab === "agents" && <AgentsSettings agents={agents} />}

      {tab === "automations" && (scenario ? <SimAutomations /> : (
        <AutomationsPanel automations={automations.data} unavailable={automations.unavailable} clients={clients.data.map((client) => ({ id: client.id, name: client.name }))} schedulerConfigured={isProviderConfigured("scheduler")} />
      ))}

      {tab === "system" && (scenario
        ? <EmptyState icon="dashboard" title="Observabilité indisponible en simulation." description="Cette vue lit uniquement les données réelles (jobs, exécutions, erreurs). Quittez la simulation pour la consulter." />
        : <Observability health={health.data} unavailable={health.unavailable} />)}

      {tab === "simulation" && (
        <Panel className="max-w-3xl p-6">
          <h2 className="font-semibold">Simulation UX</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Parcourez CODE-V OS comme si tous les backends existaient, avec des données fictives gardées dans ce navigateur. Rien n’est écrit en base, aucun appel externe n’est effectué.</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {scenario ? <StatusBadge label={`Active · ${scenario.name}`} tone="blue" /> : <StatusBadge label="Inactive" />}
            <Action href="/settings/simulation" variant="primary">Ouvrir le Scenario Lab</Action>
          </div>
        </Panel>
      )}

      {tab === "security" && <SecuritySettings publicationSettings={publicationSettings} />}
    </>
  );
}

function RealConnections() {
  const connections: RealConnection[] = [
    { name: "Google Ads", description: "Lecture seule : identifiant de compte renseigné et testé depuis chaque fiche client.", status: { label: "Lecture seule", tone: "green" }, action: <Action href="/clients">Voir les clients</Action> },
    { name: "Meta & Google Business Profile", description: "Connexion des comptes de publication, projet par projet.", status: { label: "Par projet", tone: "neutral" }, action: <Action href="/projects">Choisir un projet</Action> },
  ];
  return (
    <>
    <SectionHeader title="Raccourcis de configuration" description="Connexions rattachées à un client ou à un projet." />
    <ul className="divide-y divide-border rounded-xl border border-border bg-surface px-5">
      {connections.map((connection) => (
        <li key={connection.name} className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0"><p className="font-medium">{connection.name}</p><p className="text-sm text-muted">{connection.description}</p></div>
          <div className="flex flex-wrap items-center gap-3"><StatusBadge {...connection.status} />{connection.action}</div>
        </li>
      ))}
    </ul>
    </>
  );
}

function AgentsSettings({ agents }: { agents: Awaited<ReturnType<typeof listAgents>> }) {
  const { byBlueprint, unmatched } = matchConfiguredAgents(agents);
  return (
    <>
      <SectionHeader title="Agents du registre" action={<Action href="/agents">Ouvrir le registre</Action>} />
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface px-5">
        {agentCatalog.map((blueprint) => {
          const configured = byBlueprint.get(blueprint.id) ?? [];
          const state = agentStateLabels[blueprintState(blueprint, configured)];
          return (
            <li key={blueprint.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="min-w-0"><p className="font-medium">{blueprint.name}</p><p className="text-sm text-muted">{configured.length ? configured.map((agent) => <Link key={agent.id} href={`/agents/${agent.id}`} className="mr-2 text-accent hover:underline">{agent.name}</Link>) : "Aucun agent configuré"}</p></div>
              <StatusBadge label={state.label} tone={state.tone} symbol={state.symbol} />
            </li>
          );
        })}
      </ul>
      {unmatched.length > 0 && <p className="mt-4 text-sm text-muted">{unmatched.length} autre{unmatched.length > 1 ? "s" : ""} agent{unmatched.length > 1 ? "s" : ""} configuré{unmatched.length > 1 ? "s" : ""} hors registre. <Link href="/agents" className="text-accent hover:underline">Voir</Link></p>}
      <div className="mt-6"><Action href="/agents/new" variant="primary">+ Nouvel agent</Action></div>
    </>
  );
}

function SecuritySettings({ publicationSettings }: { publicationSettings: Awaited<ReturnType<typeof getPublicationSettingsState>> }) {
  return (
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <Panel className="p-6">
        <h2 className="font-semibold">Accès</h2>
        <dl className="mt-2 text-sm">
          <Row label="Authentification" value="Clerk" />
          <Row label="Accès au cockpit" value="Administrateur autorisé uniquement" />
          <Row label="Actions externes" value="Désactivées" />
          <Row label="Google Ads" value="Lecture seule" />
        </dl>
        <div className="mt-4"><InlineNotice>Ces réglages sont en consultation : ils se modifient côté serveur, jamais depuis l’interface.</InlineNotice></div>
      </Panel>
      <PublicationSettingsPanel settings={publicationSettings} />
    </div>
  );
}
