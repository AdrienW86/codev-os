"use client";

import { useState } from "react";
import { Action } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EntityCard } from "@/components/ui/layout";
import { PageHeading } from "@/components/ui/primitives";
import { EmptyState, InlineNotice } from "@/components/ui/states";
import { ButtonTabs } from "@/components/ui/tabs";
import { useSimWorld } from "@/components/simulation/simulation-provider";
import { clientName, newSimId } from "@/components/simulation/entity-drawer";
import { reportKindLabels, reportStatusLabels } from "@/lib/simulation/labels";
import type { SimId, SimReport } from "@/lib/simulation/types";

const inputClass = "mt-1.5 block min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground";

/** Rapports simulés (CAS F) : à générer → génération → prêt à relire → approuvé → envoyé. */
export function SimReports() {
  const { world, update, open } = useSimWorld();
  const [tab, setTab] = useState("all");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ clientId: world.clients[0]?.id ?? "", kind: "weekly" as SimReport["kind"] });
  const reports = world.reports.filter((report) => tab === "all" || (tab === "clients" ? Boolean(report.clientId) : report.kind === tab));
  const order: SimReport["status"][] = ["ready", "generating", "to-generate", "approved", "sent"];

  function create() {
    const id = newSimId("report");
    update((draft) => { draft.reports.unshift({ id, clientId: form.kind === "global" ? undefined : form.clientId as SimId, kind: form.kind, period: form.kind === "monthly" ? "Mois en cours" : form.kind === "global" ? "Mois en cours" : "Semaine en cours", status: "to-generate", summary: "", sections: [], recipient: form.kind === "global" ? "Équipe CODE-V" : `contact@${(draft.clients.find((client) => client.id === form.clientId)?.website || "client.example")}`, history: [{ at: `${draft.today}T09:00`, label: "Rapport créé" }] }); });
    setCreating(false); open({ type: "report", id });
  }

  return (
    <>
      <PageHeading eyebrow="Suivi" title="Rapports" description="Suivez l’activité et les performances de vos clients." action={<Action variant="primary" onClick={() => setCreating(true)}>+ Nouveau rapport</Action>} />
      <ButtonTabs label="Type de rapport" current={tab} onChange={setTab} items={[
        { id: "all", label: "Tous", count: world.reports.length }, { id: "weekly", label: "Hebdomadaires" }, { id: "monthly", label: "Mensuels" }, { id: "clients", label: "Par client" }, { id: "global", label: "Activité globale" },
      ]} />
      {reports.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...reports].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)).map((report) => (
            <EntityCard key={report.id} icon="reports" title={report.clientId ? clientName(world, report.clientId) : "Tous les clients"} eyebrow={`${reportKindLabels[report.kind]} · ${report.period}`}
              status={reportStatusLabels[report.status]} onOpen={() => open({ type: "report", id: report.id })}
              description={report.summary || "Pas encore généré."} />
          ))}
        </div>
      ) : <EmptyState icon="reports" title="Aucun rapport dans cette catégorie." action={<Action variant="primary" onClick={() => setCreating(true)}>+ Nouveau rapport</Action>} />}

      <Dialog open={creating} onClose={() => setCreating(false)} title="Nouveau rapport" description="Simulation : l’Agent Rapport préparera un aperçu."
        footer={<><Action onClick={() => setCreating(false)}>Annuler</Action><Action variant="primary" type="submit" form="sim-new-report">Créer</Action></>}>
        <form id="sim-new-report" className="space-y-4" onSubmit={(event) => { event.preventDefault(); create(); }}>
          <label className="block text-xs text-muted">Type<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as SimReport["kind"] })} className={inputClass}>{Object.entries(reportKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {form.kind !== "global" && <label className="block text-xs text-muted">Client<select value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })} className={inputClass}>{world.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>}
          <InlineNotice tone="info">Aucun e-mail réel ne sera envoyé.</InlineNotice>
        </form>
      </Dialog>
    </>
  );
}
