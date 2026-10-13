import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { getDiagnostic, STATUS_GROUP_FALLBACK, type Count, type Section, type StatusGroup } from "@/lib/system/diagnostic";
import { DIAGNOSTIC_STATUS_LABELS, statusCounts, type DiagnosticItem, type DiagnosticStatus } from "@/lib/system/diagnostic-model";
import { formatDateTime } from "@/lib/format-date";

// Diagnostic technique (admin) : une section par mécanisme, chacune lue et affichée indépendamment. Lecture seule.
// Aucune valeur de variable, aucun jeton, aucun identifiant brut : états, libellés, dates et noms de clients uniquement.
export const metadata: Metadata = { title: "Diagnostic" };
export const dynamic = "force-dynamic";

const n = (c: Count) => `${c.value}${c.capped ? "+" : ""}`;
const date = (value: string | null | undefined) => (value ? formatDateTime(value) : "jamais");
function Block<T>({ id, title, description, section, children }: { id: string; title: string; description?: string; section: Section<T>; children: (data: T) => ReactNode }) {
  return (
    <Panel className="p-4 sm:p-5">
      <section aria-labelledby={id}>
        <h2 id={id} className="text-lg font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        <div className="mt-4 text-sm">{section.ok ? children(section.data) : <p role="status" className="text-warning">Section indisponible : la lecture a échoué. Les autres sections restent valables.</p>}</div>
      </section>
    </Panel>
  );
}
function Line({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1 border-b border-border py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between"><dt className="text-muted">{label}</dt><dd className="min-w-0">{children}</dd></div>;
}
const Empty = ({ children }: { children: ReactNode }) => <p className="text-muted">{children}</p>;
// Lot 9 : un état parmi « configuré », « opérationnel », « désactivé », « en erreur » (« inconnu » si illisible), avec sa preuve.
const STATUS_TONES: Record<DiagnosticStatus, StatusTone> = { operational: "green", configured: "blue", disabled: "neutral", error: "red", unknown: "amber" };
const State = ({ status }: { status: DiagnosticStatus }) => <StatusBadge label={DIAGNOSTIC_STATUS_LABELS[status]} tone={STATUS_TONES[status]} />;
function Items({ items }: { items: DiagnosticItem[] }) {
  return <ul className="divide-y divide-border">{items.map((item) => <li key={item.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4" data-status={item.status}>
    <div className="min-w-0"><p className="font-medium">{item.label}</p><p className="text-xs text-muted">{item.evidence}{item.at ? ` · ${date(item.at)}` : ""}</p></div>
    <State status={item.status} /></li>)}</ul>;
}
// Groupe illisible : ses éléments connus restent listés, « inconnu ».
const unknownItems = (labels: string[]): DiagnosticItem[] => labels.map((label) => ({ id: label, label, status: "unknown", evidence: "Lecture impossible : aucune donnée pour en juger.", at: null }));
function Group({ id, title, description, section, fallback, children }: { id: string; title: string; description?: string; section: Section<StatusGroup>; fallback: string[]; children?: ReactNode }) {
  return (
    <Panel className="p-4 sm:p-5">
      <section aria-labelledby={id}>
        <h2 id={id} className="text-lg font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        <div className="mt-3 text-sm"><Items items={section.ok ? section.data.items : unknownItems(fallback)} />{section.ok && children}</div>
      </section>
    </Panel>
  );
}
const eur = (value: number) => value.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

export default async function DiagnosticPage() {
  await requireAdmin();
  // L'environnement est lu ici (couche page) et passé au module : seules des présences en sortent.
  const d = await getDiagnostic({ env: process.env });
  const st = d.status;
  const counts = statusCounts([st.scheduler, st.safety, st.agents, st.ai, st.media, st.connections, st.delays].flatMap((g) => (g.ok ? g.data.items : [])));
  return (
    <>
      <Link href="/settings?tab=system" className="mb-6 inline-block text-xs text-accent hover:underline">← Observabilité</Link>
      <PageHeading eyebrow="Paramètres" title="Diagnostic" description="Chaque mécanisme classé « configuré », « opérationnel », « désactivé » ou « en erreur », avec sa preuve. Lecture seule : rien n’est modifié ni envoyé." />
      <section aria-labelledby="dg-states" className="mb-8" data-diagnostic-states="true">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 id="dg-states" className="text-xl font-semibold">État des mécanismes</h2>
          <ul className="flex flex-wrap gap-1.5" aria-label="Synthèse des états">{(Object.keys(counts) as DiagnosticStatus[]).filter((k) => counts[k] > 0).map((k) => <li key={k}><StatusBadge label={`${counts[k]} ${DIAGNOSTIC_STATUS_LABELS[k]}`} tone={STATUS_TONES[k]} /></li>)}</ul>
        </div>
        <p className="mb-4 text-sm text-muted">« Opérationnel » exige une preuve récente (passage ou traitement réussi, daté). Des variables présentes sans cette preuve restent « configuré ». Aucune valeur de variable n’est affichée.</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <Group id="dg-st-scheduler" title="Planificateur et étapes" description="D’après le dernier passage réel enregistré (battement)." section={st.scheduler} fallback={["Planificateur (cron)"]} />
          <Group id="dg-st-safety" title="Interrupteurs de sécurité" section={st.safety} fallback={STATUS_GROUP_FALLBACK.safety} />
          <Group id="dg-st-agents" title="Agents actifs" section={st.agents} fallback={STATUS_GROUP_FALLBACK.agents} />
          <Group id="dg-st-ai" title="IA : erreurs et coûts" section={st.ai} fallback={STATUS_GROUP_FALLBACK.ai}>{st.ai.ok && <dl className="mt-3">
            <Line label="Échecs de génération (7 j)">{st.ai.data.errors7d.generation}</Line>
            <Line label="Échecs de classement photo (7 j)">{st.ai.data.errors7d.classification}</Line>
            <Line label="Coût Agent Publications (30 j)">{eur(st.ai.data.costs30d.agentPublications)}</Line>
            <Line label="Coût classement photothèque (30 j)">{eur(st.ai.data.costs30d.mediaClassification)}</Line>
            <Line label="Coût autres agents (30 j)">{eur(st.ai.data.costs30d.agents)}</Line>
            <Line label="Total estimé (30 j)"><strong>{eur(st.ai.data.costs30d.total)}{st.ai.data.costs30d.capped ? " (au moins)" : ""}</strong></Line>
          </dl>}</Group>
          <Group id="dg-st-media" title="Google Drive et WhatsApp" section={st.media} fallback={STATUS_GROUP_FALLBACK.media} />
          <Group id="dg-st-connections" title="Connexions sociales et diffusions" section={st.connections} fallback={STATUS_GROUP_FALLBACK.connections} />
          <Group id="dg-st-delays" title="Délais de traitement" description="Âge du plus ancien élément en attente ; au-delà de 36 h, la file est en retard." section={st.delays} fallback={STATUS_GROUP_FALLBACK.delays} />
        </div>
      </section>

      <h2 className="mb-3 text-xl font-semibold">Détails</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Block id="dg-scheduler" title="Planificateur" section={d.scheduler}>{(s) => <dl>
          <Line label="Secret du cron"><State status={s.cronConfigured ? "configured" : "disabled"} /></Line>
          <Line label="Dernier job planifié">{s.lastScheduledJob ? `${date(s.lastScheduledJob.at)} · ${s.lastScheduledJob.status}` : "aucun"}{s.stale && <span className="block text-xs text-warning">Aucun job planifié depuis plus de 36 h.</span>}</Line>
          <Line label="Battement du planificateur">{s.heartbeat === "unavailable" ? <span className="text-warning">Lecture impossible</span> : s.heartbeat
            ? <span>{s.heartbeat.ok === false ? "Dernier passage en échec" : s.heartbeat.ok ? "Dernier passage réussi" : "Passage en cours"} · {date(s.heartbeat.finishedAt ?? s.heartbeat.startedAt)}
              <span className="block text-xs text-muted">Dernier succès : {date(s.heartbeat.lastSuccessAt)} · dernier échec : {date(s.heartbeat.lastFailureAt)}</span>
              {s.heartbeat.failedSteps.length > 0 && <span className="block text-xs text-warning">Étapes en échec : {s.heartbeat.failedSteps.join(", ")}</span>}</span>
            : <span className="text-muted">Aucun passage enregistré</span>}</Line>
        </dl>}</Block>

        <Block id="dg-agent" title="Dernier passage de l’Agent Publications" section={d.agent}>{(a) => <>
          <p>Échecs sur 7 jours : <strong className={a.failures7d.value ? "text-warning" : ""}>{n(a.failures7d)}</strong></p>
          {a.runs.length ? <ul className="mt-3 divide-y divide-border">{a.runs.map((r, i) => <li key={i} className="py-2">
            <p className="font-medium">{r.client} · {r.status}{r.error && <span className="text-warning"> · {r.error}</span>}</p>
            <p className="text-xs text-muted">{date(r.createdAt)}{r.completedAt ? ` → ${date(r.completedAt)}` : ""} · {r.media} · {r.costEur.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 3 })}</p>
          </li>)}</ul> : <Empty>Aucune préparation enregistrée.</Empty>}
          <h3 className="mt-4 text-xs font-semibold text-muted uppercase">Préparations planifiées</h3>
          {a.preparations.length ? <ul className="mt-1 space-y-1">{a.preparations.map((p, i) => <li key={i}>{date(p.at)} · {p.outcome}</li>)}</ul> : <Empty>Aucune préparation planifiée journalisée.</Empty>}
        </>}</Block>

        <Block id="dg-review" title="Publications en attente de validation" section={d.review}>{(r) =>
          <p><strong>{n(r.pending)}</strong> à valider · <Link href="/publications/review" className="text-accent hover:underline">Ouvrir la file de validation</Link></p>}</Block>

        <Block id="dg-whatsapp" title="Ingestion WhatsApp" section={d.whatsapp}>{(w) => <>
          <dl>
            <Line label="Imports en échec">{n(w.failed)}</Line>
            <Line label="Abandonnés après 5 tentatives">{n(w.exhausted)}</Line>
            <Line label="Bloqués en cours (bail expiré)">{n(w.stuck)}</Line>
          </dl>
          {w.recent.length > 0 && <ul className="mt-3 space-y-1">{w.recent.map((r, i) => <li key={i}>{date(r.receivedAt)} · {r.label} <span className="text-xs text-muted">({r.attempts}/5)</span></li>)}</ul>}
          <Link href="/settings/whatsapp" className="mt-3 inline-block text-accent hover:underline">Ouvrir la file d’import</Link>
        </>}</Block>

        <Block id="dg-connections" title="Connexions et diffusion" section={d.connections}>{(c) => <>
          <h3 className="text-xs font-semibold text-muted uppercase">Connexions à vérifier</h3>
          {c.connections.length ? <ul className="mt-1 space-y-1">{c.connections.map((x, i) => <li key={i}>{x.client} · {x.provider} · <span className="text-warning">{x.state}</span></li>)}</ul> : <Empty>Aucune connexion expirée ou en erreur.</Empty>}
          <h3 className="mt-4 text-xs font-semibold text-muted uppercase">Échecs OAuth (7 jours)</h3>
          {c.oauthFailures.length ? <ul className="mt-1 space-y-1">{c.oauthFailures.map((x, i) => <li key={i}>{date(x.at)} · {x.client} · {x.provider} · {x.reason}</li>)}</ul> : <Empty>Aucun échec de connexion.</Empty>}
          <h3 className="mt-4 text-xs font-semibold text-muted uppercase">Diffusions à traiter</h3>
          {c.deliveries.length ? <ul className="mt-1 space-y-1">{c.deliveries.map((x, i) => <li key={i}>{x.client} · {x.platform} · <span className="text-warning">{x.status}</span>{x.reason ? ` · ${x.reason}` : ""} <span className="text-xs text-muted">{date(x.at)}</span></li>)}</ul> : <Empty>Aucune diffusion en échec, bloquée ou à vérifier.</Empty>}
          <Link href="/publications/supervision" className="mt-3 inline-block text-accent hover:underline">Ouvrir la supervision</Link>
        </>}</Block>

        <Block id="dg-stuck" title="Tâches bloquées ou à relancer" description="Traitements dont le bail a expiré sans fin enregistrée." section={d.stuck}>{(s) => <dl>
          <Line label="Jobs d’automatisation">{n(s.jobs)}</Line>
          <Line label="Envois de publications">{n(s.publicationJobs)}</Line>
          <Line label="Préparations de l’Agent Publications">{n(s.agentRuns)}</Line>
          <Line label="Imports WhatsApp">{n(s.whatsapp)}</Line>
        </dl>}</Block>

        <Block id="dg-env" title="Variables d’environnement" description="Présence uniquement : aucune valeur n’est lue ni affichée. Une variable présente n’est que « configuré » : la preuve de fonctionnement est dans l’état des mécanismes." section={d.env}>{(e) => <>
          <dl>{e.modules.map((m) => <Line key={m.label} label={m.label}><State status={m.configured ? "configured" : "disabled"} /></Line>)}</dl>
          <h3 className="mt-4 text-xs font-semibold text-muted uppercase">Interrupteurs serveur</h3>
          <dl>{e.flags.map((f) => <Line key={f.variable} label={f.label}><State status={f.enabled ? "configured" : "disabled"} /></Line>)}</dl>
        </>}</Block>
      </div>
    </>
  );
}
