import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { SectionHeader } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { MutationForm } from "@/components/ui/mutation-form";
import { ModuleUnavailable } from "@/components/ui/module-unavailable";
import { getActiveScenario } from "@/lib/simulation/server";
import { SimReports } from "@/components/simulation/views/sim-reports";
import { listReports } from "@/lib/reports/service";
import { listClients } from "@/lib/clients/data";
import { safeRead } from "@/lib/core/safe-read";
import { isReportKind, isReportStatus, reportKindLabels, reportStatusLabels } from "@/lib/reports/labels";
import { periodLabel } from "@/lib/reports/build";
import { formatDate } from "@/lib/format-date";
import { generateReportAction } from "./actions";

export const metadata: Metadata = { title: "Rapports" };

const selectClass = "mt-1.5 block min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground";
const uuid = /^[0-9a-f-]{36}$/i;

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  await requireAdmin();
  if (await getActiveScenario()) return <SimReports />;
  const params = await searchParams;
  const status = isReportStatus(params.status) ? params.status : undefined;
  const kind = isReportKind(params.kind) ? params.kind : undefined;
  const clientId = typeof params.client === "string" && uuid.test(params.client) ? params.client : undefined;
  const [reports, clients] = await Promise.all([
    safeRead("reports", () => listReports({ status, kind, clientId, includeArchived: status === "archived" }), []),
    safeRead("clients", () => listClients(), []),
  ]);
  const toReview = reports.data.filter((report) => report.status === "ready_for_review").length;

  return (
    <>
      <PageHeading eyebrow="Suivi" title="Rapports" description="Rapports hebdomadaires et mensuels préparés par l’Agent Rapport : relisez, ajustez, approuvez, puis envoyez la version client." />
      {reports.unavailable && <div className="mb-6"><ModuleUnavailable module="Rapports" /></div>}

      <Panel className="mb-8 p-5">
        <h2 className="font-semibold">Générer un rapport</h2>
        <p className="mt-1 text-sm text-muted">Période close précédente (semaine lundi→dimanche ou mois civil). Les rapports sont aussi générés automatiquement par les automatisations.</p>
        {clients.data.length ? (
          <MutationForm action={generateReportAction} label="Générer" pendingLabel="Génération…" variant="primary" className="mt-4 grid items-end gap-3 sm:flex sm:flex-wrap">
            <label className="min-w-0 text-xs text-muted sm:w-64">Client
              <select name="client_id" required defaultValue="" className={selectClass}>
                <option value="" disabled>Choisir…</option>
                {clients.data.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <label className="min-w-0 text-xs text-muted sm:w-44">Type
              <select name="kind" defaultValue="weekly" className={selectClass}>
                <option value="weekly">Hebdomadaire</option>
                <option value="monthly">Mensuel</option>
              </select>
            </label>
          </MutationForm>
        ) : <p className="mt-4 text-sm text-muted">Aucun client : <Link href="/clients/new" className="text-accent hover:underline">créez un client</Link> pour générer un rapport.</p>}
      </Panel>

      <SectionHeader title="Rapports" count={reports.data.length} description={toReview ? `${toReview} à relire` : undefined} />
      <FilterBar resetHref="/reports" fields={[
        { name: "status", label: "Statut", value: status ?? "", options: Object.entries(reportStatusLabels).map(([value, item]) => ({ value, label: item.label })) },
        { name: "kind", label: "Type", value: kind ?? "", options: Object.entries(reportKindLabels).map(([value, label]) => ({ value, label })) },
        { name: "client", label: "Client", value: clientId ?? "", options: clients.data.map((client) => ({ value: client.id, label: client.name })) },
      ]} />
      {reports.data.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {reports.data.map((report) => {
            const state = reportStatusLabels[report.status];
            return (
              <li key={report.id}>
                <Link href={`/reports/${report.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-white/[0.02]">
                  <div className="min-w-0">
                    <p className="font-medium">{report.client?.name ?? "Tous les clients"} · {reportKindLabels[report.kind]}</p>
                    <p className="text-sm text-muted">{periodLabel(report.kind, { start: report.period_start, end: report.period_end })} · v{report.version} · généré le {formatDate(report.generated_at)}</p>
                  </div>
                  <StatusBadge label={state.label} tone={state.tone} />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : !reports.unavailable && (
        <EmptyState icon="reports" title={status || kind || clientId ? "Aucun rapport pour ces filtres." : "Aucun rapport pour l’instant."}
          description="Générez un premier rapport ci-dessus, ou créez une automatisation « Rapports hebdomadaires » dans Paramètres → Automatisations." />
      )}
    </>
  );
}
