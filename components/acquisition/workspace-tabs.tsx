"use client";

import { useMemo, useState } from "react";
import type { AcquisitionMessage, AcquisitionProspect, AcquisitionSender, AcquisitionTemplate, AcquisitionWorkspace } from "@/lib/acquisition/model";
import { ACQUISITION_CATEGORIES, ACQUISITION_STAGES } from "@/lib/acquisition/model";
import { PRESCRIBER_SEGMENTS, type PrescriberSegmentId } from "@/lib/acquisition/prescribers";
import { enrichProspectsAction, handoffToEmailAction } from "@/app/(cockpit)/acquisition/actions";
import { HANDOFF_MAX, TEMPLATE_PLACEHOLDERS, auditOutreachDraft } from "@/lib/acquisition/outreach";

export function AcquisitionWorkspaceTabs({ workspaces, prospects, messages, senders, templates, placesReady = false, prescribersReady = false }: {
  placesReady?: boolean; prescribersReady?: boolean;
  workspaces: AcquisitionWorkspace[]; prospects: AcquisitionProspect[];
  messages: AcquisitionMessage[]; senders: AcquisitionSender[]; templates: AcquisitionTemplate[];
}) {
  const [workspace, setWorkspace] = useState(workspaces[0]?.id ?? "");
  const [tab, setTab] = useState<"prospects"|"emails"|"senders"|"templates">("prospects");
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState("");
  const [category, setCategory] = useState("");
  const [withEmail, setWithEmail] = useState(false);
  const active = workspaces.find(w=>w.id===workspace);
  const filtered = useMemo(()=>prospects.filter(p=>p.workspace_id===workspace && (!segment || p.segment===segment) && (!category || p.category===category) && (!withEmail || Boolean(p.contact_email)) &&
    (p.company_name+" "+(p.website??"")+" "+p.category+" "+(p.city??"")+" "+(p.segment?PRESCRIBER_SEGMENTS[p.segment as PrescriberSegmentId]?.label??"":"")).toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr"))),[prospects,workspace,query,segment,category,withEmail]);
  const segmentsHere = [...new Set(prospects.filter(p=>p.workspace_id===workspace&&p.segment).map(p=>p.segment as PrescriberSegmentId))];
  const hasZone = prospects.some(p=>p.workspace_id===workspace&&p.category==="zone_company");
  const hasPrescribers = segmentsHere.length>0 || hasZone;
  const exportHref = `/api/acquisition/export?${new URLSearchParams({ workspace, ...(category ? { category } : {}), ...(withEmail ? { with_email: "1" } : {}) })}`;
  const scopedMessages=messages.filter(m=>m.workspace_id===workspace);
  const companyOf=useMemo(()=>new Map(prospects.map(p=>[p.id,p.company_name])),[prospects]);
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
      <span>Arrêt d&apos;urgence : <strong>{active.emergency_stop?"ACTIF":"inactif"}</strong></span>
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
        <input id="acquisition-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Entreprise, commune, segment…"
          className="my-3 w-full rounded-lg border border-border bg-surface-raised p-3 text-sm" />
        {hasPrescribers && prescribersReady && <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="acquisition-segment" className="sr-only">Segment</label>
          <select id="acquisition-segment" value={segment} onChange={e=>setSegment(e.target.value)} className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm">
            <option value="">Tous les segments</option>{segmentsHere.map(s=><option key={s} value={s}>{PRESCRIBER_SEGMENTS[s]?.label ?? s}</option>)}
          </select>
          {hasZone && <><label htmlFor="acquisition-category" className="sr-only">Origine</label>
            <select id="acquisition-category" value={category} onChange={e=>setCategory(e.target.value)} className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm">
              <option value="">Prescripteurs et zone</option><option value="prescriber">Prescripteurs</option><option value="zone_company">Entreprises de la zone</option>
            </select></>}
          <label htmlFor="acquisition-with-email" className="flex items-center gap-2 text-sm"><input id="acquisition-with-email" type="checkbox" checked={withEmail} onChange={e=>setWithEmail(e.target.checked)} /> Avec e-mail</label>
          <a href={exportHref} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-raised">Exporter (CSV, 10 000 lignes max)</a>
          {placesReady && <form action={enrichProspectsAction}><input type="hidden" name="workspace_id" value={workspace}/>
            <button type="submit" className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-raised">Compléter site et téléphone (Google Places, 20 max)</button></form>}
        </div>}
        {filtered.length===0?<p className="py-8 text-sm text-muted">Aucun prospect correspondant. La détection sera disponible après branchement et validation des sources.</p>
          :<div className="divide-y divide-border">{filtered.map(p=><article className="py-3" key={p.id}>
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{p.company_name}</h3>
              <span className="text-xs text-muted">{ACQUISITION_STAGES[p.stage]} · {p.score??"—"}/100</span></div>
            <p className="text-sm text-muted">{p.segment?PRESCRIBER_SEGMENTS[p.segment as PrescriberSegmentId]?.label ?? p.segment:ACQUISITION_CATEGORIES.find(c=>c.id===p.category)?.label} {p.website?"· "+p.website:""}</p>
            {p.data_source==="sirene"&&<p className="text-xs text-muted">{[p.address, p.distance_km!=null?`${p.distance_km} km`:null, p.siren?`SIREN ${p.siren}`:null, p.places_phone ?? p.osm_phone, p.contact_email, p.bodacc_created_on?`créée (BODACC) le ${new Date(p.bodacc_created_on).toLocaleDateString("fr-FR")}`:null, p.is_sole_proprietor?"entrepreneur individuel":null].filter(Boolean).join(" · ")}
              {(p.places_website ?? p.osm_website)&&<> · <a className="text-accent hover:underline" href={p.places_website ?? p.osm_website ?? undefined} target="_blank" rel="noopener noreferrer">site</a></>}
              {p.osm_website&&!p.places_website&&<> · © contributeurs OpenStreetMap</>}</p>}
            {p.explanation&&<p className="mt-1 text-sm">{p.explanation}</p>}
            {p.source_url&&<a className="mt-1 inline-block break-all text-xs text-accent hover:underline" href={p.source_url} target="_blank" rel="noopener noreferrer">Preuve : {p.source_url}</a>}
          </article>)}</div>}</>}
      {tab==="prospects" && hasPrescribers && <form action={handoffToEmailAction} className="mt-4 rounded-lg border border-border p-3 text-sm">
        <input type="hidden" name="workspace_id" value={workspace} />
        <input type="hidden" name="category" value={category} />
        <input type="hidden" name="segment" value={segment} />
        <p className="font-medium">Transmettre cette liste à la prospection e-mail</p>
        <p className="mt-1 text-xs text-muted">Reprend les filtres ci-dessus. Un brouillon par fiche disposant d&apos;une adresse générique (contact@, info@…), hors désabonnements, rebonds et fiches déjà contactées. Rien n&apos;est envoyé : chaque brouillon se relit et s&apos;approuve dans l&apos;onglet E-mails.</p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-xs">Score minimal<input name="min_score" type="number" min={0} max={100} defaultValue={0} className="mt-1 block w-24 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm" /></label>
          <label className="text-xs">Nombre maximal<input name="limit" type="number" min={1} max={HANDOFF_MAX} defaultValue={50} className="mt-1 block w-24 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm" /></label>
          <label className="text-xs">Modèle<select name="template_id" defaultValue="" className="mt-1 block rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm">
            <option value="">Modèle par défaut (recommandation mutuelle)</option>
            {templates.filter(t=>t.workspace_id===workspace).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select></label>
          <button type="submit" className="rounded-lg bg-accent-strong px-3 py-2 text-sm font-semibold text-accent-foreground">Préparer les e-mails</button>
        </div>
        <p className="mt-2 text-xs text-muted">Variables des modèles : {TEMPLATE_PLACEHOLDERS.map(v=>`{{${v}}}`).join(", ")}.</p>
      </form>}
      {tab==="emails" && (scopedMessages.length===0?<p className="py-8 text-sm text-muted">Aucun brouillon. Les futurs envois nécessiteront une approbation explicite et un connecteur autorisé.</p>:
        <div className="divide-y divide-border">{scopedMessages.map(m=><article key={m.id} className="py-3">
          <div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">{m.subject}</h3><span className="text-xs text-muted">{m.state}</span></div>
          <p className="text-xs text-muted">{m.recipient_email}</p><p className="mt-2 whitespace-pre-wrap text-sm">{m.body_text}</p>
          {m.state==="draft" && <DraftQuality subject={m.subject} body={m.body_text} company={companyOf.get(m.prospect_id)} />}
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

/** Contrôle qualité d'un brouillon (délivrabilité et efficacité) affiché avant approbation. */
function DraftQuality({ subject, body, company }: { subject: string; body: string; company?: string }) {
  const audit = auditOutreachDraft({ subject, body }, company);
  const tone = audit.score >= 80 ? "text-success" : audit.score >= 60 ? "text-warning" : "text-danger";
  return <div className="mt-2 rounded-lg border border-border p-2 text-xs">
    <p><span className={`font-semibold ${tone}`}>Qualité {audit.score}/100</span> <span className="text-muted">· {audit.words} mots</span></p>
    {audit.issues.length>0 && <ul className="mt-1 space-y-0.5">{audit.issues.map(i=><li key={i.code} className={i.level==="warning"?"text-warning":"text-muted"}>{i.message}</li>)}</ul>}
  </div>;
}
