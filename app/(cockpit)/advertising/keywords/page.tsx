import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { listClients } from "@/lib/clients/data";
import { getGoogleAdsConnection } from "@/lib/integrations/google-ads/service";
import { getClientKeywordSpend } from "@/lib/integrations/google-ads/keyword-spend";
import { AdsClientSwitcher } from "@/components/google-ads/client-switcher";
import { KeywordSpendTable } from "@/components/google-ads/keyword-spend-table";
import { PageHeading } from "@/components/ui/primitives";
export const metadata={title:"Mots-clés Google Ads"};
export default async function KeywordSpendPage({searchParams}:{searchParams:Promise<{client?:string}>}){
  await requireAdmin();
  const {client:clientId}=await searchParams;
  const clients=await listClients();
  const client=clients.find(c=>c.id===clientId);
  const end=new Date();end.setUTCDate(end.getUTCDate()-1);
  const start=new Date(end);start.setUTCDate(start.getUTCDate()-29);
  const period={start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
  let rows:Awaited<ReturnType<typeof getClientKeywordSpend>>=[];
  let message="";
  if(client){try{
    const conn=await getGoogleAdsConnection(client.id);
    if(conn?.status==="connected")rows=await getClientKeywordSpend(client.id,period);
    else message="Compte Google Ads non connecté pour ce client.";
  }catch{message="Lecture des mots-clés indisponible. Vérifiez les droits API et réessayez.";}}
  return <div className="space-y-5"><PageHeading eyebrow="Google Ads" title="Mots-clés & dépenses" description="Identifiez les recherches coûteuses par campagne, sans confondre clics et prospects." />
    <div className="flex flex-wrap items-end justify-between gap-3"><div className="min-w-[14rem] max-w-sm flex-1"><AdsClientSwitcher clients={clients.map(c=>({id:c.id,name:c.name}))} selected={client?.id??""}/></div><div className="flex flex-wrap gap-3 text-sm"><Link href={`/advertising?client=${client?.id??""}`} className="text-accent">Vue d'ensemble</Link><Link href={`/advertising/manage?client=${client?.id??""}`} className="text-accent">Préparer une modification</Link></div></div>
    <p className="text-xs text-muted">Période : {period.start} au {period.end} · 30 jours complets (aujourd'hui exclu). Maximum 300 résultats les plus coûteux fournis par l'API.</p>
    {!client?<p className="rounded-xl border border-border p-4">Choisissez un client pour consulter les mots-clés.</p>:message?<p role="alert" className="rounded-xl border border-border p-4">{message}</p>:<KeywordSpendTable rows={rows}/>}
  </div>;
}
