// Intelligence éditoriale (PR #42) — mémoire visuelle et adéquation photo / sujet. Pur et testable.
// - Une photo « document » (facture, devis, attestation, certificat, capture d'écran…) n'illustre jamais une intervention.
// - Doublons exacts (même empreinte SHA-256, ex. une photo importée deux fois : WhatsApp puis export) : l'usage de l'une
//   vaut pour l'autre, la règle de réemploi du client s'applique donc aux deux, et une seule est proposée.
// - La photo choisie doit illustrer la prestation du sujet quand l'une et l'autre sont reconnaissables.
import {normalizeText,servicesIn} from './editorial-text';
import type {AgentMediaCandidate} from './agent-v2/contract';

// Éléments sensibles ou défauts qui signalent un document plutôt qu'une scène d'intervention.
const DOCUMENT_SENSITIVE=['personal_document','invoice','screen','address'];
const DOCUMENT_ISSUES=['screenshot','text_heavy'];
const DOCUMENT_WORDS=/(?:^| )(facture|factures|devis|attestation|attestations|certificat|certificats|contrat|contrats|bon de commande|bon d intervention|bon de livraison|document|documents|formulaire|courrier|lettre|recu|ticket de caisse|capture d ecran|tarif|tarifs|grille tarifaire|fiche technique|fiche d intervention|rapport|papier|papiers|carte de visite|flyer|prospectus|affiche|logo|ecran|tableau de prix)(?= |$)/;
export type PhotoSignal={description?:string|null;topics?:readonly string[];categories?:readonly string[];sensitive?:readonly string[];quality_issues?:readonly string[]};
/** Photo de document ou administrative (jamais présentée comme une intervention, quel que soit son statut). */
export function isDocumentPhoto(p:PhotoSignal|null|undefined):boolean{
 if(!p)return false;
 if((p.sensitive??[]).some(s=>DOCUMENT_SENSITIVE.includes(s))||(p.quality_issues??[]).some(i=>DOCUMENT_ISSUES.includes(i)))return true;
 return DOCUMENT_WORDS.test(normalizeText([p.description??'',...(p.topics??[]),...(p.categories??[])].join(' . ')));
}

export type ShaRow={id:string;sha256?:string|null};
/** Usages étendus aux doublons exacts : chaque usage d'une photo compte aussi pour les photos de même empreinte. */
export function usesWithDuplicates<U extends {asset_id:string}>(rows:readonly ShaRow[],uses:readonly U[],usedHashes:ReadonlySet<string>=new Set(),
 sentinel?:(assetId:string)=>U):U[]{
 const sha=new Map(rows.filter(r=>r.sha256).map(r=>[r.id,r.sha256 as string]));
 const twins=(id:string)=>{const h=sha.get(id);return h?rows.filter(r=>r.id!==id&&r.sha256===h).map(r=>r.id):[];};
 const out=[...uses];
 for(const u of uses)for(const twin of twins(u.asset_id))out.push({...u,asset_id:twin});
 // Photo déjà publiée via le catalogue Drive (empreinte connue) : comptée comme utilisée (règle « jamais réutilisée »).
 if(sentinel)for(const r of rows)if(r.sha256&&usedHashes.has(r.sha256))out.push(sentinel(r.id));
 return out;
}
/** Une seule photo par empreinte parmi les candidates (la première, donc la mieux classée). */
export function dedupeByHash<T extends {id:string}>(candidates:readonly T[],hashOf:(id:string)=>string|null|undefined):T[]{
 const seen=new Set<string>();
 return candidates.filter(c=>{const h=hashOf(c.id);if(!h)return true;if(seen.has(h))return false;seen.add(h);return true;});
}

/** Prestations du client qu'une photo illustre selon sa description et ses thèmes (contexte non fiable : choix seulement). */
export const photoServices=(m:Pick<AgentMediaCandidate,'description'|'categories'>,services:readonly string[])=>servicesIn([m.description??'',...m.categories].join(' . '),services);
/**
 * Adéquation photo / sujet : quand le sujet porte sur une prestation reconnue et que la photo en illustre une autre
 * (et pas celle du sujet), la photo est refusée. Sans signal d'un côté ou de l'autre, rien n'est refusé ici.
 */
export function photoMatchesSubject(subject:string,m:Pick<AgentMediaCandidate,'description'|'categories'>,services:readonly string[]):boolean{
 const wanted=servicesIn(subject,services);if(!wanted.length)return true;
 const shown=photoServices(m,services);if(!shown.length)return true;
 return shown.some(s=>wanted.includes(s));
}
