import type {JustificationView} from '@/lib/publications/editorial-justification';

// Intelligence éditoriale (PR #42) : justification de la préparation par l'Agent v2, en lecture seule (aucune action).
// Contenu relu et borné côté serveur (justificationView), rendu en texte uniquement.
export function AgentV2Justification({justification}:{justification:JustificationView}){
 const list=(title:string,items:string[])=>items.length>0&&<div><h4 className="text-xs font-semibold text-muted">{title}</h4><ul className="mt-1 list-disc space-y-0.5 pl-5">{items.map((x,i)=><li key={i}>{x}</li>)}</ul></div>;
 return <details className="rounded-xl border border-border p-4" data-editorial-justification={justification.outcome}>
  <summary className="cursor-pointer text-sm font-semibold">Justification éditoriale de l’agent</summary>
  <div className="mt-3 space-y-3 text-sm">
   {justification.refusal&&<p className="rounded-lg border border-danger/40 p-2 text-danger">Proposition refusée : {justification.refusal}</p>}
   {justification.subject&&<p><span className="font-medium">Sujet :</span> {justification.subject}</p>}
   {list('Pourquoi ce sujet',justification.subjectReasons)}
   {justification.photo&&<p><span className="font-medium">Photo :</span> {justification.photo}</p>}
   {justification.styles&&<p className="text-muted">{justification.styles}</p>}
   {list('Historique considéré',justification.history)}
   {list('Prestations écartées',justification.deprioritised)}
   {list('Prestations sans photo utilisable',justification.servicesWithoutPhoto)}
   {list('Contrôles passés',justification.checks)}
   <p className="text-xs text-muted">Information en lecture seule : l’approbation humaine reste obligatoire avant toute diffusion.</p>
  </div></details>;
}
