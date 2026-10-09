"use client";

import { useState, type ReactNode } from "react";
import { Action } from "@/components/ui/button";
import { ConfirmationDialog, DetailDrawer } from "@/components/ui/dialog";
import { RelationLink } from "@/components/ui/layout";
import { InlineNotice } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { useSimWorld } from "@/components/simulation/simulation-provider";
import { getAgentBlueprint, scopeLabels } from "@/lib/agents/catalog";
import { getService } from "@/lib/services/catalog";
import { at } from "@/lib/simulation/fixtures";
import {
  agentStatusLabels, formatSimDateTime, isAgentWorking, platformLabels, priorityLabels, publicationStatusLabels,
  reportKindLabels, reportStatusLabels, workKindLabels, workStatusLabels,
} from "@/lib/simulation/labels";
import type { SimEntityRef, SimWorkItem, SimWorld } from "@/lib/simulation/types";

export const newSimId = (prefix: string) => `sim-${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export function nowStamp(world: SimWorld) {
  const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date());
  return at(world.today, time);
}

export const clientName = (world: SimWorld, id?: string) => world.clients.find((client) => client.id === id)?.name ?? "Client";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mt-6"><h3 className="mb-2 text-xs font-medium tracking-[0.14em] text-muted uppercase">{title}</h3>{children}</section>;
}

function History({ items }: { items: { at: string; label: string }[] }) {
  if (!items.length) return null;
  return (
    <Section title="Historique">
      <ol className="space-y-2 border-l border-border pl-4">
        {[...items].reverse().map((item, index) => <li key={`${item.at}-${index}`} className="text-sm"><span className="text-muted">{formatSimDateTime(item.at)} · </span>{item.label}</li>)}
      </ol>
    </Section>
  );
}

type Ctx = ReturnType<typeof useSimWorld> & { close: () => void };

/** Relations communes : client (page), projet / agent / source (panneau). */
function Relations({ ctx, clientId, projectId, agentId, extra }: { ctx: Ctx; clientId?: string; projectId?: string; agentId?: string; extra?: ReactNode }) {
  const project = ctx.world.projects.find((item) => item.id === projectId);
  const agent = agentId ? getAgentBlueprint(agentId) : null;
  return (
    <div className="flex flex-wrap gap-2">
      {clientId && <span onClickCapture={ctx.close}><RelationLink kind="Client" label={clientName(ctx.world, clientId)} href={`/clients/${clientId}`} icon="clients" /></span>}
      {project && <RelationLink kind="Projet" label={project.name} onClick={() => ctx.open({ type: "project", id: project.id })} icon="projects" />}
      {agent && <RelationLink kind="Agent" label={agent.name} onClick={() => ctx.open({ type: "agent", id: agent.id })} icon="agents" />}
      {extra}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function WorkView({ ctx, item }: { ctx: Ctx; item: SimWorkItem }) {
  const [confirm, setConfirm] = useState<null | "approve" | "refuse">(null);
  const { world, update, open } = ctx;
  const source = item.sourceId ? world.work.find((other) => other.id === item.sourceId) : null;
  const derived = world.work.filter((other) => other.sourceId === item.id);
  const status = workStatusLabels[item.status];

  const set = (status: SimWorkItem["status"], label: string) => update((draft) => {
    const target = draft.work.find((other) => other.id === item.id);
    if (target) { target.status = status; target.history.push({ at: nowStamp(draft), label }); }
  });

  function prepareAction() {
    const id = newSimId("act");
    update((draft) => {
      const target = draft.work.find((other) => other.id === item.id);
      if (target) { target.status = "accepted"; target.history.push({ at: nowStamp(draft), label: "Recommandation acceptée" }); }
      draft.work.push({ id, kind: "action", title: `Appliquer : ${item.title}`, summary: "Action préparée par l’agent à partir de la recommandation acceptée. Rien ne sera exécuté sans validation.",
        status: "draft", clientId: item.clientId, projectId: item.projectId, agentId: item.agentId, priority: item.priority, createdAt: draft.today, sourceId: item.id,
        history: [{ at: nowStamp(draft), label: "Action préparée" }] });
    });
    open({ type: "work", id });
  }

  function diagnose() {
    update((draft) => {
      const target = draft.work.find((other) => other.id === item.id);
      if (!target) return;
      target.status = "investigating"; target.history.push({ at: nowStamp(draft), label: "Diagnostic lancé" });
      if (!draft.work.some((other) => other.sourceId === item.id)) {
        draft.work.push({ id: newSimId("rec"), kind: "recommendation", title: `Correction proposée : ${item.title}`, summary: "Diagnostic terminé : une correction est proposée.",
          status: "to-review", clientId: item.clientId, projectId: item.projectId, agentId: item.agentId, priority: "high", createdAt: draft.today, sourceId: item.id,
          history: [{ at: nowStamp(draft), label: "Diagnostic terminé" }] });
      }
    });
  }

  const actions: ReactNode[] = [];
  if (item.kind === "task") {
    if (item.status === "todo") actions.push(<Action key="start" variant="primary" onClick={() => set("in-progress", "Tâche commencée")}>Commencer</Action>);
    if (item.status === "in-progress") actions.push(<Action key="done" variant="primary" onClick={() => set("done", "Tâche terminée")}>Marquer terminée</Action>);
    if (item.status === "waiting") actions.push(<Action key="resume" variant="primary" onClick={() => set("todo", "Tâche relancée")}>Relancer</Action>);
    if (item.status === "done") actions.push(<Action key="reopen" onClick={() => set("todo", "Tâche rouverte")}>Rouvrir</Action>);
    if (item.status !== "done" && item.status !== "waiting") actions.push(<Action key="wait" onClick={() => set("waiting", "Mise en attente")}>Mettre en attente</Action>);
  }
  if (item.kind === "recommendation" && item.status === "to-review") {
    actions.push(<Action key="accept" variant="primary" onClick={prepareAction}>Accepter et préparer l’action</Action>);
    actions.push(<Action key="reject" onClick={() => set("rejected", "Recommandation écartée")}>Écarter</Action>);
  }
  if (item.kind === "action") {
    if (item.status === "draft") actions.push(<Action key="ask" variant="primary" onClick={() => set("to-approve", "Validation demandée")}>Demander la validation</Action>);
    if (item.status === "to-approve") {
      actions.push(<Action key="approve" variant="primary" onClick={() => setConfirm("approve")}>Approuver</Action>);
      actions.push(<Action key="refuse" onClick={() => setConfirm("refuse")}>Refuser</Action>);
    }
    if (item.status === "approved") actions.push(<Action key="run" variant="primary" onClick={() => set("executed", "Action réalisée (simulation)")}>Exécuter (simulation)</Action>);
    if (item.status === "failed") actions.push(<Action key="retry" variant="primary" onClick={() => set("to-approve", "Nouvelle tentative demandée")}>Réessayer</Action>);
  }
  if (item.kind === "incident") {
    if (item.status === "open") actions.push(<Action key="diag" variant="primary" onClick={diagnose}>Lancer le diagnostic</Action>);
    if (item.status === "investigating") actions.push(<Action key="resolve" variant="primary" onClick={() => set("resolved", "Incident résolu")}>Marquer résolu</Action>);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge {...status} />
        <span className="text-xs text-muted">{workKindLabels[item.kind]}</span>
        {item.kind === "task" && <StatusBadge {...priorityLabels[item.priority]} />}
        {item.due && <span className="text-xs text-muted">Échéance {formatSimDateTime(item.due)}</span>}
      </div>
      {item.summary && <p className="mt-4 text-sm leading-6">{item.summary}</p>}
      {item.details && <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">{item.details.map((detail) => <div key={detail.label} className="contents"><dt className="text-muted">{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>}
      <Section title="Liens"><Relations ctx={ctx} clientId={item.clientId} projectId={item.projectId} agentId={item.agentId}
        extra={<>
          {source && <RelationLink kind={`${workKindLabels[source.kind]} d’origine`} label={source.title} onClick={() => open({ type: "work", id: source.id })} />}
          {derived.map((other) => <RelationLink key={other.id} kind={workKindLabels[other.kind]} label={other.title} onClick={() => open({ type: "work", id: other.id })} />)}
        </>} /></Section>
      {item.kind === "action" && item.status !== "executed" && <div className="mt-6"><InlineNotice tone="info">Simulation : aucune modification réelle (Ads, site, publication) ne sera effectuée.</InlineNotice></div>}
      {actions.length > 0 && <div className="mt-6 flex flex-wrap gap-2">{actions}</div>}
      {item.status === "executed" && <div className="mt-6"><InlineNotice tone="green" title="Action réalisée (simulation)">Le résultat apparaîtra dans le prochain rapport du client.</InlineNotice></div>}
      <History items={item.history} />
      <ConfirmationDialog
        open={confirm !== null}
        title={confirm === "approve" ? "Approuver cette action ?" : "Refuser cette action ?"}
        message={confirm === "approve" ? "L’agent pourra l’exécuter. En simulation, rien n’est réellement modifié." : "L’action sera abandonnée ; l’historique est conservé."}
        confirmLabel={confirm === "approve" ? "Approuver" : "Refuser"}
        tone={confirm === "refuse" ? "danger" : "primary"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { if (confirm === "approve") set("approved", "Action approuvée"); else set("refused", "Action refusée"); setConfirm(null); }}
      />
    </>
  );
}

function WorkList({ ctx, items, empty }: { ctx: Ctx; items: SimWorkItem[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
          <button type="button" onClick={() => ctx.open({ type: "work", id: item.id })} className="min-w-0 text-left text-sm hover:text-accent hover:underline">
            <span className="text-muted">{workKindLabels[item.kind]} · </span>{item.title}
          </button>
          <StatusBadge {...workStatusLabels[item.status]} />
        </li>
      ))}
    </ul>
  );
}

function ProjectView({ ctx, id }: { ctx: Ctx; id: string }) {
  const project = ctx.world.projects.find((item) => item.id === id);
  if (!project) return <Missing />;
  const service = getService(project.serviceId);
  const publications = ctx.world.publications.filter((item) => item.projectId === project.id);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={project.status === "setup" ? "À configurer" : project.status === "done" ? "Terminé" : "Actif"} tone={project.status === "setup" ? "amber" : "green"} />
        <span className="text-xs text-muted">{service?.name}</span>
      </div>
      <Section title="Liens"><Relations ctx={ctx} clientId={project.clientId} extra={service?.defaultAgents.map((agentId) => { const agent = getAgentBlueprint(agentId); return agent && <RelationLink key={agentId} kind="Agent" label={agent.name} onClick={() => ctx.open({ type: "agent", id: agent.id })} icon="agents" />; })} /></Section>
      <Section title="Travail"><WorkList ctx={ctx} items={ctx.world.work.filter((item) => item.projectId === project.id)} empty="Aucun travail sur ce projet." /></Section>
      {publications.length > 0 && <Section title="Publications">
        <ul className="divide-y divide-border">{publications.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 py-2.5"><button type="button" onClick={() => ctx.open({ type: "publication", id: item.id })} className="min-w-0 text-left text-sm hover:text-accent hover:underline">{item.subject}</button><StatusBadge {...publicationStatusLabels[item.status]} /></li>)}</ul>
      </Section>}
    </>
  );
}

function PublicationView({ ctx, id }: { ctx: Ctx; id: string }) {
  const publication = ctx.world.publications.find((item) => item.id === id);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(publication?.text ?? "");
  const [schedule, setSchedule] = useState({ date: publication?.date ?? ctx.world.today, time: publication?.time ?? "09:00" });
  if (!publication) return <Missing />;
  const agent = ctx.world.agents.publications;

  const change = (mutate: (draft: NonNullable<typeof publication>) => void, label: string) => ctx.update((draft) => {
    const target = draft.publications.find((item) => item.id === id);
    if (target) { mutate(target); target.history.push({ at: nowStamp(draft), label }); }
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge {...publicationStatusLabels[publication.status]} />
        <span className="text-xs text-muted">{formatSimDateTime(publication.date)} à {publication.time}</span>
      </div>
      <Section title="Aperçu">
        {editing ? (
          <div className="space-y-3">
            <label className="block text-xs text-muted">Texte<textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} className="mt-1.5 w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground" /></label>
            <div className="flex gap-2"><Action variant="primary" onClick={() => { change((draft) => { draft.text = text; if (draft.status !== "draft") draft.status = "to-review"; }, "Texte modifié"); setEditing(false); }}>Enregistrer (simulation)</Action><Action onClick={() => { setText(publication.text); setEditing(false); }}>Annuler</Action></div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-background/60 p-4">
            <p className="text-xs text-muted">{clientName(ctx.world, publication.clientId)}</p>
            <p className="mt-2 text-sm leading-6 whitespace-pre-wrap">{publication.text}</p>
            <div aria-hidden="true" className="mt-3 h-28 rounded-lg bg-gradient-to-br from-white/10 to-white/[0.02]" />
          </div>
        )}
      </Section>
      <Section title="Canaux">
        <ul className="space-y-2">{publication.channels.map((channel) => (
          <li key={channel.platform} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{platformLabels[channel.platform]}</span>
            <StatusBadge label={channel.status === "published" ? "Publiée" : channel.status === "failed" ? "Échec" : "En attente"} tone={channel.status === "published" ? "green" : channel.status === "failed" ? "red" : "neutral"} />
            {channel.error && <p className="w-full text-xs text-red-300">{channel.error}</p>}
          </li>
        ))}</ul>
      </Section>
      <Section title="Liens"><Relations ctx={ctx} clientId={publication.clientId} projectId={publication.projectId} agentId="publications" /></Section>
      {!isAgentWorking(agent.status) && <div className="mt-6"><InlineNotice tone="amber">Agent Publications : {agentStatusLabels[agent.status].label.toLowerCase()}. {agent.note}</InlineNotice></div>}
      {!editing && (
        <div className="mt-6 flex flex-wrap gap-2">
          {publication.status === "draft" && <Action variant="primary" onClick={() => change((draft) => { draft.status = "to-review"; }, "Soumise à validation")}>Soumettre à validation</Action>}
          {publication.status === "to-review" && <Action variant="primary" onClick={() => change((draft) => { draft.status = "approved"; }, "Validée")}>Valider</Action>}
          {(["draft", "to-review", "approved"] as const).includes(publication.status as "draft") && <Action onClick={() => setEditing(true)}>Modifier</Action>}
          {publication.status === "approved" && (
            <div className="flex w-full flex-wrap items-end gap-2">
              <label className="text-xs text-muted">Date<input type="date" value={schedule.date} onChange={(event) => setSchedule({ ...schedule, date: event.target.value })} className="mt-1.5 block min-h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground" /></label>
              <label className="text-xs text-muted">Heure<input type="time" value={schedule.time} onChange={(event) => setSchedule({ ...schedule, time: event.target.value })} className="mt-1.5 block min-h-11 rounded-lg border border-border bg-background px-3 text-sm text-foreground" /></label>
              <Action variant="primary" onClick={() => change((draft) => { draft.status = "scheduled"; draft.date = schedule.date; draft.time = schedule.time; }, `Planifiée le ${formatSimDateTime(schedule.date)} à ${schedule.time}`)}>Planifier</Action>
            </div>
          )}
          {publication.status === "scheduled" && <>
            <Action variant="primary" onClick={() => change((draft) => { draft.status = "published"; draft.channels = draft.channels.map((channel) => ({ platform: channel.platform, status: "published" })); }, "Publiée (simulation)")}>Publier maintenant (simulation)</Action>
            <Action onClick={() => change((draft) => { draft.status = "partial"; draft.channels = draft.channels.map((channel, index) => index === draft.channels.length - 1 ? { platform: channel.platform, status: "failed", error: "Le réseau a refusé le média (simulation)." } : { platform: channel.platform, status: "published" }); }, "Échec partiel (simulation)")}>Simuler un échec partiel</Action>
          </>}
          {publication.status === "partial" && <Action variant="primary" onClick={() => change((draft) => { draft.status = "published"; draft.channels = draft.channels.map((channel) => ({ platform: channel.platform, status: "published" })); }, "Canal relancé avec succès (simulation)")}>Relancer les canaux en échec</Action>}
        </div>
      )}
      <div className="mt-6"><InlineNotice tone="info">Simulation : aucune publication réelle n’est envoyée.</InlineNotice></div>
      <History items={publication.history} />
    </>
  );
}

export function generateReportContent(world: SimWorld, clientId?: string) {
  const work = world.work.filter((item) => !clientId || item.clientId === clientId);
  const seo = world.seo.find((item) => item.clientId === clientId);
  const campaign = world.campaigns.find((item) => item.clientId === clientId);
  const publications = world.publications.filter((item) => !clientId || item.clientId === clientId);
  const sections = [
    seo && { title: "SEO", lines: [`Clics : ${seo.clicks.toLocaleString("fr-FR")} (${seo.clicksChange >= 0 ? "+" : ""}${seo.clicksChange} %)`, `Position moyenne : ${seo.position.toLocaleString("fr-FR")}`] },
    campaign && { title: "Google Ads", lines: [`Dépenses : ${campaign.spend} € / ${campaign.budget} €`, `Conversions : ${campaign.conversions} · coût par conversion ${campaign.cpa} €`] },
    { title: "Publications", lines: [`${publications.filter((item) => item.status === "published").length} publiées · ${publications.filter((item) => item.status === "to-review").length} à valider`] },
    { title: "Travail", lines: [`${work.filter((item) => item.status === "done" || item.status === "executed").length} éléments terminés · ${work.filter((item) => ["to-review", "to-approve", "open"].includes(item.status)).length} en attente de décision`] },
  ].filter(Boolean) as { title: string; lines: string[] }[];
  return { summary: `Synthèse générée à partir de l’activité simulée${clientId ? ` de ${clientName(world, clientId)}` : " de tous les clients"}.`, sections };
}

function ReportView({ ctx, id }: { ctx: Ctx; id: string }) {
  const report = ctx.world.reports.find((item) => item.id === id);
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(report?.summary ?? "");
  const [confirmSend, setConfirmSend] = useState(false);
  if (!report) return <Missing />;

  const change = (mutate: (draft: NonNullable<typeof report>, world: SimWorld) => void, label: string) => ctx.update((draft) => {
    const target = draft.reports.find((item) => item.id === id);
    if (target) { mutate(target, draft); target.history.push({ at: nowStamp(draft), label }); }
  });

  function generate() {
    change((draft) => { draft.status = "generating"; }, "Génération lancée");
    window.setTimeout(() => change((draft, world) => { Object.assign(draft, generateReportContent(world, draft.clientId), { status: "ready" }); }, "Rapport généré"), 1200);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge {...reportStatusLabels[report.status]} />
        <span className="text-xs text-muted">{reportKindLabels[report.kind]} · {report.period}</span>
      </div>
      {report.status === "to-generate" && <div className="mt-6"><InlineNotice title="Rapport pas encore généré" action={<Action variant="primary" onClick={generate}>Générer (simulation)</Action>}>L’Agent Rapport rassemblera publications, SEO, Ads, tâches, recommandations et incidents.</InlineNotice></div>}
      {report.status === "generating" && <p role="status" className="mt-6 animate-pulse text-sm text-muted">L’Agent Rapport assemble les données…</p>}
      {(report.status === "ready" || report.status === "approved" || report.status === "sent") && (
        <Section title="Aperçu">
          <div className="rounded-xl border border-border bg-background/60 p-5">
            <p className="text-xs text-muted">{report.clientId ? clientName(ctx.world, report.clientId) : "Tous les clients"} · {report.period}</p>
            {editing ? (
              <div className="mt-3 space-y-3">
                <label className="block text-xs text-muted">Synthèse<textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} className="mt-1.5 w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground" /></label>
                <div className="flex gap-2"><Action variant="primary" onClick={() => { change((draft) => { draft.summary = summary; draft.status = "ready"; }, "Synthèse modifiée"); setEditing(false); }}>Enregistrer (simulation)</Action><Action onClick={() => setEditing(false)}>Annuler</Action></div>
              </div>
            ) : <p className="mt-3 text-sm leading-6">{report.summary}</p>}
            {report.sections.map((section) => <div key={section.title} className="mt-4"><h4 className="text-sm font-medium">{section.title}</h4><ul className="mt-1 list-disc pl-5 text-sm text-muted">{section.lines.map((line) => <li key={line}>{line}</li>)}</ul></div>)}
          </div>
        </Section>
      )}
      {report.clientId && <Section title="Liens"><Relations ctx={ctx} clientId={report.clientId} agentId="report" /></Section>}
      {!editing && (
        <div className="mt-6 flex flex-wrap gap-2">
          {report.status === "ready" && <><Action variant="primary" onClick={() => change((draft) => { draft.status = "approved"; }, "Rapport approuvé")}>Approuver</Action><Action onClick={() => { setSummary(report.summary); setEditing(true); }}>Modifier</Action></>}
          {report.status === "approved" && <Action variant="primary" onClick={() => setConfirmSend(true)}>Envoyer (simulation)</Action>}
          {report.status === "sent" && <InlineNotice tone="green">Envoyé à {report.recipient} (simulation : aucun e-mail réel).</InlineNotice>}
        </div>
      )}
      <History items={report.history} />
      <ConfirmationDialog open={confirmSend} title="Envoyer le rapport ?" message={<>Destinataire : <strong>{report.recipient}</strong>. En simulation, aucun e-mail n’est envoyé.</>} confirmLabel="Envoyer (simulation)"
        onCancel={() => setConfirmSend(false)} onConfirm={() => { change((draft) => { draft.status = "sent"; }, `Envoyé à ${report.recipient} (simulation)`); setConfirmSend(false); }} />
    </>
  );
}

const agentConfigFields: Record<string, { name: string; label: string; placeholder: string }[]> = {
  seo: [{ name: "property", label: "Propriété Search Console", placeholder: "https://www.exemple.fr" }],
  "google-ads": [{ name: "account", label: "Compte Google Ads", placeholder: "123-456-7890" }],
  publications: [{ name: "tone", label: "Ton éditorial", placeholder: "Chaleureux, local" }],
  monitoring: [{ name: "url", label: "URL à surveiller", placeholder: "https://www.exemple.fr" }],
  automation: [{ name: "workflow", label: "Premier workflow", placeholder: "Relance devis" }],
  report: [{ name: "recipient", label: "Destinataire par défaut", placeholder: "contact@exemple.fr" }],
};

function AgentView({ ctx, id }: { ctx: Ctx; id: string }) {
  const blueprint = getAgentBlueprint(id);
  const [configuring, setConfiguring] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  if (!blueprint) return <Missing />;
  const agent = ctx.world.agents[blueprint.id];
  const working = isAgentWorking(agent.status);
  const clients = ctx.world.clients.filter((client) => blueprint.includedForAllClients || blueprint.services.some((service) => client.services[service]));
  const projects = ctx.world.projects.filter((project) => blueprint.services.includes(project.serviceId));
  const automations = ctx.world.automations.filter((item) => item.agentId === blueprint.id);
  const activity = ctx.world.activity.filter((item) => item.agentId === blueprint.id).slice(0, 4);
  const produced = ctx.world.work.filter((item) => item.agentId === blueprint.id && item.kind !== "task");
  const setStatus = (status: typeof agent.status, config?: Record<string, string>) => ctx.update((draft) => {
    draft.agents[blueprint.id] = { status, config: config ?? draft.agents[blueprint.id].config };
    // Un agent prêt rend actifs les services qui n’attendaient que lui.
    if (status === "ready") for (const client of draft.clients) for (const service of blueprint.services) if (client.services[service] === "to-configure") client.services[service] = "active";
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2"><StatusBadge {...agentStatusLabels[agent.status]} /><span className="text-xs text-muted">Portée : {scopeLabels[blueprint.scope]}{blueprint.includedForAllClients && " · Inclus par défaut"}</span></div>
      <p className="mt-4 text-sm leading-6">{blueprint.role}</p>
      {agent.note && !working && <div className="mt-4"><InlineNotice tone={agent.status === "error" || agent.status === "disconnected" ? "red" : "amber"}>{agent.note}</InlineNotice></div>}

      {configuring ? (
        <form className="mt-6 space-y-3" onSubmit={(event) => { event.preventDefault(); setStatus("ready", values); setConfiguring(false); }}>
          <h3 className="text-sm font-medium">Configurer {blueprint.name}</h3>
          {(agentConfigFields[blueprint.id] ?? []).map((field) => (
            <label key={field.name} className="block text-xs text-muted">{field.label}
              <input required value={values[field.name] ?? ""} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} placeholder={field.placeholder} className="mt-1.5 block min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
            </label>
          ))}
          <InlineNotice tone="info">Simulation : aucune connexion réelle n’est établie.</InlineNotice>
          <div className="flex gap-2"><Action type="submit" variant="primary">Enregistrer (simulation)</Action><Action onClick={() => setConfiguring(false)}>Annuler</Action></div>
        </form>
      ) : (
        <div className="mt-6 flex flex-wrap gap-2">
          {["to-connect", "config-required", "disconnected", "coming-soon"].includes(agent.status) && <Action variant="primary" onClick={() => setConfiguring(true)}>{agent.status === "disconnected" ? "Reconnecter" : "Configurer"}</Action>}
          {agent.status === "error" && <Action variant="primary" onClick={() => setStatus("active")}>Relancer (simulation)</Action>}
          {working && <Action onClick={() => setStatus("paused")}>Mettre en pause</Action>}
          {agent.status === "paused" && <Action variant="primary" onClick={() => setStatus("active")}>Réactiver</Action>}
        </div>
      )}

      <Section title="Services"><div className="flex flex-wrap gap-2">{blueprint.services.map((serviceId) => <RelationLink key={serviceId} kind="Service" label={getService(serviceId)?.name ?? serviceId} />)}</div></Section>
      <Section title="Capacités">
        <ul className="space-y-1.5 text-sm">{blueprint.capabilities.map((capability) => <li key={capability.label} className={`flex gap-2 ${working ? "" : "text-muted"}`}><span aria-hidden="true" className={`w-4 text-center ${working ? "text-accent" : ""}`}>{working ? "✓" : "○"}</span>{capability.label}<span className="sr-only">{working ? " (active en simulation)" : " (prévue)"}</span></li>)}</ul>
      </Section>
      <Section title={`Clients (${clients.length})`}>
        {clients.length ? <div className="flex flex-wrap gap-2" onClickCapture={ctx.close}>{clients.map((client) => <RelationLink key={client.id} kind="Client" label={client.name} href={`/clients/${client.id}`} />)}</div> : <p className="text-sm text-muted">Aucun client abonné au service.</p>}
      </Section>
      {projects.length > 0 && <Section title="Projets"><div className="flex flex-wrap gap-2">{projects.map((project) => <RelationLink key={project.id} kind={clientName(ctx.world, project.clientId)} label={project.name} onClick={() => ctx.open({ type: "project", id: project.id })} />)}</div></Section>}
      {automations.length > 0 && <Section title="Automatisations"><div className="flex flex-wrap gap-2">{automations.map((item) => <RelationLink key={item.id} kind={item.schedule} label={item.label} onClick={() => ctx.open({ type: "automation", id: item.id })} />)}</div></Section>}
      <Section title="Recommandations et incidents"><WorkList ctx={ctx} items={produced} empty="Rien de produit pour l’instant." /></Section>
      {activity.length > 0 && <Section title="Dernières analyses"><ul className="space-y-2 text-sm">{activity.map((item) => <li key={item.id}><span className="text-muted">{formatSimDateTime(item.at)} · </span>{item.summary}</li>)}</ul></Section>}
    </>
  );
}

function AutomationView({ ctx, id }: { ctx: Ctx; id: string }) {
  const automation = ctx.world.automations.find((item) => item.id === id);
  if (!automation) return <Missing />;
  const agent = getAgentBlueprint(automation.agentId);
  const change = (mutate: (draft: NonNullable<typeof automation>, world: SimWorld) => void) => ctx.update((draft) => { const target = draft.automations.find((item) => item.id === id); if (target) mutate(target, draft); });
  return (
    <>
      <div className="flex flex-wrap items-center gap-2"><StatusBadge label={automation.status === "active" ? "Active" : automation.status === "paused" ? "En pause" : "En erreur"} tone={automation.status === "active" ? "green" : automation.status === "error" ? "red" : "neutral"} /><span className="text-xs text-muted">{automation.schedule}</span></div>
      <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Cible</dt><dd>{automation.target}</dd>
        <dt className="text-muted">Prochaine exécution</dt><dd>{automation.status === "paused" ? "En pause" : formatSimDateTime(automation.nextRun)}</dd>
        <dt className="text-muted">Dernière exécution</dt><dd>{automation.lastRun ? formatSimDateTime(automation.lastRun) : "Jamais"}</dd>
      </dl>
      {agent && <Section title="Liens"><Relations ctx={ctx} agentId={agent.id} /></Section>}
      <div className="mt-6 flex flex-wrap gap-2">
        <Action variant="primary" onClick={() => change((draft, world) => { const stamp = nowStamp(world); draft.lastRun = stamp; draft.status = "active"; draft.history.unshift({ at: stamp, status: "success", summary: "Exécution manuelle (simulation) : aucun problème détecté" }); })}>Exécuter maintenant (simulation)</Action>
        {automation.status === "paused" ? <Action onClick={() => change((draft) => { draft.status = "active"; })}>Reprendre</Action> : <Action onClick={() => change((draft) => { draft.status = "paused"; })}>Mettre en pause</Action>}
      </div>
      <div className="mt-6"><InlineNotice tone="info">Simulation : aucune tâche planifiée réelle (cron) n’existe.</InlineNotice></div>
      <Section title="Historique">
        <ul className="space-y-2 text-sm">{automation.history.map((entry, index) => <li key={`${entry.at}-${index}`} className="flex flex-wrap items-center gap-2"><StatusBadge label={entry.status === "success" ? "Réussie" : "Échec"} tone={entry.status === "success" ? "green" : "red"} /><span className="text-muted">{formatSimDateTime(entry.at)}</span><span>{entry.summary}</span></li>)}</ul>
      </Section>
    </>
  );
}

function CampaignView({ ctx, id }: { ctx: Ctx; id: string }) {
  const campaign = ctx.world.campaigns.find((item) => item.id === id);
  if (!campaign) return <Missing />;
  return (
    <>
      <StatusBadge label={campaign.state === "anomaly" ? "Anomalie" : campaign.state === "growing" ? "En progression" : "Stable"} tone={campaign.state === "anomaly" ? "red" : "green"} />
      <p className="mt-4 text-sm">{campaign.note}</p>
      <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
        {[["Dépenses", `${campaign.spend} € / ${campaign.budget} €`], ["Conversions", String(campaign.conversions)], ["Coût / conversion", `${campaign.cpa} €`]].map(([label, value]) => <div key={label} className="rounded-lg bg-white/[0.03] p-3"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}
      </dl>
      <Section title="Liens"><Relations ctx={ctx} clientId={campaign.clientId} agentId="google-ads" /></Section>
      <Section title="Travail lié"><WorkList ctx={ctx} items={ctx.world.work.filter((item) => item.clientId === campaign.clientId && item.agentId === "google-ads")} empty="Aucune recommandation." /></Section>
    </>
  );
}

function SiteView({ ctx, id }: { ctx: Ctx; id: string }) {
  const site = ctx.world.sites.find((item) => item.clientId === id);
  if (!site) return <Missing />;
  return (
    <>
      <StatusBadge label={site.status === "up" ? "En ligne" : site.status === "down" ? "Indisponible" : "Dégradé"} tone={site.status === "up" ? "green" : "red"} />
      <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
        {[["Disponibilité", site.uptime], ["Performance", `${site.performance} / 100`], ["Dernier contrôle", formatSimDateTime(site.lastCheck)]].map(([label, value]) => <div key={label} className="rounded-lg bg-white/[0.03] p-3"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}
      </dl>
      <Section title="Liens"><Relations ctx={ctx} clientId={site.clientId} agentId="monitoring" /></Section>
      <Section title="Incidents et corrections"><WorkList ctx={ctx} items={ctx.world.work.filter((item) => item.clientId === site.clientId && item.agentId === "monitoring")} empty="Aucun incident." /></Section>
    </>
  );
}

function Missing() {
  return <p className="text-sm text-muted">Cet élément n’existe plus dans la simulation (scénario réinitialisé ?).</p>;
}

function titleFor(world: SimWorld, ref: SimEntityRef) {
  switch (ref.type) {
    case "work": return world.work.find((item) => item.id === ref.id)?.title ?? "Élément";
    case "project": return world.projects.find((item) => item.id === ref.id)?.name ?? "Projet";
    case "publication": return world.publications.find((item) => item.id === ref.id)?.subject ?? "Publication";
    case "report": { const report = world.reports.find((item) => item.id === ref.id); return report ? `${reportKindLabels[report.kind]} · ${report.clientId ? clientName(world, report.clientId) : "Tous les clients"}` : "Rapport"; }
    case "agent": return getAgentBlueprint(ref.id)?.name ?? "Agent";
    case "automation": return world.automations.find((item) => item.id === ref.id)?.label ?? "Automatisation";
    case "campaign": return world.campaigns.find((item) => item.id === ref.id)?.name ?? "Campagne";
    case "site": return world.sites.find((item) => item.clientId === ref.id)?.url ?? "Site";
  }
}

/** Panneau de détail commun à toutes les entités simulées, avec pile de navigation (Retour). */
export function SimEntityDrawer({ stack, onBack, onClose }: { stack: SimEntityRef[]; onBack: () => void; onClose: () => void }) {
  const simulation = useSimWorld();
  const ref = stack.at(-1);
  const ctx: Ctx = { ...simulation, close: onClose };
  return (
    <DetailDrawer
      open={Boolean(ref)}
      onClose={onClose}
      onBack={stack.length > 1 ? onBack : undefined}
      title={ref ? titleFor(simulation.world, ref) : ""}
      description={<StatusBadge label="Simulation" tone="blue" />}
    >
      {ref?.type === "work" && (() => { const item = simulation.world.work.find((other) => other.id === ref.id); return item ? <WorkView key={item.id} ctx={ctx} item={item} /> : <Missing />; })()}
      {ref?.type === "project" && <ProjectView key={ref.id} ctx={ctx} id={ref.id} />}
      {ref?.type === "publication" && <PublicationView key={ref.id} ctx={ctx} id={ref.id} />}
      {ref?.type === "report" && <ReportView key={ref.id} ctx={ctx} id={ref.id} />}
      {ref?.type === "agent" && <AgentView key={ref.id} ctx={ctx} id={ref.id} />}
      {ref?.type === "automation" && <AutomationView key={ref.id} ctx={ctx} id={ref.id} />}
      {ref?.type === "campaign" && <CampaignView key={ref.id} ctx={ctx} id={ref.id} />}
      {ref?.type === "site" && <SiteView key={ref.id} ctx={ctx} id={ref.id} />}
    </DetailDrawer>
  );
}

