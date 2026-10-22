// Validation simplifiée : une même idée éditoriale est préparée en une publication par réseau (même
// editorial_group_id). La file de validation les regroupe en une seule carte « post » ; chaque publication garde sa
// version, son contrôle média et sa décision humaine propres (aucune écriture ici, pur et déterministe).
export type GroupableCard={publicationId:string;groupId?:string|null};
export type ReviewGroup<T extends GroupableCard>={key:string;cards:T[]};
/** Regroupe les cartes par idée éditoriale, dans l'ordre de première apparition (l'ordre des cartes est conservé). */
export function groupReviewCards<T extends GroupableCard>(cards:readonly T[]):ReviewGroup<T>[]{
 const groups=new Map<string,T[]>();
 for(const card of cards){const key=card.groupId||card.publicationId;const list=groups.get(key);if(list)list.push(card);else groups.set(key,[card]);}
 return [...groups].map(([key,list])=>({key,cards:list}));
}
// Au plus une idée et ses trois réseaux, avec une marge : « Tout approuver » reste une décision sur un seul post.
export const MAX_GROUP_APPROVALS=6;
