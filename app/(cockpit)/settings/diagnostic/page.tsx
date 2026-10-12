import { requireAdmin } from "@/lib/require-admin";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status-badge";
import { getDiagnostic, type Count, type Section } from "@/lib/system/diagnostic";
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
const OnOff = ({ on, yes, no, warnWhenOff }: { on: boolean; yes: string; no: string; warnWhenOff?: boolean }) => <StatusBadge label={on ? yes : no} tone={on ? "green" : warnWhenOff ? "amber" : "neutral"} />;
const Empty = ({ children }: { children: ReactNode }) => <p className="text-muted">{children}</p>;

export default async function DiagnosticPage() {
  await requireAdmin();
  // L'environnement est lu ici (couche page) et passé au module : seules des présences en sortent.
  const d = await getDiagnostic({ env: process.env });
  return (
    <>
      <Link href="/settings?tab=system" className="mb-6 inline-block text-xs text-accent hover:underline">← Observabilité</Link>
      <PageHeading eyebrow="Paramètres" title="Diagnostic" description="État du planificateur, de l’Agent Publications, des validations, de l’import WhatsApp, des connexions et des diffusions. Lecture seule : rien n’est modifié ni envoyé." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Block id="dg-scheduler" title="Planificateur" section={d.scheduler}>{(s) => <dl>
          <Line label="Cron configuré"><OnOff on={s.cronConfigured} yes="Oui" no="Non" warnWhenOff /></Line>
          <Line label="Dernier job planifié">{s.lastScheduledJob ? `${date(s.lastScheduledJob.at)} · ${s.lastScheduledJob.status}` : "aucun"}{s.stale && <span className="block text-xs text-warning">Aucun job planifié depuis plus de 36 h.</span>}</Line>
          <Line label="Battement du planificateur">{s.heartbeat === "unavailable" ? <span className="text-warning">Lecture impossible</span> : s.heartbeat
            ? <span>{s.heartbeat.ok === false ? "Dernier passage en échec" : s.heartbeat.ok ? "Dernier passage réussi" : "Passage en cours"} · {date(s.heartbeat.finishedAt ?? s.heartbeat.startedAt)}
              <span className="block text-xs text-muted">Dernier succès : {date(s.heartbeat.lastSuccessAt)} · dernier échec : {date(s.heartbeat.lastFailureAt)}</span>
              {s.heartbeat.failedSteps.length > 0 && <span className="block text-xs text-warning">Étapes en échec : {s.heartbeat.failedSteps.join(", ")}</span>}</span>
            : <span className="text-muted">Non suivi dans cette version</span>}</Line>
          {s.switches ? <>
            <Line label="Arrêt d’urgence"><StatusBadge label={s.switches.emergencyStop ? "Actif" : "Levé"} tone={s.switches.emergencyStop ? "amber" : "green"} /></Line>
            <Line label="Automatisation"><OnOff on={s.switches.automation} yes="Activée" no="Désactivée" /></Line>
            <Line label="Génération"><OnOff on={s.switches.generation} yes="Activée" no="Désactivée" /></Line>
            <Line label="Diffusion"><OnOff on={s.switches.publishing} yes="Autorisée" no="Désactivée" /></Line>
          </> : <Line label="Interrupteurs de publication"><span className="text-warning">Illisibles : tout est considéré comme arrêté</span></Line>}
          <Line label="Diffusion automatique à l’heure prévue"><OnOff on={s.scheduledDelivery} yes="Activée" no="Désactivée" /></Line>
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

        <Block id="dg-env" title="Variables d’environnement" description="Présence uniquement : aucune valeur n’est lue ni affichée." section={d.env}>{(e) => <>
          <dl>{e.modules.map((m) => <Line key={m.label} label={m.label}><OnOff on={m.configured} yes="Configuré" no="Non configuré" /></Line>)}</dl>
          <h3 className="mt-4 text-xs font-semibold text-muted uppercase">Interrupteurs serveur</h3>
          <dl>{e.flags.map((f) => <Line key={f.variable} label={f.label}><OnOff on={f.enabled} yes="Activée" no="Désactivée" /></Line>)}</dl>
        </>}</Block>
      </div>
    </>
  );
}
