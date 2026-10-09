import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs } from "@/components/ui/tabs";
import { InlineNotice } from "@/components/ui/states";
import { MutationForm } from "@/components/ui/mutation-form";
import { ModuleUnavailable } from "@/components/ui/module-unavailable";
import { getActiveScenario } from "@/lib/simulation/server";
import { SimReports } from "@/components/simulation/views/sim-reports";
import { getReport, listReportVersions } from "@/lib/reports/service";
import { reportKindLabels, reportStatusLabels } from "@/lib/reports/labels";
import { periodLabel, type ReportContent } from "@/lib/reports/build";
import { emailSendingStatus } from "@/lib/providers/email";
import { safeRead } from "@/lib/core/safe-read";
import { formatDate } from "@/lib/format-date";
import { approveReportAction, archiveReportAction, editReportSummaryAction, sendReportAction } from "../actions";

export const metadata: Metadata = { title: "Rapport" };

function asContent(value: unknown): ReportContent {
  const content = (value ?? {}) as Partial<ReportContent>;
  return { summary: typeof content.summary === "string" ? content.summary : "", highlights: Array.isArray(content.highlights) ? content.highlights : [], sections: Array.isArray(content.sections) ? content.sections : [], empty: Boolean(content.empty) };
}

function ContentView({ content }: { content: ReportContent }) {
  return (
    <div className="space-y-6">
      <p className="text-base leading-7">{content.summary}</p>
      {content.sections.map((section) => (
        <section key={section.title}>
          <h3 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">{section.title}</h3>
          <ul className="space-y-1 text-sm leading-6">{section.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
        </section>
      ))}
      {!content.sections.length && <p className="text-sm text-muted">Aucun détail pour cette période.</p>}
    </div>
  );
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  if (await getActiveScenario()) return <SimReports />;
  const { id } = await params;
  const { view } = await searchParams;
  const report = await safeRead("reports", () => getReport(id), null);
  if (report.unavailable) return <><PageHeading eyebrow="Rapports" title="Rapport" description="" /><ModuleUnavailable module="Rapports" /></>;
  if (!report.data) notFound();
  const item = report.data;
  const versions = await safeRead("reports", () => listReportVersions(id), []);
  const tab = view === "internal" ? "internal" : "client";
  const state = reportStatusLabels[item.status];
  const email = emailSendingStatus();
  const editable = !["sent", "archived"].includes(item.status);

  return (
    <>
      <p className="mb-4 text-sm"><Link href="/reports" className="text-muted hover:text-foreground">← Rapports</Link></p>
      <PageHeading eyebrow={`Rapport ${reportKindLabels[item.kind].toLowerCase()}`} title={item.client?.name ?? "Tous les clients"}
        description={`${periodLabel(item.kind, { start: item.period_start, end: item.period_end })} · version ${item.version}`}
        action={<StatusBadge label={state.label} tone={state.tone} />} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel className="p-6">
          <Tabs label="Versions du rapport" current={tab} items={[{ id: "client", label: "Version client", href: `/reports/${id}` }, { id: "internal", label: "Version interne", href: `/reports/${id}?view=internal` }]} />
          {tab === "internal" && <InlineNotice title="Usage interne uniquement.">Inclut retards, échecs d’analyse et éléments techniques : jamais envoyé au client.</InlineNotice>}
          <div className="mt-6"><ContentView content={asContent(tab === "internal" ? item.internal_content : item.client_content)} /></div>
        </Panel>

        <div className="space-y-5">
          <Panel className="space-y-4 p-5">
            <h2 className="font-semibold">Étapes</h2>
            {item.status === "ready_for_review" && <MutationForm action={approveReportAction} fields={{ id }} label={`Approuver la version ${item.version}`} variant="primary" disableOnSuccess flashOnSuccess />}
            {item.status === "approved" && (
              <>
                <p className="text-sm text-muted">Approuvé le {formatDate(item.approved_at)} (version {item.approved_version}).</p>
                {email.enabled
                  ? <MutationForm action={sendReportAction} fields={{ id, mode: "email" }} label="Envoyer par e-mail" variant="primary" confirm="Envoyer la version client approuvée par e-mail ?" disableOnSuccess flashOnSuccess />
                  : <InlineNotice title="Envoi e-mail désactivé.">{email.reason}</InlineNotice>}
                <MutationForm action={sendReportAction} fields={{ id, mode: "manual" }} label="Marquer comme envoyé manuellement" confirm="Confirmer que la version approuvée a été envoyée en dehors de CODE-V OS ?" disableOnSuccess flashOnSuccess />
              </>
            )}
            {item.status === "sent" && <p className="text-sm text-muted">Envoyé le {formatDate(item.sent_at)}. Le contenu est figé.</p>}
            {item.status === "archived" && <p className="text-sm text-muted">Archivé le {formatDate(item.archived_at)}. Consultable, non modifiable.</p>}
            {item.status !== "archived" && <MutationForm action={archiveReportAction} fields={{ id }} label="Archiver" variant="ghost" confirm="Archiver ce rapport ? Il reste consultable." disableOnSuccess />}
          </Panel>

          {editable && (
            <Panel className="p-5">
              <h2 className="font-semibold">Modifier la synthèse client</h2>
              <p className="mt-1 text-sm text-muted">Crée une nouvelle version et invalide toute approbation.</p>
              <MutationForm action={editReportSummaryAction} fields={{ id }} label="Enregistrer" className="mt-3 space-y-3">
                <label className="block text-xs text-muted">Synthèse
                  <textarea name="summary" required maxLength={4000} rows={6} defaultValue={asContent(item.client_content).summary} className="mt-1.5 block w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground" />
                </label>
              </MutationForm>
            </Panel>
          )}

          <Panel className="p-5">
            <h2 className="font-semibold">Historique des versions</h2>
            {versions.data.length ? (
              <ol className="mt-3 space-y-3 text-sm">
                {versions.data.map((version) => (
                  <li key={version.version} className="border-l border-border pl-3">
                    <p className="font-medium">v{version.version} · {formatDate(version.created_at)}</p>
                    <p className="line-clamp-2 text-muted">{version.summary}</p>
                  </li>
                ))}
              </ol>
            ) : <p className="mt-2 text-sm text-muted">Aucune version enregistrée.</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}
