import { getSupabaseServerClient } from "@/lib/supabase/server";
import { recurringConfigSchema } from "@/lib/reports/recurring/domain";
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
import { getReport, getReportDelivery, listReportVersions } from "@/lib/reports/service";
import { reportEmailPreview } from "@/lib/reports/email-preview";
import { clientDocuments, reportDocumentLabels } from "@/lib/reports/documents/model";
import { reportKindLabels, reportStatusLabels } from "@/lib/reports/labels";
import { periodLabel, type ReportContent } from "@/lib/reports/build";
import { emailSendingStatus } from "@/lib/providers/email";
import { EMAIL_LOGO_BASE64, EMAIL_LOGO_CID } from "@/lib/reports/email-logo";
import { safeRead } from "@/lib/core/safe-read";
import { formatDate } from "@/lib/format-date";
import { getReportScope } from "@/lib/reports/google-ads-service";
import { describeDates } from "@/lib/integrations/google-ads/periods";
import { typeLabel } from "@/lib/integrations/google-ads/dashboard";
import { approveReportAction, archiveReportAction, editReportSummaryAction, regenerateGoogleAdsReportAction, sendReportAction } from "../actions";

export const metadata: Metadata = { title: "Rapport" };

function asContent(value: unknown): ReportContent {
  const content = (value ?? {}) as Partial<ReportContent>;
  return { summary: typeof content.summary === "string" ? content.summary : "", highlights: Array.isArray(content.highlights) ? content.highlights : [], sections: Array.isArray(content.sections) ? content.sections : [], empty: Boolean(content.empty) };
}

function ContentView({ content }: { content: ReportContent }) {
  return (
    <div className="min-w-0 space-y-6 break-words [overflow-wrap:anywhere]">
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
  const delivery = await getReportDelivery(id, item.version);
  const sending = ["sending", "uncertain"].includes(delivery?.state ?? "");
  const editable = !["sent", "archived"].includes(item.status) && !sending;
  const preview = await safeRead("reports", async () => reportEmailPreview(item), null);
  let documents: ReturnType<typeof clientDocuments> = [];
  try { documents = clientDocuments(item.client_content); } catch { documents = []; }
  const occurrence = await getSupabaseServerClient().from("ads_report_occurrences").select("config,due_at,transport").eq("report_id", id).maybeSingle();
  const recurring = occurrence.error ? null : occurrence.data;
  const recipient = recurring ? recurringConfigSchema.parse(recurring.config).recipient : item.client?.email ?? "";
  const scope = item.kind === "google_ads" ? await getReportScope(id) : null;

  return (
    <>
      <p className="mb-4 text-sm"><Link href="/reports" className="text-muted hover:text-foreground">← Rapports</Link></p>
      <PageHeading eyebrow={`Rapport ${reportKindLabels[item.kind].toLowerCase()}`} title={item.client?.name ?? "Tous les clients"}
        description={`Période couverte : ${periodLabel(item.kind, { start: item.period_start, end: item.period_end })} · version ${item.version} · généré le ${formatDate(item.generated_at)}`}
        action={<StatusBadge label={state.label} tone={state.tone} />} />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel className="p-6">
          <Tabs label="Versions du rapport" current={tab} items={[{ id: "client", label: "Version client", href: `/reports/${id}` }, { id: "internal", label: "Version interne", href: `/reports/${id}?view=internal` }]} />
          {tab === "internal" && <InlineNotice title="Usage interne uniquement.">Inclut retards, échecs d’analyse et éléments techniques : jamais envoyé au client.</InlineNotice>}
          <div className="mt-6"><ContentView content={asContent(tab === "internal" ? item.internal_content : item.client_content)} /></div>
          {tab !== "internal" && documents.length > 0 && <div className="mt-8 space-y-6">{documents.map((document) => <section key={document.key} className="rounded-lg border border-border p-4">
            <h3 className="font-semibold">{document.title}</h3><p className="mt-1 text-sm text-muted">{document.summary}</p>
            {document.kpis.length > 0 && <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{document.kpis.map((kpi) => <div key={kpi.label} className="rounded-lg bg-surface-raised p-3"><dt className="text-xs text-muted">{kpi.label}</dt><dd className="mt-1 text-lg font-semibold">{kpi.value}</dd>{kpi.change && <dd className={`text-xs ${kpi.trend === "flat" || kpi.good === undefined ? "text-muted" : kpi.good ? "text-success" : "text-danger"}`}>{kpi.change}</dd>}</div>)}</dl>}
            <p className="mt-3 text-xs text-muted">{document.charts.length} graphique(s), {document.tables.length} tableau(x) dans le PDF.</p>
          </section>)}</div>}
        </Panel>

        <div className="min-w-0 space-y-5">
          <Panel className="p-5">
            <h2 className="font-semibold">Rapport client en PDF</h2>
            <p className="mt-2 text-sm text-muted">Document A4 téléchargeable, avec uniquement la version client de ce rapport. La version interne ne figure jamais dans le PDF.</p>
            {item.status === "ready_for_review" || item.status === "draft"
              ? <p className="mt-2 text-sm text-muted">La version non approuvée comporte une mention Brouillon. Elle ne peut pas être envoyée depuis CODE-V OS.</p>
              : null}
            {documents.length
              ? <ul className="mt-3 space-y-2">{documents.map((document) => <li key={document.key}><a href={`/api/reports/${id}/pdf?doc=${document.key}`} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-accent hover:bg-surface-raised">{reportDocumentLabels[document.key]} · PDF v{item.version}</a></li>)}</ul>
              : <a href={`/api/reports/${id}/pdf`} className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-accent hover:bg-surface-raised">Télécharger le PDF · v{item.version}</a>}
            <p className="mt-2 text-xs text-muted">{documents.length ? `L’e-mail, ci-dessous, joindra ces ${documents.length} PDF (un par agent) après une approbation distincte.` : "L’envoi par e-mail, ci-dessous, joindra le même PDF après une approbation distincte."}</p>
          </Panel>
          {item.kind === "google_ads" && (
            <Panel className="p-5">
              <h2 className="font-semibold">Périmètre enregistré</h2>
              {scope ? (
                <>
                  <p className="mt-1 text-sm text-muted">Figé à la préparation : les filtres de l’onglet Campagnes ne le modifient pas.</p>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div><dt className="text-xs text-muted">Période</dt><dd>{describeDates(scope)} ({scope.days} j, fuseau {scope.timezone})</dd></div>
                    <div><dt className="text-xs text-muted">Compte Google Ads</dt><dd>{scope.accountId} · {scope.currency}</dd></div>
                    <div><dt className="text-xs text-muted">Filtres d’origine</dt><dd>{scope.status === "enabled" ? "Actives" : scope.status === "paused" ? "En pause" : "Tous statuts"}{scope.types.length ? ` · ${scope.types.map(typeLabel).join(", ")}` : ""}</dd></div>
                    <div><dt className="text-xs text-muted">Campagnes ({scope.campaignIds.length})</dt><dd><ul className="mt-1 space-y-1">{scope.campaignIds.map((campaignId) => <li key={campaignId}>{scope.campaignNames[campaignId] ?? "Sans nom"} <span className="text-xs text-muted">ID {campaignId}</span></li>)}</ul></dd></div>
                  </dl>
                  <p className="mt-3 text-xs text-muted">Le statut et les métriques de chaque campagne à la date de génération figurent dans la version interne.</p>
                </>
              ) : <p className="mt-2 text-sm text-muted">Périmètre indisponible.</p>}
              {editable && scope && <MutationForm action={regenerateGoogleAdsReportAction} fields={{ id }} label="Actualiser les données (nouvelle version)" className="mt-4" confirm="Relire Google Ads pour ce même périmètre et créer une nouvelle version ? L’approbation éventuelle sera invalidée." disableOnSuccess flashOnSuccess />}
            </Panel>
          )}

          <Panel className="space-y-4 p-5">
            <h2 id="send-report" className="font-semibold">Étapes</h2>
            {recurring && <p className="text-sm">Destinataire prévu : {recipient} · échéance {formatDate(recurring.due_at)}. Configuration figée à la préparation.</p>}
            {item.status === "ready_for_review" && <MutationForm key={`approve:${item.version}`} action={approveReportAction} fields={{ id, version: String(item.version) }} label={`Approuver la version ${item.version}`} variant="primary" disableOnSuccess flashOnSuccess />}
            {item.status === "approved" && (
              <>
                <p className="text-sm text-muted">Approuvé le {formatDate(item.approved_at)} (version {item.approved_version}).</p>
                {email.enabled && preview.data && !delivery
                  ? <MutationForm action={sendReportAction} fields={{ id, mode: "email", version: String(item.version), digest: preview.data.digest }} label={documents.length ? `Envoyer les ${documents.length} PDF par e-mail` : "Envoyer le PDF par e-mail"} variant="primary" confirm="Envoyer la version client approuvée en pièce jointe PDF au destinataire affiché et confirmé ?" disableOnSuccess flashOnSuccess className="space-y-3">
                      <label className="block text-sm">Destinataire unique<input type="email" name="recipient" required maxLength={320} defaultValue={recipient} readOnly={Boolean(recurring)} className="mt-1 w-full rounded-lg border border-border bg-background p-2" /></label>
                      <label className="flex gap-2 text-sm"><input type="checkbox" name="recipient_confirmed" value="yes" required />Je confirme cette adresse et la version client prévisualisée.</label>
                    </MutationForm>
                  : <InlineNotice title="Envoi e-mail indisponible.">{!email.enabled ? email.reason : "Cette version ne peut pas faire l’objet d’une nouvelle tentative."}</InlineNotice>}
                {delivery && <InlineNotice title="Tentative enregistrée.">État : {delivery.state}. Aucune répétition automatique. Si l’état est incertain ou reste en cours, vérifiez Resend avant une intervention.</InlineNotice>}
                {!sending && <MutationForm action={sendReportAction} fields={{ id, mode: "manual", version: String(item.version) }} label="Marquer comme envoyé manuellement" confirm="Confirmer que la version approuvée a été envoyée en dehors de CODE-V OS ?" disableOnSuccess flashOnSuccess />}
              </>
            )}
            {item.status === "sent" && <p className="text-sm text-muted">{delivery?.state === "accepted" ? "Accepté par Resend ; livraison non confirmée" : "Envoi consigné"} le {formatDate(item.sent_at)}. Le contenu est figé.</p>}
            {item.status === "archived" && <p className="text-sm text-muted">Archivé le {formatDate(item.archived_at)}. Consultable, non modifiable.</p>}
            {item.status !== "archived" && !sending && <MutationForm action={archiveReportAction} fields={{ id }} label="Archiver" variant="ghost" confirm="Archiver ce rapport ? Il reste consultable." disableOnSuccess />}
          </Panel>

          {preview.data && <Panel className="p-5"><h2 className="font-semibold">Prévisualisation de l’e-mail · v{item.version}</h2><p className="mt-2 text-sm">Objet : {preview.data.subject}</p><iframe title="Aperçu de l’e-mail" sandbox="" srcDoc={preview.data.html.replaceAll(`cid:${EMAIL_LOGO_CID}`, `data:image/png;base64,${EMAIL_LOGO_BASE64}`)} className="mt-3 h-[640px] w-full rounded-lg border border-border bg-white" data-email-preview="html" /><p className="mt-4 text-xs font-semibold text-muted">Version texte (envoyée aussi, pour les messageries sans HTML)</p><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm">{preview.data.text}</pre><p className="mt-3 text-xs text-muted">Contenu client uniquement. L’approbation et l’envoi sont deux actions distinctes.</p></Panel>}

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
