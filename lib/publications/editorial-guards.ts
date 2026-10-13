// Intelligence éditoriale (PR #42) — gardes déterministes appliquées à la sortie du modèle, après les contrôles
// historiques (lots 4-5) et avant toute écriture. Chaque refus porte un motif et un détail lisibles par l'admin.
// Aucun appel IA : comparaisons de texte sur l'historique déjà chargé (30 idées au plus, textes bornés à 600 caractères).
import {ctaStyleOf,introStyleOf,normalizeText,openingOf,textSimilarity} from './editorial-text';
import {mainCtaStyle,mainIntroStyle} from './editorial-memory';
import {isDocumentPhoto,photoMatchesSubject} from './editorial-photos';
import {unsupportedPlaces} from './editorial-places';
import type {EditorialContext} from './editorial-plan';
import type {AgentMediaCandidate,AgentV2GeneratorOutput} from './agent-v2/contract';

export type EditorialRefusal={reason:'place_not_allowed'|'repetition'|'intro_repetition'|'cta_repetition'|'phrase_repetition'|'photo_mismatch'|'document_photo';detail:string};
export const SUBJECT_SIMILARITY_THRESHOLD=.6;
const WORDING_THRESHOLD=.5;

/** Lieux : tout lieu nommé (sujet, angle, textes, CTA) doit figurer dans les faits du client. */
export function placeRefusal(texts:readonly string[],facts:string):EditorialRefusal|null{
 for(const t of texts){const bad=unsupportedPlaces(t,facts);if(bad.length)return {reason:'place_not_allowed',detail:`lieu absent des données du client : ${bad.slice(0,3).join(', ')}`};}
 return null;
}

/** Photo : jamais un document pour illustrer une intervention ; prestation de la photo cohérente avec le sujet. */
export function photoRefusal(subject:string,media:AgentMediaCandidate|undefined,services:readonly string[]):EditorialRefusal|null{
 if(!media)return null;
 if(isDocumentPhoto({description:media.description,categories:media.categories}))return {reason:'document_photo',detail:'la photo choisie est un document (facture, attestation, capture…), jamais une intervention'};
 if(!photoMatchesSubject(subject,media,services))return {reason:'photo_mismatch',detail:'la photo choisie illustre une autre prestation que le sujet'};
 return null;
}

/**
 * Répétitions sur tout l'historique chargé (au-delà des 3 dernières idées) : sujet identique ou très proche,
 * formulation proche, accroche déjà employée, même style d'accroche une 4e fois de suite, CTA déjà employé ou même
 * style de CTA une 3e fois de suite, formulation récurrente signalée au modèle.
 */
export function historyRefusal(value:AgentV2GeneratorOutput,ctx:EditorialContext):EditorialRefusal|null{
 const {history,plan}=ctx,subject=normalizeText(value.idea.subject);
 const same=history.find(h=>normalizeText(h.subject)===subject||textSimilarity(h.subject,value.idea.subject)>=SUBJECT_SIMILARITY_THRESHOLD);
 if(same)return {reason:'repetition',detail:`sujet déjà traité${same.date?` le ${same.date.slice(0,10)}`:''} : « ${same.subject.slice(0,120)} »`};
 const texts=value.publications.map(p=>p.text);
 for(const t of texts)for(const h of history)if(h.texts.some(old=>textSimilarity(t,old)>=WORDING_THRESHOLD))return {reason:'repetition',detail:`formulation trop proche de « ${h.subject.slice(0,120)} »`};
 const openings=new Set(history.flatMap(h=>h.openings).filter(o=>o.split(' ').length>=6));
 for(const t of texts){const o=openingOf(t);if(o.split(' ').length>=6&&openings.has(o))return {reason:'intro_repetition',detail:`accroche déjà employée : « ${o} »`};}
 const styles=texts.map(introStyleOf),recentIntros=history.slice(0,3).map(mainIntroStyle);
 if(recentIntros.length===3&&styles.every(s=>s===styles[0])&&recentIntros.every(s=>s===styles[0]))return {reason:'intro_repetition',detail:`même style d’accroche (${styles[0]}) que les 3 dernières publications`};
 const ctas=value.publications.map(p=>p.cta).filter((c):c is string=>Boolean(c));
 const usedCtas=new Set(history.slice(0,10).flatMap(h=>h.ctas).map(normalizeText));
 const reused=ctas.find(c=>usedCtas.has(normalizeText(c)));
 if(reused)return {reason:'cta_repetition',detail:`appel à l’action déjà employé : « ${reused.slice(0,120)} »`};
 const ctaStyles=ctas.map(ctaStyleOf),recentCtas=history.slice(0,2).map(mainCtaStyle);
 if(ctaStyles.length&&ctaStyles.every(s=>s===ctaStyles[0])&&ctaStyles[0]!=='autre'&&recentCtas.length===2&&recentCtas.every(s=>s===ctaStyles[0]))
  return {reason:'cta_repetition',detail:`même style d’appel à l’action (${ctaStyles[0]}) que les 2 dernières publications`};
 for(const t of texts){const plain=' '+normalizeText(t)+' ',phrase=plan.recurringPhrases.find(p=>plain.includes(' '+p+' '));
  if(phrase)return {reason:'phrase_repetition',detail:`formulation récurrente à éviter : « ${phrase} »`};}
 return null;
}
