"use client";
import { useMemo, useState } from "react";
import type { AdsKeywordRow } from "@/lib/integrations/google-ads/keyword-spend";
export function KeywordSpendTable({ rows }: { rows: AdsKeywordRow[] }) {
  const [campaign,setCampaign]=useState("");
  const [status,setStatus]=useState("all");
  const campaigns=useMemo(()=>[...new Map(rows.map(r=>[r.campaignId,{id:r.campaignId,name:r.campaignName}])).values()], [rows]);
  const selected=rows.filter(r=>(!campaign||r.campaignId===campaign)&&(status==="all"||r.status===status)).sort((a,b)=>b.cost-a.cost);
  const max=Math.max(0,...selected.map(r=>r.cost));
  const money=new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"});
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-surface p-4">
      <label className="min-w-[14rem] flex-1 text-sm">Campagne<select className="mt-2 w-full rounded-lg border border-border bg-background p-3" value={campaign} onChange={e=>setCampaign(e.target.value)}><option value="">Toutes les campagnes</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="min-w-[10rem] text-sm">État des mots-clés<select className="mt-2 w-full rounded-lg border border-border bg-background p-3" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">Tous</option><option value="ENABLED">Actifs</option><option value="PAUSED">En pause</option></select></label>
    </div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {[["Mots-clés",String(selected.length)],["Dépenses",money.format(selected.reduce((s,r)=>s+r.cost,0))],["Clics",String(selected.reduce((s,r)=>s+r.clicks,0))],["Conversions",String(selected.reduce((s,r)=>s+r.conversions,0))]].map(([label,value])=><div key={label} className="rounded-xl border border-border bg-surface p-4"><p className="text-xs text-muted">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums">{value}</p></div>)}
    </div>
    <section className="rounded-xl border border-border bg-surface p-4"><h2 className="font-semibold">Mots-clés les plus coûteux</h2><p className="mt-1 text-xs text-muted">Dépenses mesurées sur la période. Ce graphique ne prouve pas la rentabilité d&apos;un mot-clé.</p><div className="mt-4 space-y-3">{selected.slice(0,12).map(r=><div key={r.adGroupId+"-"+r.criterionId} className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 text-xs"><div><div className="flex justify-between gap-2"><span className="truncate">{r.text}</span><span className="shrink-0 text-muted">{r.clicks} clic(s)</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-raised"><div className="h-full rounded-full bg-accent" style={{width:`${max>0?100*r.cost/max:0}%`}} /></div></div><span className="text-right font-medium">{money.format(r.cost)}</span></div>)}</div>{!selected.length&&<p className="mt-3 text-sm text-muted">Aucun mot-clé renvoyé sur cette période.</p>}</section>
    <section className="overflow-x-auto rounded-xl border border-border bg-surface"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-border text-xs text-muted"><tr>{["Mot-clé","Campagne","Correspondance","Statut","Coût","Clics","CPC","Conv."].map(s=><th key={s} className="px-3 py-3 font-medium">{s}</th>)}</tr></thead><tbody>{selected.map(r=><tr key={r.adGroupId+"-"+r.criterionId} className="border-b border-border/60"><td className="px-3 py-3 font-medium">{r.text}</td><td className="px-3 py-3">{r.campaignName}</td><td className="px-3 py-3">{r.matchType}</td><td className="px-3 py-3">{r.status==="ENABLED"?"Actif":r.status==="PAUSED"?"En pause":r.status}</td><td className="px-3 py-3">{money.format(r.cost)}</td><td className="px-3 py-3">{r.clicks}</td><td className="px-3 py-3">{r.clicks?money.format(r.cost/r.clicks):"—"}</td><td className="px-3 py-3">{r.conversions}</td></tr>)}</tbody></table></section>
  </div>;
}
