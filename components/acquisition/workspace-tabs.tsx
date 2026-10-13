"use client";

import { useMemo, useState } from "react";
import type { AcquisitionMessage, AcquisitionProspect, AcquisitionSender, AcquisitionTemplate, AcquisitionWorkspace } from "@/lib/acquisition/model";
import { ACQUISITION_CATEGORIES, ACQUISITION_STAGES } from "@/lib/acquisition/model";

export function AcquisitionWorkspaceTabs({ workspaces, prospects, messages, senders, templates }: {
  workspaces: AcquisitionWorkspace[]; prospects: AcquisitionProspect[];
  messages: AcquisitionMessage[]; senders: AcquisitionSender[]; templates: AcquisitionTemplate[];
}) {
  const [workspace, setWorkspace] = useState(workspaces[0]?.id ?? "");
  const [tab, setTab] = useState<"prospects"|"emails"|"senders"|"templates">("prospects");
  const [query, setQuery] = useState("");
  const active = workspaces.find(w=>w.id===workspace);
  const filtered = useMemo(()=>prospects.filter(p=>p.workspace_id===workspace &&
    (p.company_name+" "+(p.website??"")+" "+p.category).toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr"))),[prospects,workspace,query]);
  const scopedMessages=messages.filter(m=>m.workspace_id===workspace);
  return <section className="rounded-xl border border-border bg-surface">
    <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
      <h2 className="font-semibold">Portefeuille commercial</h2>
      <label className="ml-auto text-sm text-muted" htmlFor="acquisition-workspace">Entreprise</label>
      <select id="acquisition-workspace" value={workspace} onChange={e=>setWorkspace(e.target.value)}
        className="max-w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm" disabled={!workspaces.length}>
        {!workspaces.length && <option value="">Aucun espace configuré</option>}
        {workspaces.map(w=><option key={w.id} value={w.id}>{w.label}{w.is_internal?" — interne":""}</option>)}
      </select>
    </div>
    {active && <div className="flex flex-wrap gap-3 border-b border-border px-4 py-3 text-xs text-muted">
      <span>Arrêt d'urgence : <strong>{active.emergency_stop?"ACTIF":"inactif"}</strong></span>
      <span>Découverte : {active.discovery_enabled?"activée":"désactivée"}</span>
      <span>Expédition : {active.sending_enabled?"activée":"désactivée"}</span>
      <span>Quota : {active.daily_send_limit}/jour</span>
    </div>}
    <div className="flex flex-wrap gap-2 p-4" role="tablist" aria-label="Vues Acquisition">
      {([["prospects","Prospects"],["emails","E-mails"],["senders","Expéditeurs"],["templates","Modèles"]] as const).map(([id,label])=>
        <button type="button" key={id} role="tab" aria-selected={tab===id} onClick={()=>setTab(id)}
          className={`rounded-lg px-3 py-2 text-sm ${tab===id?"bg-accent/15 font-semibold text-foreground":"text-muted hover:bg-surface-raised"}`}>{label}</button>)}
    </div>
    <div className="px-4 pb-5" role="tabpanel">
      {tab==="prospects" && <><label className="block text-sm text-muted" htmlFor="acquisition-search">Rechercher dans cet espace</label>
        <input id="acquisition-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Entreprise, domaine, catégorie…"
          className="my-3 w-full rounded-lg border border-border bg-surface-raised p-3 text-sm" />
        {filtered.length===0?<p className="py-8 text-sm text-muted">Aucun prospect correspondant. La détection sera disponible après branchement et validation des sources.</p>
          :<div className="divide-y divide-border">{filtered.map(p=><article className="py-3" key={p.id}>
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{p.company_name}</h3>
              <span className="text-xs text-muted">{ACQUISITION_STAGES[p.stage]} · {p.score??"—"}/100</span></div>
            <p className="text-sm text-muted">{ACQUISITION_CATEGORIES.find(c=>c.id===p.category)?.label} {p.website?"· "+p.website:""}</p>
            {p.explanation&&<p className="mt-1 text-sm">{p.explanation}</p>}
            {p.source_url&&<a className="mt-1 inline-block break-all text-xs text-accent hover:underline" href={p.source_url} target="_blank" rel="noopener noreferrer">Preuve : {p.source_url}</a>}
          </article>)}</div>}</>}
      {tab==="emails" && (scopedMessages.length===0?<p className="py-8 text-sm text-muted">Aucun brouillon. Les futurs envois nécessiteront une approbation explicite et un connecteur autorisé.</p>:
        <div className="divide-y divide-border">{scopedMessages.map(m=><article key={m.id} className="py-3">
          <div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">{m.subject}</h3><span className="text-xs text-muted">{m.state}</span></div>
          <p className="text-xs text-muted">{m.recipient_email}</p><p className="mt-2 whitespace-pre-wrap text-sm">{m.body_text}</p>
        </article>)}</div>)}
      {tab==="senders" && (senders.filter(s=>s.workspace_id===workspace).length===0?<p className="py-8 text-sm text-muted">Aucun expéditeur connecté. Préparer contact@code-v.net après validation du fournisseur.</p>:
        <div className="space-y-2">{senders.filter(s=>s.workspace_id===workspace).map(s=><p key={s.id} className="rounded-lg border border-border p-3 text-sm">{s.address} · {s.provider} · {s.status} · {s.daily_limit}/jour</p>)}</div>)}
      {tab==="templates" && (templates.filter(t=>t.workspace_id===workspace).length===0?<p className="py-8 text-sm text-muted">Aucun modèle enregistré. Cinq catégories sont prévues et chaque texte devra être contrôlé avant utilisation.</p>:
        <div className="space-y-3">{templates.filter(t=>t.workspace_id===workspace).map(t=><article key={t.id} className="rounded-lg border border-border p-3">
          <h3 className="font-medium">{t.name} · {t.enabled?"actif":"inactif"}</h3><p className="mt-2 text-sm font-medium">{t.subject_template}</p><p className="mt-2 whitespace-pre-wrap text-sm text-muted">{t.body_template}</p>
        </article>)}</div>)}
    </div>
  </section>;
}
